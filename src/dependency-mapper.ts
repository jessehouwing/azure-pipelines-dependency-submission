import * as core from '@actions/core'
import { ParsedTask } from './pipeline-parser.js'
import { InstalledTask } from './azure-devops-client.js'

export interface Dependency {
  package_url: string
  relationship: 'direct' | 'indirect'
  scope?: 'runtime' | 'development'
  dependencies?: string[]
}

export interface DependencySnapshot {
  version: number
  detector: {
    name: string
    version: string
    url: string
  }
  scanned: string
  manifests: {
    [manifestName: string]: {
      name: string
      file: {
        source_location: string
      }
      resolved: {
        [packageUrl: string]: Dependency
      }
    }
  }
}

/**
 * Map Azure Pipelines tasks to GitHub dependency format
 */
export class DependencyMapper {
  private readonly taskMap: Map<string, InstalledTask>

  constructor(taskMap: Map<string, InstalledTask>) {
    this.taskMap = taskMap
  }

  /**
   * Create a dependency snapshot from parsed tasks
   *
   * Tasks are deduplicated based on:
   * - The source file that referenced them
   * - The resolved task identifier (fullIdentifier)
   * - The task version
   */
  createSnapshot(
    tasks: ParsedTask[],
    manifestPath: string,
    jobId: string
    // sha parameter removed as unused - kept in signature for future use
  ): DependencySnapshot {
    // Group tasks by source file for proper deduplication
    const tasksByFile = new Map<string, ParsedTask[]>()

    for (const task of tasks) {
      const sourceFile = task.sourceFile || manifestPath
      if (!tasksByFile.has(sourceFile)) {
        tasksByFile.set(sourceFile, [])
      }
      tasksByFile.get(sourceFile)!.push(task)
    }

    const manifests: DependencySnapshot['manifests'] = {}

    // Process each source file separately
    for (const [sourceFile, fileTasks] of tasksByFile) {
      const resolved: { [packageUrl: string]: Dependency } = {}
      const seen = new Set<string>()

      for (const task of fileTasks) {
        // Resolve task to get the full identifier for deduplication
        const installedTask = this.resolveTask(task.taskIdentifier)
        if (!installedTask) {
          core.warning(
            `Could not resolve task: ${task.taskIdentifier}. It may not be installed in the Azure DevOps organization.`
          )
          continue
        }

        // Create deduplication key: fullIdentifier + version
        const version = this.normalizeVersion(
          task.taskVersion || installedTask.version
        )
        const dedupeKey = `${installedTask.fullIdentifier}@${version}`

        // Skip if we've already processed this task+version combination for this file
        if (seen.has(dedupeKey)) {
          core.debug(`Skipping duplicate task in ${sourceFile}: ${dedupeKey}`)
          continue
        }
        seen.add(dedupeKey)

        const dependency = this.mapTaskToDependency(task, resolved)
        if (dependency) {
          resolved[dependency.package_url] = dependency
        }
      }

      const manifestName = `${sourceFile}:${jobId}`
      manifests[manifestName] = {
        name: manifestName,
        file: {
          source_location: sourceFile
        },
        resolved
      }
    }

    return {
      version: 0,
      detector: {
        name: 'azure-pipelines-dependency-submission',
        version: '1.0.0',
        url: 'https://github.com/jessehouwing/azure-pipelines-dependency-submission'
      },
      scanned: new Date().toISOString(),
      manifests
    }
  }

  /**
   * Map a parsed task to a dependency
   *
   * Note: Always uses task version from the task definition, NOT the contributionVersion
   * The task version is what gets executed; contributionVersion is the extension version
   */
  private mapTaskToDependency(
    task: ParsedTask,
    resolved: { [packageUrl: string]: Dependency }
  ): Dependency | null {
    const installedTask = this.resolveTask(task.taskIdentifier)

    if (!installedTask) {
      core.warning(
        `Could not resolve task: ${task.taskIdentifier}. It may not be installed in the Azure DevOps organization.`
      )
      return null
    }

    // Normalize the version from the pipeline (adds wildcards for partial versions)
    const normalizedVersion = this.normalizeVersion(
      task.taskVersion || installedTask.version
    )

    // Check if the version contains wildcards
    const hasWildcard = normalizedVersion.includes('*')

    // Create package URL in purl format
    // Using 'generic' type as Azure DevOps tasks are not a standard purl type
    // Format: pkg:generic/azure-pipelines/{fullIdentifier}@{version}
    const packageUrl = `pkg:generic/azure-pipelines/${encodeURIComponent(installedTask.fullIdentifier)}@${normalizedVersion}`

    core.debug(`Mapped task ${task.taskIdentifier} to ${packageUrl}`)

    // If using a wildcard version, add the actual resolved version as a transitive dependency
    const dependencies: string[] = []
    if (hasWildcard) {
      // Extract the major version from the normalized version (e.g., "2.*.*" -> 2)
      const majorVersion = parseInt(normalizedVersion.split('.')[0], 10)

      // Resolve the task by major version to get the highest installed version for that major
      const versionSpecificTask = this.resolveTaskByMajor(
        task.taskIdentifier,
        majorVersion
      )
      const actualVersion =
        versionSpecificTask?.version || installedTask.version
      const actualPackageUrl = `pkg:generic/azure-pipelines/${encodeURIComponent(installedTask.fullIdentifier)}@${actualVersion}`

      // Add the actual version as an indirect dependency if not already present
      if (!resolved[actualPackageUrl]) {
        resolved[actualPackageUrl] = {
          package_url: actualPackageUrl,
          relationship: 'indirect',
          scope: 'runtime'
        }
        core.debug(
          `Added transitive dependency for resolved version: ${actualPackageUrl}`
        )
      }
      dependencies.push(actualPackageUrl)
    }

    return {
      package_url: packageUrl,
      relationship: 'direct',
      scope: 'runtime',
      ...(dependencies.length > 0 && { dependencies })
    }
  }

  /**
   * Resolve a task identifier (name or GUID) to an installed task for a specific major version
   */
  private resolveTaskByMajor(
    identifier: string,
    majorVersion: number
  ): InstalledTask | null {
    const normalizedId = identifier.toLowerCase()

    // Try direct lookup by ID@major or name@major
    const versionKey = `${normalizedId}@${majorVersion}`
    const task = this.taskMap.get(versionKey)
    if (task) {
      return task
    }

    // If the identifier contains dots, try to extract the task name
    if (identifier.includes('.')) {
      const parts = identifier.split('.')
      const taskName = parts[parts.length - 1]
      const taskByName = this.taskMap.get(
        `${taskName.toLowerCase()}@${majorVersion}`
      )
      if (taskByName) {
        return taskByName
      }

      // If it ends with a GUID pattern, try that
      const lastPart = parts[parts.length - 1]
      if (this.isGuid(lastPart)) {
        const taskByGuid = this.taskMap.get(
          `${lastPart.toLowerCase()}@${majorVersion}`
        )
        if (taskByGuid) {
          return taskByGuid
        }
      }
    }

    // Fall back to non-version-specific lookup
    return this.resolveTask(identifier)
  }

  /**
   * Resolve a task identifier (name or GUID) to an installed task
   *
   * Supports multiple identifier formats:
   * - taskname (e.g., "PowerShell")
   * - publisher.extension.contribution.taskname (e.g., "jessehouwing.nuget-deprecated.NuGetPublisher-deprecated")
   * - taskId (GUID)
   * - publisher.extension.contribution.taskId
   */
  private resolveTask(identifier: string): InstalledTask | null {
    const normalizedId = identifier.toLowerCase()

    // Try direct lookup by ID or name
    const task = this.taskMap.get(normalizedId)
    if (task) {
      return task
    }

    // If the identifier contains dots, it might be a full qualified name
    if (identifier.includes('.')) {
      // Try to extract the task name from the end
      const parts = identifier.split('.')
      const taskName = parts[parts.length - 1]
      const taskByName = this.taskMap.get(taskName.toLowerCase())
      if (taskByName) {
        return taskByName
      }

      // If it ends with a GUID pattern, try that
      const lastPart = parts[parts.length - 1]
      if (this.isGuid(lastPart)) {
        const taskByGuid = this.taskMap.get(lastPart.toLowerCase())
        if (taskByGuid) {
          return taskByGuid
        }
      }

      // Try the full identifier as a contributionIdentifier lookup
      for (const task of this.taskMap.values()) {
        if (task.fullIdentifier.toLowerCase() === normalizedId) {
          return task
        }
      }
    }

    return null
  }

  /**
   * Normalize a version string to include wildcards for partial versions
   *
   * Examples:
   * - "5" -> "5.*.*"
   * - "5.1" -> "5.1.*"
   * - "5.1.2" -> "5.1.2"
   * - "0.220.0" -> "0.220.0"
   */
  private normalizeVersion(version: string): string {
    const parts = version.split('.')
    if (parts.length === 1) {
      // Major only: 5 -> 5.*.*
      return `${parts[0]}.*.*`
    } else if (parts.length === 2) {
      // Major.Minor: 5.1 -> 5.1.*
      return `${parts[0]}.${parts[1]}.*`
    }
    // Full version: 5.1.2 -> 5.1.2
    return version
  }

  /**
   * Check if a string is a GUID format
   */
  private isGuid(str: string): boolean {
    const guidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return guidPattern.test(str)
  }
}

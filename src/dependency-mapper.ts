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
   */
  createSnapshot(
    tasks: ParsedTask[],
    manifestPath: string,
    jobId: string,
    sha: string
  ): DependencySnapshot {
    const resolved: { [packageUrl: string]: Dependency } = {}

    for (const task of tasks) {
      const dependency = this.mapTaskToDependency(task)
      if (dependency) {
        resolved[dependency.package_url] = dependency
      }
    }

    const manifestName = `${manifestPath}:${jobId}`

    return {
      version: 0,
      detector: {
        name: 'azure-pipelines-dependency-submission',
        version: '1.0.0',
        url: 'https://github.com/jessehouwing/azure-pipelines-dependency-submission'
      },
      scanned: new Date().toISOString(),
      manifests: {
        [manifestName]: {
          name: manifestName,
          file: {
            source_location: manifestPath
          },
          resolved
        }
      }
    }
  }

  /**
   * Map a parsed task to a dependency
   *
   * Note: Always uses task version from the task definition, NOT the contributionVersion
   * The task version is what gets executed; contributionVersion is the extension version
   */
  private mapTaskToDependency(task: ParsedTask): Dependency | null {
    const installedTask = this.resolveTask(task.taskIdentifier)

    if (!installedTask) {
      core.warning(
        `Could not resolve task: ${task.taskIdentifier}. It may not be installed in the Azure DevOps organization.`
      )
      return null
    }

    // Use the version from the pipeline if specified, otherwise use the installed task version
    // This is the task version, NOT the contribution/extension version
    const version = task.taskVersion || installedTask.version

    // Create package URL in purl format
    // Using 'generic' type as Azure DevOps tasks are not a standard purl type
    // Format: pkg:generic/azure-pipelines-task/{fullIdentifier}@{version}
    const namespace = 'azure-pipelines-task'
    const packageUrl = `pkg:generic/${namespace}/${encodeURIComponent(installedTask.fullIdentifier)}@${version}`

    core.debug(`Mapped task ${task.taskIdentifier} to ${packageUrl}`)

    return {
      package_url: packageUrl,
      relationship: 'direct',
      scope: 'runtime'
    }
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
   * Check if a string is a GUID format
   */
  private isGuid(str: string): boolean {
    const guidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    return guidPattern.test(str)
  }
}

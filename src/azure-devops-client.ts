import * as core from '@actions/core'
import * as azdev from 'azure-devops-node-api'
import type { ITaskAgentApi } from 'azure-devops-node-api/TaskAgentApi'
import type { IGalleryApi } from 'azure-devops-node-api/GalleryApi'
import { ExtensionQueryFlags } from 'azure-devops-node-api/interfaces/GalleryInterfaces'

export interface TaskVersion {
  major: number
  minor: number
  patch: number
  isTest?: boolean
}

export interface TaskMetadata {
  id: string
  name: string
  friendlyName: string
  description?: string
  version: TaskVersion
  author?: string
  contributionIdentifier?: string
  contributionVersion?: string
  deprecated?: boolean
  serverOwned?: boolean
  definitionType?: string
  visibility?: string[]
}

export interface InstalledTask {
  id: string
  name: string
  version: string
  major: number
  fullIdentifier: string
  isBuiltIn: boolean
  author?: string
  repositoryUrl?: string
}

/**
 * Cached extension metadata from the Azure DevOps Marketplace
 */
export interface ExtensionMetadata {
  publisherId: string
  extensionId: string
  repositoryUrl?: string
}

export class AzureDevOpsClient {
  private readonly connection: azdev.WebApi
  private readonly marketplaceConnection: azdev.WebApi
  private readonly baseUrl: string
  private readonly extensionMetadataCache: Map<string, ExtensionMetadata> =
    new Map()

  constructor(organizationUrl: string, token: string) {
    this.baseUrl = organizationUrl.replace(/\/$/, '')
    const authHandler = azdev.getPersonalAccessTokenHandler(token)
    this.connection = new azdev.WebApi(this.baseUrl, authHandler)
    // The marketplace API is at a fixed public URL
    this.marketplaceConnection = new azdev.WebApi(
      'https://marketplace.visualstudio.com',
      authHandler
    )
  }

  /**
   * Fetch all installed tasks from the Azure DevOps organization
   * Returns a map keyed by task name/ID and also by name@major for version-specific lookups
   */
  async getInstalledTasks(): Promise<Map<string, InstalledTask>> {
    core.debug(`Fetching tasks from: ${this.baseUrl}`)

    try {
      core.debug('Establishing connection to Azure DevOps Task Agent API')
      const taskAgentApi: ITaskAgentApi =
        await this.connection.getTaskAgentApi()

      // Get all tasks - the API returns separate entries for each major version line
      // (e.g., PowerShell@1 and PowerShell@2 are returned as separate entries)
      core.debug('Requesting task definitions from API')
      const tasks = await taskAgentApi.getTaskDefinitions()

      core.info(`Found ${tasks.length} installed tasks`)
      core.debug(`Processing ${tasks.length} task definitions`)

      const taskMap = new Map<string, InstalledTask>()

      // Track highest version per task name and per task name@major
      const highestByName = new Map<string, InstalledTask>()
      const highestByNameMajor = new Map<string, InstalledTask>()

      for (const task of tasks) {
        if (
          !task.id ||
          !task.name ||
          !task.version ||
          task.version.major === undefined
        ) {
          core.warning(
            `Skipping task with missing required fields: ${JSON.stringify(task)}`
          )
          continue
        }

        const major = task.version.major
        const version = `${major}.${task.version.minor}.${task.version.patch}`
        const isBuiltIn = this.isBuiltInTask(task)
        const fullIdentifier = this.buildFullIdentifier(task, isBuiltIn)

        const installedTask: InstalledTask = {
          id: task.id,
          name: task.name,
          version,
          major,
          fullIdentifier,
          isBuiltIn,
          author: task.author
        }

        const nameKey = task.name.toLowerCase()
        const idKey = task.id.toLowerCase()
        const nameMajorKey = `${nameKey}@${major}`
        const idMajorKey = `${idKey}@${major}`

        // Track highest version for each task name (for default resolution)
        const existingByName = highestByName.get(nameKey)
        if (
          !existingByName ||
          this.compareVersions(version, existingByName.version) > 0
        ) {
          highestByName.set(nameKey, installedTask)
          highestByName.set(idKey, installedTask)
        }

        // Track highest version for each task name@major combination
        const existingByNameMajor = highestByNameMajor.get(nameMajorKey)
        if (
          !existingByNameMajor ||
          this.compareVersions(version, existingByNameMajor.version) > 0
        ) {
          highestByNameMajor.set(nameMajorKey, installedTask)
          highestByNameMajor.set(idMajorKey, installedTask)
        }

        core.debug(
          `Registered task: ${task.name} (${task.id}) -> ${fullIdentifier}@${version} [${isBuiltIn ? 'built-in' : 'extension'}]`
        )
      }

      // Merge both maps - name@major takes precedence for version-specific lookups
      // but we also need plain name/id lookups for backward compatibility
      for (const [key, task] of highestByName) {
        taskMap.set(key, task)
      }
      for (const [key, task] of highestByNameMajor) {
        taskMap.set(key, task)
      }

      return taskMap
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to fetch tasks from Azure DevOps: ${error.message}`
        )
      }
      throw error
    }
  }

  /**
   * Compare two version strings
   * Returns positive if v1 > v2, negative if v1 < v2, 0 if equal
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number)
    const parts2 = v2.split('.').map(Number)

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0
      const p2 = parts2[i] || 0
      if (p1 !== p2) {
        return p1 - p2
      }
    }
    return 0
  }

  /**
   * Determine if a task is a built-in Microsoft task
   * Built-in tasks are pre-installed in every Azure DevOps organization
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isBuiltInTask(task: any): boolean {
    // Tasks marked as serverOwned are built-in
    if (task.serverOwned === true) {
      return true
    }

    // Tasks with definitionType 'metaTask' are built-in
    if (task.definitionType === 'metaTask') {
      return true
    }

    // Tasks authored by Microsoft without a contributionIdentifier are built-in
    if (
      !task.contributionIdentifier &&
      (task.author === 'Microsoft Corporation' ||
        task.author === 'Microsoft' ||
        !task.author)
    ) {
      return true
    }

    return false
  }

  /**
   * Build the full identifier for a task
   *
   * Identifier formats:
   * - Marketplace/Extension tasks: Use contributionIdentifier directly
   *   (e.g., "jessehouwing.nuget-deprecated.NuGetPublisher-deprecated")
   * - Built-in Microsoft tasks: Microsoft.BuiltIn.{TaskName}
   *   (e.g., "Microsoft.BuiltIn.PowerShell")
   * - Fallback: Use task name or ID if no other identifier is available
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildFullIdentifier(task: any, isBuiltIn: boolean): string {
    // Priority 1: Use contributionIdentifier for marketplace/extension tasks
    // This is the authoritative identifier from the Azure DevOps Marketplace
    if (task.contributionIdentifier) {
      core.debug(
        `Using contributionIdentifier for ${task.name}: ${task.contributionIdentifier}`
      )
      return task.contributionIdentifier
    }

    // Priority 2: Built-in Microsoft tasks
    // These tasks are pre-installed in every Azure DevOps organization
    if (isBuiltIn) {
      // Use a consistent format for built-in tasks
      // Format: Microsoft.BuiltIn.{TaskName}
      const identifier = `Microsoft.BuiltIn.${task.name}`
      core.debug(`Built-in task ${task.name}: ${identifier}`)
      return identifier
    }

    // Priority 3: Fallback - use task name or ID
    // This handles edge cases where the task doesn't fit standard patterns
    const identifier = task.name || task.id
    core.warning(
      `Task ${task.name || task.id} could not be fully resolved, using: ${identifier}`
    )
    return identifier
  }

  /**
   * Fetch extension metadata from the Azure DevOps Marketplace
   *
   * The repository URL is stored in the extension version's properties array
   * with the key "Microsoft.VisualStudio.Services.Links.Source"
   *
   * @param publisherId The publisher ID (e.g., "jessehouwing")
   * @param extensionId The extension ID (e.g., "nuget-deprecated")
   * @returns ExtensionMetadata with repositoryUrl if available
   */
  async getExtensionMetadata(
    publisherId: string,
    extensionId: string
  ): Promise<ExtensionMetadata> {
    const cacheKey = `${publisherId}.${extensionId}`

    // Check cache first
    const cached = this.extensionMetadataCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const metadata: ExtensionMetadata = {
      publisherId,
      extensionId
    }

    try {
      core.debug(
        `Fetching marketplace metadata for extension: ${publisherId}.${extensionId}`
      )

      const galleryApi: IGalleryApi =
        await this.marketplaceConnection.getGalleryApi()

      // Fetch extension with version properties to get the repository URL
      const extension = await galleryApi.getExtension(
        null, // customHeaders
        publisherId,
        extensionId,
        undefined, // version (latest)
        ExtensionQueryFlags.IncludeVersions |
          ExtensionQueryFlags.IncludeVersionProperties
      )

      if (extension?.versions && extension.versions.length > 0) {
        // Get the latest version's properties
        const latestVersion = extension.versions[0]
        if (latestVersion.properties) {
          // Look for the source/repository link
          const sourceLink = latestVersion.properties.find(
            (p: { key?: string; value?: string }) =>
              p.key === 'Microsoft.VisualStudio.Services.Links.Source'
          )
          if (sourceLink?.value) {
            metadata.repositoryUrl = sourceLink.value
            core.debug(
              `Found repository URL for ${cacheKey}: ${metadata.repositoryUrl}`
            )
          }
        }
      }
    } catch (error) {
      // Log but don't fail - the repository URL is optional metadata
      core.debug(
        `Could not fetch marketplace metadata for ${cacheKey}: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    this.extensionMetadataCache.set(cacheKey, metadata)
    return metadata
  }

  /**
   * Fetch extension metadata for the provided marketplace extensions
   *
   * @param extensionKeys Iterable set of "publisher.extension" identifiers
   */
  async fetchExtensionMetadata(
    extensionKeys: Iterable<string>
  ): Promise<Map<string, ExtensionMetadata>> {
    const extensions = new Set(extensionKeys)

    if (extensions.size === 0) {
      core.debug(
        'No marketplace extensions referenced; skipping metadata fetch'
      )
      return this.extensionMetadataCache
    }

    core.debug(
      `Fetching metadata for ${extensions.size} referenced marketplace extensions`
    )

    const fetchPromises: Promise<void>[] = []
    for (const extKey of extensions) {
      const [publisher, ...extensionParts] = extKey.split('.')
      const extension = extensionParts.join('.')

      if (!publisher || !extension) {
        continue
      }

      fetchPromises.push(
        this.getExtensionMetadata(publisher, extension).then(() => {})
      )
    }

    await Promise.all(fetchPromises)
    return this.extensionMetadataCache
  }
}

import * as core from '@actions/core'
import * as azdev from 'azure-devops-node-api'
import type { ITaskAgentApi } from 'azure-devops-node-api/TaskAgentApi'

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
  fullIdentifier: string
  isBuiltIn: boolean
  author?: string
}

export class AzureDevOpsClient {
  private readonly connection: azdev.WebApi
  private readonly baseUrl: string

  constructor(organizationUrl: string, token: string) {
    this.baseUrl = organizationUrl.replace(/\/$/, '')
    const authHandler = azdev.getPersonalAccessTokenHandler(token)
    this.connection = new azdev.WebApi(this.baseUrl, authHandler)
  }

  /**
   * Fetch all installed tasks from the Azure DevOps organization
   */
  async getInstalledTasks(): Promise<Map<string, InstalledTask>> {
    core.debug(`Fetching tasks from: ${this.baseUrl}`)

    try {
      const taskAgentApi: ITaskAgentApi =
        await this.connection.getTaskAgentApi()

      // Get all tasks (latest version only)
      const tasks = await taskAgentApi.getTaskDefinitions()

      core.info(`Found ${tasks.length} installed tasks`)

      const taskMap = new Map<string, InstalledTask>()

      for (const task of tasks) {
        if (!task.id || !task.name || !task.version) {
          core.warning(
            `Skipping task with missing required fields: ${JSON.stringify(task)}`
          )
          continue
        }

        const version = `${task.version.major}.${task.version.minor}.${task.version.patch}`
        const isBuiltIn = this.isBuiltInTask(task)
        const fullIdentifier = this.buildFullIdentifier(task, isBuiltIn)

        const installedTask: InstalledTask = {
          id: task.id,
          name: task.name,
          version,
          fullIdentifier,
          isBuiltIn,
          author: task.author
        }

        // Map by both task ID and task name for lookup flexibility
        taskMap.set(task.id.toLowerCase(), installedTask)
        taskMap.set(task.name.toLowerCase(), installedTask)

        core.debug(
          `Registered task: ${task.name} (${task.id}) -> ${fullIdentifier}@${version} [${isBuiltIn ? 'built-in' : 'extension'}]`
        )
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
   * Determine if a task is a built-in Microsoft task
   * Built-in tasks are pre-installed in every Azure DevOps organization
   */
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
}

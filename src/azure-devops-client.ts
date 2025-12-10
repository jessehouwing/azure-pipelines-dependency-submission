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
  visibility?: string[]
}

export interface InstalledTask {
  id: string
  name: string
  version: string
  fullIdentifier: string
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
      const taskAgentApi: ITaskAgentApi = await this.connection.getTaskAgentApi()

      // Get all tasks (latest version only)
      const tasks = await taskAgentApi.getTaskDefinitions()

      core.info(`Found ${tasks.length} installed tasks`)

      const taskMap = new Map<string, InstalledTask>()

      for (const task of tasks) {
        if (!task.id || !task.name || !task.version) {
          core.warning(`Skipping task with missing required fields: ${JSON.stringify(task)}`)
          continue
        }

        const version = `${task.version.major}.${task.version.minor}.${task.version.patch}`
        const fullIdentifier = this.buildFullIdentifier(task)

        const installedTask: InstalledTask = {
          id: task.id,
          name: task.name,
          version,
          fullIdentifier
        }

        // Map by both task ID and task name for lookup flexibility
        taskMap.set(task.id.toLowerCase(), installedTask)
        taskMap.set(task.name.toLowerCase(), installedTask)

        core.debug(`Registered task: ${task.name} (${task.id}) -> ${fullIdentifier}@${version}`)
      }

      return taskMap
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch tasks from Azure DevOps: ${error.message}`)
      }
      throw error
    }
  }

  /**
   * Build the full identifier for a task in the format:
   * publisherid.extensionid.contribution.taskname
   */
  private buildFullIdentifier(task: any): string {
    // If contributionIdentifier is available, use it
    if (task.contributionIdentifier) {
      return task.contributionIdentifier
    }

    // For built-in tasks, construct a standard identifier
    // Built-in tasks typically have a consistent naming pattern
    if (task.serverOwned || !task.author) {
      return `Microsoft.VisualStudio.Services.Cloud.${task.name}`
    }

    // For extension tasks, try to construct from available metadata
    // This is a best-effort approach
    const author = task.author?.replace(/\s+/g, '') || 'Unknown'
    return `${author}.${task.name}`
  }
}

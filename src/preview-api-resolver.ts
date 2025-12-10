import * as core from '@actions/core'
import * as azdev from 'azure-devops-node-api'
import type { IBuildApi } from 'azure-devops-node-api/BuildApi'
import type { BuildDefinition } from 'azure-devops-node-api/interfaces/BuildInterfaces'
import { ParsedTask } from './pipeline-parser.js'
import * as path from 'path'

export interface PreviewRunTask {
  id: string
  name: string
  version: string
  displayName?: string
}

/**
 * Use Azure DevOps Preview Run API to expand templates and decorators
 */
export class PreviewApiResolver {
  private readonly connection: azdev.WebApi
  private readonly baseUrl: string
  private readonly project?: string

  constructor(organizationUrl: string, token: string, project?: string) {
    this.baseUrl = organizationUrl.replace(/\/$/, '')
    this.project = project
    const authHandler = azdev.getPersonalAccessTokenHandler(token)
    this.connection = new azdev.WebApi(this.baseUrl, authHandler)
  }

  /**
   * Find build definitions that reference the given pipeline file
   */
  async findBuildDefinitionsForFile(
    pipelineFilePath: string,
    workspaceRoot: string
  ): Promise<Array<{ project: string; definitionId: number; name: string }>> {
    const buildApi: IBuildApi = await this.connection.getBuildApi()
    const results: Array<{
      project: string
      definitionId: number
      name: string
    }> = []

    // Normalize the pipeline file path to be relative to workspace root
    const relativePath = path.relative(workspaceRoot, pipelineFilePath)

    try {
      let projects: string[] = []

      if (this.project) {
        projects = [this.project]
      } else {
        // Get all projects the token has access to
        const coreApi = await this.connection.getCoreApi()
        const projectList = await coreApi.getProjects()
        projects = projectList.map((p) => p.name || '').filter((n) => n)
      }

      for (const projectName of projects) {
        try {
          core.debug(`Querying build definitions in project: ${projectName}`)

          // Get all build definitions in the project
          const definitions = await buildApi.getDefinitions(projectName)

          for (const definition of definitions) {
            if (!definition.id || !definition.name) continue

            // Get full definition details
            const fullDefinition = await buildApi.getDefinition(
              projectName,
              definition.id
            )

            // Check if this definition references our pipeline file
            if (this.definitionReferencesFile(fullDefinition, relativePath)) {
              core.info(
                `Found definition: ${fullDefinition.name} (ID: ${fullDefinition.id}) in project ${projectName}`
              )
              results.push({
                project: projectName,
                definitionId: fullDefinition.id!,
                name: fullDefinition.name || 'Unnamed'
              })
            }
          }
        } catch (error) {
          core.warning(
            `Failed to query project ${projectName}: ${error instanceof Error ? error.message : error}`
          )
        }
      }
    } catch (error) {
      core.warning(
        `Failed to find build definitions: ${error instanceof Error ? error.message : error}`
      )
    }

    return results
  }

  /**
   * Check if a build definition references a specific file
   */
  private definitionReferencesFile(
    definition: BuildDefinition,
    relativePath: string
  ): boolean {
    // Only process definitions that use GitHub as the repository source
    if (definition.repository?.type !== 'GitHub') {
      core.debug(
        `Skipping definition ${definition.name} - repository type is ${definition.repository?.type}, not GitHub`
      )
      return false
    }

    // Check if the definition has a YAML path that matches
    if (definition.process?.type === 2) {
      // Type 2 = YAML process
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const yamlProcess = definition.process as any
      if (yamlProcess.yamlFilename) {
        const normalizedDefPath = yamlProcess.yamlFilename.replace(/\\/g, '/')
        const normalizedRelPath = relativePath.replace(/\\/g, '/')

        return (
          normalizedDefPath === normalizedRelPath ||
          normalizedDefPath.endsWith(`/${normalizedRelPath}`)
        )
      }
    }

    return false
  }

  /**
   * Use the preview run API to expand a pipeline and extract tasks
   */
  async previewPipeline(
    projectName: string,
    definitionId: number
  ): Promise<ParsedTask[]> {
    try {
      core.debug(
        `Previewing pipeline: project=${projectName}, definitionId=${definitionId}`
      )

      // Note: The preview API endpoint is accessed through custom REST API call
      // as the typed API may not have direct support
      const restClient = this.connection.rest
      const url = `${this.baseUrl}/${projectName}/_apis/pipelines/${definitionId}/preview?api-version=7.1-preview.1`

      core.debug(`Calling preview API: ${url}`)

      const response = await restClient.create(url, {
        previewRun: true,
        yamlOverride: undefined
      })

      if (response.statusCode !== 200) {
        throw new Error(`Preview API returned status ${response.statusCode}`)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const previewResult = response.result as any

      // Extract tasks from the preview result
      const tasks = this.extractTasksFromPreview(previewResult)

      core.debug(
        `Extracted ${tasks.length} tasks from preview for definition ${definitionId}`
      )

      return tasks
    } catch (error) {
      core.warning(
        `Failed to preview pipeline ${definitionId} in ${projectName}: ${error instanceof Error ? error.message : error}`
      )
      return []
    }
  }

  /**
   * Extract tasks from a preview run result
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractTasksFromPreview(previewResult: any): ParsedTask[] {
    const tasks: ParsedTask[] = []

    try {
      // The preview result contains a finalYaml property with the expanded pipeline
      if (previewResult.finalYaml) {
        // Parse the YAML to extract tasks
        // This would use the pipeline parser, but on the expanded YAML
        core.debug('Preview result contains finalYaml')
      }

      // Also check for jobs/stages in the preview result
      if (previewResult.stages) {
        this.extractTasksFromStages(previewResult.stages, tasks)
      }

      if (previewResult.jobs) {
        this.extractTasksFromJobs(previewResult.jobs, tasks)
      }
    } catch (error) {
      core.debug(`Error extracting tasks from preview: ${error}`)
    }

    return tasks
  }

  /**
   * Extract tasks from stages in preview result
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractTasksFromStages(stages: any[], tasks: ParsedTask[]): void {
    for (const stage of stages) {
      if (stage.jobs) {
        this.extractTasksFromJobs(stage.jobs, tasks)
      }
    }
  }

  /**
   * Extract tasks from jobs in preview result
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractTasksFromJobs(jobs: any[], tasks: ParsedTask[]): void {
    for (const job of jobs) {
      if (job.steps) {
        for (const step of job.steps) {
          if (step.task) {
            const task = this.parseTaskFromStep(step)
            if (task) {
              tasks.push(task)
            }
          }
        }
      }
    }
  }

  /**
   * Parse a task from a step in the preview result
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseTaskFromStep(step: any): ParsedTask | null {
    try {
      const taskId = step.task.id || step.task.name
      const taskVersion = step.task.versionSpec || step.task.version

      if (!taskId) return null

      return {
        taskIdentifier: taskId,
        taskVersion,
        displayName: step.displayName || step.name,
        inputs: step.inputs
      }
    } catch {
      return null
    }
  }
}

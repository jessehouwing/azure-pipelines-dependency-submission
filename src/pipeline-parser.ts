import * as core from '@actions/core'
import * as fs from 'fs'
import * as yaml from 'yaml'

export interface ParsedTask {
  taskIdentifier: string // task name or GUID
  taskVersion?: string
  displayName?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputs?: Record<string, any>
}

export interface ParsedTemplate {
  path: string
  repository?: string
  ref?: string // ref name to checkout; defaults to 'refs/heads/main'
}

export interface ParsedPipeline {
  tasks: ParsedTask[]
  templates: ParsedTemplate[]
  extends?: ParsedTemplate
}

/**
 * Parse Azure Pipelines YAML files and extract tasks and templates
 */
export class PipelineParser {
  /**
   * Parse a pipeline file and extract all tasks and template references
   */
  async parsePipelineFile(filePath: string): Promise<ParsedPipeline> {
    core.debug(`Parsing pipeline file: ${filePath}`)

    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const doc = yaml.parseDocument(content)
      const pipelineData = doc.toJSON()

      const tasks: ParsedTask[] = []
      const templates: ParsedTemplate[] = []
      let extendsTemplate: ParsedTemplate | undefined

      // Check for extends template (pipeline templates)
      if (pipelineData?.extends) {
        extendsTemplate = this.parseTemplateReference(pipelineData.extends)
      }

      // Parse stages, jobs, and steps
      this.extractTasks(pipelineData, tasks, templates)

      core.debug(
        `Found ${tasks.length} tasks and ${templates.length} template references`
      )

      return {
        tasks,
        templates,
        extends: extendsTemplate
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to parse pipeline file ${filePath}: ${error.message}`
        )
      }
      throw error
    }
  }

  /**
   * Recursively extract tasks and templates from pipeline structure
   */
  private extractTasks(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    obj: any,
    tasks: ParsedTask[],
    templates: ParsedTemplate[]
  ): void {
    if (!obj || typeof obj !== 'object') {
      return
    }

    // Check if this is a task step
    if (obj.task) {
      tasks.push(this.parseTask(obj))
      return
    }

    // Check if this is a template reference
    if (obj.template) {
      templates.push(this.parseTemplateReference(obj))
    }

    // Recursively process arrays and objects
    if (Array.isArray(obj)) {
      for (const item of obj) {
        this.extractTasks(item, tasks, templates)
      }
    } else {
      // Process known pipeline structure keys
      const keysToProcess = [
        'stages',
        'jobs',
        'steps',
        'pool',
        'strategy',
        'matrix',
        'deployment',
        'deploy',
        'preDeploymentHook',
        'postDeploymentHook',
        'on',
        'onSuccess',
        'onFailure',
        'success',
        'failure',
        'finally'
      ]

      for (const key of keysToProcess) {
        if (obj[key]) {
          this.extractTasks(obj[key], tasks, templates)
        }
      }
    }
  }

  /**
   * Parse a task step
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseTask(taskStep: any): ParsedTask {
    const taskString = taskStep.task as string
    let taskIdentifier: string
    let taskVersion: string | undefined

    // Task can be in format "TaskName@version" or just "TaskName" or a GUID
    if (taskString.includes('@')) {
      const parts = taskString.split('@')
      taskIdentifier = parts[0]
      taskVersion = parts[1]
    } else {
      taskIdentifier = taskString
    }

    return {
      taskIdentifier,
      taskVersion,
      displayName: taskStep.displayName,
      inputs: taskStep.inputs
    }
  }

  /**
   * Parse a template reference
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseTemplateReference(templateRef: any): ParsedTemplate {
    if (typeof templateRef === 'string') {
      return { path: templateRef }
    }

    return {
      path: templateRef.template,
      repository: templateRef.repository
    }
  }

  /**
   * Check if a file appears to be an Azure Pipelines file based on content
   */
  static isPipelineFile(filePath: string): boolean {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const doc = yaml.parseDocument(content)
      const data = doc.toJSON()

      // Check for common Azure Pipelines keys
      if (!data || typeof data !== 'object') {
        return false
      }

      const pipelineKeys = [
        'stages',
        'jobs',
        'steps',
        'trigger',
        'pool',
        'extends',
        'resources',
        'variables',
        'parameters'
      ]

      return pipelineKeys.some((key) => key in data)
    } catch {
      return false
    }
  }
}

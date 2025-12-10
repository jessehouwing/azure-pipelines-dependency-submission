import * as core from '@actions/core'
import * as fs from 'fs'
import {
  PipelineParser,
  ParsedPipeline,
  ParsedTask
} from './pipeline-parser.js'
import { PipelineFileDiscovery } from './pipeline-file-discovery.js'

export interface ResolvedDependencies {
  tasks: ParsedTask[]
  processedFiles: Set<string>
}

/**
 * Resolve pipeline templates and collect all tasks including from templates
 */
export class TemplateResolver {
  private readonly parser: PipelineParser
  private readonly fileDiscovery: PipelineFileDiscovery
  private readonly resolveTemplates: boolean

  constructor(workspaceRoot: string, resolveTemplates: boolean = true) {
    this.parser = new PipelineParser()
    this.fileDiscovery = new PipelineFileDiscovery(workspaceRoot)
    this.resolveTemplates = resolveTemplates
  }

  /**
   * Resolve a pipeline file and all its templates, collecting all tasks
   */
  async resolvePipeline(
    pipelineFilePath: string
  ): Promise<ResolvedDependencies> {
    const processedFiles = new Set<string>()
    const allTasks: ParsedTask[] = []

    await this.resolvePipelineRecursive(
      pipelineFilePath,
      allTasks,
      processedFiles
    )

    return {
      tasks: allTasks,
      processedFiles
    }
  }

  /**
   * Recursively resolve a pipeline file and its templates
   */
  private async resolvePipelineRecursive(
    filePath: string,
    allTasks: ParsedTask[],
    processedFiles: Set<string>
  ): Promise<void> {
    // Avoid processing the same file twice
    if (processedFiles.has(filePath)) {
      core.debug(`Skipping already processed file: ${filePath}`)
      return
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      core.warning(`Template file not found: ${filePath}`)
      return
    }

    processedFiles.add(filePath)
    core.debug(`Processing pipeline file: ${filePath}`)

    try {
      const parsed: ParsedPipeline =
        await this.parser.parsePipelineFile(filePath)

      // Add all tasks from this file
      allTasks.push(...parsed.tasks)

      // If template resolution is disabled, skip template processing
      if (!this.resolveTemplates) {
        core.debug('Template resolution is disabled')
        return
      }

      // Process extends template if present
      if (parsed.extends) {
        await this.resolveTemplateReference(
          filePath,
          parsed.extends.path,
          allTasks,
          processedFiles
        )
      }

      // Process all template references
      for (const template of parsed.templates) {
        // Skip templates from external repositories for now
        // These would require additional authentication and complexity
        if (template.repository) {
          core.info(
            `Skipping external repository template: ${template.path} from ${template.repository}`
          )
          continue
        }

        await this.resolveTemplateReference(
          filePath,
          template.path,
          allTasks,
          processedFiles
        )
      }
    } catch (error) {
      if (error instanceof Error) {
        core.warning(`Failed to process file ${filePath}: ${error.message}`)
      }
    }
  }

  /**
   * Resolve a template reference and process it
   */
  private async resolveTemplateReference(
    sourceFile: string,
    templatePath: string,
    allTasks: ParsedTask[],
    processedFiles: Set<string>
  ): Promise<void> {
    // Resolve the template path relative to the source file
    const resolvedPath = this.fileDiscovery.resolveTemplatePath(
      sourceFile,
      templatePath
    )

    core.debug(`Resolving template: ${templatePath} -> ${resolvedPath}`)

    // Recursively process the template
    await this.resolvePipelineRecursive(resolvedPath, allTasks, processedFiles)
  }
}

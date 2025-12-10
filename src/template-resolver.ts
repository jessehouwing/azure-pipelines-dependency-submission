import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import * as path from 'path'
import {
  PipelineParser,
  ParsedPipeline,
  ParsedTask,
  ParsedTemplate
} from './pipeline-parser.js'
import { PipelineFileDiscovery } from './pipeline-file-discovery.js'

export interface ExternalTemplate {
  owner: string
  repo: string
  path: string
  ref: string
}

export interface ResolvedDependencies {
  tasks: ParsedTask[]
  processedFiles: Set<string>
  externalTemplates: ExternalTemplate[]
}

/**
 * Resolve pipeline templates and collect all tasks including from templates
 */
export class TemplateResolver {
  private readonly parser: PipelineParser
  private readonly fileDiscovery: PipelineFileDiscovery
  private readonly resolveTemplates: boolean
  private readonly githubToken?: string
  private readonly octokit?: ReturnType<typeof github.getOctokit>
  private readonly workspaceRoot: string

  constructor(
    workspaceRoot: string,
    resolveTemplates: boolean = true,
    githubToken?: string
  ) {
    this.parser = new PipelineParser()
    this.fileDiscovery = new PipelineFileDiscovery(workspaceRoot)
    this.resolveTemplates = resolveTemplates
    this.githubToken = githubToken
    this.workspaceRoot = workspaceRoot
    if (githubToken) {
      this.octokit = github.getOctokit(githubToken)
    }
  }

  /**
   * Resolve a pipeline file and all its templates, collecting all tasks
   */
  async resolvePipeline(
    pipelineFilePath: string
  ): Promise<ResolvedDependencies> {
    const processedFiles = new Set<string>()
    const allTasks: ParsedTask[] = []
    const externalTemplates: ExternalTemplate[] = []

    await this.resolvePipelineRecursive(
      pipelineFilePath,
      allTasks,
      processedFiles,
      externalTemplates
    )

    return {
      tasks: allTasks,
      processedFiles,
      externalTemplates
    }
  }

  /**
   * Recursively resolve a pipeline file and its templates
   */
  private async resolvePipelineRecursive(
    filePath: string,
    allTasks: ParsedTask[],
    processedFiles: Set<string>,
    externalTemplates: ExternalTemplate[]
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

      // Compute relative path from workspace root for the source file reference
      const relativePath = path
        .relative(this.workspaceRoot, filePath)
        .replace(/\\/g, '/')

      // Add all tasks from this file, tagging them with the source file (relative path)
      for (const task of parsed.tasks) {
        allTasks.push({
          ...task,
          sourceFile: relativePath
        })
      }

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
          processedFiles,
          externalTemplates
        )
      }

      // Process all template references
      for (const template of parsed.templates) {
        // Handle templates from external repositories
        if (template.repository) {
          await this.resolveExternalTemplateReference(
            template,
            allTasks,
            processedFiles,
            externalTemplates
          )
          continue
        }

        await this.resolveTemplateReference(
          filePath,
          template.path,
          allTasks,
          processedFiles,
          externalTemplates
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
    processedFiles: Set<string>,
    externalTemplates: ExternalTemplate[]
  ): Promise<void> {
    // Resolve the template path relative to the source file
    const resolvedPath = this.fileDiscovery.resolveTemplatePath(
      sourceFile,
      templatePath
    )

    core.debug(`Resolving template: ${templatePath} -> ${resolvedPath}`)

    // Recursively process the template
    await this.resolvePipelineRecursive(
      resolvedPath,
      allTasks,
      processedFiles,
      externalTemplates
    )
  }

  /**
   * Resolve and process a template from an external GitHub repository
   */
  private async resolveExternalTemplateReference(
    template: ParsedTemplate,
    allTasks: ParsedTask[],
    processedFiles: Set<string>,
    externalTemplates: ExternalTemplate[]
  ): Promise<void> {
    if (!this.octokit || !this.githubToken) {
      core.warning(
        `Cannot resolve external repository template: ${template.path} from ${template.repository}. No GitHub token provided.`
      )
      return
    }

    try {
      core.info(
        `Resolving external repository template: ${template.path} from ${template.repository}`
      )

      // Parse repository reference (format: owner/repo or just repo-alias)
      const repoRef = template.repository

      // In Azure Pipelines, the repository reference can be an alias defined in resources.repositories
      // For now, we'll try to parse it as owner/repo format
      // Example from the user: "kmadof/devops-templates"

      let owner: string
      let repo: string

      if (!repoRef) {
        core.warning(`Cannot resolve template without repository reference.`)
        return
      }

      if (repoRef.includes('/')) {
        ;[owner, repo] = repoRef.split('/')
        core.debug(`Parsed external repository: owner=${owner}, repo=${repo}`)
      } else {
        // If it's just an alias, we can't resolve it without more context
        core.warning(
          `Cannot resolve repository alias '${repoRef}'. External templates must use 'owner/repo' format in the template reference.`
        )
        return
      }

      const ref = template.ref || 'refs/heads/main' // Use provided ref or default as per Azure Pipelines spec
      core.debug(`Using ref: ${ref} for external template`)

      // Track this external template as a transitive dependency
      externalTemplates.push({
        owner,
        repo,
        path: template.path,
        ref
      })
      core.debug(
        `Tracked external template as transitive dependency: ${owner}/${repo}/${template.path}@${ref}`
      )

      // Download the template file content from GitHub
      // Extract branch name from ref (refs/heads/main -> main)
      const branchName = ref.startsWith('refs/heads/')
        ? ref.substring('refs/heads/'.length)
        : ref
      core.debug(`Downloading template from branch: ${branchName}`)

      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: template.path,
        ref: branchName
      })

      core.debug(`Successfully downloaded template: ${template.path}`)

      if ('content' in data && data.type === 'file') {
        // Decode the base64 content
        const content = Buffer.from(data.content, 'base64').toString('utf8')

        // Create a temporary file to process
        const tempDir = path.join(this.workspaceRoot, '.azure-pipelines-temp')
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }

        const tempFile = path.join(
          tempDir,
          `${owner}-${repo}-${path.basename(template.path)}`
        )
        fs.writeFileSync(tempFile, content)

        // Mark as processed to avoid loops
        const externalKey = `external:${owner}/${repo}/${template.path}`
        if (processedFiles.has(externalKey)) {
          core.debug(`Already processed external template: ${externalKey}`)
          return
        }
        processedFiles.add(externalKey)

        // Parse and process the template
        await this.resolvePipelineRecursive(
          tempFile,
          allTasks,
          processedFiles,
          externalTemplates
        )

        core.debug(`Successfully resolved external template: ${template.path}`)
      } else {
        core.warning(
          `External template ${template.path} is not a file or could not be retrieved`
        )
      }
    } catch (error) {
      if (error instanceof Error) {
        core.warning(
          `Failed to resolve external template ${template.path} from ${template.repository}: ${error.message}`
        )
      }
    }
  }
}

import * as core from '@actions/core'
import { glob } from 'glob'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Discover Azure Pipelines files in the repository using glob patterns
 */
export class PipelineFileDiscovery {
  private readonly workspaceRoot: string

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot
  }

  /**
   * Find all Azure Pipelines files based on provided patterns or default patterns
   * @param customPatterns Custom glob patterns provided by the user (comma or newline separated)
   * @returns Array of absolute file paths
   */
  async findPipelineFiles(customPatterns?: string): Promise<string[]> {
    const patterns = this.parsePatterns(customPatterns)
    const allFiles = new Set<string>()

    core.info(`Searching for pipeline files with patterns: ${patterns.join(', ')}`)

    for (const pattern of patterns) {
      try {
        const matches = await glob(pattern, {
          cwd: this.workspaceRoot,
          absolute: true,
          nodir: true,
          ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**']
        })

        for (const match of matches) {
          // Verify the file exists and is readable
          if (fs.existsSync(match) && this.isYamlFile(match)) {
            allFiles.add(match)
          }
        }
      } catch (error) {
        core.warning(`Failed to process pattern '${pattern}': ${error}`)
      }
    }

    const files = Array.from(allFiles).sort()
    core.info(`Found ${files.length} pipeline file(s)`)

    return files
  }

  /**
   * Parse user-provided patterns or return default patterns
   */
  private parsePatterns(customPatterns?: string): string[] {
    if (customPatterns && customPatterns.trim()) {
      // Split by comma or newline and trim each pattern
      return customPatterns
        .split(/[,\n]/)
        .map(p => p.trim())
        .filter(p => p.length > 0)
    }

    // Default patterns for Azure Pipelines files
    return [
      'azure-pipelines.yml',
      'azure-pipelines.yaml',
      '.azure-pipelines/*.yml',
      '.azure-pipelines/*.yaml'
    ]
  }

  /**
   * Check if a file has a YAML extension
   */
  private isYamlFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return ext === '.yml' || ext === '.yaml'
  }

  /**
   * Resolve a relative path from a pipeline file (used for templates)
   * @param pipelineFile The pipeline file containing the reference
   * @param relativePath The relative path to resolve
   * @returns Absolute path to the referenced file
   */
  resolveTemplatePath(pipelineFile: string, relativePath: string): string {
    const pipelineDir = path.dirname(pipelineFile)
    return path.resolve(pipelineDir, relativePath)
  }
}

import * as core from '@actions/core'
import * as github from '@actions/github'
import { AzureDevOpsClient } from './azure-devops-client.js'
import { PipelineFileDiscovery } from './pipeline-file-discovery.js'
import { TemplateResolver } from './template-resolver.js'
import { DependencyMapper } from './dependency-mapper.js'
import { DependencySubmitter } from './dependency-submitter.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Get inputs
    const token = core.getInput('token', { required: true })
    // Reserved for future use: accessing private repos for template resolution
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const githubToken = core.getInput('github-token') || token
    const repository =
      core.getInput('repository') || process.env.GITHUB_REPOSITORY || ''
    const azureDevOpsUrl = core.getInput('azure-devops-url', { required: true })
    const azureDevOpsToken = core.getInput('azure-devops-token', {
      required: true
    })
    const pipelinePaths = core.getInput('pipeline-paths')
    const resolveTemplates = core.getBooleanInput('resolve-templates')

    // Determine the correct SHA and ref to use
    // For pull_request events, github.context.sha is the merge commit SHA (refs/pull/<pr>/merge),
    // but the dependency snapshot should be for the PR head SHA.
    // See: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request
    const isPullRequest =
      github.context.eventName === 'pull_request' ||
      github.context.eventName === 'pull_request_target'

    const pullRequest = github.context.payload.pull_request as
      | { head?: { sha?: string; ref?: string } }
      | undefined

    const sha =
      isPullRequest && pullRequest?.head?.sha
        ? pullRequest.head.sha
        : process.env.GITHUB_SHA || github.context.sha || ''

    const ref =
      isPullRequest && pullRequest?.head?.ref
        ? `refs/heads/${pullRequest.head.ref}`
        : process.env.GITHUB_REF || github.context.ref || ''

    if (isPullRequest) {
      core.info(`Pull request detected, using head SHA: ${sha}`)
      core.info(`Pull request detected, using head ref: ${ref}`)
    }
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

    if (!sha || !ref) {
      throw new Error(
        'GITHUB_SHA and GITHUB_REF environment variables are required'
      )
    }

    core.info('🚀 Azure Pipelines Dependency Submission')
    core.info(`Repository: ${repository}`)
    core.info(`SHA: ${sha}`)
    core.info(`Ref: ${ref}`)
    core.info(`Azure DevOps URL: ${azureDevOpsUrl}`)

    // Step 1: Fetch installed tasks from Azure DevOps
    core.startGroup('📦 Fetching installed tasks from Azure DevOps')
    const azureDevOpsClient = new AzureDevOpsClient(
      azureDevOpsUrl,
      azureDevOpsToken
    )
    const taskMap = await azureDevOpsClient.getInstalledTasks()
    core.endGroup()

    // Step 2: Discover pipeline files
    core.startGroup('🔍 Discovering pipeline files')
    const fileDiscovery = new PipelineFileDiscovery(workspace)
    const pipelineFiles = await fileDiscovery.findPipelineFiles(pipelinePaths)

    if (pipelineFiles.length === 0) {
      core.warning('⚠️  No pipeline files found')
      core.setOutput('dependency-count', 0)
      return
    }

    core.info(`Found ${pipelineFiles.length} pipeline file(s):`)
    for (const file of pipelineFiles) {
      core.info(`  - ${file}`)
    }
    core.endGroup()

    // Step 3: Parse pipelines and resolve templates
    core.startGroup('📝 Parsing pipelines and resolving templates')
    const templateResolver = new TemplateResolver(workspace, resolveTemplates)
    const allTasks = []

    for (const pipelineFile of pipelineFiles) {
      core.info(`Processing: ${pipelineFile}`)
      const resolved = await templateResolver.resolvePipeline(pipelineFile)
      core.info(`  Found ${resolved.tasks.length} task(s)`)
      core.info(`  Processed ${resolved.processedFiles.size} file(s)`)
      allTasks.push(...resolved.tasks)
    }

    core.info(`Total tasks found: ${allTasks.length}`)
    core.endGroup()

    if (allTasks.length === 0) {
      core.warning('⚠️  No tasks found in pipeline files')
      core.setOutput('dependency-count', 0)
      return
    }

    // Step 4: Map tasks to dependencies
    core.startGroup('🗺️  Mapping tasks to dependencies')
    const dependencyMapper = new DependencyMapper(taskMap)

    // Create a single snapshot with all dependencies
    const snapshot = dependencyMapper.createSnapshot(
      allTasks,
      'azure-pipelines',
      github.context.job || 'dependency-submission',
      sha
    )

    const dependencyCount = DependencySubmitter.countDependencies(snapshot)
    core.info(`Mapped ${dependencyCount} unique dependencies`)
    core.endGroup()

    // Step 5: Submit to GitHub Dependency Graph
    core.startGroup('📤 Submitting to GitHub Dependency Graph')
    const submitter = new DependencySubmitter(token, repository)
    await submitter.submitSnapshot(snapshot, sha, ref)
    core.endGroup()

    core.info('✅ Dependency submission completed successfully')
    core.setOutput('dependency-count', dependencyCount)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}

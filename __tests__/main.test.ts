/**
 * Unit tests for the action's main functionality, src/main.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

const mockGetInstalledTasks = jest.fn()
const mockFetchExtensionMetadata = jest.fn()
const mockFindPipelineFiles = jest.fn()
const mockResolvePipeline = jest.fn()
const mockFindBuildDefinitionsForFile = jest.fn()
const mockPreviewPipeline = jest.fn()
const mockGetMarketplaceExtensionKeys = jest.fn()
const mockCreateSnapshot = jest.fn()
const mockSubmitSnapshot = jest.fn()
const mockCountDependencies = jest.fn()

// Mock all dependencies
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => ({
  context: {
    job: 'test-job',
    sha: 'abc123',
    ref: 'refs/heads/main',
    eventName: 'push',
    payload: {}
  },
  getOctokit: jest.fn()
}))
jest.unstable_mockModule('azure-devops-node-api', () => ({
  getPersonalAccessTokenHandler: jest.fn(() => ({})),
  WebApi: jest.fn(() => ({
    getTaskAgentApi: jest.fn(() =>
      Promise.resolve({
        getTaskDefinitions: jest.fn(() => Promise.resolve([]))
      })
    )
  }))
}))
jest.unstable_mockModule('azure-devops-node-api/TaskAgentApi', () => ({}))
const AzureDevOpsClientMock = jest.fn().mockImplementation(() => ({
  getInstalledTasks: mockGetInstalledTasks,
  fetchExtensionMetadata: mockFetchExtensionMetadata
}))
jest.unstable_mockModule('../src/azure-devops-client.js', () => ({
  AzureDevOpsClient: AzureDevOpsClientMock
}))
const PipelineFileDiscoveryMock = jest.fn().mockImplementation(() => ({
  findPipelineFiles: mockFindPipelineFiles
}))
jest.unstable_mockModule('../src/pipeline-file-discovery.js', () => ({
  PipelineFileDiscovery: PipelineFileDiscoveryMock
}))
const TemplateResolverMock = jest.fn().mockImplementation(() => ({
  resolvePipeline: mockResolvePipeline
}))
jest.unstable_mockModule('../src/template-resolver.js', () => ({
  TemplateResolver: TemplateResolverMock
}))
const PreviewApiResolverMock = jest.fn().mockImplementation(() => ({
  findBuildDefinitionsForFile: mockFindBuildDefinitionsForFile,
  previewPipeline: mockPreviewPipeline
}))
jest.unstable_mockModule('../src/preview-api-resolver.js', () => ({
  PreviewApiResolver: PreviewApiResolverMock
}))
const DependencyMapperMock = jest.fn().mockImplementation(() => ({
  getMarketplaceExtensionKeys: mockGetMarketplaceExtensionKeys,
  createSnapshot: mockCreateSnapshot
}))
jest.unstable_mockModule('../src/dependency-mapper.js', () => ({
  DependencyMapper: DependencyMapperMock
}))
const DependencySubmitterMock = jest.fn().mockImplementation(() => ({
  submitSnapshot: mockSubmitSnapshot
}))
DependencySubmitterMock.countDependencies = mockCountDependencies
jest.unstable_mockModule('../src/dependency-submitter.js', () => ({
  DependencySubmitter: DependencySubmitterMock
}))

const { run } = await import('../src/main.js')

describe('main.ts', () => {
  let inputs: Record<string, string>

  beforeEach(() => {
    jest.clearAllMocks()

    // Set required environment variables
    process.env.GITHUB_SHA = 'abc123'
    process.env.GITHUB_REF = 'refs/heads/main'
    process.env.GITHUB_REPOSITORY = 'owner/repo'
    process.env.GITHUB_WORKSPACE = '/test/workspace'

    inputs = {
      'github-token': 'fake-github-token',
      'github-readonly-token': '',
      repository: 'owner/repo',
      'azure-devops-url': 'https://dev.azure.com/myorg',
      'azure-devops-token': 'fake-azure-token',
      'pipeline-paths': '',
      'resolve-templates': 'true',
      'parse-templates-by': 'action',
      'azure-devops-project': ''
    }

    // Mock inputs with default values
    core.getInput.mockImplementation((name: string) => {
      return inputs[name] || ''
    })

    core.getBooleanInput.mockImplementation((name: string) => {
      return name === 'resolve-templates'
    })

    mockGetInstalledTasks.mockResolvedValue(new Map())
    mockFetchExtensionMetadata.mockResolvedValue(new Map())
    mockFindPipelineFiles.mockResolvedValue(['pipeline.yml'])
    mockFindBuildDefinitionsForFile.mockResolvedValue([])
    mockPreviewPipeline.mockResolvedValue([
      { taskIdentifier: 'ServerTask', taskVersion: '1.0.0' }
    ])
    mockResolvePipeline.mockResolvedValue({
      tasks: [{ taskIdentifier: 'FallbackTask', taskVersion: '2.0.0' }],
      processedFiles: new Set(['pipeline.yml'])
    })
    mockGetMarketplaceExtensionKeys.mockReturnValue(new Set())
    mockCreateSnapshot.mockReturnValue({ snapshot: true })
    mockSubmitSnapshot.mockResolvedValue(undefined)
    mockCountDependencies.mockReturnValue(1)
  })

  it('uses server-side parsing when parse-templates-by is server', async () => {
    inputs['parse-templates-by'] = 'server'
    const serverTasks = [{ taskIdentifier: 'ServerTask', taskVersion: '3.1.4' }]
    mockFindBuildDefinitionsForFile.mockResolvedValue([
      { project: 'Sample', definitionId: 42, name: 'CI' }
    ])
    mockPreviewPipeline.mockResolvedValue(serverTasks)

    await run()

    expect(PreviewApiResolverMock).toHaveBeenCalledWith(
      'https://dev.azure.com/myorg',
      'fake-azure-token',
      undefined
    )
    expect(mockFindBuildDefinitionsForFile).toHaveBeenCalledWith(
      'pipeline.yml',
      '/test/workspace'
    )
    expect(mockPreviewPipeline).toHaveBeenCalledWith('Sample', 42)
    expect(TemplateResolverMock).not.toHaveBeenCalled()
    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      serverTasks,
      'azure-pipelines',
      'test-job'
    )
    expect(mockSubmitSnapshot).toHaveBeenCalledWith(
      { snapshot: true },
      'abc123',
      'refs/heads/main'
    )
  })

  it('falls back to action parsing when no server definitions are found', async () => {
    inputs['parse-templates-by'] = 'server'
    const fallbackTasks = [
      { taskIdentifier: 'FallbackTask', taskVersion: '2.0.0' }
    ]
    mockResolvePipeline.mockResolvedValue({
      tasks: fallbackTasks,
      processedFiles: new Set(['pipeline.yml'])
    })

    await run()

    expect(mockFindBuildDefinitionsForFile).toHaveBeenCalled()
    expect(mockPreviewPipeline).not.toHaveBeenCalled()
    expect(TemplateResolverMock).toHaveBeenCalledWith(
      '/test/workspace',
      true,
      'fake-github-token'
    )
    expect(mockResolvePipeline).toHaveBeenCalledWith('pipeline.yml')
    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      fallbackTasks,
      'azure-pipelines',
      'test-job'
    )
  })

  it('falls back to action parsing when server preview returns no tasks', async () => {
    inputs['parse-templates-by'] = 'server'
    const fallbackTasks = [
      { taskIdentifier: 'FallbackTask', taskVersion: '2.0.0' }
    ]
    mockFindBuildDefinitionsForFile.mockResolvedValue([
      { project: 'Sample', definitionId: 42, name: 'CI' }
    ])
    mockPreviewPipeline.mockResolvedValue([])
    mockResolvePipeline.mockResolvedValue({
      tasks: fallbackTasks,
      processedFiles: new Set(['pipeline.yml'])
    })

    await run()

    expect(mockPreviewPipeline).toHaveBeenCalledWith('Sample', 42)
    expect(TemplateResolverMock).toHaveBeenCalledTimes(1)
    expect(mockResolvePipeline).toHaveBeenCalledWith('pipeline.yml')
    expect(mockCreateSnapshot).toHaveBeenCalledWith(
      fallbackTasks,
      'azure-pipelines',
      'test-job'
    )
  })

  it('Handles errors gracefully', async () => {
    core.getInput.mockImplementation(() => {
      throw new Error('Test error')
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('Test error')
  })
})

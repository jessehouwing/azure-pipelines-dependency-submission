/**
 * Unit tests for the pipeline parser
 */
import { jest } from '@jest/globals'
import fs from 'fs'

// Create a mock readFileSync function
const mockReadFileSync = jest.fn()
const mockExistsSync = jest.fn(() => true)

// Mock the fs module with all needed exports
jest.unstable_mockModule('fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
  constants: fs.constants,
  promises: fs.promises,
  default: {
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
    constants: fs.constants,
    promises: fs.promises
  }
}))

const { PipelineParser } = await import('../src/pipeline-parser.js')

describe('PipelineParser', () => {
  let parser: PipelineParser

  beforeEach(() => {
    jest.clearAllMocks()
    parser = new PipelineParser()
  })

  it('Parses a simple pipeline with tasks', async () => {
    const pipelineYaml = `
stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: '18.x'
          - task: Npm@1
            displayName: 'npm install'
            inputs:
              command: install
`
    mockReadFileSync.mockReturnValue(pipelineYaml)

    const result = await parser.parsePipelineFile('/test/azure-pipelines.yml')

    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0].taskIdentifier).toBe('NodeTool')
    expect(result.tasks[0].taskVersion).toBe('0')
    expect(result.tasks[1].taskIdentifier).toBe('Npm')
    expect(result.tasks[1].taskVersion).toBe('1')
    expect(result.tasks[1].displayName).toBe('npm install')
  })

  it('Parses tasks without version', async () => {
    const pipelineYaml = `
steps:
  - task: MyTask
    inputs:
      param: value
`
    mockReadFileSync.mockReturnValue(pipelineYaml)

    const result = await parser.parsePipelineFile('/test/azure-pipelines.yml')

    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].taskIdentifier).toBe('MyTask')
    expect(result.tasks[0].taskVersion).toBeUndefined()
  })

  it('Extracts template references', async () => {
    const pipelineYaml = `
stages:
  - stage: Build
    jobs:
      - template: templates/build-job.yml
      - template: templates/test-job.yml
        parameters:
          config: Release
`
    mockReadFileSync.mockReturnValue(pipelineYaml)

    const result = await parser.parsePipelineFile('/test/azure-pipelines.yml')

    expect(result.templates).toHaveLength(2)
    expect(result.templates[0].path).toBe('templates/build-job.yml')
    expect(result.templates[1].path).toBe('templates/test-job.yml')
  })

  it('Extracts extends template', async () => {
    const pipelineYaml = `
extends:
  template: templates/base-pipeline.yml
  parameters:
    buildConfig: Release
`
    mockReadFileSync.mockReturnValue(pipelineYaml)

    const result = await parser.parsePipelineFile('/test/azure-pipelines.yml')

    expect(result.extends).toBeDefined()
    expect(result.extends?.path).toBe('templates/base-pipeline.yml')
  })

  it('Handles complex nested structures', async () => {
    const pipelineYaml = `
stages:
  - stage: Build
    jobs:
      - deployment: DeployApp
        strategy:
          runOnce:
            deploy:
              steps:
                - task: AzureWebApp@1
                  inputs:
                    appName: myapp
        on:
          success:
            steps:
              - task: PublishTestResults@2
          failure:
            steps:
              - task: SendNotification@1
`
    mockReadFileSync.mockReturnValue(pipelineYaml)

    const result = await parser.parsePipelineFile('/test/azure-pipelines.yml')

    // Should find at least some tasks from the nested structure
    expect(result.tasks.length).toBeGreaterThanOrEqual(1)
    const taskIds = result.tasks.map((t) => t.taskIdentifier)
    // At least one of these should be found
    const hasExpectedTask =
      taskIds.includes('AzureWebApp') ||
      taskIds.includes('PublishTestResults') ||
      taskIds.includes('SendNotification')
    expect(hasExpectedTask).toBe(true)
  })

  it('Handles parsing errors gracefully', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('File read error')
    })

    await expect(parser.parsePipelineFile('/test/invalid.yml')).rejects.toThrow(
      'Failed to parse'
    )
  })

  it('Identifies pipeline files correctly', () => {
    mockReadFileSync.mockReturnValue(`
trigger:
  - main
stages:
  - stage: Build
pool:
  vmImage: ubuntu-latest
`)

    expect(PipelineParser.isPipelineFile('/test/file.yml')).toBe(true)
  })

  it('Rejects non-pipeline files', () => {
    mockReadFileSync.mockReturnValue(`
someKey: value
anotherKey:
  nested: data
`)

    expect(PipelineParser.isPipelineFile('/test/file.yml')).toBe(false)
  })
})

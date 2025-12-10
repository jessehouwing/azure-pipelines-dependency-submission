import { TemplateResolver } from '../src/template-resolver'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('TemplateResolver', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = path.join(__dirname, 'temp-test-template')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('Resolves pipeline with tasks', async () => {
    const pipelineContent = `
steps:
- task: PowerShell@2
  inputs:
    targetType: inline
    script: echo "Hello"
`
    const pipelineFile = path.join(tempDir, 'azure-pipelines.yml')
    fs.writeFileSync(pipelineFile, pipelineContent)

    const resolver = new TemplateResolver(tempDir)
    const result = await resolver.resolvePipeline(pipelineFile)

    expect(result.tasks.length).toBe(1)
    expect(result.tasks[0].taskIdentifier).toBe('PowerShell')
    expect(result.tasks[0].taskVersion).toBe('2')
  })

  it('Resolves local templates', async () => {
    const templateContent = `
steps:
- task: NodeTool@0
  inputs:
    versionSpec: '18.x'
`
    const templateDir = path.join(tempDir, 'templates')
    fs.mkdirSync(templateDir, { recursive: true })
    fs.writeFileSync(path.join(templateDir, 'steps.yml'), templateContent)

    const pipelineContent = `
steps:
- template: templates/steps.yml
`
    const pipelineFile = path.join(tempDir, 'azure-pipelines.yml')
    fs.writeFileSync(pipelineFile, pipelineContent)

    const resolver = new TemplateResolver(tempDir, true)
    const result = await resolver.resolvePipeline(pipelineFile)

    expect(result.tasks.length).toBe(1)
    expect(result.tasks[0].taskIdentifier).toBe('NodeTool')
  })

  it('Resolves extends templates', async () => {
    const baseTemplate = `
steps:
- task: Npm@1
  inputs:
    command: install
`
    const templateDir = path.join(tempDir, 'templates')
    fs.mkdirSync(templateDir, { recursive: true })
    fs.writeFileSync(path.join(templateDir, 'base.yml'), baseTemplate)

    const pipelineContent = `
extends:
  template: templates/base.yml
`
    const pipelineFile = path.join(tempDir, 'azure-pipelines.yml')
    fs.writeFileSync(pipelineFile, pipelineContent)

    const resolver = new TemplateResolver(tempDir, true)
    const result = await resolver.resolvePipeline(pipelineFile)

    expect(result.tasks.length).toBe(1)
    expect(result.tasks[0].taskIdentifier).toBe('Npm')
  })

  it('Skips template resolution when disabled', async () => {
    const templateContent = `
steps:
- task: NodeTool@0
`
    const templateDir = path.join(tempDir, 'templates')
    fs.mkdirSync(templateDir, { recursive: true })
    fs.writeFileSync(path.join(templateDir, 'steps.yml'), templateContent)

    const pipelineContent = `
steps:
- task: PowerShell@2
- template: templates/steps.yml
`
    const pipelineFile = path.join(tempDir, 'azure-pipelines.yml')
    fs.writeFileSync(pipelineFile, pipelineContent)

    const resolver = new TemplateResolver(tempDir, false)
    const result = await resolver.resolvePipeline(pipelineFile)

    expect(result.tasks.length).toBe(1)
    expect(result.tasks[0].taskIdentifier).toBe('PowerShell')
  })

  it('Handles missing template files gracefully', async () => {
    const pipelineContent = `
steps:
- template: nonexistent.yml
`
    const pipelineFile = path.join(tempDir, 'azure-pipelines.yml')
    fs.writeFileSync(pipelineFile, pipelineContent)

    const resolver = new TemplateResolver(tempDir, true)
    const result = await resolver.resolvePipeline(pipelineFile)

    expect(result.tasks.length).toBe(0)
  })

  it('Avoids circular template references', async () => {
    const template1 = `
steps:
- task: PowerShell@2
- template: template2.yml
`
    const template2 = `
steps:
- template: template1.yml
`
    fs.writeFileSync(path.join(tempDir, 'template1.yml'), template1)
    fs.writeFileSync(path.join(tempDir, 'template2.yml'), template2)

    const resolver = new TemplateResolver(tempDir, true)
    const result = await resolver.resolvePipeline(
      path.join(tempDir, 'template1.yml')
    )

    // Should process template1 once and skip the circular reference
    expect(result.tasks.length).toBe(1)
    expect(result.processedFiles.size).toBe(2)
  })

  it('Tracks processed files', async () => {
    const templateContent = `
steps:
- task: Npm@1
`
    fs.writeFileSync(path.join(tempDir, 'template.yml'), templateContent)

    const pipelineContent = `
steps:
- task: PowerShell@2
- template: template.yml
`
    const pipelineFile = path.join(tempDir, 'azure-pipelines.yml')
    fs.writeFileSync(pipelineFile, pipelineContent)

    const resolver = new TemplateResolver(tempDir, true)
    const result = await resolver.resolvePipeline(pipelineFile)

    expect(result.processedFiles.size).toBe(2)
    expect(result.processedFiles.has(pipelineFile)).toBe(true)
  })

  it('Returns empty external templates when not using GitHub token', async () => {
    const pipelineContent = `
steps:
- task: PowerShell@2
`
    const pipelineFile = path.join(tempDir, 'azure-pipelines.yml')
    fs.writeFileSync(pipelineFile, pipelineContent)

    const resolver = new TemplateResolver(tempDir, true)
    const result = await resolver.resolvePipeline(pipelineFile)

    expect(result.externalTemplates).toEqual([])
  })
})

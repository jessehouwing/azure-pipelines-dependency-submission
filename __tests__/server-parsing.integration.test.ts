import { describe, it, expect } from '@jest/globals'
import path from 'path'
import { PreviewApiResolver } from '../src/preview-api-resolver.js'

const orgUrl = process.env.INPUT_AZURE_DEVOPS_URL
const token = process.env.INPUT_AZURE_DEVOPS_TOKEN
const project =
  process.env.INPUT_AZURE_DEVOPS_PROJECT || 'vsts-extension-tasks-test'
const knownDefinitionId = Number(
  process.env.INPUT_AZURE_DEVOPS_DEFINITION_ID || '48'
)

const hasIntegrationCreds = Boolean(orgUrl && token)
const integrationDescribe = hasIntegrationCreds ? describe : describe.skip

integrationDescribe('Server-side template parsing (integration)', () => {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
  const pipelinePath = path.join(workspace, 'azure-pipelines.yml')

  it('finds build definitions referencing azure-pipelines.yml', async () => {
    if (!orgUrl || !token) {
      throw new Error('Integration credentials are required for this test')
    }

    const resolver = new PreviewApiResolver(orgUrl, token, project)
    const definitions = await resolver.findBuildDefinitionsForFile(
      pipelinePath,
      workspace
    )

    expect(definitions.length).toBeGreaterThan(0)

    const expectedDefinition = definitions.find(
      (def) => def.definitionId === knownDefinitionId
    )

    expect(expectedDefinition).toBeDefined()
    expect(expectedDefinition?.project).toBe(project)
    expect(expectedDefinition?.name).toContain('azure-pipelines-demo-ping-task')
  }, 60000)

  it('expands pipelines via the Azure DevOps Preview API', async () => {
    if (!orgUrl || !token) {
      throw new Error('Integration credentials are required for this test')
    }

    const resolver = new PreviewApiResolver(orgUrl, token, project)

    const definitions = await resolver.findBuildDefinitionsForFile(
      pipelinePath,
      workspace
    )

    expect(definitions.length).toBeGreaterThan(0)

    const definition =
      definitions.find((def) => def.definitionId === knownDefinitionId) ??
      definitions[0]

    expect(definition.project).toBe(project)

    const tasks = await resolver.previewPipeline(
      definition.project,
      definition.definitionId
    )

    expect(tasks.length).toBeGreaterThanOrEqual(3)

    const installerTask = tasks.find(
      (task) => task.inputs?.version === 'builtin'
    )
    expect(installerTask).toBeDefined()

    const versionTask = tasks.find(
      (task) => task.inputs?.publisherId === 'jessehouwing'
    )
    expect(versionTask?.inputs?.extensionId).toBeDefined()

    const powershellTask = tasks.find((task) => {
      const script = task.inputs?.script
      return (
        typeof script === 'string' && script.includes('Q.Extension.Version')
      )
    })
    expect(powershellTask).toBeDefined()
  }, 60000)
})

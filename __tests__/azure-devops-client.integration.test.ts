import { describe, it, expect } from '@jest/globals'
import { AzureDevOpsClient } from '../src/azure-devops-client.js'

const orgUrl = process.env.INPUT_AZURE_DEVOPS_URL
const token = process.env.INPUT_AZURE_DEVOPS_TOKEN
const hasIntegrationCreds = Boolean(orgUrl && token)

const integrationDescribe = hasIntegrationCreds ? describe : describe.skip

integrationDescribe('AzureDevOpsClient (integration)', () => {
  it('fetches repository metadata for marketplace extensions', async () => {
    if (!orgUrl || !token) {
      throw new Error('Integration credentials are required for this test')
    }

    const client = new AzureDevOpsClient(orgUrl, token)
    const metadata = await client.getExtensionMetadata(
      'jessehouwing',
      'vsts-developer-tools-build-tasks-dev'
    )

    expect(metadata.repositoryUrl).toBe(
      'https://github.com/Microsoft/azure-devops-extension-tasks'
    )
  }, 30000)
})

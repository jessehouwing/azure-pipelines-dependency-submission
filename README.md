# Azure Pipelines Dependency Submission

[![CI](https://github.com/jessehouwing/azure-pipelines-dependency-submission/actions/workflows/ci.yml/badge.svg)](https://github.com/jessehouwing/azure-pipelines-dependency-submission/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jessehouwing/azure-pipelines-dependency-submission/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/jessehouwing/azure-pipelines-dependency-submission/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

Submit Azure Pipelines task dependencies to GitHub Dependency Graph for
vulnerability scanning and Dependabot alerts.

## Features

- 🔍 **Automatic Discovery**: Detects `azure-pipelines.yml/yaml` and
  `.azure-pipelines/*.yml/yaml` files automatically
- 🌐 **Glob Pattern Support**: Use glob patterns to specify custom pipeline file
  locations
- 🔗 **Template Resolution**: Resolves and includes tasks from pipeline
  templates
- 🔐 **Azure DevOps Integration**: Uses the Azure DevOps API to resolve task
  names/GUIDs to full identifiers with versions
- 📊 **Dependency Graph**: Submits dependencies to GitHub's Dependency Graph for
  vulnerability scanning
- 🔔 **Dependabot Integration**: Get automated security alerts for vulnerable
  Azure Pipelines tasks

## Usage

### Basic Example

```yaml
name: Submit Azure Pipelines Dependencies
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: write # Required for dependency submission

jobs:
  submit-dependencies:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Submit Azure Pipelines Dependencies
        uses: jessehouwing/azure-pipelines-dependency-submission@v1
        with:
          azure-devops-url: https://dev.azure.com/myorg
          azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
```

### Advanced Example with Custom Paths

```yaml
- name: Submit Azure Pipelines Dependencies
  uses: jessehouwing/azure-pipelines-dependency-submission@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    azure-devops-url: https://dev.azure.com/myorg
    azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
    pipeline-paths: |
      pipelines/**/*.yml
      .azuredevops/*.yaml
      custom-pipeline.yml
    resolve-templates: true
```

### PAT-Free Authentication with Microsoft Entra ID

You can pass a short-lived Microsoft Entra access token to `azure-devops-token`
instead of storing an Azure DevOps PAT. Use GitHub OIDC to sign in to Azure,
then request a token for the Azure DevOps resource
`499b84ac-1321-427f-aa17-267ca6975798`. The existing PAT examples remain
supported; no action input or authentication-handler change is needed.

Before using this example:

- Configure a Microsoft Entra application and service principal in the tenant
  connected to your Azure DevOps organization. Add a federated credential that
  trusts only this GitHub repository and its `main` branch, using the
  repository's actual OIDC subject and audience `api://AzureADTokenExchange`.
  See
  [GitHub's Azure OIDC setup guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure).
- Explicitly add the service principal to your Azure DevOps organization. Grant
  the minimum access level and Azure DevOps permissions needed to read installed
  task definitions and any projects/build definitions used by server-side
  parsing. Azure subscription roles and Entra API permissions do not grant Azure
  DevOps access. See
  [Azure DevOps service-principal setup](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/service-principal-managed-identity?view=azure-devops).
- Set the GitHub Actions repository variables `AZURE_CLIENT_ID` and
  `AZURE_TENANT_ID` to the application's client ID and tenant ID. These IDs are
  not credentials. This example does not need an Azure subscription, client
  secret, or Azure DevOps PAT.

```yaml
name: Submit Azure Pipelines Dependencies without a PAT
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  submit-dependencies:
    if: github.ref == 'refs/heads/main' && github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
    permissions:
      contents: write # Required for dependency submission
      id-token: write # Required for Azure OIDC login
    steps:
      - name: Checkout
        uses: actions/checkout@v7.0.1
        with:
          persist-credentials: false

      - name: Sign in to Azure with OIDC
        uses: azure/login@v3.1.0
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          allow-no-subscriptions: true

      - name: Get a short-lived Azure DevOps token
        id: azure-devops-token
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          $token = az account get-access-token `
            --resource 499b84ac-1321-427f-aa17-267ca6975798 `
            --query accessToken --output tsv --only-show-errors
          if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
            throw 'Could not acquire an Azure DevOps access token'
          }
          Write-Host "::add-mask::$token"
          "token=$token" >> $env:GITHUB_OUTPUT

      - name: Submit Azure Pipelines Dependencies
        uses: jessehouwing/azure-pipelines-dependency-submission@v1
        with:
          azure-devops-url: https://dev.azure.com/myorg
          azure-devops-token: ${{ steps.azure-devops-token.outputs.token }}
```

The token is masked before it is passed between steps. Acquire it immediately
before the action; it expires and the action does not refresh it. The
`id-token: write` permission enables token acquisition, not Azure DevOps
authorization. The GitHub token still needs `contents: write` to submit the
dependency snapshot.

Run this workflow only on trusted refs. Fork and Dependabot pull-request
workflows have restricted permissions; removing the PAT does not bypass GitHub
token restrictions or your Entra federation policy. This example deliberately
avoids `pull_request` and skips Dependabot-triggered runs. Do not use
`pull_request_target` to run untrusted pull-request code with this identity.

**Verified scope:** With v1.0.14's `azure-devops-node-api@17.0.1` and
`typed-rest-client@3.1.2`, a live Azure CLI Entra token worked through the
existing PAT handler: it authenticated as the same user and returned the same
400 installed task definitions as an explicit Bearer handler. The PAT handler
sends Basic authentication; Azure DevOps accepted the Entra token in that
credential field, without JWT autodetection. This read-only test did not
validate the complete OIDC workflow, service-principal permissions, Marketplace
metadata endpoints, or server-side preview parsing. Verify those paths for your
identity before adopting them.

## Inputs

| Input                   | Required | Default                    | Description                                                                                                                                                                            |
| ----------------------- | -------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-token`          | No       | `${{ github.token }}`      | GitHub token with `contents:write` permission for dependency submission                                                                                                                |
| `github-readonly-token` | No       | `''`                       | GitHub token with `contents:read` permission for accessing private repositories when resolving templates. Falls back to `github-token` if not provided                                 |
| `repository`            | No       | `${{ github.repository }}` | Repository to submit dependencies for (owner/repo format)                                                                                                                              |
| `azure-devops-url`      | Yes      | -                          | Azure DevOps organization URL (e.g., `https://dev.azure.com/myorg`)                                                                                                                    |
| `azure-devops-token`    | Yes      | -                          | Azure DevOps PAT with **Agent Pools: Read**, **Build: Read**, and **Marketplace: Read** scopes, or a short-lived Microsoft Entra access token with equivalent Azure DevOps permissions |
| `pipeline-paths`        | No       | `''`                       | Comma-separated or newline-separated list of glob patterns for pipeline files. Defaults to `azure-pipelines.yml`, `azure-pipelines.yaml`, and `.azure-pipelines/*.yml`                 |
| `resolve-templates`     | No       | `true`                     | Whether to resolve and include dependencies from pipeline templates                                                                                                                    |
| `parse-templates-by`    | No       | `action`                   | How to parse templates: `action` (local parsing) or `server` (Azure DevOps API). Server mode is slower but more accurate                                                               |
| `azure-devops-project`  | No       | `''`                       | Azure DevOps project name when using `server` mode. If not specified, queries all accessible projects                                                                                  |

## Outputs

| Output             | Description                      |
| ------------------ | -------------------------------- |
| `dependency-count` | Number of dependencies submitted |

## Azure DevOps Personal Access Token

If you prefer a Personal Access Token (PAT) instead of
[Microsoft Entra authentication](#pat-free-authentication-with-microsoft-entra-id),
create one in Azure DevOps with the following permissions:

1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Click "New Token"
3. Select the following scopes: **Agent Pools** (Read), **Build** (Read), and
   **Marketplace** (Read; required to query Azure DevOps Marketplace metadata)
4. Copy the token and add it as a repository secret in GitHub

## Permissions

The GitHub token requires the following permission:

- `contents: write` - Required to submit dependencies to the Dependency Graph

## How It Works

1. **Discovery**: The action scans your repository for Azure Pipelines files
   using the specified patterns or default locations
2. **Parsing**: Each pipeline file is parsed to extract task references,
   including tasks in templates
3. **Resolution**: Task names and GUIDs are resolved to full identifiers (e.g.,
   `Microsoft.VisualStudio.Services.Cloud.TaskName`) using the Azure DevOps API
4. **Submission**: Dependencies are submitted to GitHub's Dependency Graph in
   [Package URL (purl)](https://github.com/package-url/purl-spec) format
5. **Monitoring**: GitHub's Dependabot monitors for vulnerabilities and creates
   alerts

## Example Pipeline Detection

The action automatically detects:

- `azure-pipelines.yml`
- `azure-pipelines.yaml`
- `.azure-pipelines/*.yml`
- `.azure-pipelines/*.yaml`

Or use custom glob patterns:

```yaml
pipeline-paths: |
  build/**/*.yml
  deploy/*.yaml
  **/azure-*.yml
```

## Template Resolution

When `resolve-templates: true` (default), the action follows template references
and includes tasks from:

- `extends` templates
- Step templates
- Job templates
- Stage templates

Example:

```yaml
# azure-pipelines.yml
extends:
  template: templates/base.yml

# templates/base.yml
steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '18.x'
```

Both the main pipeline and template tasks are included as dependencies.

## Advanced: Server-Side Template Parsing

For more accurate dependency resolution, you can enable server-side parsing:

```yaml
- name: Submit Azure Pipelines Dependencies
  uses: jessehouwing/azure-pipelines-dependency-submission@v1
  with:
    azure-devops-url: https://dev.azure.com/myorg
    azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
    azure-devops-project: MyProject
    parse-templates-by: server
```

### Why Use Server-Side Parsing?

Server-side parsing provides more accurate results by:

- **Expanding Templates**: Fully resolves all template references, including
  nested templates
- **Applying Decorators**: Captures tasks injected by pipeline decorators
  installed in your organization
- **Accurate Task Versions**: Uses the exact task versions that would run in a
  real pipeline execution

### How Server-Side Parsing Works

1. **Find Build Definitions**: Queries Azure DevOps to find build definitions
   that reference your pipeline files (only GitHub-backed definitions)
2. **Preview Run**: Calls the Azure DevOps Preview Run API for each definition
   to expand templates and apply decorators
3. **Extract Tasks**: Parses the expanded pipeline to extract all tasks that
   would actually execute

### Performance Considerations

Server-side parsing is slower than action-side parsing because it:

- Makes additional API calls to query build definitions
- Calls the Preview Run API for each matching definition
- Processes the expanded pipeline results

**Recommendation**: Use server-side parsing in scheduled workflows rather than
on every push/PR for better performance.

### Fallback Behavior

If no build definitions are found for a pipeline file, the action automatically
falls back to action-side parsing for that file.

## Limitations

- Templates from external repositories are not currently resolved
- Only tasks are tracked as dependencies (not other resources)
- Requires access to the Azure DevOps organization to resolve task metadata

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Related Projects

- [actions-dependency-submission](https://github.com/jessehouwing/actions-dependency-submission) -
  Submit GitHub Actions dependencies

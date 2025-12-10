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
    token: ${{ secrets.GITHUB_TOKEN }}
    azure-devops-url: https://dev.azure.com/myorg
    azure-devops-token: ${{ secrets.AZURE_DEVOPS_PAT }}
    pipeline-paths: |
      pipelines/**/*.yml
      .azuredevops/*.yaml
      custom-pipeline.yml
    resolve-templates: true
```

## Inputs

| Input                  | Required | Default                    | Description                                                                                                                                                            |
| ---------------------- | -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`                | No       | `${{ github.token }}`      | GitHub token with `contents:write` permission for dependency submission                                                                                                |
| `github-token`         | No       | `''`                       | GitHub token with `contents:read` permission for accessing private repositories when resolving templates. Falls back to `token` if not provided                        |
| `repository`           | No       | `${{ github.repository }}` | Repository to submit dependencies for (owner/repo format)                                                                                                              |
| `azure-devops-url`     | Yes      | -                          | Azure DevOps organization URL (e.g., `https://dev.azure.com/myorg`)                                                                                                    |
| `azure-devops-token`   | Yes      | -                          | Azure DevOps Personal Access Token with **Agent Pools: Read** and **Build: Read** permissions                                                                          |
| `pipeline-paths`       | No       | `''`                       | Comma-separated or newline-separated list of glob patterns for pipeline files. Defaults to `azure-pipelines.yml`, `azure-pipelines.yaml`, and `.azure-pipelines/*.yml` |
| `resolve-templates`    | No       | `true`                     | Whether to resolve and include dependencies from pipeline templates                                                                                                    |
| `parse-templates-by`   | No       | `action`                   | How to parse templates: `action` (local parsing) or `server` (Azure DevOps API). Server mode is slower but more accurate                                               |
| `azure-devops-project` | No       | `''`                       | Azure DevOps project name when using `server` mode. If not specified, queries all accessible projects                                                                  |

## Outputs

| Output             | Description                      |
| ------------------ | -------------------------------- |
| `dependency-count` | Number of dependencies submitted |

## Azure DevOps Personal Access Token

To use this action, you need to create a Personal Access Token (PAT) in Azure
DevOps with the following permissions:

1. Go to Azure DevOps → User Settings → Personal Access Tokens
2. Click "New Token"
3. Select the following scopes:
   - **Agent Pools**: Read
   - **Build**: Read
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

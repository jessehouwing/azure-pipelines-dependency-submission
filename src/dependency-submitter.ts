import * as core from '@actions/core'
import * as github from '@actions/github'
import { DependencySnapshot } from './dependency-mapper.js'

/**
 * Submit dependencies to GitHub Dependency Graph
 */
export class DependencySubmitter {
  private readonly octokit: ReturnType<typeof github.getOctokit>
  private readonly owner: string
  private readonly repo: string

  constructor(token: string, repository: string) {
    this.octokit = github.getOctokit(token)

    const [owner, repo] = repository.split('/')
    if (!owner || !repo) {
      throw new Error(
        `Invalid repository format: ${repository}. Expected format: owner/repo`
      )
    }

    this.owner = owner
    this.repo = repo
  }

  /**
   * Submit a dependency snapshot to GitHub
   */
  async submitSnapshot(
    snapshot: DependencySnapshot,
    sha: string,
    ref: string
  ): Promise<void> {
    core.info(
      `Submitting dependency snapshot for ${this.owner}/${this.repo}@${sha}`
    )

    try {
      const response =
        await this.octokit.rest.dependencyGraph.createRepositorySnapshot({
          owner: this.owner,
          repo: this.repo,
          version: snapshot.version,
          job: {
            correlator: `${snapshot.detector.name}-${sha}`,
            id: sha
          },
          sha,
          ref,
          detector: snapshot.detector,
          scanned: snapshot.scanned,
          manifests: snapshot.manifests as any
        })

      if (response.status === 201) {
        core.info('✓ Dependency snapshot submitted successfully')
        core.debug(`Response: ${JSON.stringify(response.data)}`)
      } else {
        core.warning(`Unexpected response status: ${response.status}`)
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to submit dependency snapshot: ${error.message}`
        )
      }
      throw error
    }
  }

  /**
   * Count total dependencies across all manifests
   */
  static countDependencies(snapshot: DependencySnapshot): number {
    let count = 0
    for (const manifest of Object.values(snapshot.manifests)) {
      count += Object.keys(manifest.resolved).length
    }
    return count
  }
}

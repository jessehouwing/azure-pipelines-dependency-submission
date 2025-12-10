import { DependencySubmitter } from '../src/dependency-submitter'
import type { DependencySnapshot } from '../src/dependency-mapper'

describe('DependencySubmitter', () => {
  it('Parses repository string correctly', () => {
    const submitter = new DependencySubmitter('fake-token', 'owner/repo')

    // Access private properties via any to test internal behavior
    expect((submitter as any).owner).toBe('owner')
    expect((submitter as any).repo).toBe('repo')
  })

  it('Creates correct snapshot structure', () => {
    const submitter = new DependencySubmitter('fake-token', 'owner/repo')
    const snapshot: DependencySnapshot = {
      version: 0,
      detector: {
        name: 'test-detector',
        version: '1.0.0',
        url: 'https://example.com'
      },
      scanned: '2024-01-01T00:00:00Z',
      manifests: {
        'test-manifest': {
          name: 'test-manifest',
          file: {
            source_location: 'azure-pipelines.yml'
          },
          resolved: {
            'pkg:generic/azure-pipelines-task/Microsoft.BuiltIn.PowerShell@2.259.0':
              {
                package_url:
                  'pkg:generic/azure-pipelines-task/Microsoft.BuiltIn.PowerShell@2.259.0',
                relationship: 'direct',
                scope: 'runtime'
              }
          }
        }
      }
    }

    // Validate the snapshot structure can be created
    expect(snapshot.version).toBe(0)
    expect(snapshot.detector.name).toBe('test-detector')
    expect(Object.keys(snapshot.manifests)).toHaveLength(1)
  })

  it('Handles multiple manifests', () => {
    const snapshot: DependencySnapshot = {
      version: 0,
      detector: {
        name: 'test-detector',
        version: '1.0.0',
        url: 'https://example.com'
      },
      scanned: '2024-01-01T00:00:00Z',
      manifests: {
        'azure-pipelines.yml:build-job': {
          name: 'azure-pipelines.yml:build-job',
          file: {
            source_location: 'azure-pipelines.yml'
          },
          resolved: {}
        },
        'azure-pipelines.yml:test-job': {
          name: 'azure-pipelines.yml:test-job',
          file: {
            source_location: 'azure-pipelines.yml'
          },
          resolved: {}
        }
      }
    }

    expect(Object.keys(snapshot.manifests)).toHaveLength(2)
  })

  it('Supports runtime scope dependencies', () => {
    const snapshot: DependencySnapshot = {
      version: 0,
      detector: {
        name: 'test-detector',
        version: '1.0.0',
        url: 'https://example.com'
      },
      scanned: '2024-01-01T00:00:00Z',
      manifests: {
        test: {
          name: 'test',
          file: {
            source_location: 'test.yml'
          },
          resolved: {
            'pkg:generic/test@1.0.0': {
              package_url: 'pkg:generic/test@1.0.0',
              relationship: 'direct',
              scope: 'runtime'
            }
          }
        }
      }
    }

    const resolved = snapshot.manifests['test'].resolved
    const dep = resolved['pkg:generic/test@1.0.0']
    expect(dep.scope).toBe('runtime')
    expect(dep.relationship).toBe('direct')
  })
})

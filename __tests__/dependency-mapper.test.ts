/**
 * Unit tests for the dependency mapper
 */
import { DependencyMapper } from '../src/dependency-mapper.js'
import type { ParsedTask } from '../src/pipeline-parser.js'
import type { InstalledTask } from '../src/azure-devops-client.js'

describe('DependencyMapper', () => {
  let taskMap: Map<string, InstalledTask>
  let mapper: DependencyMapper

  beforeEach(() => {
    taskMap = new Map([
      [
        'task-guid-1',
        {
          id: 'task-guid-1',
          name: 'NodeTool',
          version: '0.220.0',
          fullIdentifier: 'Microsoft.BuiltIn.NodeTool',
          isBuiltIn: true,
          author: 'Microsoft Corporation'
        }
      ],
      [
        'nodetool',
        {
          id: 'task-guid-1',
          name: 'NodeTool',
          version: '0.220.0',
          fullIdentifier: 'Microsoft.BuiltIn.NodeTool',
          isBuiltIn: true,
          author: 'Microsoft Corporation'
        }
      ],
      [
        'task-guid-2',
        {
          id: 'task-guid-2',
          name: 'Npm',
          version: '1.230.0',
          fullIdentifier: 'Microsoft.BuiltIn.Npm',
          isBuiltIn: true,
          author: 'Microsoft Corporation'
        }
      ],
      [
        'npm',
        {
          id: 'task-guid-2',
          name: 'Npm',
          version: '1.230.0',
          fullIdentifier: 'Microsoft.BuiltIn.Npm',
          isBuiltIn: true,
          author: 'Microsoft Corporation'
        }
      ]
    ])

    mapper = new DependencyMapper(taskMap)
  })

  it('Creates a snapshot with dependencies', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'NodeTool', taskVersion: '0' },
      { taskIdentifier: 'Npm', taskVersion: '1' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    expect(snapshot.version).toBe(0)
    expect(snapshot.detector.name).toBe('azure-pipelines-dependency-submission')
    expect(snapshot.manifests).toBeDefined()

    const manifestKey = 'azure-pipelines.yml:test-job'
    expect(snapshot.manifests[manifestKey]).toBeDefined()

    const resolved = snapshot.manifests[manifestKey].resolved
    // 2 direct dependencies with wildcards + 2 transitive dependencies with actual versions
    expect(Object.keys(resolved)).toHaveLength(4)
  })

  it('Maps tasks to package URLs correctly', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'NodeTool', taskVersion: '0' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved
    const packageUrls = Object.keys(resolved)

    // 1 direct dependency with wildcard + 1 transitive with actual version
    expect(packageUrls).toHaveLength(2)

    const directUrl = packageUrls.find((url) => url.includes('@0.*.*'))
    expect(directUrl).toMatch(
      /pkg:generic\/azure-pipelines\/Microsoft\.BuiltIn\.NodeTool@0\.\*\.\*$/
    )

    const dependency = resolved[directUrl!]
    expect(dependency.relationship).toBe('direct')
    expect(dependency.scope).toBe('runtime')
  })

  it('Uses installed version when task version not specified', () => {
    const tasks: ParsedTask[] = [{ taskIdentifier: 'NodeTool' }]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved
    const packageUrls = Object.keys(resolved)

    expect(packageUrls[0]).toContain('@0.220.0')
  })

  it('Handles unresolved tasks gracefully', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'UnknownTask', taskVersion: '1' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved

    // Unknown task should be skipped
    expect(Object.keys(resolved)).toHaveLength(0)
  })

  it('Resolves tasks by GUID', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'task-guid-1', taskVersion: '0' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved

    // 1 direct + 1 transitive
    expect(Object.keys(resolved)).toHaveLength(2)
  })

  it('Resolves tasks case-insensitively', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'NODETOOL', taskVersion: '0' },
      { taskIdentifier: 'npm', taskVersion: '1' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved

    // 2 direct + 2 transitive
    expect(Object.keys(resolved)).toHaveLength(4)
  })

  it('Resolves fully qualified task names', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'Microsoft.BuiltIn.NodeTool', taskVersion: '0' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved

    // 1 direct + 1 transitive
    expect(Object.keys(resolved)).toHaveLength(2)
  })

  it('Resolves task by GUID at end of qualified name', () => {
    taskMap.set('task-guid-1', {
      id: 'task-guid-1',
      name: 'NodeTool',
      version: '0.220.0',
      fullIdentifier: 'Microsoft.BuiltIn.NodeTool',
      isBuiltIn: true,
      author: 'Microsoft Corporation'
    })

    const mapper = new DependencyMapper(taskMap)
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'some.publisher.task-guid-1', taskVersion: '0' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved

    // 1 direct + 1 transitive
    expect(Object.keys(resolved)).toHaveLength(2)
  })

  it('Normalizes major-only version to wildcard format', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'NodeTool', taskVersion: '5' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved
    const packageUrls = Object.keys(resolved)

    // Should have wildcard version as direct dependency
    const wildcardUrl = packageUrls.find((url) => url.includes('@5.*.*'))
    expect(wildcardUrl).toBeDefined()

    // Should have actual version as transitive dependency
    const actualUrl = packageUrls.find((url) => url.includes('@0.220.0'))
    expect(actualUrl).toBeDefined()
    expect(resolved[actualUrl!].relationship).toBe('indirect')

    // Direct dependency should reference the transitive dependency
    expect(resolved[wildcardUrl!].dependencies).toContain(actualUrl)
  })

  it('Normalizes major.minor version to wildcard format', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'NodeTool', taskVersion: '5.1' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved
    const packageUrls = Object.keys(resolved)

    // Should have wildcard version as direct dependency
    const wildcardUrl = packageUrls.find((url) => url.includes('@5.1.*'))
    expect(wildcardUrl).toBeDefined()

    // Should have actual version as transitive dependency
    const actualUrl = packageUrls.find((url) => url.includes('@0.220.0'))
    expect(actualUrl).toBeDefined()
    expect(resolved[actualUrl!].relationship).toBe('indirect')
  })

  it('Keeps full version as-is without transitive dependency', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'NodeTool', taskVersion: '5.1.2' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    const manifestKey = 'azure-pipelines.yml:test-job'
    const resolved = snapshot.manifests[manifestKey].resolved
    const packageUrls = Object.keys(resolved)

    // Should only have the direct dependency with full version
    expect(packageUrls).toHaveLength(1)
    expect(packageUrls[0]).toContain('@5.1.2')
    expect(resolved[packageUrls[0]].dependencies).toBeUndefined()
  })

  it('Deduplicates tasks by source file, identifier, and version', () => {
    const tasks: ParsedTask[] = [
      { taskIdentifier: 'NodeTool', taskVersion: '0', sourceFile: 'file1.yml' },
      { taskIdentifier: 'NodeTool', taskVersion: '0', sourceFile: 'file1.yml' }, // duplicate
      { taskIdentifier: 'NodeTool', taskVersion: '0', sourceFile: 'file2.yml' }, // different file
      { taskIdentifier: 'NodeTool', taskVersion: '1', sourceFile: 'file1.yml' } // different version
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    // Should have two manifests (one per source file)
    expect(Object.keys(snapshot.manifests)).toHaveLength(2)

    const file1Key = 'file1.yml:test-job'
    const file2Key = 'file2.yml:test-job'

    expect(snapshot.manifests[file1Key]).toBeDefined()
    expect(snapshot.manifests[file2Key]).toBeDefined()

    // file1.yml should have 2 direct dependencies (version 0 and 1) + 1 transitive (actual version shared)
    const file1Resolved = snapshot.manifests[file1Key].resolved
    const file1DirectDeps = Object.values(file1Resolved).filter(
      (d) => d.relationship === 'direct'
    )
    expect(file1DirectDeps).toHaveLength(2)

    // file2.yml should have 1 direct dependency + 1 transitive
    const file2Resolved = snapshot.manifests[file2Key].resolved
    const file2DirectDeps = Object.values(file2Resolved).filter(
      (d) => d.relationship === 'direct'
    )
    expect(file2DirectDeps).toHaveLength(1)
  })

  it('Groups tasks by source file into separate manifests', () => {
    const tasks: ParsedTask[] = [
      {
        taskIdentifier: 'NodeTool',
        taskVersion: '0',
        sourceFile: 'pipeline-a.yml'
      },
      { taskIdentifier: 'Npm', taskVersion: '1', sourceFile: 'pipeline-b.yml' }
    ]

    const snapshot = mapper.createSnapshot(
      tasks,
      'azure-pipelines.yml',
      'test-job',
      'abc123'
    )

    expect(Object.keys(snapshot.manifests)).toHaveLength(2)
    expect(snapshot.manifests['pipeline-a.yml:test-job']).toBeDefined()
    expect(snapshot.manifests['pipeline-b.yml:test-job']).toBeDefined()

    // Verify correct source_location for each manifest
    expect(
      snapshot.manifests['pipeline-a.yml:test-job'].file.source_location
    ).toBe('pipeline-a.yml')
    expect(
      snapshot.manifests['pipeline-b.yml:test-job'].file.source_location
    ).toBe('pipeline-b.yml')
  })
})

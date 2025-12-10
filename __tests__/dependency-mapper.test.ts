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
    expect(Object.keys(resolved)).toHaveLength(2)
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

    expect(packageUrls).toHaveLength(1)
    expect(packageUrls[0]).toMatch(
      /pkg:generic\/azure-pipelines-task\/Microsoft\.BuiltIn\.NodeTool@0$/
    )

    const dependency = resolved[packageUrls[0]]
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

    expect(Object.keys(resolved)).toHaveLength(1)
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

    expect(Object.keys(resolved)).toHaveLength(2)
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

    expect(Object.keys(resolved)).toHaveLength(1)
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

    expect(Object.keys(resolved)).toHaveLength(1)
  })
})

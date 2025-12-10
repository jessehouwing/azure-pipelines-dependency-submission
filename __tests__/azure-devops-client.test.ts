/**
 * Unit tests for the Azure DevOps client
 */
import { jest } from '@jest/globals'
import * as azdev from '../__fixtures__/azure-devops-node-api.js'

// Mock the azure-devops-node-api module
jest.unstable_mockModule('azure-devops-node-api', () => azdev)
jest.unstable_mockModule('azure-devops-node-api/TaskAgentApi', () => ({}))

const { AzureDevOpsClient } = await import('../src/azure-devops-client.js')

describe('AzureDevOpsClient', () => {
  let client: AzureDevOpsClient

  beforeEach(() => {
    jest.clearAllMocks()
    client = new AzureDevOpsClient('https://dev.azure.com/myorg', 'fake-token')
  })

  it('Fetches installed tasks successfully', async () => {
    const mockTasks = [
      {
        id: 'task-guid-1',
        name: 'TaskName1',
        friendlyName: 'Task Name 1',
        version: { major: 1, minor: 2, patch: 3 },
        serverOwned: true,
        author: 'Microsoft Corporation'
      },
      {
        id: 'task-guid-2',
        name: 'TaskName2',
        friendlyName: 'Task Name 2',
        version: { major: 2, minor: 0, patch: 0 },
        author: 'CustomPublisher',
        contributionIdentifier: 'CustomPublisher.Extension.TaskName2'
      }
    ]

    azdev.mockTaskAgentApi.getTaskDefinitions.mockResolvedValue(mockTasks)

    const taskMap = await client.getInstalledTasks()

    expect(taskMap.size).toBeGreaterThan(0)
    expect(taskMap.has('task-guid-1')).toBe(true)
    expect(taskMap.has('taskname1')).toBe(true)

    const task1 = taskMap.get('task-guid-1')
    expect(task1?.version).toBe('1.2.3')
    expect(task1?.fullIdentifier).toBe('Microsoft.BuiltIn.TaskName1')
    expect(task1?.isBuiltIn).toBe(true)

    const task2 = taskMap.get('task-guid-2')
    expect(task2?.fullIdentifier).toBe('CustomPublisher.Extension.TaskName2')
    expect(task2?.isBuiltIn).toBe(false)
  })

  it('Falls back to task name when no identifier available', async () => {
    const mockTasks = [
      {
        id: 'unknown-task-guid',
        name: 'UnknownTask',
        friendlyName: 'Unknown Task',
        version: { major: 1, minor: 0, patch: 0 },
        author: 'SomeAuthor',
        serverOwned: false
        // No contributionIdentifier
      }
    ]

    azdev.mockTaskAgentApi.getTaskDefinitions.mockResolvedValue(mockTasks)

    const taskMap = await client.getInstalledTasks()

    const task = taskMap.get('unknown-task-guid')
    expect(task?.fullIdentifier).toBe('UnknownTask')
    expect(task?.isBuiltIn).toBe(false)
  })

  it('Handles API errors gracefully', async () => {
    azdev.mockTaskAgentApi.getTaskDefinitions.mockRejectedValue(
      new Error('API Error')
    )

    await expect(client.getInstalledTasks()).rejects.toThrow(
      'Failed to fetch tasks from Azure DevOps'
    )
  })

  it('Skips tasks with missing required fields', async () => {
    const mockTasks = [
      {
        id: 'task-guid-1',
        name: 'ValidTask',
        version: { major: 1, minor: 0, patch: 0 }
      },
      {
        id: 'task-guid-2',
        // Missing name
        version: { major: 1, minor: 0, patch: 0 }
      },
      {
        // Missing id
        name: 'InvalidTask',
        version: { major: 1, minor: 0, patch: 0 }
      }
    ]

    azdev.mockTaskAgentApi.getTaskDefinitions.mockResolvedValue(mockTasks)

    const taskMap = await client.getInstalledTasks()

    // Should only have the valid task (mapped by id and name)
    expect(taskMap.size).toBe(2) // task-guid-1 and validtask
    expect(taskMap.has('task-guid-1')).toBe(true)
    expect(taskMap.has('validtask')).toBe(true)
    expect(taskMap.has('task-guid-2')).toBe(false)
    expect(taskMap.has('invalidtask')).toBe(false)
  })

  it('Uses contributionIdentifier for marketplace tasks', async () => {
    const mockTasks = [
      {
        id: '753a133d-cb1a-54dd-8470-0380b9038d12',
        name: 'NuGetPublisher-deprecated',
        friendlyName: 'NuGet publisher (Deprecated)',
        version: { major: 0, minor: 246, patch: 1 },
        author: 'Jesse Houwing',
        contributionIdentifier:
          'jessehouwing.nuget-deprecated.NuGetPublisher-deprecated',
        serverOwned: false
      }
    ]

    azdev.mockTaskAgentApi.getTaskDefinitions.mockResolvedValue(mockTasks)

    const taskMap = await client.getInstalledTasks()

    const task = taskMap.get('753a133d-cb1a-54dd-8470-0380b9038d12')
    expect(task?.fullIdentifier).toBe(
      'jessehouwing.nuget-deprecated.NuGetPublisher-deprecated'
    )
    expect(task?.isBuiltIn).toBe(false)
    expect(task?.author).toBe('Jesse Houwing')
  })
})

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
        serverOwned: true
      },
      {
        id: 'task-guid-2',
        name: 'TaskName2',
        friendlyName: 'Task Name 2',
        version: { major: 2, minor: 0, patch: 0 },
        author: 'CustomPublisher'
      }
    ]

    azdev.mockTaskAgentApi.getTaskDefinitions.mockResolvedValue(mockTasks)

    const taskMap = await client.getInstalledTasks()

    expect(taskMap.size).toBeGreaterThan(0)
    expect(taskMap.has('task-guid-1')).toBe(true)
    expect(taskMap.has('taskname1')).toBe(true)

    const task1 = taskMap.get('task-guid-1')
    expect(task1?.version).toBe('1.2.3')
    expect(task1?.fullIdentifier).toContain('TaskName1')
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
})

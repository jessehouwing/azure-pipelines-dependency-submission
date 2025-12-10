import { jest } from '@jest/globals'

// Mock task agent API
export const getTaskDefinitions = jest.fn()

export const mockTaskAgentApi = {
  getTaskDefinitions
}

// Mock WebApi
export const getTaskAgentApi = jest.fn(() => Promise.resolve(mockTaskAgentApi))

export const mockWebApi = {
  getTaskAgentApi
}

// Mock the azure-devops-node-api module
export const getPersonalAccessTokenHandler = jest.fn(() => ({}))
export const WebApi = jest.fn(() => mockWebApi)

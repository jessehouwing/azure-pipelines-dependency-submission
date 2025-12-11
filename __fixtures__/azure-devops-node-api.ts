import { jest } from '@jest/globals'

// Mock task agent API
export const getTaskDefinitions = jest.fn()

export const mockTaskAgentApi = {
  getTaskDefinitions
}

// Mock gallery API
export const getExtension = jest.fn()

export const mockGalleryApi = {
  getExtension
}

// Mock WebApi
export const getTaskAgentApi = jest.fn(() => Promise.resolve(mockTaskAgentApi))
export const getGalleryApi = jest.fn(() => Promise.resolve(mockGalleryApi))

export const mockWebApi = {
  getTaskAgentApi,
  getGalleryApi
}

// Mock the azure-devops-node-api module
export const getPersonalAccessTokenHandler = jest.fn(() => ({}))
export const WebApi = jest.fn(() => mockWebApi)

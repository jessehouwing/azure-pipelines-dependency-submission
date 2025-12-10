import { PipelineFileDiscovery } from '../src/pipeline-file-discovery'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('PipelineFileDiscovery', () => {
  let tempDir: string
  let discovery: PipelineFileDiscovery

  beforeEach(() => {
    tempDir = path.join(__dirname, 'temp-test-discovery')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    discovery = new PipelineFileDiscovery(tempDir)
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('findPipelineFiles', () => {
    it('Finds default pipeline files', async () => {
      // Create test files
      fs.writeFileSync(
        path.join(tempDir, 'azure-pipelines.yml'),
        'trigger: none'
      )
      fs.writeFileSync(
        path.join(tempDir, 'azure-pipelines.yaml'),
        'trigger: none'
      )

      const files = await discovery.findPipelineFiles('')

      expect(files.length).toBeGreaterThanOrEqual(1)
      expect(
        files.some(
          (f) =>
            f.endsWith('azure-pipelines.yml') ||
            f.endsWith('azure-pipelines.yaml')
        )
      ).toBe(true)
    })

    it('Finds pipelines in .azure-pipelines directory', async () => {
      const azurePipelinesDir = path.join(tempDir, '.azure-pipelines')
      fs.mkdirSync(azurePipelinesDir, { recursive: true })
      fs.writeFileSync(
        path.join(azurePipelinesDir, 'build.yml'),
        'trigger: none'
      )

      const files = await discovery.findPipelineFiles('')

      expect(
        files.some((f) => f.includes('.azure-pipelines') && f.endsWith('.yml'))
      ).toBe(true)
    })

    it('Uses custom glob patterns', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'custom-pipeline.yml'),
        'trigger: none'
      )

      const files = await discovery.findPipelineFiles('custom-pipeline.yml')

      expect(files.some((f) => f.endsWith('custom-pipeline.yml'))).toBe(true)
    })

    it('Handles multiple glob patterns', async () => {
      fs.writeFileSync(path.join(tempDir, 'build.yml'), 'trigger: none')
      fs.writeFileSync(path.join(tempDir, 'test.yml'), 'trigger: none')

      const files = await discovery.findPipelineFiles('build.yml, test.yml')

      expect(files.length).toBe(2)
    })

    it('Returns empty array when no files match', async () => {
      const files = await discovery.findPipelineFiles('nonexistent.yml')

      expect(files).toEqual([])
    })

    it('Filters out non-YAML files', async () => {
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test')
      fs.writeFileSync(
        path.join(tempDir, 'azure-pipelines.yml'),
        'trigger: none'
      )

      const files = await discovery.findPipelineFiles('')

      expect(
        files.every((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      ).toBe(true)
    })
  })

  describe('resolveTemplatePath', () => {
    it('Resolves relative template paths', () => {
      const sourceFile = path.join(tempDir, 'pipelines', 'build.yml')
      const templatePath = '../templates/common.yml'

      const resolved = discovery.resolveTemplatePath(sourceFile, templatePath)

      expect(resolved).toContain('templates')
      expect(resolved).toContain('common.yml')
    })

    it('Resolves absolute template paths from workspace root', () => {
      const sourceFile = path.join(tempDir, 'pipelines', 'build.yml')
      const templatePath = '/templates/common.yml'

      const resolved = discovery.resolveTemplatePath(sourceFile, templatePath)

      expect(resolved).toContain('templates')
      expect(resolved).toContain('common.yml')
    })

    it('Resolves template paths without leading slash', () => {
      const sourceFile = path.join(tempDir, 'azure-pipelines.yml')
      const templatePath = 'templates/steps.yml'

      const resolved = discovery.resolveTemplatePath(sourceFile, templatePath)

      expect(resolved).toContain('templates')
      expect(resolved).toContain('steps.yml')
    })

    it('Handles complex relative paths', () => {
      const sourceFile = path.join(tempDir, 'a', 'b', 'c', 'pipeline.yml')
      const templatePath = '../../templates/test.yml'

      const resolved = discovery.resolveTemplatePath(sourceFile, templatePath)

      expect(resolved).toContain('templates')
      expect(resolved).toContain('test.yml')
    })
  })
})

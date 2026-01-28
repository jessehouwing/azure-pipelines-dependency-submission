// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const config = {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true,
    exports: 'named',
    // Shim __dirname and __filename for CommonJS modules that use them (e.g., azure-devops-node-api)
    intro: `
import { fileURLToPath as __internal_fileURLToPath } from 'node:url';
import { dirname as __internal_dirname } from 'node:path';
const __filename = __internal_fileURLToPath(import.meta.url);
const __dirname = __internal_dirname(__filename);
`
  },
  plugins: [
    typescript(),
    nodeResolve({ preferBuiltins: true }),
    commonjs({
      strictRequires: true,
      ignoreTryCatch: false
    })
  ],
  context: 'this'
}

export default config

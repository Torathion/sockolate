import { defineConfig } from 'vitest/config'

if (process.env.TEST_WATCH) {
  // Patch stdin on the process so that we can fake it to seem like a real interactive terminal and pass the TTY checks
  process.stdin.isTTY = true
  process.stdin.setRawMode = () => process.stdin
}

const isCI = process.env.CI === 'true'

export default defineConfig({
  esbuild: {
    target: 'es2024',
    include: /\.(m?[jt]s|[jt]sx)$/,
    exclude: []
  },
  test: {
    pool: 'vmForks',
    environment: 'node',
    fakeTimers: {
      toFake: ['setTimeout', 'setImmediate', 'Date', 'setInterval'],
      shouldAdvanceTime: true,
      shouldClearNativeTimers: true
    },
    coverage: {
      enabled: true,
      all: true,
      provider: 'v8',
      exclude: ['**/*.js', '**/*.mjs', '**/*.d.ts', '**/types/', '**/constants.ts', '**/*.config.ts', '**/*.config.js', '**/test-utils.ts/**'],
      reporter: ['text', 'text-summary', 'json', 'json-summary']
    },
    testTimeout: 3000,
    setupFiles: ['./test/test-setup.ts'],
    reporters: isCI ? ['verbose', 'json', 'junit'] : ['default', 'hanging-process'],
    outputFile: {
      json: './test-results/test-results.json',
      junit: './test-results/test-results.xml'
    },
    silent: isCI
  }
})

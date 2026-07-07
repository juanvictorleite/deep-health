import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Vite 6+ native tsconfig path resolution — replaces vite-tsconfig-paths plugin.
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/types/**',
        // Pure type/interface files — no executable runtime code; v8 would always show 0%
        'src/core/types/common.ts',
        'src/core/types/locale.ts',
        'src/core/types/report.ts',
        'src/core/types/sonarqube.ts',
        'src/core/types/update.ts',
        'src/modules/ecosystem/types.ts',
        'src/modules/scanner/types.ts',
        'src/infrastructure/storage/provider.ts',
        'src/infrastructure/provisioner/types.ts',
        'src/reporting/i18n/types.ts',
      ],
      thresholds: {
        statements: 94.5,
        functions: 94.5,
        lines: 95.5,
        branches: 86,
      },
    },
    reporters: ['default'],
    // Named projects for targeted runs: npm run test:unit, npm run test:integration, npm run test:smoke
    // vitest 4 inline-project mode supports `--project <name>` CLI filtering.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          globals: true,
          setupFiles: [
            'tests/helpers/silence-logger.ts',
            'tests/helpers/silence-stdout.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globals: true,
          setupFiles: [
            'tests/helpers/silence-logger.ts',
            'tests/helpers/silence-stdout.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'smoke',
          include: ['tests/smoke/**/*.test.ts'],
          globals: true,
          setupFiles: [
            'tests/helpers/silence-logger.ts',
            'tests/helpers/silence-stdout.ts',
          ],
          // Smoke tests perform real Docker operations (container pull + start).
          // Per-test timeouts are declared inline with { timeout: N } but we
          // also raise the suite-level hook timeout so beforeAll skip probes
          // (docker info) don't time out on slow daemons.
          hookTimeout: 30_000,
          testTimeout: 120_000,
          // Run smoke tests sequentially to avoid port conflicts between provisioners.
          // maxWorkers: 1 + isolate: false replaces vitest 2's poolOptions.forks.singleFork.
          pool: 'forks',
          maxWorkers: 1,
          isolate: false,
          // Unique groupOrder required when projects differ in maxWorkers (vitest 4 constraint).
          sequence: { groupOrder: 1 },
          // Sweep orphaned SonarQube containers before and after the suite.
          globalSetup: ['tests/helpers/docker-cleanup.ts'],
        },
      },
    ],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/__tests__/**/*.test.ts'],
        globals: true,
        experimental: {
            // Transformed modules kept on disk between runs (node_modules/
            // .experimental-vitest-cache, keyed by each module's content): a
            // local run no longer transforms strings.ts (2 MB) and the rest of
            // the sources anew, about half of a run's import time (paired runs,
            // 18 Nov 2026: 172 -> 104 s and 251 -> 214 s). CI starts from an
            // empty folder every time, so it stays as before there.
            fsModuleCache: !process.env.CI,
        },
    },
});

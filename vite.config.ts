/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        display: resolve(__dirname, 'display.html'),
        host: resolve(__dirname, 'host.html'),
      },
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});

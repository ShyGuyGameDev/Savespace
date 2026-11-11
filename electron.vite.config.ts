import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { PROD_CSP } from './src/main/windows/csp'

/** Injects the strict CSP meta tag into the production renderer HTML. */
const cspPlugin = (): Plugin => ({
  name: 'savespace-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<!--CSP-->',
      `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`,
    ),
})

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      externalizeDeps: true,
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      // Sandboxed preloads can only require('electron'); bundle everything else (zod is not needed here).
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { ...shared, '@': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss(), cspPlugin()],
    build: {
      rolldownOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
})

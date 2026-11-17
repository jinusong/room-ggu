import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { TOOL_CATALOG } from './src/a2ui-catalog.js';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'build-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'a2ui/catalog.json',
          source: JSON.stringify(TOOL_CATALOG),
        });
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version, commit: process.env.GITHUB_SHA || 'local' }),
        });
      },
    },
    {
      name: 'omit-unused-onnx-wasm',
      // Transformers.js loads its matching ONNX runtime from the versioned CDN.
      // Vite also emits a 26MB fallback binary, which this app never requests.
      generateBundle(_options, bundle) {
        for (const name of Object.keys(bundle)) {
          if (/(^|\/)ort-wasm-.*\.wasm$/.test(name)) delete bundle[name];
        }
      },
    },
  ],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          icons: ['lucide'],
          a2ui: [
            '@a2ui/web_core/catalog',
            '@a2ui/web_core/processing',
            '@a2ui/web_core/resolution',
          ],
        },
      },
    },
  },
});

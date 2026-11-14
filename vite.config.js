import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  plugins: [{
    name: 'build-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: '5.2.0', commit: process.env.GITHUB_SHA || 'local' }) });
    },
  }, {
    name: 'omit-unused-onnx-wasm',
    // Transformers.js loads its matching ONNX runtime from the versioned CDN.
    // Vite also emits a 26MB fallback binary, which this app never requests.
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/(^|\/)ort-wasm-.*\.wasm$/.test(name)) delete bundle[name];
      }
    },
  }],
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  worker: { format: 'es' },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], icons: ['lucide'] } } } },
});

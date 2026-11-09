import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  plugins: [{
    name: 'build-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: '2.0.0', commit: process.env.GITHUB_SHA || 'local' }) });
    },
  }],
  worker: { format: 'es' },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], icons: ['lucide'] } } } },
});

import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'], icons: ['lucide'] } } } },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
      },
    },
  },
});

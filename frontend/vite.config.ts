import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { privacyPage } from './scripts/privacy-page.mjs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), privacyPage()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});

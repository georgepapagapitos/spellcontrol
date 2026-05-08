import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3737',
        changeOrigin: true,
      },
      '/edhrec-api': {
        target: 'https://json.edhrec.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/edhrec-api/, ''),
      },
      '/scryfall-api': {
        target: 'https://api.scryfall.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/scryfall-api/, ''),
        headers: {
          'User-Agent': 'mtg-binder-planner/1.0',
          Accept: 'application/json',
        },
      },
    },
  },
});

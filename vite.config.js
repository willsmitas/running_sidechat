import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL || 'http://localhost:3000';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': api, '/uploads': api },
  },
});

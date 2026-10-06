import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the Fastify server during development.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});

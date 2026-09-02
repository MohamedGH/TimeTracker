import { defineConfig } from 'vite';

export default defineConfig({
  base: '/TimeTracker/',
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    cors: true,
  },
});

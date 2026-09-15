import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  server: {
    port: 5173,
    host: true,
  },
});

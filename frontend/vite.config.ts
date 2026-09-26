import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://127.0.0.1:8740';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': backend,
      '/cam': backend,
      '/ws': { target: 'ws://127.0.0.1:8740', ws: true },
    },
  },
});

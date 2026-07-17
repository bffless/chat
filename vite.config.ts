import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        popup: 'popup/index.html',
        embed: 'embed/index.html',
      },
    },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: 'https://chat.docs.bffless.app',
        changeOrigin: true,
      },
    },
  },
});

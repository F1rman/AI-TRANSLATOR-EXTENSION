import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'chrome120', sourcemap: false,
    rollupOptions: {
      input: { popup: resolve(import.meta.dirname, 'popup.html'), options: resolve(import.meta.dirname, 'options.html'), image: resolve(import.meta.dirname, 'image.html'), background: resolve(import.meta.dirname, 'src/background.ts') },
      output: { entryFileNames: (chunk) => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' },
    },
  },
});

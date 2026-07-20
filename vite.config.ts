import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'tesseract.js': fileURLToPath(
        new URL('./node_modules/tesseract.js/dist/tesseract.esm.min.js', import.meta.url)
      ),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['qrcode'],
  },
});

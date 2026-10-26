import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import { jiesu } from '../../../src/vite-plugin';

export default defineConfig({
  plugins: [jiesu(), react(), tailwindcss()],
});

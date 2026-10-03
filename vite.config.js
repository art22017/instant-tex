import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { target: 'chrome140', rollupOptions:{input:{main:'index.html',export:'export.html'}} } });

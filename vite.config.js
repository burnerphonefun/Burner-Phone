import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const API = process.env.API || 'http://localhost:8787';

export default defineConfig({
  root: 'web',
  publicDir: process.env.NO_PUBLIC ? false : 'public', // the desktop overlay doesn't need the site's videos and images
  base: process.env.BASE || '/',
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'shared') } },
  build: {
    outDir: process.env.OUT || '../dist',
    emptyOutDir: true,
    cssMinify: false, // LESSONS: lightningcss folded font-stretch into the font shorthand on Vite 8
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: process.env.INPUT ? Object.fromEntries(process.env.INPUT.split(',').map((f) => [f, resolve(import.meta.dirname, 'web', f + '.html')])) : { index: resolve(import.meta.dirname, 'web/index.html') } },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': API,
      '/img': API,
      '/health': API,
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
});

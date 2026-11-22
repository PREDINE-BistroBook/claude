import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./src/web'),
  publicDir: r('./src/web/public'),
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@server': r('./src/server'),
      '@web': r('./src/web'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Acting School',
        short_name: 'Acting School',
        description: 'Staff app for the acting school and talent agency',
        theme_color: '#7f1d2d',
        background_color: '#f7f4f0',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Fonts: only the Latin and Arabic files go offline; other scripts load on demand.
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/*-latin-*.woff2', '**/*-arabic-*.woff2'],
        // API responses are private staff data: never cached by the service worker.
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    outDir: r('./dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});

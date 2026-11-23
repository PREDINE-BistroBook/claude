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
        name: 'Turquoise Studio',
        short_name: 'Turquoise',
        description: 'Staff app for Turquoise Studio — acting school and casting agency',
        // Keep in step with --accent and --canvas (light) in src/web/styles.css.
        theme_color: '#0c766c',
        background_color: '#f2f6f5',
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
        // A new deploy takes over at once (the page reloads to it when it activates). Without these,
        // injectRegister:false means the plugin doesn't add them for autoUpdate, and phones that have
        // the app would keep the old version for good.
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Fonts: only the Latin and Arabic files go offline; other scripts load on demand.
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/*-latin-*.woff2', '**/*-arabic-*.woff2'],
        // API responses are private staff data: never cached by the service worker.
        runtimeCaching: [],
        // Push notifications (Team pack): the push and notificationclick handlers, in src/web/public/push-sw.js.
        importScripts: ['/push-sw.js'],
      },
    }),
  ],
  build: {
    outDir: r('./dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // API_PORT lets several copies run side by side (default API on :3000).
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
});

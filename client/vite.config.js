import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Hotel4U',
        short_name: 'Hotel4U',
        description: 'Simple homepage',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        dir: 'rtl',
        lang: 'he',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // PMS server (hotel4u, port 5000)
      '^/api/(dashboard|properties|reservations|housekeeping|maintenance|guests|folio|reports|rates|companies|inventory|audit-log|crm|integrations|automation|payments|groups|notifications|guest-requests|folio-routing)(/.*)?$': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      // Legacy ziporiclass server (port 4000) — catch-all
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

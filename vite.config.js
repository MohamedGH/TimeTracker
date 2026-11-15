import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function resolvePublicEnv(mode) {
  const fileEnv = loadEnv(mode, process.cwd(), '');
  const pick = (...keys) => {
    for (const key of keys) {
      const val = process.env[key] ?? fileEnv[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return '';
  };

  return {
    GA4_MEASUREMENT_ID: pick('VITE_GA4_MEASUREMENT_ID', 'GA4_MEASUREMENT_ID'),
    GOOGLE_CLIENT_ID: pick('VITE_GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_ID'),
    GOOGLE_REDIRECT_URI: pick('VITE_GOOGLE_REDIRECT_URI', 'GOOGLE_REDIRECT_URI'),
  };
}

export default defineConfig(({ mode }) => {
  const publicEnv = resolvePublicEnv(mode);
  const isCapacitorBuild = process.env.CAPACITOR_BUILD === 'true';
  const base = isCapacitorBuild ? './' : (process.env.VITE_BASE_PATH || '/TimeTracker/');

  return {
    base,
    define: {
      'import.meta.env.VITE_GA4_MEASUREMENT_ID': JSON.stringify(publicEnv.GA4_MEASUREMENT_ID),
      'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(publicEnv.GOOGLE_CLIENT_ID),
      'import.meta.env.VITE_GOOGLE_REDIRECT_URI': JSON.stringify(publicEnv.GOOGLE_REDIRECT_URI),
      'import.meta.env.GOOGLE_CLIENT_ID': JSON.stringify(publicEnv.GOOGLE_CLIENT_ID),
      'import.meta.env.GOOGLE_REDIRECT_URI': JSON.stringify(publicEnv.GOOGLE_REDIRECT_URI),
    },
    plugins: [
      {
        name: 'time-tracker-runtime-env',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/env.js' || req.url === '/TimeTracker/env.js') {
              const live = resolvePublicEnv(mode);
              res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
              res.end(`window.__TIME_TRACKER_ENV__ = ${JSON.stringify(live)};\n`);
              return;
            }
            next();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/env.js' || req.url === '/TimeTracker/env.js') {
              const live = resolvePublicEnv(mode);
              res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
              res.end(`window.__TIME_TRACKER_ENV__ = ${JSON.stringify(live)};\n`);
              return;
            }
            next();
          });
        },
        transformIndexHtml() {
          const live = resolvePublicEnv(mode);
          if (!live.GOOGLE_CLIENT_ID && !live.GA4_MEASUREMENT_ID && !live.GOOGLE_REDIRECT_URI) {
            return [];
          }
          return [
            {
              tag: 'script',
              children: `window.__TIME_TRACKER_ENV__ = Object.assign({}, window.__TIME_TRACKER_ENV__, ${JSON.stringify(live)});`,
              injectTo: 'head-prepend',
            },
          ];
        },
      },
      VitePWA({
        disable: isCapacitorBuild,
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: base,
          name: 'Carnet du temps',
          short_name: 'Temps',
          description: 'Application mobile de suivi du temps et de gestion des catégories et activités.',
          theme_color: '#232821',
          background_color: '#F5F0E4',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: base,
          scope: base,
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cdn-assets-cache',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      cors: true,
    },
  };
});

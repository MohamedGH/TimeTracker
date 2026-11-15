import { defineConfig, loadEnv } from 'vite';

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

  return {
    base: '/TimeTracker/',
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
    ],
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      cors: true,
    },
  };
});

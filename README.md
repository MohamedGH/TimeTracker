# TimeTracker

A lightweight time-tracking application for organizing work and activities through a hierarchical category structure.

## 🌐 Live demo

**GitHub Pages:** https://mohamedgh.github.io/TimeTracker/

## Features

- Hierarchical categories and sub-categories
- Activities and time entries
- Dashboard and category-based statistics
- Local persistence in the browser
- Import/export support
- Automated tests with Vitest
- Production build with Vite

## Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

Run tests:

```bash
npm test
```

## Deployment

The application is configured for the repository project-page path `/TimeTracker/` and can be deployed to GitHub Pages.

```bash
npm run build
npm run deploy
```

The `deploy` script publishes the `dist/` directory to the `gh-pages` branch.

## Mobile App (PWA & Capacitor)

The app supports both **installable PWA** (with offline Service Worker, PNG icons, iOS install guide, and in-app install prompt) and **native Android / iOS packaging via Capacitor**:

```bash
# Build web bundle for Capacitor (base './') and sync native projects
npm run cap:sync

# Open native IDEs
npm run cap:android
npm run cap:ios
```

## Project

Repository: https://github.com/MohamedGH/TimeTracker

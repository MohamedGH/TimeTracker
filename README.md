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

## Géolocalisation facultative & Carte Google Maps

TimeTracker permet d'enregistrer ponctuellement la position de démarrage (`startLocation`) et d'arrêt (`endLocation`) de vos activités et de les visualiser sur une carte interactive dans l'onglet **Tableau de bord**.

### Configuration des variables d'environnement

Copiez `.env.example` vers `.env` (ou `env.example.js` vers `env.js` pour un déploiement statique sans build) :

- `VITE_GOOGLE_CLIENT_ID` : identifiant OAuth pour la synchronisation Google Drive uniquement.
- `VITE_GOOGLE_MAPS_API_KEY` : clé dédiée à **Google Maps JavaScript API** (ne jamais la confondre avec `VITE_GOOGLE_CLIENT_ID`).
- `VITE_GOOGLE_MAPS_MAP_ID` *(optionnel)* : identifiant Cloud Map pour `AdvancedMarkerElement` (utilise `DEMO_MAP_ID` par défaut).

> **Chargement différé & repli sans clé** : le SDK Google Maps (`@googlemaps/js-api-loader`) n'est téléchargé que lorsque des activités géolocalisées sont affichées sur le tableau de bord. Si `VITE_GOOGLE_MAPS_API_KEY` est absente ou invalide, l'application reste pleinement fonctionnelle et propose des liens directs `https://www.google.com/maps/...` pour consulter chaque lieu.

### Confidentialité & permissions mobiles

- **Opt-in explicite** : l'option « Enregistrer automatiquement la position de mes activités » est **désactivée par défaut**.
- **Capture ponctuelle uniquement** : utilise `getCurrentPosition()` au démarrage et à l'arrêt du chronomètre (aucun `watchPosition()`, aucun suivi en arrière-plan).
- **Non-bloquant** : un refus de permission, un timeout ou l'absence de GPS n'interrompt jamais le chronomètre.
- **Zéro fuite analytique** : aucune coordonnée GPS n'est envoyée à Google Analytics.
- **Contrôle total** : suppression possible par session (départ ou arrêt) ou globalement via *Données → Effacer les positions GPS* sans supprimer vos temps enregistrés.
- **Permissions natives** : `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` dans `android/app/src/main/AndroidManifest.xml` et `NSLocationWhenInUseUsageDescription` dans `ios/App/App/Info.plist`, via `@capacitor/geolocation`.

## Project

Repository: https://github.com/MohamedGH/TimeTracker

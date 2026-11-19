# TimeTracker — Tuiles Réglages rapides Android (`QuickTimerTiles`)

Ce document décrit l'architecture native Android (Capacitor + Kotlin), le comportement réel selon les versions d'Android, les contraintes d'écran verrouillé et la procédure de compilation et de test sur appareil physique.

---

## 1. Architecture native & Web

### Couche Android native (`android/app/src/main/`)

- **`AndroidManifest.xml`** :
  - Déclare 6 services statiques indépendants `QuickTimerTile1Service` à `QuickTimerTile6Service` (`android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"`, action `android.service.quicksettings.action.QS_TILE`, `android:exported="true"`).
  - Les emplacements 1..4 sont activés par défaut (`android:enabled="true"`), et les emplacements 5..6 sont désactivés par défaut (`android:enabled="false"`) puis activés dynamiquement via `PackageManager.setComponentEnabledSetting` dès qu'un emplacement est activé dans l'application.
  - Déclare un service secondaire `QuickTimerPickerTileService` (`TimeTracker — Choisir`).
- **`MainActivity.java`** :
  - Enregistre le plugin local Capacitor `QuickTimerTilesPlugin` via `registerPlugin(QuickTimerTilesPlugin.class);` avant `super.onCreate(savedInstanceState);`.
- **`tiles/QuickTimerModels.kt`** :
  - `QuickTilesConfig`, `QuickTileSlotConfig`, `AvailableTileActivity`, `NativeActiveTimer`, `NativePendingEntry`, `PendingSyncSnapshot`.
  - `QuickTimerLogic` : transitions atomiques 1:1 avec `src/core/mobile/quick-tiles.js` (`started`, `stopped`, `switched`), calcul de durée en minutes via timestamps `startTs` / `endTs`, gestion du passage de minuit (`date` / `endDate`).
  - `QuickTimerStoreLogic` : sérialisation JSON, ajout idempotent dans `pendingEntries`, acquittement sélectif, résolution monotone par timestamp (`shouldAcceptWebTimerSync`, `monotonicTimestamp`).
- **`tiles/QuickTimerRepository.kt`** :
  - Persistance native thread-safe via `SharedPreferences` (`timetracker_quick_tiles_prefs`) avec écriture synchrone `.commit()`.
  - Fonctionne même lorsque l'application est en arrière-plan, fermée ou tuée par le système, sans lancer `MainActivity` ni charger le `WebView`.
- **`tiles/BaseQuickTimerTileService.kt` & `QuickTimerTileSlotServices.kt`** :
  - Gère le cycle `onTileAdded`, `onStartListening`, `onStopListening`, `onDestroy`, `onClick`.
  - Met à jour dynamiquement l'état visuel (`STATE_ACTIVE` / `STATE_INACTIVE`), le libellé, le sous-titre (durée écoulée en direct à chaque ouverture du volet), l'icône et les descriptions d'accessibilité.
  - Rafraîchit instantanément toutes les tuiles sœurs visibles via `QuickTimerTileRegistry.refreshAllTiles(context)`.
- **`tiles/QuickTimerPickerTileService.kt`** :
  - Tuile secondaire affichant un `AlertDialog` natif via `TileService.showDialog()`.
  - Utilise systématiquement `unlockAndRun()` si l'écran est verrouillé (`isLocked == true`), car Android interdit ou bloque les boîtes de dialogue sur écran verrouillé.
- **`tiles/QuickTimerTilesPlugin.kt`** :
  - Expose au pont JavaScript (`src/core/mobile/native-quick-tiles-bridge.js`) : `getCapabilities`, `syncConfiguration`, `syncActiveTimer`, `getPendingSyncSnapshot`, `acknowledgePendingEntries`, `requestAddTile`, `refreshTiles`, et les événements `nativeTimerStateChanged` et `openQuickTilesConfig`.

### Couche JavaScript réutilisée (`src/core/mobile/` + `src/ui.js`)

- `src/core/mobile/quick-tiles.js` : modèle des 6 emplacements, collecte des activités réelles (zéro activité codée en dur), réconciliation idempotente `reconcileNativeTimerSnapshot`.
- `src/core/mobile/native-quick-tiles-bridge.js` : pont Capacitor `registerPlugin('QuickTimerTiles')` avec repli Web/PWA.
- `src/ui.js` : synchronisation de la configuration et du timer actif vers natif, réconciliation au démarrage, à la reprise (`focus`, `visibilitychange`) et sur événement `nativeTimerStateChanged` avec file d'attente anti-course.

---

## 2. Limitations par version d'Android

| Version Android | API | Comportement et limitations réelles |
| --- | --- | --- |
| **Android 7.0 – 8.1** (Nougat / Oreo) | **API 24 – 27** | `TileService` disponible. **Pas de `tile.subtitle`** : le libellé utilise le format compact `TT — <Activité>`. L'ajout de tuiles se fait manuellement depuis le bouton *Modifier* (crayon) des Réglages rapides (`requestAddTileService` indisponible). |
| **Android 9** (Pie) | **API 28** | Identique API 24–27 pour les tuiles (`subtitle` absent). Restrictions renforcées d'exécution en arrière-plan, mais `TileService` est lié directement par SystemUI lors de l'ouverture du panneau ou du clic. |
| **Android 10** (Q) | **API 29** | Ajout de `tile.subtitle` : affiche la catégorie quand la tuile est prête, ou `En cours · X min` lorsqu'un chronomètre est actif. Le libellé principal devient `<Activité>`. |
| **Android 11 – 12L** (R / S) | **API 30 – 32** | Ajout de `tile.stateDescription` et `tile.contentDescription` pour l'accessibilité TalkBack et l'affichage système sous le titre. |
| **Android 13** (Tiramisu) | **API 33** | Ajout de `StatusBarManager.requestAddTileService()` : le bouton **« Ajouter »** dans TimeTracker ouvre la boîte système demandant d'épingler directement la tuile choisie dans les Réglages rapides. |
| **Android 14 – 15+** (U / V) | **API 34+** | `TileService.startActivityAndCollapse(Intent)` est déprécié et lève `UnsupportedOperationException` avec `targetSdk >= 34`. L'ouverture de l'app (uniquement pour configurer une tuile vide ou via le bouton *Configurer* du Picker) utilise obligatoirement `startActivityAndCollapse(PendingIntent)` avec `FLAG_IMMUTABLE`. |

### Limite fondamentale d'Android sur le nombre de tuiles

Android impose que chaque tuile indépendante corresponde à une classe `TileService` déclarée statiquement dans `AndroidManifest.xml`. Il n'existe **aucune API Android** permettant de créer un nombre illimité de services `TileService` à la volée. TimeTracker déclare donc **6 emplacements statiques indépendants** (`QuickTimerTile1Service`..`6`) plus **1 tuile sélecteur secondaire** (`QuickTimerPickerTileService`), associés dynamiquement aux activités réelles de l'utilisateur.

---

## 3. Contraintes et réalités de l'écran verrouillé

1. **`allowOnLockScreen` n'est pas une permission système** :
   - Ce réglage applicatif contrôle uniquement si TimeTracker exécute directement `toggleSlot()` ou s'il exige `unlockAndRun()` lorsque `TileService.isLocked == true`.
   - Il ne contourne jamais les politiques de sécurité du système Android ni celles du constructeur.
2. **Conditions permettant le fonctionnement sans déverrouillage** :
   - Sur Android stock / Pixel (et la majorité des appareils autorisant les Réglages rapides sur l'écran de verrouillage), un clic sur l'une des **6 tuiles directes configurées** exécute uniquement de la logique native (`SharedPreferences` + `tile.updateTile()`) sans lancer d'activité ni ouvrir de boîte de dialogue : Android autorise cette action sans déverrouillage lorsque l'utilisateur a activé l'accès aux tuiles sur l'écran verrouillé dans les paramètres système.
3. **Cas où le déverrouillage reste imposé par Android / OEM** :
   - **Paramètre système / OEM** : si l'utilisateur ou une stratégie MDM désactive l'accès aux Réglages rapides sur l'écran verrouillé (ex. Android 14+ *« Utiliser les paramètres rapides sur l'écran de verrouillage »*, Samsung One UI, Xiaomi HyperOS/MIUI), le panneau ou certaines tuiles ne sont pas interactifs avant déverrouillage.
   - **Tuile non configurée** : nécessite d'ouvrir `MainActivity` → `unlockAndRun()` est appelé explicitement avant `startActivityAndCollapse(...)`.
   - **Tuile `QuickTimerPickerTileService`** : utilise `showDialog()` → `unlockAndRun()` est appelé systématiquement quand `isLocked == true`.
   - **Direct Boot (avant premier déverrouillage après redémarrage)** : l'application n'est pas marquée `directBootAware`, car les données de l'utilisateur résident dans le stockage chiffré par identifiants (`CE`). Les tuiles ne lisent ces données qu'après le premier déverrouillage.
4. **Validation obligatoire sur appareil physique** :
   - Le comportement sur écran verrouillé varie selon les surcouches constructeurs et versions d'Android : il doit être validé sur un appareil Android physique (non validable par simple émulation JavaScript ou sans SDK/appareil).

---

## 4. Compilation Android, tests natifs et validation terrain

### Synchroniser les assets Web vers Capacitor Android

```bash
npm run build:mobile
npx cap sync android
```

### Exécuter les tests unitaires Kotlin (JVM) et compiler l'APK debug

À exécuter dans un environnement équipé d'un JDK 17 et du SDK Android (`ANDROID_HOME` configuré) :

```bash
cd android
./gradlew testDebugUnitTest
./gradlew assembleDebug
```

L'APK généré se trouve dans `android/app/build/outputs/apk/debug/app-debug.apk`.

### Checklist de test sur appareil physique Android

1. Installer l'APK sur un appareil Android physique (`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`).
2. Créer/utiliser de vraies activités dans TimeTracker, associer les emplacements 1..6 dans **Tuiles Android & Écran verrouillé** et les ajouter aux Réglages rapides.
3. **Démarrage & arrêt depuis une tuile** : app fermé / tué (`Force stop` ou balayé des récents), abaisser les Réglages rapides, toucher la tuile #1 → état actif + durée, retoucher → arrêt.
4. **Bascule atomique** : démarrer la tuile #1 puis toucher directement la tuile #2 → la tuile #1 passe inactive immédiatement, la tuile #2 passe active, sans perte ni chevauchement de minutes.
5. **Écran verrouillé** : tester avec `allowOnLockScreen` activé puis désactivé, téléphone verrouillé par PIN/biométrie ; vérifier le comportement de repli (`unlockAndRun`) si l'appareil ou le réglage impose le déverrouillage.
6. **Réconciliation IndexedDB** : rouvrir TimeTracker et vérifier que toutes les sessions produites hors WebView apparaissent avec `viaTimer: true`, dates/heures exactes (y compris passage de minuit), et sans doublon après plusieurs ouvertures/fermetures.

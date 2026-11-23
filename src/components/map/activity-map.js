/**
 * Activity Map Component — Interactive Google Map displaying geolocated TimeTracker
 * sessions filtered by period and category, with clustering, chronological route lines,
 * and reusable InfoWindow popups.
 */

import {
  filterGeolocatedEntries,
  clusterOrGroupLocations,
  buildGeoRoutePath,
  computeGeoStats,
} from '../../core/geo/geo-location.js';
import {
  GOOGLE_MAPS_USAGE_ATTRIBUTION_ID,
  getGoogleMapsApiKey,
  getGoogleMapsMapId,
  loadGoogleMapsLibraries,
} from '../../core/geo/maps-loader.js';
import { filterEntriesByPeriod, formatDuration } from '../../core/statistics.js';
import { getContrastYIQ } from '../../core/category-palette.js';

let activeMapController = null;

const PERIOD_LABELS = {
  today: 'Aujourd’hui',
  '7': '7 jours',
  '30': '30 jours',
  month: 'Ce mois',
  all: 'Tout',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function buildInfoWindowNodes(cluster) {
  const header = el('div', 'map-infowindow-header');
  const dot = el('span', 'map-infowindow-dot');
  dot.style.backgroundColor = cluster.color;
  const title = el('strong', 'map-infowindow-title', cluster.primaryActivity);
  header.append(dot, title);

  const body = el('div', 'map-infowindow-body');
  const summary = el(
    'div',
    'map-infowindow-summary',
    `${cluster.primaryCategoryLabel} · ${cluster.formattedTotal} (${cluster.sessionCount} session${cluster.sessionCount > 1 ? 's' : ''})`
  );
  body.appendChild(summary);

  const actList = el('ul', 'map-infowindow-activities');
  for (const act of cluster.activitiesBreakdown.slice(0, 5)) {
    const li = el('li', 'map-infowindow-activity-item');
    const nameSpan = el('span', null, `${act.name} (${act.count}×)`);
    const durSpan = el('strong', null, act.formattedTotal);
    li.append(nameSpan, durSpan);
    actList.appendChild(li);
  }
  body.appendChild(actList);

  const recentLabel = el('div', 'map-infowindow-recent-title', 'Dernières sessions');
  body.appendChild(recentLabel);

  const recentList = el('ul', 'map-infowindow-sessions');
  for (const entry of cluster.entries.slice(0, 4)) {
    const li = el('li', 'map-infowindow-session-item');
    li.textContent = `${entry.date} · ${entry.start}–${entry.end} · ${entry.activity} (${formatDuration(entry.mins)})`;
    recentList.appendChild(li);
  }
  body.appendChild(recentList);

  const coordsNote = el('div', 'map-infowindow-coords', `GPS : ${cluster.coordinatesLabel}`);
  body.appendChild(coordsNote);

  return { header, body };
}

function formatDistanceLabel(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return '';
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Destroys any currently mounted Google Map instance, markers, polyline, and InfoWindow.
 */
export function destroyActivityMap() {
  if (!activeMapController) return;
  try {
    activeMapController.destroy();
  } catch {
    // ignore cleanup failures
  }
  activeMapController = null;
}

/**
 * Computes the complete view-model for the map card cleanly in pure JS.
 * Pure function.
 */
export function buildActivityMapModel({
  entries = [],
  categories = [],
  period = '7',
  categoryFilter = 'all',
  refDate,
} = {}) {
  const periodEntries = filterEntriesByPeriod(entries, period, refDate);
  const geolocatedEntries = filterGeolocatedEntries(entries, period, refDate, {
    categoryId: categoryFilter,
    categories,
  });
  const clusters = clusterOrGroupLocations(geolocatedEntries, categories);
  const route = buildGeoRoutePath(geolocatedEntries);
  const stats = computeGeoStats({
    allEntries: entries,
    periodEntries,
    geolocatedPeriodEntries: geolocatedEntries,
    clusters,
  });

  return {
    period,
    periodLabel: PERIOD_LABELS[period] || String(period),
    categoryFilter,
    periodEntries,
    geolocatedEntries,
    clusters,
    route,
    stats,
  };
}

/**
 * Renders the Dashboard Activity Map Card DOM node (and exposes data needed for mounting).
 */
export function renderActivityMapCard({
  entries = [],
  categories = [],
  period = '7',
  categoryFilter = 'all',
  showRoutePath = true,
  geoTrackingEnabled = false,
  focusClusterId = null,
  onToggleGeoTracking = () => {},
  onChangeCategoryFilter = () => {},
  onToggleRoutePath = () => {},
  onSelectPeriodAll = () => {},
} = {}) {
  const model = buildActivityMapModel({
    entries,
    categories,
    period,
    categoryFilter,
  });

  const apiKey = getGoogleMapsApiKey();
  const card = el('section', 'card activity-map-card');
  card.dataset.activityMapCard = 'true';
  card.dataset.period = String(period);

  // Header
  const head = el('div', 'activity-map-header');
  const titleGroup = el('div', 'activity-map-title-group');
  titleGroup.append(
    el('h2', 'card-title', 'Carte des activités'),
    el(
      'span',
      'activity-map-subtitle',
      `${model.periodLabel} · ${model.stats.placesCount} lieu${model.stats.placesCount > 1 ? 'x' : ''} · ${model.stats.geolocatedPeriodEntriesCount} session${model.stats.geolocatedPeriodEntriesCount > 1 ? 's' : ''} localisée${model.stats.geolocatedPeriodEntriesCount > 1 ? 's' : ''}`
    )
  );

  const geoSwitchBtn = document.createElement('button');
  geoSwitchBtn.type = 'button';
  geoSwitchBtn.className = `btn small geo-consent-pill-btn ${geoTrackingEnabled ? 'is-enabled' : ''}`.trim();
  geoSwitchBtn.dataset.behaviorTarget = 'map-geo-toggle';
  geoSwitchBtn.setAttribute('aria-pressed', String(Boolean(geoTrackingEnabled)));
  geoSwitchBtn.textContent = geoTrackingEnabled ? '📍 GPS chronos : Actif' : '📍 GPS chronos : Inactif';
  geoSwitchBtn.onclick = () => onToggleGeoTracking(!geoTrackingEnabled);

  head.append(titleGroup, geoSwitchBtn);
  card.appendChild(head);

  // Controls row
  const controls = el('div', 'activity-map-controls');

  const catWrap = el('div', 'activity-map-filter-wrap');
  const catLabel = el('label', 'activity-map-filter-label', 'Catégorie');
  catLabel.htmlFor = 'activity-map-category-filter';
  const catSelect = document.createElement('select');
  catSelect.id = 'activity-map-category-filter';
  catSelect.className = 'activity-map-select';
  catSelect.dataset.behaviorTarget = 'map-category-filter';

  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'Toutes les catégories';
  allOpt.selected = categoryFilter === 'all';
  catSelect.appendChild(allOpt);

  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.label;
    opt.selected = categoryFilter === cat.id;
    catSelect.appendChild(opt);
  }

  const uncatOpt = document.createElement('option');
  uncatOpt.value = '__uncategorized__';
  uncatOpt.textContent = 'Sans catégorie';
  uncatOpt.selected = categoryFilter === '__uncategorized__';
  catSelect.appendChild(uncatOpt);

  catSelect.onchange = () => onChangeCategoryFilter(catSelect.value);
  catWrap.append(catLabel, catSelect);
  controls.appendChild(catWrap);

  const toggleGroup = el('div', 'activity-map-toggle-group');
  if (model.route.stopsCount >= 2) {
    const routeBtn = document.createElement('button');
    routeBtn.type = 'button';
    routeBtn.className = `btn small ${showRoutePath ? 'primary' : 'secondary'}`.trim();
    routeBtn.dataset.behaviorTarget = 'map-route-toggle';
    routeBtn.setAttribute('aria-pressed', String(Boolean(showRoutePath)));
    const dist = formatDistanceLabel(model.route.totalDistanceMeters);
    routeBtn.textContent = showRoutePath
      ? `Trajet affiché${dist ? ` (${dist})` : ''}`
      : 'Afficher le trajet';
    routeBtn.onclick = () => onToggleRoutePath(!showRoutePath);
    toggleGroup.appendChild(routeBtn);
  }

  if (model.clusters.length > 0 && apiKey) {
    const recenterBtn = document.createElement('button');
    recenterBtn.type = 'button';
    recenterBtn.className = 'btn small secondary';
    recenterBtn.dataset.behaviorTarget = 'map-recenter';
    recenterBtn.textContent = 'Recentrer';
    recenterBtn.onclick = () => activeMapController?.fitAllBounds?.();
    toggleGroup.appendChild(recenterBtn);
  }

  controls.appendChild(toggleGroup);
  card.appendChild(controls);

  // Empty state or Google Map Canvas
  if (!model.clusters.length) {
    const emptyBox = el('div', 'activity-map-empty');
    emptyBox.dataset.activityMapEmpty = 'true';
    const hasHistoryElsewhere = model.stats.totalAllGeolocatedCount > 0 && period !== 'all';
    const msg = hasHistoryElsewhere
      ? `Aucune session géolocalisée sur la période « ${model.periodLabel} » (${model.stats.totalAllGeolocatedCount} sur l’historique complet).`
      : 'Aucune activité géolocalisée pour cette période. Activez le GPS sur vos chronomètres pour situer vos sessions sur la carte.';
    emptyBox.appendChild(el('p', 'muted', msg));

    const emptyActions = el('div', 'activity-map-empty-actions');
    if (!geoTrackingEnabled) {
      const enableBtn = document.createElement('button');
      enableBtn.type = 'button';
      enableBtn.className = 'btn small primary';
      enableBtn.dataset.behaviorTarget = 'map-enable-geo-cta';
      enableBtn.textContent = '📍 Activer la géolocalisation des chronos';
      enableBtn.onclick = () => onToggleGeoTracking(true);
      emptyActions.appendChild(enableBtn);
    }
    if (hasHistoryElsewhere) {
      const allPeriodBtn = document.createElement('button');
      allPeriodBtn.type = 'button';
      allPeriodBtn.className = 'btn small secondary';
      allPeriodBtn.dataset.behaviorTarget = 'map-show-all-period';
      allPeriodBtn.textContent = 'Afficher toute la période (Tout)';
      allPeriodBtn.onclick = () => onSelectPeriodAll();
      emptyActions.appendChild(allPeriodBtn);
    }
    if (emptyActions.childElementCount > 0) {
      emptyBox.appendChild(emptyActions);
    }
    card.appendChild(emptyBox);
  } else {
    if (!apiKey) {
      const configNotice = el(
        'div',
        'activity-map-config-note',
        'Carte Google Maps non chargée : renseignez VITE_GOOGLE_MAPS_API_KEY dans votre environnement. Vos lieux enregistrés restent listés ci-dessous.'
      );
      configNotice.dataset.activityMapMissingKey = 'true';
      card.appendChild(configNotice);
    } else {
      const mapStage = el('div', 'activity-map-stage');
      const mapCanvas = el('div', 'activity-map-canvas');
      mapCanvas.id = 'activity-google-map';
      mapCanvas.dataset.activityMapCanvas = 'true';
      mapCanvas.setAttribute('role', 'region');
      mapCanvas.setAttribute('aria-label', 'Carte interactive Google Maps des activités');
      mapStage.appendChild(mapCanvas);

      const statusLine = el('div', 'activity-map-status', 'Chargement de Google Maps…');
      statusLine.dataset.activityMapStatus = 'true';
      mapStage.appendChild(statusLine);
      card.appendChild(mapStage);
    }

    // Interactive places summary list
    const placesHeading = el(
      'h3',
      'chart-title activity-map-places-title',
      `Lieux enregistrés (${model.clusters.length})`
    );
    card.appendChild(placesHeading);

    const placesList = el('div', 'activity-map-places-list');
    for (const cluster of model.clusters) {
      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = `activity-map-place-card ${focusClusterId === cluster.id ? 'is-focused' : ''}`.trim();
      itemBtn.dataset.geoClusterId = cluster.id;
      itemBtn.dataset.behaviorTarget = 'map-place-focus';

      const left = el('div', 'activity-map-place-left');
      const dot = el('span', 'activity-map-place-dot');
      dot.style.backgroundColor = cluster.color;
      const textWrap = el('div', 'activity-map-place-text');
      const primary = el('strong', 'activity-map-place-name', cluster.primaryActivity);
      const sub = el(
        'span',
        'activity-map-place-meta',
        `${cluster.primaryCategoryLabel} · ${cluster.sessionCount} session${cluster.sessionCount > 1 ? 's' : ''} · ${cluster.coordinatesLabel}`
      );
      textWrap.append(primary, sub);
      left.append(dot, textWrap);

      const right = el('div', 'activity-map-place-right');
      right.append(
        el('strong', 'activity-map-place-duration', cluster.formattedTotal),
        el('span', 'activity-map-place-date', cluster.latestDate)
      );

      itemBtn.append(left, right);
      itemBtn.onclick = () => {
        activeMapController?.focusCluster?.(cluster.id);
        placesList.querySelectorAll('.activity-map-place-card').forEach(node => {
          node.classList.toggle('is-focused', node.dataset.geoClusterId === cluster.id);
        });
      };
      placesList.appendChild(itemBtn);
    }
    card.appendChild(placesList);
  }

  // Terms & privacy disclosure footer
  const footerNote = el(
    'p',
    'activity-map-privacy-note',
    'Vos coordonnées GPS restent locales sur cet appareil (capture révocable à tout moment). Cartographie fournie via Google Maps.'
  );
  card.appendChild(footerNote);

  return { card, model, apiKey };
}

/**
 * Mounts Google Maps onto `[data-activity-map-canvas]` using modern Maps JS libraries
 * (`AdvancedMarkerElement`, `PinElement`, `InfoWindow`, `Polyline`).
 */
export async function mountActivityMap({
  container,
  clusters = [],
  routePath = [],
  showRoutePath = true,
  focusClusterId = null,
  apiKey = getGoogleMapsApiKey(),
  mapId = getGoogleMapsMapId(),
  loadLibrariesFn = loadGoogleMapsLibraries,
} = {}) {
  destroyActivityMap();
  if (!container || !clusters.length || !apiKey) return null;

  const statusNode = container.parentElement?.querySelector('[data-activity-map-status]');
  let unmounted = false;
  const markerEntries = new Map();
  let map = null;
  let infoWindow = null;
  let polyline = null;
  let boundsInstance = null;

  const controller = {
    focusCluster(clusterId) {
      const target = markerEntries.get(clusterId);
      if (!target || !map) return;
      map.panTo({ lat: target.cluster.lat, lng: target.cluster.lng });
      if ((map.getZoom() ?? 0) < 15) {
        map.setZoom(15);
      }
      if (infoWindow) {
        const { header, body } = buildInfoWindowNodes(target.cluster);
        infoWindow.setHeaderContent?.(header);
        infoWindow.setContent(body);
        infoWindow.open({ map, anchor: target.marker, shouldFocus: false });
      }
    },
    fitAllBounds() {
      if (!map) return;
      if (clusters.length === 1) {
        map.panTo({ lat: clusters[0].lat, lng: clusters[0].lng });
        map.setZoom(15);
        return;
      }
      if (boundsInstance) {
        map.fitBounds(boundsInstance, 48);
      }
    },
    destroy() {
      unmounted = true;
      try {
        infoWindow?.close?.();
      } catch {
        // ignore
      }
      for (const { marker } of markerEntries.values()) {
        marker.map = null;
      }
      markerEntries.clear();
      if (polyline) {
        polyline.setMap(null);
        polyline = null;
      }
      map = null;
      infoWindow = null;
    },
  };

  activeMapController = controller;

  try {
    const { coreLib, mapsLib, markerLib } = await loadLibrariesFn({ apiKey, language: 'fr', region: 'FR' });
    if (unmounted) return null;

    const { Map: GoogleMap, InfoWindow, Polyline } = mapsLib;
    const { AdvancedMarkerElement, PinElement } = markerLib;
    const LatLngBoundsCtor = coreLib?.LatLngBounds || mapsLib?.LatLngBounds || window.google?.maps?.LatLngBounds;

    const initialCenter = { lat: clusters[0].lat, lng: clusters[0].lng };

    map = new GoogleMap(container, {
      center: initialCenter,
      zoom: clusters.length === 1 ? 15 : 12,
      mapId: mapId || 'DEMO_MAP_ID',
      gestureHandling: 'cooperative',
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      internalUsageAttributionIds: [GOOGLE_MAPS_USAGE_ATTRIBUTION_ID],
    });

    infoWindow = new InfoWindow({
      maxWidth: 320,
      ariaLabel: 'Détails des activités à cet emplacement',
    });

    if (typeof LatLngBoundsCtor === 'function') {
      boundsInstance = new LatLngBoundsCtor();
    }

    for (const cluster of clusters) {
      const position = { lat: cluster.lat, lng: cluster.lng };
      boundsInstance?.extend?.(position);

      const pin = new PinElement({
        background: cluster.color,
        borderColor: '#1E241E',
        glyphText: cluster.glyphText,
        glyphColor: getContrastYIQ(cluster.color),
        scale: cluster.sessionCount > 1 ? 1.15 : 1,
      });

      const marker = new AdvancedMarkerElement({
        map,
        position,
        title: `${cluster.primaryActivity} · ${cluster.formattedTotal}`,
      });
      if (typeof marker.append === 'function') {
        marker.append(pin);
      } else {
        marker.content = pin;
      }

      marker.addListener('click', () => {
        const { header, body } = buildInfoWindowNodes(cluster);
        infoWindow.setHeaderContent?.(header);
        infoWindow.setContent(body);
        infoWindow.open({ map, anchor: marker, shouldFocus: false });
      });

      markerEntries.set(cluster.id, { cluster, marker });
    }

    if (showRoutePath && Array.isArray(routePath) && routePath.length >= 2 && typeof Polyline === 'function') {
      polyline = new Polyline({
        path: routePath,
        geodesic: true,
        strokeColor: '#3F7068',
        strokeOpacity: 0.78,
        strokeWeight: 3,
        map,
      });
    }

    if (focusClusterId && markerEntries.has(focusClusterId)) {
      controller.focusCluster(focusClusterId);
    } else if (clusters.length > 1 && boundsInstance) {
      map.fitBounds(boundsInstance, 48);
    }

    if (statusNode) {
      statusNode.remove();
    }

    return controller;
  } catch (err) {
    if (statusNode && !unmounted) {
      statusNode.textContent = err?.message || 'Impossible de charger Google Maps.';
      statusNode.classList.add('is-error');
    }
    return null;
  }
}

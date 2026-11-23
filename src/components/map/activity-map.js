/**
 * Activity Map Component — Interactive Google Map displaying geolocated TimeTracker
 * start/stop positions filtered by period, category, and point type (`start` / `end`),
 * with spatial clustering, chronological route lines, reusable InfoWindow popups,
 * and standard Google Maps URL fallbacks when API key is missing or invalid.
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
import { filterEntriesByPeriod } from '../../core/statistics.js';
import { getContrastYIQ } from '../../core/category-palette.js';

let activeMapController = null;

const PERIOD_LABELS = {
  today: 'Aujourd’hui',
  '7': '7 jours',
  '30': '30 jours',
  month: 'Ce mois',
  all: 'Tout',
};

const POINT_TYPE_LABELS = {
  all: 'Toutes positions',
  start: 'Démarrages',
  end: 'Arrêts',
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
  const roleBadge = el('span', `map-infowindow-role is-${cluster.markerRole}`, cluster.roleLabel);
  header.append(dot, title, roleBadge);

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

  const recentLabel = el('div', 'map-infowindow-recent-title', 'Détails des sessions');
  body.appendChild(recentLabel);

  const recentList = el('ul', 'map-infowindow-sessions');
  for (const pt of cluster.points.slice(0, 5)) {
    const li = el('li', 'map-infowindow-session-item');
    const accLabel = Number.isFinite(pt.accuracy) ? ` · ±${pt.accuracy} m` : '';
    li.textContent = `[${pt.kindLabel}] ${pt.date} · ${pt.start}–${pt.end} · ${pt.activity} (${pt.formattedDuration}${accLabel})`;
    recentList.appendChild(li);
  }
  body.appendChild(recentList);

  const footer = el('div', 'map-infowindow-footer');
  footer.appendChild(el('span', 'map-infowindow-coords', `GPS : ${cluster.coordinatesLabel}`));
  if (cluster.googleMapsUrl) {
    const extLink = document.createElement('a');
    extLink.href = cluster.googleMapsUrl;
    extLink.target = '_blank';
    extLink.rel = 'noopener noreferrer';
    extLink.className = 'map-infowindow-ext-link';
    extLink.textContent = 'Ouvrir dans Google Maps ↗';
    footer.appendChild(extLink);
  }
  body.appendChild(footer);

  return { header, body };
}

function formatDistanceLabel(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return '';
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function resolvePinStyle(cluster) {
  if (cluster.markerRole === 'end') {
    return {
      background: '#232821',
      borderColor: cluster.color,
      glyphText: cluster.glyphText,
      glyphColor: '#F5F0E4',
      scale: cluster.pointCount > 1 ? 1.15 : 1,
    };
  }
  if (cluster.markerRole === 'both') {
    return {
      background: cluster.color,
      borderColor: '#B3833C',
      glyphText: cluster.glyphText,
      glyphColor: getContrastYIQ(cluster.color),
      scale: 1.18,
    };
  }
  return {
    background: cluster.color,
    borderColor: '#1E241E',
    glyphText: cluster.glyphText,
    glyphColor: getContrastYIQ(cluster.color),
    scale: cluster.pointCount > 1 ? 1.15 : 1,
  };
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
  pointTypeFilter = 'all',
  refDate,
} = {}) {
  const periodEntries = filterEntriesByPeriod(entries, period, refDate);
  const geolocatedEntries = filterGeolocatedEntries(entries, period, refDate, {
    categoryId: categoryFilter,
    categories,
    pointType: pointTypeFilter,
  });
  const clusters = clusterOrGroupLocations(geolocatedEntries, categories, {
    pointType: pointTypeFilter,
  });
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
    pointTypeFilter,
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
  pointTypeFilter = 'all',
  showRoutePath = true,
  geoTrackingEnabled = false,
  mapsQuotaExceeded = false,
  focusClusterId = null,
  onToggleGeoTracking = () => {},
  onChangeCategoryFilter = () => {},
  onChangePointTypeFilter = () => {},
  onToggleRoutePath = () => {},
  onSelectPeriodAll = () => {},
} = {}) {
  const model = buildActivityMapModel({
    entries,
    categories,
    period,
    categoryFilter,
    pointTypeFilter,
  });

  const apiKey = getGoogleMapsApiKey();
  const canRenderInteractiveMap = Boolean(apiKey && !mapsQuotaExceeded);
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
      `${model.periodLabel} · ${model.stats.placesCount} lieu${model.stats.placesCount > 1 ? 'x' : ''} · ${model.stats.geolocatedPeriodEntriesCount} session${model.stats.geolocatedPeriodEntriesCount > 1 ? 's' : ''} (${model.stats.startPointsCount} départ${model.stats.startPointsCount > 1 ? 's' : ''}, ${model.stats.endPointsCount} arrêt${model.stats.endPointsCount > 1 ? 's' : ''})`
    )
  );

  const geoSwitchBtn = document.createElement('button');
  geoSwitchBtn.type = 'button';
  geoSwitchBtn.className = `btn small geo-consent-pill-btn ${geoTrackingEnabled ? 'is-enabled' : ''}`.trim();
  geoSwitchBtn.dataset.behaviorTarget = 'map-geo-toggle';
  geoSwitchBtn.setAttribute('aria-pressed', String(Boolean(geoTrackingEnabled)));
  geoSwitchBtn.textContent = geoTrackingEnabled
    ? '📍 Position auto : Active'
    : '📍 Position auto : Inactive';
  geoSwitchBtn.title = 'Enregistrer automatiquement la position de mes activités';
  geoSwitchBtn.onclick = () => onToggleGeoTracking(!geoTrackingEnabled);

  head.append(titleGroup, geoSwitchBtn);
  card.appendChild(head);

  // Controls row: category filter + point type filter (All / Start / End) + route/recenter
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

  // Point role filter chips
  const roleFilterGroup = el('div', 'activity-map-role-filters');
  roleFilterGroup.setAttribute('role', 'group');
  roleFilterGroup.setAttribute('aria-label', 'Filtrer par type de position');
  for (const key of ['all', 'start', 'end']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn small ${pointTypeFilter === key ? 'active' : 'secondary'}`.trim();
    btn.dataset.behaviorTarget = `map-point-filter-${key}`;
    btn.textContent = POINT_TYPE_LABELS[key];
    btn.onclick = () => onChangePointTypeFilter(key);
    roleFilterGroup.appendChild(btn);
  }
  toggleGroup.appendChild(roleFilterGroup);

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

  if (model.clusters.length > 0 && canRenderInteractiveMap) {
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

  // Legend when geolocated points exist
  if (model.clusters.length > 0) {
    const legend = el('div', 'activity-map-legend');
    legend.append(
      el('span', 'activity-map-legend-item is-start', '▶ Position de démarrage'),
      el('span', 'activity-map-legend-item is-end', '■ Position d’arrêt'),
      el('span', 'activity-map-legend-item is-both', '● Lieux regroupés')
    );
    card.appendChild(legend);
  }

  // Empty state or Google Map Canvas
  if (!model.clusters.length) {
    const emptyBox = el('div', 'activity-map-empty');
    emptyBox.dataset.activityMapEmpty = 'true';
    const hasHistoryElsewhere = model.stats.totalAllGeolocatedCount > 0 && period !== 'all';
    const msg = hasHistoryElsewhere
      ? `Aucune session géolocalisée sur la période « ${model.periodLabel} » (${model.stats.totalAllGeolocatedCount} sur l’historique complet).`
      : 'Aucune activité géolocalisée pour cette période. Activez « Enregistrer automatiquement la position de mes activités » pour situer vos sessions.';
    emptyBox.appendChild(el('p', 'muted', msg));

    const emptyActions = el('div', 'activity-map-empty-actions');
    if (!geoTrackingEnabled) {
      const enableBtn = document.createElement('button');
      enableBtn.type = 'button';
      enableBtn.className = 'btn small primary';
      enableBtn.dataset.behaviorTarget = 'map-enable-geo-cta';
      enableBtn.textContent = '📍 Activer l’enregistrement de position';
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
    if (!canRenderInteractiveMap) {
      const configNotice = el(
        'div',
        'activity-map-config-note',
        !apiKey
          ? 'Carte interactive Google Maps non configurée (clé VITE_GOOGLE_MAPS_API_KEY absente). Vous pouvez consulter chaque position directement via les liens « Ouvrir dans Google Maps » ci-dessous.'
          : 'Carte interactive Google Maps temporairement indisponible (clé invalide ou quota atteint). Utilisez les liens « Ouvrir dans Google Maps » ci-dessous pour visualiser vos lieux.'
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

    // Interactive places summary list (always available, includes standard Google Maps external link)
    const placesHeading = el(
      'h3',
      'chart-title activity-map-places-title',
      `Lieux enregistrés (${model.clusters.length})`
    );
    card.appendChild(placesHeading);

    const placesList = el('div', 'activity-map-places-list');
    for (const cluster of model.clusters) {
      const itemWrap = el('div', `activity-map-place-card ${focusClusterId === cluster.id ? 'is-focused' : ''}`.trim());
      itemWrap.dataset.geoClusterId = cluster.id;

      const focusBtn = document.createElement('button');
      focusBtn.type = 'button';
      focusBtn.className = 'activity-map-place-focus-btn';
      focusBtn.dataset.behaviorTarget = 'map-place-focus';

      const left = el('div', 'activity-map-place-left');
      const dot = el('span', 'activity-map-place-dot');
      dot.style.backgroundColor = cluster.color;
      const textWrap = el('div', 'activity-map-place-text');
      const primary = el('strong', 'activity-map-place-name', `${cluster.primaryActivity} · ${cluster.roleLabel}`);
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

      focusBtn.append(left, right);
      focusBtn.onclick = () => {
        activeMapController?.focusCluster?.(cluster.id);
        placesList.querySelectorAll('.activity-map-place-card').forEach(node => {
          node.classList.toggle('is-focused', node.dataset.geoClusterId === cluster.id);
        });
      };
      itemWrap.appendChild(focusBtn);

      if (cluster.googleMapsUrl) {
        const extLink = document.createElement('a');
        extLink.href = cluster.googleMapsUrl;
        extLink.target = '_blank';
        extLink.rel = 'noopener noreferrer';
        extLink.className = 'activity-map-external-link';
        extLink.dataset.behaviorTarget = 'map-external-link';
        extLink.textContent = 'Google Maps ↗';
        extLink.title = `Ouvrir ${cluster.coordinatesLabel} dans Google Maps`;
        itemWrap.appendChild(extLink);
      }

      placesList.appendChild(itemWrap);
    }
    card.appendChild(placesList);
  }

  // Terms & privacy disclosure footer
  const footerNote = el(
    'p',
    'activity-map-privacy-note',
    'Vos coordonnées GPS restent locales sur cet appareil (option révocable et effaçable à tout moment, aucun envoi vers Google Analytics). Cartographie via Google Maps.'
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
      map.panTo({ lat: target.cluster.latitude, lng: target.cluster.longitude });
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
        map.panTo({ lat: clusters[0].latitude, lng: clusters[0].longitude });
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

    const initialCenter = { lat: clusters[0].latitude, lng: clusters[0].longitude };

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
      maxWidth: 330,
      ariaLabel: 'Détails des activités à cet emplacement',
    });

    if (typeof LatLngBoundsCtor === 'function') {
      boundsInstance = new LatLngBoundsCtor();
    }

    for (const cluster of clusters) {
      const position = { lat: cluster.latitude, lng: cluster.longitude };
      boundsInstance?.extend?.(position);

      const pin = new PinElement(resolvePinStyle(cluster));

      const marker = new AdvancedMarkerElement({
        map,
        position,
        title: `${cluster.roleLabel} · ${cluster.primaryActivity} (${cluster.formattedTotal})`,
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
      statusNode.replaceChildren();
      const errMsg = el(
        'div',
        'activity-map-error-box',
        `Impossible d’afficher la carte Google Maps (${err?.message || 'clé invalide ou erreur réseau'}). Vous pouvez ouvrir les positions dans Google Maps depuis la liste ci-dessous.`
      );
      statusNode.appendChild(errMsg);
      statusNode.classList.add('is-error');
    }
    return null;
  }
}

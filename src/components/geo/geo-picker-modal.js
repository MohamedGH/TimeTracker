import { isolateModalEvents } from '../../core/modal-events.js';
import { formatCoordinates, normalizeLocation } from '../../core/geo/geo-location.js';

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = String(text);
  return n;
}

function btn(text, kind = '', behaviorTarget = null) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${kind}`.trim();
  b.textContent = text;
  if (behaviorTarget) b.dataset.behaviorTarget = behaviorTarget;
  return b;
}

/**
 * Renders an interactive Map / Coordinates picker modal allowing the user
 * to choose or adjust a GPS location manually on a simulated map / coordinate pad.
 */
export function renderGeoPickerModal({
  modal,
  onClose,
  onConfirmLocation,
}) {
  const initialLoc = normalizeLocation(modal?.location || { latitude: 48.8566, longitude: 2.3522 });
  let latVal = initialLoc ? initialLoc.latitude : 48.8566;
  let lngVal = initialLoc ? initialLoc.longitude : 2.3522;
  const labelPrefix = modal?.labelPrefix || 'Position';
  let localError = null;

  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box geo-picker-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `Choisir ${labelPrefix} sur la carte`);

  const head = el('div', 'modal-head');
  head.appendChild(el('h2', 'card-title', `Choisir : ${labelPrefix}`));
  const closeBtn = btn('×', 'modal-close', 'modal-close');
  closeBtn.onclick = onClose;
  head.appendChild(closeBtn);

  const body = el('div', 'template-modal-body');
  body.appendChild(el('p', 'muted template-modal-desc', 'Cliquez sur la carte interactive ou ajustez les coordonnées GPS manuellement :'));

  const errorContainer = el('div');
  const previewCoords = el('div', 'geo-picker-preview-coords');

  // Simulated interactive map canvas / grid pad
  const mapPad = el('div', 'geo-picker-map-pad');
  mapPad.dataset.geoPickerMap = 'true';
  mapPad.title = 'Cliquez pour positionner le repère GPS';

  const markerPin = el('div', 'geo-picker-marker-pin', '📍');
  mapPad.appendChild(markerPin);

  // Position pin visually based on lat/lng relative to center
  function updatePinPosition() {
    // map bounds approximation around center (latVal, lngVal)
    markerPin.style.left = '50%';
    markerPin.style.top = '50%';
  }
  updatePinPosition();

  mapPad.onclick = (e) => {
    const rect = mapPad.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = (x - rect.width / 2) / (rect.width / 2); // -1 to 1
    const dy = (y - rect.height / 2) / (rect.height / 2); // -1 to 1

    latVal = Math.round((latVal - dy * 0.05) * 1e6) / 1e6;
    lngVal = Math.round((lngVal + dx * 0.05) * 1e6) / 1e6;
    latInput.value = String(latVal);
    lngInput.value = String(lngVal);
    refreshPreview();
  };

  const inputsRow = el('div', 'row');
  const latWrap = el('div', 'field');
  latWrap.appendChild(el('label', null, 'Latitude'));
  const latInput = document.createElement('input');
  latInput.type = 'number';
  latInput.step = '0.000001';
  latInput.value = String(latVal);
  latInput.dataset.geoPickerLat = 'true';
  latWrap.appendChild(latInput);

  const lngWrap = el('div', 'field');
  lngWrap.appendChild(el('label', null, 'Longitude'));
  const lngInput = document.createElement('input');
  lngInput.type = 'number';
  lngInput.step = '0.000001';
  lngInput.value = String(lngVal);
  lngInput.dataset.geoPickerLng = 'true';
  lngWrap.appendChild(lngInput);

  inputsRow.append(latWrap, lngWrap);

  function refreshPreview() {
    errorContainer.replaceChildren();
    if (localError) {
      const errBox = el('div', 'template-error-banner', localError);
      errBox.dataset.templateError = '1';
      errorContainer.appendChild(errBox);
    }
    const parsedLat = Number(latInput.value);
    const parsedLng = Number(lngInput.value);
    const norm = normalizeLocation({ latitude: parsedLat, longitude: parsedLng, source: 'manual' });
    if (norm) {
      previewCoords.textContent = `📍 Coordonnées sélectionnées : ${formatCoordinates(norm, 6)}`;
      previewCoords.classList.remove('is-invalid');
    } else {
      previewCoords.textContent = '⚠ Coordonnées invalides (Latitude [-90, 90], Longitude [-180, 180])';
      previewCoords.classList.add('is-invalid');
    }
  }

  latInput.oninput = () => { localError = null; refreshPreview(); };
  lngInput.oninput = () => { localError = null; refreshPreview(); };

  refreshPreview();

  const footer = el('div', 'action-row template-modal-footer');
  const cancelBtn = btn('Annuler', 'secondary', 'geo-picker-cancel');
  cancelBtn.onclick = onClose;

  const confirmBtn = btn('Valider cet emplacement', 'primary', 'geo-picker-confirm');
  confirmBtn.onclick = () => {
    const parsedLat = Number(latInput.value);
    const parsedLng = Number(lngInput.value);
    const norm = normalizeLocation({ latitude: parsedLat, longitude: parsedLng, source: 'manual' });
    if (!norm) {
      localError = 'Veuillez saisir des coordonnées GPS valides.';
      refreshPreview();
      return;
    }
    onConfirmLocation(norm);
  };

  footer.append(cancelBtn, confirmBtn);
  body.append(errorContainer, mapPad, previewCoords, inputsRow, footer);

  box.append(head, body);
  overlay.appendChild(box);
  isolateModalEvents(overlay, box, { onBackdropClose: onClose });
  return overlay;
}

// Renders each added city in two places — an HTML marker on the globe and a row
// in the left panel — and keeps their clock + day/night badge in sync with the
// slider. Subscribes to the store: the pin SET is rebuilt only when it changes,
// but the times are refreshed on every state update.

import { getWorld } from './globe.js';
import { subscribe, effectiveDate, removePin } from './state.js';
import { isDaylight } from './solar.js';
import { formatLocalTime, formatUtcOffset } from './time.js';

let lastIds = '';

export function initPins() {
  const panel = document.getElementById('pin-panel');
  const listEl = document.getElementById('pin-list');

  subscribe((state) => {
    const ids = state.pins.map((p) => p.id).join(',');
    if (ids !== lastIds) {
      lastIds = ids;
      rebuildMarkers(state.pins);
      rebuildList(listEl, state.pins);
      panel.hidden = state.pins.length === 0;
    }

    const date = effectiveDate();
    for (const p of state.pins) updatePinViews(p, date);
  });
}

function rebuildMarkers(pins) {
  const world = getWorld();
  if (!world) return;
  world
    .htmlElementsData(pins)
    .htmlLat((d) => d.lat)
    .htmlLng((d) => d.lng)
    .htmlAltitude(0.0)
    .htmlElement((d) => {
      const el = document.createElement('div');
      el.className = 'globe-pin';
      el.innerHTML = `
        <div class="card">
          <span class="badge"></span>
          <span class="name"></span>
          <span class="clock"></span>
        </div>
        <div class="needle"></div>
        <div class="dot"></div>`;
      el.querySelector('.name').textContent = d.name;
      d._badge = el.querySelector('.badge');
      d._clock = el.querySelector('.clock');
      // globe.gl builds these elements asynchronously, after the subscribe
      // callback's initial updatePinViews pass — so seed the time/badge here or
      // the marker would stay blank until the next state change.
      updatePinViews(d, effectiveDate());
      return el;
    })
    .htmlElementVisibilityModifier((el, isVisible) => {
      // Fade markers that rotate to the back of the globe.
      el.style.opacity = isVisible ? '1' : '0';
    });
}

function rebuildList(listEl, pins) {
  listEl.innerHTML = '';
  for (const p of pins) {
    const li = document.createElement('li');
    li.className = 'pin-row';
    li.innerHTML = `
      <span class="badge"></span>
      <span class="info">
        <div class="name"></div>
        <div class="clock"></div>
      </span>
      <button class="remove" title="Remove" aria-label="Remove ${p.name}">✕</button>`;
    li.querySelector('.name').textContent = `${p.name}, ${p.country}`;
    li.querySelector('.remove').addEventListener('click', () => removePin(p.id));
    p._rowBadge = li.querySelector('.badge');
    p._rowClock = li.querySelector('.clock');
    listEl.appendChild(li);
  }
}

function updatePinViews(p, date) {
  const day = isDaylight(date, p.lat, p.lng);
  const badge = day ? '☀️' : '🌙';
  const clock = formatLocalTime(date, p.tz);
  const offset = formatUtcOffset(date, p.tz);

  if (p._badge) p._badge.textContent = badge;
  if (p._clock) p._clock.textContent = clock;
  if (p._rowBadge) p._rowBadge.textContent = badge;
  if (p._rowClock) p._rowClock.textContent = `${clock} · ${offset}`;
}

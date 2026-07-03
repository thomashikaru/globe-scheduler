// Renders each added city as a row in the left "Locations" panel and keeps its
// clock + day/night badge in sync with the slider. Subscribes to the store: the
// pin SET is rebuilt only when it changes, but the times are refreshed on every
// state update. The globe's on-sphere markers live in globe.js and the flat map's
// pins in flatmap.js — each renderer owns its own pin views.

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
      rebuildList(listEl, state.pins);
      panel.hidden = state.pins.length === 0;
    }

    const date = effectiveDate();
    for (const p of state.pins) updateRow(p, date);
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

function updateRow(p, date) {
  const day = isDaylight(date, p.lat, p.lng);
  const badge = day ? '☀️' : '🌙';
  const clock = formatLocalTime(date, p.tz);
  const offset = formatUtcOffset(date, p.tz);

  if (p._rowBadge) p._rowBadge.textContent = badge;
  if (p._rowClock) p._rowClock.textContent = `${clock} · ${offset}`;
}

// Flat "Map" view: an equirectangular (plate carrée) world map rendered to a
// canvas, showing the same day/night, time-zone lines, and city pins as the
// globe. It is a self-contained alternate renderer — it subscribes to the same
// store, so it stays in sync whether or not it is currently visible.
//
// The day/night terminator is the great circle 90° from the subsolar point; in
// this projection that traces a sinusoidal curve, and the night hemisphere is the
// region on the far side of it (closed toward the unlit pole).

import { subscribe, effectiveDate } from './state.js';
import { subsolarPoint, isDaylight } from './solar.js';
import { formatLocalTime } from './time.js';

// Served from the app's base path (a subpath on GitHub Pages), so resolve /public
// assets against import.meta.env.BASE_URL instead of the server root.
const BASE = import.meta.env.BASE_URL;
const DAY_SRC = `${BASE}earth-day.jpg`;
const NIGHT_SRC = `${BASE}earth-night.jpg`;
const TZ_GEOJSON = `${BASE}timezones.geojson`;

// Fixed internal resolution for the pre-rendered day/night layers (2:1 = whole
// earth). Composited (scaled) to the display canvas each frame.
const LAYER_W = 2048;
const LAYER_H = 1024;

let frameEl, canvas, ctx, pinsEl;
let dayLayer = null;
let nightLayer = null; // offscreen canvases: texture + baked time-zone lines
let tzFeatures = null;
let ready = false;
let mapW = 0;
let mapH = 0; // display size (CSS px)
let pinList = []; // [{ p, el, badge, clock }]
let lastPinIds = '';

export function initFlatmap() {
  frameEl = document.querySelector('#flatmap .map-frame');
  canvas = document.getElementById('flatmap-canvas');
  ctx = canvas.getContext('2d');
  pinsEl = document.getElementById('flatmap-pins');

  sizeMap();
  loadAssets();
  window.addEventListener('resize', () => {
    sizeMap();
    render();
    repositionPins();
  });

  subscribe((state) => {
    const ids = state.pins.map((p) => p.id).join(',');
    if (ids !== lastPinIds) {
      lastPinIds = ids;
      // Showing/hiding the Locations panel changes the reserved insets
      // (--reserve-left on desktop, --reserve-top on mobile), so re-fit the
      // map before positioning pins against the fresh mapW/mapH.
      document.body.classList.toggle('has-pins', state.pins.length > 0);
      sizeMap();
      rebuildPins(state.pins);
    }
    render();
    const date = effectiveDate();
    for (const e of pinList) updatePin(e, date);
  });
}

/** Force a redraw (used when the view becomes visible). */
export function redrawFlatmap() {
  sizeMap();
  render();
  repositionPins();
}

// ---------- asset loading + layer pre-rendering ----------

async function loadAssets() {
  const loadImg = (src) =>
    new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.src = src;
    });
  const [dayImg, nightImg] = await Promise.all([loadImg(DAY_SRC), loadImg(NIGHT_SRC)]);

  try {
    const geo = await (await fetch(TZ_GEOJSON)).json();
    tzFeatures = (geo.features || []).filter(
      (f) => f.geometry && f.geometry.type && f.geometry.coordinates
    );
  } catch {
    tzFeatures = [];
  }

  dayLayer = makeLayer(dayImg);
  nightLayer = makeLayer(nightImg);
  ready = true;
  render();
}

function makeLayer(img) {
  const c = document.createElement('canvas');
  c.width = LAYER_W;
  c.height = LAYER_H;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, LAYER_W, LAYER_H);
  drawTimezoneLines(g, LAYER_W, LAYER_H);
  return c;
}

function drawTimezoneLines(g, W, H) {
  if (!tzFeatures || !tzFeatures.length) return;
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 1;
  g.beginPath();
  for (const f of tzFeatures) {
    const geom = f.geometry;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    for (const poly of polys) {
      for (const ring of poly) {
        let prevLng = null;
        let started = false;
        for (const [lng, lat] of ring) {
          const x = ((lng + 180) / 360) * W;
          const y = ((90 - lat) / 180) * H;
          // Break the path across the antimeridian to avoid horizontal streaks.
          if (!started || (prevLng !== null && Math.abs(lng - prevLng) > 180)) {
            g.moveTo(x, y);
            started = true;
          } else {
            g.lineTo(x, y);
          }
          prevLng = lng;
        }
      }
    }
  }
  g.stroke();
}

// ---------- per-frame rendering ----------

/** Terminator latitude (deg) for a given longitude, in the current sun geometry. */
function terminatorLat(lngDeg, subLngDeg, decDeg) {
  const dec = (decDeg * Math.PI) / 180;
  const dLambda = ((lngDeg - subLngDeg) * Math.PI) / 180;
  let tanDec = Math.tan(dec);
  if (Math.abs(tanDec) < 1e-6) tanDec = tanDec < 0 ? -1e-6 : 1e-6; // guard near equinox
  return (Math.atan(-Math.cos(dLambda) / tanDec) * 180) / Math.PI;
}

function traceTerminator(cw, ch, subLng, dec, step) {
  const pts = [];
  for (let x = 0; x <= cw; x += step) {
    const lng = (x / cw) * 360 - 180;
    const lat = terminatorLat(lng, subLng, dec);
    pts.push([x, ((90 - lat) / 180) * ch]);
  }
  return pts;
}

function render() {
  if (!ready) return;
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);

  // Day base everywhere.
  ctx.drawImage(dayLayer, 0, 0, cw, ch);

  const date = effectiveDate();
  const [subLng, dec] = subsolarPoint(date);
  const step = Math.max(2, Math.floor(cw / 360));
  const term = traceTerminator(cw, ch, subLng, dec, step);

  // Night texture, clipped to the unlit hemisphere (closed toward the dark pole).
  ctx.save();
  ctx.beginPath();
  term.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (dec >= 0) {
    // Sun north of the equator → south is dark: close along the bottom edge.
    ctx.lineTo(cw, ch);
    ctx.lineTo(0, ch);
  } else {
    ctx.lineTo(cw, 0);
    ctx.lineTo(0, 0);
  }
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(nightLayer, 0, 0, cw, ch);
  ctx.restore();

  // The terminator itself as a soft sinusoidal line.
  ctx.save();
  ctx.beginPath();
  term.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = 'rgba(255,214,107,0.6)';
  ctx.lineWidth = Math.max(1.5, cw / 800);
  ctx.shadowColor = 'rgba(255,214,107,0.5)';
  ctx.shadowBlur = Math.max(3, cw / 300);
  ctx.stroke();
  ctx.restore();
}

// ---------- pins ----------

function rebuildPins(pins) {
  pinsEl.innerHTML = '';
  pinList = [];
  const date = effectiveDate();
  for (const p of pins) {
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
    el.querySelector('.name').textContent = p.name;
    pinsEl.appendChild(el);
    const entry = { p, el, badge: el.querySelector('.badge'), clock: el.querySelector('.clock') };
    pinList.push(entry);
    positionPin(entry);
    updatePin(entry, date);
  }
}

function positionPin({ p, el }) {
  el.style.left = `${((p.lng + 180) / 360) * mapW}px`;
  el.style.top = `${((90 - p.lat) / 180) * mapH}px`;
}

function repositionPins() {
  for (const e of pinList) positionPin(e);
}

function updatePin({ p, badge, clock }, date) {
  badge.textContent = isDaylight(date, p.lat, p.lng) ? '☀️' : '🌙';
  clock.textContent = formatLocalTime(date, p.tz);
}

// ---------- sizing ----------

function sizeMap() {
  const dpr = window.devicePixelRatio || 1;
  // Fit inside the region the overlays don't cover. The reserved insets live in
  // CSS (--reserve-*, read off <body> so the has-pins / cal-open overrides
  // apply) and also drive #flatmap's padding, so JS and CSS stay in agreement:
  // availW === innerWidth - paddingLeft - paddingRight.
  const cs = getComputedStyle(document.body);
  const px = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
  const availW =
    window.innerWidth - 2 * px('--reserve-x') - px('--reserve-left') - px('--reserve-right');
  const availH = window.innerHeight - px('--reserve-top') - px('--reserve-bottom');
  // The largest 2:1 rectangle that fits the reserved band. Fit — never floor to
  // a minimum — so a very short/narrow band yields a small map rather than one
  // that overflows onto the surrounding chrome (search strip / time slider).
  const fit = Math.max(1, Math.min(availW, availH * 2));
  mapW = Math.floor(fit);
  mapH = Math.floor(mapW / 2);

  frameEl.style.width = `${mapW}px`;
  frameEl.style.height = `${mapH}px`;
  canvas.style.width = `${mapW}px`;
  canvas.style.height = `${mapH}px`;
  canvas.width = Math.floor(mapW * dpr);
  canvas.height = Math.floor(mapH * dpr);
}

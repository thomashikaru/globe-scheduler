// The 3D globe: a photoreal earth whose day/night terminator is driven by the
// real sun position, plus a thin IANA time-zone boundary overlay.
//
// The day/night blend follows globe.gl's official day-night-cycle example: a
// ShaderMaterial mixes a daytime and a nighttime earth texture based on how each
// surface point faces the sun, giving a soft, accurate terminator for free.

import Globe from 'globe.gl';
import * as THREE from 'three';
import { subsolarPoint, isDaylight } from './solar.js';
import { subscribe, effectiveDate } from './state.js';
import { formatLocalTime } from './time.js';

// Assets live in /public and are served from the app's base path (which is a
// subpath like "/globe-scheduler/" on GitHub Pages), so resolve them against
// import.meta.env.BASE_URL rather than the server root.
const BASE = import.meta.env.BASE_URL;
const DAY_TEXTURE = `${BASE}earth-day.jpg`;
const NIGHT_TEXTURE = `${BASE}earth-night.jpg`;
const BUMP_TEXTURE = `${BASE}earth-topology.png`;
const TZ_GEOJSON = `${BASE}timezones.geojson`;

const dayNightShader = {
  vertexShader: `
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    #define PI 3.141592653589793
    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform vec2 sunPosition;
    uniform vec2 globeRotation;
    varying vec3 vNormal;
    varying vec2 vUv;

    float toRad(in float a) { return a * PI / 180.0; }

    vec3 Polar2Cartesian(in vec2 c) { // [lng, lat]
      float theta = toRad(90.0 - c.x);
      float phi = toRad(90.0 - c.y);
      return vec3(
        sin(phi) * cos(theta),
        cos(phi),
        sin(phi) * sin(theta)
      );
    }

    void main() {
      float invLon = toRad(globeRotation.x);
      float invLat = -toRad(globeRotation.y);
      mat3 rotX = mat3(1, 0, 0, 0, cos(invLat), -sin(invLat), 0, sin(invLat), cos(invLat));
      mat3 rotY = mat3(cos(invLon), 0, sin(invLon), 0, 1, 0, -sin(invLon), 0, cos(invLon));
      vec3 rotatedSunDirection = rotX * rotY * Polar2Cartesian(sunPosition);
      float intensity = dot(normalize(vNormal), normalize(rotatedSunDirection));
      vec4 dayColor = texture2D(dayTexture, vUv);
      vec4 nightColor = texture2D(nightTexture, vUv);
      // Soft twilight band around the terminator.
      float blendFactor = smoothstep(-0.12, 0.12, intensity);
      gl_FragColor = mix(nightColor, dayColor, blendFactor);
    }
  `
};

let world = null;
let globeMaterial = null;
let globeEl = null; // the #globe container, kept so we can re-fit on resize / re-show
let lastMarkerIds = ''; // rebuild the on-sphere markers only when the pin set changes

export function initGlobe(container) {
  globeEl = container;

  const loader = new THREE.TextureLoader();

  globeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      dayTexture: { value: loader.load(DAY_TEXTURE) },
      nightTexture: { value: loader.load(NIGHT_TEXTURE) },
      sunPosition: { value: new THREE.Vector2() },
      globeRotation: { value: new THREE.Vector2() }
    },
    vertexShader: dayNightShader.vertexShader,
    fragmentShader: dayNightShader.fragmentShader
  });

  world = new Globe(container)
    .globeMaterial(globeMaterial)
    .bumpImageUrl(BUMP_TEXTURE)
    .backgroundColor('#05070d')
    .showAtmosphere(true)
    .atmosphereColor('#7aa2ff')
    .atmosphereAltitude(0.18)
    // The shader lights the globe in the camera's rotated frame, so it needs to
    // know the current point-of-view orientation.
    .onZoom(({ lng, lat }) =>
      globeMaterial.uniforms.globeRotation.value.set(lng, lat)
    );

  // A gentle starting view and slow idle spin (stops as soon as the user drags).
  world.pointOfView({ lat: 20, lng: 0, altitude: 2.5 });
  const controls = world.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
  });

  loadTimezoneBoundaries();
  resizeGlobe();
  window.addEventListener('resize', resizeGlobe);

  // Drive the terminator AND the on-sphere city markers from the store. Owned by
  // this (lazily loaded) module so the map-only default view never imports the 3D
  // stack; the flat map manages its own pins independently in flatmap.js.
  // subscribe() fires once immediately, so the sun and any already-added pins are
  // correct as soon as the globe mounts, then track every state change.
  subscribe((state) => {
    updateSun(effectiveDate());
    const ids = state.pins.map((p) => p.id).join(',');
    if (ids !== lastMarkerIds) {
      lastMarkerIds = ids;
      rebuildMarkers(state.pins);
    }
    const date = effectiveDate();
    for (const p of state.pins) updateMarker(p, date);
  });

  // Dev-only handle for local verification/debugging (stripped from prod builds).
  if (import.meta.env.DEV) window.__world = world;

  // Resolve once globe.gl reports its first render is done (base sphere +
  // textures uploaded to the GPU). The loading gate awaits this so the globe's
  // heavy first paint happens on the loading screen — not on the click that
  // reveals it, which is what made the button feel frozen for seconds.
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(world);
    };
    world.onGlobeReady(finish);
    setTimeout(finish, 8000); // fallback so a missed event can't hang the loader
  });
}

/**
 * Fit the WebGL renderer to the container's current size. Safe to call
 * repeatedly — used on init, on window resize, and when the globe view is shown.
 * The #globe container stays laid out at all times (the map covers it rather than
 * hiding it via display:none), so clientWidth/Height are valid whenever the globe
 * exists; the guard below is just defensive.
 */
export function resizeGlobe() {
  if (!world || !globeEl) return;
  const w = globeEl.clientWidth;
  const h = globeEl.clientHeight;
  if (!w || !h) return; // not yet laid out — nothing meaningful to set
  world.width(w).height(h);
}

// Draw the time-zone boundaries as plain lines (pathsData), NOT filled polygons.
// globe.gl's polygon layer triangulates AND extrudes every polygon — hundreds of
// high-vertex time-zone shapes — which blocked the main thread for ~4–10s on the
// first show of the globe (measured 1.9s + 4.5s long tasks). The boundaries were
// only ever visible via their stroke anyway, so lines give the same look with no
// tessellation, and the globe appears instantly instead of freezing the UI.
async function loadTimezoneBoundaries() {
  try {
    const res = await fetch(TZ_GEOJSON);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geo = await res.json();
    const features = (geo.features || []).filter(
      (f) => f.geometry && f.geometry.type && f.geometry.coordinates
    );
    world
      .pathsData(featuresToBoundaryPaths(features))
      .pathPointLat((p) => p[1])
      .pathPointLng((p) => p[0])
      .pathPointAlt(0.004)
      .pathColor(() => 'rgba(255,255,255,0.28)')
      .pathStroke(null) // thin hairline — far cheaper than fat (Line2) strokes
      .pathResolution(1) // straight chords between the (already dense) points
      .pathTransitionDuration(0);
  } catch (err) {
    // Non-fatal: the globe still works without the time-zone overlay.
    console.warn('Time-zone boundaries unavailable:', err.message);
  }
}

// Flatten polygon rings into open line paths, breaking each ring wherever it
// crosses the antimeridian so no segment draws straight across the globe.
function featuresToBoundaryPaths(features) {
  const paths = [];
  for (const f of features) {
    const geom = f.geometry;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    for (const poly of polys) {
      for (const ring of poly) {
        let seg = [];
        let prevLng = null;
        for (const pt of ring) {
          const lng = pt[0];
          if (prevLng !== null && Math.abs(lng - prevLng) > 180) {
            if (seg.length > 1) paths.push(seg);
            seg = [];
          }
          seg.push(pt);
          prevLng = lng;
        }
        if (seg.length > 1) paths.push(seg);
      }
    }
  }
  return paths;
}

// ---------- on-sphere city markers ----------
// The globe renders each pin as an HTML marker (card + needle + dot). The left
// "Locations" panel is rendered separately in pins.js, and the flat map keeps its
// own pins in flatmap.js — each renderer owns its pin views.

function rebuildMarkers(pins) {
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
      // callback's initial updateMarker pass — so seed the time/badge here or the
      // marker would stay blank until the next state change.
      updateMarker(d, effectiveDate());
      return el;
    })
    .htmlElementVisibilityModifier((el, isVisible) => {
      // Fade markers that rotate to the back of the globe.
      el.style.opacity = isVisible ? '1' : '0';
    });
}

function updateMarker(p, date) {
  if (p._badge) p._badge.textContent = isDaylight(date, p.lat, p.lng) ? '☀️' : '🌙';
  if (p._clock) p._clock.textContent = formatLocalTime(date, p.tz);
}

/** Point the terminator at wherever the sun is for the given instant. */
export function updateSun(date) {
  if (!globeMaterial) return;
  globeMaterial.uniforms.sunPosition.value.set(...subsolarPoint(date));
}

export function getWorld() {
  return world;
}

// The 3D globe: a photoreal earth whose day/night terminator is driven by the
// real sun position, plus a thin IANA time-zone boundary overlay.
//
// The day/night blend follows globe.gl's official day-night-cycle example: a
// ShaderMaterial mixes a daytime and a nighttime earth texture based on how each
// surface point faces the sun, giving a soft, accurate terminator for free.

import Globe from 'globe.gl';
import * as THREE from 'three';
import { subsolarPoint } from './solar.js';

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

export function initGlobe(container) {
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
  handleResize(container);

  // Dev-only handle for local verification/debugging (stripped from prod builds).
  if (import.meta.env.DEV) window.__world = world;

  return world;
}

function handleResize(container) {
  const resize = () =>
    world.width(container.clientWidth).height(container.clientHeight);
  resize();
  window.addEventListener('resize', resize);
}

async function loadTimezoneBoundaries() {
  try {
    const res = await fetch(TZ_GEOJSON);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geo = await res.json();
    // Some published time-zone datasets include stray features with null
    // geometry; globe.gl's polygon layer throws on those, so drop them.
    const features = (geo.features || []).filter(
      (f) => f.geometry && f.geometry.type && f.geometry.coordinates
    );
    world
      .polygonsData(features)
      .polygonAltitude(0.004)
      .polygonCapColor(() => 'rgba(0,0,0,0)')
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .polygonStrokeColor(() => 'rgba(255,255,255,0.28)');
  } catch (err) {
    // Non-fatal: the globe still works without the time-zone overlay.
    console.warn('Time-zone boundaries unavailable:', err.message);
  }
}

/** Point the terminator at wherever the sun is for the given instant. */
export function updateSun(date) {
  if (!globeMaterial) return;
  globeMaterial.uniforms.sunPosition.value.set(...subsolarPoint(date));
}

export function getWorld() {
  return world;
}

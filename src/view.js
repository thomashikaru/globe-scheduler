// The Globe / Map view toggle. The flat map is always mounted; the 3D globe
// (three.js + globe.gl, ~2 MB chunk plus textures and time-zone data) is a
// separate lazily-loaded module so the default Map view loads fast. To make the
// eventual switch feel instant, we warm the globe up in the BACKGROUND while the
// user is still on the map (see warmGlobe + main.js) — downloading, parsing, and
// mounting it during idle time so it's ready before it's ever shown.
//
// We deliberately DON'T `display:none` the globe to hide it. The flat map
// (#flatmap) is a full-viewport, opaque, fixed layer painted above #globe, so in
// Map view it already covers the globe completely — hiding it again with
// display:none only tears down the globe's layout and WebGL compositor layer.
// Keeping #globe laid out means the globe is always mounted into a stable
// container (even while warming behind the map) and keeps a valid size across
// view switches; we just pause its render loop while the map covers it.

import { redrawFlatmap } from './flatmap.js';

// Resolved once the globe module has been dynamically imported and mounted.
let globe = null; // the globe.js module namespace
let globeLoading = null; // in-flight import promise (guards against double-load)
let activeView = 'map'; // which view is currently on screen

/** Import globe.js on demand and mount it into the (always laid-out) container. */
function ensureGlobe() {
  if (globe) return Promise.resolve(globe);
  if (!globeLoading) {
    globeLoading = import('./globe.js')
      .then(async (mod) => {
        await mod.initGlobe(document.getElementById('globe')); // resolves on first render
        globe = mod;
        return mod;
      })
      .catch((err) => {
        globeLoading = null; // drop the failed attempt so a later click can retry
        console.error('[globe] failed to load:', err);
        throw err;
      });
  }
  return globeLoading;
}

// Run the globe's render loop only when it's the active view, so it never spins
// (burning GPU) while mounted behind the map. Safe before the globe has loaded.
function syncGlobeAnimation() {
  const world = globe?.getWorld?.();
  if (!world) return;
  if (activeView === 'globe') world.resumeAnimation?.();
  else world.pauseAnimation?.();
}

/**
 * Begin loading + mounting the globe in the background so a later switch to Globe
 * view is instant. It mounts behind the opaque map with its render loop paused.
 * Idempotent; assets (textures, time-zone GeoJSON) are shared with the map, so by
 * the time this runs after the map has loaded they're mostly cached already.
 */
export function warmGlobe() {
  // If the user reaches Globe view before this resolves, syncGlobeAnimation()
  // leaves it running; otherwise it parks it paused behind the map. Returns the
  // load promise so the initial loading gate can wait for the globe to be ready.
  return ensureGlobe().then(syncGlobeAnimation);
}

export function initViewToggle() {
  const mapEl = document.getElementById('flatmap');
  const btnGlobe = document.getElementById('view-globe');
  const btnMap = document.getElementById('view-map');

  function setPressed(isMap) {
    btnGlobe.classList.toggle('active', !isMap);
    btnMap.classList.toggle('active', isMap);
    btnGlobe.setAttribute('aria-pressed', String(!isMap));
    btnMap.setAttribute('aria-pressed', String(isMap));
  }

  async function setView(view) {
    if (view === 'map') {
      activeView = 'map';
      setPressed(true);
      globe?.getWorld?.()?.pauseAnimation?.();
      // Only the map's visibility is toggled; #globe stays laid out underneath
      // it (see file header). The opaque map hides the globe in map view.
      mapEl.hidden = false;
      redrawFlatmap();
      return;
    }

    // Globe view. The 3D globe is a lazily-loaded chunk; when warm it mounts
    // instantly, but on a cold first switch it can take a moment to download and
    // initialize. Rather than hiding the map (blanking to an empty #globe while
    // it loads — which reads as a broken button), keep the interactive map on
    // screen with a spinner on the button, and only reveal the globe once it's
    // actually mounted. The click registers immediately either way.
    activeView = 'globe';
    if (!globe) {
      btnGlobe.classList.add('loading');
      btnGlobe.setAttribute('aria-busy', 'true');
      try {
        await ensureGlobe();
      } catch {
        // Download/mount failed — stay on the map instead of stranding a blank.
        btnGlobe.classList.remove('loading');
        btnGlobe.removeAttribute('aria-busy');
        setView('map');
        return;
      }
      btnGlobe.classList.remove('loading');
      btnGlobe.removeAttribute('aria-busy');
      // The user may have switched back to Map while the globe was loading.
      if (activeView !== 'globe') return;
    }

    globe.resizeGlobe(); // re-fit before revealing (container size may have changed)
    mapEl.hidden = true; // reveal the now-mounted globe
    setPressed(false);
    syncGlobeAnimation();
  }

  btnGlobe.addEventListener('click', () => setView('globe'));
  btnMap.addEventListener('click', () => setView('map'));
  setView('map');
}

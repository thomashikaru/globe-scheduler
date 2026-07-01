// The Globe / Map view toggle. Both renderers are always mounted and subscribed
// to the store; toggling just swaps which one is visible (and pauses the globe's
// WebGL loop while it is hidden).

import { getWorld } from './globe.js';
import { redrawFlatmap } from './flatmap.js';

export function initViewToggle() {
  const globeEl = document.getElementById('globe');
  const mapEl = document.getElementById('flatmap');
  const btnGlobe = document.getElementById('view-globe');
  const btnMap = document.getElementById('view-map');

  function setView(view) {
    const isMap = view === 'map';
    mapEl.hidden = !isMap;
    globeEl.style.display = isMap ? 'none' : '';

    btnGlobe.classList.toggle('active', !isMap);
    btnMap.classList.toggle('active', isMap);
    btnGlobe.setAttribute('aria-pressed', String(!isMap));
    btnMap.setAttribute('aria-pressed', String(isMap));

    const world = getWorld();
    if (world) {
      // Feature-detected: globe.gl exposes these via three-render-objects.
      if (isMap) world.pauseAnimation?.();
      else world.resumeAnimation?.();
    }
    if (isMap) redrawFlatmap();
  }

  btnGlobe.addEventListener('click', () => setView('globe'));
  btnMap.addEventListener('click', () => setView('map'));
  setView('map');
}

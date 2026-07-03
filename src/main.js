// Entry point: mount the 2D map + UI and connect everything to the store. One
// state change updates all clocks and badges together.
//
// The 3D globe (three.js + globe.gl, ~2.6 MB) is a separate chunk loaded on
// demand. We load it IN PARALLEL with the map during first load and hold the
// loading overlay up until BOTH are ready — so when the overlay lifts every
// control works immediately, including the Globe toggle. Without this there is a
// window where the map looks ready but the globe isn't, and clicking Globe does
// nothing. The globe owns its own sun subscription (see globe.js).

import './style.css';
import { initFlatmap } from './flatmap.js';
import { initViewToggle, warmGlobe } from './view.js';
import { initSearch } from './search.js';
import { initPins } from './pins.js';
import { initSlider } from './slider.js';
import { initCalendar } from './calendar.js';
import { refreshNow } from './state.js';

// The overlay (in index.html) covers the page and blocks clicks until both the
// map and the globe are ready; its progress bar advances across all of them:
// 3 map assets + the globe mounted = 4 steps.
const loader = document.getElementById('loading');
const loaderBar = document.getElementById('loading-bar');
let stepsDone = 0;
const TOTAL_STEPS = 4;
const tick = () => {
  stepsDone += 1;
  if (loaderBar) loaderBar.style.transform = `scaleX(${Math.min(stepsDone / TOTAL_STEPS, 1)})`;
};

const mapReady = initFlatmap(tick); // ticks 3× as its assets load
const globeReady = warmGlobe(); // starts the globe chunk now, in parallel
globeReady.then(tick, tick); // one tick when the globe mounts (or fails)

initSearch();
initPins();
initSlider();
initViewToggle();
initCalendar();

// Reveal the app only once the map is painted AND the globe is mounted. allSettled
// so a globe load failure still dismisses the overlay (the map stays usable).
Promise.allSettled([mapReady, globeReady]).then(() => dismissLoader(loader, loaderBar));

function dismissLoader(el, bar) {
  const done = () => {
    el?.remove();
    // Drop the toggle back to its normal stacking order now the overlay is gone.
    document.body.classList.remove('app-loading');
  };
  if (!el) return done();
  if (bar) bar.style.transform = 'scaleX(1)';
  el.classList.add('done'); // fade out via CSS
  el.addEventListener('transitionend', done, { once: true });
  // Belt-and-braces: remove even if the transition never fires (e.g. tab hidden).
  setTimeout(done, 900);
}

// Keep "now" live (only has a visible effect while the slider sits at 0).
setInterval(refreshNow, 60_000);

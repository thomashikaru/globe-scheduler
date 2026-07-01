// Entry point: mount the globe, wire up the UI, and connect everything to the
// store. One state change updates the sun, all clocks, and all badges together.

import './style.css';
import { initGlobe, updateSun } from './globe.js';
import { initFlatmap } from './flatmap.js';
import { initViewToggle } from './view.js';
import { initSearch } from './search.js';
import { initPins } from './pins.js';
import { initSlider } from './slider.js';
import { initCalendar } from './calendar.js';
import { subscribe, effectiveDate, refreshNow } from './state.js';

initGlobe(document.getElementById('globe'));
initFlatmap();
initSearch();
initPins();
initSlider();
initViewToggle();
initCalendar();

// Drive the day/night terminator from the current reference instant.
subscribe(() => updateSun(effectiveDate()));

// Keep "now" live (only has a visible effect while the slider sits at 0).
setInterval(refreshNow, 60_000);

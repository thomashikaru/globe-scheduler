// Tiny pub/sub store. The whole app is driven by two pieces of state:
//   offsetMinutes — how far the slider has shifted the reference time from "now"
//   pins          — the list of cities the user has added
//
// Everything visible (the terminator, every clock, every badge) is derived from
// these on each notify(), so there is exactly one source of truth.

// Snap "now" to the nearest quarter-hour so every clock reads a round time
// (e.g. 17:30, never 17:27) — the slider then steps in clean 15-minute jumps.
function roundToQuarterHour(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15); // 60 rolls the hour over
  return d;
}

let baseNow = roundToQuarterHour(new Date());

const state = {
  offsetMinutes: 0,
  pins: [] // { id, name, country, lat, lng, tz, el? }
};

const subscribers = new Set();

function notify() {
  for (const fn of subscribers) fn(state);
}

export function subscribe(fn) {
  subscribers.add(fn);
  fn(state); // fire once immediately so views render their initial state
  return () => subscribers.delete(fn);
}

export function getState() {
  return state;
}

/** The absolute instant currently being explored (baseNow + slider offset). */
export function effectiveDate() {
  return new Date(baseNow.getTime() + state.offsetMinutes * 60000);
}

/** True when the slider is parked at the real current time. */
export function isNow() {
  return state.offsetMinutes === 0;
}

export function setOffset(minutes) {
  state.offsetMinutes = minutes;
  notify();
}

/**
 * Point the whole app at an absolute instant, expressed as an offset from the
 * current "now". Lets the calendar composer scrub every clock to a specific
 * date/time (the slider only spans ±24h, but the offset itself is unbounded).
 */
export function setEffectiveDate(date) {
  setOffset(Math.round((date.getTime() - baseNow.getTime()) / 60000));
}

/** Refresh what "now" means (called on a timer) so the app stays live at offset 0. */
export function refreshNow() {
  baseNow = roundToQuarterHour(new Date());
  notify();
}

let nextId = 1;

export function addPin(city) {
  // Ignore exact duplicates (same coordinates).
  if (state.pins.some((p) => p.lat === city.lat && p.lng === city.lng)) return;
  state.pins.push({ id: nextId++, ...city });
  notify();
}

export function removePin(id) {
  const i = state.pins.findIndex((p) => p.id === id);
  if (i !== -1) {
    state.pins.splice(i, 1);
    notify();
  }
}

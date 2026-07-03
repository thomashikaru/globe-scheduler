// Tiny pub/sub store. The whole app is driven by two pieces of state:
//   refInstant — the absolute instant being explored, in ms; null means "live now"
//   pins       — the list of cities the user has added
//
// Everything visible (the terminator, every clock, every badge) is derived from
// these on each notify(), so there is exactly one source of truth.
//
// A concrete instant (not an offset-from-now) is the source of truth so a chosen
// meeting time — "Tomorrow 09:00" — stays put as real time advances. Only the
// "live now" mode (refInstant === null) tracks the wall clock.

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
  refInstant: null, // ms of the pinned instant, or null while tracking "now"
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

/** The absolute instant currently being explored (a pinned instant, or "now"). */
export function effectiveDate() {
  return new Date(state.refInstant ?? baseNow.getTime());
}

/** True when nothing is pinned, so the app tracks the real current time. */
export function isNow() {
  return state.refInstant === null;
}

/**
 * Pin the whole app to an absolute instant, so every clock, badge and the
 * terminator freeze there. Used by the slider (a time-of-day on a chosen day)
 * and the calendar composer alike; the instant is unbounded, unlike the slider.
 */
export function setEffectiveDate(date) {
  state.refInstant = date.getTime();
  notify();
}

/** Un-pin: return to tracking the real current time. */
export function resetToNow() {
  state.refInstant = null;
  notify();
}

/** Refresh what "now" means (called on a timer); only visible while un-pinned. */
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

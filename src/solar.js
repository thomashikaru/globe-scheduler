// Solar geometry: where the sun is, so the globe shader and the per-pin day/night
// badges agree. Both are pure functions of an absolute instant.

import * as solar from 'solar-calculator';
import SunCalc from 'suncalc';

/**
 * The subsolar point — the [lng, lat] where the sun is directly overhead at
 * `date`. Feeding this to the day/night shader draws an astronomically accurate
 * terminator (accounts for seasonal tilt via declination and the equation of
 * time). Mirrors globe.gl's day-night-cycle example.
 */
export function subsolarPoint(date) {
  const day = new Date(+date).setUTCHours(0, 0, 0, 0);
  const t = solar.century(date);
  const longitude = ((day - date) / 864e5) * 360 - 180;
  return [longitude - solar.equationOfTime(t) / 4, solar.declination(t)];
}

/** True when the sun is above the horizon at (lat, lng) for the given instant. */
export function isDaylight(date, lat, lng) {
  return SunCalc.getPosition(date, lat, lng).altitude > 0;
}

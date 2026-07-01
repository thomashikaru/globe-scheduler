// Downloads the simplified world time-zone boundaries (GeoJSON, ~1 MB, real land
// borders + ocean zones grouped by UTC offset) into public/. Runs offline after
// the first fetch. Re-run with `npm run data:tz`.
//
// Source: treyerl/timezones (simplified from the classic tz_world dataset).
// A stray feature with null geometry is filtered at load time in src/globe.js.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL =
  'https://raw.githubusercontent.com/treyerl/timezones/master/timezones_wVVG8.geojson';
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/timezones.geojson');

const res = await fetch(URL);
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const text = await res.text();
JSON.parse(text); // validate it parses

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text);
console.log(`Wrote ${(text.length / 1024).toFixed(0)} KB to ${OUT}`);

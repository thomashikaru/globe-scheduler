// Generates src/data/cities.json — the top-N most populous world cities with an
// IANA time zone each — from the offline `all-the-cities` dataset. Fully local:
// no network, no API keys. Re-run with `npm run data:cities`.

import allCities from 'all-the-cities';
import tzlookup from 'tz-lookup';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/cities.json');
const LIMIT = 10000; // top cities by population — covers all major cities

const sorted = [...allCities]
  .sort((a, b) => b.population - a.population)
  .slice(0, LIMIT);

const round4 = (n) => Math.round(n * 1e4) / 1e4;

const out = [];
for (const c of sorted) {
  const [lng, lat] = c.loc.coordinates;
  let tz;
  try {
    tz = tzlookup(lat, lng);
  } catch {
    continue; // skip anything tz-lookup can't resolve
  }
  out.push({
    name: c.name,
    country: c.country, // ISO-3166 alpha-2 (e.g. "JP")
    lat: round4(lat),
    lng: round4(lng),
    tz,
    pop: c.population
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${out.length} cities to ${OUT}`);

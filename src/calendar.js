// "Add to Calendar": compose a Google Calendar event for the instant the user
// has scrubbed to. Opening the composer docks a panel to the right edge (the
// globe/map stays visible) and hands control of the reference time to the
// date/time inputs, so every city clock updates live as the user edits — they
// can confirm the meeting time across locations before creating the link.
//
// The link is built by URL construction only (no API/keys): Google Calendar's
// render endpoint takes the event as query parameters.
//   https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…

import {
  subscribe,
  getState,
  effectiveDate,
  resetToNow,
  setEffectiveDate
} from './state.js';
import { isDaylight } from './solar.js';
import { formatLocalTime, formatUtcOffset } from './time.js';

const CAL_BASE = 'https://calendar.google.com/calendar/render';

// Keep the event body (and therefore the URL) bounded. Ten is far more than a
// real meeting needs; beyond that we summarise the remainder instead of listing
// every city, so an adversarial pin-count can't bloat the link.
const MAX_DETAIL_CITIES = 10;
const MAX_TITLE_LEN = 200;
const MAX_LOCATION_LEN = 300;

// Matches control characters (incl. newlines/tabs). Stripped from free-text so
// they can't break the URL or hide an obfuscated scheme.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

// URL schemes that have no business in a location/link field. Anything starting
// with one (after leading whitespace) is dropped rather than encoded.
const BLOCKED_SCHEME = /^\s*(javascript|data|vbscript|file):/i;

export function initCalendar() {
  const btn = document.getElementById('calendar-btn');
  const dialog = document.getElementById('calendar-dialog');
  const closeBtn = document.getElementById('cal-close');
  const titleInput = document.getElementById('cal-title');
  const dateInput = document.getElementById('cal-date');
  const timeInput = document.getElementById('cal-time');
  const durationSelect = document.getElementById('cal-duration');
  const locationInput = document.getElementById('cal-location');
  const citiesBox = document.getElementById('cal-cities');
  const cityList = document.getElementById('cal-city-list');
  const confirmBtn = document.getElementById('cal-confirm');
  const resultBox = document.getElementById('cal-result');
  const linkInput = document.getElementById('cal-link');
  const copyBtn = document.getElementById('cal-copy');
  const openLink = document.getElementById('cal-open');

  // The time field is a dropdown of quarter-hour slots (00:00 … 23:45) so it
  // steps in 15-minute increments like the slider — native <input type="time">
  // step handling isn't consistent across browsers.
  populateTimeOptions(timeInput);

  let isOpen = false;
  let savedRef = null; // reference instant to restore when the composer closes
  let desired = null; // absolute instant (ms) currently chosen in the inputs

  // ----- open / close -------------------------------------------------------

  function open() {
    if (isOpen) return;
    isOpen = true;
    savedRef = getState().refInstant;

    // Seed the editable fields from the instant currently on screen.
    const now = effectiveDate();
    setDateTimeInputs(now);
    // Events are in the future, so never let the date field go earlier than today.
    dateInput.min = toDateValue(new Date());
    desired = readInstant()?.getTime() ?? now.getTime();
    if (!titleInput.value.trim()) titleInput.value = defaultTitle();

    dialog.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    // Reserve space on the right (desktop) so the map slides over and stays
    // fully visible while composing; the resize re-fits the flat map + globe.
    document.body.classList.add('cal-open');
    window.dispatchEvent(new Event('resize'));
    syncCities();
    titleInput.focus();
    titleInput.select();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    dialog.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('cal-open');
    window.dispatchEvent(new Event('resize'));
    // Hand the reference time back to the slider — live if it was live before.
    if (savedRef === null) resetToNow();
    else setEffectiveDate(new Date(savedRef));
  }

  btn.addEventListener('click', () => (isOpen ? close() : open()));
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
  });

  // ----- editing ------------------------------------------------------------

  // Any change to date/time re-points the whole app at that instant so the
  // globe, pins and side panel update; other edits just refresh the preview.
  function onTimeEdit() {
    const instant = readInstant();
    if (!instant) return;
    desired = instant.getTime();
    setEffectiveDate(instant); // notifies -> syncCities() runs via subscribe
    refreshLink();
  }

  dateInput.addEventListener('input', onTimeEdit);
  timeInput.addEventListener('input', onTimeEdit);
  durationSelect.addEventListener('input', refreshLink);
  titleInput.addEventListener('input', refreshLink);
  locationInput.addEventListener('input', refreshLink);

  confirmBtn.addEventListener('click', () => {
    if (!refreshLink()) return;
    resultBox.hidden = false;
    linkInput.focus();
    linkInput.select();
  });

  copyBtn.addEventListener('click', async () => {
    const link = linkInput.value;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      linkInput.select(); // clipboard API blocked (e.g. non-secure context)
      document.execCommand('copy');
    }
    flashCopied(copyBtn);
  });

  // ----- store subscription -------------------------------------------------

  subscribe(() => {
    if (!isOpen) return;
    // "Now" advances on a timer; re-assert the chosen instant so the meeting
    // time can't silently drift while the composer is open.
    if (desired != null && effectiveDate().getTime() !== desired) {
      setEffectiveDate(new Date(desired));
      return; // the setEffectiveDate above re-enters this callback
    }
    syncCities();
    if (!resultBox.hidden) refreshLink();
  });

  // ----- helpers ------------------------------------------------------------

  function setDateTimeInputs(d) {
    dateInput.value = toDateValue(d);
    timeInput.value = toTimeValue(d);
  }

  /** The instant described by the date+time inputs, in the browser's zone. */
  function readInstant() {
    const [y, mo, da] = (dateInput.value || '').split('-').map(Number);
    const [h, mi] = (timeInput.value || '').split(':').map(Number);
    if ([y, mo, da, h, mi].some((n) => !Number.isFinite(n))) return null;
    return new Date(y, mo - 1, da, h, mi, 0, 0);
  }

  function defaultTitle() {
    const names = getState().pins.map((p) => p.name);
    if (!names.length) return 'Meeting';
    if (names.length === 1) return `Call with ${names[0]}`;
    if (names.length === 2) return `Call with ${names[0]} & ${names[1]}`;
    return `Call with ${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }

  function syncCities() {
    const pins = getState().pins;
    citiesBox.hidden = pins.length === 0;
    const date = effectiveDate();
    cityList.innerHTML = '';
    for (const p of pins) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="cal-city-badge"></span>
        <span class="cal-city-name"></span>
        <span class="cal-city-clock"></span>`;
      li.querySelector('.cal-city-badge').textContent = isDaylight(date, p.lat, p.lng)
        ? '☀️'
        : '🌙';
      li.querySelector('.cal-city-name').textContent = `${p.name}, ${p.country}`;
      li.querySelector('.cal-city-clock').textContent =
        `${formatLocalTime(date, p.tz)} · ${formatUtcOffset(date, p.tz)}`;
      cityList.appendChild(li);
    }
  }

  /** Rebuild the Google Calendar link from the current fields. Returns false
   *  (and leaves inputs flagged) when the date/time is incomplete. */
  function refreshLink() {
    const start = readInstant();
    if (!start) {
      dateInput.setAttribute('aria-invalid', 'true');
      return false;
    }
    dateInput.removeAttribute('aria-invalid');

    // Flag (but tolerate) a location we had to reject, so the user gets feedback.
    const rawLocation = locationInput.value.trim();
    const location = sanitizeLocation(locationInput.value);
    if (rawLocation && !location) locationInput.setAttribute('aria-invalid', 'true');
    else locationInput.removeAttribute('aria-invalid');

    const minutes = parseInt(durationSelect.value, 10) || 60;
    const end = new Date(start.getTime() + minutes * 60000);
    const url = buildCalendarUrl({
      title: sanitizeText(titleInput.value, MAX_TITLE_LEN) || 'Meeting',
      start,
      end,
      location,
      details: buildDetails(getState().pins, start)
    });

    linkInput.value = url;
    openLink.href = url;
    return true;
  }
}

// ----- pure URL construction (exported for clarity/testing) -----------------

/** Format a Date as Google Calendar's compact UTC stamp, e.g. 20260630T140000Z. */
function toGCalStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function buildDetails(pins, instant) {
  const lines = [];
  if (pins.length) {
    lines.push('Local times:');
    for (const p of pins.slice(0, MAX_DETAIL_CITIES)) {
      lines.push(`• ${p.name}, ${p.country} — ${formatLocalTime(instant, p.tz)}`);
    }
    const extra = pins.length - MAX_DETAIL_CITIES;
    if (extra > 0) lines.push(`…and ${extra} more`);
    lines.push('');
  }
  lines.push('Created with Globe Scheduler — https://thomashikaru.github.io/globe-scheduler');
  return lines.join('\n');
}

/** Strip control characters and cap length — for single-line free text. */
function sanitizeText(raw, max) {
  return raw
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Clean the optional location/link field. Removes control characters (which
 * could hide an obfuscated scheme or break the URL), caps the length, and
 * rejects dangerous URL schemes outright — a Zoom/WhatsApp link is http(s) and
 * a plain address has no scheme, so javascript:/data:/vbscript:/file: are never
 * legitimate here. Returns '' for a blocked or empty value.
 */
function sanitizeLocation(raw) {
  const cleaned = raw.replace(CONTROL_CHARS, '').trim().slice(0, MAX_LOCATION_LEN);
  return BLOCKED_SCHEME.test(cleaned) ? '' : cleaned;
}

export function buildCalendarUrl({ title, start, end, location, details }) {
  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(title)}`,
    // dates keeps a literal "/" between the two UTC stamps (Google's format).
    `dates=${toGCalStamp(start)}/${toGCalStamp(end)}`,
    details ? `details=${encodeURIComponent(details)}` : '',
    location ? `location=${encodeURIComponent(location)}` : ''
  ].filter(Boolean);
  return `${CAL_BASE}?${params.join('&')}`;
}

// ----- small UI helpers -----------------------------------------------------

function toDateValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toTimeValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Fill a <select> with "HH:mm" options every 15 minutes across the day. */
function populateTimeOptions(select) {
  const p = (n) => String(n).padStart(2, '0');
  const frag = document.createDocumentFragment();
  for (let m = 0; m < 24 * 60; m += 15) {
    const value = `${p(Math.floor(m / 60))}:${p(m % 60)}`;
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    frag.appendChild(opt);
  }
  select.appendChild(frag);
}

function flashCopied(button) {
  const original = button.textContent;
  button.textContent = 'Copied!';
  button.classList.add('copied');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('copied');
  }, 1400);
}

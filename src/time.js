// Formatting helpers. All clocks in the app show the SAME absolute instant,
// each rendered in its own IANA time zone via Intl — no manual offset math, so
// there is no chance of AM/PM drift between locations.

const clockCache = new Map();
function clockFormatter(tz) {
  let f = clockCache.get(tz);
  if (!f) {
    // 24-hour + weekday: unambiguous, sidesteps AM/PM confusion.
    f = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    clockCache.set(tz, f);
  }
  return f;
}

/** e.g. "Tue 09:30" — local wall-clock time at `tz` for the given instant. */
export function formatLocalTime(date, tz) {
  try {
    return clockFormatter(tz).format(date);
  } catch {
    return '—';
  }
}

/** Signed hour offset from UTC at `tz` for `date`, e.g. "UTC+9", "UTC−5:30". */
export function formatUtcOffset(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    }).formatToParts(date);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return tzName.replace('GMT', 'UTC').replace('-', '−');
  } catch {
    return '';
  }
}

/** A friendly readout of the reference instant, e.g. "Now" or "+3h 15m from now". */
export function formatOffsetLabel(offsetMinutes) {
  if (offsetMinutes === 0) return 'Now';
  const sign = offsetMinutes > 0 ? '+' : '−';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const hm = [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
  return `${sign}${hm} from now`;
}

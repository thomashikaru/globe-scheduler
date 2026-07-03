// The time control: three day pills (Today / Tomorrow / Choose date…) sitting
// above a 24-hour slider. Together they pin the whole app to a specific instant
// — a time-of-day on a chosen day — and the store notifies everything else.
//
// The slider spans one day: value 0 = 12am, 1440 = the next 12am, stepping in
// 15-minute slots. On "today" the slots earlier than now are greyed out and the
// thumb is clamped so a meeting can't be scheduled in the past.

import {
  subscribe,
  effectiveDate,
  setEffectiveDate,
  resetToNow,
  isNow
} from './state.js';
import { formatClock, formatShortDate } from './time.js';

const STEP = 15; // slider granularity, matches the quarter-hour clocks
const LAST_SLOT = 24 * 60 - STEP; // 1425 (23:45) — latest slot before rollover

// ----- day/time helpers (browser's local zone, DST-correct via components) ----

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}
/** "Now" as a slot, rounded to the step — the same rounding the store uses for
 *  baseNow, so the live thumb lands exactly on this boundary. Also the earliest
 *  selectable slot on today. */
function nowSlotMinutes() {
  return Math.round(minutesOfDay(new Date()) / STEP) * STEP;
}
/** Value for a native <input type="date"> min, e.g. "2026-07-02". */
function toDateValue(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function initSlider() {
  const slider = document.getElementById('time-slider');
  const label = document.getElementById('time-label');
  const resetBtn = document.getElementById('reset-btn');
  const pillToday = document.getElementById('pill-today');
  const pillTomorrow = document.getElementById('pill-tomorrow');
  const pillDate = document.getElementById('pill-date');
  const dateInput = document.getElementById('pill-date-input');

  // Last day derived from the store, so pill/slider handlers know which day to
  // combine the slider's minutes with. Kept in sync by the subscribe() below.
  let selectedDay = startOfDay(new Date());

  // Clamp minutes into the valid range for `day` (no past slots on today) and
  // pin the app to that instant. Built via components so DST shifts are correct.
  function selectInstant(day, minutes) {
    let mins = Math.max(0, Math.min(LAST_SLOT, minutes));
    if (sameDay(day, new Date())) {
      mins = Math.min(LAST_SLOT, Math.max(mins, nowSlotMinutes()));
    }
    setEffectiveDate(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, mins));
  }

  const sliderMinutes = () => parseInt(slider.value, 10);

  // ----- interaction --------------------------------------------------------

  slider.addEventListener('input', () => selectInstant(selectedDay, sliderMinutes()));
  pillToday.addEventListener('click', () =>
    selectInstant(startOfDay(new Date()), sliderMinutes())
  );
  pillTomorrow.addEventListener('click', () =>
    selectInstant(addDays(startOfDay(new Date()), 1), sliderMinutes())
  );

  // "Choose date…" opens the browser's native calendar (past dates disabled via
  // min). The input is off-screen; the pill is the visible affordance.
  pillDate.addEventListener('click', () => {
    dateInput.min = toDateValue(new Date());
    if (typeof dateInput.showPicker === 'function') {
      try {
        dateInput.showPicker();
        return;
      } catch {
        /* fall through to focus() for browsers that reject showPicker */
      }
    }
    dateInput.focus();
    dateInput.click();
  });
  dateInput.addEventListener('input', () => {
    const [y, mo, da] = (dateInput.value || '').split('-').map(Number);
    if ([y, mo, da].some((n) => !Number.isFinite(n))) return;
    selectInstant(new Date(y, mo - 1, da), sliderMinutes());
  });

  resetBtn.addEventListener('click', resetToNow);

  // ----- store -> UI --------------------------------------------------------

  subscribe(() => {
    const d = effectiveDate();
    const now = new Date();
    const day = startOfDay(d);
    selectedDay = day;

    const isToday = sameDay(day, now);
    const isTomorrow = sameDay(day, addDays(startOfDay(now), 1));

    // Reflect the instant onto the slider (minutes into its day). Guarded so we
    // don't stomp the value mid-drag when it already matches.
    const mins = minutesOfDay(d);
    if (sliderMinutes() !== mins) slider.value = String(mins);

    // Highlight the active pill; the date pill shows the chosen day when custom.
    setPressed(pillToday, isToday);
    setPressed(pillTomorrow, isTomorrow);
    setPressed(pillDate, !isToday && !isTomorrow);
    pillDate.textContent = !isToday && !isTomorrow ? formatShortDate(d) : 'Choose date…';
    dateInput.min = toDateValue(now);

    // Grey the past region (today only): paint the track left of the current
    // slot, offsetting the edge by the thumb radius (10px) so it sits under the
    // thumb centre. Future days have no past, so the grey collapses to 0.
    if (isToday) {
      const frac = Math.min(nowSlotMinutes(), LAST_SLOT) / LAST_SLOT;
      slider.style.setProperty('--past-edge', `calc(10px + ${frac} * (100% - 20px))`);
    } else {
      slider.style.setProperty('--past-edge', '0px');
    }

    // Readout + "Now" button (hidden while already live at the current time).
    const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : formatShortDate(d);
    label.textContent = isNow() ? 'Now' : `${dayLabel} · ${formatClock(d)}`;
    resetBtn.classList.toggle('hidden', isNow());
  });
}

function setPressed(btn, on) {
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.classList.toggle('active', on);
}

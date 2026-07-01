// The time slider (±24h from now) and its readout. Dragging it shifts the whole
// app's reference instant; the store notifies everything else.

import { subscribe, setOffset } from './state.js';
import { formatOffsetLabel } from './time.js';

export function initSlider() {
  const slider = document.getElementById('time-slider');
  const label = document.getElementById('time-label');
  const resetBtn = document.getElementById('reset-btn');

  slider.addEventListener('input', () =>
    setOffset(parseInt(slider.value, 10))
  );
  resetBtn.addEventListener('click', () => setOffset(0));

  subscribe((state) => {
    // Keep the control and readout in sync (e.g. after "Now" resets the offset).
    if (parseInt(slider.value, 10) !== state.offsetMinutes) {
      slider.value = String(state.offsetMinutes);
    }
    label.textContent = formatOffsetLabel(state.offsetMinutes);
    resetBtn.classList.toggle('hidden', state.offsetMinutes === 0);
  });
}

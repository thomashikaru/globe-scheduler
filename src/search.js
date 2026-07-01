// The city search bar: typeahead dropdown with keyboard support. On selection it
// calls addPin(); the globe/list update reactively via the store.

import { searchCities } from './cities.js';
import { addPin } from './state.js';

export function initSearch() {
  const input = document.getElementById('city-input');
  const list = document.getElementById('suggestions');

  let matches = [];
  let active = -1; // highlighted suggestion index

  function close() {
    list.hidden = true;
    list.innerHTML = '';
    matches = [];
    active = -1;
  }

  function render() {
    if (!matches.length) {
      close();
      return;
    }
    list.innerHTML = '';
    matches.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'suggestion' + (i === active ? ' active' : '');
      li.setAttribute('role', 'option');
      li.innerHTML = `<span class="city">${c.name}</span><span class="meta">${c.country}</span>`;
      li.addEventListener('mousedown', (e) => {
        // mousedown (not click) so it fires before the input blurs.
        e.preventDefault();
        choose(i);
      });
      list.appendChild(li);
    });
    list.hidden = false;
  }

  function choose(i) {
    const city = matches[i];
    if (!city) return;
    addPin(city);
    input.value = '';
    input.focus();
    close();
  }

  input.addEventListener('input', () => {
    matches = searchCities(input.value);
    active = matches.length ? 0 : -1;
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        active = (active + 1) % matches.length;
        render();
        break;
      case 'ArrowUp':
        e.preventDefault();
        active = (active - 1 + matches.length) % matches.length;
        render();
        break;
      case 'Enter':
        e.preventDefault();
        choose(active === -1 ? 0 : active);
        break;
      case 'Escape':
        close();
        break;
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 100));
}

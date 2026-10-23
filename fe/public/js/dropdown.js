/*
 * Themed dropdown. Enhances <select data-hv-dropdown> into a button plus listbox popup.
 * The real <select> stays in the DOM (visually hidden), so .value, change events,
 * label clicks and Playwright selectOption keep working. Options are read from the
 * select every time the popup opens, so JS-filled selects need no extra wiring.
 */
const HvDropdown = (() => {
  const CHEVRON = '<svg class="hv-dd__chev" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHECK = '<svg class="hv-dd__check" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  let openState = null;
  let uid = 0;

  function selectedText(select) {
    const opt = select.options[select.selectedIndex];
    return opt ? opt.text : '';
  }

  function labelFor(select) {
    if (select.getAttribute('aria-label')) return { label: select.getAttribute('aria-label') };
    const lab = select.id && document.querySelector('label[for="' + select.id + '"]');
    if (lab) {
      if (!lab.id) lab.id = 'hvddlab' + (++uid);
      return { labelledby: lab.id };
    }
    return {};
  }

  function enhance(select) {
    if (select.dataset.hvDdReady || select.multiple) return;
    select.dataset.hvDdReady = '1';
    const wrap = document.createElement('div');
    wrap.className = 'hv-dd' + (select.dataset.hvDropdown === 'sm' ? ' hv-dd--sm' : '');
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('hv-dd__native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hv-dd__btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const lbl = labelFor(select);
    if (lbl.label) btn.setAttribute('aria-label', lbl.label);
    if (lbl.labelledby) btn.setAttribute('aria-labelledby', lbl.labelledby);
    btn.innerHTML = '<span class="hv-dd__label"></span>' + CHEVRON;
    wrap.appendChild(btn);
    const labelEl = btn.firstChild;

    const sync = () => {
      labelEl.textContent = selectedText(select);
      btn.disabled = select.disabled;
    };
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); sync(); },
    });
    Object.defineProperty(select, 'selectedIndex', {
      configurable: true,
      get() { return indexDesc.get.call(this); },
      set(v) { indexDesc.set.call(this, v); sync(); },
    });
    select.addEventListener('change', sync);
    select.addEventListener('focus', () => btn.focus());
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label'] });
    sync();

    btn.addEventListener('click', () => (openState && openState.btn === btn ? close() : open(select, btn)));
    btn.addEventListener('keydown', (e) => onKey(e, select, btn));
  }

  function enabledItems(list) {
    return Array.from(list.querySelectorAll('.hv-dd__item:not([aria-disabled="true"])'));
  }

  function setActive(item) {
    if (!openState) return;
    const { list, btn } = openState;
    list.querySelectorAll('.hv-dd__item.is-active').forEach((n) => n.classList.remove('is-active'));
    if (!item) return;
    item.classList.add('is-active');
    btn.setAttribute('aria-activedescendant', item.id);
    item.scrollIntoView({ block: 'nearest' });
  }

  function open(select, btn) {
    close();
    const list = document.createElement('div');
    list.className = 'hv-dd__list';
    list.setAttribute('role', 'listbox');
    list.id = 'hvddlist' + (++uid);
    Array.from(select.options).forEach((opt, i) => {
      const item = document.createElement('div');
      item.className = 'hv-dd__item';
      item.id = list.id + '-' + i;
      item.setAttribute('role', 'option');
      item.dataset.index = String(i);
      const selected = i === select.selectedIndex;
      item.setAttribute('aria-selected', String(selected));
      if (opt.disabled) item.setAttribute('aria-disabled', 'true');
      item.innerHTML = '<span></span>' + (selected ? CHECK : '');
      item.firstChild.textContent = opt.text;
      list.appendChild(item);
    });
    document.body.appendChild(list);
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', list.id);
    openState = { select, btn, list, typed: '', typedAt: 0 };
    place();
    setActive(list.querySelector('[aria-selected="true"]') || enabledItems(list)[0]);

    list.addEventListener('pointerdown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.hv-dd__item');
      if (item && item.getAttribute('aria-disabled') !== 'true') choose(Number(item.dataset.index));
    });
    list.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.hv-dd__item');
      if (item && item.getAttribute('aria-disabled') !== 'true') setActive(item);
    });
  }

  function place() {
    if (!openState) return;
    const { btn, list } = openState;
    const r = btn.getBoundingClientRect();
    list.style.minWidth = r.width + 'px';
    list.style.left = r.left + 'px';
    const h = list.offsetHeight;
    const below = window.innerHeight - r.bottom;
    const flip = below < h + 8 && r.top > below;
    list.style.top = flip ? Math.max(8, r.top - h - 4) + 'px' : r.bottom + 4 + 'px';
    list.style.maxHeight = Math.max(120, (flip ? r.top : below) - 12) + 'px';
    const over = list.getBoundingClientRect().right - (window.innerWidth - 8);
    if (over > 0) list.style.left = Math.max(8, r.left - over) + 'px';
  }

  function choose(index) {
    if (!openState) return;
    const { select, btn } = openState;
    close();
    btn.focus();
    if (index === select.selectedIndex) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function close() {
    if (!openState) return;
    const { btn, list } = openState;
    list.remove();
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-controls');
    btn.removeAttribute('aria-activedescendant');
    openState = null;
  }

  function onKey(e, select, btn) {
    const isOpen = !!openState && openState.btn === btn;
    const k = e.key;
    if (!isOpen) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        open(select, btn);
      }
      return;
    }
    const items = enabledItems(openState.list);
    const cur = items.indexOf(openState.list.querySelector('.is-active'));
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (k === 'Tab') { close(); return; }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(items[Math.min(items.length - 1, cur + 1)]); return; }
    if (k === 'ArrowUp') { e.preventDefault(); setActive(items[Math.max(0, cur - 1)]); return; }
    if (k === 'Home') { e.preventDefault(); setActive(items[0]); return; }
    if (k === 'End') { e.preventDefault(); setActive(items[items.length - 1]); return; }
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (cur >= 0) choose(Number(items[cur].dataset.index));
      return;
    }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      openState.typed = (now - openState.typedAt > 700 ? '' : openState.typed) + k.toLowerCase();
      openState.typedAt = now;
      const hit = items.find((n) => n.textContent.trim().toLowerCase().startsWith(openState.typed));
      if (hit) setActive(hit);
    }
  }

  function init(root) {
    (root || document).querySelectorAll('select[data-hv-dropdown]').forEach(enhance);
  }

  document.addEventListener('pointerdown', (e) => {
    if (openState && !openState.list.contains(e.target) && !openState.btn.contains(e.target)) close();
  }, true);
  // Capture phase; this file loads before ui.js so it runs ahead of ModalController: Escape closes only the popup, not the modal behind it.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openState) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const { btn } = openState;
    close();
    btn.focus();
  }, true);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', (e) => {
    if (openState && !openState.list.contains(e.target)) place();
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();

  return { init, close };
})();

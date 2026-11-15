/*
 * Themed file input. Enhances <input type="file" data-hv-file> into an English "Choose file" button plus a
 * file-name label, so the browser's own (locale-dependent) button text never shows. The real input stays in
 * the DOM (visually hidden) so .files, .value, change events, label clicks and Playwright setInputFiles keep working.
 * Programmatic resets (input.value = "") update the label too.
 */
const HvFile = (() => {
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  function summary(input) {
    const files = input.files;
    if (!files || !files.length) return input.dataset.hvFileEmpty || 'No file chosen';
    return files.length === 1 ? files[0].name : files.length + ' files';
  }

  function enhance(input) {
    if (input.dataset.hvFileDone) return;
    input.dataset.hvFileDone = '1';
    const wrap = document.createElement('span');
    wrap.className = 'hv-file';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hv-file__btn';
    btn.textContent = input.multiple ? 'Choose files' : 'Choose file';
    const name = document.createElement('span');
    name.className = 'hv-file__name';
    name.setAttribute('aria-live', 'polite');
    input.parentNode.insertBefore(wrap, input);
    wrap.append(btn, name, input);
    input.classList.add('hv-file__native');
    input.tabIndex = -1;
    const lab = input.id && document.querySelector('label[for="' + input.id + '"]');
    if (lab) {
      if (!lab.id) lab.id = input.id + 'Label';
      btn.setAttribute('aria-labelledby', lab.id);
    }
    const sync = () => {
      name.textContent = summary(input);
      wrap.classList.toggle('is-empty', !(input.files && input.files.length));
      btn.disabled = input.disabled;
    };
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', sync);
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); sync(); },
    });
    new MutationObserver(sync).observe(input, { attributes: true, attributeFilter: ['disabled'] });
    sync();
  }

  function init(root) {
    (root || document).querySelectorAll('input[type="file"][data-hv-file]').forEach(enhance);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
  else init();

  return { init };
})();

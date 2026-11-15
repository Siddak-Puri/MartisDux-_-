const KEY = 'martisdux.theme.v1';

export function initializeTheme() {
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  const appearance = window.martisDuxAppearance;
  const system = matchMedia('(prefers-color-scheme: dark)');
  if (appearance?.mac) root.dataset.platform = 'mac';

  const bar = document.querySelector('.masthead');
  bar.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const bounds = bar.getBoundingClientRect();
    bar.style.setProperty('--glass-x', (event.clientX - bounds.left) + 'px');
  }, { passive: true });
  bar.addEventListener('pointerleave', () => bar.style.removeProperty('--glass-x'));

  let override = appearance?.initialTheme;
  if (!appearance) {
    try { override = localStorage.getItem(KEY); } catch { }
  }

  if (override !== 'dark' && override !== 'light') override = null;

  function paint() {
    const theme = override ?? (system.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    toggle.setAttribute('aria-checked', String(theme === 'dark'));
    toggle.title = theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance';
  }

  toggle.addEventListener('click', () => {
    override = root.dataset.theme === 'dark' ? 'light' : 'dark';
    if (appearance) appearance.setTheme(override);
    else {
      try { localStorage.setItem(KEY, override); } catch { }
    }
    paint();
  });
  system.addEventListener('change', paint);
  paint();

  const dialogs = Array.from(document.querySelectorAll('dialog'));
  const openDialogs = new Set();
  const observer = new MutationObserver(changes => {
    for (const { target } of changes) {
      if (target.open) openDialogs.add(target);
      else openDialogs.delete(target);
    }
    const host = Array.from(openDialogs).at(-1) ?? document.body;
    if (toggle.parentElement !== host) host.append(toggle);
  });
  for (const dialog of dialogs) observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
}

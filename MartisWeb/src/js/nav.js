// Header behaviour: scrolled backdrop, theme that follows the section beneath
// it, active-section highlighting and the mobile menu.

// data-section on each section → the nav item it belongs to
const NAV_FOR_SECTION = {
  mission: 'mission',
  map: 'map',
  simulator: 'simulator',
  roadmap: 'roadmap',
};

export function initNav() {
  const header = document.querySelector('[data-header]');
  if (!header) return;
  const links = [...header.querySelectorAll('[data-nav]')];
  const toggle = header.querySelector('[data-menu-toggle]');
  const menu = header.querySelector('[data-menu]');
  const root = document.documentElement;

  // Scrolled state
  const onScroll = () => header.toggleAttribute('data-scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  if ('IntersectionObserver' in window) {
    // Header colour follows whichever section sits under it.
    const themed = [...document.querySelectorAll('main > [data-theme], .site-footer')];
    const themeIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) header.dataset.theme = entry.target.dataset.theme;
        }
      },
      { rootMargin: '-3% 0px -96% 0px' },
    );
    themed.forEach((el) => themeIo.observe(el));

    // Active nav item for the section in the middle of the viewport.
    const sections = [...document.querySelectorAll('[data-section]')];
    const navIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = NAV_FOR_SECTION[entry.target.dataset.section];
          links.forEach((link) => {
            if (key && link.dataset.nav === key) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          });
        }
      },
      { rootMargin: '-48% 0px -51% 0px' },
    );
    sections.forEach((el) => navIo.observe(el));
  }

  // Mobile menu
  if (!toggle || !menu) return;
  const open = () => {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.querySelector('.menu-toggle__label').textContent = 'Close';
    root.classList.add('menu-open');
    menu.querySelector('a')?.focus();
  };
  const close = ({ restoreFocus = true } = {}) => {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.querySelector('.menu-toggle__label').textContent = 'Menu';
    root.classList.remove('menu-open');
    if (restoreFocus) toggle.focus();
  };

  toggle.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) close({ restoreFocus: false });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  window.matchMedia('(min-width: 60rem)').addEventListener('change', (e) => {
    if (e.matches) close({ restoreFocus: false });
  });
}

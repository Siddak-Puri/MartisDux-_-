const body = document.body;
const astronaut = document.getElementById('home-page');
const globe = document.getElementById('globe');
const log = document.getElementById('log-page');
const railItems = document.querySelectorAll('[data-app-nav]');

export function showPage(page) {
  if (body.dataset.page === page) return false;
  body.dataset.page = page;
  const onHome = page === 'home';
  if (!onHome && document.documentElement.dataset.launch === 'reveal') {
    document.documentElement.dataset.launch = 'ready';
  }
  astronaut.inert = !onHome;
  globe.inert = onHome || page === 'log';
  log.hidden = page !== 'log';
  for (const item of railItems) {
    if (item.dataset.appNav === page) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  return true;
}

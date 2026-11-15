export async function phoneUrl(page = location.pathname) {
  if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return location.href.split('#')[0];
  try {
    const r = await fetch('/__phone-link', { cache: 'no-store' });
    if (r.ok) {
      const { url } = await r.json();
      if (url) return new URL(page.split('/').pop() || '', url).href;
    }
  } catch { }
  return null;
}

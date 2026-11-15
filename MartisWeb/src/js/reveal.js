// Scroll-triggered reveals. One IntersectionObserver; each element animates once.

function splitWords(el) {
  const text = el.textContent.trim().replace(/\s+/g, ' ');
  const words = text.split(' ');
  const visual = words
    .map((word, i) => `<span class="mask-word"><span style="--w:${i}">${word}</span></span>`)
    .join(' ');
  // Screen readers get the plain sentence; the split copy is presentational.
  el.innerHTML = `<span class="visually-hidden">${text}</span><span aria-hidden="true">${visual}</span>`;
}

export function initReveal({ reduced }) {
  // Hero content is revealed by the page-load entrance (html.is-ready), not on scroll,
  // so nothing in the first screen waits for an intersection.
  const targets = [...document.querySelectorAll('[data-reveal], [data-draw]')].filter((el) => !el.closest('.hero'));
  if (!reduced) document.querySelectorAll('[data-reveal="words"]').forEach(splitWords);

  if (reduced || !('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -9% 0px', threshold: 0 },
  );
  targets.forEach((el) => io.observe(el));
}

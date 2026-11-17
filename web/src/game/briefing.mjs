// The level brief: a dialog of swipeable cards that teaches the level's idea before the
// player designs anything. Same carousel as the homepage start flow: a native scroll-snap
// strip, so swiping works on phones, plus buttons, dots, and arrow keys.
// Markup: the #briefing dialog in lessons/templates/_shop_game.html.j2. Cards come from
// each level's `intro` in the lesson file.

/**
 * @param {{ link?: (root: Element) => void }} options  link: tap-to-define for the cards.
 * @returns {{ open(brief): boolean }}  open returns false when there's no dialog to show.
 */
export function createBriefing({ link } = {}) {
  const doc = globalThis.document;
  const dialog = doc?.getElementById('briefing');
  const ready = dialog && typeof dialog.showModal === 'function' && dialog.querySelector?.('.slides');
  if (!ready) return { open: () => false };

  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const label = dialog.querySelector('.briefing-label');
  const track = dialog.querySelector('.slides');
  const dots = dialog.querySelector('.slide-dots');
  const next = dialog.querySelector('[data-next]');
  const back = dialog.querySelector('[data-back]');

  const slides = () => [...track.querySelectorAll('.slide')];
  const index = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));

  function update(i = index()) {
    const count = slides().length;
    dots.innerHTML = slides().map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('');
    back.disabled = i === 0;
    next.hidden = i >= count - 1; // The last card has its own button.
    slides().forEach((s, k) => s.toggleAttribute('inert', k !== i));
  }

  function go(i, smooth = true) {
    const target = Math.max(0, Math.min(slides().length - 1, i));
    track.scrollTo({ left: target * track.clientWidth, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
    update(target);
  }

  let ticking = false;
  track.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  });
  next.addEventListener('click', () => go(index() + 1));
  back.addEventListener('click', () => go(index() - 1));
  dialog.addEventListener('keydown', ev => {
    if (ev.target.closest?.('.term')) return;
    if (ev.key === 'ArrowRight') { ev.preventDefault(); go(index() + 1); }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(index() - 1); }
  });
  dialog.addEventListener('click', ev => {
    if (ev.target.closest?.('[data-done], [data-close]') || ev.target === dialog) dialog.close();
  });
  addEventListener('resize', () => { if (dialog.open) go(index(), false); });

  return {
    /**
     * @param brief { title: shown in the top bar, cards: [{ stub, title, html }], done: last button's words }
     */
    open({ title, cards, done = 'Design your shop' }) {
      label.textContent = title;
      dialog.dataset.count = String(cards.length);
      track.innerHTML = cards.map((c, i) => `
        <section class="slide brief-card" aria-roledescription="slide" aria-label="${i + 1} of ${cards.length}">
          <p class="stub">${c.stub}</p>
          <h2>${c.title}</h2>
          <div class="brief-body">${c.html}</div>
          ${i === cards.length - 1 ? `<div class="ask-actions"><button type="button" class="btn-primary" data-done>${done} <span class="arrow">→</span></button></div>` : ''}
        </section>`).join('');
      link?.(track);
      if (!dialog.open) dialog.showModal();
      requestAnimationFrame(() => {
        go(0, false);
        (cards.length > 1 ? next : track.querySelector('[data-done]'))?.focus();
      });
      return true;
    },
  };
}

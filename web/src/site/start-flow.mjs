// The "Start lesson 1" flow on the homepage: a swipeable intro, then "Have you played
// before?". "No" swaps in a how-to-play slideshow. Slides are a native scroll-snap
// strip, so swiping works on phones; the buttons, dots, and arrow keys move it too.
// Markup: lessons/templates/_start_flow.html.j2.

export function setUpStartFlow() {
  const dialog = document.getElementById('start');
  if (!dialog || typeof dialog.showModal !== 'function') return; // Old browsers just follow the link.

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const label = document.getElementById('start-label');
  const dots = dialog.querySelector('.slide-dots');
  const next = dialog.querySelector('[data-next]');
  const back = dialog.querySelector('[data-back]');
  const tracks = { intro: dialog.querySelector('[data-track="intro"]'), howto: dialog.querySelector('[data-track="howto"]') };
  const labels = { intro: 'Welcome to Rush Hour', howto: 'How to play' };
  let track = tracks.intro;

  const slides = () => [...track.querySelectorAll('.slide')];
  const index = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));

  function update(i = index()) {
    const count = slides().length;
    dots.innerHTML = slides().map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('');
    back.disabled = i === 0;
    next.hidden = i >= count - 1; // The last slide has its own buttons.
    slides().forEach((s, k) => s.toggleAttribute('inert', k !== i));
  }

  function go(i, smooth = true) {
    const target = Math.max(0, Math.min(slides().length - 1, i));
    track.scrollTo({ left: target * track.clientWidth, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
    update(target);
  }

  function show(name) {
    for (const [key, el] of Object.entries(tracks)) el.hidden = key !== name;
    track = tracks[name];
    label.textContent = labels[name];
    requestAnimationFrame(() => go(0, false));
  }

  let ticking = false;
  for (const el of Object.values(tracks)) {
    el.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; update(); });
    });
  }
  next.addEventListener('click', () => go(index() + 1));
  back.addEventListener('click', () => go(index() - 1));
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowRight') { ev.preventDefault(); go(index() + 1); }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(index() - 1); }
  });
  dialog.querySelector('[data-howto]').addEventListener('click', () => show('howto'));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', ev => { if (ev.target === dialog) dialog.close(); }); // Click outside to close.
  window.addEventListener('resize', () => go(index(), false));

  for (const link of document.querySelectorAll('[data-start]')) {
    link.addEventListener('click', ev => {
      ev.preventDefault();
      show('intro');
      dialog.showModal();
      requestAnimationFrame(() => { go(0, false); next.focus(); });
    });
  }
}

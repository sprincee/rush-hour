// Tap-to-define: turns the first mention of each glossary term in a piece of the page into
// a small button. Tapping it opens a one-line definition next to it. The words come from
// ../lessons/glossary.mjs. Without a real DOM (the Node tests), link() does nothing.
import { splitTerms, term } from '../lessons/glossary.mjs';

// Text inside these stays plain: controls, headings, and things that are already a term.
const SKIP = 'button, label, summary, a, h2, input, code, .term, .ticket-head, .tally-got, .stamp-row, .live-val, .define';

export function setUpDefine() {
  const doc = globalThis.document;
  const live = Boolean(doc?.createTreeWalker && doc.body);
  let pop = null;
  let openBtn = null;

  function close() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    openBtn?.setAttribute('aria-expanded', 'false');
    openBtn = null;
  }

  function open(btn) {
    const t = term(btn.dataset.term);
    if (!t) return;
    if (openBtn === btn) { close(); return; }
    close();
    if (!pop) {
      pop = doc.createElement('div');
      pop.className = 'define';
      pop.id = 'define';
      pop.setAttribute('role', 'note');
      pop.hidden = true;
      doc.body.append(pop);
    }
    pop.innerHTML = `<p class="define-title"></p><p class="define-body"></p>`;
    pop.querySelector('.define-title').textContent = t.title;
    pop.querySelector('.define-body').textContent = t.def;
    pop.hidden = false;
    openBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    // Under the word, or above it near the bottom of the screen. Kept inside the window.
    const r = btn.getBoundingClientRect();
    const w = Math.min(300, innerWidth - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
    const below = r.bottom + 8 + pop.offsetHeight < innerHeight;
    pop.style.top = `${below ? r.bottom + 8 : r.top - 8 - pop.offsetHeight}px`;
  }

  if (live) {
    // Capture phase, so a tap on a term doesn't also skip a reveal or dismiss a card.
    doc.addEventListener('click', ev => {
      const btn = ev.target.closest?.('.term');
      if (btn) { ev.stopPropagation(); ev.preventDefault(); open(btn); return; }
      if (!ev.target.closest?.('.define')) close();
    }, true);
    doc.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && openBtn) { const b = openBtn; close(); b.focus(); }
    });
    addEventListener('scroll', close, { capture: true, passive: true });
    addEventListener('resize', close);
  }

  /** Link terms inside `root`, each term once per call. */
  function link(root) {
    if (!live || !root?.nodeType) return;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const seen = new Set();
    for (const node of nodes) {
      const parts = splitTerms(node.nodeValue, seen);
      if (!parts.some(p => p.key)) continue;
      const frag = doc.createDocumentFragment();
      for (const p of parts) {
        if (!p.key) { frag.append(p.text); continue; }
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'term';
        b.dataset.term = p.key;
        b.setAttribute('aria-expanded', 'false');
        b.textContent = p.text;
        frag.append(b);
      }
      node.replaceWith(frag);
    }
  }

  return { link, close };
}

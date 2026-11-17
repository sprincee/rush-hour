# DESIGN_RH.md — Rush Hour

Visual direction for Rush Hour: the homepage, lesson pages, navigation, page chrome, and the controls around the game. Read this before touching templates or CSS. It guides rather than locks: when something here doesn't serve the reader, change it and update this file.

## 0. Scope: the canvas is frozen

The owner likes how the simulation looks. **Don't change the canvas** or its drawing code in `shop-game.mjs`, including the X-ray drawing. The canvas keeps its own colors; it does not read `tokens.css`.

Everything around the canvas follows this file: the homepage, lesson pages, navigation, header and footer, and the game's HTML controls (level tickets, levers, the X-ray monitor, the design panel, and the debrief). Where the site meets the game, choose page colors that sit well beside the canvas.

## 1. The idea in one line

**The counter and the back room.** The course has two layers, and the design follows them:

- **Counter** (default): the warm, physical coffee shop. Paper, ink, tickets, chalk menu board. This is what a learner *sees*.
- **X-ray** (toggle): the system underneath. A dark blueprint view with cyan lines, queues, and workers. This is how it *works*.

Pressing the X-ray toggle should feel like lifting the counter to see the wiring. Everything else in the system follows from that split.

**The signature element is the order ticket.** It's a receipt with a perforated edge and thermal-printer type. We use it for orders in the game, lesson cards, stat readouts, and the debrief. If a page has no ticket on it, ask whether it should.

## 2. Principles

1. **"Does the reader get it?" wins every tie.** When pretty and clear conflict, pick clear.
2. **The shop comes first, then the jargon.** Lesson headings use shop words ("The order line"). The system term appears second, as a ticket stub ("Queue").
3. **One accent per screen.** Crema orange marks the main action. Everything else stays ink on paper.
4. **Don't rely on color alone.** Channels, status, and batches each get a shape or label as well as a color.
5. **Real shop details beat decoration.** A box-of-coffee sign on the rate-limit lesson is better than an illustration of beans.

## 3. Color

All page colors are CSS custom properties in `web/src/styles/tokens.css`. Never hard-code a hex value in a stylesheet or template. The canvas has its own palette and doesn't read these (section 0).

Added while building the site, to match the shop scene:

```css
:root {
  --chalk-muted:    #A7AE9F;  /* secondary text on the menu board */
  --wood:           #7A4E31;  /* menu-board frame, the same wood as the chalkboard in the shop */
  --espresso:       #2A1D17;  /* the shop window around the game */
  --espresso-ink:   #F3EBE1;
  --espresso-muted: #C7B9AA;
  --rail-steel:     #9AA1A7;  /* the ticket rail and its clips */
}
```

### Counter (default)

```css
:root {
  /* surfaces */
  --milk:        #F4ECDF;  /* page background, steamed-milk paper */
  --ticket:      #FFFCF5;  /* tickets, cards, panels */
  --counter:     #E6D8C3;  /* borders, dividers, the counter edge */
  --chalk-board: #23302B;  /* menu board (lesson nav), dark green-black */
  --chalk:       #EDE6D6;  /* text on the menu board */

  /* ink */
  --ink:         #2A1D17;  /* body text, espresso */
  --ink-muted:   #6B5A4E;  /* secondary text, captions */

  /* accent: one per screen */
  --crema:       #A04F14;  /* primary button, links, focus ring */
  --crema-tint:  #F3DCC4;  /* hover and selected backgrounds */

  /* status: on time / at risk / missed goal */
  --ok:          #3E6B3A;  /* matcha */
  --warn:        #8A5A00;  /* caramel */
  --bad:         #A3302A;  /* coffee cherry */

  /* channels (lesson 3+) */
  --walkin:      #35567A;  /* walk-in: square ticket corner */
  --app:         #94386B;  /* app order: phone glyph + rounded corner */
}
```

### X-ray

```css
[data-view="xray"] {
  --xr-bg:     #0F171B;
  --xr-grid:   #1C2A30;  /* 24px blueprint grid */
  --xr-line:   #5CD3E3;  /* pipes, queue outlines, arrows */
  --xr-text:   #D6EEF2;
  --xr-muted:  #7FA3AB;
  --xr-ok:     #7BD88F;
  --xr-warn:   #F2B544;
  --xr-bad:    #FF7A6B;
  --xr-walkin: #8FB8FF;
  --xr-app:    #F08CC0;
}
```

Contrast has been checked (WCAG AA, 4.5:1 minimum for text). Ink on milk is 13.9. Muted on milk is 5.6. Crema text on milk is 4.9, and ticket-white on a crema button is 5.7. Every status and channel color is above 5.7 on ticket paper and above 7 on the X-ray background. If you add a color, run a contrast check before using it for text.

### Rules

- Milk is the page and ticket is the object. Never put a ticket on a ticket.
- Status colors are only for goals and SLOs. Don't use them for decoration.
- No gradients, glassmorphism, neon glows, or purple, except the X-ray cyan lines.

## 4. Type

All fonts are free and self-hosted from `web/static/fonts/` (no Google Fonts requests, $0, and no layout shift).

| Role | Font | Use |
|---|---|---|
| Display | **Bricolage Grotesque** (600–800) | Lesson titles, big numbers, the menu board |
| Body | **Atkinson Hyperlegible** (400, 700) | Lesson copy and UI text. Built for readability, which suits students |
| Ticket | **IBM Plex Mono** (400, 500, 600) | Tickets, stats, timers, code, system terms, X-ray labels |

```css
:root {
  --font-display: "Bricolage Grotesque", system-ui, sans-serif;
  --font-body:    "Atkinson Hyperlegible", system-ui, sans-serif;
  --font-ticket:  "IBM Plex Mono", ui-monospace, monospace;

  /* scale: 1.25 ratio, 18px body */
  --t-xs:  0.75rem;   /* 13.5px ticket fine print */
  --t-sm:  0.875rem;
  --t-md:  1.125rem;  /* body */
  --t-lg:  1.4rem;
  --t-xl:  1.75rem;
  --t-2xl: 2.2rem;
  --t-3xl: 3rem;      /* lesson title */
  --t-hero: clamp(3rem, 7vw, 5.5rem);
}
```

- Body line height is 1.6 and line length is at most 68ch.
- Ticket text is uppercase with `letter-spacing: 0.04em` for labels, and sentence case for values.
- Numbers that update live (wait time, queue length) use `font-variant-numeric: tabular-nums` so they don't jitter.

## 5. Space, shape, depth

```css
:root {
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 72px;

  --radius:      6px;   /* buttons, inputs */
  --radius-lg:   12px;  /* panels */
  --edge:        1.5px solid var(--counter);

  /* only one shadow: a ticket resting on the counter */
  --shadow-ticket: 0 1px 0 var(--counter), 0 6px 14px -8px rgb(42 29 23 / 0.35);
}
```

- Layout is a single column, at most 1120px wide, with the game canvas full width inside it.
- The page has one level of depth: tickets sit on the counter. No floating cards, stacked shadows, or blur.

## 6. Components

### Order ticket (signature)
- `--ticket` background, `--font-ticket`, and a perforated top edge (a `radial-gradient` mask with 6px circles every 12px).
- The header row has an order number and a time stamp (`#042 · 07:41`).
- Variants: `.ticket--walkin` (square corner, walk-in color stripe on the left), `.ticket--app` (rounded corner, phone glyph, app color stripe), `.ticket--batch` (a `×2` stamp, rotated -6°).
- Lesson cards on the home page are tickets: the shop name is the item, and the system concept is the modifier line underneath (`+ Queue`).

### Menu board (lesson navigation)
- Uses `--chalk-board` with `--chalk` text in the display font. Groups A, B, C are menu sections: "The flow", "The rush", "When things go wrong".
- Lessons that aren't built yet show as "coming soon" in muted chalk, with no lock icons.

### "Send a rush" button
- This is the main action on any page that has one. It uses a crema fill, ticket-white text, display font at `--t-lg`, and `--radius`.
- On press, a ticket prints out of the button (it slides down 8px, 200ms) and the label changes to the cooldown ("Next rush in 0:42").
- Disabled and cooldown states use the muted ink color and keep their text. Never show only a spinner.

### Levers (design controls)
- Levers are rows on the design ticket, separated by dashed receipt lines rather than boxed cards. Choices (ticket rule) are option rows; on/off parts (rail, batching, call names) are switches. Small whole numbers (baristas, batch wait, every Nth drink) are steppers with − and + buttons and a mono value. The rail size (5 to 50) keeps a slider, since stepping through 45 values is worse.
- Each lever has a shop label and a ticket-font system label underneath: "Baristas" / `WORKERS`.
- **Levers on the shop (2026-11-17, lesson 1 first).** For lessons with `CONTROLS_ON_SHOP`, each lever is a small ticket-colored tag on the part of the shop it changes: Baristas over the bar, Call names at the register. Each shows the shop name, the software name, and its price. Phones (the priority): the tags sit in a row directly under the shop window. 700px and up: they float on the shop, an HTML layer over the canvas. They pulse twice on a level's first visit, step aside during the rush (hidden), come back for the debrief (where a tap starts the next design), and switch to software words on dark glass under the X-ray (`WORKERS`, `ASYNC API · SYNC`). Under the shop, inside its dark frame, a **setup area** holds Your call, the cost bar, and Run; it shows only while designing. The level ticket is then purely the grader: level name, Reread the brief, goals and stars; the live meters during the rush; the receipt and the next level after it.

### X-ray monitor
- **The X-ray key** (2026-11-17) is behind a round `?` button fixed in the bottom-right corner of lesson pages, in the X-ray colors. It opens a small card: the five request colors, the walk-in/app shapes when the lesson has app orders, and how to flip the view. A tap outside or Escape closes it. It no longer takes room under the shop.
- The X-ray toggle is a small back-office monitor in the corner of the shop window, with `COUNTER | X-RAY` on its screen. The lit half shows the current view. Press it, or press X.
- On the homepage demo it flips by itself every 7 seconds until the visitor presses it.

### The level brief: learn, play, aha (2026-11-17, lesson 1 first)
- The game's loop is **learn → play → aha → next level**. When a level opens for the first time in a visit, a dialog teaches its idea before the player designs anything. It's the start flow's slideshow: full screen on phones, a centered card on bigger screens, swipeable, with dots and arrow keys.
- **The first level of a lesson gets three cards:** the situation in the shop, the idea (shop words, then an `IN SOFTWARE` box with the term), and your job (the goal, plus one thing to watch during the rush). **Later levels get one "What's new" card** that starts from what the last level taught.
- Cards name the concept but never say which setting wins. The level is where the player finds out.
- The last card's button is **Design your shop**. The level ticket then has no story paragraph, just a **↺ Reread the brief** link, the goals, stars, levers, your call, and Run. Replays don't reopen the brief.
- The software terms are taught in the brief, so the debrief has no "In software terms" fold for levels with a brief.
- Freeze frames are the **aha moments**: they point back at what the brief taught ("That's synchronous…").
- Lesson data: `intro` on each level (`[{ stub, title, html }]`), shown by `web/src/game/briefing.mjs`. Lessons 2-4 don't have briefs yet and keep the old ticket.

### Freeze frames (teaching moments)
- Built 2026-11-16. The first time something important happens, the rush pauses. The shop dims around a pulsing spotlight on the spot, a soft chime plays, and a ticket-colored card appears. Its parts: a ticket-font title with ⏸, one line in shop words using the rush's own numbers, then `IN SOFTWARE` and the system term in bold.
- **Got it**, a tap anywhere, Space, or Enter carries on. The simulation only pauses, so results never change.
- Each moment shows once per lesson per visit. It's always on, with no switch; remembering which ones a player has seen waits for accounts.
- Moments about the system underneath (like the first ticket on the rail) flip the X-ray on.
- Phones: the card sits under the shop. Wider screens: it floats beside the spotlight.
- Moments are lesson copy: `MOMENTS` in each lesson file, with a trigger (`accepted`, `rejected`, `queued`, `goalRisk`, `goalMissed`), optional filters (`level`, `why`, `goal`, `mode`: `sync` or `async`), and an optional named `spot` (`cashier`, `register`, `rail`) for the spotlight. A title can be a function of the rush.

### Goal badges (SLOs)
- Ticket font, uppercase. Before the rush: `GOAL`. During the rush, live (built 2026-11-16): `ON TRACK` (`--ok`), `AT RISK` (`--warn`, from 75% of the limit, with a pulsing meter and a soft double blip), `MISSED` (filled `--bad`, with a pop, a small jolt and the "bad" sound). At the end: `MET` or `MISSED`.
- Each goal on the running ticket has a meter. For a limit, the limit line sits at 80% of the meter, so a goal going over is visible. For "serve everyone", it shows progress (`31 / 50 served`).
- A goal never comes back from `MISSED`. The live wait counts people still waiting, so a goal breaks the moment someone's wait passes the limit. `web/test/live-goals.test.mjs` proves the meters agree with the debrief for every level.
- The same badges sit in a strip under the shop stats on phones, and on desktop when the ticket is folded away.
- Each lesson goal has a `live` description (`web/src/game/live-goals.mjs` lists the kinds).

### Your call and stars (built 2026-11-16)
- **Your call:** above the Run button, one question about the rush with 2 to 4 option pills ("How many of the 50 customers will walk out?"). One tap picks, a second tap takes it back. It's optional and clears after every rush, so each run is a fresh guess. The debrief says "You said X. It was Y: the number. Called it." in a milk-colored note.
- **Stars:** three per level. ★ Meet the goals, ★ a stretch, ★ Called it. A stretch is a real target where the level has room ("for $40 or less", "turn away 20 or fewer"), or "in 3 rushes or fewer" where only one design passes. The stretch only counts on a run that meets the goals. Stars are kept for the visit, and remembering them waits for accounts.
- In the brief, the stars are a quiet checklist. In the debrief they're chips that pop in one by one after the stamp, each with a rising chime. A first-time star gets a `NEW` tag and a glow. The level tickets show ★★☆.
- Lesson data: `predict` (`q`, `options` with tests, `actual`) and `stretch` on each level; `starsFor` in `web/src/lessons/common.mjs`. `web/test/stars.test.mjs` checks every stretch is earnable and every call has an answer for every design.

### Tap-to-define
- The first mention of a software term in a ticket, freeze-frame card or stats label gets a dotted underline. Tapping it opens a small dark note: the term in ticket font, then one or two plain sentences with the shop version. Escape, scrolling, or a tap elsewhere closes it.
- Terms and definitions are data in `web/src/lessons/glossary.mjs`. Lesson concepts themselves (queue, batching) aren't in it, since the lesson teaches them.

### Live panel frame (Grafana or snapshot)
- A dark frame labeled "BACK OFFICE MONITOR", using the X-ray tokens, with a live dot that pulses `--xr-ok` once every 2s.
- When the server is waking or the panel is showing a recorded run, the label says `RECORDED RUN · 2026-11-11` in `--xr-warn`. Never present a recording as live.

### Debrief
- The payoff moment of every level (built 2026-11-16). The receipt prints one line per goal plus the budget, with a printer chirp. Each number counts up from zero, and each line gets a ✓ or ✕ that pops in. Then a rubber stamp lands (**GOALS MET** in `--ok`, **NOT YET** in `--bad`), jolting the ticket.
- After the stamp come the stars, then your call's result, "What happened" (the lesson, in the player's own numbers), and the buttons. A level that just unlocked prints onto the level rail once the receipt is done. The full receipt numbers and the concept card fold away under "Your receipt" and "In software terms". The SLO note shows only on the first debrief of a visit.
- Tapping the ticket skips straight to the stamp. With reduced motion, everything shows at once.

### Layout: mobile first
- **The frame around the shop on phones (2026-11-17)** is quiet: one row of four small stats with no software sub-labels (the X-ray key has those), no Brief/Design/Run/Debrief strip (the ticket shows the phase), and a smaller key, controls and caption. From 600px up it returns to the full version.
Most players will be on phones. Base CSS is the phone layout, and `min-width` queries add room (600px, 640px, 1000px, 1100px). Check every change at 375px wide first.

### Site structure (v2, 2026-11-12)
- **Nav:** Menu, About, Play. The current page's link gets a crema underline (`aria-current`).
- **Homepage:** the hero is the whole page: headline, "Start lesson 1", "See the menu", and the live demo (lesson 4.3 looping, flipping to the X-ray). No sections below it.
- **Start flow:** "Start lesson 1" opens a full-screen dialog (a centered card on bigger screens). Three swipeable intro slides (the rush, design the shop, the X-ray), then "Have you played before?". Yes goes to lesson 1. No swaps in a how-to-play slideshow built from `course.steps`, ending in "Start lesson 1". Slides are a native scroll-snap strip, so swiping works on phones; Back/Next, dots, and arrow keys work too. Without JavaScript the button is a plain link to lesson 1.
- **Menu page:** the chalkboard. Playable lessons hang as tickets from the rail; unbuilt lessons are a compact chalk list.
- **About page:** how the game stays honest, the stack, the calibration receipt, and who made it.

### Lesson page
- **Level ticket on the side.** The brief, goals, levers, and later the debrief are one ticket (`<details class="side">`). On desktop it sits beside the shop, sticky, and folds into a slim vertical tab so the shop gets the room. On phones it sits under the shop and folds to a bar. It reopens by itself when a new brief or the debrief arrives.
- **No queue-depth chart** (removed 2026-11-17, owner: the graph confused more than it taught). The X-ray and the live stats show the queue.

Rules every page follows:
- **One aligned grid.** Every group starts at the same left edge and uses the same column widths. Text never touches the window edge.
- **No boxes inside boxes.** A lesson entry is one surface, not a card with a second panel inside it.
- **Don't let unbuilt lessons dominate.** Playable lessons get the space.

## 7. Motion

- Everyday UI is quick and mechanical, like a ticket printer: 150–250ms with `cubic-bezier(.2,.7,.2,1)`, with no overshoot.
- **Payoff moments may overshoot** (the owner's call, 2026-11-16): stamps landing, marks popping, scores and badges. They're the game's reward, so they get a little weight and bounce. Keep them short (under 400ms each), and never use overshoot on buttons, panels, or navigation.
- Motion explains state (a ticket moves into the line, a barista picks it up, a goal is met). It is never decoration.
- Effects over the shop go on a separate layer above the canvas (`<canvas class="fx">`, drawn by `web/src/game/effects.mjs`), so the frozen canvas drawing is never edited. Built 2026-11-16: a green ✓ that pops over each customer collecting a drink, a red ring where someone is turned away, a steam puff at the wand and a flash on the ORDER UP sign for each drink, and "×2" for a batch. They fade out under the X-ray, which has its own pops.
- **Every input reacts** (2026-11-16): the value you changed bumps (a stepper number, a switch, the chosen option), the design cost rolls to its new number while the budget bar slides, and going over budget shakes the bar. The Run button presses in. The served and turned-away counters bump (red for turned away). Flipping the X-ray sweeps one scanline down the window. These bumps are under 250ms and sit on the changed value, never on hover.
- With `prefers-reduced-motion: reduce`, the game still runs, but UI transitions are instant, payoff animations are skipped, and the live dot stops pulsing.

### Sound
- `web/src/game/sound.mjs` makes every sound with Web Audio, so there are no audio files. They're placeholders for testing; recorded sounds can replace them later under the same names: `print`, `good`, `bad`, `stamp`, `stampMiss`, `tick`, `warn`, `moment`, and since 2026-11-16 `orderUp` (a counter bell per drink), `batchUp`, `turnAway`, `ticket`, `run` (the register "ka-ching"), `xray` / `xrayOff`, `unlock`, `star` / `starMiss`. Sounds that can pile up during a rush are spaced out.
- Sound starts on the player's first click or key press (browsers require that). The **Sound on / off** button is in the shop controls and is remembered per browser.
- Sounds mark state changes, like motion does: a ticket printing, a goal met or missed, the stamp. No music. During a rush two quiet loops play under everything: steam hiss that grows with busy baristas, and a crowd murmur that swells as the shop fills. They stop on pause, on a freeze frame, and when the tab is hidden. The homepage demo is always silent.

## 8. Voice in the UI

- Lead with the shop and keep the system term short: "The line is getting long, so the app is paused (backpressure)."
- Use the real shop rules by name ("the box-of-coffee rule").
- Buttons are verbs: "Send a rush", "Open the X-ray", "Try again with 3 baristas".

## 9. Don'ts

- No coffee-bean clipart, steam-swirl icons, or stock café photos.
- No emoji in the UI chrome.
- No default-Tailwind look: rounded-2xl white cards, gray-500 text, indigo buttons.
- No dark mode for the Counter layer in v1. Dark is the X-ray layer's job, and keeping it that way protects the idea.
- No new fonts, colors, or shadows without adding them to this file first.

## 10. Implementation notes

- Three stylesheets, linked in this order from `lessons/templates/base.html.j2`: `tokens.css` (tokens and `@font-face`), `site.css` (page chrome, homepage, start flow, menu and about pages, tickets), and `game.css` (everything around the canvas).
- Fonts are self-hosted in `web/static/fonts/` with their OFL licenses (153 KB in all, latin subset). `lessons/build.py` copies them to `dist/assets/fonts/`.
- A ticket's perforated edges are a CSS mask, which also clips any `box-shadow`. Put `filter: var(--shadow-ticket)` on the ticket's container instead (the `.tickets` class).
- No CSS framework and no build step, which matches the rest of the site. Plain CSS with custom properties and `@layer tokens, base, components`.

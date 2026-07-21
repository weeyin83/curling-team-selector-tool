# Curling Team Selector

A simple, mobile-friendly web app that replaces drawing names from an envelope. Enter a roster of players once, click **Generate teams**, and get a full, randomised set of curling teams — each with a Skip, Third, Second, and Lead.

Everything runs in your browser. No server, no accounts, no database, no cookies, no analytics. Refresh the page and every trace of the roster is gone.

## Features

- Add players individually or in bulk (paste one per line)
- **Import players from Excel (.xlsx) or CSV files** — one sheet per competition/league; positions are matched case-insensitively
- **Multiple competitions in one page** — each competition (e.g. Trophy 1, Trophy 2) is a separate tab with its own roster and its own team draw
- **2, 3, or 4-person teams per competition** — pick the format that matches the game (mixed doubles, triples, or full teams)
- Assign each player a **primary** position (Skip / Third / Second / Lead, or **Any** for no preference) and an optional **secondary** position, plus an optional "can play any position" flag used as a last resort
- **Optional experience rating (1–10)** per player — used only when balancing draws by experience; positions still work exactly as before
- Mark players as "played skip recently" to reduce their odds of being drawn as skip
- Exclude specific players from the next draw without deleting them
- **Two team-balancing modes per competition**
  - **By position** (the original behaviour) — fill Skip/Third/Second/Lead from players' preferred positions
  - **By experience** — form teams with roughly equal total experience, then place positions within each team. Every team is guaranteed exactly one Skip; a **balance score (0–100)** is shown for the overall draw
- Randomised team generation that prioritises primary matches, then secondary, then flexible
- Automatic detection of team count (`floor(activePlayers / 4)`) with leftover players listed as substitutes
- One-click redraw that respects **locks**:
  - Lock an individual player to a slot
  - Lock an entire team so it stays intact
- Drag-and-drop to swap players between slots (or between a slot and the substitutes list) after a draw
- Animated "drawing names from a hat" reveal
- Print-friendly team sheet — the browser's Save as PDF option produces a clean PDF
- Fully responsive layout for phone, tablet, and desktop
- **Installable as an app (PWA)** — add to your iOS or Android home screen and launch full-screen; works offline after the first visit
- Reset everything with one click

## Files

- `index.html` — page structure and controls
- `styles.css` — responsive styling, dark-blue theme, print rules, and animations
- `app.js` — state, team-generation algorithm, UI wiring, and service-worker registration
- `lib/experience.js` — pure helpers for the experience-balancing feature (validation, greedy/snake-draft algorithms, balance scoring). Loaded before `app.js`; also `require()`-able from Node so `tests/` can exercise it directly
- `tests/experience.test.js` — Node built-in test-runner suite for `lib/experience.js` (run with `node --test tests/experience.test.js`; no npm install required)
- `about.html` — About page (linked from the footer)
- `404.html` — friendly not-found page (served by Azure Static Web Apps)
- `manifest.webmanifest` — PWA manifest (name, icons, theme, install behaviour)
- `sw.js` — service worker: network-first for HTML, cache-first for static assets, works fully offline
- `icons/` — PWA icons for Android and iOS home screens (standard + maskable variants)
- `scripts/render_og_image.py` — Pillow generator for `og-image.png`
- `scripts/render_pwa_icons.py` — Pillow generator for the `icons/` set
- `staticwebapp.config.json` — Azure Static Web Apps routing / MIME / caching rules
- `robots.txt`, `sitemap.xml` — search-engine crawler hints
- `.devcontainer/devcontainer.json` — optional VS Code Dev Container / GitHub Codespaces config

## Running it

Because everything is client-side, you have three easy options:

1. **Just open the file** — double-click `index.html`. Works out of the box on `file://` in any modern browser.
2. **Local HTTP server** — from the project folder run one of:
   - `npx http-server -p 8080` (Node)
   - `python -m http.server 8000` (Python)
   Then open the URL it prints.
3. **VS Code Dev Container / GitHub Codespaces** — open the folder in VS Code and choose "Reopen in Container". The container includes Node 20, Python 3, and the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension. Click the **Go Live** button in the status bar to serve the site on port 5500.

## Usage

1. Add players and their preferred positions.
2. Click **Generate teams**.
3. Optionally lock players or teams and click **Redraw** to reshuffle the rest.
4. Click **Print / Save as PDF** to produce a team sheet.

## Install as an app

The site is a Progressive Web App, so it can be installed straight from the browser — no App Store or Play Store account, no download.

- **iOS / iPadOS (Safari)** — tap the Share button, then **Add to Home Screen**. Launches full-screen without the browser chrome.
- **Android (Chrome)** — you'll see an **Install app** prompt after a few seconds, or use the browser menu → **Install app**.
- **Desktop (Chrome / Edge)** — an install icon appears in the address bar.

Once installed, the app works offline. The next time you open it — even on a plane or an ice rink with patchy Wi-Fi — it loads instantly from the cached copy. Rosters and draws still stay entirely in your browser; nothing is stored on any server.

### Regenerating the app icons

The icon set under `icons/` is generated by [`scripts/render_pwa_icons.py`](scripts/render_pwa_icons.py) using Pillow. Re-run it whenever the brand mark changes:

```bash
python scripts/render_pwa_icons.py
```

Outputs `icon-192.png`, `icon-512.png`, matching `-maskable.png` variants (for Android's adaptive icon crop), and `apple-touch-icon-180.png`.

### Shipping updates to installed users

When you deploy a change, bump `CACHE_VERSION` at the top of [`sw.js`](sw.js) (e.g. `2026-07-20-v1` → `2026-07-20-v2`). That invalidates every previous cache so returning users pick up the new files on their next launch. HTML pages use a network-first strategy, so page changes take effect on the very next refresh even without a version bump.

### Bulk paste format

```text
Name, primary, secondary, flags, experience
```

- `primary` — one of `skip`, `third`, `second`, `lead`, or blank / `any` / `flex` / `*` to mean "no preference" (also implicitly sets the flexible flag)
- `secondary` — optional, one of `skip`, `third`, `second`, `lead`
- Flags — any of `flex` (can play any position), `recent` (played skip recently)
- `experience` — optional integer 1–10, or a prefixed form (`exp:7`, `level=3`, `skill:9`). Values outside 1–10 are ignored.

Example:

```text
John, skip
Sarah, third, skip, , 8
Mike, any, , , 6
Alex, second, , flex, exp:4
Emma, lead, , recent
```

> **Tip for the fairest, most varied draws:** only mark the players who *must* be Skips and leave everyone else's `primary` blank / `any`. Skip is the only position the algorithm treats as a hard constraint — over-specifying Third / Second / Lead narrows the possible combinations and makes the same lineups repeat.

### Import from Excel / CSV

Click **📄 Import Excel / CSV…** and choose a `.xlsx` workbook or a `.csv` file.

- Each **worksheet** is treated as a competition or league (e.g. "Trophy 1", "Trophy 2").
- The file must have a **`Name`** column and may optionally include a **`Position`** column and an **`Experience`** column. Extra columns are ignored. If no header row is found, the first two columns are used as Name and Position.
- **`Experience`** (also recognised: `Level`, `Skill`, `Rating`, `Grade`, `exp`) is an integer 1–10 used by the *Balance draw by → Experience* mode. Missing / out-of-range values default to 5 (median) so unrated rosters still balance sensibly.
- Position values are matched case-insensitively and tolerate leading/trailing spaces — `Skip`, ` skip`, `SKIP`, and `Skip ` are all accepted. `1st` / `2nd` / `3rd` also map to Lead / Second / Third. Blank / `any` / `flex` / `*` marks the player as flexible with no primary.
- **For the fairest, most varied draws, only put `Skip` in the Position column for the players who must be Skips and leave everyone else blank.** Skip is the only position treated as a hard constraint — over-specifying the rest narrows the pool of valid team combinations.
- Tick the sheets you want to import in the preview. A live preview shows which rows will be added.
- **Selecting multiple sheets creates one competition tab per sheet** — Trophy 1 and Trophy 2 stay as independent draws with their own team counts (e.g. 5 teams for Trophy 1, 4 teams for Trophy 2).
- Selecting a single sheet adds those players to the currently active tab. A "skip names already in the active tab" toggle avoids duplicates when topping up an existing roster.

The .xlsx parser is written from scratch using the browser's built-in ZIP decompression, so the file **never leaves your device** — no library downloads, no upload, no analytics.

### Competitions

The **competition tabs** at the top of the Teams panel let you juggle multiple draws in one session — one per league, trophy, or league night. Each tab has its own:

- Roster of players
- Team size (2, 3, or 4-person)
- Team draw and substitute list
- Locked slots / locked teams
- Feedback and warnings

You can create a new competition manually with **+ New competition**, rename a tab by double-clicking it, and delete a tab with the small **×** on the pill. Deleting a tab only removes that competition; the others are untouched.

### Team size

Curling isn't only played four-a-side. Pick the team size for each competition from the dropdown below the tabs:

| Size | Roles | Notes |
|---|---|---|
| **4-person** (default) | Skip · Third · Second · Lead | Standard curling |
| **3-person (triples)** | Skip · Third · Lead | Skip and Third throw more stones |
| **2-person (doubles)** | Player A · Player B | Mixed doubles / stick curling |

Changing the team size clears the current draw for that competition (its position slots are different). Players whose primary position isn't used at the new size — for example, a "Second"-primary player in a triples draw — will fall back to their secondary/flexible tier, or be listed as substitutes.

## Team generation algorithm

There are two balancing modes per competition. Pick one with the **Balance draw by** control just above the generate button. The choice is remembered per-tab, so different competitions can run different strategies.

### By position (default)

The generator runs 200 randomised passes and keeps the best-fitting draw:

1. Locked slots (from a previous draw) are placed first.
2. Remaining active players are shuffled.
3. For each position in the order Skip → Third → Second → Lead, players are placed in tier order:
   - **Tier 1** — the player's primary position matches
   - **Tier 2** — the player's secondary position matches
   - **Tier 3** — the player is marked "can play any position"
4. Skip-recently players are shuffled toward the back of the tier-1 skip pool so fresh skips are picked first.
5. Each attempt is scored by the sum of tiers used (lower = better fit). The best attempt wins; the algorithm exits early if a perfect tier-1 draw is found.
6. Any player who couldn't be placed on a complete team appears in the **Substitutes** section.

### By experience

Each player has an optional 1–10 experience rating (1 = beginner, 10 = advanced / professional). Players without a rating are treated as **5** — the median — so they don't skew team totals in either direction.

Every generated team is guaranteed to contain exactly one Skip. The generator runs 40 randomised passes and keeps the most balanced draw. Each pass:

1. Locked slots (from a previous draw) are placed first — same as the position mode.
2. **Tiered Skip selection.** One Skip per team is chosen from these tiers in order — a lower-tier candidate is never used while a higher-tier candidate is still available:
   - **Tier A** — explicitly designated Skips (`primary = skip`)
   - **Tier B** — players who list Skip as their secondary position
   - **Tier C** — flexible players ("any position")
   - **Tier D** — promoted by experience, only if there still aren't enough Skips

   This means an explicitly designated Skip with blank experience will always beat a rated non-Skip. "Played skip recently" players are deprioritised within each tier.
3. **Sub selection is randomised**, not experience-based. If there are more players than slots, a random subset sits out. Beginners aren't systematically benched.
4. **Greedy least-loaded distribution.** Remaining players are sorted descending by effective experience with a random tiebreak, then each is placed on the team with the lowest running total that still has capacity — seeded with each team's Skip total. Ties broken randomly at every step so repeated runs produce different lineups.
5. **Swap-optimise pass.** All non-Skip cross-team swaps are considered; any swap that lowers the composite balance score is applied. Skips are locked so the one-Skip-per-team guarantee is preserved.
6. **Position assignment.** Within each team, positions are filled using the same tier logic as position mode — primary → secondary → flexible — so players land where they're best suited.
7. **Balance score.** Each attempt is scored by `variance(team totals) + 0.3 × variance(team averages) + spread penalty`. Lower is better. The spread penalty discourages teams composed entirely of one experience band (beginner / intermediate / advanced / expert) when the team has 3+ players and the roster actually contains multiple bands. The best-scoring attempt is displayed, along with a **draw-wide balance score (0–100)** where 100 means the team totals are all exactly on the mean.

### Which mode should I use?

- **Position** — keep this if your league night draws by preferred position and you don't collect skill ratings.
- **Experience** — use this for club nights where a mix of new curlers and league regulars turn up, and you want teams that stand a chance against each other regardless of who came out that week.

Switching modes doesn't clear the current draw — it only affects the next **Generate** or **Redraw** click.

## Tests

The pure logic in [`lib/experience.js`](lib/experience.js) is covered by a Node.js built-in test suite. No dependencies to install — Node 18+ ships everything needed.

```bash
node --test tests/experience.test.js
```

Coverage includes: validation of the 1–10 range, effective-experience defaults, band bucketing, variance and balance-score maths, greedy-assign and snake-draft correctness, spreadsheet header detection, bulk-paste field parsing, tiered Skip selection (designated Skip with blank experience, more or fewer designated Skips than teams, promotion by experience only as a last resort), draw-summary scoring, and edge cases from the requirements (odd player counts, extreme skill differences, all-unset rosters, deterministic vs. randomised runs).

## Privacy

Every operation happens in browser memory. There is no `localStorage`, no `sessionStorage`, no cookies, and no roster data ever leaves your device.

The only network activity is:

- Loading the app itself (HTML, CSS, JS, icons) — which the service worker caches so subsequent launches work offline.
- **Ahrefs Web Analytics** — cookieless, IP-anonymised page-view counting only. No cross-site tracking, no ad targeting, no personal data.

Closing or reloading the tab wipes all in-memory data permanently.

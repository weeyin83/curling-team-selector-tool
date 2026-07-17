# Curling Team Selector

A simple, mobile-friendly web app that replaces drawing names from an envelope. Enter a roster of players once, click **Generate teams**, and get a full, randomised set of curling teams — each with a Skip, Third, Second, and Lead.

Everything runs in your browser. No server, no accounts, no database, no cookies, no analytics. Refresh the page and every trace of the roster is gone.

## Features

- Add players individually or in bulk (paste one per line)
- **Import players from Excel (.xlsx) or CSV files** — one sheet per competition/league; positions are matched case-insensitively
- **Multiple competitions in one page** — each competition (e.g. Trophy 1, Trophy 2) is a separate tab with its own roster and its own team draw
- **2, 3, or 4-person teams per competition** — pick the format that matches the game (mixed doubles, triples, or full teams)
- Assign each player a **primary** and optional **secondary** position, plus an optional "can play any position" flag used as a last resort
- Mark players as "played skip recently" to reduce their odds of being drawn as skip
- Exclude specific players from the next draw without deleting them
- Randomised team generation that prioritises primary matches, then secondary, then flexible
- Automatic detection of team count (`floor(activePlayers / 4)`) with leftover players listed as substitutes
- One-click redraw that respects **locks**:
  - Lock an individual player to a slot
  - Lock an entire team so it stays intact
- Drag-and-drop to swap players between slots (or between a slot and the substitutes list) after a draw
- Animated "drawing names from a hat" reveal
- Print-friendly team sheet — the browser's Save as PDF option produces a clean PDF
- Fully responsive layout for phone, tablet, and desktop
- Reset everything with one click

## Files

- `index.html` — page structure and controls
- `styles.css` — responsive styling, dark-blue theme, print rules, and animations
- `app.js` — state, team-generation algorithm, and UI wiring
- `about.html` — About page (linked from the footer)
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

### Bulk paste format

```
Name, primary, secondary, flags
```

- `primary` — required, one of `skip`, `third`, `second`, `lead`
- `secondary` — optional, one of the same values
- Flags — any of `flex` (can play any position), `recent` (played skip recently)

Example:

```
John, skip
Sarah, third, skip
Mike, second, , flex
Emma, lead, , recent
```

### Import from Excel / CSV

Click **📄 Import Excel / CSV…** and choose a `.xlsx` workbook or a `.csv` file.

- Each **worksheet** is treated as a competition or league (e.g. "Trophy 1", "Trophy 2").
- The file must have a **`Name`** column and a **`Position`** column. Extra columns are ignored. If no header row is found, the first two columns are used.
- Position values are matched case-insensitively and tolerate leading/trailing spaces — `Skip`, ` skip`, `SKIP`, and `Skip ` are all accepted. `1st` / `2nd` / `3rd` also map to Lead / Second / Third.
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

## Privacy

Every operation happens in browser memory. There is no `localStorage`, no `sessionStorage`, no cookies, no network requests, and no third-party scripts. Closing or reloading the tab wipes all data permanently.

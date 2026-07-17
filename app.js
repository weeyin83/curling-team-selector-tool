/* =====================================================================
 * Curling Team Selector — app.js
 *
 * All logic runs in the browser. Nothing is persisted; refreshing the
 * page wipes every player, team and setting.
 *
 * Architecture:
 *   - `state`  : in-memory single source of truth (players, teams, subs)
 *   - `ui`     : cached DOM references
 *   - `render*`: pure functions that turn state -> DOM
 *   - `generateTeams()` : the randomised team-building algorithm
 * ===================================================================== */

(function () {
    'use strict';

    /* -----------------------------------------------------------------
     * Constants
     * ----------------------------------------------------------------- */
    const POSITIONS = ['skip', 'third', 'second', 'lead'];
    const POSITION_LABELS = {
        skip: 'Skip',
        third: 'Third',
        second: 'Second',
        lead: 'Lead'
    };

    /**
     * Display-only overrides per team size. For 2-person (mixed doubles /
     * stick curling) the two players aren't really "Skip" and "Lead" —
     * we call them Player A and Player B. Internally they're still stored
     * under the skip/lead keys so player preferences (primary/secondary)
     * keep working across all team sizes.
     */
    const POSITION_LABEL_OVERRIDES = {
        2: { skip: 'Player A', lead: 'Player B' }
    };

    /** Display label for `position` in the context of `teamSize`. */
    function positionLabel(position, teamSize) {
        const overrides = POSITION_LABEL_OVERRIDES[teamSize];
        if (overrides && overrides[position]) return overrides[position];
        return POSITION_LABELS[position] || position;
    }

    const DEFAULT_TEAM_SIZE = 4;

    /**
     * Which positions are filled for each supported team size.
     * These are the standard curling role sets:
     *   4 = full team    → Skip / Third / Second / Lead
     *   3 = triples      → Skip / Third / Lead (Second is dropped)
     *   2 = doubles      → Skip / Lead
     */
    const POSITIONS_BY_SIZE = {
        4: ['skip', 'third', 'second', 'lead'],
        3: ['skip', 'third', 'lead'],
        2: ['skip', 'lead']
    };

    // Number of randomised passes when generating teams. Higher = better
    // adherence to primary/secondary preferences at slight CPU cost.
    const GENERATION_ATTEMPTS = 200;

    // Skip-recently players get a heavier weight when picking skips
    // (higher weight => less likely to be chosen first).
    const SKIP_RECENT_PENALTY = 5;

    /* -----------------------------------------------------------------
     * State
     *
     * A "competition" is a self-contained draw: its own roster, its own
     * team layout, its own substitute list. This mirrors how curling
     * clubs actually work — Trophy 1 night is a separate draw from
     * Trophy 2 night, even if the same names appear in both.
     *
     * `state.players`, `state.teams`, and `state.substitutes` are
     * defined below as accessors that transparently point at whichever
     * competition is currently active — that way the rest of the app
     * (rendering, generation, drag-and-drop) doesn't need to know
     * competitions exist.
     * ----------------------------------------------------------------- */
    const state = {
        /** @type {Array<Competition>} */
        competitions: [],
        /** @type {string|null} id of the currently visible competition */
        activeId: null,
        /** @type {string | null} id of player currently being edited */
        editingId: null
    };

    /**
     * @typedef {Object} Competition
     * @property {string} id
     * @property {string} name
     * @property {Array<Player>} players
     * @property {Array<Team> | null} teams
     * @property {Array<string>} substitutes
     */

    function makeCompetition(name) {
        return {
            id: uid(),
            name: (name && name.trim()) || 'Untitled',
            players: [],
            teams: null,
            substitutes: [],
            teamSize: DEFAULT_TEAM_SIZE
        };
    }

    function activeCompetition() {
        return state.competitions.find(c => c.id === state.activeId)
            || state.competitions[0]
            || null;
    }

    /** Team size (2 / 3 / 4) for the currently active competition. */
    function activeTeamSize() {
        const c = activeCompetition();
        const s = c ? c.teamSize : DEFAULT_TEAM_SIZE;
        return POSITIONS_BY_SIZE[s] ? s : DEFAULT_TEAM_SIZE;
    }

    /** Positions used in the active competition, in fill-priority order. */
    function activePositions() {
        return POSITIONS_BY_SIZE[activeTeamSize()];
    }

    // Backward-compatible shims: state.players / state.teams / state.substitutes
    // read and write through to the currently-active competition.
    Object.defineProperties(state, {
        players: {
            get() { return activeCompetition() ? activeCompetition().players : []; },
            set(v) { const c = activeCompetition(); if (c) c.players = v; }
        },
        teams: {
            get() { return activeCompetition() ? activeCompetition().teams : null; },
            set(v) { const c = activeCompetition(); if (c) c.teams = v; }
        },
        substitutes: {
            get() { return activeCompetition() ? activeCompetition().substitutes : []; },
            set(v) { const c = activeCompetition(); if (c) c.substitutes = v; }
        }
    });

    /**
     * @typedef {Object} Player
     * @property {string} id
     * @property {string} name
     * @property {string} primary        - one of POSITIONS
     * @property {string} secondary      - one of POSITIONS or ''
     * @property {boolean} flexible      - eligible for any position (last resort)
     * @property {boolean} skipRecently  - deprioritise for skip
     * @property {boolean} excluded      - skip this player during draws
     */

    /**
     * @typedef {Object} TeamSlot
     * @property {string|null} playerId
     * @property {boolean} locked        - if true, keep this exact player here on redraw
     * @property {number} tier           - 1 primary, 2 secondary, 3 flexible/any
     */

    /**
     * @typedef {Object} Team
     * @property {number} number
     * @property {boolean} locked
     * @property {Object<string, TeamSlot>} slots  - keyed by position
     */

    /* -----------------------------------------------------------------
     * DOM cache
     * ----------------------------------------------------------------- */
    const ui = {
        // Competitions
        compBlock: document.getElementById('competitions-block'),
        compTabs: document.getElementById('competitions-tabs'),
        compHint: document.getElementById('competitions-hint'),
        rosterHeading: document.getElementById('roster-heading'),
        teamsHeading: document.getElementById('teams-heading'),
        teamSize: document.getElementById('team-size'),
        teamSizeHint: document.getElementById('team-size-hint'),

        // Roster
        form: document.getElementById('player-form'),
        nameInput: document.getElementById('player-name'),
        primarySelect: document.getElementById('primary-position'),
        secondarySelect: document.getElementById('secondary-position'),
        flexibleInput: document.getElementById('flexible'),
        skipRecentInput: document.getElementById('skip-recently'),
        bulkToggle: document.getElementById('bulk-toggle'),
        bulkPanel: document.getElementById('bulk-panel'),
        bulkInput: document.getElementById('bulk-input'),
        bulkAdd: document.getElementById('bulk-add'),
        bulkCancel: document.getElementById('bulk-cancel'),
        importToggle: document.getElementById('import-toggle'),
        importPanel: document.getElementById('import-panel'),
        importFile: document.getElementById('import-file'),
        importPreview: document.getElementById('import-preview'),
        importSheetPicker: document.getElementById('import-sheet-picker'),
        importDedupeRoster: document.getElementById('import-dedupe-roster'),
        importPreviewSummary: document.getElementById('import-preview-summary'),
        importPreviewTable: document.getElementById('import-preview-table'),
        importFeedback: document.getElementById('import-feedback'),
        importAdd: document.getElementById('import-add'),
        importCancel: document.getElementById('import-cancel'),
        playerList: document.getElementById('player-list'),
        playerEmpty: document.getElementById('player-empty'),
        playerCounter: document.getElementById('player-counter'),
        clearPlayers: document.getElementById('clear-players'),

        // Teams
        generateBtn: document.getElementById('generate-btn'),
        redrawBtn: document.getElementById('redraw-btn'),
        printBtn: document.getElementById('print-btn'),
        resetBtn: document.getElementById('reset-btn'),
        resetAllBtn: document.getElementById('reset-all-btn'),
        teamsGrid: document.getElementById('teams-grid'),
        teamSummary: document.getElementById('team-summary'),
        feedback: document.getElementById('feedback'),
        subsSection: document.getElementById('subs-section'),
        subsList: document.getElementById('subs-list'),
        drawOverlay: document.getElementById('draw-overlay'),
        drawName: document.getElementById('draw-name'),

        // Edit modal
        editModal: document.getElementById('edit-modal'),
        editForm: document.getElementById('edit-form'),
        editName: document.getElementById('edit-name'),
        editPrimary: document.getElementById('edit-primary'),
        editSecondary: document.getElementById('edit-secondary'),
        editFlexible: document.getElementById('edit-flexible'),
        editSkipRecent: document.getElementById('edit-skip-recently'),
        editCancel: document.getElementById('edit-cancel')
    };

    /* -----------------------------------------------------------------
     * Utilities
     * ----------------------------------------------------------------- */

    /** Cryptographically random ID (fallback for older browsers). */
    function uid() {
        if (window.crypto && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }

    /** Fisher-Yates shuffle (in place). */
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /** Look up a player by ID. */
    function getPlayer(id) {
        return state.players.find(p => p.id === id) || null;
    }

    /** Show a message in the feedback area. */
    function setFeedback(msg, level) {
        ui.feedback.textContent = msg || '';
        ui.feedback.className = 'feedback' + (level ? ' ' + level : '');
    }

    /**
     * Determine which tier a player belongs in for a given position.
     * Returns 1, 2, 3 for eligible tiers or 0 if not eligible.
     */
    function positionTier(player, position) {
        if (player.primary === position) return 1;
        if (player.secondary === position) return 2;
        if (player.flexible) return 3;
        return 0;
    }

    /* -----------------------------------------------------------------
     * Player management
     * ----------------------------------------------------------------- */

    function addPlayer(data) {
        const name = (data.name || '').trim();
        if (!name) return null;

        const player = {
            id: uid(),
            name,
            primary: POSITIONS.includes(data.primary) ? data.primary : 'lead',
            secondary: POSITIONS.includes(data.secondary) ? data.secondary : '',
            flexible: !!data.flexible,
            skipRecently: !!data.skipRecently,
            excluded: !!data.excluded
        };

        // Primary and secondary must differ; if they collide, clear secondary
        if (player.secondary === player.primary) player.secondary = '';

        state.players.push(player);
        return player;
    }

    function removePlayer(id) {
        state.players = state.players.filter(p => p.id !== id);
        // If teams exist, wipe them because the roster changed materially.
        clearTeams();
    }

    function updatePlayer(id, data) {
        const player = getPlayer(id);
        if (!player) return;
        Object.assign(player, data);
        if (player.secondary === player.primary) player.secondary = '';
        clearTeams();
    }

    function toggleExclude(id) {
        const player = getPlayer(id);
        if (!player) return;
        player.excluded = !player.excluded;
        renderRoster();
    }

    function clearTeams() {
        state.teams = null;
        state.substitutes = [];
        setFeedback('');
        renderTeams();
    }

    /* -----------------------------------------------------------------
     * Bulk paste parser
     *   Line format:  name, primary, secondary, flags...
     *   Flags:        flex, recent
     * ----------------------------------------------------------------- */
    function parseBulk(text) {
        const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
        const added = [];
        const errors = [];

        rows.forEach((line, idx) => {
            const parts = line.split(',').map(p => p.trim());
            const name = parts[0];
            if (!name) return;

            const primary = (parts[1] || 'lead').toLowerCase();
            if (!POSITIONS.includes(primary)) {
                errors.push(`Line ${idx + 1}: unknown primary "${primary}"`);
                return;
            }
            const secondaryRaw = (parts[2] || '').toLowerCase();
            const secondary = POSITIONS.includes(secondaryRaw) ? secondaryRaw : '';

            const flags = parts.slice(3).map(f => f.toLowerCase());
            const flexible = flags.includes('flex') || flags.includes('any') || flags.includes('flexible');
            const skipRecently = flags.includes('recent') || flags.includes('recentskip');

            const player = addPlayer({ name, primary, secondary, flexible, skipRecently });
            if (player) added.push(player);
        });

        return { added, errors };
    }

    /* =================================================================
     * FILE IMPORT (Excel .xlsx and CSV)
     *
     * Zero external dependencies. The .xlsx parser uses the browser's
     * built-in DecompressionStream to inflate the ZIP archive, then
     * parses the OOXML with DOMParser. Everything stays in-browser.
     * ================================================================= */

    /** Track parsed sheets between file-load and "Add players" click. */
    const importSession = {
        /** @type {Array<{name: string, players: Array<{name:string, position:string, valid:boolean, raw:string}>}> | null} */
        sheets: null,
        /** @type {Set<number>} indices of selected sheets */
        selected: new Set()
    };

    /**
     * Parse a Position-column value.
     *
     * Returns `{ position, flexible }`:
     *   - `position` is one of POSITIONS (skip/third/second/lead) or ''
     *   - `flexible` is true when the value indicates the player can
     *     play anywhere — empty cell, or one of the "any" synonyms.
     *
     * A row is considered valid if it has a position OR is flexible.
     * An unrecognised value returns `{ position:'', flexible:false }`
     * which the caller treats as invalid.
     */
    function normalisePosition(raw) {
        if (raw === null || raw === undefined) {
            return { position: '', flexible: true };
        }
        const s = String(raw).trim().toLowerCase();
        if (!s) return { position: '', flexible: true };
        if (['any', 'anywhere', 'flex', 'flexible', 'anyone', '*', '-'].includes(s)) {
            return { position: '', flexible: true };
        }
        if (s.startsWith('skip')) return { position: 'skip', flexible: false };
        if (s.startsWith('third') || s === '3rd' || s === '3') return { position: 'third', flexible: false };
        if (s.startsWith('second') || s === '2nd' || s === '2') return { position: 'second', flexible: false };
        if (s.startsWith('lead') || s === '1st' || s === '1' || s === '4') return { position: 'lead', flexible: false };
        if (POSITIONS.includes(s)) return { position: s, flexible: false };
        // Non-empty but unrecognised
        return { position: '', flexible: false };
    }

    /** Very small CSV parser that handles quoted fields with commas / newlines. */
    function parseCSVText(text) {
        const rows = [];
        let cur = '';
        let row = [];
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') { cur += '"'; i++; }
                    else { inQuotes = false; }
                } else {
                    cur += ch;
                }
            } else {
                if (ch === '"') { inQuotes = true; }
                else if (ch === ',') { row.push(cur); cur = ''; }
                else if (ch === '\n' || ch === '\r') {
                    if (ch === '\r' && text[i + 1] === '\n') i++;
                    row.push(cur); cur = '';
                    if (row.some(f => f.trim() !== '')) rows.push(row);
                    row = [];
                } else {
                    cur += ch;
                }
            }
        }
        if (cur !== '' || row.length > 0) {
            row.push(cur);
            if (row.some(f => f.trim() !== '')) rows.push(row);
        }
        return rows;
    }

    /**
     * Extract text files from a ZIP (xlsx) buffer using the central
     * directory. Only STORE (0) and DEFLATE (8) methods are supported.
     */
    async function unzipXlsx(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const bytes = new Uint8Array(arrayBuffer);
        const decoder = new TextDecoder('utf-8');

        // Find End of Central Directory record — search backwards.
        let eocd = -1;
        const minEocdOffset = Math.max(0, bytes.length - 65558);
        for (let i = bytes.length - 22; i >= minEocdOffset; i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('Not a valid .xlsx file (missing EOCD).');

        const entryCount = view.getUint16(eocd + 10, true);
        const cdOffset = view.getUint32(eocd + 16, true);

        const files = {};
        let p = cdOffset;
        for (let n = 0; n < entryCount; n++) {
            if (view.getUint32(p, true) !== 0x02014b50) {
                throw new Error('Corrupt central directory entry.');
            }
            const method = view.getUint16(p + 10, true);
            const compSize = view.getUint32(p + 20, true);
            const nameLen = view.getUint16(p + 28, true);
            const extraLen = view.getUint16(p + 30, true);
            const commentLen = view.getUint16(p + 32, true);
            const lfhOffset = view.getUint32(p + 42, true);
            const name = decoder.decode(bytes.slice(p + 46, p + 46 + nameLen));

            // Read the local file header to find the actual data offset.
            const lfhNameLen = view.getUint16(lfhOffset + 26, true);
            const lfhExtraLen = view.getUint16(lfhOffset + 28, true);
            const dataStart = lfhOffset + 30 + lfhNameLen + lfhExtraLen;
            const compBytes = bytes.slice(dataStart, dataStart + compSize);

            let out;
            if (method === 0) {
                out = compBytes;
            } else if (method === 8) {
                if (typeof DecompressionStream === 'undefined') {
                    throw new Error('This browser cannot decompress .xlsx files. Please save your file as CSV.');
                }
                const stream = new Blob([compBytes]).stream()
                    .pipeThrough(new DecompressionStream('deflate-raw'));
                const buf = await new Response(stream).arrayBuffer();
                out = new Uint8Array(buf);
            } else {
                throw new Error(`Unsupported compression method (${method}) in .xlsx.`);
            }
            files[name] = decoder.decode(out);
            p += 46 + nameLen + extraLen + commentLen;
        }
        return files;
    }

    function parseXml(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length > 0) {
            throw new Error('Malformed XML inside .xlsx.');
        }
        return doc;
    }

    function parseSharedStrings(xml) {
        if (!xml) return [];
        const doc = parseXml(xml);
        return Array.from(doc.getElementsByTagName('si')).map(si => {
            const texts = Array.from(si.getElementsByTagName('t'));
            return texts.map(t => t.textContent).join('');
        });
    }

    function parseWorkbookSheets(xml) {
        const doc = parseXml(xml);
        return Array.from(doc.getElementsByTagName('sheet')).map(s => ({
            name: s.getAttribute('name') || 'Sheet',
            rId: s.getAttributeNS(
                'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
                'id'
            )
        }));
    }

    function parseWorkbookRels(xml) {
        const doc = parseXml(xml);
        const map = {};
        Array.from(doc.getElementsByTagName('Relationship')).forEach(r => {
            map[r.getAttribute('Id')] = r.getAttribute('Target');
        });
        return map;
    }

    /** Convert cell reference like "AB12" to a column index (A = 0). */
    function colFromRef(ref) {
        const letters = (ref || '').match(/^[A-Z]+/i);
        if (!letters) return 0;
        let n = 0;
        const s = letters[0].toUpperCase();
        for (let i = 0; i < s.length; i++) {
            n = n * 26 + (s.charCodeAt(i) - 64);
        }
        return n - 1;
    }

    function parseSheetRows(xml, sharedStrings) {
        const doc = parseXml(xml);
        const rows = [];
        Array.from(doc.getElementsByTagName('row')).forEach(row => {
            const cells = [];
            Array.from(row.getElementsByTagName('c')).forEach(c => {
                const idx = colFromRef(c.getAttribute('r'));
                const t = c.getAttribute('t');
                let value = '';
                if (t === 's') {
                    const v = c.getElementsByTagName('v')[0];
                    if (v) value = sharedStrings[parseInt(v.textContent, 10)] || '';
                } else if (t === 'inlineStr') {
                    const is = c.getElementsByTagName('is')[0];
                    if (is) {
                        value = Array.from(is.getElementsByTagName('t'))
                            .map(x => x.textContent).join('');
                    }
                } else {
                    const v = c.getElementsByTagName('v')[0];
                    if (v) value = v.textContent;
                }
                cells[idx] = value;
            });
            rows.push(cells);
        });
        return rows;
    }

    /**
     * Given rows-as-arrays, figure out which column holds Name and which
     * holds Position. If we can't find a header, assume col 0 = Name and
     * col 1 = Position. Returns { nameCol, posCol, dataStart }.
     */
    function detectColumns(rows) {
        for (let i = 0; i < Math.min(rows.length, 5); i++) {
            const row = rows[i] || [];
            let nameCol = -1, posCol = -1;
            row.forEach((cell, idx) => {
                const v = (cell || '').toString().trim().toLowerCase();
                if (nameCol < 0 && /^(name|player|player name)$/.test(v)) nameCol = idx;
                if (posCol < 0 && /^(position|pos|primary|role)$/.test(v)) posCol = idx;
            });
            if (nameCol >= 0 && posCol >= 0) {
                return { nameCol, posCol, dataStart: i + 1 };
            }
        }
        // No header — fall back to first two columns.
        return { nameCol: 0, posCol: 1, dataStart: 0 };
    }

    /**
     * Transform raw table rows into normalised player records for a
     * single sheet. Empty-name rows are dropped. Missing positions and
     * "any"-style values are accepted as flexible players; only rows
     * with a non-empty, unrecognised position are flagged invalid.
     */
    function rowsToSheetPlayers(rows) {
        const { nameCol, posCol, dataStart } = detectColumns(rows);
        const players = [];
        for (let i = dataStart; i < rows.length; i++) {
            const row = rows[i] || [];
            const name = (row[nameCol] || '').toString().trim();
            const raw = (row[posCol] || '').toString().trim();
            if (!name) continue;
            const { position, flexible } = normalisePosition(raw);
            // A row is valid if it names a position OR is marked
            // flexible (blank cell or an "any"-style keyword).
            const valid = !!position || flexible;
            players.push({
                name,
                position,     // '' when flexible-only
                flexible,
                raw,
                valid
            });
        }
        return players;
    }

    async function parseImportFile(file) {
        const isCsv = /\.csv$/i.test(file.name);
        const isXlsx = /\.xlsx$/i.test(file.name);
        if (!isCsv && !isXlsx) {
            throw new Error('Unsupported file type. Please choose a .xlsx or .csv file.');
        }

        if (isCsv) {
            const text = await file.text();
            const rows = parseCSVText(text);
            return [{ name: file.name.replace(/\.csv$/i, ''), players: rowsToSheetPlayers(rows) }];
        }

        const buffer = await file.arrayBuffer();
        const files = await unzipXlsx(buffer);
        const workbookXml = files['xl/workbook.xml'];
        const relsXml = files['xl/_rels/workbook.xml.rels'];
        if (!workbookXml || !relsXml) {
            throw new Error('This does not look like an Excel workbook.');
        }
        const shared = parseSharedStrings(files['xl/sharedStrings.xml']);
        const sheetInfos = parseWorkbookSheets(workbookXml);
        const rels = parseWorkbookRels(relsXml);

        return sheetInfos.map(info => {
            const target = rels[info.rId] || '';
            // Targets in xl/_rels/workbook.xml.rels are typically
            // relative to xl/ (e.g. "worksheets/sheet1.xml").
            const key = target.startsWith('/')
                ? target.slice(1)
                : 'xl/' + target;
            const sheetXml = files[key] || files[key.replace(/^xl\//, '')] || '';
            const rows = sheetXml ? parseSheetRows(sheetXml, shared) : [];
            return { name: info.name, players: rowsToSheetPlayers(rows) };
        });
    }

    /* -----------------------------------------------------------------
     * Import UI wiring
     * ----------------------------------------------------------------- */

    function setImportFeedback(msg, level) {
        ui.importFeedback.textContent = msg || '';
        ui.importFeedback.className = 'feedback' + (level ? ' ' + level : '');
    }

    function resetImportPanel() {
        importSession.sheets = null;
        importSession.selected.clear();
        ui.importFile.value = '';
        ui.importPreview.classList.add('hidden');
        ui.importSheetPicker.innerHTML = '';
        ui.importPreviewSummary.textContent = '';
        ui.importPreviewTable.querySelector('tbody').innerHTML = '';
        ui.importAdd.disabled = true;
        setImportFeedback('');
    }

    function renderImportSheetPicker() {
        ui.importSheetPicker.innerHTML = '';
        if (!importSession.sheets || importSession.sheets.length <= 1) return;
        importSession.sheets.forEach((sheet, idx) => {
            const label = document.createElement('label');
            label.className = 'sheet-toggle';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = importSession.selected.has(idx);
            cb.addEventListener('change', () => {
                if (cb.checked) importSession.selected.add(idx);
                else importSession.selected.delete(idx);
                renderImportPreview();
            });
            label.appendChild(cb);
            const nameSpan = document.createElement('span');
            nameSpan.textContent = sheet.name;
            label.appendChild(nameSpan);
            const count = document.createElement('span');
            count.className = 'sheet-count';
            count.textContent = `(${sheet.players.length})`;
            label.appendChild(count);
            ui.importSheetPicker.appendChild(label);
        });
    }

    /**
     * Compute the import plan.
     *
     * With multiple sheets selected, each sheet becomes its own new
     * competition — so cross-sheet duplicates are fine (a player can
     * legitimately be in both Trophy 1 and Trophy 2). Duplicate names
     * within a single sheet are always skipped.
     *
     * With a single sheet selected, players are added to the currently
     * active competition. The "skip names already in the active tab"
     * checkbox controls whether an existing name suppresses re-adding.
     *
     * @returns {{
     *   rows: Array<{name,position,valid,raw,sheet,skipReason}>,
     *   strategy: 'new-competitions' | 'active-tab',
     *   sheetsSelected: number
     * }}
     */
    function buildImportPlan() {
        const rows = [];
        if (!importSession.sheets) {
            return { rows, strategy: 'active-tab', sheetsSelected: 0 };
        }

        const selectedSheets = importSession.sheets
            .map((sheet, idx) => ({ sheet, idx }))
            .filter(x => importSession.selected.has(x.idx));

        const strategy = selectedSheets.length > 1 ? 'new-competitions' : 'active-tab';
        const dedupeRoster = ui.importDedupeRoster.checked;
        const activeRoster = new Set(
            state.players.map(p => p.name.trim().toLowerCase())
        );

        selectedSheets.forEach(({ sheet }) => {
            const seenInSheet = new Set();
            sheet.players.forEach(pl => {
                const key = pl.name.toLowerCase();
                let skipReason = null;
                if (!pl.valid) {
                    // Non-empty but unrecognised position value. (Blank
                    // cells are treated as "flexible" and are valid.)
                    skipReason = `unknown position "${pl.raw}"`;
                } else if (seenInSheet.has(key)) {
                    skipReason = 'duplicate name in sheet';
                } else if (strategy === 'active-tab' && dedupeRoster && activeRoster.has(key)) {
                    skipReason = 'already in active tab';
                }
                if (!skipReason) seenInSheet.add(key);
                rows.push({
                    name: pl.name,
                    position: pl.position,
                    flexible: pl.flexible,
                    raw: pl.raw,
                    valid: pl.valid,
                    sheet: sheet.name,
                    skipReason
                });
            });
        });

        return { rows, strategy, sheetsSelected: selectedSheets.length };
    }

    function renderImportPreview() {
        renderImportSheetPicker();
        const tbody = ui.importPreviewTable.querySelector('tbody');
        tbody.innerHTML = '';

        if (!importSession.sheets) {
            ui.importPreview.classList.add('hidden');
            ui.importAdd.disabled = true;
            return;
        }
        ui.importPreview.classList.remove('hidden');

        const { rows, strategy, sheetsSelected } = buildImportPlan();
        const willAdd = rows.filter(r => !r.skipReason);
        const skipped = rows.length - willAdd.length;

        // Explain what will happen once "Add players" is clicked.
        let summary;
        if (sheetsSelected === 0) {
            summary = 'No sheets selected.';
        } else if (strategy === 'new-competitions') {
            // Distinguish tabs that will actually get players from
            // ones that will be created empty (all rows invalid /
            // missing positions).
            const tabsWithPlayers = new Set(willAdd.map(r => r.sheet)).size;
            const tabsEmpty = sheetsSelected - tabsWithPlayers;
            summary = `${willAdd.length} player${willAdd.length === 1 ? '' : 's'} will be imported into ${sheetsSelected} new competition tabs (one per sheet).`;
            if (tabsEmpty > 0) {
                summary += ` ${tabsEmpty} tab${tabsEmpty === 1 ? '' : 's'} will start empty because no valid rows were found in ${tabsEmpty === 1 ? 'that sheet' : 'those sheets'}.`;
            }
        } else {
            const targetName = activeCompetition() && activeCompetition().name !== 'Untitled'
                ? `"${activeCompetition().name}"`
                : 'the active tab';
            summary = `${willAdd.length} player${willAdd.length === 1 ? '' : 's'} will be added to ${targetName}.`;
        }
        if (skipped > 0) summary += ` ${skipped} row${skipped === 1 ? '' : 's'} skipped.`;
        ui.importPreviewSummary.textContent = summary;

        // Hide the sheet column when there's only one sheet total.
        const showSheetCol = importSession.sheets.length > 1;
        ui.importPreviewTable.querySelectorAll('th')[2].style.display =
            showSheetCol ? '' : 'none';

        // The dedupe-roster toggle only matters when we're adding to the
        // active tab. Grey it out in the multi-sheet path.
        ui.importDedupeRoster.disabled = strategy === 'new-competitions';

        rows.forEach(row => {
            const tr = document.createElement('tr');
            if (!row.valid) tr.classList.add('row-warn');
            if (row.skipReason) tr.classList.add('row-skip');

            const nameTd = document.createElement('td');
            nameTd.textContent = row.name;
            tr.appendChild(nameTd);

            const posTd = document.createElement('td');
            posTd.className = 'pos-cell';
            if (row.skipReason) {
                posTd.textContent = row.position || row.raw || '—';
                posTd.title = row.skipReason;
            } else if (row.flexible && !row.position) {
                posTd.textContent = 'any';
                posTd.title = 'Player can be placed in any position';
            } else {
                posTd.textContent = row.position;
                if (row.flexible) posTd.title = 'Also flagged flexible';
            }
            tr.appendChild(posTd);

            const sheetTd = document.createElement('td');
            sheetTd.textContent = row.sheet;
            if (!showSheetCol) sheetTd.style.display = 'none';
            tr.appendChild(sheetTd);

            tbody.appendChild(tr);
        });

        // Multi-sheet imports create one tab per selected sheet, even
        // when a sheet has no valid rows — so keep the button enabled
        // as long as at least one sheet is selected. Single-sheet
        // imports still need something to add.
        ui.importAdd.disabled = strategy === 'new-competitions'
            ? sheetsSelected === 0
            : willAdd.length === 0;
    }

    async function handleImportFileChange(evt) {
        const file = evt.target.files && evt.target.files[0];
        if (!file) return;
        setImportFeedback('Reading file…');
        try {
            const sheets = await parseImportFile(file);
            importSession.sheets = sheets;
            importSession.selected = new Set(sheets.map((_, i) => i));
            renderImportPreview();
            const totalPlayers = sheets.reduce((n, s) => n + s.players.length, 0);
            if (totalPlayers === 0) {
                setImportFeedback('No player rows found in this file.', 'warning');
            } else {
                setImportFeedback('', '');
            }
        } catch (err) {
            console.error(err);
            importSession.sheets = null;
            importSession.selected.clear();
            ui.importPreview.classList.add('hidden');
            setImportFeedback(err.message || 'Could not read that file.', 'error');
        }
    }

    function commitImport() {
        if (!importSession.sheets) return;
        const { rows, strategy, sheetsSelected } = buildImportPlan();
        const willAdd = rows.filter(r => !r.skipReason);

        // For the active-tab path, if there are no rows to add there's
        // nothing to do. For the new-competitions path we may still
        // want to create empty tabs — one per selected sheet — so the
        // user isn't surprised by "I chose 4 sheets but only 3 tabs
        // appeared". So we only early-exit here in the active-tab case.
        if (willAdd.length === 0 && strategy !== 'new-competitions') return;

        // Group additions by source sheet name for quick lookup.
        const rowsBySheet = new Map();
        willAdd.forEach(row => {
            if (!rowsBySheet.has(row.sheet)) rowsBySheet.set(row.sheet, []);
            rowsBySheet.get(row.sheet).push(row);
        });

        let firstNewCompId = null;

        if (strategy === 'new-competitions') {
            // Create one competition per selected sheet, iterating over
            // the sheets themselves so that empty / all-invalid sheets
            // still get a tab. If the current competition is empty
            // (fresh page), reuse it for the first sheet and rename
            // it, rather than leaving a stray tab.
            const selectedSheets = importSession.sheets
                .filter((_, idx) => importSession.selected.has(idx));

            selectedSheets.forEach((sheet, sheetIndex) => {
                let target;
                const empty = state.players.length === 0 && !state.teams;
                if (sheetIndex === 0 && empty) {
                    target = activeCompetition();
                    target.name = sheet.name;
                } else {
                    target = makeCompetition(sheet.name);
                    state.competitions.push(target);
                }
                if (!firstNewCompId) firstNewCompId = target.id;

                const sheetRows = rowsBySheet.get(sheet.name) || [];
                sheetRows.forEach(row => {
                    target.players.push({
                        id: uid(),
                        name: row.name,
                        // Flexible-only rows (blank / "any" position) get
                        // a placeholder primary so the roster form still
                        // has something valid to display; the flexible
                        // flag makes the generator use tier-3 fallback.
                        primary: row.position || 'lead',
                        secondary: '',
                        flexible: !!row.flexible,
                        skipRecently: false,
                        excluded: false
                    });
                });
            });

            if (firstNewCompId) state.activeId = firstNewCompId;
        } else {
            // Single sheet → add to the active competition. Auto-name
            // the active tab after the sheet if it's still the default.
            const target = activeCompetition();
            if (target && target.name === 'Untitled' && target.players.length === 0) {
                const firstSheet = Array.from(rowsBySheet.keys())[0];
                if (firstSheet) target.name = firstSheet;
            }
            willAdd.forEach(row => {
                addPlayer({
                    name: row.name,
                    primary: row.position || 'lead',
                    secondary: '',
                    flexible: !!row.flexible,
                    skipRecently: false
                });
            });
        }

        const skipped = rows.length - willAdd.length;

        renderCompetitionTabs();
        renderRoster();
        renderTeams();

        let msg;
        if (strategy === 'new-competitions') {
            // Name every selected sheet so it's obvious an "empty"
            // sheet was still turned into a tab.
            const tabNames = importSession.sheets
                .filter((_, idx) => importSession.selected.has(idx))
                .map(s => s.name);
            const nameList = tabNames.length <= 3
                ? tabNames.map(n => `"${n}"`).join(', ')
                : `${tabNames.length} tabs`;
            msg = `Imported ${willAdd.length} player${willAdd.length === 1 ? '' : 's'} into ${nameList}. ` +
                  `Use the tabs at the top of the page to switch between them.`;
        } else {
            msg = `Imported ${willAdd.length} player${willAdd.length === 1 ? '' : 's'}.`;
        }
        if (skipped > 0) msg += ` ${skipped} row${skipped === 1 ? '' : 's'} skipped.`;
        setFeedback(msg, skipped > 0 ? 'warning' : '');

        resetImportPanel();
        ui.importPanel.classList.add('hidden');

        // Bring the tab strip into view so the user notices the new
        // tabs, especially when multiple competitions were created.
        if (strategy === 'new-competitions' && ui.compBlock && !ui.compBlock.classList.contains('hidden')) {
            ui.compBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    /* =================================================================
     * TEAM GENERATION
     *
     * Strategy: iterated randomised greedy assignment.
     *   - We honour locked slots first (from a previous draw).
     *   - Free players are shuffled and assigned to open slots position
     *     by position. For each position we prefer tier-1 (primary)
     *     candidates first, then tier-2 (secondary), then tier-3
     *     (flexible). Skip-recent players are shuffled to the *end* of
     *     the skip tier-1 pool to reduce their skip-selection odds.
     *   - We run the whole thing many times and keep the attempt with
     *     the lowest total tier score (i.e. the best fit).
     * ================================================================= */

    function generateTeams(options) {
        options = options || {};
        const respectLocks = !!options.respectLocks;

        // ---- 1. Determine active players and existing locks ----
        const active = state.players.filter(p => !p.excluded);

        // Player IDs already locked in the previous draw (either
        // slot-locked or belonging to a locked team).
        const lockedAssignments = respectLocks && state.teams
            ? collectLocks(state.teams)
            : {
                byPosition: { skip: [], third: [], second: [], lead: [] },
                teamLocked: new Set(),
                playerLocked: new Set()
            };

        const teamSize = activeTeamSize();
        const teamCount = Math.floor(active.length / teamSize);
        if (teamCount === 0) {
            return {
                teams: [],
                substitutes: active.map(p => p.id),
                warning: active.length === 0
                    ? 'Add players before drawing.'
                    : `Need at least ${teamSize} players for a full ${teamSize}-person team (have ${active.length}).`
            };
        }

        // If we're respecting locks, and the current team count differs
        // from what's locked, we cannot honour all locks. Fall back
        // to preserving as many as fit.
        if (respectLocks && state.teams && teamCount < state.teams.length) {
            // We'll just try to keep player-level locks; drop team-locks
            // that no longer fit.
            lockedAssignments.teamLocked.clear();
        }

        // ---- 2. Run multiple randomised attempts ----
        let best = null;

        for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt++) {
            const result = attemptDraw(active, teamCount, lockedAssignments);
            if (!best || result.score < best.score) {
                best = result;
                // Perfect (all tier-1) — stop early.
                if (best.score === teamCount * teamSize) break;
            }
        }

        // ---- 3. Build result ----
        return {
            teams: best.teams,
            substitutes: best.substitutes,
            warning: best.warning
        };
    }

    /**
     * Collect all locked slots from a previous team layout.
     * Returns:
     *   byPosition: { skip: [{playerId, teamIndex}], third: [...], ... }
     *   teamLocked: Set<number> of team indices that are fully locked
     *   playerLocked: Set<string> of player IDs that are individually locked
     */
    function collectLocks(teams) {
        const byPosition = { skip: [], third: [], second: [], lead: [] };
        const teamLocked = new Set();
        const playerLocked = new Set();

        teams.forEach((team, teamIdx) => {
            const isTeamLocked = team.locked;
            if (isTeamLocked) teamLocked.add(teamIdx);
            POSITIONS.forEach(pos => {
                const slot = team.slots[pos];
                if (!slot || !slot.playerId) return;
                if (slot.locked || isTeamLocked) {
                    // Only keep if the player still exists and isn't excluded
                    const player = getPlayer(slot.playerId);
                    if (player && !player.excluded) {
                        byPosition[pos].push({ playerId: slot.playerId, teamIndex: teamIdx });
                        playerLocked.add(slot.playerId);
                    }
                }
            });
        });

        return { byPosition, teamLocked, playerLocked };
    }

    /**
     * One randomised draw attempt.
     */
    function attemptDraw(activePlayers, teamCount, locks) {
        const positions = activePositions();
        const teamSize = positions.length;

        // Build empty teams (only slots that this competition uses).
        const teams = [];
        for (let i = 0; i < teamCount; i++) {
            const slots = {};
            positions.forEach(pos => { slots[pos] = emptySlot(); });
            teams.push({
                number: i + 1,
                locked: locks.teamLocked.has(i),
                slots
            });
        }

        // ---- Apply locked assignments first ----
        positions.forEach(pos => {
            const bucket = locks.byPosition[pos] || [];
            bucket.forEach(entry => {
                if (entry.teamIndex >= teamCount) return; // team no longer exists
                const player = getPlayer(entry.playerId);
                if (!player) return;
                const tier = positionTier(player, pos) || 3;
                teams[entry.teamIndex].slots[pos] = {
                    playerId: entry.playerId,
                    locked: true,
                    tier: tier
                };
            });
        });

        // ---- Build the pool of unlocked players ----
        const pool = activePlayers.filter(p => !locks.playerLocked.has(p.id));
        shuffle(pool);

        let score = 0;

        // Track which team indices still need each position
        const needsByPos = {};
        positions.forEach(pos => {
            needsByPos[pos] = [];
            teams.forEach((team, idx) => {
                if (!team.slots[pos].playerId) needsByPos[pos].push(idx);
            });
        });

        // ---- Assignment order ----
        // We fill positions in the order that is typically hardest to
        // satisfy first. Skip is usually scarcest, then third, etc.
        const orderedPositions = positions.slice();

        // Small random rotation so first team doesn't always get the
        // "first drawn" skip.
        const teamRotation = Math.floor(Math.random() * teamCount);

        for (const position of orderedPositions) {
            const needed = needsByPos[position];
            if (needed.length === 0) continue;

            // Bucket remaining pool by eligibility tier for this position
            const buckets = { 1: [], 2: [], 3: [] };
            pool.forEach(p => {
                if (p._assigned) return;
                const tier = positionTier(p, position);
                if (tier > 0) buckets[tier].push(p);
            });

            // Shuffle each bucket independently for randomness
            shuffle(buckets[1]);
            shuffle(buckets[2]);
            shuffle(buckets[3]);

            // For skip: push skip-recently players toward the back of
            // tier 1 so they're picked last within their tier.
            if (position === 'skip') {
                buckets[1].sort((a, b) => {
                    // Stable-ish nudge: recent-skip = 1 (later), fresh = 0
                    const wa = a.skipRecently ? SKIP_RECENT_PENALTY * Math.random() : Math.random();
                    const wb = b.skipRecently ? SKIP_RECENT_PENALTY * Math.random() : Math.random();
                    return wa - wb;
                });
            }

            // Assign
            let needIdx = 0;
            for (const tier of [1, 2, 3]) {
                while (needIdx < needed.length && buckets[tier].length > 0) {
                    const player = buckets[tier].shift();
                    if (player._assigned) continue;
                    const teamIdx = needed[(needIdx + teamRotation) % needed.length];
                    // Guard against double fill (shouldn't happen but be safe)
                    if (teams[teamIdx].slots[position].playerId) {
                        needIdx++;
                        continue;
                    }
                    teams[teamIdx].slots[position] = {
                        playerId: player.id,
                        locked: false,
                        tier: tier
                    };
                    player._assigned = true;
                    score += tier;
                    needIdx++;
                }
            }
        }

        // Compute substitutes and clean the transient flag
        const substitutes = [];
        pool.forEach(p => {
            if (!p._assigned) substitutes.push(p.id);
            delete p._assigned;
        });

        // Detect incomplete teams (shouldn't occur if teamCount was
        // chosen correctly, but defensive check).
        let warning = '';
        const incompleteTeams = teams.filter(t =>
            positions.some(pos => !t.slots[pos].playerId)
        );
        if (incompleteTeams.length > 0) {
            warning = `Some ${teamSize}-person teams could not be completed given the players' eligible positions. Consider marking more players as flexible.`;
        }

        return { teams, substitutes, score, warning };
    }

    function emptySlot() {
        return { playerId: null, locked: false, tier: 0 };
    }

    /* -----------------------------------------------------------------
     * Rendering
     * ----------------------------------------------------------------- */

    /* ---------- Competition tabs ---------- */
    function renderCompetitionTabs() {
        const nav = ui.compTabs;
        nav.innerHTML = '';

        const active = activeCompetition();

        // Update the panel section headings to reflect the active tab.
        const compName = active && active.name && active.name !== 'Untitled'
            ? ` — ${active.name}`
            : '';
        if (ui.rosterHeading) ui.rosterHeading.textContent = '1 · Player Roster' + compName;
        if (ui.teamsHeading) ui.teamsHeading.textContent = '2 · Teams' + compName;

        // Hide the whole competitions block entirely when there's just
        // one nameless competition — for casual users who never use the
        // import feature, competitions are invisible.
        const only = state.competitions.length === 1 && state.competitions[0].name === 'Untitled';
        if (only) {
            ui.compBlock.classList.add('hidden');
            syncTeamSizeSelector();
            return;
        }
        ui.compBlock.classList.remove('hidden');

        // Update hint copy based on how many tabs there are.
        if (ui.compHint) {
            ui.compHint.textContent = state.competitions.length > 1
                ? 'Click a tab to switch between draws'
                : 'Add more with + New competition';
        }

        state.competitions.forEach(comp => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'comp-tab' + (comp.id === state.activeId ? ' active' : '');
            tab.dataset.id = comp.id;
            tab.title = 'Double-click to rename';

            const name = document.createElement('span');
            name.className = 'comp-name';
            name.textContent = comp.name;
            tab.appendChild(name);

            const count = document.createElement('span');
            count.className = 'comp-count';
            count.textContent = comp.players.length;
            count.title = `${comp.players.length} player${comp.players.length === 1 ? '' : 's'}`;
            tab.appendChild(count);

            // Delete button — only when more than one competition exists.
            if (state.competitions.length > 1) {
                const del = document.createElement('span');
                del.className = 'comp-delete';
                del.textContent = '×';
                del.setAttribute('role', 'button');
                del.setAttribute('aria-label', `Delete ${comp.name}`);
                del.title = `Delete ${comp.name}`;
                del.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteCompetition(comp.id);
                });
                tab.appendChild(del);
            }

            tab.addEventListener('click', () => switchCompetition(comp.id));
            tab.addEventListener('dblclick', (e) => {
                e.preventDefault();
                renameCompetition(comp.id);
            });

            nav.appendChild(tab);
        });

        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = 'comp-tab comp-new';
        newBtn.textContent = '+ New competition';
        newBtn.addEventListener('click', () => addCompetition());
        nav.appendChild(newBtn);

        syncTeamSizeSelector();
    }

    /**
     * Keep the team-size <select> and its hint aligned with the active
     * competition. Called whenever we switch tabs or (re-)render.
     */
    function syncTeamSizeSelector() {
        if (!ui.teamSize) return;
        const size = activeTeamSize();
        ui.teamSize.value = String(size);
        if (ui.teamSizeHint) {
            const positions = POSITIONS_BY_SIZE[size]
                .map(p => positionLabel(p, size))
                .join(' · ');
            ui.teamSizeHint.textContent = `Positions used: ${positions}`;
        }
    }

    function switchCompetition(id) {
        if (!state.competitions.some(c => c.id === id)) return;
        if (id === state.activeId) return;
        state.activeId = id;
        setFeedback('');
        renderCompetitionTabs();
        renderRoster();
        renderTeams();
    }

    function addCompetition(name) {
        const comp = makeCompetition(name);
        state.competitions.push(comp);
        state.activeId = comp.id;
        renderCompetitionTabs();
        renderRoster();
        renderTeams();
        return comp;
    }

    function deleteCompetition(id) {
        const comp = state.competitions.find(c => c.id === id);
        if (!comp) return;
        if (state.competitions.length <= 1) return; // must always keep one
        const hasContent = comp.players.length > 0 || (comp.teams && comp.teams.length > 0);
        if (hasContent) {
            const ok = confirm(`Delete "${comp.name}" and everything in it?`);
            if (!ok) return;
        }
        const idx = state.competitions.findIndex(c => c.id === id);
        state.competitions.splice(idx, 1);
        if (state.activeId === id) {
            state.activeId = state.competitions[Math.max(0, idx - 1)].id;
        }
        setFeedback('');
        renderCompetitionTabs();
        renderRoster();
        renderTeams();
    }

    function renameCompetition(id) {
        const comp = state.competitions.find(c => c.id === id);
        if (!comp) return;
        const next = prompt('Rename competition:', comp.name);
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed) return;
        comp.name = trimmed;
        renderCompetitionTabs();
    }

    function renderRoster() {
        const list = ui.playerList;
        list.innerHTML = '';

        if (state.players.length === 0) {
            ui.playerEmpty.classList.remove('hidden');
        } else {
            ui.playerEmpty.classList.add('hidden');
        }

        state.players.forEach(player => {
            const li = document.createElement('li');
            li.className = 'player-item' + (player.excluded ? ' excluded' : '');
            li.dataset.id = player.id;

            const info = document.createElement('div');
            info.className = 'player-info';

            const nameEl = document.createElement('span');
            nameEl.className = 'player-name';
            nameEl.textContent = player.name;
            info.appendChild(nameEl);

            const posEl = document.createElement('div');
            posEl.className = 'player-positions';

            const primaryTag = document.createElement('span');
            primaryTag.className = 'pos-tag primary-tag';
            primaryTag.textContent = POSITION_LABELS[player.primary];
            primaryTag.title = 'Primary position';
            posEl.appendChild(primaryTag);

            if (player.secondary) {
                const secTag = document.createElement('span');
                secTag.className = 'pos-tag secondary-tag';
                secTag.textContent = POSITION_LABELS[player.secondary];
                secTag.title = 'Secondary position';
                posEl.appendChild(secTag);
            }

            if (player.flexible) {
                const flexTag = document.createElement('span');
                flexTag.className = 'pos-tag flex-tag';
                flexTag.textContent = 'ANY';
                flexTag.title = 'Can play any position';
                posEl.appendChild(flexTag);
            }

            if (player.skipRecently) {
                const rec = document.createElement('span');
                rec.className = 'pos-tag recent-tag';
                rec.textContent = 'RECENT SKIP';
                rec.title = 'Played skip recently — lowered skip priority';
                posEl.appendChild(rec);
            }

            info.appendChild(posEl);
            li.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'player-actions';

            const excludeBtn = document.createElement('button');
            excludeBtn.type = 'button';
            excludeBtn.className = 'btn-icon';
            excludeBtn.title = player.excluded ? 'Include in next draw' : 'Exclude from next draw';
            excludeBtn.setAttribute('aria-label', excludeBtn.title);
            excludeBtn.textContent = player.excluded ? '☑️' : '⏸️';
            excludeBtn.addEventListener('click', () => toggleExclude(player.id));
            actions.appendChild(excludeBtn);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn-icon';
            editBtn.title = 'Edit player';
            editBtn.setAttribute('aria-label', 'Edit player');
            editBtn.textContent = '✏️';
            editBtn.addEventListener('click', () => openEditModal(player.id));
            actions.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn-icon danger';
            delBtn.title = 'Remove player';
            delBtn.setAttribute('aria-label', 'Remove player');
            delBtn.textContent = '🗑️';
            delBtn.addEventListener('click', () => {
                if (confirm(`Remove ${player.name}?`)) {
                    removePlayer(player.id);
                    renderRoster();
                }
            });
            actions.appendChild(delBtn);

            li.appendChild(actions);
            list.appendChild(li);
        });

        const activeCount = state.players.filter(p => !p.excluded).length;
        const total = state.players.length;
        ui.playerCounter.textContent = total === activeCount
            ? `${total} player${total === 1 ? '' : 's'}`
            : `${activeCount} active · ${total - activeCount} excluded`;

        // Enable/disable primary action
        ui.generateBtn.disabled = activeCount < activeTeamSize();

        // Keep the tab pill counts in sync with the roster size.
        const tabs = ui.compTabs.querySelectorAll('.comp-tab');
        state.competitions.forEach(comp => {
            tabs.forEach(t => {
                if (t.dataset.id === comp.id) {
                    const c = t.querySelector('.comp-count');
                    if (c) c.textContent = comp.players.length;
                }
            });
        });
    }

    function renderTeams() {
        const grid = ui.teamsGrid;
        grid.innerHTML = '';

        const comp = activeCompetition();
        const compLabel = comp && comp.name && comp.name !== 'Untitled'
            ? ` · ${comp.name}`
            : '';

        if (!state.teams || state.teams.length === 0) {
            ui.teamSummary.textContent = 'No draw yet' + compLabel;
            ui.redrawBtn.disabled = true;
            ui.printBtn.disabled = true;
            ui.subsSection.classList.add('hidden');
            return;
        }

        ui.teamSummary.textContent =
            `${state.teams.length} team${state.teams.length === 1 ? '' : 's'}` +
            (state.substitutes.length > 0
                ? ` · ${state.substitutes.length} sub${state.substitutes.length === 1 ? '' : 's'}`
                : '') +
            compLabel;

        ui.redrawBtn.disabled = false;
        ui.printBtn.disabled = false;

        state.teams.forEach((team, teamIdx) => {
            grid.appendChild(renderTeamCard(team, teamIdx));
        });

        // Substitutes
        if (state.substitutes.length > 0) {
            ui.subsSection.classList.remove('hidden');
            ui.subsList.innerHTML = '';
            state.substitutes.forEach(id => {
                const player = getPlayer(id);
                if (!player) return;
                const chip = document.createElement('li');
                chip.className = 'sub-chip';
                chip.textContent = player.name;
                chip.title = `Primary: ${POSITION_LABELS[player.primary]}`;
                chip.draggable = true;
                chip.dataset.playerId = player.id;
                chip.dataset.dragSource = 'sub';
                attachSlotDragHandlers(chip, null, null, true);
                ui.subsList.appendChild(chip);
            });
        } else {
            ui.subsSection.classList.add('hidden');
        }
    }

    function renderTeamCard(team, teamIdx) {
        const card = document.createElement('div');
        card.className = 'team-card' + (team.locked ? ' team-locked' : '');

        // Header
        const header = document.createElement('div');
        header.className = 'team-header';
        const title = document.createElement('div');
        title.className = 'team-title';
        title.textContent = `Team ${team.number}`;
        header.appendChild(title);

        const lockBtn = document.createElement('button');
        lockBtn.type = 'button';
        lockBtn.className = 'team-lock-btn';
        lockBtn.textContent = team.locked ? '🔒 Locked' : '🔓 Lock team';
        lockBtn.title = team.locked
            ? 'Team is locked — click to unlock'
            : 'Lock this team so it stays intact on redraw';
        lockBtn.addEventListener('click', () => {
            team.locked = !team.locked;
            renderTeams();
        });
        header.appendChild(lockBtn);
        card.appendChild(header);

        // Slots
        const slots = document.createElement('ul');
        slots.className = 'team-slots';

        const teamSize = activePositions().length;
        activePositions().forEach(pos => {
            const slot = team.slots[pos];
            const slotEl = document.createElement('li');
            slotEl.className = 'team-slot';
            slotEl.dataset.teamIndex = teamIdx;
            slotEl.dataset.position = pos;

            const label = document.createElement('span');
            label.className = 'slot-label ' + pos;
            label.textContent = positionLabel(pos, teamSize);
            slotEl.appendChild(label);

            const player = slot.playerId ? getPlayer(slot.playerId) : null;
            const nameEl = document.createElement('span');
            nameEl.className = 'slot-player';
            nameEl.textContent = player ? player.name : '— empty —';
            slotEl.appendChild(nameEl);

            // Position-match badge.
            //
            // The generator scores each placement by "tier":
            //   1 = player's primary position
            //   2 = player's secondary position
            //   3 = flexible / any-position fallback
            //
            // Tier 1 is the expected happy path, so we don't clutter
            // the card with a badge for it — the badge only appears
            // when the draw had to compromise, which is the case
            // organisers actually want to notice.
            if (slot.tier === 2 && player) {
                const tierEl = document.createElement('span');
                tierEl.className = 'slot-tier tier-2';
                tierEl.textContent = '2nd choice';
                tierEl.title = `${player.name}'s primary position wasn't available, so they've been placed in their secondary.`;
                slotEl.appendChild(tierEl);
            } else if (slot.tier === 3 && player) {
                const tierEl = document.createElement('span');
                tierEl.className = 'slot-tier tier-3';
                tierEl.textContent = 'any';
                tierEl.title = `${player.name} is marked as flexible and was placed here to complete the team — this isn't a preferred position.`;
                slotEl.appendChild(tierEl);
            }

            // Slot-level lock button (irrelevant if the whole team is locked)
            if (!team.locked && player) {
                const slotLock = document.createElement('button');
                slotLock.type = 'button';
                slotLock.className = 'slot-lock-btn' + (slot.locked ? ' locked' : '');
                slotLock.textContent = slot.locked ? '🔒' : '🔓';
                slotLock.title = slot.locked
                    ? 'Player locked to this slot'
                    : 'Lock this player to this slot';
                slotLock.setAttribute('aria-label', slotLock.title);
                slotLock.addEventListener('click', (e) => {
                    e.stopPropagation();
                    slot.locked = !slot.locked;
                    renderTeams();
                });
                slotEl.appendChild(slotLock);
            }

            // Drag-and-drop wiring
            const isDraggable = !!player && !team.locked && !slot.locked;
            slotEl.draggable = isDraggable;
            attachSlotDragHandlers(slotEl, teamIdx, pos, false);

            slots.appendChild(slotEl);
        });

        card.appendChild(slots);
        return card;
    }

    /* -----------------------------------------------------------------
     * Drag & drop between team slots (and to/from substitutes)
     * ----------------------------------------------------------------- */
    function attachSlotDragHandlers(el, teamIndex, position, isSubChip) {
        el.addEventListener('dragstart', (e) => {
            const playerId = isSubChip
                ? el.dataset.playerId
                : (state.teams[teamIndex].slots[position].playerId || '');
            if (!playerId) {
                e.preventDefault();
                return;
            }
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify({
                source: isSubChip ? 'sub' : 'slot',
                teamIndex,
                position,
                playerId
            }));
            el.classList.add('dragging');
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
        });

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.classList.add('drag-over');
        });

        el.addEventListener('dragleave', () => {
            el.classList.remove('drag-over');
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('drag-over');
            let payload;
            try {
                payload = JSON.parse(e.dataTransfer.getData('text/plain'));
            } catch (_) {
                return;
            }
            handleSlotDrop(payload, {
                target: isSubChip ? 'sub' : 'slot',
                teamIndex,
                position,
                playerId: isSubChip ? el.dataset.playerId : null
            });
        });
    }

    /**
     * Perform the swap when the user drops a player onto a slot or the
     * substitutes area.
     */
    function handleSlotDrop(source, target) {
        if (!state.teams) return;

        // Ignore drop on itself
        if (source.source === target.target
            && source.teamIndex === target.teamIndex
            && source.position === target.position) {
            return;
        }

        const teams = state.teams;
        const subs = state.substitutes;

        // Resolve source slot
        const srcSlot = source.source === 'slot'
            ? teams[source.teamIndex].slots[source.position]
            : null;

        // Guard: can't move out of locked
        if (srcSlot && srcSlot.locked) return;
        if (source.source === 'slot' && teams[source.teamIndex].locked) return;

        if (target.target === 'slot') {
            const dstTeam = teams[target.teamIndex];
            if (dstTeam.locked) return;
            const dstSlot = dstTeam.slots[target.position];
            if (dstSlot.locked) return;

            const srcPlayerId = source.playerId;
            const dstPlayerId = dstSlot.playerId;

            // Compute new tiers based on destination position
            const srcPlayer = getPlayer(srcPlayerId);
            const dstTier = srcPlayer ? (positionTier(srcPlayer, target.position) || 3) : 0;

            if (source.source === 'sub') {
                // Player was a substitute -> replace destination slot
                dstSlot.playerId = srcPlayerId;
                dstSlot.tier = dstTier;
                // Remove from subs
                const idx = subs.indexOf(srcPlayerId);
                if (idx > -1) subs.splice(idx, 1);
                // Whoever was in dst becomes a substitute
                if (dstPlayerId) subs.push(dstPlayerId);
            } else {
                // Slot-to-slot swap
                const otherPlayer = dstPlayerId ? getPlayer(dstPlayerId) : null;
                const srcNewTier = otherPlayer
                    ? (positionTier(otherPlayer, source.position) || 3)
                    : 0;

                srcSlot.playerId = dstPlayerId;
                srcSlot.tier = srcNewTier;
                dstSlot.playerId = srcPlayerId;
                dstSlot.tier = dstTier;
            }
        } else if (target.target === 'sub') {
            // Dropped onto a substitute chip -> swap with that sub
            if (source.source !== 'slot') return; // sub -> sub is a no-op
            if (!srcSlot) return;

            const targetSubId = target.playerId;
            const targetSub = getPlayer(targetSubId);
            const newTier = targetSub
                ? (positionTier(targetSub, source.position) || 3)
                : 0;

            const idx = subs.indexOf(targetSubId);
            if (idx > -1) subs.splice(idx, 1);
            subs.push(srcSlot.playerId);
            srcSlot.playerId = targetSubId;
            srcSlot.tier = newTier;
        }

        renderTeams();
    }

    /* -----------------------------------------------------------------
     * Drawing animation
     * ----------------------------------------------------------------- */
    function playDrawAnimation(names, done) {
        if (!names || names.length === 0) {
            done();
            return;
        }
        ui.drawOverlay.classList.remove('hidden');
        ui.drawOverlay.setAttribute('aria-hidden', 'false');

        const shuffled = shuffle(names.slice());
        const totalDuration = 1500; // ms
        const flickerInterval = 80;
        let elapsed = 0;
        let idx = 0;

        const timer = setInterval(() => {
            ui.drawName.textContent = shuffled[idx % shuffled.length];
            idx++;
            elapsed += flickerInterval;
            if (elapsed >= totalDuration) {
                clearInterval(timer);
                ui.drawOverlay.classList.add('hidden');
                ui.drawOverlay.setAttribute('aria-hidden', 'true');
                done();
            }
        }, flickerInterval);
    }

    /* -----------------------------------------------------------------
     * Main actions
     * ----------------------------------------------------------------- */

    function doGenerate(respectLocks) {
        const active = state.players.filter(p => !p.excluded);
        const teamSize = activeTeamSize();
        if (active.length < teamSize) {
            setFeedback(
                `Add at least ${teamSize} active players to draw a ${teamSize}-person team (have ${active.length}).`,
                'error'
            );
            return;
        }

        const names = active.map(p => p.name);
        playDrawAnimation(names, () => {
            const result = generateTeams({ respectLocks });
            state.teams = result.teams;
            state.substitutes = result.substitutes;
            if (result.warning) {
                setFeedback(result.warning, 'warning');
            } else if (result.substitutes.length > 0) {
                setFeedback(
                    `${result.teams.length} team${result.teams.length === 1 ? '' : 's'} drawn. ` +
                    `${result.substitutes.length} player${result.substitutes.length === 1 ? '' : 's'} listed as substitute${result.substitutes.length === 1 ? '' : 's'}.`,
                    ''
                );
            } else {
                setFeedback(`${result.teams.length} team${result.teams.length === 1 ? '' : 's'} drawn — everyone placed!`, '');
            }
            renderTeams();
            // Scroll to teams on mobile
            if (window.matchMedia('(max-width: 899px)').matches) {
                document.getElementById('teams-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    }

    function doReset() {
        if (state.players.length === 0 && !state.teams) return;
        const comp = activeCompetition();
        const scope = comp && comp.name !== 'Untitled' ? ` for "${comp.name}"` : '';
        if (!confirm(`Reset the roster and teams${scope}? Other competition tabs are untouched.`)) return;
        state.players = [];
        state.teams = null;
        state.substitutes = [];
        setFeedback('');
        renderCompetitionTabs();
        renderRoster();
        renderTeams();
    }

    /**
     * The "big red button": wipe every competition, every player and
     * every draw, leaving the app in exactly the state it would be in
     * after a browser refresh — one empty "Untitled" competition.
     */
    function doResetEverything() {
        const totalPlayers = state.competitions.reduce((n, c) => n + c.players.length, 0);
        const totalCompetitions = state.competitions.length;
        // No-op if there's genuinely nothing to clear.
        const isFresh = totalCompetitions === 1
            && state.competitions[0].name === 'Untitled'
            && totalPlayers === 0
            && !state.competitions[0].teams;
        if (isFresh) return;

        const parts = [];
        if (totalCompetitions > 0) {
            parts.push(`${totalCompetitions} competition${totalCompetitions === 1 ? '' : 's'}`);
        }
        if (totalPlayers > 0) {
            parts.push(`${totalPlayers} player${totalPlayers === 1 ? '' : 's'}`);
        }
        const summary = parts.length ? ` (${parts.join(', ')})` : '';

        if (!confirm(`Delete everything${summary} and start from a blank page? This can't be undone.`)) return;

        // Replace the whole competitions array with a single empty one.
        state.competitions = [makeCompetition('Untitled')];
        state.activeId = state.competitions[0].id;
        state.editingId = null;
        setFeedback('');
        renderCompetitionTabs();
        renderRoster();
        renderTeams();
    }

    /* -----------------------------------------------------------------
     * Edit modal
     * ----------------------------------------------------------------- */
    function openEditModal(id) {
        const player = getPlayer(id);
        if (!player) return;
        state.editingId = id;
        ui.editName.value = player.name;
        ui.editPrimary.value = player.primary;
        ui.editSecondary.value = player.secondary || '';
        ui.editFlexible.checked = player.flexible;
        ui.editSkipRecent.checked = player.skipRecently;
        ui.editModal.classList.remove('hidden');
        ui.editName.focus();
    }

    function closeEditModal() {
        state.editingId = null;
        ui.editModal.classList.add('hidden');
    }

    /* -----------------------------------------------------------------
     * Event wiring
     * ----------------------------------------------------------------- */
    function wireEvents() {
        // Player entry form
        ui.form.addEventListener('submit', (e) => {
            e.preventDefault();
            const player = addPlayer({
                name: ui.nameInput.value,
                primary: ui.primarySelect.value,
                secondary: ui.secondarySelect.value,
                flexible: ui.flexibleInput.checked,
                skipRecently: ui.skipRecentInput.checked
            });
            if (player) {
                renderRoster();
                ui.form.reset();
                ui.nameInput.focus();
            }
        });

        // Bulk paste
        ui.bulkToggle.addEventListener('click', () => {
            ui.bulkPanel.classList.toggle('hidden');
            if (!ui.bulkPanel.classList.contains('hidden')) {
                ui.bulkInput.focus();
            }
        });
        ui.bulkCancel.addEventListener('click', () => {
            ui.bulkPanel.classList.add('hidden');
            ui.bulkInput.value = '';
        });
        ui.bulkAdd.addEventListener('click', () => {
            const { added, errors } = parseBulk(ui.bulkInput.value);
            if (added.length > 0) {
                renderRoster();
                ui.bulkInput.value = '';
                ui.bulkPanel.classList.add('hidden');
                let msg = `Added ${added.length} player${added.length === 1 ? '' : 's'}.`;
                if (errors.length) msg += ' Errors: ' + errors.join('; ');
                setFeedback(msg, errors.length ? 'warning' : '');
            } else if (errors.length) {
                alert('Could not add players:\n' + errors.join('\n'));
            }
        });

        // Import from Excel / CSV
        ui.importToggle.addEventListener('click', () => {
            ui.importPanel.classList.toggle('hidden');
            if (!ui.importPanel.classList.contains('hidden')) {
                // Close bulk panel if it's open so they don't fight for attention.
                ui.bulkPanel.classList.add('hidden');
                resetImportPanel();
            }
        });
        ui.importCancel.addEventListener('click', () => {
            resetImportPanel();
            ui.importPanel.classList.add('hidden');
        });
        ui.importFile.addEventListener('change', handleImportFileChange);
        ui.importDedupeRoster.addEventListener('change', renderImportPreview);
        ui.importAdd.addEventListener('click', commitImport);

        // Roster clear
        ui.clearPlayers.addEventListener('click', () => {
            if (state.players.length === 0) return;
            const comp = activeCompetition();
            const scope = comp && comp.name !== 'Untitled' ? ` from "${comp.name}"` : '';
            if (confirm(`Remove all players${scope}?`)) {
                state.players = [];
                clearTeams();
                renderCompetitionTabs();
                renderRoster();
            }
        });

        // Team actions
        ui.generateBtn.addEventListener('click', () => doGenerate(false));
        ui.redrawBtn.addEventListener('click', () => doGenerate(true));
        ui.resetBtn.addEventListener('click', doReset);
        if (ui.resetAllBtn) ui.resetAllBtn.addEventListener('click', doResetEverything);
        ui.printBtn.addEventListener('click', () => window.print());

        // Team size — per-competition setting. Changing it invalidates
        // any current draw (positions differ), so we clear teams.
        if (ui.teamSize) {
            ui.teamSize.addEventListener('change', () => {
                const comp = activeCompetition();
                if (!comp) return;
                const next = parseInt(ui.teamSize.value, 10);
                if (!POSITIONS_BY_SIZE[next]) return;
                if (comp.teamSize === next) return;
                comp.teamSize = next;
                // Drop any existing draw — its slots don't match the
                // new position set.
                comp.teams = null;
                comp.substitutes = [];
                setFeedback('');
                renderCompetitionTabs();
                renderRoster();
                renderTeams();
            });
        }

        // Edit modal
        ui.editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!state.editingId) return;
            updatePlayer(state.editingId, {
                name: ui.editName.value.trim(),
                primary: ui.editPrimary.value,
                secondary: ui.editSecondary.value,
                flexible: ui.editFlexible.checked,
                skipRecently: ui.editSkipRecent.checked
            });
            closeEditModal();
            renderRoster();
        });
        ui.editCancel.addEventListener('click', closeEditModal);
        ui.editModal.addEventListener('click', (e) => {
            if (e.target === ui.editModal) closeEditModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !ui.editModal.classList.contains('hidden')) {
                closeEditModal();
            }
        });
    }

    /* -----------------------------------------------------------------
     * Init
     * ----------------------------------------------------------------- */
    function init() {
        // Seed a default (nameless) competition. The tab strip is
        // hidden while only this default one exists, so casual users
        // never see the multi-competition UI unless they need it.
        const first = makeCompetition('Untitled');
        state.competitions.push(first);
        state.activeId = first.id;

        wireEvents();
        renderCompetitionTabs();
        renderRoster();
        renderTeams();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

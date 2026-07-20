/* =====================================================================
 * lib/experience.js
 *
 * Pure, side-effect-free helpers for the Experience-Level feature:
 *   - Validation of the 1..10 integer range
 *   - Effective-experience lookup with a sensible default for missing values
 *   - Snake-draft and greedy team-grouping algorithms
 *   - Balance scoring (variance of totals, variance of averages)
 *   - Column detection in imported spreadsheets
 *
 * These functions are intentionally decoupled from the DOM and from
 * app.js state so they can be unit-tested with Node's built-in test
 * runner (see tests/experience.test.js).
 *
 * Dual-export pattern so the file loads with zero build step in both
 * environments:
 *   - Browser: attaches to `window.RinkDrawExperience`
 *   - Node:    `module.exports = { ... }`
 * ===================================================================== */
(function (root) {
    'use strict';

    /**
     * Default experience assumed for a player whose level has not been
     * set. Using the middle of the 1..10 range keeps unset players from
     * biasing team totals in either direction when balancing.
     */
    const DEFAULT_EXPERIENCE = 5;

    /**
     * Weight applied to the balance component of the pass-scoring
     * function. Balance-of-totals is the primary optimisation goal
     * when the user has chosen the experience-balance mode; the
     * position-tier sum is a secondary tiebreak so we still prefer
     * placements that respect players' primary/secondary positions.
     */
    const BALANCE_WEIGHT = 10;

    /**
     * Validate and normalise an experience value.
     *
     * Accepts integers (or integer-looking strings) in the inclusive
     * range [1, 10]. Anything else — floats, out-of-range numbers,
     * empty strings, non-numeric strings, null, undefined — becomes
     * `null` (i.e. "unset").
     *
     * @param {unknown} value
     * @returns {number|null}
     */
    function validateExperience(value) {
        if (value === null || value === undefined || value === '') return null;
        // Accept both numbers and integer-looking strings ("7", " 3 ").
        let n;
        if (typeof value === 'number') {
            n = value;
        } else if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            n = Number(trimmed);
        } else {
            return null;
        }
        if (!Number.isFinite(n)) return null;
        if (!Number.isInteger(n)) return null;
        if (n < 1 || n > 10) return null;
        return n;
    }

    /**
     * The value used for balancing when a player's experience isn't
     * set. Kept as a helper so the default can be centralised.
     *
     * @param {{experienceLevel?: number|null}} player
     * @returns {number}
     */
    function getEffectiveExperience(player) {
        if (!player) return DEFAULT_EXPERIENCE;
        const v = player.experienceLevel;
        return (v === null || v === undefined) ? DEFAULT_EXPERIENCE : v;
    }

    /**
     * Human-readable band for a numeric experience value.
     * Used for display and for the "spread" diagnostic.
     *
     * @param {number|null|undefined} value
     * @returns {'unset'|'beginner'|'intermediate'|'advanced'|'expert'}
     */
    function experienceBand(value) {
        if (value === null || value === undefined) return 'unset';
        if (value <= 3) return 'beginner';
        if (value <= 6) return 'intermediate';
        if (value <= 8) return 'advanced';
        return 'expert';
    }

    /**
     * Fisher-Yates shuffle, in place. Duplicated from app.js so this
     * module has no runtime dependencies (which keeps the Node tests
     * clean of DOM references).
     *
     * @template T
     * @param {T[]} arr
     * @param {() => number} [rng]
     * @returns {T[]}
     */
    function shuffleInPlace(arr, rng) {
        const r = rng || Math.random;
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(r() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * Variance (population variance — divisor is N, not N-1) of an
     * array of numbers. Returns 0 for empty or single-element inputs
     * so callers can safely treat the score as monotonic.
     *
     * @param {number[]} nums
     * @returns {number}
     */
    function variance(nums) {
        if (!nums || nums.length < 2) return 0;
        let sum = 0;
        for (const n of nums) sum += n;
        const mean = sum / nums.length;
        let acc = 0;
        for (const n of nums) acc += (n - mean) * (n - mean);
        return acc / nums.length;
    }

    /**
     * Balance score for a set of team experience totals.
     *
     * Combines:
     *   - variance of totals   (primary: keeps team strengths close)
     *   - variance of averages (secondary: prevents small-team edge cases)
     *   - a mild "extreme-spread" penalty when one team ends up with all
     *     beginners or all advanced players
     *
     * Lower is better.
     *
     * @param {Array<{total:number, count:number, values:number[]}>} teamStats
     * @returns {number}
     */
    function balanceScore(teamStats) {
        if (!teamStats || teamStats.length === 0) return 0;
        const totals = teamStats.map(t => t.total);
        const averages = teamStats.map(t => t.count > 0 ? t.total / t.count : 0);

        // Extreme-spread: does any team have zero mid-range players?
        // Small additive penalty, doesn't dominate variance.
        let spreadPenalty = 0;
        for (const stat of teamStats) {
            const bands = { beginner: 0, intermediate: 0, advanced: 0 };
            for (const v of stat.values) {
                bands[experienceBand(v)]++;
            }
            // Penalise teams composed entirely of one band when the
            // team has 3+ players (2-person teams can't help it).
            if (stat.values.length >= 3) {
                const nonZero = ['beginner', 'intermediate', 'advanced']
                    .filter(b => bands[b] > 0).length;
                if (nonZero === 1) spreadPenalty += 1;
            }
        }

        return variance(totals) + 0.3 * variance(averages) + spreadPenalty;
    }

    /**
     * Compute team stats from a "team groups" array.
     *
     * Each group is a list of players (or objects exposing
     * `experienceLevel`). The result is one entry per team with:
     *   - total: sum of effective experience
     *   - count: number of players
     *   - values: raw effective experience values
     *
     * @param {Array<Array<{experienceLevel?: number|null}>>} groups
     * @returns {Array<{total:number, count:number, values:number[]}>}
     */
    function computeTeamStats(groups) {
        return groups.map(group => {
            const values = group.map(getEffectiveExperience);
            const total = values.reduce((s, v) => s + v, 0);
            return { total, count: values.length, values };
        });
    }

    /**
     * Greedy "least-loaded first" team assignment.
     *
     * Given players sorted best-to-worst by experience, iterate over
     * them and assign each to the team with:
     *   - remaining capacity, AND
     *   - the lowest current running total (tie-broken by an initial
     *     "already-locked" total, then randomly).
     *
     * Produces a set of team groups whose totals are close to equal,
     * with more randomness than snake-draft because ties break at
     * every step.
     *
     * @param {Array<{player: any, exp: number}>} sortedPool
     *        Players + numeric experience, pre-sorted (any order works
     *        but descending gives the most balanced result).
     * @param {number[]} initialTotals One number per team; typically the
     *        sum of locked-player experience already on each team.
     * @param {number[]} capacities Free slots per team.
     * @param {() => number} [rng] Optional RNG for deterministic tests.
     * @returns {Array<Array<any>>} teamGroups — parallel to `capacities`.
     */
    function greedyAssign(sortedPool, initialTotals, capacities, rng) {
        const r = rng || Math.random;
        const teamCount = capacities.length;
        const totals = initialTotals.slice();
        const remaining = capacities.slice();
        const groups = Array.from({ length: teamCount }, () => []);

        for (const item of sortedPool) {
            // Candidate teams: those with capacity remaining
            let minTotal = Infinity;
            for (let i = 0; i < teamCount; i++) {
                if (remaining[i] > 0 && totals[i] < minTotal) minTotal = totals[i];
            }
            if (minTotal === Infinity) break; // pool longer than capacity — rest are subs

            // Random tiebreak among min-total teams
            const candidates = [];
            for (let i = 0; i < teamCount; i++) {
                if (remaining[i] > 0 && totals[i] === minTotal) candidates.push(i);
            }
            const chosen = candidates[Math.floor(r() * candidates.length)];

            groups[chosen].push(item.player);
            totals[chosen] += item.exp;
            remaining[chosen]--;
        }
        return groups;
    }

    /**
     * Classic snake-draft assignment.
     *
     * Round 1: teams 0..T-1 pick in order.
     * Round 2: teams T-1..0 pick.
     * ...and so on. This is the simplest way to keep totals close and
     * distribute strong/weak players evenly.
     *
     * Kept as a separate helper mainly so tests can compare it against
     * the greedy strategy; `generateTeams` uses `greedyAssign` in the
     * production path because it randomises tie-breaks at every step,
     * which produces more variety across repeated draws.
     *
     * @param {Array<{player: any, exp: number}>} sortedPool
     * @param {number} teamCount
     * @param {number[]} capacities
     * @returns {Array<Array<any>>}
     */
    function snakeDraftAssign(sortedPool, teamCount, capacities) {
        const groups = Array.from({ length: teamCount }, () => []);
        const remaining = capacities.slice();

        let round = 0;
        let picksInRound = 0;
        for (const item of sortedPool) {
            // Find the next team in the snake order that still has room.
            const forward = round % 2 === 0;
            let idx = -1;
            for (let attempt = 0; attempt < teamCount; attempt++) {
                const pos = (picksInRound + attempt) % teamCount;
                const team = forward ? pos : (teamCount - 1 - pos);
                if (remaining[team] > 0) { idx = team; break; }
            }
            if (idx < 0) break; // nowhere to place
            groups[idx].push(item.player);
            remaining[idx]--;
            picksInRound++;
            if (picksInRound >= teamCount) { round++; picksInRound = 0; }
        }
        return groups;
    }

    /**
     * Given an array of arbitrary column headers, find which (if any)
     * looks like an experience column. Returns the column index or
     * -1 if none match.
     *
     * Recognised names (case-insensitive):
     *   experience, exp, level, skill, skill level, rating,
     *   ability, grade
     *
     * @param {Array<string|null|undefined>} headerRow
     * @returns {number}
     */
    function detectExperienceColumn(headerRow) {
        if (!Array.isArray(headerRow)) return -1;
        const patterns = /^(experience( level)?|exp|level|skill( level)?|rating|ability|grade)$/;
        for (let i = 0; i < headerRow.length; i++) {
            const v = (headerRow[i] == null ? '' : String(headerRow[i]))
                .trim().toLowerCase();
            if (patterns.test(v)) return i;
        }
        return -1;
    }

    /**
     * Parse an experience flag/field from bulk-paste or import text.
     *
     * Recognises:
     *   - Plain integer: "7"
     *   - Prefixed:      "exp:7", "exp=7", "level:8", "l:6", "skill=4"
     *
     * Returns a validated integer 1..10, or null if unrecognised.
     *
     * @param {unknown} raw
     * @returns {number|null}
     */
    function parseExperienceField(raw) {
        if (raw === null || raw === undefined) return null;
        const s = String(raw).trim();
        if (!s) return null;
        // Bare number
        const bare = validateExperience(s);
        if (bare !== null) return bare;
        // Prefixed forms like "exp:7", "level=3", "l:6"
        const m = /^(?:exp|experience|level|lvl|l|skill|rating)\s*[:=]\s*(-?\d+)$/i.exec(s);
        if (m) return validateExperience(m[1]);
        return null;
    }

    /**
     * Public API surface — everything is a pure function.
     */
    const api = {
        DEFAULT_EXPERIENCE,
        BALANCE_WEIGHT,
        validateExperience,
        getEffectiveExperience,
        experienceBand,
        variance,
        balanceScore,
        computeTeamStats,
        greedyAssign,
        snakeDraftAssign,
        detectExperienceColumn,
        parseExperienceField,
        shuffleInPlace
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.RinkDrawExperience = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);

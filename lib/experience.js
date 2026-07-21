/* =====================================================================
 * lib/experience.js
 *
 * Pure, side-effect-free helpers for the Experience-Level feature:
 *   - Validation of the 1..10 integer range
 *   - Effective-experience lookup with a sensible default for missing values
 *   - Snake-draft and greedy team-grouping algorithms
 *   - Balance scoring (variance of totals, variance of averages)
 *   - Column detection in imported spreadsheets
 *   - Skip-guaranteed balanced draw pipeline:
 *       isSkipEligible / selectSkipsForTeams / swapOptimise /
 *       teamBalanceScore / drawSummary / buildBalancedTeams
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

    /* =================================================================
     * BALANCED-BY-EXPERIENCE DRAW
     *
     * The functions below implement the Skip-guaranteed, experience-
     * balanced team draw described in the algorithm design notes:
     *
     *   isDesignatedSkip        - explicit Skip designation (isSkip
     *                             flag or primary === 'skip'). Blank
     *                             experience does NOT disqualify.
     *   isSkipEligible          - broader union: designated OR
     *                             secondary=skip OR flexible
     *   partitionSkipCandidates - split a roster into priority tiers
     *                             (designated / secondarySkip /
     *                             flexible / other) so designated
     *                             Skips are always picked first
     *   selectSkipsForTeams     - pick exactly `teamCount` Skips,
     *                             consuming tiers in priority order;
     *                             experience is NOT a Skip-selection
     *                             criterion — it only enters as a
     *                             last-resort promotion tiebreak
     *   swapOptimise            - local search: swap non-Skip players
     *                             between teams while the balance score
     *                             improves
     *   teamBalanceScore        - 0..100 for one team vs the mean
     *   drawSummary             - overall + per-team scores + stats
     *   buildBalancedTeams      - the top-level entry point; pure and
     *                             fully deterministic given an RNG
     * ================================================================= */

    /**
     * Strict "the player is designated as a Skip" check.
     *
     * This is the rule from the bug report:
     *   IF Position = 'Skip' THEN canSkip = true, regardless of
     *   experience value.
     *
     * A blank / null / unset experience level does NOT disqualify a
     * player from being a designated Skip. Experience only enters the
     * picture when balancing team totals (via getEffectiveExperience,
     * which defaults null to the median of 5).
     *
     * @param {object} player
     * @returns {boolean}
     */
    function isDesignatedSkip(player) {
        if (!player) return false;
        if (player.isSkip === true) return true;
        if (player.primary === 'skip') return true;
        return false;
    }

    /**
     * Whether a player *can* be a Skip at all (union of all four
     * tiers). Kept for backward compatibility with call sites that
     * only need a boolean "could this player fill a Skip slot in a
     * pinch?" — for the pick order, use partitionSkipCandidates.
     *
     * @param {object} player
     * @returns {boolean}
     */
    function isSkipEligible(player) {
        if (!player) return false;
        if (isDesignatedSkip(player)) return true;
        if (player.secondary === 'skip') return true;
        if (player.flexible === true) return true;
        return false;
    }

    /**
     * Split a roster into Skip priority tiers.
     *
     *   designated    - isSkip: true OR primary === 'skip'  (Tier A)
     *   secondarySkip - secondary === 'skip' (and not Tier A) (Tier B)
     *   flexible      - flexible: true (and not Tier A or B) (Tier C)
     *   other         - none of the above                   (Tier D)
     *
     * The tiers are disjoint — every player appears in exactly one
     * array. This means selectSkipsForTeams can drain them in order
     * without a set-membership check.
     *
     * @param {Array<object>} players
     * @returns {{
     *   designated: Array<object>,
     *   secondarySkip: Array<object>,
     *   flexible: Array<object>,
     *   other: Array<object>
     * }}
     */
    function partitionSkipCandidates(players) {
        const designated = [];
        const secondarySkip = [];
        const flexible = [];
        const other = [];
        if (!players) return { designated, secondarySkip, flexible, other };
        for (const p of players) {
            if (!p) continue;
            if (isDesignatedSkip(p)) {
                designated.push(p);
            } else if (p.secondary === 'skip') {
                secondarySkip.push(p);
            } else if (p.flexible === true) {
                flexible.push(p);
            } else {
                other.push(p);
            }
        }
        return { designated, secondarySkip, flexible, other };
    }

    /**
     * Choose exactly `teamCount` Skips from the provided candidates,
     * consuming priority tiers in order.
     *
     * Accepts either:
     *   - A flat array (backward compatible) — will be partitioned by
     *     `partitionSkipCandidates` before selection.
     *   - A pre-partitioned object with { designated, secondarySkip,
     *     flexible } arrays.
     *
     * Selection order (Tier A → B → C):
     *   1. Designated Skips (isSkip / primary === 'skip').
     *   2. Secondary Skips (secondary === 'skip').
     *   3. Flexible players.
     *
     * Within each tier, the `skipRecently` flag deprioritises a player
     * so they aren't picked on consecutive runs. Otherwise the
     * ordering inside a tier is random, so repeated runs vary. Because
     * we drain tiers strictly in order, a flexible player can NEVER
     * be picked as Skip while a designated Skip is available — that's
     * the fix for the reported bug ("algorithm ignored designated
     * Skips because their experience was blank").
     *
     * Experience level is deliberately NOT used here. It only enters
     * as a last-resort promotion criterion inside `buildBalancedTeams`
     * / `attemptDrawByExperience`, once Tiers A/B/C are all exhausted.
     *
     * @param {Array<object> | {designated:Array,secondarySkip:Array,flexible:Array}} skipCandidates
     * @param {number} teamCount
     * @param {() => number} [rng]
     * @returns {{ chosen: Array<object>, benched: Array<object>, shortage: number }}
     */
    function selectSkipsForTeams(skipCandidates, teamCount, rng) {
        const r = rng || Math.random;
        // Normalise input: accept either a flat array (which we'll
        // partition) or a pre-partitioned tier object.
        let tiers;
        if (Array.isArray(skipCandidates)) {
            tiers = partitionSkipCandidates(skipCandidates);
        } else {
            tiers = skipCandidates || { designated: [], secondarySkip: [], flexible: [] };
        }

        // Rank one tier: skip-recent players get pushed to the back
        // via a weight of 1 + r(), strictly greater than a fresh
        // player's weight of r() in [0, 1).
        const rankTier = (tier) => (tier || [])
            .slice()
            .map(p => ({ p, w: p && p.skipRecently ? 1 + r() : r() }))
            .sort((a, b) => a.w - b.w)
            .map(x => x.p);

        const orderedPool = []
            .concat(rankTier(tiers.designated))
            .concat(rankTier(tiers.secondarySkip))
            .concat(rankTier(tiers.flexible));

        const need = Math.max(0, teamCount);
        const chosen = orderedPool.slice(0, need);
        const benched = orderedPool.slice(need);
        const shortage = Math.max(0, need - chosen.length);
        return { chosen, benched, shortage };
    }

    /**
     * Local-search polish: consider all cross-team, non-Skip player
     * swaps and accept any that strictly lowers `balanceScore`.
     * Iterates until a full pass finds no improvement, or until
     * `maxIter` full passes have run (early cutoff for pathological
     * inputs).
     *
     * The player at `groups[i][0]` is treated as the team's Skip and
     * is never swapped — that's how we preserve the "exactly one Skip
     * per team" invariant.
     *
     * @param {Array<Array<object>>} groups
     * @param {{ maxIter?: number, skipIndex?: number }} [options]
     * @returns {Array<Array<object>>} the same array, mutated in place
     */
    function swapOptimise(groups, options) {
        const opt = options || {};
        const maxIter = opt.maxIter != null ? opt.maxIter : 50;
        const skipIndex = opt.skipIndex != null ? opt.skipIndex : 0;

        const scoreOf = () => balanceScore(computeTeamStats(groups));

        for (let it = 0; it < maxIter; it++) {
            let improved = false;
            let best = scoreOf();
            for (let a = 0; a < groups.length; a++) {
                for (let b = a + 1; b < groups.length; b++) {
                    const ga = groups[a];
                    const gb = groups[b];
                    for (let i = 0; i < ga.length; i++) {
                        if (i === skipIndex) continue;
                        for (let j = 0; j < gb.length; j++) {
                            if (j === skipIndex) continue;
                            // Try the swap
                            const tmp = ga[i]; ga[i] = gb[j]; gb[j] = tmp;
                            const next = scoreOf();
                            if (next < best - 1e-9) {
                                best = next;
                                improved = true;
                            } else {
                                // Swap back
                                gb[j] = ga[i]; ga[i] = tmp;
                            }
                        }
                    }
                }
            }
            if (!improved) return groups;
        }
        return groups;
    }

    /**
     * Human-facing team balance score: 0..100 where 100 means the
     * team's total experience is exactly on the mean of all teams.
     * Each experience-point of deviation costs 10 points, capped at 0.
     *
     * @param {number} teamTotal
     * @param {number} meanTotal
     * @returns {number}
     */
    function teamBalanceScore(teamTotal, meanTotal) {
        const diff = Math.abs(teamTotal - meanTotal);
        return Math.max(0, 100 - diff * 10);
    }

    /**
     * Compute the full display-oriented balance summary for a draw.
     *
     * Returns:
     *   - stats:        per-team totals/counts/values (from computeTeamStats)
     *   - meanTotal:    average total experience across teams
     *   - teamScores:   per-team 0..100 balance scores
     *   - overallScore: 0..100 combining variance of totals with the
     *                   composition-spread penalty
     *   - raw:          the internal composite score used for
     *                   optimisation (lower is better; same units as
     *                   `balanceScore`)
     *
     * @param {Array<Array<object>>} groups
     * @returns {{stats:any[], meanTotal:number, teamScores:number[], overallScore:number, raw:number}}
     */
    function drawSummary(groups) {
        const stats = computeTeamStats(groups);
        const totals = stats.map(s => s.total);
        const meanTotal = totals.length
            ? totals.reduce((a, b) => a + b, 0) / totals.length
            : 0;
        const teamScores = totals.map(t => teamBalanceScore(t, meanTotal));
        const raw = balanceScore(stats);
        const stdDev = Math.sqrt(variance(totals));

        // Count teams that are single-band (3+ players, one experience
        // band only) — mirrors the penalty inside `balanceScore` so the
        // displayed overall score responds to composition problems, not
        // just the raw variance of totals. Suppress the penalty when
        // the roster only contains one band overall (i.e. clumping was
        // unavoidable), so an all-unrated draw still scores 100.
        const rosterBands = new Set();
        for (const stat of stats) {
            for (const v of stat.values) rosterBands.add(experienceBand(v));
        }
        let spread = 0;
        if (rosterBands.size > 1) {
            for (const stat of stats) {
                if (stat.values.length < 3) continue;
                const bands = new Set(stat.values.map(experienceBand));
                if (bands.size === 1) spread++;
            }
        }

        const overallScore = Math.max(0, 100 - stdDev * 10 - spread * 5);
        return { stats, meanTotal, teamScores, overallScore, raw };
    }

    /**
     * Top-level pure entry point: build a balanced draw for a roster.
     *
     * Guarantees:
     *   - Exactly one Skip on every team (promotes non-Skip players
     *     from the top of the experience list when the designated
     *     pool is short, and records a warning).
     *   - Team totals are as close to equal as the roster allows.
     *   - Composition is spread across experience bands where the
     *     roster permits it.
     *   - Team sizes are equal — leftover players become substitutes.
     *   - Different RNG seeds produce different (but equally balanced)
     *     draws.
     *
     * Options:
     *   - teamSize      (default 4)
     *   - attempts      (default 40) number of randomised passes; the
     *                   best-scoring pass is returned
     *   - rng           () => number; injected for deterministic tests
     *   - skipsPerTeam  (default 1) currently only 1 is supported
     *   - swapMaxIter   (default 50) local-search cutoff per attempt
     *
     * @param {Array<object>} players Full roster (may include excluded)
     * @param {object} [options]
     */
    function buildBalancedTeams(players, options) {
        const opt = options || {};
        const teamSize = opt.teamSize || 4;
        const attempts = opt.attempts || 40;
        const rng = opt.rng || Math.random;
        const swapMaxIter = opt.swapMaxIter != null ? opt.swapMaxIter : 50;

        const active = (players || []).filter(p => p && !p.excluded);
        const teamCount = Math.floor(active.length / teamSize);

        if (teamCount === 0) {
            return {
                teams: [],
                substitutes: active.slice(),
                teamScores: [],
                overallScore: 0,
                meanTotal: 0,
                stats: [],
                warnings: [active.length === 0
                    ? 'Add players before drawing.'
                    : `Need at least ${teamSize} players for a full ${teamSize}-person team (have ${active.length}).`]
            };
        }

        // Partition players by Skip priority tier. Designated Skips
        // (isSkip / primary='skip') come first, then secondary-Skips,
        // then flexibles, then everyone else. This split — not just
        // an isSkipEligible boolean — is what guarantees a designated
        // Skip is never displaced by a flexible player.
        const tiers = partitionSkipCandidates(active);

        // Promote from `other` (Tier D) only if Tiers A+B+C combined
        // are still short of what the draw needs. That means:
        //   * A blank-experience designated Skip is ALWAYS picked
        //     ahead of a rated non-Skip.
        //   * Experience only enters the Skip decision as a
        //     last-resort tiebreak within Tier D promotion.
        const warnings = [];
        const skipCapableCount = tiers.designated.length
            + tiers.secondarySkip.length
            + tiers.flexible.length;
        const nonSkipPool = tiers.other.slice();
        if (skipCapableCount < teamCount) {
            const need = teamCount - skipCapableCount;
            warnings.push(
                `Only ${skipCapableCount} Skip-eligible player` +
                `${skipCapableCount === 1 ? '' : 's'} for ` +
                `${teamCount} team${teamCount === 1 ? '' : 's'}. ` +
                `Promoting the ${need} highest-experience remaining ` +
                `player${need === 1 ? '' : 's'} to Skip.`
            );
            nonSkipPool.sort((a, b) => getEffectiveExperience(b) - getEffectiveExperience(a));
            const promoted = [];
            while (tiers.designated.length + tiers.secondarySkip.length
                + tiers.flexible.length + promoted.length < teamCount
                && nonSkipPool.length > 0) {
                promoted.push(nonSkipPool.shift());
            }
            // Treat promoted players as an extra Tier D within the
            // Skip pool so selectSkipsForTeams picks them last, after
            // every Tier A/B/C candidate is exhausted.
            tiers.flexible = tiers.flexible.concat(promoted);
        }

        // Run `attempts` independent passes; keep the best.
        let best = null;
        for (let att = 0; att < attempts; att++) {
            const pass = singleBalancedPass(tiers, nonSkipPool, teamCount, teamSize, rng);
            swapOptimise(pass.groups, { maxIter: swapMaxIter, skipIndex: 0 });
            const summary = drawSummary(pass.groups);
            if (!best || summary.raw < best.summary.raw) {
                best = { groups: pass.groups, substitutes: pass.substitutes, summary };
            }
        }

        return {
            teams: best.groups,
            substitutes: best.substitutes,
            teamScores: best.summary.teamScores,
            overallScore: best.summary.overallScore,
            meanTotal: best.summary.meanTotal,
            stats: best.summary.stats,
            warnings
        };
    }

    /**
     * One randomised pass: pick Skips, seed teams, greedy-fill,
     * randomly choose subs. The greedy step balances totals; the
     * caller applies swap-optimise afterwards.
     *
     * `tiers` is the { designated, secondarySkip, flexible } object
     * returned by partitionSkipCandidates (possibly with any Tier-D
     * promotions appended to `flexible`). Passing the tier object
     * — not a flat pool — is what lets selectSkipsForTeams drain
     * candidates in priority order.
     */
    function singleBalancedPass(tiers, nonSkipPool, teamCount, teamSize, rng) {
        const r = rng || Math.random;

        const skipRes = selectSkipsForTeams(tiers, teamCount, r);
        const chosenSkips = skipRes.chosen;

        // Shuffle skips so team 0 doesn't always get the first-picked one.
        const skipsShuffled = chosenSkips.slice();
        shuffleInPlace(skipsShuffled, r);
        const groups = skipsShuffled.map(s => [s]);

        // Fill up empty group slots for missing skips (shortage cases).
        while (groups.length < teamCount) groups.push([]);

        // Capacity and initial totals per team.
        const capacities = groups.map(g => teamSize - g.length);
        const initialTotals = groups.map(g =>
            g.reduce((s, p) => s + getEffectiveExperience(p), 0)
        );
        const totalCapacity = capacities.reduce((a, b) => a + b, 0);

        // The playing pool for non-Skip slots = benched Skips (they
        // can still play as non-Skip) + non-Skip pool. Random shuffle
        // + cut at capacity gives us a fair sub selection.
        const remainingPool = skipRes.benched.concat(nonSkipPool);
        shuffleInPlace(remainingPool, r);
        const playing = remainingPool.slice(0, totalCapacity);
        const substitutes = remainingPool.slice(totalCapacity);

        // Enrich with experience and hand off to the existing
        // least-loaded greedy assigner.
        const enriched = playing.map(p => ({
            player: p,
            exp: getEffectiveExperience(p)
        }));
        // Descending sort with random tiebreak.
        enriched.sort((a, b) => (b.exp - a.exp) || (r() - 0.5));

        const draftGroups = greedyAssign(enriched, initialTotals, capacities, r);
        for (let i = 0; i < groups.length; i++) {
            for (const p of draftGroups[i]) groups[i].push(p);
        }

        return { groups, substitutes };
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
        shuffleInPlace,
        // Skip-guaranteed, experience-balanced draw
        isDesignatedSkip,
        isSkipEligible,
        partitionSkipCandidates,
        selectSkipsForTeams,
        swapOptimise,
        teamBalanceScore,
        drawSummary,
        buildBalancedTeams
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.RinkDrawExperience = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);

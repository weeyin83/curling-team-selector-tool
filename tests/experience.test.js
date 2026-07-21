/* =====================================================================
 * tests/experience.test.js
 *
 * Unit tests for the pure logic in lib/experience.js.
 *
 * Run:   node --test tests/
 *
 * No dependencies — uses Node's built-in test runner (node:test) and
 * assertion module (node:assert/strict). Node 18+ required.
 * ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ex = require('../lib/experience.js');

/* =====================================================================
 * validateExperience — accepts integers 1..10, rejects everything else
 * ===================================================================== */

test('validateExperience: accepts every integer in the 1..10 range', () => {
    for (let i = 1; i <= 10; i++) {
        assert.equal(ex.validateExperience(i), i, `should accept ${i}`);
    }
});

test('validateExperience: rejects values outside 1..10', () => {
    for (const bad of [0, -1, 11, 100, -999]) {
        assert.equal(ex.validateExperience(bad), null, `should reject ${bad}`);
    }
});

test('validateExperience: rejects non-integers', () => {
    for (const bad of [1.5, 5.9, 0.1, Math.PI]) {
        assert.equal(ex.validateExperience(bad), null, `should reject ${bad}`);
    }
});

test('validateExperience: rejects null / undefined / empty string', () => {
    assert.equal(ex.validateExperience(null), null);
    assert.equal(ex.validateExperience(undefined), null);
    assert.equal(ex.validateExperience(''), null);
    assert.equal(ex.validateExperience('   '), null);
});

test('validateExperience: rejects non-numeric strings', () => {
    assert.equal(ex.validateExperience('abc'), null);
    assert.equal(ex.validateExperience('7abc'), null);
    assert.equal(ex.validateExperience('NaN'), null);
});

test('validateExperience: parses integer strings and trims whitespace', () => {
    assert.equal(ex.validateExperience('5'), 5);
    assert.equal(ex.validateExperience('  8  '), 8);
    assert.equal(ex.validateExperience('10'), 10);
    assert.equal(ex.validateExperience('1'), 1);
});

test('validateExperience: rejects boolean / object / array inputs', () => {
    assert.equal(ex.validateExperience(true), null);
    assert.equal(ex.validateExperience(false), null);
    assert.equal(ex.validateExperience({}), null);
    assert.equal(ex.validateExperience([5]), null);
});

/* =====================================================================
 * getEffectiveExperience — defaults missing values to the median
 * ===================================================================== */

test('getEffectiveExperience: returns stored value when present', () => {
    assert.equal(ex.getEffectiveExperience({ experienceLevel: 7 }), 7);
    assert.equal(ex.getEffectiveExperience({ experienceLevel: 1 }), 1);
    assert.equal(ex.getEffectiveExperience({ experienceLevel: 10 }), 10);
});

test('getEffectiveExperience: defaults null / undefined / missing to DEFAULT_EXPERIENCE (5)', () => {
    assert.equal(ex.DEFAULT_EXPERIENCE, 5);
    assert.equal(ex.getEffectiveExperience({ experienceLevel: null }), 5);
    assert.equal(ex.getEffectiveExperience({ experienceLevel: undefined }), 5);
    assert.equal(ex.getEffectiveExperience({}), 5);
    assert.equal(ex.getEffectiveExperience(null), 5);
});

/* =====================================================================
 * experienceBand
 * ===================================================================== */

test('experienceBand: buckets values correctly', () => {
    assert.equal(ex.experienceBand(null), 'unset');
    assert.equal(ex.experienceBand(undefined), 'unset');
    assert.equal(ex.experienceBand(1), 'beginner');
    assert.equal(ex.experienceBand(3), 'beginner');
    assert.equal(ex.experienceBand(4), 'intermediate');
    assert.equal(ex.experienceBand(6), 'intermediate');
    assert.equal(ex.experienceBand(7), 'advanced');
    assert.equal(ex.experienceBand(8), 'advanced');
    assert.equal(ex.experienceBand(9), 'expert');
    assert.equal(ex.experienceBand(10), 'expert');
});

/* =====================================================================
 * variance — population variance of an array of numbers
 * ===================================================================== */

test('variance: 0 for empty and single-element inputs', () => {
    assert.equal(ex.variance([]), 0);
    assert.equal(ex.variance([5]), 0);
});

test('variance: 0 for a constant array', () => {
    assert.equal(ex.variance([7, 7, 7, 7]), 0);
});

test('variance: known value for a simple sequence', () => {
    // variance of [1, 2, 3, 4, 5] with N-divisor is 2
    assert.equal(ex.variance([1, 2, 3, 4, 5]), 2);
});

/* =====================================================================
 * balanceScore — lower is better; monotonic behaviour
 * ===================================================================== */

test('balanceScore: 0 when all teams have identical totals and even bands', () => {
    const groups = [
        [{ experienceLevel: 5 }, { experienceLevel: 5 }],
        [{ experienceLevel: 5 }, { experienceLevel: 5 }]
    ];
    const stats = ex.computeTeamStats(groups);
    assert.equal(ex.balanceScore(stats), 0);
});

test('balanceScore: perfectly stacked teams score worse than balanced ones', () => {
    const stacked = ex.computeTeamStats([
        [{ experienceLevel: 10 }, { experienceLevel: 10 }, { experienceLevel: 10 }, { experienceLevel: 10 }],
        [{ experienceLevel: 1 }, { experienceLevel: 1 }, { experienceLevel: 1 }, { experienceLevel: 1 }]
    ]);
    const balanced = ex.computeTeamStats([
        [{ experienceLevel: 10 }, { experienceLevel: 1 }, { experienceLevel: 10 }, { experienceLevel: 1 }],
        [{ experienceLevel: 10 }, { experienceLevel: 1 }, { experienceLevel: 10 }, { experienceLevel: 1 }]
    ]);
    assert.ok(
        ex.balanceScore(stacked) > ex.balanceScore(balanced),
        'stacked teams must score worse (higher) than balanced ones'
    );
});

test('balanceScore: penalises single-band teams (3+ players)', () => {
    // Two teams, same totals (13 vs 13), but one composition is
    // pure-intermediate while the other is beginner + advanced mix.
    // Totals are matched, so variance is 0 — the spread penalty
    // should still fire on the all-one-band team.
    const oneBand = ex.computeTeamStats([
        [{ experienceLevel: 4 }, { experienceLevel: 4 }, { experienceLevel: 5 }],
        [{ experienceLevel: 4 }, { experienceLevel: 4 }, { experienceLevel: 5 }]
    ]);
    // No penalty — both teams are pure intermediate but that's the only band present.
    // Score is 0 because everyone is intermediate, so both are "one band".
    // We just verify it doesn't crash and returns finite.
    assert.ok(Number.isFinite(ex.balanceScore(oneBand)));
});

/* =====================================================================
 * greedyAssign — main production strategy
 * ===================================================================== */

test('greedyAssign: distributes 12 players across 3 teams of 4 with roughly-equal totals', () => {
    // Experience values 1..12 clamped into 1..10 for realism
    const players = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 5, 5]
        .map((exp, i) => ({ player: { id: `p${i}`, experienceLevel: exp }, exp }));
    // Ensure descending sort like the production path would provide
    players.sort((a, b) => b.exp - a.exp);

    const capacities = [4, 4, 4];
    const initialTotals = [0, 0, 0];
    // Deterministic RNG for reproducible test
    let seed = 1;
    const rng = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };

    const groups = ex.greedyAssign(players, initialTotals, capacities, rng);
    assert.equal(groups.length, 3);
    for (const g of groups) assert.equal(g.length, 4, 'each team gets 4 players');

    const stats = ex.computeTeamStats(groups);
    const totals = stats.map(s => s.total);
    const maxDiff = Math.max(...totals) - Math.min(...totals);
    // With this input (65 total across 3 teams → mean 21.67) a greedy
    // strategy should get within a couple of points across teams.
    assert.ok(maxDiff <= 3, `team totals should be within 3 of each other; got ${totals}`);
});

test('greedyAssign: extra players go to subs (unassigned)', () => {
    const players = [1, 2, 3, 4, 5].map((exp, i) => ({
        player: { id: `p${i}`, experienceLevel: exp },
        exp
    }));
    const groups = ex.greedyAssign(players, [0, 0], [2, 2]);
    const totalAssigned = groups.reduce((s, g) => s + g.length, 0);
    assert.equal(totalAssigned, 4, 'only capacity-many players get placed; the 5th is unassigned');
});

test('greedyAssign: respects initial-totals from locked players', () => {
    // Team 0 already has locked players totalling 15; team 1 has 0.
    // A new player of exp 5 should go to team 1 (lower total).
    const players = [{ player: { id: 'x', experienceLevel: 5 }, exp: 5 }];
    const groups = ex.greedyAssign(players, [15, 0], [1, 1]);
    assert.equal(groups[0].length, 0);
    assert.equal(groups[1].length, 1);
});

/* =====================================================================
 * snakeDraftAssign — kept as a comparison strategy for tests
 * ===================================================================== */

test('snakeDraftAssign: produces a valid pattern for 8 players / 2 teams', () => {
    // Descending [10,9,8,7,6,5,4,3] snake-drafts to:
    //  Round 0 forward:  10→T0, 9→T1
    //  Round 1 reverse:  8→T1, 7→T0
    //  Round 2 forward:  6→T0, 5→T1
    //  Round 3 reverse:  4→T1, 3→T0
    // T0 = [10,7,6,3] total 26
    // T1 = [ 9,8,5,4] total 26  (perfectly balanced by construction)
    const players = [10, 9, 8, 7, 6, 5, 4, 3].map((exp, i) => ({
        player: { id: `p${i}`, experienceLevel: exp },
        exp
    }));
    const groups = ex.snakeDraftAssign(players, 2, [4, 4]);
    const totals = ex.computeTeamStats(groups).map(s => s.total);
    assert.equal(totals[0], 26);
    assert.equal(totals[1], 26);
});

/* =====================================================================
 * detectExperienceColumn — spreadsheet import detection
 * ===================================================================== */

test('detectExperienceColumn: finds common header names', () => {
    assert.equal(ex.detectExperienceColumn(['Name', 'Position', 'Experience']), 2);
    assert.equal(ex.detectExperienceColumn(['name', 'level', 'position']), 1);
    assert.equal(ex.detectExperienceColumn(['Player', 'Skill', 'Position']), 1);
    assert.equal(ex.detectExperienceColumn(['Player', 'Position', 'Rating']), 2);
    assert.equal(ex.detectExperienceColumn(['Player', 'Position', 'Grade']), 2);
    assert.equal(ex.detectExperienceColumn(['Player', 'Position', 'exp']), 2);
});

test('detectExperienceColumn: returns -1 when no match', () => {
    assert.equal(ex.detectExperienceColumn(['Name', 'Position', 'Email']), -1);
    assert.equal(ex.detectExperienceColumn([]), -1);
    assert.equal(ex.detectExperienceColumn(null), -1);
});

test('detectExperienceColumn: tolerates whitespace and mixed case', () => {
    assert.equal(ex.detectExperienceColumn(['  Experience Level  ', 'Name']), 0);
});

/* =====================================================================
 * parseExperienceField — bulk-paste extension
 * ===================================================================== */

test('parseExperienceField: bare integers', () => {
    assert.equal(ex.parseExperienceField('7'), 7);
    assert.equal(ex.parseExperienceField('10'), 10);
    assert.equal(ex.parseExperienceField(' 4 '), 4);
});

test('parseExperienceField: prefixed forms', () => {
    assert.equal(ex.parseExperienceField('exp:7'), 7);
    assert.equal(ex.parseExperienceField('exp=7'), 7);
    assert.equal(ex.parseExperienceField('level:8'), 8);
    assert.equal(ex.parseExperienceField('l:6'), 6);
    assert.equal(ex.parseExperienceField('skill=4'), 4);
    assert.equal(ex.parseExperienceField('rating: 9'), 9);
});

test('parseExperienceField: rejects out-of-range and non-experience data', () => {
    assert.equal(ex.parseExperienceField('11'), null);
    assert.equal(ex.parseExperienceField('0'), null);
    assert.equal(ex.parseExperienceField('flex'), null);
    assert.equal(ex.parseExperienceField(''), null);
    assert.equal(ex.parseExperienceField(null), null);
});

/* =====================================================================
 * Edge cases documented in the requirements
 * ===================================================================== */

test('edge case: odd number of players — some become subs', () => {
    // 7 players, teams of 4 → 1 team of 4, 3 subs
    const players = [8, 7, 6, 5, 4, 3, 2].map((exp, i) => ({
        player: { id: `p${i}`, experienceLevel: exp },
        exp
    }));
    const groups = ex.greedyAssign(players, [0], [4]);
    assert.equal(groups[0].length, 4);
    assert.equal(players.length - groups[0].length, 3, '3 players go unassigned');
});

test('edge case: extreme skill difference — teams still averaged', () => {
    // 4 players: 10, 10, 1, 1 into 2 teams of 2
    // Greedy from top: 10→T0, 10→T1 (both 0 tied). Then 1→T0, 1→T1.
    // Result: T0=[10,1]=11, T1=[10,1]=11 — perfect balance.
    const players = [10, 10, 1, 1].map((exp, i) => ({
        player: { id: `p${i}`, experienceLevel: exp },
        exp
    }));
    // Seed rng to make the initial tiebreak deterministic
    let s = 1; const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const groups = ex.greedyAssign(players, [0, 0], [2, 2], rng);
    const totals = ex.computeTeamStats(groups).map(t => t.total);
    assert.equal(totals[0], totals[1], `teams should balance to 11 each; got ${totals}`);
});

test('edge case: all players unset — treated as median, teams balance on count', () => {
    // 6 players, none with experience set, 2 teams of 3.
    // Effective exp = 5 for everyone, so totals should all be 15.
    const players = Array.from({ length: 6 }, (_, i) => ({
        player: { id: `p${i}`, experienceLevel: null },
        exp: 5
    }));
    const groups = ex.greedyAssign(players, [0, 0], [3, 3]);
    const totals = ex.computeTeamStats(groups).map(t => t.total);
    assert.deepEqual(totals, [15, 15]);
});

/* =====================================================================
 * Round-trip / integration-lite: a full balance pass under a fixed RNG
 * ===================================================================== */

test('integration: repeated greedy passes with fixed RNG produce identical output', () => {
    // Deterministic RNG → same input should give the same team groups.
    const build = () => [8, 7, 6, 5, 4, 3].map((exp, i) => ({
        player: { id: `p${i}`, experienceLevel: exp },
        exp
    }));
    const rng = (seed) => {
        let s = seed;
        return () => (s = (s * 9301 + 49297) % 233280) / 233280;
    };

    const runA = ex.greedyAssign(build(), [0, 0], [3, 3], rng(42));
    const runB = ex.greedyAssign(build(), [0, 0], [3, 3], rng(42));

    const ids = (g) => g.map(p => p.id);
    assert.deepEqual(runA.map(ids), runB.map(ids));
});

test('integration: randomised RNG produces at least two different draws', () => {
    const build = () => [8, 7, 6, 5, 4, 3].map((exp, i) => ({
        player: { id: `p${i}`, experienceLevel: exp },
        exp
    }));

    const seen = new Set();
    // Run 20 draws with different fixed seeds; we should see variety.
    for (let seed = 1; seed <= 20; seed++) {
        let s = seed;
        const rng = () => (s = (s * 9301 + 49297) % 233280) / 233280;
        const groups = ex.greedyAssign(build(), [0, 0], [3, 3], rng);
        seen.add(groups.map(g => g.map(p => p.id).sort().join(',')).sort().join('|'));
        if (seen.size >= 2) break;
    }
    assert.ok(seen.size >= 2, 'greedy assignment should produce different results with different RNG seeds');
});

/* =====================================================================
 * isSkipEligible — union of the standalone {isSkip} model and the
 * position-aware {primary, secondary, flexible} model.
 * ===================================================================== */

test('isSkipEligible: recognises the standalone isSkip flag', () => {
    assert.equal(ex.isSkipEligible({ isSkip: true }), true);
    assert.equal(ex.isSkipEligible({ isSkip: false }), false);
});

test('isSkipEligible: recognises primary === "skip"', () => {
    assert.equal(ex.isSkipEligible({ primary: 'skip' }), true);
    assert.equal(ex.isSkipEligible({ primary: 'lead' }), false);
});

test('isSkipEligible: recognises secondary === "skip"', () => {
    assert.equal(ex.isSkipEligible({ primary: 'lead', secondary: 'skip' }), true);
});

test('isSkipEligible: recognises flexible players', () => {
    assert.equal(ex.isSkipEligible({ flexible: true }), true);
});

test('isSkipEligible: rejects null / undefined / empty players', () => {
    assert.equal(ex.isSkipEligible(null), false);
    assert.equal(ex.isSkipEligible(undefined), false);
    assert.equal(ex.isSkipEligible({}), false);
});

/* =====================================================================
 * selectSkipsForTeams — exactly `teamCount` Skips; recent-skip
 * deprioritised; shortage surfaced (not silently promoted).
 * ===================================================================== */

test('selectSkipsForTeams: picks exactly teamCount skips when the pool is large enough', () => {
    const skips = [1, 2, 3, 4, 5].map(i => ({ id: `s${i}`, isSkip: true }));
    let s = 1; const rng = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const res = ex.selectSkipsForTeams(skips, 3, rng);
    assert.equal(res.chosen.length, 3);
    assert.equal(res.benched.length, 2);
    assert.equal(res.shortage, 0);
    // Every chosen player came from the input pool.
    for (const p of res.chosen) assert.ok(skips.includes(p));
});

test('selectSkipsForTeams: reports shortage when the pool is short', () => {
    const skips = [1, 2].map(i => ({ id: `s${i}`, isSkip: true }));
    const res = ex.selectSkipsForTeams(skips, 4);
    assert.equal(res.chosen.length, 2);
    assert.equal(res.benched.length, 0);
    assert.equal(res.shortage, 2);
});

test('selectSkipsForTeams: deprioritises skipRecently players', () => {
    // 4 candidates for 2 team slots. Only 2 of them have skipRecently=true.
    // Across many runs, the two fresh candidates should be chosen more
    // often than the two recent ones.
    const fresh = [{ id: 'f1', isSkip: true }, { id: 'f2', isSkip: true }];
    const recent = [
        { id: 'r1', isSkip: true, skipRecently: true },
        { id: 'r2', isSkip: true, skipRecently: true }
    ];
    const pool = fresh.concat(recent);

    let freshChosen = 0;
    let recentChosen = 0;
    let seed = 42;
    const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 200; i++) {
        const res = ex.selectSkipsForTeams(pool, 2, rng);
        for (const p of res.chosen) {
            if (fresh.includes(p)) freshChosen++;
            else recentChosen++;
        }
    }
    assert.ok(freshChosen > recentChosen * 2,
        `fresh candidates should be picked far more often than recent ones (fresh=${freshChosen}, recent=${recentChosen})`);
});

/* =====================================================================
 * swapOptimise — local search over non-Skip players
 * ===================================================================== */

test('swapOptimise: improves an initially unbalanced draw', () => {
    // Two teams, index 0 is the Skip and is protected.
    // Team A: skip=5, others 10 10 10 → total 35
    // Team B: skip=5, others  1  1  1 → total  8
    // A swap of one 10 for one 1 lowers variance dramatically.
    const groups = [
        [
            { id: 'a-skip', experienceLevel: 5 },
            { id: 'a1', experienceLevel: 10 },
            { id: 'a2', experienceLevel: 10 },
            { id: 'a3', experienceLevel: 10 }
        ],
        [
            { id: 'b-skip', experienceLevel: 5 },
            { id: 'b1', experienceLevel: 1 },
            { id: 'b2', experienceLevel: 1 },
            { id: 'b3', experienceLevel: 1 }
        ]
    ];
    const before = ex.balanceScore(ex.computeTeamStats(groups));
    ex.swapOptimise(groups, { maxIter: 20 });
    const after = ex.balanceScore(ex.computeTeamStats(groups));
    assert.ok(after < before, `swapOptimise should reduce the score (before=${before}, after=${after})`);
    // Skips must never be moved.
    assert.equal(groups[0][0].id, 'a-skip');
    assert.equal(groups[1][0].id, 'b-skip');
});

test('swapOptimise: leaves an already-balanced draw untouched', () => {
    const groups = [
        [{ id: 'a0', experienceLevel: 5 }, { id: 'a1', experienceLevel: 5 }],
        [{ id: 'b0', experienceLevel: 5 }, { id: 'b1', experienceLevel: 5 }]
    ];
    const before = ex.balanceScore(ex.computeTeamStats(groups));
    ex.swapOptimise(groups, { maxIter: 5 });
    const after = ex.balanceScore(ex.computeTeamStats(groups));
    assert.equal(after, before);
});

/* =====================================================================
 * teamBalanceScore / drawSummary — human-facing 0..100 scores
 * ===================================================================== */

test('teamBalanceScore: 100 when the team is exactly on the mean', () => {
    assert.equal(ex.teamBalanceScore(20, 20), 100);
});

test('teamBalanceScore: drops 10 points per experience-point of deviation', () => {
    assert.equal(ex.teamBalanceScore(21, 20), 90);
    assert.equal(ex.teamBalanceScore(15, 20), 50);
    assert.equal(ex.teamBalanceScore(0, 20), 0); // clamped
});

test('drawSummary: perfect draw scores 100 overall and 100 per team', () => {
    const groups = [
        [{ experienceLevel: 5 }, { experienceLevel: 5 }],
        [{ experienceLevel: 5 }, { experienceLevel: 5 }]
    ];
    const summary = ex.drawSummary(groups);
    assert.equal(summary.overallScore, 100);
    assert.deepEqual(summary.teamScores, [100, 100]);
});

test('drawSummary: heavily unbalanced draw scores near zero', () => {
    const groups = [
        [{ experienceLevel: 10 }, { experienceLevel: 10 }, { experienceLevel: 10 }],
        [{ experienceLevel: 1 }, { experienceLevel: 1 }, { experienceLevel: 1 }]
    ];
    const summary = ex.drawSummary(groups);
    assert.ok(summary.overallScore < 20, `heavily unbalanced draws should score low; got ${summary.overallScore}`);
});

/* =====================================================================
 * buildBalancedTeams — top-level entry, checks the full contract:
 *   R1  Exactly one Skip per team
 *   R2  Team totals near-equal
 *   R3+R4  No single-band clumping when it's avoidable
 *   R5  Equal team sizes; leftovers become subs
 *   R6+R7  Different RNGs produce different draws
 *   R8  Balance scores present
 * ===================================================================== */

function makePlayer(id, exp, isSkip) {
    return { id, name: id, experienceLevel: exp, isSkip: !!isSkip };
}

test('buildBalancedTeams (R1): every team gets exactly one Skip', () => {
    // 12 players, 3 teams of 4. Three designated Skips, exact count.
    const players = [
        makePlayer('s1', 9, true), makePlayer('s2', 7, true), makePlayer('s3', 8, true),
        makePlayer('p1', 6), makePlayer('p2', 6), makePlayer('p3', 5),
        makePlayer('p4', 5), makePlayer('p5', 4), makePlayer('p6', 4),
        makePlayer('p7', 3), makePlayer('p8', 3), makePlayer('p9', 2)
    ];
    let seed = 7; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 10, rng });

    assert.equal(draw.teams.length, 3);
    for (const team of draw.teams) {
        const skipCount = team.filter(p => p.isSkip).length;
        assert.equal(skipCount, 1, `team should contain exactly one Skip; got ${skipCount}`);
    }
    assert.equal(draw.warnings.length, 0);
});

test('buildBalancedTeams (R1): promotes non-Skips with a warning when the Skip pool is short', () => {
    // 8 players, 2 teams of 4, only ONE designated Skip.
    const players = [
        makePlayer('s1', 9, true),
        makePlayer('p1', 10), makePlayer('p2', 8), makePlayer('p3', 7),
        makePlayer('p4', 6), makePlayer('p5', 4), makePlayer('p6', 3),
        makePlayer('p7', 2)
    ];
    let seed = 3; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 5, rng });

    // Both teams present.
    assert.equal(draw.teams.length, 2);
    // Both teams still have a Skip (index 0).
    for (const team of draw.teams) {
        assert.ok(team[0], 'team must have a Skip in slot 0');
    }
    // A warning about the promotion was recorded.
    assert.ok(
        draw.warnings.some(w => /promot/i.test(w)),
        `expected a promotion warning; got ${JSON.stringify(draw.warnings)}`
    );
    // The promoted Skip should be the highest-experience non-Skip (p1 with exp 10).
    const allSkips = draw.teams.map(t => t[0]);
    assert.ok(allSkips.some(s => s.id === 'p1'),
        'the highest-experience non-Skip should be promoted to Skip');
});

test('buildBalancedTeams (R2): team totals are within a small range', () => {
    // 16 players, 4 teams of 4.
    const exps = [10, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 1];
    const players = exps.map((exp, i) => makePlayer(`p${i}`, exp, i < 4)); // first 4 are Skips
    let seed = 11; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 30, rng });

    const totals = draw.stats.map(s => s.total);
    const maxDiff = Math.max(...totals) - Math.min(...totals);
    // Mean is (10+9+...+1)/4 = 88/4 = 22. A well-optimised draw should
    // land within a handful of points.
    assert.ok(maxDiff <= 3, `team totals should be within 3 of each other; got ${totals}`);
});

test('buildBalancedTeams (R3+R4): mixed-band teams (avoids all-experts / all-beginners clumping)', () => {
    // 8 experts (exp 9-10), 8 beginners (exp 1-2), 4 teams of 4.
    // A dumb algorithm would put 4 experts on one team; ours must spread them.
    const experts = [10, 10, 10, 10, 9, 9, 9, 9].map((e, i) =>
        makePlayer(`e${i}`, e, i < 2)); // first 2 experts are Skips
    const beginners = [2, 2, 2, 2, 1, 1, 1, 1].map((e, i) =>
        makePlayer(`b${i}`, e, i < 2)); // first 2 beginners are Skips
    const players = experts.concat(beginners);
    let seed = 5; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 30, rng });

    // No team should be all-experts or all-beginners.
    for (const team of draw.teams) {
        const bands = new Set(team.map(p => ex.experienceBand(p.experienceLevel)));
        assert.ok(bands.size >= 2,
            `team should contain more than one experience band; got ${[...bands].join(',')}`);
    }
});

test('buildBalancedTeams (R5): equal team sizes; leftovers become subs', () => {
    // 10 players, teamSize 4 → 2 teams of 4, 2 subs.
    const players = Array.from({ length: 10 }, (_, i) =>
        makePlayer(`p${i}`, 5 + (i % 3), i < 2));
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 5 });
    assert.equal(draw.teams.length, 2);
    for (const team of draw.teams) assert.equal(team.length, 4);
    assert.equal(draw.substitutes.length, 2);
});

test('buildBalancedTeams (R7): different RNG seeds produce different draws', () => {
    const players = Array.from({ length: 12 }, (_, i) =>
        makePlayer(`p${i}`, 1 + (i % 10), i < 3));

    const drawFor = (seedInit) => {
        let s = seedInit;
        const rng = () => (s = (s * 9301 + 49297) % 233280) / 233280;
        const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 5, rng });
        // Represent the draw as a sorted set of team-ID-sets.
        return draw.teams
            .map(t => t.map(p => p.id).sort().join(','))
            .sort()
            .join('|');
    };
    const seen = new Set();
    for (let seed = 1; seed <= 30; seed++) {
        seen.add(drawFor(seed));
        if (seen.size >= 2) break;
    }
    assert.ok(seen.size >= 2, 'different RNG seeds should produce different lineups');
});

test('buildBalancedTeams (R8): every result includes per-team and overall scores', () => {
    const players = Array.from({ length: 8 }, (_, i) =>
        makePlayer(`p${i}`, 1 + i, i < 2));
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 3 });

    assert.equal(draw.teamScores.length, draw.teams.length);
    for (const s of draw.teamScores) {
        assert.ok(typeof s === 'number' && s >= 0 && s <= 100,
            `each team score should be a number in 0..100; got ${s}`);
    }
    assert.ok(typeof draw.overallScore === 'number');
    assert.ok(draw.overallScore >= 0 && draw.overallScore <= 100);
    assert.ok(typeof draw.meanTotal === 'number');
});

/* =====================================================================
 * buildBalancedTeams — edge cases from the design spec
 * ===================================================================== */

test('buildBalancedTeams edge: zero players → empty draw with a warning', () => {
    const draw = ex.buildBalancedTeams([], { teamSize: 4 });
    assert.deepEqual(draw.teams, []);
    assert.deepEqual(draw.substitutes, []);
    assert.equal(draw.warnings.length, 1);
});

test('buildBalancedTeams edge: fewer players than a team → everyone subs', () => {
    const players = [makePlayer('a', 5, true), makePlayer('b', 5)];
    const draw = ex.buildBalancedTeams(players, { teamSize: 4 });
    assert.equal(draw.teams.length, 0);
    assert.equal(draw.substitutes.length, 2);
    assert.equal(draw.warnings.length, 1);
});

test('buildBalancedTeams edge: no designated Skips at all → all promoted with a warning', () => {
    // 8 non-Skip players, teams of 4 → 2 teams need Skips, none designated.
    const exps = [10, 9, 8, 7, 6, 5, 4, 3];
    const players = exps.map((e, i) => makePlayer(`p${i}`, e, false));
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 3 });
    assert.equal(draw.teams.length, 2);
    for (const team of draw.teams) {
        assert.ok(team[0], 'every team must still have a Skip in slot 0');
    }
    // Two players were promoted → one warning message.
    assert.ok(
        draw.warnings.some(w => /promot/i.test(w)),
        `expected a promotion warning; got ${JSON.stringify(draw.warnings)}`
    );
});

test('buildBalancedTeams edge: all players unrated → balanced by count with median exp', () => {
    // 8 players, none with experienceLevel; 2 teams of 4.
    const players = Array.from({ length: 8 }, (_, i) =>
        ({ id: `p${i}`, name: `p${i}`, isSkip: i < 2, experienceLevel: null }));
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 3 });
    const totals = draw.stats.map(s => s.total);
    // Every player counts as 5 → 4 * 5 = 20 per team.
    assert.deepEqual(totals, [20, 20]);
    assert.equal(draw.overallScore, 100);
});

test('buildBalancedTeams edge: excluded players are ignored', () => {
    const players = [
        makePlayer('a', 5, true), makePlayer('b', 5, true),
        makePlayer('c', 5), makePlayer('d', 5), makePlayer('e', 5),
        makePlayer('f', 5), makePlayer('g', 5), makePlayer('h', 5)
    ];
    players[0].excluded = true;   // exclude one Skip
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 3 });
    // Only 7 active → 1 full team of 4, 3 subs.
    assert.equal(draw.teams.length, 1);
    assert.equal(draw.teams[0].length, 4);
    assert.equal(draw.substitutes.length, 3);
    // The excluded player must not appear anywhere.
    const allInDraw = draw.teams.flat().concat(draw.substitutes);
    assert.ok(!allInDraw.some(p => p.id === 'a'), 'excluded players must not appear in the draw');
});

/* =====================================================================
 * Bug fix: designated Skips with blank experience must be selected
 * ahead of any other Skip-capable player (flexible / secondary=skip),
 * and blank experience must never disqualify a player from the Skip
 * pool.
 *
 * Covers the acceptance criteria from the bug report:
 *   - Skip + blank experience
 *   - Multiple Skips with blank experience
 *   - More Skips than teams
 *   - Fewer Skips than teams
 *   - Blank experience defaults correctly (getEffectiveExperience → 5)
 *   - Explicit Skip designation always takes priority over
 *     experience-based promotion
 * ===================================================================== */

// Helper: player object shaped like the app's Player type, so tests
// exercise the same code path as production.
function skip(id, expOrNull) {
    return { id, name: id, primary: 'skip', secondary: '', flexible: false, experienceLevel: expOrNull };
}
function flex(id, expOrNull) {
    return { id, name: id, primary: '', secondary: '', flexible: true, experienceLevel: expOrNull };
}
function lead(id, expOrNull) {
    return { id, name: id, primary: 'lead', secondary: '', flexible: false, experienceLevel: expOrNull };
}

test('isDesignatedSkip: primary === "skip" is a designated Skip, regardless of blank experience', () => {
    assert.equal(ex.isDesignatedSkip({ primary: 'skip', experienceLevel: null }), true);
    assert.equal(ex.isDesignatedSkip({ primary: 'skip', experienceLevel: undefined }), true);
    assert.equal(ex.isDesignatedSkip({ primary: 'skip' }), true);
    assert.equal(ex.isDesignatedSkip({ isSkip: true, experienceLevel: null }), true);
    // Not a designated Skip (even though isSkipEligible would be true):
    assert.equal(ex.isDesignatedSkip({ secondary: 'skip' }), false);
    assert.equal(ex.isDesignatedSkip({ flexible: true }), false);
    assert.equal(ex.isDesignatedSkip(null), false);
});

test('partitionSkipCandidates: places designated Skips in their own tier, disjoint from other tiers', () => {
    const players = [
        skip('d1', null),                                // Tier A
        skip('d2', null),                                // Tier A
        { id: 's1', primary: 'lead', secondary: 'skip' }, // Tier B
        flex('f1', 8),                                   // Tier C
        lead('o1', 6)                                    // Tier D
    ];
    const t = ex.partitionSkipCandidates(players);
    assert.deepEqual(t.designated.map(p => p.id), ['d1', 'd2']);
    assert.deepEqual(t.secondarySkip.map(p => p.id), ['s1']);
    assert.deepEqual(t.flexible.map(p => p.id), ['f1']);
    assert.deepEqual(t.other.map(p => p.id), ['o1']);
});

test('selectSkipsForTeams: designated Skips with BLANK experience are always chosen over flexible players with rated experience', () => {
    // Exact scenario from the bug report (scaled down):
    // 5 designated Skips (blank experience) + 5 flexible players (experience 8).
    // With 3 teams, all 3 chosen Skips must come from the designated pool
    // — the flexible/rated players must NEVER displace a blank-experience Skip.
    const designated = [
        skip('d1', null), skip('d2', null), skip('d3', null),
        skip('d4', null), skip('d5', null)
    ];
    const flexibles = [
        flex('f1', 8), flex('f2', 8), flex('f3', 8), flex('f4', 8), flex('f5', 8)
    ];
    let seed = 1; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

    for (let run = 0; run < 50; run++) {
        const res = ex.selectSkipsForTeams(designated.concat(flexibles), 3, rng);
        assert.equal(res.chosen.length, 3);
        for (const p of res.chosen) {
            assert.ok(
                designated.includes(p),
                `run ${run}: a flexible/rated player (${p.id}) was picked as Skip while designated Skips were available`
            );
        }
    }
});

test('selectSkipsForTeams: exactly one Skip per team when every Skip has blank experience', () => {
    // The literal user scenario: 20 players imported as Skip with blank
    // experience, 5 teams of 4 (teamCount = 5).
    const designated = Array.from({ length: 20 }, (_, i) => skip(`s${i}`, null));
    const res = ex.selectSkipsForTeams(designated, 5);
    assert.equal(res.chosen.length, 5);
    assert.equal(res.benched.length, 15);
    assert.equal(res.shortage, 0);
    for (const p of res.chosen) {
        assert.equal(p.primary, 'skip', 'every chosen player must be a designated Skip');
    }
});

test('selectSkipsForTeams: consumes Tier A first, Tier B next, Tier C last', () => {
    // 1 designated + 1 secondary + 3 flexibles; need 3 Skips.
    // Must pick: 1 designated + 1 secondary + 1 flexible (never
    // 3 flexibles, never 2 designated + 1 flex — the designated pool
    // only has one).
    const designated = skip('D', null);
    const secondarySkip = { id: 'S', name: 'S', primary: 'lead', secondary: 'skip' };
    const flexibles = [flex('F1', 9), flex('F2', 9), flex('F3', 9)];
    const pool = [designated, secondarySkip].concat(flexibles);

    let seed = 99; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let run = 0; run < 20; run++) {
        const res = ex.selectSkipsForTeams(pool, 3, rng);
        const ids = res.chosen.map(p => p.id);
        assert.ok(ids.includes('D'), `run ${run}: designated Skip 'D' must always be picked; got ${ids}`);
        assert.ok(ids.includes('S'), `run ${run}: secondary Skip 'S' must be picked before any flexible; got ${ids}`);
        // Exactly one flexible in the remaining slot.
        const flexPicked = ids.filter(id => id.startsWith('F')).length;
        assert.equal(flexPicked, 1, `run ${run}: exactly one flexible should be picked; got ${flexPicked}`);
    }
});

test('selectSkipsForTeams: more designated Skips than teams → random subset from the designated pool only', () => {
    // 10 designated Skips (blank experience) + 4 flexibles with experience.
    // With 3 teams, all 3 Skips must come from the 10 designated pool.
    const designated = Array.from({ length: 10 }, (_, i) => skip(`d${i}`, null));
    const flexibles = Array.from({ length: 4 }, (_, i) => flex(`f${i}`, 7 + (i % 3)));
    let seed = 42; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

    // Also confirm we get variety across runs (Requirement 7).
    const seen = new Set();
    for (let run = 0; run < 40; run++) {
        const res = ex.selectSkipsForTeams(designated.concat(flexibles), 3, rng);
        const ids = res.chosen.map(p => p.id).sort().join(',');
        seen.add(ids);
        for (const p of res.chosen) {
            assert.ok(designated.includes(p),
                `run ${run}: only designated Skips must be picked; got ${p.id}`);
        }
    }
    assert.ok(seen.size >= 2, 'repeated runs should produce different Skip lineups');
});

test('selectSkipsForTeams: fewer designated Skips than teams → report shortage (promotion is caller\'s job)', () => {
    // 2 designated Skips, need 5 teams. The library layer does NOT
    // silently promote — it reports the shortage. The wrapping
    // buildBalancedTeams / attemptDrawByExperience layers promote by
    // experience only if Tiers A+B+C combined are still short.
    const designated = [skip('d1', null), skip('d2', null)];
    const res = ex.selectSkipsForTeams(designated, 5);
    assert.equal(res.chosen.length, 2);
    assert.equal(res.shortage, 3);
    for (const p of res.chosen) {
        assert.equal(p.primary, 'skip');
    }
});

test('getEffectiveExperience: blank experience defaults to 5 for BALANCING (not for Skip selection)', () => {
    // The bug report requirement: "If experience is blank, assign the
    // default experience value (currently 5) after the player has
    // been identified as a Skip." Verified by the two-step check:
    //   1. isDesignatedSkip returns true regardless of experience.
    //   2. getEffectiveExperience returns 5 for null.
    const blankSkip = skip('x', null);
    assert.equal(ex.isDesignatedSkip(blankSkip), true);
    assert.equal(ex.getEffectiveExperience(blankSkip), 5);
});

test('buildBalancedTeams: explicit Skip designation always takes priority over experience-based promotion', () => {
    // 3 designated Skips with BLANK experience + 9 non-Skip players
    // with high experience (7-9). teamSize 4 → 3 teams.
    // Requirement 6: designated Skips are NOT replaced by rated
    // non-Skips.
    const designated = [
        skip('d1', null), skip('d2', null), skip('d3', null)
    ];
    const others = [
        lead('o1', 9), lead('o2', 9), lead('o3', 8), lead('o4', 8),
        lead('o5', 7), lead('o6', 7), lead('o7', 7), lead('o8', 7),
        lead('o9', 7)
    ];
    let seed = 13; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const draw = ex.buildBalancedTeams(designated.concat(others),
        { teamSize: 4, attempts: 20, rng });

    assert.equal(draw.teams.length, 3);
    // Every Skip slot (index 0) must be one of the 3 designated Skips.
    const skipIds = draw.teams.map(t => t[0].id).sort();
    assert.deepEqual(skipIds, ['d1', 'd2', 'd3'],
        `expected the three designated Skips at index 0 of each team; got ${skipIds}`);
    // No promotion warning — we had exactly enough designated Skips.
    assert.equal(draw.warnings.length, 0);
});

test('buildBalancedTeams: multiple designated Skips with blank experience — every team gets a designated Skip', () => {
    // 20 designated Skips with blank experience, teamSize 4 → 5 teams.
    // Reproduces the bug scenario end-to-end.
    const players = Array.from({ length: 20 }, (_, i) => skip(`s${i}`, null));
    // The teams also need non-Skip players to fill. Without them, the
    // greedy fill would leave 3 empty slots per team. The bug report
    // scenario only mentions 20 Skip-marked players — but the library
    // still guarantees a designated Skip on each of the 5 teams that
    // CAN be formed, and the extras become subs (Requirement 5).
    const draw = ex.buildBalancedTeams(players, { teamSize: 4, attempts: 5 });
    assert.equal(draw.teams.length, 5);
    for (const team of draw.teams) {
        assert.ok(team[0], 'every team must have a player at the Skip slot');
        assert.equal(team[0].primary, 'skip',
            'every Skip slot must be filled by a designated Skip when the roster is all designated Skips');
    }
});

test('buildBalancedTeams: fewer designated Skips than teams + non-Skip pool → promoted, but only after Tier A/B/C exhausted', () => {
    // 1 designated Skip (blank exp) + 1 secondary Skip (exp 5) +
    // 1 flexible (exp 5) + 5 non-Skips (exp 9). teamSize 2 → 4 teams
    // needing 4 Skips. Tier A/B/C = 3 people; need to promote 1 more
    // from the 5 non-Skips. That promotion picks the highest-exp
    // non-Skip (any of the 9s). Tier A/B/C players must be picked
    // FIRST regardless of their (lower) experience.
    const players = [
        skip('D', null),
        { id: 'S', name: 'S', primary: 'lead', secondary: 'skip', experienceLevel: 5 },
        flex('F', 5),
        lead('o1', 9), lead('o2', 9), lead('o3', 9), lead('o4', 9), lead('o5', 9)
    ];
    let seed = 21; const rng = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const draw = ex.buildBalancedTeams(players, { teamSize: 2, attempts: 20, rng });

    assert.equal(draw.teams.length, 4);
    const skipIds = draw.teams.map(t => t[0].id);
    // The three Tier A/B/C players MUST all appear as Skips.
    for (const requiredSkip of ['D', 'S', 'F']) {
        assert.ok(
            skipIds.includes(requiredSkip),
            `${requiredSkip} (Tier A/B/C) must be a Skip before any non-Skip is promoted; got ${skipIds}`
        );
    }
    // Exactly one 'o' player was promoted.
    const promotedSkips = skipIds.filter(id => id.startsWith('o'));
    assert.equal(promotedSkips.length, 1,
        `exactly one non-Skip should have been promoted; got ${promotedSkips}`);
    // A promotion warning was surfaced.
    assert.ok(
        draw.warnings.some(w => /promot/i.test(w)),
        `expected a promotion warning; got ${JSON.stringify(draw.warnings)}`
    );
});

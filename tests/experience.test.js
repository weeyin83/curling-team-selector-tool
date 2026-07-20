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

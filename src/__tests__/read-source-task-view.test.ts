/**
 * A source read again, sorted, and the footer that says who creates the task (spec 059 §5 and §1,
 * `read.sourceTask`): each change's group and its priority, one count of the sure changes everywhere (the first
 * group, the task's places, the header's first number), a group without places left out of the header, the
 * footer's states; without the research's fields everything as before. Invented data only (Vlk, Doubrava, Hora).
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { resultPlaces, sortPlaces, sortedGroups, sortedCounts, checkHtml, lineMarksHtml, placePopHtml, type ShownPlace } from '../ui/read-result-view.js';
import { readTaskFootHtml, readTaskFootState, readTaskMajorNote, readTaskOffers, type ReadTaskFootInput } from '../ui/read-task-view.js';
import { composeVerdict, mergeAdjacent, readOneReader, readSourceCat, readSourceSort, readSourceSaysSure, type MergedVariant, type VerdictFacts } from '../read-result.js';
import { researchLinkMark } from '../research-link.js';
import { researchActionLabel, researchBridgeAgentLabel } from '../ui/research-open-mark.js';
import { strings, getStringsForLang } from '../strings.js';

const t = strings.read;
const v = (at: string, other: string, over: Partial<MergedVariant> = {}): MergedVariant => ({ at, other, ...over });
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;

// The new reading (reader 1's text); changes: `at` the existing transcript, `other` the new reading.
const TEXT = 'Joannes Vlk filius legitimus\nJosephi Kolar in Doubrava N. 7\net Catharinae Hora';
const CHG = [
    v('Dubrava', 'Doubrava', { sure: true }),
    v('N. 4', 'N. 7', { sure: false }),
    v('Kolář', 'Kolar', { sure: true, judged: 'T0399' }),
    v('legitimus,', 'legitimus', { sure: true }),
    v('Marek', 'Hora', { sure: true }),
];
const DIS = [
    v('N. 7', 'N. 1'),
    v('Joannes', 'Joannes,', { kind: 'punctuation' }),
    v('Catharinae', 'Catharina', { kind: 'name' }),
];
const marks = () => resultPlaces({ text: TEXT, dis: DIS, disSide: 'at', disKinded: true, data: [], chg: CHG });

describe('readSourceSort', () => {
    it('unsure before assessed before minor; the rest sure substantive changes', () => {
        expect(readSourceCat(v('a', 'b', { sure: false, judged: 'T0399', kind: 'spelling' }))).toBe('unsure');
        expect(readSourceCat(v('Kolář', 'Kolar', { sure: true, judged: 'T0399', kind: 'spelling' }))).toBe('judged');
        expect(readSourceCat(v('legitimus,', 'legitimus', { sure: true }))).toBe('minor');
        expect(readSourceCat(v('Vlk', 'Vlk', { kind: 'case' }))).toBe('minor');
        expect(readSourceCat(v('Marek', 'Hora', { sure: true }))).toBe('major');
        // An illegible spot in the new reading where the transcript has a word: uncertain, not a change.
        expect(readSourceCat(v('Catharina', '[...]', { sure: true }))).toBe('unsure');
        expect(readSourceCat(v('', '[…]'))).toBe('major');
        const s = readSourceSort(CHG);
        expect([s.major, s.unsure, s.judged, s.minor].map(g => g.map(x => x.other))).toEqual([['Doubrava', 'Hora'], ['N. 7'], ['Kolar'], ['legitimus']]);
    });

    it('the sorted view only when the research says sure or assessed', () => {
        expect(readSourceSaysSure([v('a', 'b'), v('c', 'd', { kind: 'name' })])).toBe(false);
        expect(readSourceSaysSure([v('a', 'b', { sure: true })])).toBe(true);
        expect(readSourceSaysSure([v('a', 'b', { judged: 'T0001' })])).toBe(true);
    });

    it('merged neighbours: unsure when any part is, sure only when all are, assessed only in one task', () => {
        const text = 'Josephi Kolar in Doubrava';
        const m = (a: Partial<MergedVariant>, b: Partial<MergedVariant>) =>
            mergeAdjacent([v('Kolář', 'Kolar', a), v('na', 'in', b)], text, 'other');
        expect(m({ sure: true }, { sure: false })[0].sure).toBe(false);
        expect(m({ sure: true }, { sure: true })[0].sure).toBe(true);
        expect(m({ sure: true }, {})[0]).not.toHaveProperty('sure');
        expect(m({ judged: 'T0399' }, { judged: 'T0399' })[0].judged).toBe('T0399');
        expect(m({ judged: 'T0399' }, { judged: 'T0400' })[0]).not.toHaveProperty('judged');
    });
});

describe('"To check" sorted', () => {
    const { lines, places } = marks();
    const sorted = sortPlaces(places);
    const opts = { isSource: true, shown: 1 as const, kinded: true, focus: '' };
    const sortedOpt = { note: t.cMajNote, person: false, taskLink: true };

    it('the groups: sure changes, uncertain (an unsure change with both readers; the readers\' place on a change listed once), assessed, minor', () => {
        const g = sortedGroups(sorted);
        expect(g.major.map(p => p.v!.other)).toEqual(['Doubrava', 'Hora']);
        expect(g.unsure.map(p => p.v!.other)).toEqual(['N. 7', 'Catharina']);
        expect(g.judged).toEqual([{ task: 'T0399', rows: [expect.objectContaining({ id: 'c2' })] }]);
        expect(g.minor.map(p => p.id).sort()).toEqual(['c3', 'd1']);
        const unsure = sorted.find(p => p.id === 'c1')!;
        expect(unsure.r2).toBe('N. 1');
        expect(sorted.find(p => p.id === 'd0')!.under).toBe('c1');
        expect(sortedCounts(sorted)).toEqual({ major: 2, unsure: 2, minor: 2, judged: [{ task: 'T0399', n: 1 }] });
    });

    it('the HTML: groups in order with their counts, assessed and minor folded, the task\'s link with the terminal mark', () => {
        const html = checkHtml(sorted, { ...opts, sorted: sortedOpt });
        const order = [...html.matchAll(/data-group="([a-z]+)"/g)].map(m => m[1]);
        expect(order).toEqual(['major', 'unsure', 'judged', 'minor']);
        expect(html).toContain(`${t.gMajor}</span><span class="read-check-count">(2)</span>`);
        expect(html).toContain(`<p class="read-check-note">${t.cMajNote}</p>`);
        expect(count(html, /<details class="read-check-fold"/g)).toBe(2);
        expect(html).toContain(researchActionLabel(t.tTaskLink('T0399'), researchLinkMark('task')));
        expect(html).toContain('read-check-row is-judged');
        expect(checkHtml(sorted, { ...opts, sorted: { ...sortedOpt, taskLink: false } })).not.toContain('read-check-task');
        expect(checkHtml(sorted, { ...opts, sorted: { ...sortedOpt, person: true } })).toContain(t.gMajorPerson);
        // The uncertain group's name: the readers disagree (two), the reader was not sure (one).
        expect(html).toContain(`${t.gUnsure}</span>`);
        const one = checkHtml(sorted, { ...opts, oneReader: true, sorted: sortedOpt });
        expect(one).toContain(`${t.gUnsure1}</span>`);
        expect(one).not.toContain(`${t.gUnsure}</span>`);
    });

    it('one reader as the research counts it: the second one did not run, no blind text', () => {
        const r = (asked: number, ran: number, blind = false) => ({ readers: { asked, ran, agree: null }, ...(blind ? { blind: { entries: [] } } : {}) }) as never;
        expect(readOneReader(r(1, 1))).toBe(true);
        expect(readOneReader(r(2, 1))).toBe(true);
        expect(readOneReader(r(1, 0))).toBe(true);
        expect(readOneReader(r(2, 2))).toBe(false);
        expect(readOneReader(r(2, 0))).toBe(false);
        expect(readOneReader(r(1, 1, true))).toBe(false);
    });

    it('the text: an unsure change drawn as the readers\' place (once), an assessed one muted with ✓, a minor one dashed', () => {
        const html = lines.map((l, j) => lineMarksHtml(l, j, sorted, '')).join('\n');
        expect(count(html, /read-mk-unsure/g)).toBe(1);
        expect(html).not.toContain('data-place="d0"');
        expect(html).toContain('read-mk read-mk-jud');
        expect(html).toContain('<sup aria-hidden="true">✓</sup>');
        expect(count(html, /read-mk read-mk-min/g)).toBe(1);
        expect(count(html, /read-mk read-mk-chg/g)).toBe(2);
        const pop = placePopHtml(sorted.filter(p => p.id === 'c1'), 1, false);
        expect(pop).toContain('N. 1');
        expect(pop).toContain(t.bUnsure);
        expect(placePopHtml(sorted.filter(p => p.id === 'c2'), 1, false)).toContain(t.bJudged('T0399'));
    });

    it('one count of the sure changes: the first group = the task\'s places in the footer = the header\'s first number', () => {
        const counts = sortedCounts(sorted);
        const group = /data-group="major">\s*<div class="read-check-head">.*?<span class="read-check-count">\((\d+)\)<\/span>/s
            .exec(checkHtml(sorted, { ...opts, sorted: sortedOpt }))![1];
        const foot = readTaskFootHtml({ ...BASE, counts });
        const facts: VerdictFacts = { partial: false, why: '', illegible: 0, source: { compared: true, major: 4, minor: 1, kinded: true, sorted: counts }, disagree: 3 };
        const verdict = composeVerdict(facts, t, x => x, x => `[${x}]`);
        const first = /\[(\d+)/.exec(verdict)![1];
        expect(Number(group)).toBe(2);
        expect(first).toBe(group);
        expect(foot).toContain(t.tAgentN(Number(group)));
        expect(verdict).toBe(`${t.vRead} [${t.vMajor(2)}] · ${t.vUnsure(2)} · ${t.vMinor(2)} · ${t.vJudged(1, 'T0399')}`);
    });

    it('the header: a group without places left out; none left: matches the transcript; the readers\' part not repeated', () => {
        const facts = (sorted: VerdictFacts['source'] extends infer S ? S extends { sorted?: infer X } ? X : never : never): VerdictFacts =>
            ({ partial: false, why: '', illegible: 0, source: { compared: true, major: 0, minor: 0, kinded: true, sorted }, disagree: 2 });
        expect(composeVerdict(facts({ major: 0, unsure: 3, minor: 0, judged: [{ task: 'T0399', n: 0 }] }), t, x => x, x => `[${x}]`))
            .toBe(`${t.vRead} [${t.vUnsure(3)}]`);
        expect(composeVerdict(facts({ major: 1, unsure: 0, minor: 4, judged: [] }), t, x => x, x => `[${x}]`))
            .toBe(`${t.vRead} [${t.vMajor(1)}] · ${t.vMinor(4)}`);
        expect(composeVerdict(facts({ major: 0, unsure: 0, minor: 0, judged: [] }), t)).toBe(`${t.vRead} ${t.vSrcSame}`);
    });
});

describe('without the research\'s fields: as before', () => {
    it('the same HTML as before the sorted view (fingerprint of the earlier builders\' output)', () => {
        const { lines, places } = resultPlaces({
            text: 'Joannes Vlk filius legitimus\nJosephi Vlk[?] in Doubrava N. 7\net Catharinae [...]',
            dis: [v('Doubrava', 'Dubrava'), v('filius', 'filii', { kind: 'spelling' })], disSide: 'at', disKinded: true, data: [],
            chg: [v('Dubrava', 'Doubrava'), v('legitimus,', 'legitimus'), v('Vlk', 'Wolf')],
        });
        expect(places.some((p: ShownPlace) => p.cat || p.under || p.r2 !== undefined)).toBe(false);
        const html = checkHtml(places, { isSource: true, shown: 1, kinded: false, focus: '' })
            + lines.map((l, j) => lineMarksHtml(l, j, places, '')).join('\n') + places.map(p => placePopHtml([p], 1, false)).join('');
        expect(createHash('sha256').update(html).digest('hex').slice(0, 16)).toBe('8cabd365337fa34f');
    });

    it('the header as before', () => {
        const f: VerdictFacts = { partial: false, why: '', illegible: 0, source: { compared: true, major: 2, minor: 1, kinded: true }, disagree: 1 };
        expect(composeVerdict(f, t)).toBe(`${t.vRead} ${t.vSrc(2, 1, true, x => x)} ${t.vDis(1, x => x)}`);
    });
});

const BASE: ReadTaskFootInput = {
    setting: 'ask', offer: true, task: '', confirmed: false, computer: true,
    counts: { major: 2, unsure: 1, minor: 3, judged: [] }, canOpenTask: true,
};
const stateOf = (html: string): string => /data-task-state="([a-zA-Z]+)"/.exec(html)?.[1] ?? '';
const acts = (html: string): string[] => [...html.matchAll(/data-act="([a-z-]+)"/g)].map(m => m[1]);
const NOW_MARK = researchLinkMark('task', { taskDo: 'chat' });

describe('the footer: who creates the task', () => {
    it('A: the agent\'s two choices (marked) and "just save"', () => {
        const html = readTaskFootHtml(BASE);
        expect(stateOf(html)).toBe('A');
        expect(acts(html)).toEqual(['task-now', 'task-queue', 'task-save']);
        expect(html).toContain(t.tAgentN(2));
        expect(html).toContain(researchActionLabel(t.tNow, NOW_MARK));
        expect(html).toContain(researchBridgeAgentLabel(t.tQueue));
        expect(html).toContain(`<span class="read-task-ct">${t.tSave}</span>`);
        expect(readTaskMajorNote('A', BASE)).toBe(t.cMajNote);
    });

    it('append: the choices add the places to the source\'s open task', () => {
        const i = { ...BASE, openTask: 'T0399' };
        const html = readTaskFootHtml(i);
        expect(stateOf(html)).toBe('append');
        expect(html).toContain(researchActionLabel(t.tAppendNow('T0399'), NOW_MARK));
        expect(html).toContain(t.tAppendNote('T0399'));
        expect(readTaskMajorNote('append', i)).toBe(t.cMajAppend('T0399'));
    });

    it('B: no sure change, no task and no decision; its sentence by what is left', () => {
        const b = { ...BASE, offer: false, counts: { major: 0, unsure: 0, minor: 2, judged: [] } };
        expect(readTaskFootState(b)).toBe('B');
        expect(readTaskFootState({ ...b, setting: 'always' })).toBe('B');
        // Sure changes counted, yet nothing offered and nothing held: the footer as before (never "only minor details").
        expect(readTaskFootState({ ...b, counts: BASE.counts })).toBeNull();
        expect(readTaskFootHtml({ ...b, counts: { major: 0, unsure: 0, minor: 2, judged: [{ task: 'T0399', n: 2 }] } })).toContain(t.tAllJudged('T0399'));
        expect(readTaskFootHtml({ ...b, counts: { major: 0, unsure: 2, minor: 1, judged: [] } })).toContain(t.tOnlyUnsure(2));
        const minor = readTaskFootHtml({ ...b, counts: { major: 0, unsure: 0, minor: 2, judged: [] } });
        expect(minor).toContain(t.tOnlyMinor);
        expect(acts(minor)).toEqual(['close']);
    });

    // The bridge's own shape (research `sourceReadForApp`): `taskOffer` is false whenever a task holds the places or a person decided.
    it('the bridge\'s answer with a task or a decision: never B or D (`taskOffer: false` + `task` / `decided`)', () => {
        const held = { ...BASE, offer: false, task: 'T0001', counts: { major: 0, unsure: 0, minor: 1, judged: [{ task: 'T0001', n: 2 }] } };
        const always = readTaskFootHtml({ ...held, setting: 'always' });
        expect(stateOf(always)).toBe('C');
        expect(always).toContain(t.tAlways('T0001'));
        expect(acts(always)).toEqual(['open-settings', 'close', 'open-task']);
        expect(readTaskMajorNote('C', held)).toBe(t.cMajTask('T0001'));
        // The places still counted as sure in the app (no `judged` sent): the same.
        expect(readTaskFootState({ ...held, setting: 'always', counts: BASE.counts })).toBe('C');
        // Asked, then queued or started: opened again, the task.
        const ask = readTaskFootHtml(held);
        expect(stateOf(ask)).toBe('decided');
        expect(acts(ask)).toEqual(['open-task', 'close']);
        // "never", a task made at the source afterwards: the task, not "tasks are not created".
        const never = readTaskFootHtml({ ...held, setting: 'never' });
        expect(stateOf(never)).toBe('decided');
        expect(never).toContain(t.tDoneAgent('T0001'));
        expect(never).not.toContain(t.tNever);
        expect(acts(never)).toEqual(['open-task', 'close']);
        // A person's review of a confirmed transcript.
        expect(readTaskFootHtml({ ...held, taskFor: 'person' })).toContain(t.tDoneReview('T0001'));
        // Kept without a task ("just save"), under any setting: saved.
        const saved = { ...BASE, offer: false, decided: 'saved' as const, counts: { major: 0, unsure: 0, minor: 0, judged: [{ task: 'D20261107174337-5c33', n: 2 }] } };
        for (const setting of ['ask', 'always', 'never'] as const) {
            const html = readTaskFootHtml({ ...saved, setting });
            expect(stateOf(html)).toBe('decided');
            expect(html).toContain(t.tDoneSave);
            expect(html).not.toContain(t.tAllKept);
        }
    });

    it('C: created by the setting "always", the task to open; without a task the footer as before', () => {
        const html = readTaskFootHtml({ ...BASE, setting: 'always', task: 'T0400' });
        expect(stateOf(html)).toBe('C');
        expect(html).toContain(t.tAlways('T0400'));
        expect(acts(html)).toEqual(['open-settings', 'close', 'open-task']);
        expect(readTaskFootHtml({ ...BASE, setting: 'always', task: 'T0400', taskFor: 'person' })).toContain(t.tAlwaysPerson('T0400'));
        expect(readTaskFootHtml({ ...BASE, setting: 'always' })).toBe('');
        expect(acts(readTaskFootHtml({ ...BASE, setting: 'always', task: 'T0400', canOpenTask: false }))).toEqual(['open-settings', 'close']);
    });

    it('D: the setting "never" (even with sure changes)', () => {
        const html = readTaskFootHtml({ ...BASE, setting: 'never' });
        expect(stateOf(html)).toBe('D');
        expect(html).toContain(t.tNever);
        expect(acts(html)).toEqual(['open-settings', 'close']);
    });

    it('E: a confirmed transcript: a person reviews, the two groups even', () => {
        const html = readTaskFootHtml({ ...BASE, confirmed: true });
        expect(stateOf(html)).toBe('E');
        expect(html).toContain('read-task-choices is-even');
        expect(acts(html)).toEqual(['task-review', 'task-save']);
        expect(html).toContain(t.tPersonN(2));
        expect(readTaskMajorNote('E', { ...BASE, confirmed: true })).toBe(t.cMajPerson);
    });

    it('opened again after a choice: what became of it, without the choices', () => {
        const agent = readTaskFootHtml({ ...BASE, task: 'T0400' });
        expect(stateOf(agent)).toBe('decided');
        expect(agent).toContain(t.tDoneAgent('T0400'));
        expect(acts(agent)).toEqual(['open-task', 'close']);
        expect(readTaskFootHtml({ ...BASE, decided: 'saved' })).toContain(t.tDoneSave);
    });

    it('a phone (no bridge): the places not checked, no choice', () => {
        const html = readTaskFootHtml({ ...BASE, computer: false });
        expect(stateOf(html)).toBe('phone');
        expect(html).toContain(t.tPhone(2));
        expect(acts(html)).toEqual([]);
    });

    it('F: on its way the chosen one busy and the others off; done; failed with a retry marked like the choice', () => {
        const busy = readTaskFootHtml({ ...BASE, act: { how: 'queue', append: false, busy: true } });
        expect(stateOf(busy)).toBe('F');
        expect(count(busy, /aria-busy="true"/g)).toBe(1);
        expect(count(busy, / disabled>/g)).toBe(3);
        expect(busy).toContain(t.tBusy);
        const done = readTaskFootHtml({ ...BASE, act: { how: 'now', append: false, busy: false, reply: { task: 'T0401', chat: 'x', appended: false } } });
        expect(done).toContain(t.tDoneAgent('T0401'));
        expect(acts(done)).toEqual(['open-task', 'close']);
        expect(readTaskFootHtml({ ...BASE, act: { how: 'save', append: false, busy: false, reply: { task: '', chat: '', appended: false } } })).toContain(t.tDoneSave);
        const failed = readTaskFootHtml({ ...BASE, act: { how: 'now', append: false, busy: false, failed: true } });
        expect(failed).toContain(t.tFail);
        expect(failed).toContain(`data-how="now">${researchActionLabel(t.tRetry, NOW_MARK)}`);
        expect(readTaskFootHtml({ ...BASE, act: { how: 'queue', append: false, busy: false, failed: true } })).toContain(researchBridgeAgentLabel(t.tRetry));
        // No task in a reply that should have made one: a failure, not "created".
        expect(readTaskFootHtml({ ...BASE, act: { how: 'queue', append: false, busy: false, reply: { task: '', chat: '', appended: false } } })).toContain(t.tFail);
    });
});

describe('a place a person kept (judged "D…", "Save only")', () => {
    const KEPT = 'D20261105101500-c3d4';
    const KEPT2 = 'D20261106111500-e5f6';
    const chg = [
        v('Dubrava', 'Doubrava', { sure: true }),
        v('Kolář', 'Kolar', { sure: true, judged: KEPT }),
        v('Marek', 'Hora', { sure: true, judged: KEPT2 }),
        v('N. 4', 'N. 7', { sure: true, judged: 'T0399' }),
    ];
    const { lines, places } = resultPlaces({ text: TEXT, dis: [], disSide: 'at', disKinded: true, data: [], chg });
    const sorted = sortPlaces(places);
    const opts = { isSource: true, shown: 1 as const, kinded: true, focus: '' };
    const sortedOpt = { note: t.cMajNote, person: false, taskLink: true };

    it('not a sure change: its own group (the kept readings in one), not counted in the task\'s places', () => {
        expect(readSourceCat(v('Kolář', 'Kolar', { sure: true, judged: KEPT }))).toBe('judged');
        const g = sortedGroups(sorted);
        expect(g.major.map(p => p.v!.other)).toEqual(['Doubrava']);
        expect(g.judged.map(j => [j.task, j.rows.length])).toEqual([[KEPT, 2], ['T0399', 1]]);
        expect(sortedCounts(sorted)).toEqual({ major: 1, unsure: 0, minor: 0, judged: [{ task: KEPT, n: 2 }, { task: 'T0399', n: 1 }] });
    });

    it('one count everywhere: the first group = the footer\'s places = the header\'s first number; "N already kept" in the header', () => {
        const counts = sortedCounts(sorted);
        const html = checkHtml(sorted, { ...opts, sorted: sortedOpt });
        const group = /data-group="major">\s*<div class="read-check-head">.*?<span class="read-check-count">\((\d+)\)<\/span>/s.exec(html)![1];
        const facts: VerdictFacts = { partial: false, why: '', illegible: 0, source: { compared: true, major: 4, minor: 0, kinded: true, sorted: counts }, disagree: null };
        const verdict = composeVerdict(facts, t, x => x, x => `[${x}]`);
        expect(group).toBe('1');
        expect(/\[(\d+)/.exec(verdict)![1]).toBe(group);
        expect(readTaskFootHtml({ ...BASE, counts })).toContain(t.tAgentN(1));
        expect(verdict).toBe(`${t.vRead} [${t.vMajor(1)}] · ${t.vKept(2)} · ${t.vJudged(1, 'T0399')}`);
    });

    it('the group "Already decided: kept": folded, its sentence, no task link; the task\'s group keeps its link', () => {
        const html = checkHtml(sorted, { ...opts, sorted: sortedOpt });
        const kept = /<div class="read-check-group is-fold" data-group="kept">[\s\S]*?<\/details>\s*<\/div>/.exec(html)![0];
        expect(kept).toContain(`${t.gKept}</span><span class="read-check-count">(2)</span>`);
        expect(kept).toContain(`<p class="read-check-note">${t.cJudNote}</p>`);
        expect(kept).not.toContain('data-task=');
        expect(kept).not.toContain('read-check-task');
        expect(count(html, /data-act="open-task"/g)).toBe(1);
        expect(html).toContain('data-task="T0399"');
        expect(html).not.toContain(KEPT);
    });

    it('the bubble and the text say "Already decided: kept"', () => {
        const c = sorted.find(p => p.v?.judged === KEPT)!;
        expect(placePopHtml([c], 1, false)).toContain(t.bKept);
        expect(placePopHtml([c], 1, false)).not.toContain(KEPT);
        const text = lines.map((l, j) => lineMarksHtml(l, j, sorted, '')).join('\n');
        expect(text).toContain(`(${t.bKept})`);
        expect(text).toContain(`(${t.bJudged('T0399')})`);
    });

    it('footer B: only kept places → their sentence without a link; mixed → the task\'s sentence with its link first', () => {
        const b = { ...BASE, offer: false };
        const only = readTaskFootHtml({ ...b, counts: { major: 0, unsure: 0, minor: 0, judged: [{ task: KEPT, n: 2 }] } });
        expect(only).toContain(t.tAllKept);
        expect(acts(only)).toEqual(['close']);
        const mixed = readTaskFootHtml({ ...b, counts: { major: 0, unsure: 0, minor: 0, judged: [{ task: KEPT, n: 2 }, { task: 'T0399', n: 1 }] } });
        expect(mixed).toContain(t.tAllJudged('T0399'));
        expect(mixed).not.toContain(t.tAllKept);
        expect(acts(mixed)).toEqual(['open-task', 'close']);
    });
});

describe('the research\'s refusals that are answers', () => {
    it('a task already holds the places: that task, to open, the sure changes say it', () => {
        const act = { how: 'queue' as const, append: false, busy: false, reply: { task: 'T0410', chat: '', appended: false, outcome: 'held' as const } };
        const html = readTaskFootHtml({ ...BASE, act });
        expect(html).toContain(t.tDoneAppend('T0410'));
        expect(acts(html)).toEqual(['open-task', 'close']);
        expect(readTaskMajorNote('F', { ...BASE, act })).toBe(t.cMajTask('T0410'));
        // Also after "Save only": the task, not "saved".
        const save = readTaskFootHtml({ ...BASE, act: { ...act, how: 'save' } });
        expect(save).toContain(t.tDoneAppend('T0410'));
        expect(save).not.toContain(t.tDoneSave);
        expect(acts(readTaskFootHtml({ ...BASE, canOpenTask: false, act }))).toEqual(['close']);
    });

    it('nothing left to decide: its sentence, no choice and no retry', () => {
        const act = { how: 'now' as const, append: false, busy: false, reply: { task: '', chat: '', appended: false, outcome: 'settled' as const } };
        const html = readTaskFootHtml({ ...BASE, act });
        expect(html).toContain(t.tSettled);
        expect(html).not.toContain(t.tFail);
        expect(acts(html)).toEqual(['close']);
        expect(readTaskMajorNote('F', { ...BASE, act })).toBe('');
    });
});

describe('uncertain places handed over on the person\'s word (spec 059 P8, read.sourceTask.unsure)', () => {
    // Only uncertain places, no sure change, no task, nothing decided: what the research sends with `unsureOffer`.
    const UNS: ReadTaskFootInput = { ...BASE, offer: false, unsureOffer: true, counts: { major: 0, unsure: 6, minor: 1, judged: [] } };
    const choiceAttrs = (html: string): string[] => [...html.matchAll(/<button type="button" class="read-task-choice" ([^>]*)>/g)].map(m => m[1]);

    it('B with the offer: the sentence, one secondary choice for the agent (the AI badge alone), Close the main action', () => {
        const html = readTaskFootHtml(UNS);
        expect(stateOf(html)).toBe('B');
        // With the choice beside it: no task by itself ("úkol sám nevznikne").
        expect(html).toContain(t.tOnlyUnsure(6, false, true));
        expect(acts(html)).toEqual(['task-queue', 'close']);
        expect(choiceAttrs(html)).toEqual(['data-act="task-queue" data-unsure="true"']);
        expect(html).toContain(`<span class="read-task-ct">${researchBridgeAgentLabel(t.tUnsureQueue)}</span>`);
        expect(html).not.toContain('research-open-mark');
        expect(html).toContain(t.tUnsureQueueSub);
        expect(html).toContain('<button type="button" class="primary" data-act="close">');
        expect(readTaskMajorNote('B', UNS)).toBe('');
    });

    it('a confirmed transcript: "Set aside for review" for a person, no mark, the wording only from the places read', () => {
        const html = readTaskFootHtml({ ...UNS, confirmed: true });
        expect(stateOf(html)).toBe('B');
        expect(acts(html)).toEqual(['task-review', 'close']);
        expect(choiceAttrs(html)).toEqual(['data-act="task-review" data-unsure="true"']);
        expect(html).toContain(`<span class="read-task-ct">${t.tReview}</span>`);
        expect(html).toContain(t.tUnsureReviewSub);
        expect(html).not.toContain('research-ai-badge');
    });

    it('offered by `unsureOffer`, not by what is left: also beside places a task assessed; the setting "never" too', () => {
        const judged = readTaskFootHtml({ ...UNS, counts: { major: 0, unsure: 2, minor: 0, judged: [{ task: 'T0399', n: 3 }] } });
        expect(judged).toContain(t.tAllJudged('T0399'));
        expect(acts(judged)).toEqual(['open-task', 'task-queue', 'close']);
        const never = readTaskFootHtml({ ...UNS, setting: 'never' });
        expect(stateOf(never)).toBe('D');
        expect(acts(never)).toEqual(['open-settings', 'task-queue', 'close']);
        expect(readTaskFootState({ ...UNS, setting: 'always' })).toBe('B');
    });

    it('without the offer (or the feature: the caller passes none), on a phone, or with a task or a decision: nothing new', () => {
        const without = readTaskFootHtml({ ...UNS, unsureOffer: false });
        expect(acts(without)).toEqual(['close']);
        expect(without).not.toContain('data-unsure');
        expect(acts(readTaskFootHtml({ ...UNS, unsureOffer: undefined, counts: { major: 0, unsure: 0, minor: 2, judged: [] } }))).toEqual(['close']);
        expect(acts(readTaskFootHtml({ ...UNS, computer: false }))).toEqual(['close']);
        expect(readTaskFootHtml({ ...UNS, task: 'T0400' })).not.toContain('data-unsure');
        expect(readTaskFootHtml({ ...UNS, decided: 'saved' })).not.toContain('data-unsure');
        // A sure change offered: the choices of A, never the uncertain places alone.
        expect(stateOf(readTaskFootHtml({ ...BASE, unsureOffer: true }))).toBe('A');
        expect(readTaskFootHtml({ ...BASE, unsureOffer: true })).not.toContain('data-unsure');
    });

    it('on its way: the choice busy, Close still there; the other choices of A never shown', () => {
        const busy = readTaskFootHtml({ ...UNS, act: { how: 'queue', append: false, unsure: true, busy: true } });
        expect(stateOf(busy)).toBe('F');
        expect(count(busy, /aria-busy="true"/g)).toBe(1);
        expect(busy).toContain(t.tBusy);
        expect(busy).toContain(t.tOnlyUnsure(6, false, true));
        expect(acts(busy)).toEqual(['task-queue', 'close']);
        // A busy choice of A is not this one.
        const ofA = readTaskFootHtml({ ...UNS, act: { how: 'queue', append: false, busy: true } });
        expect(ofA).not.toContain(t.tOnlyUnsure(6, false, true));
        expect(ofA).not.toContain(t.tOnlyUnsure(6));
    });

    it('done: a task for the agent in the queue, or the places added to the open task; the task to open', () => {
        const done = readTaskFootHtml({ ...UNS, act: { how: 'queue', append: false, unsure: true, busy: false, reply: { task: 'T0412', chat: '', appended: false } } });
        expect(done).toContain(t.tDoneQueue('T0412'));
        expect(acts(done)).toEqual(['open-task', 'close']);
        const appended = readTaskFootHtml({ ...UNS, openTask: 'T0399', act: { how: 'queue', append: false, unsure: true, busy: false, reply: { task: 'T0399', chat: '', appended: true } } });
        expect(appended).toContain(t.tDoneAppend('T0399'));
        // `appended` without the task in the answer: the source's open task.
        expect(readTaskFootHtml({ ...UNS, openTask: 'T0399', act: { how: 'queue', append: false, unsure: true, busy: false, reply: { task: '', chat: '', appended: true } } }))
            .toContain(t.tDoneAppend('T0399'));
        const review = readTaskFootHtml({ ...UNS, confirmed: true, act: { how: 'review', append: false, unsure: true, busy: false, reply: { task: 'T0413', chat: '', appended: false } } });
        expect(review).toContain(t.tDoneReview('T0413'));
        expect(readTaskMajorNote('F', { ...UNS, act: { how: 'queue', append: false, unsure: true, busy: false, reply: { task: 'T0412', chat: '', appended: false } } })).toBe('');
    });

    it('"no task is created" says "by itself" only with the choice beside it (B and D)', () => {
        const offered = readTaskFootHtml(UNS);
        const without = readTaskFootHtml({ ...UNS, unsureOffer: false });
        expect(offered).toContain(t.tOnlyUnsure(6, false, true));
        expect(without).toContain(t.tOnlyUnsure(6));
        expect(without).not.toContain(t.tOnlyUnsure(6, false, true));
        expect(t.tOnlyUnsure(6, false, true)).toMatch(/no task is created by itself\.$/);
        expect(t.tOnlyUnsure(6)).toMatch(/no task is created\.$/);
        const never = readTaskFootHtml({ ...UNS, setting: 'never' });
        expect(never).toContain(t.tNeverSelf);
        expect(never).not.toContain(t.tNever);
        const neverWithout = readTaskFootHtml({ ...UNS, setting: 'never', unsureOffer: false });
        expect(neverWithout).toContain(t.tNever);
        expect(neverWithout).not.toContain(t.tNeverSelf);
        // The same in every language: the cs words of the design ("úkol sám nevznikne").
        const cs = getStringsForLang('cs').read;
        expect(cs.tOnlyUnsure(6, false, true)).toMatch(/úkol sám nevznikne\.$/);
        expect(cs.tOnlyUnsure(6)).toMatch(/: úkol nevznikne\.$/);
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const l = getStringsForLang(lang).read;
            expect(l.tOnlyUnsure(6, false, true)).not.toBe(l.tOnlyUnsure(6));
            expect(l.tNeverSelf).not.toBe(l.tNever);
        }
    });

    it('one reader: the reader was not sure, never "the readers disagree"; two readers as before', () => {
        const one = readTaskFootHtml({ ...UNS, oneReader: true });
        expect(one).toContain(t.tOnlyUnsure(6, true, true));
        expect(one).toContain('The reader was not sure at 6 places.');
        expect(one).not.toContain('readers disagree');
        expect(readTaskFootHtml({ ...UNS, oneReader: true, unsureOffer: false })).toContain(t.tOnlyUnsure(6, true));
        expect(readTaskFootHtml({ ...UNS, oneReader: false })).toContain('The readers disagree at 6 places.');
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const l = getStringsForLang(lang).read;
            expect(l.tOnlyUnsure(6, true)).not.toBe(l.tOnlyUnsure(6));
            expect(l.gUnsure1).not.toBe(l.gUnsure);
        }
        expect(getStringsForLang('cs').read.tOnlyUnsure(6, true)).toMatch(/^Čtenář si nebyl jistý na 6 místech\./);
    });

    it('failed: a retry that repeats the same choice (unsure, its mark)', () => {
        const failed = readTaskFootHtml({ ...UNS, act: { how: 'queue', append: false, unsure: true, busy: false, failed: true } });
        expect(failed).toContain(t.tFail);
        expect(failed).toContain(`data-act="task-retry" data-how="queue" data-unsure="true">${researchBridgeAgentLabel(t.tRetry)}`);
        expect(readTaskFootHtml({ ...UNS, act: { how: 'queue', append: false, busy: false, failed: true } })).not.toContain('data-unsure');
    });

    it('the research\'s answers: sure changes came meanwhile, nothing to propose, a wording turned down, nothing left', () => {
        const reply = (outcome: 'sure' | 'noproposal' | 'declined' | 'settled') =>
            readTaskFootHtml({ ...UNS, confirmed: true, act: { how: 'review', append: false, unsure: true, busy: false, reply: { task: '', chat: '', appended: false, outcome } } });
        for (const [outcome, text] of [['sure', t.tUnsureSure], ['noproposal', t.tNoProposal], ['declined', t.tDeclined], ['settled', t.tSettled]] as const) {
            const html = reply(outcome);
            expect(html).toContain(text);
            expect(html).not.toContain(t.tFail);
            expect(acts(html)).toEqual(['close']);
        }
    });

    it('what is still offered: the choices of A, the uncertain places alone, or nothing', () => {
        expect(readTaskOffers(BASE)).toBe('choices');
        expect(readTaskOffers(UNS)).toBe('unsure');
        expect(readTaskOffers({ ...UNS, unsureOffer: false })).toBeNull();
        expect(readTaskOffers({ ...UNS, act: { how: 'queue', append: false, unsure: true, busy: false, failed: true } })).toBe('unsure');
    });
});

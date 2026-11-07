/**
 * A source read again, sorted, and the footer that says who creates the task (spec 059 §5 and §1,
 * `read.sourceTask`): each change's group and its priority, one count of the sure changes everywhere (the first
 * group, the task's places, the header's first number), a group without places left out of the header, the
 * footer's states; without the research's fields everything as before. Invented data only (Vlk, Doubrava, Hora).
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { resultPlaces, sortPlaces, sortedGroups, sortedCounts, checkHtml, lineMarksHtml, placePopHtml, type ShownPlace } from '../ui/read-result-view.js';
import { readTaskFootHtml, readTaskFootState, readTaskMajorNote, type ReadTaskFootInput } from '../ui/read-task-view.js';
import { composeVerdict, mergeAdjacent, readSourceCat, readSourceSort, readSourceSaysSure, type MergedVariant, type VerdictFacts } from '../read-result.js';
import { researchLinkMark } from '../research-link.js';
import { researchActionLabel, researchBridgeAgentLabel } from '../ui/research-open-mark.js';
import { strings } from '../strings.js';

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

    it('B: no sure change, before the setting "always" and a task made; its sentence by what is left', () => {
        const b = { ...BASE, offer: false };
        expect(readTaskFootState({ ...b, setting: 'always', task: 'T0400' })).toBe('B');
        expect(readTaskFootState({ ...b, task: 'T0400' })).toBe('B');
        expect(readTaskFootHtml({ ...b, counts: { major: 0, unsure: 0, minor: 2, judged: [{ task: 'T0399', n: 2 }] } })).toContain(t.tAllJudged('T0399'));
        expect(readTaskFootHtml({ ...b, counts: { major: 0, unsure: 2, minor: 1, judged: [] } })).toContain(t.tOnlyUnsure(2));
        const minor = readTaskFootHtml({ ...b, counts: { major: 0, unsure: 0, minor: 2, judged: [] } });
        expect(minor).toContain(t.tOnlyMinor);
        expect(acts(minor)).toEqual(['close']);
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

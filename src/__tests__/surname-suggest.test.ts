/**
 * Spellings suggested by the research (spec 021 K2.1–K2.6, ZADANI_DEV §4):
 * the reply of `GET /surnames` read defensively, which suggestions the app
 * offers against the tree's groups and rejections, how many people one newly
 * links, the reasons as text, the bridge call (an older research, a busy
 * one) and accepting with its Undo. Fictional data only (the Lhoták family).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import {
    parseSurnamesReply, visibleSuggestions, suggestionGroup, isRejected, isDiacriticsOnly, newlyLinked, peopleWithForm,
    reasonText, decidedInResearch, type SurnameSuggestion,
} from '../surname-suggest.js';
import { fetchSurnameSuggestions, retryAfterMs, sanitizeSurnamesBridgeRecord } from '../surname-suggest-bridge.js';
import { StromData, Person, PersonId, TreeId } from '../types.js';

const TREE = 'surname-suggest-tree' as TreeId;

function person(id: string, firstName: string, lastName: string, gender: 'male' | 'female' = 'male'): Person {
    return {
        id: id as PersonId, firstName, lastName, gender,
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
    };
}

/** Lhoták ×3 (one written Lhotak), a Lhotáková, Lhottak ×2, Lhotack ×1, Lhotka ×2, Lhottka ×1. */
function lhotakTree(): StromData {
    const list = [
        person('p1', 'Jan', 'Lhoták'), person('p2', 'Josef', 'Lhoták'), person('p3', 'Václav', 'Lhotak'),
        person('p4', 'Marie', 'Lhotáková', 'female'),
        person('p5', 'Karel', 'Lhottak'), person('p6', 'Anna', 'Lhottak', 'female'),
        person('p7', 'Matěj', 'Lhotack'),
        person('p8', 'Jiří', 'Lhotka'), person('p9', 'Petr', 'Lhotka'), person('p10', 'Tomáš', 'Lhottka'),
    ];
    return { persons: Object.fromEntries(list.map(p => [p.id, p])), partnerships: {} };
}

const REPLY = {
    rev: 'e331685-3f9a',
    groups: [{ id: 'lhotak|lhottak', forms: ['Lhoták', 'Lhottak'], at: '2026-10-28T12:00:00Z', by: 'research' }],
    rejected: [{ id: 'lhota|lhotak', forms: ['Lhoták', 'Lhota'], at: '2026-10-28T12:05:00Z', by: 'app' }],
    suggestions: [
        {
            id: 'lhotack|lhotak|lhottak', forms: ['Lhoták', 'Lhottak', 'Lhotack'], level: 'documented',
            extends: ['Lhoták', 'Lhottak'], rule: 'same-person', keys: ['ck-k'], persons: 41,
            places: ['Lhota', 'Lhotka'], from: 1780, to: 1881,
            evidence: [{ person: 'P0012', name: 'Jan Lhoták', form: 'Lhotack', citation: 'Matrika narozených Lhota 1810–1830, s. 45', source: 'S0004', quote: 'Joannes Lhotack' }],
            evidenceMore: 3,
        },
        { id: 'lhotka|lhottka', forms: ['Lhotka', 'Lhottka'], level: 'rules', rule: 'spelling', keys: ['double'], persons: 18, places: ['Lhotka'], from: 1790, to: 1860 },
    ],
    state: { truncated: false, persons: 835, skipped: 0 },
};

describe('the reply of GET /surnames', () => {
    it('is read as the research sends it', () => {
        const r = parseSurnamesReply(REPLY)!;
        expect(r.rev).toBe('e331685-3f9a');
        expect(r.groups).toEqual([{ id: 'lhotak|lhottak', forms: ['Lhoták', 'Lhottak'], at: '2026-10-28T12:00:00Z', by: 'research' }]);
        expect(r.suggestions).toHaveLength(2);
        expect(r.suggestions[0]).toMatchObject({ level: 'documented', extends: ['Lhoták', 'Lhottak'], keys: ['ck-k'], evidenceMore: 3 });
        expect(r.suggestions[0].evidence[0]).toEqual({ person: 'P0012', name: 'Jan Lhoták', form: 'Lhotack',
            citation: 'Matrika narozených Lhota 1810–1830, s. 45', source: 'S0004', quote: 'Joannes Lhotack' });
        expect(r.suggestions[1].evidence).toEqual([]);
        expect(r.truncated).toBe(false);
    });

    it('is read defensively: not a reply, a suggestion without id, level or two forms, a repeated id', () => {
        expect(parseSurnamesReply(null)).toBeNull();
        expect(parseSurnamesReply({ rev: 'x' })).toBeNull();
        const r = parseSurnamesReply({ suggestions: [
            { forms: ['A', 'B'], level: 'rules' },
            { id: 'x', forms: ['A'], level: 'rules' },
            { id: 'y', forms: ['A', 'a'], level: 'rules' },
            { id: 'z', forms: ['A', 'B'], level: 'maybe' },
            { id: 'ok', forms: ['Lhotka', 'Lhottka', 7], level: 'rules', keys: ['double', 'Bad Key'], from: 1900, to: 1800,
                evidence: [{ name: 'X', form: 'Y' }] },
            { id: 'ok', forms: ['C', 'D'], level: 'rules' },
        ] })!;
        expect(r.suggestions.map(s => s.id)).toEqual(['ok']);
        expect(r.suggestions[0]).toMatchObject({ forms: ['Lhotka', 'Lhottka'], keys: ['double'], from: 1900, evidence: [] });
        expect(r.suggestions[0].to).toBeUndefined();
        expect(r.groups).toEqual([]);
    });
});

describe('which suggestions the app offers', () => {
    const reply = parseSurnamesReply(REPLY)!;

    it('the tree has no group: both levels, a documented one a new group there', () => {
        const shown = visibleSuggestions(reply, lhotakTree());
        expect(shown.documented.map(s => s.suggestion.id)).toEqual(['lhotack|lhotak|lhottak']);
        expect(shown.documented[0].extendsGroup).toBeNull();
        expect(shown.rules.map(s => s.suggestion.id)).toEqual(['lhotka|lhottka']);
    });

    it('it extends the one group of the tree it touches', () => {
        const data = { ...lhotakTree(), surnameVariants: [['Lhoták', 'Lhottak']] };
        expect(visibleSuggestions(reply, data).documented[0].extendsGroup).toEqual(['Lhoták', 'Lhottak']);
    });

    it('never offers one whose forms are all in one group, nor one that would join two groups', () => {
        expect(suggestionGroup(['Lhotka', 'Lhottka'], [['Lhottka', 'Lhotka', 'Lhoteka']])).toBe('inside');
        expect(suggestionGroup(['Lhoták', 'Lhotka'], [['Lhoták', 'Lhottak'], ['Lhotka', 'Lhottka']])).toBe('two');
        const data = { ...lhotakTree(), surnameVariants: [['Lhotka', 'Lhottka'], ['Lhoták', 'Lhotack'], ['Lhottak', 'Lhotak2']] };
        const shown = visibleSuggestions(reply, data);
        expect(shown.documented).toEqual([]);
        expect(shown.rules).toEqual([]);
    });

    it('a rejected suggestion is not offered again: by its id or its forms, the tree\'s or the research\'s rejection', () => {
        const byId = { ...lhotakTree(), surnameRejections: [{ forms: ['X', 'Y'], id: 'lhotka|lhottka' }] };
        expect(visibleSuggestions(reply, byId).rules).toEqual([]);
        const byForms = { ...lhotakTree(), surnameRejections: [{ forms: ['LHOTTKA', 'lhotka'] }] };
        expect(visibleSuggestions(reply, byForms).rules).toEqual([]);
        const s = reply.suggestions[1];
        expect(isRejected(s, undefined, [{ forms: ['Lhottka', 'Lhotka'], by: 'research' }])).toBe(true);
        expect(isRejected(s, undefined, [])).toBe(false);
    });

    it('a diacritics-only suggestion is recognised', () => {
        expect(isDiacriticsOnly(['Lhoták', 'Lhotak'])).toBe(true);
        expect(isDiacriticsOnly(['Lhoták', 'Lhottak'])).toBe(false);
        expect(isDiacriticsOnly(['Lhoták'])).toBe(false);
    });

    it('the research\'s decisions are recognised by their forms', () => {
        expect(decidedInResearch(['Lhottak', 'Lhoták'], reply.groups)).toBe(true);
        expect(decidedInResearch(['Lhota', 'Lhoták'], reply.rejected)).toBe(false);
    });
});

describe('how many people a suggestion newly links', () => {
    it('a new group: the form most people carry is the main one; a woman\'s form counts with the man\'s', () => {
        const data = lhotakTree();
        // Lhoták: Jan, Josef, Václav (Lhotak: the same in search) and Marie Lhotáková.
        expect(newlyLinked(['Lhoták', 'Lhottak', 'Lhotack'], null, data)).toEqual({ n: 3, m: 4, main: 'Lhoták' });
    });

    it('an extended group: m is the whole group, n only the new form\'s people', () => {
        const data = { ...lhotakTree(), surnameVariants: [['Lhoták', 'Lhottak']] };
        expect(newlyLinked(['Lhoták', 'Lhottak', 'Lhotack'], ['Lhoták', 'Lhottak'], data)).toEqual({ n: 1, m: 6, main: 'Lhoták' });
    });

    it('a diacritics-only suggestion links nobody new (search already finds both)', () => {
        expect(newlyLinked(['Lhoták', 'Lhotak'], null, lhotakTree()).n).toBe(0);
    });

    it('each form counts its own people, diacritics apart', () => {
        const data = lhotakTree();
        expect(peopleWithForm('Lhoták', data)).toBe(3); // Jan, Josef and Marie Lhotáková
        expect(peopleWithForm('Lhotak', data)).toBe(1);
        expect(peopleWithForm('Lhotteck', data)).toBe(0);
    });
});

describe('the reason as text', () => {
    const t = { samePerson: 'the same person', spelling: (k: string) => `different spelling: ${k}`, double: 'doubled letter', diacritics: 'only the diacritics differ' };
    const base: Pick<SurnameSuggestion, 'rule' | 'keys' | 'text' | 'places' | 'from' | 'to'> = { keys: [], places: [] };

    it('follows the templates', () => {
        expect(reasonText({ ...base, rule: 'same-person', keys: ['ck-k'] }, t)).toBe('the same person');
        expect(reasonText({ ...base, rule: 'phonetic', keys: ['w-v', 'y-i'], places: ['Lhotka'], from: 1790, to: 1860 }, t)).toBe('w ↔ v, y ↔ i · Lhotka 1790–1860');
        expect(reasonText({ ...base, rule: 'spelling', keys: ['double', 'sch-s'] }, t)).toBe('different spelling: doubled letter, sch ↔ š');
        expect(reasonText({ ...base, rule: 'spelling', keys: ['diacritics'] }, t)).toBe('only the diacritics differ');
    });

    it('an unknown rule or key: the research\'s own text', () => {
        expect(reasonText({ ...base, rule: 'spelling', keys: ['zz-z'], text: 'z for zz' }, t)).toBe('z for zz');
        expect(reasonText({ ...base, rule: 'judged', keys: [], text: 'assessed' }, t)).toBe('assessed');
        expect(reasonText({ ...base, rule: 'odd', keys: [] }, t)).toBe('');
    });
});

describe('the bridge: GET /surnames', () => {
    afterEach(() => vi.unstubAllGlobals());

    const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
        status, text: async () => JSON.stringify(body), headers: { get: (k: string) => headers[k] ?? null },
    });

    it('a reply is read', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => answer(200, REPLY)));
        const r = await fetchSurnameSuggestions('http://127.0.0.1:1/t');
        expect(r.ok && r.reply.suggestions.length).toBe(2);
    });

    it('an older research (no /surnames): missing, so the section goes', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => answer(404, { error: 'not found' })));
        expect(await fetchSurnameSuggestions('http://127.0.0.1:1/t')).toEqual({ ok: false, code: 'missing' });
    });

    it('a busy research is asked once more after its Retry-After, then it is an error', async () => {
        const fetch = vi.fn(async () => answer(503, { code: 'research.busy', error: 'Busy.' }, { 'Retry-After': '2' }));
        vi.stubGlobal('fetch', fetch);
        const waits: number[] = [];
        const r = await fetchSurnameSuggestions('http://127.0.0.1:1/t', { wait: async ms => { waits.push(ms); } });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(waits).toEqual([2000]);
        expect(r).toEqual({ ok: false, code: 'error', text: 'Busy.' });

        const second = vi.fn()
            .mockResolvedValueOnce(answer(503, { code: 'research.busy' }))
            .mockResolvedValueOnce(answer(200, REPLY));
        vi.stubGlobal('fetch', second);
        expect((await fetchSurnameSuggestions('http://127.0.0.1:1/t', { wait: async () => {} })).ok).toBe(true);
    });

    it('an error shows the research\'s own sentence (`text`) over its short `error`', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => answer(500, { error: 'busy', code: 'surnames.failed', text: 'The research could not compare the entries.' })));
        expect(await fetchSurnameSuggestions('http://127.0.0.1:1/t'))
            .toEqual({ ok: false, code: 'error', text: 'The research could not compare the entries.' });
    });

    it('no answer is an error; Retry-After stays within bounds', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
        expect(await fetchSurnameSuggestions('http://127.0.0.1:1/t')).toEqual({ ok: false, code: 'error' });
        expect(retryAfterMs(null)).toBe(1000);
        expect(retryAfterMs('600')).toBe(10_000);
        expect(retryAfterMs('soon')).toBe(1000);
    });

    it('the device record keeps the features and the last reply', () => {
        const rec = sanitizeSurnamesBridgeRecord({ suggest: true, read: 1, reply: { ...parseSurnamesReply(REPLY)!, truncated: true }, at: '2026-10-28T12:00:00Z' });
        expect(rec.suggest).toBe(true);
        expect(rec.read).toBe(false);
        expect(rec.reply?.suggestions).toHaveLength(2);
        expect(rec.reply?.truncated).toBe(true);
        expect(sanitizeSurnamesBridgeRecord('junk')).toEqual({ suggest: false, read: false });
    });
});

describe('DataManager: accepting suggestions and their Undo', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = { ...lhotakTree(), surnameVariants: [['Lhoták', 'Lhottak']] };
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('extends a group and adds a new one in one undo step; the Undo takes out only what was added', () => {
        const added = DataManager.acceptSurnameGroups([['Lhoták', 'Lhottak', 'Lhotack'], ['Lhotka', 'Lhottka']]);
        expect(added).toEqual([['Lhotack'], ['Lhotka', 'Lhottka']]);
        expect(DataManager.getData().surnameVariants).toEqual([['Lhotack', 'Lhoták', 'Lhottak'], ['Lhotka', 'Lhottka']]);
        expect(AuditLogManager.log).toHaveBeenCalledWith(TREE, 'surname.accept', expect.stringContaining('Lhotack'));

        expect(DataManager.removeSurnameForms(added!.flat())).toBe(true);
        expect(DataManager.getData().surnameVariants).toEqual([['Lhoták', 'Lhottak']]);
        expect(DataManager.removeSurnameForms(['Lhotack'])).toBe(false);

        // The tree's undo brings the accept back.
        DataManager.undo();
        expect(DataManager.getData().surnameVariants).toHaveLength(2);
        DataManager.undo();
        expect(DataManager.getData().surnameVariants).toEqual([['Lhoták', 'Lhottak']]);
    });

    it('extending a diacritics-only group keeps both its forms; the Undo leaves the group as it was', () => {
        const dm = DataManager as unknown as { data: StromData };
        dm.data = { ...dm.data, surnameVariants: [['Lhoták', 'Lhotak']] };
        const added = DataManager.acceptSurnameGroups([['Lhoták', 'Lhottak']]);
        expect(added).toEqual([['Lhottak']]);
        expect(DataManager.getData().surnameVariants).toEqual([['Lhotak', 'Lhoták', 'Lhottak']]);
        expect(DataManager.removeSurnameForms(added!.flat())).toBe(true);
        expect(DataManager.getData().surnameVariants).toEqual([['Lhotak', 'Lhoták']]);
    });

    it('a diacritics-only group is new with both forms; nothing new is no step', () => {
        expect(DataManager.acceptSurnameGroups([['Lhotka', 'Lhotká']])).toEqual([['Lhotka', 'Lhotká']]);
        expect(DataManager.acceptSurnameGroups([['Lhoták', 'Lhottak']])).toBeNull();
        expect(DataManager.removeSurnameForms(['Lhotka', 'Lhotká'])).toBe(true);
        expect(DataManager.getData().surnameVariants).toEqual([['Lhoták', 'Lhottak']]);
    });
});

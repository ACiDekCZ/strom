/**
 * A place question in the research's waiting list (kind "place", spec 034 §9)
 * and the link that starts the identification of places in the research.
 * Fictional places only.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { researchSchemeUrl, sanitizeWaiting, waitingAnswerPlace, WAITING_GROUPS_FEATURE } from '../research-link.js';
import { getStringsForLang } from '../strings.js';
import { noteResearchWaiting, storedResearchWaiting } from '../research-device.js';
import { waitingSection } from '../research-waiting.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';

const propose = (extra: Record<string, unknown> = {}) => ({
    kind: 'place', id: 'L0012', place: 'L0012', what: 'Kde leží Lhota?', at: '2026-11-01T10:00:00Z',
    forms: ['H. Lhota', 'Horní Lhota', 'H. Lhota'], question: 'propose',
    candidates: [
        { id: 'c1', name: 'Horní Lhota', district: 'Jinov', country: 'CZ', lat: 49.6, lon: 15.2, why: 'Fara Lhotov', source: { title: 'Rejstřík', url: 'https://example.org/r' } },
        { id: 'c2', name: 'Horní Lhota', district: 'Łotów', lat: 50.1, lon: 18.3, source: { title: 'Mapa', url: 'javascript:alert(1)' } },
        { id: 'c4', name: 'Lhotínek', lat: 1, lon: 1 },
        { id: 'c3', name: 'Lhotov', lat: 'x', lon: 1 },
    ],
    ...extra,
});

describe('the waiting item of a place', () => {
    it('keeps the record, the forms and the valid candidates', () => {
        const [w] = sanitizeWaiting([propose()]);
        expect(w).toMatchObject({ id: 'L0012', kind: 'place', place: 'L0012', question: 'propose', forms: ['H. Lhota', 'Horní Lhota'] });
        expect(w.candidates).toEqual([
            { id: 'c1', name: 'Horní Lhota', district: 'Jinov', country: 'CZ', lat: 49.6, lon: 15.2, why: 'Fara Lhotov', source: { title: 'Rejstřík', url: 'https://example.org/r' } },
            { id: 'c2', name: 'Horní Lhota', district: 'Łotów', lat: 50.1, lon: 18.3, source: { title: 'Mapa' } },
        ]);
        expect(waitingSection(w)).toBe('decide');
        // The same with the research's groups.
        expect(sanitizeWaiting([propose()], true)[0].kind).toBe('place');
    });

    it('conflict: the current location and who gave it', () => {
        const [w] = sanitizeWaiting([propose({ question: 'conflict', current: { lat: 49.7, lon: 15.3, label: 'Lhota, Jinov' }, by: 'person' })]);
        expect(w).toMatchObject({ question: 'conflict', current: { lat: 49.7, lon: 15.3, label: 'Lhota, Jinov' }, by: 'person' });
        // Without the current location it is no place question.
        expect(sanitizeWaiting([propose({ question: 'conflict' })])[0].kind).toBeUndefined();
    });

    it('form: the change of the written place', () => {
        const [w] = sanitizeWaiting([propose({
            question: 'form', candidates: undefined,
            change: { from: { place: 'Lhota', house: '12' }, to: { place: 'Horní Lhota', house: '12' }, facts: 3 },
        })]);
        expect(w.change).toEqual({ from: { place: 'Lhota', house: '12' }, to: { place: 'Horní Lhota', house: '12' }, facts: 3 });
        expect(sanitizeWaiting([propose({ question: 'form', change: { from: { place: 'Lhota' }, facts: 1 } })])[0].kind).toBeUndefined();
    });

    it('an invalid one is read as any other item', () => {
        expect(sanitizeWaiting([propose({ place: 'T0012', id: 'T0012' })])[0].kind).toBeUndefined();
        expect(sanitizeWaiting([propose({ question: 'where' })])[0].kind).toBeUndefined();
        expect(sanitizeWaiting([propose({ candidates: [] })])[0].kind).toBeUndefined();
        expect(sanitizeWaiting([propose({ candidates: [] })], true)[0].kind).toBe('other');
    });
});

describe('the remembered list', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps a place question whole, with or without the research\'s groups', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
        const conflict = propose({ id: 'L0020', place: 'L0020', question: 'conflict', current: { lat: 49.7, lon: 15.3, label: 'Lhotov' }, by: 'person' });
        const form = propose({
            id: 'L0030', place: 'L0030', question: 'form', candidates: undefined,
            change: { from: { place: 'Lhota 16' }, to: { place: 'Lhota', house: '16' }, facts: 1 },
        });
        for (const groups of [false, true]) {
            const items = sanitizeWaiting([propose(), conflict, form], groups);
            noteResearchWaiting(TREE, items, groups ? { features: [WAITING_GROUPS_FEATURE] } : {});
            const stored = storedResearchWaiting(TREE)!.items;
            expect(stored.map(w => [w.kind, w.place, w.question])).toEqual([
                ['place', 'L0012', 'propose'], ['place', 'L0020', 'conflict'], ['place', 'L0030', 'form'],
            ]);
            expect(stored[0].candidates).toEqual(items[0].candidates);
            expect(stored[0].forms).toEqual(['H. Lhota', 'Horní Lhota']);
            expect(stored[1]).toMatchObject({ current: { lat: 49.7, lon: 15.3, label: 'Lhotov' }, by: 'person' });
            expect(stored[2].change).toEqual({ from: { place: 'Lhota 16' }, to: { place: 'Lhota', house: '16' }, facts: 1 });
        }
    });
});

describe('the places link', () => {
    it('starts the identification, of all places or of one', () => {
        expect(researchSchemeUrl('places', { tree: TREE, placesDo: 'run' })).toBe(`strom-research://places?tree=${TREE}&do=run`);
        expect(researchSchemeUrl('places', { tree: TREE, placesDo: 'run', place: 'L0012' }))
            .toBe(`strom-research://places?tree=${TREE}&do=run&place=L0012`);
        expect(researchSchemeUrl('places', { tree: TREE })).toBeNull();
        expect(researchSchemeUrl('places', { tree: TREE, placesDo: 'run', place: 'x&y' })).toBeNull();
    });
});

describe('waitingAnswerPlace: the hint under Waiting says where its items are answered', () => {
    it('questions about places are answered here when the bridge lets the app answer them', () => {
        expect(waitingAnswerPlace([{ kind: 'place' }, { kind: 'place' }], true)).toBe('here');
        expect(waitingAnswerPlace([{ kind: 'place' }, {}], true)).toBe('mixed');
        expect(waitingAnswerPlace([{ kind: 'place' }], false)).toBe('research');
        expect(waitingAnswerPlace([{}, { kind: 'story' }], true)).toBe('research');
    });

    it('never says a place question is answered in the research (cs/en/de/pl)', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const r = getStringsForLang(lang).research;
            expect(r.answerHere).not.toBe(r.answerWhere);
            expect(r.answerMixed).not.toBe(r.answerWhere);
        }
        expect(getStringsForLang('cs').research.answerHere).toBe('Na otázky k místům se odpovídá tady. Strom se po odpovědi aktualizuje sám.');
    });
});

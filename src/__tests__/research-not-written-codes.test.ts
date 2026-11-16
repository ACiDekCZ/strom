/**
 * Changes the research did not take, named by their codes (spec 095 K3.4,
 * `sync.notWritten.codes`): a send's answer and `/status.sends` keep `code`
 * and `params` only from a research that says it sends them; the reason is
 * worded by the code in the app's languages ("not taken" for a code without
 * a text, never "nothing new"); a row says "person · fact · source" with
 * what is known; a send that took nothing and named its changes is "The
 * research did not take N changes" — also when its record comes later in
 * `/status`. Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { sanitizeSyncReply, sanitizeLiveStatus, SYNC_NW_CODES_FEATURE } from '../research-link.js';
import { replyNotWritten, sendRecordNotWritten, researchSyncState, ResearchSyncInput } from '../research-sync.js';
import { pairNotWritten, NotWrittenItem, PairedNotWritten } from '../research-changes.js';
import { researchAutoState, patchResearchAutoState } from '../research-device.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import { TreeManager } from '../tree-manager.js';
import type { ResearchLink, StromData, TreeId } from '../types.js';

const CODES = [SYNC_NW_CODES_FEATURE];

const answer = {
    ok: true, inbox: false, changes: 0, applied: 0, intake: 'R20261115101500123-a1b2',
    notWritten: [
        { kind: 'fact.uncite', why: 'report', code: 'cite.olderApp', params: { person: 'P0003', fact: 'BIRT', event: 'E0012', source: 'S0001' } },
        { kind: 'fact.main', code: 'fact.noMatch', params: { family: 'F0001', fact: 'MARR' } },
        { kind: 'fact.edit', code: 'some.futureCode', params: { person: 'P0003', fact: 'DEAT', bogus: 'x'.repeat(300) } },
    ],
    skipped: [
        { n: 1, kind: 'fact.main', why: 'not cited there', code: 'main.notCarried', params: { person: 'P0003', fact: 'BIRT', source: 'S0002' } },
        { n: 1, kind: 'event.edit', why: 'boom', code: 'event.retracted', params: { person: 'P0004' } },
        { n: 1, kind: 'event.edit', why: 'older research' },
    ],
};

describe('the answer of a send keeps codes only with sync.notWritten.codes', () => {
    it('with the feature: code and params of every item, what it is about from the params', () => {
        const r = sanitizeSyncReply(answer, CODES);
        expect(r.notWritten.map(n => n.code)).toEqual(['cite.olderApp', 'fact.noMatch', 'some.futureCode']);
        expect(r.notWritten[0]).toMatchObject({ person: 'P0003', fact: 'BIRT', source: 'S0001', why: 'report',
            params: { person: 'P0003', fact: 'BIRT', event: 'E0012', source: 'S0001' } });
        expect(r.notWritten[1]).toMatchObject({ person: '', family: 'F0001', fact: 'MARR', why: '' });
        // An unknown key keeps a short text, at most 200 characters.
        expect(r.notWritten[2].params.bogus).toHaveLength(200);
        expect(r.skipped.map(x => x.code)).toEqual(['main.notCarried', 'event.retracted', '']);
        expect(r.skipped[0].params).toEqual({ person: 'P0003', fact: 'BIRT', source: 'S0002' });
    });

    it('without the feature: exactly as before (no code, no params, nothing taken from them)', () => {
        const r = sanitizeSyncReply(answer, ['sync.removed']);
        expect(r.notWritten.map(n => [n.code, n.params])).toEqual([['', {}], ['', {}], ['', {}]]);
        expect(r.notWritten[1]).toMatchObject({ person: '', family: '', fact: '' });
        expect(r.skipped.every(x => x.code === '' && Object.keys(x.params).length === 0)).toBe(true);
        expect(sanitizeSyncReply(answer).notWritten[0].code).toBe('');
    });

    it('a code of today\'s reason gives that reason (person.removed: removed, by the send in params.sync)', () => {
        const r = sanitizeSyncReply({ ok: true, notWritten: [
            { kind: 'person', code: 'person.removed', params: { person: 'P0009', sync: 'I0042' } },
            { kind: 'x', code: 'takenBack', params: { send: 'R20261101-a1' } },
        ] }, CODES);
        expect(r.notWritten[0]).toMatchObject({ why: 'removed', removedBy: 'I0042', person: 'P0009' });
        expect(r.notWritten[1].why).toBe('takenBack');
    });

    it('params of the wrong shape are dropped; a code of the wrong shape is none', () => {
        const r = sanitizeSyncReply({ ok: true, notWritten: [{ code: 'bad code!', params: { person: 'Jan', fact: 'birth', source: 'S1', '9x': 'a' } }] }, CODES);
        expect(r.notWritten[0].code).toBe('');
        expect(r.notWritten[0].params).toEqual({ source: 'S1' });
    });
});

describe('/status.sends carries what a send did not write (V5)', () => {
    const status = (features: string[]) => sanitizeLiveStatus({
        tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'Brambůrkovi' }, features,
        sends: [
            { intake: 'R1', at: '2026-11-15T10:15:00Z', state: 'nothing', changes: 0, tree: 't', sent: 'f1',
                notWritten: answer.notWritten, notWrittenCount: 64, skipped: answer.skipped },
            { intake: 'R2', at: '2026-11-15T10:16:00Z', state: 'pending', changes: 2, tree: 't', sent: 'f2', notWritten: answer.notWritten },
        ],
    });

    it('read with the feature (at most 50, the count of all), only for a written send or one that took nothing', () => {
        const sends = status(CODES)!.sends!;
        expect(sends[0].notWritten?.map(n => n.code)).toEqual(['cite.olderApp', 'fact.noMatch', 'some.futureCode']);
        expect(sends[0].notWrittenCount).toBe(64);
        expect(sends[0].skipped?.map(x => x.code)).toEqual(['main.notCarried', 'event.retracted', '']);
        expect(sends[1].notWritten).toBeUndefined();
        const many = sanitizeLiveStatus({ features: CODES, sends: [{ intake: 'R3', state: 'written', at: '2026-11-15T10:15:00Z',
            notWritten: Array.from({ length: 80 }, () => ({ code: 'gone', params: { person: 'P0003' } })) }] })!.sends![0];
        expect(many.notWritten).toHaveLength(50);
        expect(many.notWrittenCount).toBe(50);
    });

    it('not read without the feature', () => {
        const sends = status([])!.sends!;
        expect(sends[0].notWritten).toBeUndefined();
        expect(sends[0].notWrittenCount).toBeUndefined();
        expect(sends[0].skipped).toBeUndefined();
    });

    it('kept as the state: the listed items, the coded skipped ones, those beyond the list as not named', () => {
        const nw = sendRecordNotWritten(status(CODES)!.sends![0], true)!;
        expect(nw.items.map(i => [i.code, !!i.skipped])).toEqual([
            ['cite.olderApp', false], ['fact.noMatch', false], ['some.futureCode', false], ['main.notCarried', true], ['event.retracted', true]]);
        expect(nw.unexplained).toBe(61);
        expect(sendRecordNotWritten({ intake: 'R9', at: '', state: 'written', changes: 1, tries: null, tree: '', sent: '', decidedAt: '', reason: '',
            conflicts: null, conflictPersons: [] }, true)).toBeNull();
    });
});

describe('what a send\'s answer did not write', () => {
    it('nothing written, the changes named by codes: "not taken" (skipped with a code in the same list)', () => {
        const r = replyNotWritten(sanitizeSyncReply(answer, CODES), { written: true, codes: true, removedOn: true });
        expect(r.notTaken).toBe(true);
        expect(r.count).toBe(5);
        expect(r.items.map(i => i.code)).toEqual(['cite.olderApp', 'fact.noMatch', 'some.futureCode', 'main.notCarried', 'event.retracted']);
        expect(r.items[3]).toMatchObject({ person: 'P0003', fact: 'BIRT', source: 'S0002', skipped: true });
        // The skipped change without a code is told apart, as before.
        expect(r.skippedApart).toBe(1);
    });

    it('nothing to name: "nothing new" as before', () => {
        const r = replyNotWritten(sanitizeSyncReply({ ok: true, inbox: false, changes: 0 }, CODES), { written: true, codes: true, removedOn: false });
        expect(r).toMatchObject({ notTaken: false, count: 0, items: [] });
    });

    it('something written: "Written N, not written M" as before', () => {
        const r = replyNotWritten(sanitizeSyncReply({ ...answer, changes: 5, applied: 2 }, CODES), { written: true, codes: true, removedOn: false });
        expect(r.notTaken).toBe(false);
        expect(r.count).toBe(5);
    });

    it('without the feature exactly as before: the skipped ones apart, never "not taken"', () => {
        const r = replyNotWritten(sanitizeSyncReply(answer), { written: true, codes: false, removedOn: false });
        expect(r.notTaken).toBe(false);
        expect(r.count).toBe(3);
        expect(r.items.every(i => !i.code && !i.params && !i.skipped)).toBe(true);
        expect(r.skippedApart).toBe(3);
    });
});

const person = (id: string, firstName: string, lastName: string, gender: string, refn: string, more: Record<string, unknown> = {}) => ({
    id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], refn, ...more,
});
const data = {
    persons: {
        p1: person('p1', 'Radoslava', 'Brambůrková', 'female', 'P0001'),
        p2: person('p2', 'Zbyhněv', 'Brambůrek', 'male', 'P0002'),
        p3: person('p3', 'Hostivít', 'Brambůrek', 'male', 'P0003', { birthDate: '1851-03-04', events: [{ id: 'e1', type: 'census', date: '1880' }] }),
    },
    partnerships: { u1: { id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: ['p3'], status: 'married', startDate: '1849', researchId: 'F0001' } },
    sources: { s1: { id: 's1', title: 'Matrika N 1850–1860', refn: 'S0001' } },
} as unknown as StromData;

describe('the reason and the row of an item with a code', () => {
    let ui: typeof import('../ui/research-changes-ui.js');
    beforeAll(async () => { ui = await import('../ui/research-changes-ui.js'); }, 60000);
    afterEach(() => setLanguage('en'));

    const item = (code: string, more: Partial<NotWrittenItem> = {}): NotWrittenItem => ({ person: '', fact: '', why: '', code, ...more });

    it('every code of the table has its words in four languages, never "nothing new"', () => {
        const codes = ['cite.olderApp', 'cite.sourceRemoved', 'cite.notCarried', 'main.notCarried', 'fact.noMatch', 'gone', 'conflict.open',
            'sentSince', 'confirm.changed', 'relation.unknown', 'surname.kept', 'surname.warning', 'sync.origin', 'person.no-match', 'write.failed',
            'event.retracted', 'note.shorter'];
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            const s = getStringsForLang(lang).sync;
            for (const code of codes) {
                const said = ui.nwReason(item(code));
                expect(said, `${lang} ${code}`).toBe(s.nw[code]);
                expect(said.length).toBeGreaterThan(5);
                expect(said).not.toBe(s.nothingTakenToast);
            }
        }
        setLanguage('cs');
        expect(ui.nwReason(item('cite.olderApp'))).toBe('citace ve výzkumu zůstává: tato verze aplikace odebrání ještě neposílá');
        expect(ui.nwReason(item('main.notCarried'))).toBe('hlavní citace nenastavena: výzkum tuto citaci nepřevzal');
    });

    it('note.shorter (a shorter note of a godparent or witness, research 1.35): its own reason in four languages, never "not taken"', () => {
        const want = {
            en: 'shorter detail of a godparent or witness not taken: the research asks in Awaiting action whether to take it',
            cs: 'kratší bližší určení kmotra či svědka nepřevzato: výzkum se v Čeká na vyřízení ptá, zda ho vzít',
            de: 'kürzeres Detail eines Paten oder Zeugen nicht übernommen: die Forschung fragt unter „Wartet auf Bearbeitung“, ob es übernommen wird',
            pl: 'krótsze bliższe określenie chrzestnego lub świadka nieprzyjęte: badanie pyta w „Czeka na załatwienie”, czy je przyjąć',
        } as const;
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            const s = getStringsForLang(lang).sync;
            // As the research sends it (a fact.part.note change reported): why report, the code.
            const said = ui.nwReason(item('note.shorter', { why: 'report', person: 'P0003', fact: 'BAPM' }));
            expect(said, lang).toBe(want[lang]);
            expect(said).not.toBe(s.nwUnknown);
            expect(said).not.toBe(s.notWrittenReport);
        }
    });

    it('codes with today\'s reason say today\'s; an unknown code "not taken"; a skipped one with an unknown code a failed write', () => {
        const s = getStringsForLang('en').sync;
        expect(ui.nwReason(item('kept'))).toBe(s.notWrittenKept);
        expect(ui.nwReason(item('kept'), true)).toBe(s.notWrittenKeptUndone);
        expect(ui.nwReason(item('pick'))).toBe(s.notWrittenPick);
        expect(ui.nwReason(item('report'))).toBe(s.notWrittenReport);
        expect(ui.nwReason(item('person.removed'))).toBe(s.notWrittenRemoved);
        expect(ui.nwReason(item('some.futureCode'))).toBe('not taken');
        expect(ui.nwReason(item('record.none', { skipped: true }))).toBe('writing in the research failed');
        expect(ui.nwReason(item('constructor'))).toBe('not taken');
        // No code: by the research's word, as before.
        expect(ui.nwReason({ person: 'P0003', fact: 'BIRT', why: 'pick' })).toBe(s.notWrittenPick);
        expect(ui.nwReason({ person: 'P0003', fact: 'BIRT', why: '' })).toBe(getStringsForLang('en').changes.noReason);
        for (const [lang, word] of [['cs', 'nepřevzato'], ['de', 'nicht übernommen'], ['pl', 'nieprzyjęte']] as const) {
            setLanguage(lang);
            expect(ui.nwReason(item('some.futureCode'))).toBe(word);
        }
    });

    const coded = (items: NotWrittenItem[]) => pairNotWritten(items, data).rows as Extract<PairedNotWritten, { type: 'coded' }>[];

    it('person · fact (with its year) · source, each when known', () => {
        const [full, couple, onlyFact, onlySource, census, gone] = coded([
            item('cite.olderApp', { person: 'P0003', fact: 'BIRT', source: 'S0001' }),
            item('fact.noMatch', { person: '', family: 'F0001', fact: 'MARR' }),
            item('some.futureCode', { fact: 'DEAT' }),
            item('cite.sourceRemoved', { source: 'S0001' }),
            item('gone', { person: 'P0003', fact: 'CENS', source: 'S0404' }),
            item('gone', { person: 'P0777', fact: 'BIRT', name: 'Hostivít Brambůrek starší' }),
        ]);
        expect(ui.nwRowParts(full, data)).toEqual({ who: { name: 'Hostivít Brambůrek', personId: 'p3' }, fact: 'Birth 1851', source: { id: 's1', title: 'Matrika N 1850–1860' } });
        // A couple by the research's family: the man first.
        expect(ui.nwRowParts(couple, data)).toEqual({ who: { name: 'Zbyhněv Brambůrek and Radoslava Brambůrková', personId: 'p2' }, fact: 'Marriage 1849', source: null });
        expect(ui.nwRowParts(onlyFact, data)).toEqual({ who: null, fact: 'Death', source: null });
        expect(ui.nwRowParts(onlySource, data)).toEqual({ who: null, fact: '', source: { id: 's1', title: 'Matrika N 1850–1860' } });
        // A source the tree does not have is left out; an event of the person gives its year.
        expect(ui.nwRowParts(census, data)).toEqual({ who: { name: 'Hostivít Brambůrek', personId: 'p3' }, fact: 'Census 1880', source: null });
        // A person the tree does not have: the research's name, nothing to open.
        expect(ui.nwRowParts(gone, data).who).toEqual({ name: 'Hostivít Brambůrek starší', personId: null });
    });

    it('a marriage and a divorce are named as the other facts are, by the event\'s name, not its in-a-sentence form', () => {
        const [marr, div] = coded([
            item('fact.noMatch', { person: '', family: 'F0001', fact: 'MARR' }),
            item('fact.noMatch', { person: '', family: 'F0001', fact: 'DIV' }),
        ]);
        const want = { en: ['Marriage 1849', 'Divorce'], cs: ['Sňatek 1849', 'Rozvod'], de: ['Heirat 1849', 'Scheidung'], pl: ['Ślub 1849', 'Rozwód'] } as const;
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            expect([ui.nwRowParts(marr, data).fact, ui.nwRowParts(div, data).fact], lang).toEqual(want[lang]);
        }
    });

    it('never counted as not named: each item a row of its own', () => {
        const paired = pairNotWritten([item('fact.noMatch', { family: 'F0404' }), item('x.y')], data);
        expect(paired.unnamed).toBe(0);
        expect(paired.rows.map(r => r.type)).toEqual(['coded', 'coded']);
    });
});

describe('"The research did not take N changes" in four languages', () => {
    it('one, a few, many', () => {
        const t = (lang: 'en' | 'cs' | 'de' | 'pl', n: number) => [getStringsForLang(lang).sync.notTakenToast(n), getStringsForLang(lang).sync.notTakenTitle(n)];
        expect(t('cs', 1)).toEqual(['Výzkum nepřevzal 1 změnu. Zůstává tady v aplikaci.', 'Výzkum nepřevzal 1 změnu']);
        expect(t('cs', 3)).toEqual(['Výzkum nepřevzal 3 změny. Zůstávají tady v aplikaci.', 'Výzkum nepřevzal 3 změny']);
        expect(t('cs', 5)[1]).toBe('Výzkum nepřevzal 5 změn');
        expect(t('en', 1)).toEqual(['The research did not take 1 change. It stays here in the app.', 'The research did not take 1 change']);
        expect(t('en', 3)[0]).toBe('The research did not take 3 changes. They stay here in the app.');
        expect(t('de', 1)).toEqual(['Die Forschung hat 1 Änderung nicht übernommen. Die Änderung bleibt hier in der App.', '1 Änderung nicht übernommen']);
        expect(t('de', 3)[1]).toBe('3 Änderungen nicht übernommen');
        expect(t('pl', 1)).toEqual(['Badanie nie przyjęło 1 zmiany. Zostaje tu w aplikacji.', 'Badanie nie przyjęło 1 zmiany']);
        expect(t('pl', 3)[0]).toBe('Badanie nie przyjęło 3 zmian. Zostają tu w aplikacji.');
        expect(t('pl', 22)[1]).toBe('Badanie nie przyjęło 22 zmian');
        expect(getStringsForLang('cs').changes.unnamedOne).toBe('Změna');
    });
});

describe('a send settled later from /status keeps what it did not take (R15)', () => {
    const TREE = 'tree_1700000000000_nw01' as TreeId;
    const RID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
    let methods: Record<string, unknown>;
    let store: Map<string, string>;
    let link: ResearchLink;

    beforeAll(async () => {
        ({ researchSyncMethods: methods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> });
    }, 60000);
    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
        link = { id: RID, fingerprint: 'f0', syncedAt: '2026-11-15T08:00:00Z', head: 'h1',
            sent: { fingerprint: 'f1', at: '2026-11-15T10:15:00Z', changes: 3, head: 'h1', intake: 'R1', state: 'pending' } } as ResearchLink;
        vi.spyOn(TreeManager, 'getTreeMetadata').mockImplementation(() => ({ research: link }) as never);
        vi.spyOn(TreeManager, 'patchResearchLink').mockImplementation((_id, patch) => { link = { ...link, ...patch } as ResearchLink; return true as never; });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const ui = () => ({ ...methods, refreshResearchSyncUi: () => undefined, researchNoteWritten: () => undefined, researchNoteTookNothing: () => undefined,
        showToast: vi.fn() }) as unknown as { settleResearchSend(t: TreeId, s: unknown): Promise<void>; showToast: ReturnType<typeof vi.fn> };
    const status = (features: string[]) => sanitizeLiveStatus({
        tree: { id: RID, name: 'Brambůrkovi' }, head: 'h1', features,
        sends: [{ intake: 'R1', at: '2026-11-15T10:15:00Z', state: 'nothing', changes: 0, tree: TREE, sent: 'f1', decidedAt: '2026-11-15T10:16:00Z',
            notWritten: answer.notWritten.slice(0, 2), notWrittenCount: 3, skipped: answer.skipped.slice(0, 1) }],
    });

    it('the items go into the state, the block says "The research did not take 4 changes", no toast', async () => {
        const u = ui();
        await u.settleResearchSend(TREE, status(CODES));
        const nw = researchAutoState(TREE).notWritten!;
        expect(nw).toMatchObject({ fingerprint: 'f1', written: 0, unexplained: 1, codes: true });
        expect(nw.items.map(i => i.code)).toEqual(['cite.olderApp', 'fact.noMatch', 'main.notCarried']);
        expect(u.showToast).not.toHaveBeenCalled();
        const input = { link, capable: true, shown: true, matchesBase: true, current: 'f1', bridgeUp: true, remoteHead: 'h1', notWritten: true } as ResearchSyncInput;
        expect(researchSyncState(input).kind).toBe('notWritten');
    });

    it('a research without the feature: nothing kept, as before', async () => {
        await ui().settleResearchSend(TREE, status([]));
        expect(researchAutoState(TREE).notWritten).toBeUndefined();
        patchResearchAutoState(TREE, {});
    });
});

describe('a fact the research has since withdrawn (event.retracted)', () => {
    let ui: typeof import('../ui/research-changes-ui.js');
    beforeAll(async () => { ui = await import('../ui/research-changes-ui.js'); }, 60000);
    afterEach(() => setLanguage('en'));

    const withdrawn = {
        ok: true, inbox: false, changes: 0, applied: 0, intake: 'R20261115131500123-c3d4',
        notWritten: [
            { kind: 'fact.uncite', why: 'report', code: 'event.retracted', person: 'P0003', fact: 'BIRT', source: 'S0001',
                params: { person: 'P0003', fact: 'BIRT', event: 'E0012', source: 'S0001' } },
            { kind: 'fact.main', why: 'report', code: 'event.retracted', family: 'F0001', fact: 'MARR', source: 'S0001',
                params: { family: 'F0001', fact: 'MARR', event: 'E0020', source: 'S0001' } },
            { kind: 'fact.cite', why: 'report', code: 'event.retracted', person: 'P0003', fact: 'BIRT',
                params: { person: 'P0003', fact: 'BIRT', event: 'E0012' }, cites: ['S0003', '@S12@', 'S0003', 'bad ref'] },
            { kind: 'fact.note', why: 'report', code: 'event.retracted', family: 'F0001', fact: 'MARR',
                params: { family: 'F0001', fact: 'MARR', event: 'E0020' } },
        ],
        skipped: [
            { n: 1, kind: 'fact.detail', why: 'E0012 is retracted', code: 'event.retracted', params: { person: 'P0003', fact: 'BIRT', event: 'E0012' } },
            { n: 1, kind: 'fact.main', why: 'E0020 is retracted', code: 'event.retracted', params: { family: 'F0001', fact: 'MARR', event: 'E0020', source: 'S0001' } },
        ],
    };
    const words = {
        en: 'the research has since withdrawn this fact; it will not come back to the app',
        cs: 'výzkum tento fakt mezitím stáhl; do aplikace se už nevrátí',
        de: 'die Forschung hat diese Angabe inzwischen zurückgezogen; sie kommt nicht mehr in die App zurück',
        pl: 'badanie w międzyczasie wycofało ten fakt; nie wróci już do aplikacji',
    } as const;
    const tree = {
        ...data,
        sources: { ...data.sources,
            s3: { id: 's3', title: 'Matrika Z 1870–1890', refn: 'S0003' },
            s12: { id: 's12', title: 'Pozůstalost Brambůrkových' } },
    } as unknown as StromData;
    const fromReply = () => replyNotWritten(sanitizeSyncReply(withdrawn, CODES),
        { written: true, codes: true, removedOn: true, sourceIdOf: x => (x === '@S12@' ? 's12' : '') });

    it('read from notWritten[] and skipped[]: the code, its params and the sources cited', () => {
        const r = sanitizeSyncReply(withdrawn, CODES);
        expect(r.notWritten.map(n => n.code)).toEqual(Array(4).fill('event.retracted'));
        expect(r.notWritten[0]).toMatchObject({ person: 'P0003', fact: 'BIRT', source: 'S0001', params: { event: 'E0012' } });
        expect(r.notWritten[1]).toMatchObject({ person: '', family: 'F0001', fact: 'MARR', source: 'S0001' });
        // Each cited source once, a ref of the wrong shape left out.
        expect(r.notWritten[2].cites).toEqual(['S0003', '@S12@']);
        expect(r.notWritten[3].cites).toBeUndefined();
        expect(r.skipped.map(x => [x.code, x.params.event])).toEqual([['event.retracted', 'E0012'], ['event.retracted', 'E0020']]);
        // Without the feature: no code, nothing cited, as before.
        expect(sanitizeSyncReply(withdrawn, []).notWritten.every(n => n.code === '' && n.cites === undefined)).toBe(true);
    });

    it('not taken: every item in one list, the skipped ones too', () => {
        const r = fromReply();
        expect(r).toMatchObject({ notTaken: true, count: 6, skippedApart: 0 });
        expect(r.items.map(i => [i.code, !!i.skipped])).toEqual([
            ['event.retracted', false], ['event.retracted', false], ['event.retracted', false], ['event.retracted', false],
            ['event.retracted', true], ['event.retracted', true]]);
        expect(r.items[2]).toMatchObject({ cites: ['S0003', '@S12@'], citeIds: ['', 's12'] });
    });

    it('its reason in four languages, in notWritten[] and in skipped[] alike', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            expect(getStringsForLang(lang).sync.nw['event.retracted']).toBe(words[lang]);
            for (const it of fromReply().items) expect(ui.nwReason(it), `${lang} ${it.skipped ? 'skipped' : 'notWritten'}`).toBe(words[lang]);
        }
    });

    it('the row: person or couple · fact · source, each when known; a new citation names the sources it cited', () => {
        const items = fromReply().items;
        const rows = (pairNotWritten(items, tree).rows as Extract<PairedNotWritten, { type: 'coded' }>[]).map(r => ui.nwRowParts(r, tree));
        const hostivit = { name: 'Hostivít Brambůrek', personId: 'p3' };
        const couple = { name: 'Zbyhněv Brambůrek and Radoslava Brambůrková', personId: 'p2' };
        const matrikaN = { id: 's1', title: 'Matrika N 1850–1860' };
        expect(rows[0]).toEqual({ who: hostivit, fact: 'Birth 1851', source: matrikaN });
        expect(rows[1]).toEqual({ who: couple, fact: 'Marriage 1849', source: matrikaN });
        expect(rows[2]).toEqual({ who: hostivit, fact: 'Birth 1851', source: { id: 's3', title: 'Matrika Z 1870–1890' },
            more: [{ id: 's12', title: 'Pozůstalost Brambůrkových' }] });
        expect(rows[3]).toEqual({ who: couple, fact: 'Marriage 1849', source: null });
        expect(rows[4]).toEqual({ who: hostivit, fact: 'Birth 1851', source: null });
        expect(rows[5]).toEqual({ who: couple, fact: 'Marriage 1849', source: matrikaN });
        // In Czech the same parts in its words.
        setLanguage('cs');
        const cs = ui.nwRowParts(pairNotWritten(items.slice(1, 2), tree).rows[0] as Extract<PairedNotWritten, { type: 'coded' }>, tree);
        expect(cs.who?.name).toBe(getStringsForLang('cs').changes.coupleName('Zbyhněv Brambůrek', 'Radoslava Brambůrková'));
    });

    it('/status.sends: the same items, the cited sources by the research\'s number', () => {
        const rec = sanitizeLiveStatus({ features: CODES, sends: [{ intake: 'R5', at: '2026-11-15T13:15:00Z', state: 'nothing', changes: 0,
            notWritten: withdrawn.notWritten, notWrittenCount: 4, skipped: withdrawn.skipped }] })!.sends![0];
        const nw = sendRecordNotWritten(rec, true)!;
        expect(nw.items.map(i => i.code)).toEqual(Array(6).fill('event.retracted'));
        expect(nw.items[2]).toMatchObject({ cites: ['S0003', '@S12@'] });
        expect(nw.items[2].citeIds).toBeUndefined();
        const row = pairNotWritten(nw.items.slice(2, 3), tree).rows[0] as Extract<PairedNotWritten, { type: 'coded' }>;
        // A source new in the app ("@S12@") is not known without the send's file: left out.
        expect(ui.nwRowParts(row, tree)).toEqual({ who: { name: 'Hostivít Brambůrek', personId: 'p3' }, fact: 'Birth 1851',
            source: { id: 's3', title: 'Matrika Z 1870–1890' } });
    });

    it('kept in the state with the sources cited', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); }, key: () => null, get length() { return store.size; },
        });
        try {
            const items = fromReply().items;
            patchResearchAutoState('tree_1700000000000_nw02', { notWritten: { at: '2026-11-15T13:15:00Z', fingerprint: 'f5', written: 0, items, unexplained: 0, codes: true } });
            const kept = researchAutoState('tree_1700000000000_nw02').notWritten!.items;
            expect(kept).toEqual(items);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

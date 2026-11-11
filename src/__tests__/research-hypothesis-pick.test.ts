/**
 * Deciding a hypothesis in the app (spec 074): the research's new tags under
 * `_STROM_HYPO` read into ResearchHypothesis, the links that ask the research
 * (a fixed list, nothing else), when a card offers the choice of a version
 * (hypothesisPickable), the texts of reopening and of the terminal's
 * question, and the wait for the research's confirmation. Invented data only.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { parseGedcom, convertToStrom, isUnreadUnderscoreTag } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import {
    researchSchemeUrl, researchUrlMark, researchLinkMark, LINK_HYPOTHESIS_DOS, MAX_HYPOTHESES_ACCEPT,
    HYPOTHESIS_DECIDE_LINK_FEATURE, HYPOTHESES_ACCEPT_LINK_FEATURE,
} from '../research-link.js';
import {
    hypothesisPickable, hypothesisLinkUrl, hypothesesAcceptUrl, hypothesisChoiceStays, hypothesisChangeChangesTree,
    hypothesisCannotReopen, HYPOTHESIS_BIG_JOIN, HypothesisPickEnv,
} from '../research-hypothesis-pick.js';
import {
    researchHypothesisAsk, researchHypothesisWaitText, researchHypothesisReopenNote, researchHypothesisCannotReopenText,
    researchHypothesisBigJoin, researchHypothesisDecision,
} from '../research-hypotheses.js';
import {
    HYPOTHESIS_WAIT_LONG_MS, newPendingHypothesis, pendingHypothesisPhase, evaluatePendingHypothesis, settlePendingHypothesis,
    setPendingHypothesis, pendingHypothesis, pendingHypothesesOf, settlePendingHypotheses, clearPendingHypotheses,
    onPendingHypothesisChange, hypothesisStateKey,
} from '../research-hypothesis-wait.js';
import { setLanguage, strings, type Language } from '../strings.js';
import type { ResearchHypothesis } from '../types.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';

/** A research file: a child, his two possible fathers and a mother, a source; the lines under the child. */
function researchGed(lines: string[]): string {
    return [
        '0 HEAD', '1 CHAR UTF-8', '1 SOUR STROM_RESEARCH', `1 _STROM_TREE ${TREE}`,
        '0 @I1@ INDI', '1 NAME Vlastimír /Zábrodský/', '1 SEX M', '1 REFN P0012',
        ...lines,
        '0 @I2@ INDI', '1 NAME Dobroslav /Zábrodský/', '1 SEX M', '1 REFN P0013',
        '0 @I3@ INDI', '1 NAME Dobromila /Hřebíčková/', '1 SEX F', '1 REFN P0014',
        '0 @I4@ INDI', '1 NAME Bolemír /Zábrodský/', '1 SEX M', '1 REFN P0015',
        '0 @S1@ SOUR', '1 TITL Matrika N Lhota 1850–1870', '1 REFN S0001',
        '0 @S2@ SOUR', '1 TITL Gruntovní kniha Lhota', '1 REFN S0002',
        '0 TRLR',
    ].join('\n');
}

function hypothesesOf(lines: string[]): ResearchHypothesis[] {
    const data = convertToStrom(parseGedcom(researchGed(lines))).data;
    const child = Object.values(data.persons).find(p => p.firstName === 'Vlastimír');
    return child?.research?.hypotheses ?? [];
}

/** A hypothesis with two versions, each a child link (version A: Dobroslav, B: Bolemír, both with Dobromila). */
const TWO_FATHERS = [
    '2 _VAR A', '3 TITL Syn Dobroslava a Dobromily', '3 _LINK child', '4 _PERS @I1@', '4 _PAR @I2@', '4 _PAR @I3@', '3 SOUR @S1@',
    '2 _VAR B', '3 TITL Syn Bolemíra a Dobromily', '3 _LINK child', '4 _PERS @I1@', '4 _PAR @I4@', '4 _PAR @I3@',
];

describe('the research\'s tags for deciding in the app, read', () => {
    it('reads _PICK, _BY app, _PREV with its lines, _REOPEN with TYPE, _COUNT and _STAYS', () => {
        const [h] = hypothesesOf([
            '1 _STROM_HYPO H0022', '2 TITL Otec Vlastimíra?', '2 STAT decided', '2 _CHOSEN B', '2 _BY app',
            '2 DECI rozhodnuto v aplikaci Strom, verze B', '2 _AT 2026-11-10', '2 _PICK Y',
            '2 _PREV A', '3 _BY agent', '3 DECI Křestní zápis jmenuje', '4 CONC  Dobroslava.', '4 CONT Druhý řádek.', '3 _AT 2026-11-02',
            '2 _REOPEN no', '3 TYPE work', '3 _COUNT 2', '3 _STAYS A', '3 _STAYS A', '3 _STAYS b', '3 _STAYS C',
            ...TWO_FATHERS,
        ]);
        expect(h).toMatchObject({
            id: 'H0022', status: 'decided', chosen: 'B', decidedBy: 'app', pickable: true,
            previous: { variant: 'A', by: 'agent', reason: 'Křestní zápis jmenuje Dobroslava.\nDruhý řádek.', day: '2026-11-02' },
            reopen: { ok: false, type: 'work', count: 2, stays: ['A', 'C'] },
        });
        expect(h.proposal).toBeUndefined();
        expect(h.leftOpen).toBeUndefined();
    });

    it('reads _PROP (a version or none) with its sentence and day, and _LEFT, of an open hypothesis', () => {
        const [withProp, none, left] = hypothesesOf([
            '1 _STROM_HYPO H0030', '2 TITL Otec?', '2 STAT open', '2 _PROP B', '3 DECI Zápis 1858 jmenuje', '4 CONC  Bolemíra.', '3 _AT 2026-11-09',
            ...TWO_FATHERS,
            '1 _STROM_HYPO H0031', '2 TITL Matka?', '2 _PROP none', '3 DECI Nic se nenašlo.',
            '1 _STROM_HYPO H0032', '2 TITL Bratr?', '2 STAT open', '2 _LEFT 2026-11-09',
        ]);
        expect(withProp.proposal).toEqual({ variant: 'B', text: 'Zápis 1858 jmenuje Bolemíra.', day: '2026-11-09' });
        expect(none.proposal).toEqual({ variant: null, text: 'Nic se nenašlo.' });
        expect(left.leftOpen).toBe('2026-11-09');
        expect(left.proposal).toBeUndefined();
    });

    it('reads _AGAINST with its text and sources, and _PEOPLE, under a version', () => {
        const [h] = hypothesesOf([
            '1 _STROM_HYPO H0040', '2 TITL Otec?', '2 _PICK Y',
            '2 _VAR A', '3 TITL Syn Dobroslava', '3 _LINK child', '4 _PERS @I1@', '4 _PAR @I2@',
            '3 _AGAINST Gruntovní kniha uvádí', '4 CONC  jiného hospodáře.', '4 SOUR @S2@', '4 SOUR @S9@',
            '3 _AGAINST Jen text bez zdroje.', '3 _AGAINST ', '3 _PEOPLE 214',
            '2 _VAR B', '3 TITL Syn Bolemíra', '3 _LINK child', '4 _PERS @I1@', '4 _PAR @I4@', '3 _PEOPLE 0',
        ]);
        const [a, b] = h.variants!;
        expect(a.against).toHaveLength(2);
        expect(a.against![0].text).toBe('Gruntovní kniha uvádí jiného hospodáře.');
        expect(a.against![0].sourceIds).toHaveLength(1);
        expect(a.against![1]).toEqual({ text: 'Jen text bez zdroje.' });
        expect(a.people).toBe(214);
        // 0 is no count (a version joining only people of the tree has none).
        expect(b.people).toBeUndefined();
        expect(b.against).toBeUndefined();
        // The source of the text against is the version's own catalog source.
        expect(a.sourceIds).toBeUndefined();
    });

    it('drops values that are not what the research writes; texts stay plain text', () => {
        const [bad, open] = hypothesesOf([
            '1 _STROM_HYPO H0050', '2 TITL Otec?', '2 STAT decided', '2 _CHOSEN A', '2 _BY someone', '2 _PICK yes',
            '2 _PREV b', '3 _BY app', '2 _REOPEN yes', '3 TYPE tree', '2 _PROP B', '2 _LEFT 9. 11. 2026',
            '2 _VAR A', '3 TITL <b>Syn</b>', '3 _PEOPLE many',
            '1 _STROM_HYPO H0051', '2 TITL Otec?', '2 STAT open', '2 _REOPEN no', '3 TYPE tree', '2 _PREV none', '3 _AT 2026-1-1',
            '2 _PROP ZZZZ', '2 _LEFT 2026-11-09',
        ]);
        expect(bad.decidedBy).toBeUndefined();
        expect(bad.pickable).toBeUndefined();
        expect(bad.previous).toBeUndefined();
        expect(bad.reopen).toBeUndefined();
        // A proposal and "left open" belong to an open hypothesis only.
        expect(bad.proposal).toBeUndefined();
        expect(bad.leftOpen).toBeUndefined();
        expect(bad.variants![0].title).toBe('<b>Syn</b>');
        expect(bad.variants![0].people).toBeUndefined();
        // Open: no "cannot reopen"; "before: no version held" without a day not ISO; a letter too long goes.
        expect(open.reopen).toBeUndefined();
        expect(open.previous).toEqual({ variant: null });
        expect(open.proposal).toBeUndefined();
        expect(open.leftOpen).toBe('2026-11-09');
    });

    it('keeps an unknown TYPE as its word, a bad one as none, and takes a count only in range', () => {
        const [other, bad] = hypothesesOf([
            '1 _STROM_HYPO H0060', '2 TITL Otec?', '2 STAT decided', '2 _CHOSEN A', '2 _REOPEN NO', '3 TYPE Merge', '3 _COUNT 0',
            '1 _STROM_HYPO H0061', '2 TITL Otec?', '2 STAT abandoned', '2 _REOPEN no', '3 TYPE <x>', '3 _COUNT 3',
        ]);
        expect(other.reopen).toEqual({ ok: false, type: 'merge' });
        expect(bad.reopen).toEqual({ ok: false, type: '', count: 3 });
    });

    it('takes the new tags as read (not counted as another program\'s) and skips tags it does not know', () => {
        for (const tag of ['_PICK', '_PREV', '_REOPEN', '_COUNT', '_STAYS', '_PROP', '_LEFT', '_AGAINST', '_PEOPLE']) {
            expect(isUnreadUnderscoreTag(tag)).toBe(false);
        }
        const [h] = hypothesesOf([
            '1 _STROM_HYPO H0070', '2 TITL Otec?', '2 _FUTURE x', '3 _MORE y', '2 _PICK Y', ...TWO_FATHERS, '3 _LATER z',
        ]);
        expect(h.pickable).toBe(true);
        expect(h.variants).toHaveLength(2);
    });

    it('the app\'s GEDCOM export writes no hypotheses: the research\'s tags never go back from here', () => {
        const data = convertToStrom(parseGedcom(researchGed([
            '1 _STROM_HYPO H0022', '2 TITL Otec?', '2 STAT decided', '2 _CHOSEN B', '2 _BY app', '2 _PICK Y',
            '2 _REOPEN no', '3 TYPE work', '3 _STAYS A', ...TWO_FATHERS,
        ]))).data;
        const ged = exportToGedcom(data);
        for (const tag of ['_STROM_HYPO', '_PICK', '_REOPEN', '_STAYS', '_PREV', '_PROP']) expect(ged).not.toContain(tag);
    });
});

describe('the links that decide a hypothesis', () => {
    it('builds every do of the fixed list, a version only with decide', () => {
        expect([...LINK_HYPOTHESIS_DOS]).toEqual(['decide', 'abandon', 'keep-open', 'reopen']);
        const base = `strom-research://hypothesis?tree=${TREE}&id=H0022`;
        expect(hypothesisLinkUrl(TREE, 'H0022', 'decide', 'B')).toBe(`${base}&do=decide&variant=B`);
        expect(hypothesisLinkUrl(TREE, 'H0022', 'decide')).toBe(`${base}&do=decide`);
        expect(hypothesisLinkUrl(TREE, 'H0022', 'abandon')).toBe(`${base}&do=abandon`);
        expect(hypothesisLinkUrl(TREE, 'H0022', 'keep-open')).toBe(`${base}&do=keep-open`);
        expect(hypothesisLinkUrl(TREE, 'H0022', 'reopen')).toBe(`${base}&do=reopen`);
        expect(hypothesisLinkUrl(TREE, 'H0022', 'decide', 'AB', 'strom-research-beta')).toBe(
            `strom-research-beta://hypothesis?tree=${TREE}&id=H0022&do=decide&variant=AB`);
    });

    it('refuses a version with another do, a bad version, a bad id, a do not on the list, any text', () => {
        expect(hypothesisLinkUrl(TREE, 'H0022', 'abandon', 'B')).toBeNull();
        expect(hypothesisLinkUrl(TREE, 'H0022', 'reopen', 'B')).toBeNull();
        expect(hypothesisLinkUrl(TREE, 'H0022', 'keep-open', 'B')).toBeNull();
        for (const v of ['b', 'ABCD', '', 'B&note=x', '1']) expect(hypothesisLinkUrl(TREE, 'H0022', 'decide', v)).toBeNull();
        for (const id of ['X0022', 'H', 'H00a2', 'H0022&do=reopen', 'H12345678']) expect(hypothesisLinkUrl(TREE, id, 'decide', 'B')).toBeNull();
        expect(researchSchemeUrl('hypothesis', { tree: TREE, hypothesis: 'H0022', hypothesisDo: 'pick' as never, variant: 'B' })).toBeNull();
        expect(researchSchemeUrl('hypothesis', { tree: TREE, hypothesis: 'H0022' })).toBeNull();
        expect(hypothesisLinkUrl('not-a-tree', 'H0022', 'decide', 'B')).toBeNull();
    });

    it('accepts 1–50 proposals by their ids, nothing else', () => {
        expect(hypothesesAcceptUrl(TREE, ['H0022', 'H0052'])).toBe(`strom-research://hypotheses?tree=${TREE}&do=accept&ids=H0022,H0052`);
        const fifty = Array.from({ length: MAX_HYPOTHESES_ACCEPT }, (_, i) => `H${String(i + 1).padStart(4, '0')}`);
        expect(hypothesesAcceptUrl(TREE, fifty)).toContain('&ids=H0001,H0002,');
        expect(hypothesesAcceptUrl(TREE, [...fifty, 'H0099'])).toBeNull();
        expect(hypothesesAcceptUrl(TREE, [])).toBeNull();
        expect(hypothesesAcceptUrl(TREE, ['H0022', 'H0022'])).toBeNull();
        for (const bad of ['X1', 'h1', 'H1,H2', ' H1', 'H']) expect(hypothesesAcceptUrl(TREE, ['H0022', bad])).toBeNull();
        // Accepting and "who decides" never in one link; who decides stays as it was.
        expect(researchSchemeUrl('hypotheses', { tree: TREE, hypothesesDo: 'accept', ids: ['H1'], decide: 'agent' })).toBeNull();
        expect(researchSchemeUrl('hypotheses', { tree: TREE, decide: 'agent' })).toBe(`strom-research://hypotheses?tree=${TREE}&decide=agent`);
    });

    it('every link that decides a hypothesis carries the terminal mark, none the AI badge', () => {
        expect(researchLinkMark('hypothesis')).toBe('terminal');
        expect(researchLinkMark('hypotheses')).toBe('terminal');
        for (const what of LINK_HYPOTHESIS_DOS) expect(researchUrlMark(hypothesisLinkUrl(TREE, 'H0022', what)!)).toBe('terminal');
        expect(researchUrlMark(hypothesisLinkUrl(TREE, 'H0022', 'decide', 'B')!)).toBe('terminal');
        expect(researchUrlMark(hypothesesAcceptUrl(TREE, ['H0022'])!)).toBe('terminal');
    });

    it('names the features of the research that open it', () => {
        expect(HYPOTHESIS_DECIDE_LINK_FEATURE).toBe('hypothesis.decide.link');
        expect(HYPOTHESES_ACCEPT_LINK_FEATURE).toBe('hypotheses.accept.link');
    });
});

describe('when a hypothesis card offers the choice of a version (DEV §2)', () => {
    const FEAT = [HYPOTHESIS_DECIDE_LINK_FEATURE];
    const here: HypothesisPickEnv = { readOnly: false, features: FEAT, linkAvailable: true };
    const child = (c: string, ...parents: string[]) => ({ kind: 'child' as const, child: c, parents });
    const pickable: ResearchHypothesis = {
        id: 'H0022', title: 'Otec?', status: 'open', pickable: true,
        variants: [{ id: 'A', links: [child('P0012', 'P0013')] }, { id: 'B', links: [child('P0012', 'P0015')] }],
    };
    const merge: ResearchHypothesis = {
        id: 'H0040', title: 'Jedna osoba?', status: 'open',
        variants: [{ id: 'A', links: [{ kind: 'same', persons: ['P0012', 'P0016'] }] }, { id: 'B', links: [] }],
    };

    it('pick: _PICK, the feature said now or last, the link on this computer; open, decided or abandoned', () => {
        expect(hypothesisPickable(pickable, here)).toBe('pick');
        expect(hypothesisPickable({ ...pickable, status: undefined }, here)).toBe('pick');
        expect(hypothesisPickable({ ...pickable, status: 'decided', chosen: 'A' }, here)).toBe('pick');
        expect(hypothesisPickable({ ...pickable, status: 'abandoned' }, here)).toBe('pick');
        // An archive is no other case: its card only has no agent's proposal.
        expect(hypothesisPickable(pickable, { ...here, features: ['hypotheses.decide', HYPOTHESIS_DECIDE_LINK_FEATURE] })).toBe('pick');
    });

    it('old: no id, a newer state, no _PICK without merging, no feature, an older research, not known on this computer', () => {
        expect(hypothesisPickable({ ...pickable, id: undefined }, here)).toBe('old');
        expect(hypothesisPickable({ ...pickable, status: 'testing' }, here)).toBe('old');
        expect(hypothesisPickable({ ...pickable, pickable: undefined }, here)).toBe('old');
        expect(hypothesisPickable({ ...pickable, variants: [] }, here)).toBe('old');
        expect(hypothesisPickable(pickable, { ...here, features: ['hypotheses.decide'] })).toBe('old');
        expect(hypothesisPickable(pickable, { ...here, features: [] })).toBe('old');
        // The bridge never answered in this page: today's card.
        expect(hypothesisPickable(pickable, { ...here, features: null })).toBe('old');
    });

    it('_PICK goes before the app\'s own look at the links', () => {
        // A version linking only by `same` — the research still said _PICK: its word holds.
        expect(hypothesisPickable({ ...merge, pickable: true }, here)).toBe('pick');
    });

    it('merge: no _PICK and a version merging people or making siblings, only with the feature and the link', () => {
        expect(hypothesisPickable(merge, here)).toBe('merge');
        const siblings: ResearchHypothesis = { ...merge, variants: [{ id: 'A', links: [{ kind: 'siblings', persons: ['P0012', 'P0013'] }] }] };
        expect(hypothesisPickable(siblings, here)).toBe('merge');
        // An older research (no feature), a phone, a read-only copy: today's card.
        expect(hypothesisPickable(merge, { ...here, features: ['hypotheses.decide'] })).toBe('old');
        expect(hypothesisPickable(merge, { ...here, features: null })).toBe('old');
        expect(hypothesisPickable(merge, { ...here, linkAvailable: false })).toBe('old');
        expect(hypothesisPickable(merge, { ...here, readOnly: true })).toBe('old');
    });

    it('remote: a phone, a tablet, a browser away from the research — the versions readable, nothing to choose', () => {
        expect(hypothesisPickable(pickable, { readOnly: false, features: null, linkAvailable: false })).toBe('remote');
        expect(hypothesisPickable(pickable, { ...here, linkAvailable: false })).toBe('remote');
        // The research said it lacks the feature: today's card even there.
        expect(hypothesisPickable(pickable, { readOnly: false, features: [], linkAvailable: false })).toBe('old');
    });

    it('readonly: a copy, a saved HTML, a book, a print — before anything else of the device', () => {
        expect(hypothesisPickable(pickable, { readOnly: true, features: null, linkAvailable: false })).toBe('readonly');
        expect(hypothesisPickable(pickable, { ...here, readOnly: true })).toBe('readonly');
        expect(hypothesisPickable({ ...pickable, pickable: undefined }, { ...here, readOnly: true })).toBe('old');
    });
});

describe('reopening and changing a decided hypothesis (DEV §6, _STAYS)', () => {
    beforeEach(() => setLanguage('cs'));
    afterEach(() => setLanguage('en'));
    const three = (reopen?: ResearchHypothesis['reopen']): ResearchHypothesis => ({
        id: 'H0022', title: 'Otec?', status: 'decided', chosen: 'B', pickable: true, ...(reopen ? { reopen } : {}),
        variants: [
            { id: 'A', links: [{ kind: 'child', child: 'P0012', parents: ['P0013'] }] },
            { id: 'B', links: [{ kind: 'child', child: 'P0012', parents: ['P0015'] }], people: 3 },
            { id: 'C', links: [] },
        ],
    });

    it('can be reopened without _REOPEN; says what leaves the tree', () => {
        expect(hypothesisCannotReopen(three())).toBeNull();
        expect(researchHypothesisCannotReopenText(three())).toBe('');
        expect(researchHypothesisReopenNote(three())).toBe('Ze stromu zmizí spojení 3 osob.');
        const noCount = three();
        delete noCount.variants![1].people;
        expect(researchHypothesisReopenNote(noCount)).toBe('Ze stromu zmizí spojení zvolené verze.');
        expect(researchHypothesisReopenNote({ ...three(), status: 'abandoned', chosen: undefined })).toBe('Ve stromu se nic nezmění.');
        expect(researchHypothesisReopenNote({ ...three(), chosen: 'C' })).toBe('Ve stromu se nic nezmění.');
    });

    it('TYPE tree and work: their sentences, "Change is possible" only while another version changes the tree', () => {
        const tree = three({ ok: false, type: 'tree', count: 2 });
        expect(hypothesisCannotReopen(tree)).toEqual({ kind: 'tree', count: 2, change: true });
        expect(researchHypothesisCannotReopenText(tree)).toBe('Vrátit nejde: spojení už je zapsané ve stromu výzkumu (2 vazby). Jde Změnit.');
        const work = three({ ok: false, type: 'work', count: 1, stays: ['A'] });
        expect(hypothesisChoiceStays(work, 'A')).toBe(true);
        expect(hypothesisChoiceStays(work, 'C')).toBe(false);
        // C (not in _STAYS) still changes the tree.
        expect(researchHypothesisCannotReopenText(work)).toBe('Vrátit nejde: na spojení zapsaném rozhodnutím stojí další práce (1 vazba). Jde Změnit.');
        const allStay = three({ ok: false, type: 'work', count: 5, stays: ['A', 'C'] });
        expect(hypothesisChangeChangesTree(allStay)).toBe(false);
        expect(researchHypothesisCannotReopenText(allStay)).toBe('Vrátit nejde: na spojení zapsaném rozhodnutím stojí další práce (5 vazeb).');
        expect(researchHypothesisCannotReopenText(three({ ok: false, type: 'tree' }))).toBe('Vrátit nejde: spojení už je zapsané ve stromu výzkumu. Jde Změnit.');
    });

    it('an unknown TYPE says the general sentence', () => {
        const other = three({ ok: false, type: 'merge', count: 4 });
        expect(hypothesisCannotReopen(other)?.kind).toBe('other');
        expect(researchHypothesisCannotReopenText(other)).toBe(strings.research.hypoCannotReopen);
        expect(researchHypothesisCannotReopenText(three({ ok: false, type: '' }))).toBe(strings.research.hypoCannotReopen);
    });

    it('a decision from the app says who, as the agent\'s does', () => {
        expect(researchHypothesisDecision({ ...three(), decidedBy: 'app' }).by).toBe('rozhodl člověk v aplikaci');
        expect(researchHypothesisDecision({ ...three(), decidedBy: 'agent' }).by).toBe('rozhodl agent');
        expect(researchHypothesisDecision(three()).by).toBe('');
    });
});

describe('the question the terminal asks, as the waiting card repeats it (DEV §3, §4)', () => {
    afterEach(() => setLanguage('en'));
    const h: ResearchHypothesis = {
        id: 'H0052', title: 'Odkud?', status: 'open', pickable: true,
        variants: [
            { id: 'A', links: [{ kind: 'child', child: 'P0012', parents: ['P0013'] }], people: 214 },
            { id: 'B', links: [{ kind: 'child', child: 'P0012', parents: ['P0015'] }], people: HYPOTHESIS_BIG_JOIN },
        ],
        proposal: { variant: 'B' },
    };

    it('in Czech: choose (with a large link), change, abandon, reopen, leave open', () => {
        setLanguage('cs');
        expect(researchHypothesisAsk(h, 'decide', 'A')).toBe('Rozhodnout H0052 pro verzi A? Připojí 214 osob. (Enter = ano)');
        expect(researchHypothesisAsk(h, 'decide', 'B')).toBe('Rozhodnout H0052 pro verzi B? (Enter = ano)');
        expect(researchHypothesisAsk({ ...h, status: 'decided', chosen: 'A' }, 'decide', 'B')).toBe('Změnit H0052 z A na verzi B? (Enter = ano)');
        expect(researchHypothesisAsk(h, 'abandon')).toBe('Žádná verze H0052 neplatí, hypotézu opustit? (Enter = ano)');
        expect(researchHypothesisAsk({ ...h, status: 'decided', chosen: 'A' }, 'reopen')).toBe('Vrátit H0052 na otevřenou? Ze stromu zmizí spojení 214 osob. (Enter = ano)');
        expect(researchHypothesisAsk(h, 'keep-open')).toBe('Nechat H0052 otevřenou? Návrh agenta (B) se nepřijme. (Enter = ano)');
        expect(researchHypothesisAsk(h, 'decide')).toBe('');
        expect(researchHypothesisWaitText(h, 'decide', 'B')).toBe(
            'Terminál výzkumu se ptá: „Rozhodnout H0052 pro verzi B? (Enter = ano)“, pak nepovinně na důvod. Do potvrzení se tu nic nemění.');
        // Leaving open asks for no reason.
        expect(researchHypothesisWaitText({ ...h, proposal: undefined }, 'keep-open')).toBe(
            'Terminál výzkumu se ptá: „Nechat H0052 otevřenou? (Enter = ano)“. Do potvrzení se tu nic nemění.');
        expect(researchHypothesisBigJoin(h.variants![0])).toBe(214);
        expect(researchHypothesisBigJoin(h.variants![1])).toBe(0);
    });

    it('in English: the same sentences', () => {
        setLanguage('en');
        expect(researchHypothesisWaitText(h, 'decide', 'A')).toBe(
            'The research terminal asks: “Decide H0052 for version A? Links 214 people. (Enter = yes)”, then optionally for a reason. Nothing changes here until confirmed.');
        expect(researchHypothesisAsk({ ...h, proposal: { variant: null } }, 'keep-open')).toBe(
            'Leave H0052 open? The agent\'s proposal (no version holds) is not accepted. (Enter = yes)');
    });
});

describe('the texts of deciding a hypothesis in four languages', () => {
    afterEach(() => setLanguage('en'));

    it('counts by the language\'s plural and never addresses the reader', () => {
        const forms: Record<Language, [string, string, string]> = {
            cs: ['Ze stromu zmizí spojení 1 osoby.', 'Přijato 2 ze 3 návrhů.', 'připojí 5 osob'],
            en: ['The link of 1 person leaves the tree.', '2 of 3 proposals accepted.', 'links 5 people'],
            de: ['Die Verbindung von 1 Person verschwindet aus dem Stammbaum.', '2 von 3 Vorschlägen angenommen.', 'verbindet 5 Personen'],
            pl: ['Z drzewa zniknie połączenie 1 osoby.', 'Przyjęto 2 z 3 propozycji.', 'połączy 5 osób'],
        };
        for (const lang of Object.keys(forms) as Language[]) {
            setLanguage(lang);
            const r = strings.research;
            expect([r.hypoReopenLoss(1), r.hypoAcceptedOf(2, 3), r.hypoBig(5)]).toEqual(forms[lang]);
            const all = [
                r.hypoPick, r.hypoPickAria('B'), r.hypoNone, r.hypoLeave, r.hypoProposal('x'), r.hypoWait, r.hypoWaitAsk('q'),
                r.hypoWaitLongText, r.hypoChangeReason, r.hypoElsewhere('A', r.hypoByApp), r.hypoStaysNote, r.hypoRemote,
                r.hypoCannotReopenTree(2, true), r.hypoCannotReopenWork(2, true), r.hypoCannotReopen, r.hypoAcceptMax,
                r.hypoBigSum('H0052', 'A', 214), r.hypoNoLinkNote, r.hypoInTreeNote, r.hypoMerge, r.hypoOnlyResearch,
            ].join(' ');
            expect(all).not.toMatch(/\b(you|your|vy|váš|vaše|tvůj)\b/i);
            // German by case: "auf ihr baut …" (on it) is no address.
            expect(all).not.toMatch(/\b(Sie|Ihr|Ihre|du|dein|deine)\b/);
            expect(all).not.toMatch(/\b(wy|twój|pan|pani)\b/i);
        }
    });
});

describe('the wait for the research\'s confirmation (DEV §4)', () => {
    const NOW = Date.parse('2026-11-11T09:30:00Z');
    const open: ResearchHypothesis = {
        id: 'H0022', title: 'Otec?', status: 'open', pickable: true,
        variants: [{ id: 'A', links: [] }, { id: 'B', links: [] }],
    };
    const decided = (v: string, by?: 'agent' | 'app'): ResearchHypothesis => ({ ...open, status: 'decided', chosen: v, decidedAt: '2026-11-11', ...(by ? { decidedBy: by } : {}) });
    const ask = (h: ResearchHypothesis, what: Parameters<typeof newPendingHypothesis>[1], variant?: string) =>
        newPendingHypothesis(h, what, 'strom-research://hypothesis?tree=x', 'head1', NOW, variant);

    afterEach(() => clearPendingHypotheses());

    it('records what was asked, a version only with decide', () => {
        expect(ask(open, 'decide', 'B')).toMatchObject({ do: 'decide', variant: 'B', since: NOW, head: 'head1' });
        expect(ask(open, 'abandon', 'B').variant).toBeUndefined();
    });

    it('waits, then waits long after ten minutes (fixed clock)', () => {
        const p = ask(open, 'decide', 'B');
        expect(pendingHypothesisPhase(p, NOW)).toBe('waiting');
        expect(pendingHypothesisPhase(p, NOW + HYPOTHESIS_WAIT_LONG_MS - 1)).toBe('waiting');
        expect(pendingHypothesisPhase(p, NOW + HYPOTHESIS_WAIT_LONG_MS)).toBe('long');
    });

    it('decided as asked: a version, no version holds, reopened, left open', () => {
        expect(evaluatePendingHypothesis(ask(open, 'decide', 'B'), decided('B', 'app'), 'head2')).toEqual({ kind: 'asked', variant: 'B' });
        expect(evaluatePendingHypothesis(ask(decided('A'), 'decide', 'B'), decided('B', 'app'), 'head2')).toEqual({ kind: 'asked', variant: 'B' });
        expect(evaluatePendingHypothesis(ask(open, 'abandon'), { ...open, status: 'abandoned', decidedBy: 'app' }, 'head2')).toEqual({ kind: 'asked', variant: null });
        expect(evaluatePendingHypothesis(ask(decided('A'), 'reopen'), { ...open, previous: { variant: 'A' } }, 'head2')).toEqual({ kind: 'reopened' });
        const withProp: ResearchHypothesis = { ...open, proposal: { variant: 'B' } };
        expect(evaluatePendingHypothesis(ask(withProp, 'keep-open'), { ...open, leftOpen: '2026-11-11' }, 'head2')).toEqual({ kind: 'left-open' });
    });

    it('still waiting: a new version with the hypothesis unchanged, or a proposal come meanwhile; the same version', () => {
        const p = ask(open, 'decide', 'B');
        expect(evaluatePendingHypothesis(p, open, 'head2')).toEqual({ kind: 'waiting' });
        expect(evaluatePendingHypothesis(p, { ...open, proposal: { variant: 'A' } }, 'head2')).toEqual({ kind: 'waiting' });
        expect(evaluatePendingHypothesis(p, open, 'head1')).toEqual({ kind: 'waiting' });
        const settled = settlePendingHypothesis(p, open, 'head2');
        expect(settled.next).toEqual({ ...p, head: 'head2' });
        expect(settlePendingHypothesis(p, open, 'head1').next).toBe(p);
    });

    it('decided elsewhere: another version, by the agent or in the terminal; reopened by someone else', () => {
        expect(evaluatePendingHypothesis(ask(open, 'decide', 'B'), decided('A', 'agent'), 'head2'))
            .toEqual({ kind: 'elsewhere', status: 'decided', variant: 'A', by: 'agent' });
        expect(evaluatePendingHypothesis(ask(open, 'decide', 'B'), decided('A'), 'head2'))
            .toEqual({ kind: 'elsewhere', status: 'decided', variant: 'A', by: 'person' });
        expect(evaluatePendingHypothesis(ask(open, 'abandon'), decided('B', 'app'), 'head2'))
            .toEqual({ kind: 'elsewhere', status: 'decided', variant: 'B', by: 'app' });
        expect(evaluatePendingHypothesis(ask(decided('A'), 'decide', 'B'), open, 'head2'))
            .toEqual({ kind: 'elsewhere', status: 'open', variant: null, by: 'person' });
        expect(evaluatePendingHypothesis(ask(open, 'keep-open'), { ...open, status: 'abandoned' }, 'head2'))
            .toEqual({ kind: 'elsewhere', status: 'abandoned', variant: null, by: 'person' });
    });

    it('gone: the research\'s new version has no such hypothesis', () => {
        expect(evaluatePendingHypothesis(ask(open, 'decide', 'B'), undefined, 'head2')).toEqual({ kind: 'gone' });
        expect(evaluatePendingHypothesis(ask(open, 'decide', 'B'), undefined, 'head1')).toEqual({ kind: 'waiting' });
    });

    it('keeps the waits of this page by research, tells of each change, settles them on a new version', () => {
        const told: string[] = [];
        onPendingHypothesisChange((rid, id) => told.push(`${rid}|${id}`));
        setPendingHypothesis('R1', 'H0022', ask(open, 'decide', 'B'));
        setPendingHypothesis('R1', 'H0023', ask({ ...open, id: 'H0023' }, 'abandon'));
        setPendingHypothesis('R2', 'H0022', ask(open, 'keep-open'));
        expect(pendingHypothesis('r1', 'H0022')?.variant).toBe('B');
        expect([...pendingHypothesesOf('R1').keys()]).toEqual(['H0022', 'H0023']);
        const done = settlePendingHypotheses('R1', new Map([['H0022', decided('B', 'app')], ['H0023', { ...open, id: 'H0023' }]]), 'head2');
        expect([...done]).toEqual([['H0022', { kind: 'asked', variant: 'B' }]]);
        expect(pendingHypothesis('R1', 'H0022')).toBeNull();
        expect(pendingHypothesis('R1', 'H0023')?.head).toBe('head2');
        // Another research's wait untouched; "Stop waiting" ends one.
        expect(pendingHypothesis('R2', 'H0022')).not.toBeNull();
        setPendingHypothesis('R2', 'H0022', null);
        expect(pendingHypothesis('R2', 'H0022')).toBeNull();
        expect(told).toEqual(['R1|H0022', 'R1|H0023', 'R2|H0022', 'R1|H0022', 'R2|H0022']);
        // Ending a wait not there tells nothing.
        setPendingHypothesis('R2', 'H0022', null);
        expect(told).toHaveLength(5);
    });

    it('the state it compares leaves out what is no decision', () => {
        expect(hypothesisStateKey(open)).toBe(hypothesisStateKey({ ...open, proposal: { variant: 'B' }, variants: [] }));
        expect(hypothesisStateKey(open)).not.toBe(hypothesisStateKey({ ...open, leftOpen: '2026-11-11' }));
    });
});

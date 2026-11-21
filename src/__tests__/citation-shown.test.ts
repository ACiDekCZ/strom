/**
 * The order of a fact's citations and the main citation's ★ where the app
 * shows them (spec 095 §1, M1–M11): the chips, the fact's bubble and the
 * card's, the person's sources, the person page's excerpt, the book's
 * markers, Verify's first source. The case of the report: a birth cites the
 * death record before the birth record, and the birth record comes first.
 * Invented data.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { TreeManager } from '../tree-manager.js';
import { setCitationFeaturesLookup, CITATIONS_MAIN_FEATURE, CITATIONS_ORDER_FEATURE } from '../citation-gates.js';
import { chipCitations } from '../ui/sources.js';
import { cardSourcesModel, factSourcesModel, sourceSubHtml } from '../ui/status-tip.js';
import { factCitations } from '../import-origin.js';
import { personSourceRows } from '../person-sources.js';
import { BookSourceNumbers } from '../book-blocks.js';
import { factSourceIds } from '../verify.js';
import { strings } from '../strings.js';
import { CardStatus } from '../reliability.js';
import { Partnership, PartnershipId, Person, PersonId, StromData, TreeId, TreeMetadata } from '../types.js';

const TREE = 'tree-shown' as TreeId;
const RADIM = 'radim' as PersonId;
const U1 = 'u1' as PartnershipId;

/** Radim Ostružník: the death record cited first at his birth, then the birth record, then a census. */
function tree(): StromData {
    const radim = {
        id: RADIM, firstName: 'Radim', lastName: 'Ostružník', gender: 'male',
        birthDate: '1851-03-02', birthPlace: 'Vrbovec', deathDate: '1902-01-10',
        parentIds: [], childIds: [], partnerships: [U1],
        birthSourceIds: ['src-death', 'src-birth', 'src-census'], deathSourceIds: ['src-death', 'src-census'],
    } as unknown as Person;
    const hedvika = {
        id: 'hedvika', firstName: 'Hedvika', lastName: 'Ostružníková', gender: 'female',
        parentIds: [], childIds: [], partnerships: [U1],
    } as unknown as Person;
    const u1 = {
        id: U1, person1Id: RADIM, person2Id: 'hedvika', status: 'married', childIds: [], startDate: '1876-02-01',
        sourceIds: ['src-census', 'src-marr'],
    } as unknown as Partnership;
    return {
        persons: { [RADIM]: radim, hedvika } as StromData['persons'],
        partnerships: { [U1]: u1 },
        sources: {
            'src-death': { id: 'src-death', title: 'Kniha zemřelých Vrbovec 1890–1910', events: ['DEAT', 'BURI'], quality: 3, recordDate: '1902-01-12' },
            'src-birth': { id: 'src-birth', title: 'Kniha narozených Vrbovec 1840–1860', events: ['BIRT', 'CHR'], quality: 3, recordDate: '1851-03-03' },
            'src-census': { id: 'src-census', title: 'Sčítání lidu Vrbovec 1880', events: ['CENS'], quality: 2, recordDate: '1880-12-31' },
            'src-marr': { id: 'src-marr', title: 'Kniha oddaných Vrbovec 1870–1890', events: ['MARR'], quality: 3, recordDate: '1876-02-01' },
        },
    } as unknown as StromData;
}

/** The tree shown: no research, or a research saying these features. */
function shown(features?: string[]): void {
    vi.spyOn(TreeManager, 'getActiveTreeId').mockReturnValue(TREE);
    vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({
        id: TREE, name: 'T', ...(features ? { research: { id: 'r1', fingerprint: 'f', syncedAt: '2026-11-01' } } : {}),
    } as unknown as TreeMetadata);
    setCitationFeaturesLookup(id => (features && id === 'r1' ? features : null));
}

afterEach(() => {
    vi.restoreAllMocks();
    setCitationFeaturesLookup(() => null);
});

const withMain = (data: StromData, field: 'birthSourceIds' | 'deathSourceIds', id: string): StromData => {
    (data.persons[RADIM] as Person).citationMain = { [field]: id };
    return data;
};

describe('chips (M1–M3)', () => {
    it('the birth record first, then the other original, then by reliability; the automatic first has no mark (R2)', () => {
        shown();
        const data = tree();
        const birth = data.persons[RADIM].birthSourceIds;
        expect(chipCitations(data, birth, { personId: RADIM, fact: 'birth' })).toEqual({ ids: ['src-birth', 'src-death', 'src-census'] });
        // The death: its own record first.
        expect(chipCitations(data, data.persons[RADIM].deathSourceIds, { personId: RADIM, fact: 'death' }).ids).toEqual(['src-death', 'src-census']);
        // The wedding: the marriage record before the census listed first.
        expect(chipCitations(data, data.partnerships[U1].sourceIds, { partnershipId: U1 }).ids).toEqual(['src-marr', 'src-census']);
        // Without a context (a list not on a fact): the list's order.
        expect(chipCitations(data, birth).ids).toEqual(birth);
    });

    it('a main citation chosen: first and marked; a tree of a research without citations.main: no mark (R6)', () => {
        shown();
        const data = withMain(tree(), 'birthSourceIds', 'src-census');
        const ctx = { personId: RADIM, fact: 'birth' as const };
        expect(chipCitations(data, data.persons[RADIM].birthSourceIds, ctx)).toEqual({ ids: ['src-census', 'src-birth', 'src-death'], main: 'src-census' });
        vi.restoreAllMocks();
        shown(['origin.ids']);
        expect(chipCitations(data, data.persons[RADIM].birthSourceIds, ctx).main).toBeUndefined();
        vi.restoreAllMocks();
        shown([CITATIONS_MAIN_FEATURE]);
        expect(chipCitations(data, data.persons[RADIM].birthSourceIds, ctx).main).toBe('src-census');
    });

    it('a research that orders its citations itself: the list\'s order, only the main citation first', () => {
        shown([CITATIONS_ORDER_FEATURE, CITATIONS_MAIN_FEATURE]);
        const data = tree();
        const ctx = { personId: RADIM, fact: 'birth' as const };
        expect(chipCitations(data, data.persons[RADIM].birthSourceIds, ctx).ids).toEqual(['src-death', 'src-birth', 'src-census']);
        withMain(data, 'birthSourceIds', 'src-census');
        expect(chipCitations(data, data.persons[RADIM].birthSourceIds, ctx).ids).toEqual(['src-census', 'src-death', 'src-birth']);
    });
});

describe('bubbles (M4, M5)', () => {
    it('the fact\'s bubble: rows in the K1.1 order, the main one "★ main"; the record the value was read from stays first', () => {
        shown();
        const data = withMain(tree(), 'birthSourceIds', 'src-death');
        const m = factSourcesModel(data, data.persons[RADIM], 'birth', null, RADIM);
        expect(m.rows.map(r => r.source.id)).toEqual(['src-death', 'src-birth', 'src-census']);
        expect(m.rows.map(r => !!r.main)).toEqual([true, false, false]);
        const html = sourceSubHtml(m.rows[0]);
        expect(html).toContain('class="st-src-main"');
        expect(html).toContain(`aria-label="${strings.sources.mainMark}"`);
        expect(html).toContain(`★︎ ${strings.sources.mainShort}</span> · `);
        expect(sourceSubHtml(m.rows[1])).not.toContain('st-src-main');
        // Not cited, the research's value from it: first, the rest in the K1.1 order (three rows, then "and 1 more").
        data.sources!['src-read'] = { id: 'src-read', title: 'Výpis z matriky' } as never;
        const r = { step: 'proven', dots: 1, sourceIds: ['src-read'] } as never;
        const read = factSourcesModel(data, data.persons[RADIM], 'birth', r, RADIM);
        expect(read.rows.map(x => x.source.id)).toEqual(['src-read', 'src-death', 'src-birth']);
        expect(read.more?.sourceIds).toEqual(['src-read', 'src-death', 'src-birth', 'src-census']);
    });

    it('without citations.main no row says main; the automatic first never does', () => {
        shown(['origin.ids']);
        const data = withMain(tree(), 'birthSourceIds', 'src-death');
        const m = factSourcesModel(data, data.persons[RADIM], 'birth', null, RADIM);
        expect(m.rows.some(r => r.main)).toBe(false);
        vi.restoreAllMocks();
        shown();
        const auto = factSourcesModel(tree(), tree().persons[RADIM], 'birth', null, RADIM);
        expect(auto.rows[0].source.id).toBe('src-birth');
        expect(auto.rows.some(r => r.main)).toBe(false);
    });

    it('the card\'s bubble: by first appearance at the name, the birth, the death; ★ after the fact whose main citation it is', () => {
        shown();
        const data = withMain(tree(), 'deathSourceIds', 'src-census');
        const status = { cls: 'cs-proven', source: 'step', facts: ['birth', 'death'] } as unknown as CardStatus;
        const m = cardSourcesModel(data, data.persons[RADIM], status);
        expect(m.rows.map(r => r.source.id)).toEqual(['src-birth', 'src-death', 'src-census']);
        const census = m.rows[2];
        const fact = strings.reliability.cardFact;
        expect(census.facts).toEqual([{ label: fact.birth, main: false }, { label: fact.death, main: true }]);
        const html = sourceSubHtml(census);
        expect(html).toContain(`${fact.birth}, ${fact.death}&nbsp;<span class="st-src-main" role="img" aria-label="${strings.sources.mainMark}">`);
        expect(sourceSubHtml(m.rows[0])).not.toContain('st-src-main');
    });

    it('the card\'s mark from the family tree: its head only over the name\'s citations, the registers at the birth and death under their own (K048)', () => {
        shown();
        const data = tree();
        data.sources!['src-ged'] = { id: 'src-ged', title: 'Rodokmen Ostružníků' } as never;
        (data.persons[RADIM] as Person).sourceIds = ['src-ged'];
        const s = strings.reliability;
        const status = { cls: 'cs-import', source: 'step', step: { step: 'import' }, facts: ['name'] } as unknown as CardStatus;
        const m = cardSourcesModel(data, data.persons[RADIM], status);
        expect(m.head).toBe(s.citedInImportHead);
        expect(m.rows.map(r => r.source.id)).toEqual(['src-ged']);
        expect(m.rest?.head).toBe(s.srcN(3));
        expect(m.rest?.rows.map(r => r.source.id)).toEqual(['src-birth', 'src-death']);
        expect(m.more?.sourceIds).toEqual(['src-ged', 'src-birth', 'src-death', 'src-census']);
        // A register cited at the name and at the birth is not only the family tree's.
        (data.persons[RADIM] as Person).sourceIds = ['src-ged', 'src-birth'];
        const both = cardSourcesModel(data, data.persons[RADIM], status);
        expect(both.rows.map(r => r.source.id)).toEqual(['src-ged']);
        expect(both.rest?.rows.map(r => r.source.id)).toEqual(['src-birth', 'src-death']);
        // Only the name's citations: one head, no second block.
        const nameOnly = tree();
        nameOnly.sources!['src-ged'] = { id: 'src-ged', title: 'Rodokmen Ostružníků' } as never;
        const p = nameOnly.persons[RADIM] as Person;
        p.sourceIds = ['src-ged'];
        p.birthSourceIds = [];
        p.deathSourceIds = [];
        const one = cardSourcesModel(nameOnly, p, status);
        expect(one.head).toBe(s.citedInImportHead);
        expect(one.rest).toBeUndefined();
        // No citation at the name: the registers under their count, never "cited in the family tree".
        const none = cardSourcesModel(tree(), tree().persons[RADIM], status);
        expect(none.head).toBe(s.srcN(3));
        expect(none.rows.map(r => r.source.id)).toEqual(['src-birth', 'src-death', 'src-census']);
    });

    it('a fact\'s citations (factCitations) in the order shown, the main one flagged', () => {
        shown();
        const data = withMain(tree(), 'birthSourceIds', 'src-census');
        const cites = factCitations(data, data.persons[RADIM], 'birth');
        expect(cites.map(c => c.source.id)).toEqual(['src-census', 'src-birth', 'src-death']);
        expect(cites.map(c => !!c.main)).toEqual([true, false, false]);
    });
});

describe('person\'s sources (M6)', () => {
    it('the rows as before; the fact\'s label flags its main citation, the person\'s own citations never', () => {
        shown();
        const data = withMain(tree(), 'birthSourceIds', 'src-census');
        (data.persons[RADIM] as Person).sourceIds = ['src-census'];
        const rows = personSourceRows(data, RADIM);
        const census = rows.find(r => r.source.id === 'src-census')!;
        const birth = census.cites.find(c => 'personId' in c.ctx && c.ctx.fact === 'birth')!;
        expect(birth.main).toBe(true);
        const own = census.cites.find(c => 'personId' in c.ctx && !c.ctx.fact && !c.ctx.eventId)!;
        expect(own.main).toBeUndefined();
        const death = census.cites.find(c => 'personId' in c.ctx && c.ctx.fact === 'death')!;
        expect(death.main).toBeUndefined();
        expect(rows.flatMap(r => r.cites).filter(c => c.main)).toHaveLength(1);
    });
});

describe('the first citation elsewhere (M9, the book, Verify)', () => {
    it('the book numbers a fact\'s sources in the K1.1 order: the birth record P1', () => {
        shown();
        const data = tree();
        const book = new BookSourceNumbers(data.sources!, true);
        const p = data.persons[RADIM];
        expect(book.citeAt(p, { personId: RADIM, fact: 'birth' }, p.birthSourceIds)).toBe(
            '<sup class="book-p">P1</sup><sup class="book-p">P2</sup><sup class="book-p">P3</sup>');
        expect(book.no.get('src-birth')).toBe(1);
        expect(book.no.get('src-death')).toBe(2);
        const u = data.partnerships[U1];
        book.citeAt(u, { partnershipId: U1 }, u.sourceIds);
        expect(book.no.get('src-marr')).toBe(4);
    });

    it('Verify\'s first source of a fact: the birth record', () => {
        shown();
        const data = tree();
        expect(factSourceIds(data.persons[RADIM], 'birth', data)[0]).toBe('src-birth');
        // Without the sources: the list as it is.
        expect(factSourceIds(data.persons[RADIM], 'birth')[0]).toBe('src-death');
    });
});

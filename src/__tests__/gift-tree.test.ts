import { describe, it, expect } from 'vitest';
import { getDemoTree } from '../demo-tree.js';
import type { Gender, Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { buildLineages } from '../lineage.js';
import {
    GIFT_DEPTHS, defaultGiftPrivacy, giftBranchCandidates, giftCutData, giftCutIds, giftDepthCounts, giftHouseholdIds,
    giftProtectedData, type GiftCut, type GiftDepth,
} from '../gift-tree.js';
import { decomposeIntoFamilies } from '../split-families.js';
import { syntheticBigFamily } from './helpers/synthetic-big-family.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';

const P = (key: string) => `demo_${key}` as PersonId;

function addPerson(data: StromData, key: string, firstName: string, lastName: string, gender: Gender, opts: Partial<Person> = {}): PersonId {
    const id = P(key);
    data.persons[id] = { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...opts };
    return id;
}

function addUnion(data: StromData, key: string, a: PersonId, b: PersonId, children: PersonId[] = [], extra: Partial<Partnership> = {}): PartnershipId {
    const id = `demo_u_${key}` as PartnershipId;
    data.partnerships[id] = { id, person1Id: a, person2Id: b, childIds: [...children], status: 'married', ...extra };
    for (const p of [a, b]) data.persons[p].partnerships.push(id);
    for (const ch of children) {
        for (const p of [a, b]) {
            if (!data.persons[p].childIds.includes(ch)) data.persons[p].childIds.push(ch);
            if (!data.persons[ch].parentIds.includes(p)) data.persons[ch].parentIds.push(p);
        }
    }
    return id;
}

/** The demo tree (Berg family) with invented additions so each depth adds people. */
function giftTree(): StromData {
    const d = getDemoTree();
    // Eva and Jonas: a daughter (a first cousin of Daniel); Jonas: a son of an earlier union (Eva's stepson).
    const liv = addPerson(d, 'liv', 'Liv', 'Holm', 'female', { birthDate: '1990-03-02' });
    d.persons[P('eva')].childIds.push(liv);
    d.persons[P('jonas')].childIds.push(liv);
    d.persons[liv].parentIds = [P('jonas'), P('eva')];
    const evaUnion = d.persons[P('eva')].partnerships[0];
    d.partnerships[evaUnion].childIds.push(liv);
    const exJonas = addPerson(d, 'mette', 'Mette', 'Varnholt', 'female', { birthDate: '1950' });
    const arvid = addPerson(d, 'arvid', 'Arvid', 'Holm', 'male', { birthDate: '1975' });
    addUnion(d, 'jonas_mette', P('jonas'), exJonas, [arvid], { status: 'divorced' });
    // Clara (Thomas's sister): a husband and a son (second cousins' line).
    const oskar = addPerson(d, 'oskar', 'Oskar', 'Dahl', 'male', { birthDate: '1909', deathDate: '1980' });
    const nils = addPerson(d, 'nils', 'Nils', 'Dahl', 'male', { birthDate: '1940', deathDate: '2010' });
    addUnion(d, 'clara_oskar', P('clara_b'), oskar, [nils]);
    // Sofia and Paul (David's sister): a daughter — only with "all".
    const greta = addPerson(d, 'greta', 'Greta', 'Walker', 'female', { birthDate: '1912', deathDate: '1990' });
    const sofiaUnion = d.persons[P('sofia')].partnerships[0];
    d.partnerships[sofiaUnion].childIds.push(greta);
    for (const p of [P('sofia'), P('paul')]) { d.persons[p].childIds.push(greta); d.persons[greta].parentIds.push(p); }
    // Julia: a son of an earlier union (Daniel's stepson, D5) and her parents (a partner's ancestors).
    const rune = addPerson(d, 'rune', 'Rune', 'Stenmark', 'male', { birthDate: '1970' });
    const viktor = addPerson(d, 'viktor', 'Viktor', 'Stenmark', 'male', { birthDate: '1995' });
    addUnion(d, 'julia_rune', rune, P('julia'), [viktor], { status: 'divorced' });
    const ingrid = addPerson(d, 'ingrid', 'Ingrid', 'Novak', 'female', { birthDate: '1950' });
    const bruno = addPerson(d, 'bruno', 'Bruno', 'Novak', 'male', { birthDate: '1948' });
    addUnion(d, 'novak', bruno, ingrid, [P('julia')]);
    // Rosa Rossi (Erik's second wife): her father — a partner of an ancestor's ancestor.
    const marco = addPerson(d, 'marco', 'Marco', 'Rossi', 'male', { birthDate: '1830', deathDate: '1900' });
    d.persons[P('rosa')].parentIds.push(marco);
    d.persons[marco].childIds.push(P('rosa'));
    // An island.
    addPerson(d, 'zora', 'Zora', 'Varnholt', 'female', { birthDate: '1960' });
    return d;
}

const cutOf = (recipients: string[], depth: GiftDepth = 2, branches: Record<string, boolean> = {}): GiftCut =>
    ({ recipients: recipients.map(P), depth, branches: Object.fromEntries(Object.entries(branches).map(([k, v]) => [P(k), v])) as Record<PersonId, boolean> });

const keys = (ids: Iterable<PersonId>) => [...ids].map(id => id.replace(/^demo_/, '')).sort();

/** Everyone in Daniel's cut at every depth. */
const DANIEL_CORE = [
    // Daniel, his wife, children and stepson (D5).
    'daniel', 'julia', 'adam', 'nora', 'viktor',
    // The direct line with the ancestors' partners (Erik's second wife Rosa).
    'martin', 'sarah', 'thomas', 'lena', 'david', 'emma', 'erik', 'laura', 'rosa', 'johan', 'ida', 'peter', 'maria', 'kari',
    // The ancestors' siblings, alone with their partners.
    'eva', 'jonas', 'clara_b', 'oskar', 'sofia', 'paul', 'leo', 'hanna', 'simon', 'clara', 'karl',
];

describe('giftCutIds — Daniel Berg in the demo tree', () => {
    const data = giftTree();
    const index = buildLineages(data);

    it('depth 0: the line, the household, the ancestors\' siblings alone with partners', () => {
        expect(keys(giftCutIds(index, cutOf(['daniel'], 0)))).toEqual([...DANIEL_CORE].sort());
    });

    it('depth 1 adds the first cousins (Eva\'s daughter Liv)', () => {
        expect(keys(giftCutIds(index, cutOf(['daniel'], 1)))).toEqual([...DANIEL_CORE, 'liv'].sort());
    });

    it('depth 2 adds the families of the grandparents\' siblings (Clara\'s son Nils)', () => {
        expect(keys(giftCutIds(index, cutOf(['daniel'], 2)))).toEqual([...DANIEL_CORE, 'liv', 'nils'].sort());
    });

    it('depth "all" adds every family of the ancestors\' siblings (Greta, adopted Alma)', () => {
        expect(keys(giftCutIds(index, cutOf(['daniel'], 'all')))).toEqual([...DANIEL_CORE, 'liv', 'nils', 'greta', 'alma'].sort());
    });

    it('counts grow with the depth and giftDepthCounts equals the cuts', () => {
        const counts = giftDepthCounts(index, cutOf(['daniel']));
        const sizes = GIFT_DEPTHS.map(d => giftCutIds(index, cutOf(['daniel'], d)).size);
        expect(GIFT_DEPTHS.map(d => counts[d])).toEqual(sizes);
        expect(sizes).toEqual([30, 31, 32, 34]);
    });

    it('never takes partners\' ancestors, a partner\'s other children of an ancestor family, placeholders or islands', () => {
        const all = giftCutIds(index, cutOf(['daniel'], 'all'));
        // Julia's parents; Rosa Rossi stays but her father does not.
        for (const k of ['ingrid', 'bruno', 'marco']) expect(all.has(P(k))).toBe(false);
        // Jonas's son of an earlier union is Eva's stepson — not in an ancestor family (D5).
        expect(all.has(P('arvid'))).toBe(false);
        // Julia's former husband comes only as glue in the data, never in the cut.
        expect(all.has(P('rune'))).toBe(false);
        expect(all.has(P('ida_father'))).toBe(false);
        expect(all.has(P('zora'))).toBe(false);
        expect(all.has(P('mette'))).toBe(false);
    });

    it('works on the data and on the lineage index alike', () => {
        expect(keys(giftCutIds(data, cutOf(['daniel'])))).toEqual(keys(giftCutIds(index, cutOf(['daniel']))));
    });
});

describe('branches', () => {
    const data = giftTree();
    const index = buildLineages(data);

    it('an unticked sibling stays with partners, without the family', () => {
        const ids = giftCutIds(index, cutOf(['daniel'], 2, { eva: false }));
        expect(ids.has(P('eva'))).toBe(true);
        expect(ids.has(P('jonas'))).toBe(true);
        expect(ids.has(P('liv'))).toBe(false);
    });

    it('a ticked sibling beyond the depth brings the family along', () => {
        const ids = giftCutIds(index, cutOf(['daniel'], 2, { sofia: true }));
        expect(ids.has(P('greta'))).toBe(true);
        expect(ids.has(P('alma'))).toBe(false);
    });

    it('depth counts carry the exceptions', () => {
        const cut = cutOf(['daniel'], 2, { sofia: true, eva: false });
        const counts = giftDepthCounts(index, cut);
        for (const d of GIFT_DEPTHS) expect(counts[d]).toBe(giftCutIds(index, { ...cut, depth: d }).size);
        expect(counts[0]).toBe(31); // core + Greta
    });

    it('giftBranchCandidates lists the ancestors\' siblings with their counts', () => {
        const list = giftBranchCandidates(index, cutOf(['daniel']));
        const byKey = new Map(list.map(b => [b.siblingId.replace(/^demo_/, ''), b]));
        expect([...byKey.keys()].sort()).toEqual(['clara', 'clara_b', 'eva', 'hanna', 'karl', 'leo', 'sofia']);
        // Ordered by generation.
        expect(list.map(b => b.generation)).toEqual([...list.map(b => b.generation)].sort((a, b) => a - b));
        expect(byKey.get('eva')).toMatchObject({ ancestorId: P('martin'), generation: 1, aloneCount: 2, familyCount: 3, included: true, half: false, otherParentId: null });
        expect(byKey.get('clara_b')).toMatchObject({ ancestorId: P('thomas'), generation: 2, aloneCount: 2, familyCount: 3, included: true });
        expect(byKey.get('sofia')).toMatchObject({ generation: 3, aloneCount: 2, familyCount: 3, included: false });
        // Leo: David's half-brother through Rosa Rossi.
        expect(byKey.get('leo')).toMatchObject({ ancestorId: P('david'), generation: 3, half: true, otherParentId: P('rosa'), aloneCount: 1, familyCount: 1 });
        expect(byKey.get('hanna')).toMatchObject({ generation: 4, familyCount: 3, included: false });
        expect(byKey.get('karl')).toMatchObject({ generation: 5, aloneCount: 1, familyCount: 1 });
    });

    it('a candidate follows the exceptions', () => {
        const list = giftBranchCandidates(index, cutOf(['daniel'], 2, { eva: false, hanna: true }));
        expect(list.find(b => b.siblingId === P('eva'))!.included).toBe(false);
        expect(list.find(b => b.siblingId === P('hanna'))!.included).toBe(true);
    });
});

describe('a couple, no ancestors, the household', () => {
    const data = giftTree();
    const index = buildLineages(data);

    it('a couple\'s cut is the union of both', () => {
        const eva = giftCutIds(index, cutOf(['eva']));
        const jonas = giftCutIds(index, cutOf(['jonas']));
        const both = giftCutIds(index, cutOf(['eva', 'jonas']));
        expect(keys(both)).toEqual(keys(new Set([...eva, ...jonas])));
        // Each recipient's stepchildren (D5): Arvid is Jonas's son, Eva's stepson.
        expect(eva.has(P('arvid'))).toBe(true);
        expect(both.has(P('mette'))).toBe(true);
    });

    it('a person without ancestors: themselves, partners and descendants; every depth the same', () => {
        expect(keys(giftCutIds(index, cutOf(['jonas'])))).toEqual(['arvid', 'eva', 'jonas', 'liv', 'mette']);
        const counts = giftDepthCounts(index, cutOf(['jonas']));
        expect(new Set(GIFT_DEPTHS.map(d => counts[d])).size).toBe(1);
        expect(giftBranchCandidates(index, cutOf(['jonas']))).toEqual([]);
    });

    it('household: recipient, current partner, children — not a former partner or a stepchild', () => {
        expect(keys(giftHouseholdIds(data, [P('daniel')]))).toEqual(['adam', 'daniel', 'julia', 'nora']);
        expect(keys(giftHouseholdIds(data, [P('jonas')]))).toEqual(['arvid', 'eva', 'jonas', 'liv']);
    });

    it('a couple\'s household: both and the children of each', () => {
        expect(keys(giftHouseholdIds(data, [P('eva'), P('jonas')]))).toEqual(['arvid', 'eva', 'jonas', 'liv']);
    });

    it('giftCutData opens on the recipient and glues a stepchild\'s other parent', () => {
        const sub = giftCutData(index, cutOf(['daniel']));
        expect(sub.defaultPersonId).toBe(P('daniel'));
        expect(sub.persons[P('rune')]).toBeDefined();
        expect(sub.persons[P('ingrid')]).toBeUndefined();
        expect(sub.persons[P('zora')]).toBeUndefined();
    });
});

describe('the perspective split cut', () => {
    it('differs from the gift cut by design (recorded, not matched)', () => {
        const data = giftTree();
        const base = decomposeIntoFamilies(data, P('daniel'), 'perspective', { baseIds: [P('daniel')], cousinDepth: 2 })[0];
        const persp = new Set(base.personIds.filter(id => !data.persons[id].isPlaceholder));
        const gift = giftCutIds(data, cutOf(['daniel'], 2));
        // The perspective tree takes stepchildren along in every family kept
        // (Eva's stepson Arvid) and the spouses of spouses (Julia's former
        // husband, Jonas's former wife) and leaves a cut-off
        // sibling without partners; the gift takes the ancestors' other
        // partners (Rosa Rossi), the partners of every ancestor's sibling
        // (Paul, Simon) and keeps stepchildren to the recipient's own (D5).
        expect(keys([...gift].filter(id => !persp.has(id)))).toEqual(['paul', 'rosa', 'simon']);
        expect(keys([...persp].filter(id => !gift.has(id)))).toEqual(['arvid', 'mette', 'rune']);
    });
});

describe('giftProtectedData (D4, K6)', () => {
    const YEAR = 2026;
    const EMAIL = 'eva.test@example.invalid';
    const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';

    function sensitiveTree(): StromData {
        const d = giftTree();
        const eva = d.persons[P('eva')];
        eva.emails = [EMAIL];
        eva.notes = `Visits every summer.\nE-mail: ${EMAIL}`;
        eva.birthAddress = 'Elm Street 12';
        eva.photo = PHOTO;
        const daniel = d.persons[P('daniel')];
        daniel.emails = [EMAIL];
        daniel.birthAddress = 'Harbour Road 7';
        daniel.notes = 'Collects old maps.';
        daniel.photo = PHOTO;
        daniel.events = [...(daniel.events ?? []), { id: 'ev_rel', type: 'religion', note: 'Lutheran' }];
        d.persons[P('thomas')].photo = PHOTO;
        return d;
    }

    const json = (x: unknown) => JSON.stringify(x);

    it('the defaults: household in full but without contacts and notes; others as initials; the deceased keep sources and photos', () => {
        const out = giftProtectedData(sensitiveTree(), cutOf(['daniel']), defaultGiftPrivacy(), { photos: true, currentYear: YEAR });
        expect(json(out)).not.toContain(EMAIL);
        const daniel = out.persons[P('daniel')];
        expect(daniel.firstName).toBe('Daniel');
        expect(daniel.birthDate).toBe('1972-05-30');
        expect(daniel.birthAddress).toBe('Harbour Road 7');
        expect(daniel.photo).toBe(PHOTO);
        expect(daniel.notes).toBeUndefined();
        expect(daniel.events?.some(e => e.type === 'religion')).toBe(true);
        expect(daniel.events?.some(e => e.type === 'residence')).toBe(true);
        // Eva is not of the household: initials and the year.
        const eva = out.persons[P('eva')];
        expect([eva.firstName, eva.lastName, eva.birthDate]).toEqual(['E.', 'B.', '1946']);
        expect(eva.birthAddress).toBeUndefined();
        expect(eva.photo).toBeUndefined();
        expect(json(out)).not.toContain('Elm Street');
        // The deceased keep their sources and photos.
        expect(out.persons[P('johan')].birthSourceIds?.length).toBe(1);
        expect(Object.keys(out.sources ?? {}).length).toBeGreaterThan(0);
        expect(out.persons[P('thomas')].photo).toBe(PHOTO);
        expect(out.persons[P('johan')].deathCause).toBeTruthy();
        // A couple with a living partner shown in full keeps its date; one with an obscured partner does not.
        const danielUnion = out.persons[P('daniel')].partnerships.map(u => out.partnerships[u]).find(u => u.person1Id === P('julia') || u.person2Id === P('julia'))!;
        expect(danielUnion.startDate).toBe('2001-06-16');
        const martinUnion = out.persons[P('martin')].partnerships.map(u => out.partnerships[u])[0];
        expect(martinUnion.startDate).toBe('1969');
    });

    it('an exception is shown in full, its sensitive details masked by the choices', () => {
        const privacy = { ...defaultGiftPrivacy(), fullIds: [P('eva')] };
        const out = giftProtectedData(sensitiveTree(), cutOf(['daniel']), privacy, { photos: true, currentYear: YEAR });
        const eva = out.persons[P('eva')];
        expect([eva.firstName, eva.lastName, eva.birthDate]).toEqual(['Eva', 'Berg', '1946-12-01']);
        expect(eva.birthAddress).toBe('Elm Street 12');
        expect(eva.emails).toBeUndefined();
        expect(eva.notes).toBeUndefined();
        expect(json(out)).not.toContain(EMAIL);
    });

    it('each sensitive kind off hides it from the people shown in full', () => {
        const privacy = defaultGiftPrivacy();
        privacy.sensitive = { birthDates: false, addresses: false, contacts: false, photos: false, notes: false, religion: false, sources: false };
        const out = giftProtectedData(sensitiveTree(), cutOf(['daniel']), privacy, { photos: true, currentYear: YEAR });
        const daniel = out.persons[P('daniel')];
        expect(daniel.firstName).toBe('Daniel');
        expect(daniel.birthDate).toBe('1972');
        expect(daniel.birthAddress).toBeUndefined();
        expect(daniel.photo).toBeUndefined();
        expect(daniel.events?.some(e => e.type === 'residence')).toBeFalsy();
        expect(daniel.events?.some(e => e.type === 'religion')).toBeFalsy();
        expect(json(out)).not.toContain('Harbour Road');
        expect(json(out)).not.toContain('Lutheran');
        // The deceased are not touched by the living's choices.
        expect(out.persons[P('thomas')].photo).toBe(PHOTO);
        expect(out.persons[P('johan')].birthSourceIds?.length).toBe(1);
    });

    it('contacts on keep the e-mail of those shown in full', () => {
        const privacy = defaultGiftPrivacy();
        privacy.sensitive.contacts = true;
        const out = giftProtectedData(sensitiveTree(), cutOf(['daniel']), privacy, { photos: true, currentYear: YEAR });
        expect(out.persons[P('daniel')].emails).toEqual([EMAIL]);
        expect(out.persons[P('eva')].emails).toBeUndefined();
    });

    it('the deceased\'s choices: causes, notes and sources off', () => {
        const privacy = defaultGiftPrivacy();
        privacy.dead = { causes: false, notes: false, sources: false };
        const out = giftProtectedData(sensitiveTree(), cutOf(['daniel']), privacy, { photos: true, currentYear: YEAR });
        expect(out.persons[P('johan')].deathCause).toBeUndefined();
        expect(out.persons[P('johan')].birthSourceIds).toBeUndefined();
        expect(out.persons[P('clara')].notes).toBeUndefined();
        expect(Object.keys(out.sources ?? {})).toEqual([]);
        // Photos of the deceased stay.
        expect(out.persons[P('thomas')].photo).toBe(PHOTO);
    });

    it('without photos no person has an image', () => {
        const out = giftProtectedData(sensitiveTree(), cutOf(['daniel']), defaultGiftPrivacy(), { photos: false, currentYear: YEAR });
        expect(Object.values(out.persons).some(p => p.photo)).toBe(false);
        expect(out.media === undefined || Object.keys(out.media).length === 0).toBe(true);
        expect(json(out)).not.toContain('data:image');
    });

    it('others: anonymous and full', () => {
        const anon = giftProtectedData(sensitiveTree(), cutOf(['daniel']), { ...defaultGiftPrivacy(), others: 'anonymous' }, { photos: true, currentYear: YEAR });
        expect(anon.persons[P('eva')].lastName).toBe('');
        expect(anon.persons[P('eva')].birthDate).toBeUndefined();
        expect(anon.persons[P('daniel')].firstName).toBe('Daniel');
        const full = giftProtectedData(sensitiveTree(), cutOf(['daniel']), { ...defaultGiftPrivacy(), others: 'full' }, { photos: true, currentYear: YEAR });
        // Everyone living in full — still under the masks.
        expect(full.persons[P('eva')].firstName).toBe('Eva');
        expect(full.persons[P('eva')].emails).toBeUndefined();
        expect(json(full)).not.toContain(EMAIL);
    });

    it('the research\'s workshop and the tree outside the cut never come along', () => {
        const d = sensitiveTree();
        d.persons[P('thomas')].research = { places: [{ role: 'line' }] } as Person['research'];
        const out = giftProtectedData(d, cutOf(['daniel']), defaultGiftPrivacy(), { photos: true, currentYear: YEAR });
        expect(out.persons[P('thomas')].research?.places).toBeUndefined();
        expect(out.persons[P('zora')]).toBeUndefined();
        expect(out.defaultPersonId).toBe(P('daniel'));
    });
});

describe('performance', () => {
    it('cut and depth counts of a 600+ person tree within the budget', () => {
        const data = syntheticBigFamily();
        expect(Object.keys(data.persons).length).toBeGreaterThan(600);
        const index = buildLineages(data);
        const cut: GiftCut = { recipients: ['z' as PersonId], depth: 2, branches: {} };
        expect(giftCutIds(index, cut).size).toBeGreaterThan(100);
        const BUDGET_MS = 1000;
        const m = measureAgainstBudget(() => { giftCutIds(index, cut); giftDepthCounts(index, cut); giftBranchCandidates(index, cut); }, {
            budgetMs: BUDGET_MS, calibrationRounds: 4, referenceMs: 22, minPairs: 3, maxPairs: 10, maxWallMs: 30_000,
        });
        console.log(budgetReport(`gift cut, depth counts and branches, ${Object.keys(data.persons).length} people`, m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 120_000);
});

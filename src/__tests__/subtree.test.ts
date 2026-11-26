import { describe, it, expect } from 'vitest';
import { extractSubtree, subtreeGlueCount, subtreePersonIds } from '../subtree.js';
import { getStringsForLang } from '../strings.js';
import { StromData, Person, PersonId, PartnershipId } from '../types.js';

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'X', gender: 'male',
        isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o,
    };
}

/**
 *   gpa ─┬─ gma          (grandparents)
 *       dad ─┬─ mom      (mom is off-screen initially)
 *          me ─ kid      (me + kid visible)
 */
function sample(): StromData {
    const persons: Record<string, Person> = {};
    for (const id of ['gpa', 'gma', 'dad', 'mom', 'me', 'partner', 'kid']) persons[id] = person(id);
    persons.gma.gender = persons.mom.gender = persons.partner.gender = 'female';
    const P = (a: string, b: string, kids: string[], uid: string) => {
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
        for (const k of kids) { persons[k].parentIds = [a as PersonId, b as PersonId]; persons[a].childIds.push(k as PersonId); persons[b].childIds.push(k as PersonId); }
        return { [uid]: { id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' as const } };
    };
    const partnerships = { ...P('gpa', 'gma', ['dad'], 'u1'), ...P('dad', 'mom', ['me'], 'u2'), ...P('me', 'partner', ['kid'], 'u3') };
    return { persons: persons as StromData['persons'], partnerships };
}

describe('extractSubtree', () => {
    it('keeps exactly the seeds plus glue (missing parent of a kept child)', () => {
        // Visible: dad, me, partner, kid  (mom off-screen but is me's parent)
        const out = extractSubtree(sample(), new Set(['dad', 'me', 'partner', 'kid'] as PersonId[]));
        // mom is glued in because 'me' (a kept child of dad+mom) would else be half-orphaned.
        expect(Object.keys(out.persons).sort()).toEqual(['dad', 'kid', 'me', 'mom', 'partner']);
        // gpa/gma are NOT pulled in (dad's parents were not visible).
        expect(out.persons['dad' as PersonId].parentIds).toEqual([]);
    });

    it('drops relationships and partnerships pointing outside the kept set', () => {
        const out = extractSubtree(sample(), new Set(['me', 'partner', 'kid'] as PersonId[]));
        // me's parents (dad/mom) are gone → me becomes a root.
        expect(out.persons['me' as PersonId].parentIds).toEqual([]);
        // Only the me+partner union survives; u2 (dad+mom) is dropped.
        expect(Object.keys(out.partnerships)).toEqual(['u3']);
        expect(out.persons['me' as PersonId].partnerships).toEqual(['u3' as PartnershipId]);
    });

    it('produces a self-consistent tree (no dangling ids)', () => {
        const out = extractSubtree(sample(), new Set(['gpa', 'gma', 'dad'] as PersonId[]));
        const ids = new Set(Object.keys(out.persons));
        for (const p of Object.values(out.persons)) {
            p.parentIds.forEach(pid => expect(ids.has(pid)).toBe(true));
            p.childIds.forEach(cid => expect(ids.has(cid)).toBe(true));
        }
        for (const u of Object.values(out.partnerships)) {
            expect(ids.has(u.person1Id)).toBe(true);
            expect(ids.has(u.person2Id)).toBe(true);
            u.childIds.forEach(c => expect(ids.has(c)).toBe(true));
        }
    });
});

/**
 * Join › A selection (spec 139 §6.1): the step "who to take" counts the
 * chosen people; the guide gets the subtree with the partners glued to
 * chosen children. The step says how many come along and the guide's count.
 */
describe('the partners a selection brings along to the guide', () => {
    it('counts the glue extractSubtree adds: the step and the guide say the same total', () => {
        const data = sample();
        // A line of the men: dad, me and kid; mom and partner are the glue.
        const seeds = new Set(['dad', 'me', 'kid'] as PersonId[]);
        expect(subtreeGlueCount(data, seeds)).toBe(2);
        expect(seeds.size + subtreeGlueCount(data, seeds)).toBe(Object.keys(extractSubtree(data, seeds).persons).length);
        expect([...subtreePersonIds(data, seeds)].sort()).toEqual(Object.keys(extractSubtree(data, seeds).persons).sort());
    });

    it('nothing when nobody comes along, and a "?" stand-in is not counted', () => {
        const data = sample();
        expect(subtreeGlueCount(data, new Set(['me', 'partner', 'kid'] as PersonId[]))).toBe(0);
        data.persons['mom' as PersonId].isPlaceholder = true;
        expect(subtreeGlueCount(data, new Set(['dad', 'me'] as PersonId[]))).toBe(0);
    });

    it('says it in every language, with the plural forms', () => {
        const say = (lang: 'cs' | 'en' | 'de' | 'pl', n: number) => {
            const s = getStringsForLang(lang);
            return s.structure.joinPartners(n, s.treeManager.persons(7 + n));
        };
        expect(say('en', 1)).toBe('With them comes 1 partner too, the other parent of a chosen child – 8 people in all.');
        expect(say('en', 2)).toBe('With them come 2 partners too, the other parents of chosen children – 9 people in all.');
        expect(say('cs', 1)).toBe('S nimi přejde i 1 partner, druhý rodič vybraného dítěte – celkem 8 osob.');
        expect(say('cs', 2)).toBe('S nimi přejdou i 2 partneři, druzí rodiče vybraných dětí – celkem 9 osob.');
        expect(say('cs', 5)).toBe('S nimi přejde i 5 partnerů, druhých rodičů vybraných dětí – celkem 12 osob.');
        expect(say('de', 1)).toBe('Mit ihnen kommt auch 1 Partner mit, der andere Elternteil eines gewählten Kindes – insgesamt 8 Personen.');
        expect(say('de', 2)).toBe('Mit ihnen kommen auch 2 Partner mit, die anderen Elternteile gewählter Kinder – insgesamt 9 Personen.');
        expect(say('pl', 1)).toBe('Razem z nimi przejdzie też partner – drugi rodzic wybranego dziecka, łącznie 8 osób.');
        expect(say('pl', 2)).toBe('Razem z nimi przejdą też ich partnerzy (2) – drudzy rodzice wybranych dzieci, łącznie 9 osób.');
    });
});

describe('the scoped data of Export (spec 093 §10)', () => {
    it('keeps only the scope’s people and opens on its person', async () => {
        const { scopedExportData } = await import('../subtree.js');
        const d = sample();
        const out = scopedExportData(d, { ids: new Set(['dad', 'mom', 'me'] as PersonId[]), defaultPersonId: 'me' as PersonId });
        expect(Object.keys(out.persons).sort()).toEqual(['dad', 'me', 'mom']);
        expect(out.defaultPersonId).toBe('me');
        expect(Object.keys(out.partnerships)).toEqual(['u2']);
    });
});

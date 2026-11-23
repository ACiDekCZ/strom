/**
 * Material for a list of people (spec 137 §6–§7): the list's id for the
 * research, the snapshot sent before the files (≤ 50 / > 50 people, people the
 * research does not know yet, nobody known), the headers of each file, the
 * gates by the research's features and the info box's texts in every
 * language. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
    materialListRef, materialListFacts, materialListSnapshot, materialPersonHeader, MATERIAL_LIST_INLINE_MAX,
} from '../material-list.js';
import { uploadHeaders } from '../originals.js';
import { researchSendsLists, researchSendsSourceLists } from '../research-link.js';
import { materialListBoxText, type MaterialListBoxCase } from '../ui/material-ui.js';
import { getStringsForLang } from '../strings.js';
import type { PersonId, PersonList, StromData } from '../types.js';

const NOW = '2026-11-23T10:00:00.000Z';

/** `n` people: the first `known` have research numbers (P0001…), the rest none. */
function tree(n: number, known: number): { data: StromData; ids: PersonId[] } {
    const persons: Record<string, unknown> = {};
    const ids: PersonId[] = [];
    for (let i = 0; i < n; i++) {
        const id = `p${i + 1}` as PersonId;
        ids.push(id);
        persons[id] = { id, firstName: `Testo${i + 1}`, lastName: 'Vymyslený', gender: 'male', partnerships: [], parentIds: [], childIds: [],
            ...(i < known ? { refn: `P${String(i + 1).padStart(4, '0')}` } : {}) };
    }
    persons.dialog = { id: 'dialog', firstName: 'Jan', lastName: 'Dialogový', gender: 'male', partnerships: [], parentIds: [], childIds: [], refn: 'P0900' };
    return { data: { persons, partnerships: {} } as unknown as StromData, ids };
}

const fixed = (id = 'pl_k3x9_ab12'): PersonList => ({ id, name: 'Sčítání 1921 Mezihoř', dynamic: false, sort: 'manual', updated: NOW } as unknown as PersonList);
const auto = (): PersonList => ({ id: 'pl_k3x9_cd34', name: 'Rod Vymyšlených', dynamic: true, rule: { kind: 'rods', rodIds: ['r1'] }, sort: 'name', updated: NOW } as unknown as PersonList);

describe('the list id for the research', () => {
    it('keeps an id the research takes, hashes any other (stable, L + 24 hex)', () => {
        expect(materialListRef('added30')).toBe('added30');
        expect(materialListRef('abc-DEF-123')).toBe('abc-DEF-123');
        const ref = materialListRef('pl_k3x9_ab12');
        expect(ref).toMatch(/^L[0-9a-f]{24}$/);
        expect(ref).toBe(`L${createHash('sha256').update('pl_k3x9_ab12').digest('hex').slice(0, 24)}`);
        expect(materialListRef('pl_k3x9_ab12')).toBe(ref);
        expect(materialListRef('x'.repeat(65))).toMatch(/^L[0-9a-f]{24}$/);
    });
});

describe('the snapshot of a list at Send', () => {
    it('up to 50 people: every known person, the dialog person first, in each file', () => {
        const { data, ids } = tree(14, 12);
        const snap = materialListSnapshot({ list: fixed(), name: 'Sčítání 1921 Mezihoř', ids, data, dialogPersonId: 'dialog' as PersonId, now: NOW })!;
        expect(snap.ref).toMatch(/^L[0-9a-f]{24}$/);
        expect(snap.body.persons[0]).toBe('P0900');
        expect(snap.body.persons).toHaveLength(13);
        expect(snap.body).toMatchObject({ name: 'Sčítání 1921 Mezihoř', kind: 'fixed', missing: 2, at: NOW });
        expect(snap.body).not.toHaveProperty('rule');
        expect(snap.body).not.toHaveProperty('ruleData');
        expect(snap.personHeader).toBe(snap.body.persons.join(','));
    });

    it('the dialog person on the list is named once, first', () => {
        const { data, ids } = tree(5, 5);
        const snap = materialListSnapshot({ list: fixed(), name: 'L', ids, data, dialogPersonId: ids[3], now: NOW })!;
        expect(snap.body.persons).toEqual(['P0004', 'P0001', 'P0002', 'P0003', 'P0005']);
    });

    it('over 50 people: the list goes whole, each file names only the dialog person', () => {
        const { data, ids } = tree(MATERIAL_LIST_INLINE_MAX + 1, MATERIAL_LIST_INLINE_MAX + 1);
        const snap = materialListSnapshot({ list: auto(), name: 'Rod Vymyšlených', ids, data, dialogPersonId: 'dialog' as PersonId, ruleText: 'Rod Vymyšlených', now: NOW })!;
        expect(snap.body.persons).toHaveLength(52);
        expect(snap.personHeader).toBe('P0900');
        expect(snap.body).toMatchObject({ kind: 'auto', rule: 'Rod Vymyšlených', ruleData: { kind: 'rods', rodIds: ['r1'] } });
    });

    it('from a source: no dialog person; over 50 the files carry no person', () => {
        const { data, ids } = tree(60, 60);
        const snap = materialListSnapshot({ list: fixed(), name: 'L', ids, data, dialogPersonId: null, now: NOW })!;
        expect(snap.body.persons[0]).toBe('P0001');
        expect(snap.personHeader).toBe('');
        expect(materialPersonHeader(['P0001', 'P0002'], null, false)).toBe('P0001,P0002');
    });

    it('a list the research knows nobody of: no snapshot (the material goes to the person alone)', () => {
        const { data, ids } = tree(4, 0);
        expect(materialListSnapshot({ list: fixed(), name: 'L', ids, data, dialogPersonId: 'dialog' as PersonId, now: NOW })).toBeNull();
        expect(materialListFacts(data, ids)).toEqual({ count: 4, known: 0, missing: 4, big: false });
    });

    it('keeps the name and the rule within the research limits', () => {
        const { data, ids } = tree(2, 2);
        const snap = materialListSnapshot({ list: auto(), name: 'N'.repeat(300), ids, data, ruleText: 'R'.repeat(900), now: NOW })!;
        expect(snap.body.name).toHaveLength(200);
        expect(snap.body.rule).toHaveLength(500);
    });
});

describe('the headers of a file for a list', () => {
    it('carries the list and its people; never with a task or a family', () => {
        const list = { ref: 'Labc', personHeader: 'P0900,P0001' };
        expect(uploadHeaders({ mimeType: 'image/jpeg', name: 'a.jpg' }, { person: 'P0900' }, list))
            .toMatchObject({ 'X-Strom-Person': 'P0900,P0001', 'X-Strom-List-Ref': 'Labc' });
        expect(uploadHeaders({ mimeType: 'image/jpeg', name: 'a.jpg' }, { person: 'P0900', task: 'T0001' }, list))
            .not.toHaveProperty('X-Strom-List-Ref');
        // A source with a large list: the source and the list, no person.
        const h = uploadHeaders({ mimeType: 'image/jpeg', name: 'a.jpg' }, { source: 'S0001' }, { ref: 'Labc', personHeader: '' });
        expect(h).toMatchObject({ 'X-Strom-Source': 'S0001', 'X-Strom-List-Ref': 'Labc' });
        expect(h).not.toHaveProperty('X-Strom-Person');
    });
});

describe('the gates by the research features', () => {
    it('a person needs media.list; a source also media.list.source', () => {
        expect(researchSendsLists({ features: ['media.list'] })).toBe(true);
        expect(researchSendsLists({ features: ['media.links'] })).toBe(false);
        expect(researchSendsLists({ features: null })).toBe(false);
        expect(researchSendsLists(null)).toBe(false);
        expect(researchSendsSourceLists({ features: ['media.list'] })).toBe(false);
        expect(researchSendsSourceLists({ features: ['media.list.source'] })).toBe(false);
        expect(researchSendsSourceLists({ features: ['media.list', 'media.list.source'] })).toBe(true);
    });
});

describe('the info box for a list', () => {
    const facts = (count: number, known: number) => ({ count, known, missing: count - known, big: count > MATERIAL_LIST_INLINE_MAX });
    const box = (lang: 'cs' | 'en' | 'de' | 'pl', c: Partial<MaterialListBoxCase>) => {
        // The texts of the language without switching the app's language.
        const m = getStringsForLang(lang).material;
        const all: MaterialListBoxCase = { mode: 'agent', attach: 'none', source: false, auto: false, facts: facts(14, 14), ...c };
        const n = all.facts.count;
        const w = all.source ? (all.facts.big ? m.whereSourceListBig(n) : m.whereSourceList(n)) : (all.facts.big ? m.whereListBig(n) : m.whereList(n));
        return { m, w, all };
    };

    it('says where the files go, with the person in bold where the attachment goes', () => {
        expect(materialListBoxText({ mode: 'agent', attach: 'none', source: false, auto: false, facts: facts(14, 14) }, '#'))
            .toBe(getStringsForLang('en').material.infoAgentAt('with every person on the list (14)'));
        const { m } = box('en', {});
        expect(materialListBoxText({ mode: 'wait', attach: 'attach', source: false, auto: false, facts: facts(14, 14) }, '#'))
            .toBe(m.infoWaitAttachAt(m.whereList(14), '#'));
        expect(materialListBoxText({ mode: 'archive', attach: 'tree', source: false, auto: false, facts: facts(14, 14) }, '#'))
            .toBe(m.infoArchiveTreeAt(m.whereList(14), '#'));
    });

    it('over 50: the list as a whole, the rule or the people; unknown people counted', () => {
        const { m } = box('en', {});
        const big = materialListBoxText({ mode: 'agent', attach: 'none', source: true, auto: true, facts: facts(186, 180) }, '#');
        expect(big).toBe(`${m.infoAgentAt(m.whereSourceListBig(186))} ${m.bigRule} ${m.missingNote(6)}`);
        expect(big).toContain('186 people');
        expect(materialListBoxText({ mode: 'agent', attach: 'none', source: false, auto: false, facts: facts(60, 60) }, '#'))
            .toContain(m.bigPersons);
    });

    it('every language has every text of a list, impersonal', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const m = getStringsForLang(lang).material;
            const texts = [
                m.concern, m.concernPerson, m.concernSource, m.concernLists, m.sourceOnly, m.listEmpty, m.listFind, m.listUnknown,
                m.toList('X', 14), m.whereList(3), m.whereListBig(186), m.whereSourceList(3), m.whereSourceListBig(186),
                m.infoAgentAt('W'), m.infoWaitAt('W'), m.infoArchiveAt('W'),
                m.infoAgentAttachAt('W', 'P'), m.infoWaitAttachAt('W', 'P'), m.infoArchiveAttachAt('W', 'P'), m.infoArchiveTreeAt('W', 'P'),
                m.bigRule, m.bigPersons, m.missingNote(2), m.alsoAttachListHint('P'), m.alsoTreeListHint(1, 2, 'P'), m.listFailed,
                m.sentToastList(2, 'X', 14), m.sentWaitToastList(1, 'X'), m.sentWaitToastList(2, 'X'), m.savedArchiveToastList(2, 'X', 14),
            ];
            for (const t of texts) {
                expect(t.trim().length, lang).toBeGreaterThan(0);
                // German "sie" / "Sie" is also "they": only the English and Czech forms of address are checked.
                expect(t, lang).not.toMatch(/\b(you|your)\b|(^|\s)(vy|váš|vaše|vám)(\s|$)/i);
            }
            expect(m.infoAgentAttachAt('W', 'P')).toContain('W');
            expect(m.infoAgentAttachAt('W', 'P')).toContain('P');
        }
    });

    it('cs: plural forms of the people and files', () => {
        const m = getStringsForLang('cs').material;
        expect(m.toList('Sčítání 1921 Mezihoř', 14)).toBe('Seznam Sčítání 1921 Mezihoř · 14 osob');
        expect(m.whereListBig(3)).toBe('k seznamu (3 osoby)');
        expect(m.alsoTreeListHint(1, 2, 'P')).toContain('(1 ze 2)');
        expect(m.sentWaitToastList(1, 'X')).toContain('Čeká v Materiálech neroztříděný.');
    });
});

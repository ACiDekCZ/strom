/**
 * Another list in a list and references no longer in the tree (spec 136 §11),
 * and the version hints of added / changed (§15): which lists use a list
 * (asked before it is deleted), a list leading in a loop disabled in the
 * choice with the loop's path, a missing person, place or list drawn as the
 * stored name with "missing", and "Nothing yet" only when no person has the
 * time at all. Invented names only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { lineageIndexOf } from '../person-lists.js';
import { condMissing, listUsedBy } from '../person-list-rules.js';
import { ruleCondEditor, type RuleEditorCtx, type RulePickRow } from '../ui/person-list-rule-editors.js';
import '../ui/person-list-rule-cond-editors.js';
import '../ui/person-list-rule-near.js';
import '../ui/person-list-rule-family.js';
import { setLanguage } from '../strings.js';
import type { LineageIndex } from '../lineage.js';
import type { Person, PersonId, PersonList, RuleCond, StromData } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const id = (s: string) => s as PersonId;

function person(pid: string, firstName: string, extra: Partial<Person> = {}): Person {
    return { id: id(pid), firstName, lastName: 'Ostrovid', gender: 'female', partnerships: [], parentIds: [], childIds: [], ...extra } as Person;
}

function tree(persons: Person[], lists: PersonList[] = []): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {} as StromData['partnerships'],
        places: { 'mlynky': { lat: 49.5, lon: 15.0 } } as StromData['places'],
        personLists: lists,
    } as StromData;
}

const listCond = (target: string, name = target): RuleCond => ({ t: 'cond', c: 'list', p: { listId: target, listName: name } });

const listOf = (lid: string, name: string, target?: string): PersonList => ({
    id: lid, name, dynamic: false, personIds: [], sort: 'old', updated: '',
    ...(target ? { custom: { v: 1, auto: true, root: { t: 'group', op: 'all', items: [listCond(target)] } } } : {}),
});

function fakeCtx(index: LineageIndex, listId: string | null = null) {
    const menus: Array<{ title: string; rows: RulePickRow[] }> = [];
    const ctx: RuleEditorCtx = {
        path: '0', index, focusId: null, host: null, listId,
        key: (name) => `0:${name}`,
        update: () => {},
        menu: (_anchor, title, rows) => { menus.push({ title, rows }); },
        pickPerson: () => {},
    };
    return { ctx, menus };
}

const anchor = { dataset: { pc: 'list' } } as unknown as HTMLElement;

beforeEach(() => setLanguage('en'));
afterEach(() => { vi.restoreAllMocks(); });

describe('§11 another list in a list', () => {
    it('the lists whose rule uses a list, not the list itself', () => {
        const lists = [listOf('a', 'Millers', 'c'), listOf('b', 'Mill workers', 'c'), listOf('c', 'Neighbours', 'c'), listOf('d', 'Teachers')];
        expect(listUsedBy(lists, 'c').map(l => l.name)).toEqual(['Millers', 'Mill workers']);
        expect(listUsedBy(lists, 'd')).toEqual([]);
    });

    it('a list leading back is disabled in the choice with the loop, the others show their people', () => {
        const lists = [listOf('a', 'Millers', 'b'), listOf('b', 'Mill workers'), listOf('c', 'Neighbours', 'a')];
        lists[1].personIds = [id('p1')];
        const data = tree([person('p1', 'Bětka')], lists);
        vi.spyOn(DataManager, 'getPersonLists').mockReturnValue(lists);
        const ix = lineageIndexOf(data);
        // Editing "Mill workers": "Neighbours" → Millers → Mill workers would be a loop, and so would Millers.
        const { ctx, menus } = fakeCtx(ix, 'b');
        const cond = listCond('', '') as Extract<RuleCond, { c: 'list' }>;
        ruleCondEditor('list')!.click!(cond, anchor, ctx);
        const rows = menus[0].rows;
        expect(rows.map(r => r.label)).toEqual(['Millers', 'Neighbours']);
        expect(rows[0]).toMatchObject({ disabled: true, sub: 'would make a loop: Mill workers → Millers → Mill workers' });
        expect(rows[1]).toMatchObject({ disabled: true, sub: 'would make a loop: Mill workers → Neighbours → Millers → Mill workers' });
        // Editing "Neighbours": both others can be chosen; the value is the list's people.
        const other = fakeCtx(ix, 'c');
        ruleCondEditor('list')!.click!(cond, anchor, other.ctx);
        expect(other.menus[0].rows.map(r => [r.label, !!r.disabled, r.value])).toEqual([['Millers', false, '1'], ['Mill workers', false, '1']]);
    });

    it('a deleted list is drawn as its name with "missing"', () => {
        const lists = [listOf('a', 'Millers')];
        vi.spyOn(DataManager, 'getPersonLists').mockReturnValue(lists);
        const ix = lineageIndexOf(tree([person('p1', 'Bětka')], lists));
        const { ctx } = fakeCtx(ix, 'a');
        const gone = listCond('x', 'Old list') as Extract<RuleCond, { c: 'list' }>;
        const html = ruleCondEditor('list')!.paramsHtml(gone, ctx);
        expect(html).toContain('plr-gone');
        expect(html).toContain('>Old list<');
        expect(html).toContain('<span class="tag">missing</span>');
        expect(html).toContain('aria-label="List: Old list – missing"');
        expect(condMissing(ix, gone)).toEqual({ kind: 'list', name: 'Old list' });
        // A list in the tree: no frame.
        expect(ruleCondEditor('list')!.paramsHtml(listCond('a', 'Millers') as never, ctx)).not.toContain('plr-gone');
    });

    it('a deleted person and place are drawn the same way', () => {
        const ix = lineageIndexOf(tree([person('p1', 'Bětka')]));
        const { ctx } = fakeCtx(ix);
        const fam = { t: 'cond', c: 'ancestors', p: { personId: id('gone'), personName: 'Bětka Ostrovidová-Quellmayerová' } } as Extract<RuleCond, { c: 'ancestors' }>;
        const html = ruleCondEditor('ancestors')!.paramsHtml(fam, ctx);
        expect(html).toContain('plr-gone');
        expect(html).toContain('>Bětka Ostrovidová-Quellmayerová<');
        const near = { t: 'cond', c: 'near', p: { placeKey: 'zaniklo', placeName: 'Zaniklo', events: ['birth'], km: 0 } } as Extract<RuleCond, { c: 'near' }>;
        expect(ruleCondEditor('near')!.paramsHtml(near, ctx)).toMatch(/plr-gone[^>]*>.*Zaniklo.*missing/);
        const here = { ...near, p: { ...near.p, placeKey: 'mlynky', placeName: 'Mlýnky' } } as Extract<RuleCond, { c: 'near' }>;
        expect(ruleCondEditor('near')!.paramsHtml(here, ctx)).not.toContain('plr-gone');
    });
});

describe('§15 the version hints of added and changed', () => {
    const hint = (c: 'added' | 'changed', persons: Person[]): string => {
        const { ctx } = fakeCtx(lineageIndexOf(tree(persons)));
        const cond = { t: 'cond', c, p: { days: 7 } } as Extract<RuleCond, { c: 'added' | 'changed' }>;
        return ruleCondEditor(c)!.hint!(cond as never, ctx);
    };
    const at = '2026-11-16T09:00:00.000Z';

    it('added: "Nothing yet" only without any date added; the version when some lack it; nothing when all have it', () => {
        expect(hint('added', [person('a', 'Arvid'), person('b', 'Bětka')])).toBe('Nothing yet – the date added is recorded from version 3.30.');
        expect(hint('added', [person('a', 'Arvid', { addedAt: at }), person('b', 'Bětka')]))
            .toBe('the date added is recorded from version 3.30 – people added earlier do not count');
        expect(hint('added', [person('a', 'Arvid', { addedAt: at }), person('b', 'Bětka', { addedAt: at })])).toBe('');
    });

    it('changed: "Nothing yet" without any change time, else from which version', () => {
        expect(hint('changed', [person('a', 'Arvid')])).toBe('Nothing yet – the change time is recorded from version 3.32.');
        expect(hint('changed', [person('a', 'Arvid', { changedAt: at }), person('b', 'Bětka')]))
            .toBe('the change time is recorded from version 3.32 – older edits do not count');
        setLanguage('cs');
        expect(hint('added', [person('a', 'Arvid', { addedAt: at }), person('b', 'Bětka')]))
            .toBe('údaj o přidání se zapisuje od verze 3.30 – dřív přidané osoby se nepočítají');
    });
});


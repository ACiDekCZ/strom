/**
 * The editors of the custom rule's conditions (spec 136 §3, §3.3, §4): the
 * centuries of "lived in", typed numbers and years, the periods of
 * added / changed, the steppers and quick choices of Family of a person, the
 * distance of Place and surroundings (disabled without a location, with the
 * reason), the tree's places and occupations to choose from, the catalog
 * (conditions without data in the tree are not offered) and what a new
 * condition still needs before it can be saved. The editors are driven
 * through their own functions with a stand-in for the builder; their drawing
 * in the dialog is e2e (list-rules-conditions.spec.ts). Invented names only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../data.js';
import { lineageIndexOf } from '../person-lists.js';
import { condNeed, rulePlaceChoices, ruleOccupationChoices, FAMILY_PRESETS } from '../person-list-rules.js';
import { familyPresetOf } from '../lineage.js';
import {
    newRuleCond, ruleCatalog, ruleCondEditor, typedInt, typedYear, readYears,
    type RuleEditorCtx, type RulePickRow, type RulePickOpts,
} from '../ui/person-list-rule-editors.js';
import { centuryOf, centuryYears, hasChoices, periodChoice, periodOfChoice } from '../ui/person-list-rule-cond-editors.js';
import { FAMILY_COUSIN_MAX, FAMILY_GEN_MAX, familyWithPreset, familyWithWidth, stepDepth } from '../ui/person-list-rule-family.js';
import { kmChoice } from '../ui/person-list-rule-near.js';
import { setLanguage, strings } from '../strings.js';
import type { LineageIndex } from '../lineage.js';
import type { Partnership, PartnershipId, Person, PersonId, PersonList, RuleCond, RuleParamsMap, StromData } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const id = (s: string) => s as PersonId;
const uid = (s: string) => s as PartnershipId;

function person(pid: string, firstName: string, lastName: string, gender: Person['gender'], extra: Partial<Person> = {}): Person {
    return { id: id(pid), firstName, lastName, gender, partnerships: [], parentIds: [], childIds: [], ...extra } as Person;
}

const occ = (pid: string, note: string) => ({ id: `o-${pid}-${note}`, type: 'occupation', note }) as unknown as NonNullable<Person['events']>[number];

/**
 * Made up: Arvid Quellmayer (a miller, born in Mlýnky) and Dorota Talvanen
 * (born in Vrbatín) have Benedikt (a "mlynář", born in Mlýnky), Cilka (born in
 * Horní Vranice, which has no location) and Edvin (a teacher, born in
 * Dolní Krsovec, 40 km from Mlýnky).
 */
function tree(opts: { occupations?: boolean; coords?: boolean } = {}): StromData {
    const withOcc = opts.occupations !== false;
    const persons: Record<string, Person> = {
        arvid: person('arvid', 'Arvid', 'Quellmayer', 'male', {
            birthDate: '1820', deathDate: '1880', birthPlace: 'Mlýnky', partnerships: [uid('u1')], childIds: [id('bene'), id('cilka'), id('edvin')],
            ...(withOcc ? { events: [occ('arvid', 'Mlynář')] } : {}),
        }),
        dorota: person('dorota', 'Dorota', 'Talvanen', 'female', { birthDate: '1825', birthPlace: 'Vrbatín', partnerships: [uid('u1')], childIds: [id('bene'), id('cilka'), id('edvin')] }),
        bene: person('bene', 'Benedikt', 'Quellmayer', 'male', {
            birthDate: '1850', birthPlace: 'Mlýnky', parentIds: [id('arvid'), id('dorota')],
            ...(withOcc ? { events: [occ('bene', 'mlynář')] } : {}),
        }),
        cilka: person('cilka', 'Cilka', 'Quellmayer', 'female', { birthDate: '1852', birthPlace: 'Horní Vranice', parentIds: [id('arvid'), id('dorota')] }),
        edvin: person('edvin', 'Edvin', 'Quellmayer', 'male', {
            birthDate: '1855', birthPlace: 'Dolní Krsovec', parentIds: [id('arvid'), id('dorota')],
            ...(withOcc ? { events: [occ('edvin', 'Učitel')] } : {}),
        }),
    };
    const u1: Partnership = { id: uid('u1'), person1Id: id('arvid'), person2Id: id('dorota'), childIds: [id('bene'), id('cilka'), id('edvin')], status: 'married' } as Partnership;
    return {
        version: STROM_DATA_VERSION,
        persons: persons as StromData['persons'],
        partnerships: { u1 } as StromData['partnerships'],
        places: opts.coords === false ? {} : {
            'mlynky': { lat: 49.5, lon: 15.0 },
            'vrbatin': { lat: 49.554, lon: 15.0 },
            'dolni krsovec': { lat: 49.86, lon: 15.0 },
        } as StromData['places'],
    } as StromData;
}

/** A stand-in for the builder: what the editor updates and which choice it opens. */
function fakeCtx(index: LineageIndex) {
    const updates: Array<{ cond: RuleCond; render?: boolean }> = [];
    const menus: Array<{ title: string; rows: RulePickRow[]; onPick: (id: string) => void; opts?: RulePickOpts }> = [];
    const ctx: RuleEditorCtx = {
        path: '0', index, focusId: id('arvid'), host: null, listId: null,
        key: (name) => `0:${name}`,
        update: (cond, o) => { updates.push({ cond, render: o?.render }); },
        menu: (_anchor, title, rows, onPick, opts) => { menus.push({ title, rows, onPick, opts }); },
        pickPerson: () => {},
    };
    return { ctx, updates, menus };
}

/** A control as the editors read it: its `data-pc`, `data-v` and value. */
const ctl = (pc: string, extra: { v?: string; value?: string; checked?: boolean } = {}) =>
    ({ dataset: { pc, ...(extra.v !== undefined ? { v: extra.v } : {}) }, value: extra.value ?? '', checked: !!extra.checked }) as unknown as HTMLInputElement;

const last = <T>(a: T[]): T => a[a.length - 1];

const condOf = <C extends RuleCond['c']>(c: C, p: RuleParamsMap[C]) => ({ t: 'cond', c, p }) as Extract<RuleCond, { c: C }>;

beforeEach(() => setLanguage('en'));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('lived in: centuries', () => {
    it('a century is its years, and only those years are a century', () => {
        expect(centuryYears(19)).toEqual({ from: 1801, to: 1900 });
        expect(centuryYears(18)).toEqual({ from: 1701, to: 1800 });
        expect(centuryOf({ from: 1801, to: 1900 })).toBe(19);
        expect(centuryOf({ from: 1901, to: 2000 })).toBe(20);
        expect(centuryOf({ from: 1800, to: 1899 })).toBeNull();
        expect(centuryOf({ from: 1801, to: 1899 })).toBeNull();
        expect(centuryOf({ from: 1801 })).toBeNull();
        expect(centuryOf({ to: 1900 })).toBeNull();
    });

    it('a new "lived in" starts at the 19th century; the segment sets a century, typed years leave it', () => {
        const ix = lineageIndexOf(tree());
        const { ctx, updates } = fakeCtx(ix);
        const c = newRuleCond('livedIn', { index: ix, focusId: null }) as Extract<RuleCond, { c: 'livedIn' }>;
        expect(c.p).toEqual({ from: 1801, to: 1900 });
        const ed = ruleCondEditor('livedIn')!;
        expect(ed.paramsHtml(c, ctx)).toMatch(/data-pc="century" data-v="19"[^>]*aria-pressed="true"/);
        ed.click!(c, ctl('century', { v: '18' }), ctx);
        expect(last(updates).cond.p).toEqual({ from: 1701, to: 1800 });
        // Not a century of the segment: nothing.
        ed.click!(c, ctl('century', { v: '15' }), ctx);
        expect(updates).toHaveLength(1);
        const typed = ed.input!(c, ctl('from', { value: '1820' }), ctx) as RuleParamsMap['livedIn'];
        expect(typed).toEqual({ from: 1820, to: 1900 });
        expect(ed.paramsHtml(condOf('livedIn', typed), ctx)).not.toMatch(/aria-pressed="true"/);
    });
});

describe('typed numbers and years', () => {
    it('a whole number in range; empty is not set; anything else is not a number', () => {
        expect(typedInt('', 0, 999)).toBeUndefined();
        expect(typedInt('   ', 0, 999)).toBeUndefined();
        expect(typedInt(' 12 ', 0, 999)).toBe(12);
        expect(typedInt('0', 0, 999)).toBe(0);
        expect(typedInt('999', 0, 999)).toBe(999);
        expect(typedInt('1000', 0, 999)).toBeNaN();
        expect(typedInt('-1', 0, 999)).toBeNaN();
        expect(typedInt('2.5', 0, 999)).toBeNaN();
        expect(typedInt('abc', 0, 999)).toBeNaN();
        expect(typedYear('1850')).toBe(1850);
        expect(typedYear('0')).toBeNaN();
        expect(typedYear('3000')).toBeNaN();
        expect(typedYear('')).toBeUndefined();
    });

    it('a typed "from" or "to" keeps the other end; an emptied end is open; a year out of range is incomplete', () => {
        const c = { p: { from: 1800, to: 1850 } };
        expect(readYears(c, ctl('to', { value: '1900' }))).toEqual({ from: 1800, to: 1900 });
        expect(readYears(c, ctl('from', { value: '' }))).toEqual({ to: 1850 });
        expect(readYears(c, ctl('other', { value: '1' }))).toBeNull();
        const bad = readYears(c, ctl('from', { value: '99999' }))!;
        expect(bad.from).toBeNaN();
        expect(condNeed(condOf('born', bad))).toBe('years');
    });

    it('age at death 0–130; count 0–999 (an empty count is incomplete)', () => {
        const ix = lineageIndexOf(tree());
        const { ctx } = fakeCtx(ix);
        const age = ruleCondEditor('deathAge')!;
        const a = newRuleCond('deathAge', { index: ix, focusId: null }) as Extract<RuleCond, { c: 'deathAge' }>;
        expect(a.p).toEqual({ to: 5 });
        expect(age.input!(a, ctl('from', { value: '0' }), ctx)).toEqual({ from: 0, to: 5 });
        expect((age.input!(a, ctl('to', { value: '131' }), ctx) as RuleParamsMap['deathAge']).to).toBeNaN();
        expect(age.paramsHtml(a, ctx)).toMatch(/min="0" max="130"/);

        const count = ruleCondEditor('count')!;
        const n = newRuleCond('count', { index: ix, focusId: null }) as Extract<RuleCond, { c: 'count' }>;
        expect(n.p).toEqual({ what: 'children', cmp: 'min', n: 5 });
        expect(condNeed(n)).toBeNull();
        const empty = count.input!(n, ctl('n', { value: '' }), ctx) as RuleParamsMap['count'];
        expect(empty.n).toBeNaN();
        expect(condNeed(condOf('count', empty))).toBe('number');
        expect(count.change!(n, ctl('what', { value: 'sources' }), ctx)).toEqual({ what: 'sources', cmp: 'min', n: 5 });
        expect((count.input!(n, ctl('n', { value: '1000' }), ctx) as RuleParamsMap['count']).n).toBeNaN();
    });
});

describe('added / changed in a period', () => {
    const NOW = Date.parse('2026-11-16T10:30:00.000Z');

    it('the segment\'s choices there and back; "since" keeps its day or starts today', () => {
        expect(periodOfChoice('h24', { days: 7 }, NOW)).toEqual({ hours: 24 });
        expect(periodOfChoice('d7', { hours: 24 }, NOW)).toEqual({ days: 7 });
        expect(periodOfChoice('d30', { days: 7 }, NOW)).toEqual({ days: 30 });
        expect(periodOfChoice('since', { days: 7 }, NOW)).toEqual({ since: '2026-11-16' });
        expect(periodOfChoice('since', { since: '2026-01-02' }, NOW)).toEqual({ since: '2026-01-02' });
        expect(periodOfChoice('nonsense', { since: '2026-01-02' }, NOW)).toEqual({ days: 7 });
        for (const v of ['h24', 'd7', 'd30', 'since'] as const) expect(periodChoice(periodOfChoice(v, { days: 7 }, NOW))).toBe(v);
        expect(periodChoice({ days: 3 })).toBeNull();
    });

    it('a period is complete with 24 hours, whole days or a real day', () => {
        const added = (p: RuleParamsMap['added']) => condNeed(condOf('added', p));
        expect(added({ hours: 24 })).toBeNull();
        expect(added({ days: 7 })).toBeNull();
        expect(added({ since: '2026-11-01' })).toBeNull();
        expect(added({ days: 0 })).toBe('period');
        expect(added({ since: '2026-1-1' })).toBe('period');
        expect(added({ since: '' })).toBe('period');
    });
});

describe('§4 Family of a person: steppers and quick choices', () => {
    it('generations 0 … 10 then all; cousins 1 … 5 then all; no step past either end', () => {
        expect(stepDepth(0, -1, 0, FAMILY_GEN_MAX)).toBeNull();
        expect(stepDepth(0, 1, 0, FAMILY_GEN_MAX)).toBe(1);
        expect(stepDepth(9, 1, 0, FAMILY_GEN_MAX)).toBe(10);
        expect(stepDepth(10, 1, 0, FAMILY_GEN_MAX)).toBe('all');
        expect(stepDepth('all', 1, 0, FAMILY_GEN_MAX)).toBeNull();
        expect(stepDepth('all', -1, 0, FAMILY_GEN_MAX)).toBe(10);
        expect(stepDepth(1, -1, 1, FAMILY_COUSIN_MAX)).toBeNull();
        expect(stepDepth(5, 1, 1, FAMILY_COUSIN_MAX)).toBe('all');
        expect(stepDepth('all', -1, 1, FAMILY_COUSIN_MAX)).toBe(5);
    });

    it('a quick choice sets the axes and keeps the person; the chip of exactly these axes is pressed', () => {
        const base: RuleParamsMap['family'] = { personId: id('arvid'), personName: 'Arvid Quellmayer', up: 3, via: 'father', down: 0, width: 'cousins', cousins: 2, spouses: 'families' };
        for (const k of Object.keys(FAMILY_PRESETS) as Array<keyof typeof FAMILY_PRESETS>) {
            const f = familyWithPreset(base, k);
            expect(f.personId).toBe('arvid');
            expect(f.personName).toBe('Arvid Quellmayer');
            expect(familyPresetOf(f)).toBe(k);
            if (f.width !== 'cousins') expect('cousins' in f).toBe(false);
        }
    });

    it('cousins get a degree (1 when they start, the old one kept), other widths drop it', () => {
        const p: RuleParamsMap['family'] = { personId: id('arvid'), personName: 'A', up: 2, via: 'both', down: 2, width: 'line', spouses: 'none' };
        const c = familyWithWidth(p, 'cousins');
        expect(c.cousins).toBe(1);
        expect(familyWithWidth({ ...c, cousins: 3 }, 'cousins').cousins).toBe(3);
        expect('cousins' in familyWithWidth(c, 'siblings')).toBe(false);
    });

    it('the editor: a chip changes the axes, a stepper at its end does nothing, the minus is disabled at 0', () => {
        const ix = lineageIndexOf(tree());
        const { ctx, updates } = fakeCtx(ix);
        const ed = ruleCondEditor('family')!;
        const f = newRuleCond('family', { index: ix, focusId: id('arvid') }) as Extract<RuleCond, { c: 'family' }>;
        expect(f.p).toMatchObject({ personId: 'arvid', personName: 'Arvid Quellmayer', up: 2, down: 2, width: 'line', spouses: 'none' });
        ed.click!(f, ctl('preset', { v: 'descendants' }), ctx);
        const d = last(updates).cond as typeof f;
        expect(familyPresetOf(d.p)).toBe('descendants');
        expect(ed.paramsHtml(d, ctx)).toMatch(/data-pc="preset" data-v="descendants"[^>]*aria-pressed="true"/);
        // Up to 0: the minus is aria-disabled, another minus no change.
        const zero = condOf('family', { ...d.p, up: 0 });
        expect(ed.paramsHtml(zero, ctx)).toMatch(/data-pc="up" data-v="-1"[^>]*aria-disabled="true"/);
        const n = updates.length;
        ed.click!(zero, ctl('up', { v: '-1' }), ctx);
        expect(updates).toHaveLength(n);
        ed.click!(zero, ctl('up', { v: '1' }), ctx);
        expect((last(updates).cond as typeof f).p.up).toBe(1);
        // A chip already pressed: no update.
        const m = updates.length;
        ed.click!(d, ctl('preset', { v: 'descendants' }), ctx);
        expect(updates).toHaveLength(m);
        // Without a person, the condition waits for one.
        expect(condNeed(newRuleCond('family', { index: ix, focusId: null })!)).toBe('person');
    });
});

describe('§3.3 Place and surroundings', () => {
    it('the distance\'s choice: the presets, anything else is "other"', () => {
        for (const k of [0, 5, 10, 25, 50]) expect(kmChoice(k)).toBe(String(k));
        expect(kmChoice(100)).toBe('other');
        expect(kmChoice(7)).toBe('other');
        expect(kmChoice(NaN)).toBe('other');
    });

    it('the tree\'s places, most people first, then by name', () => {
        const ix = lineageIndexOf(tree());
        const pl = rulePlaceChoices(ix);
        expect(pl[0]).toMatchObject({ name: 'Mlýnky', persons: 2 });
        expect(pl.map(p => p.name)).toEqual(['Mlýnky', 'Dolní Krsovec', 'Horní Vranice', 'Vrbatín']);
    });

    it('a place without a location: only "the place itself", the distances disabled with the reason; a located place takes them', () => {
        const ix = lineageIndexOf(tree());
        const { ctx, updates, menus } = fakeCtx(ix);
        const ed = ruleCondEditor('near')!;
        const c = newRuleCond('near', { index: ix, focusId: null }) as Extract<RuleCond, { c: 'near' }>;
        expect(condNeed(c)).toBe('place');
        const t = strings.lists.rules.near;

        // The place's choice: the rows with counts; choosing Horní Vranice (no location) keeps km 0.
        ed.click!(condOf('near', { ...c.p, km: 25 }), ctl('place'), ctx);
        const rows = last(menus).rows;
        expect(rows.find(r => r.label === 'Mlýnky')).toMatchObject({ value: '2 people' });
        expect(last(menus).opts).toMatchObject({ search: expect.any(String) });
        last(menus).onPick(rows.find(r => r.label === 'Horní Vranice')!.id);
        const hv = last(updates).cond as typeof c;
        expect(hv.p).toMatchObject({ placeName: 'Horní Vranice', km: 0 });
        expect(condNeed(hv)).toBeNull();

        const html = ed.paramsHtml(hv, ctx);
        expect(html).toMatch(/data-pc="km" data-v="0"[^>]*aria-pressed="true"/);
        for (const k of ['5', '10', '25', '50', 'other']) {
            const btn = html.match(new RegExp(`<button[^>]*data-pc="km" data-v="${k}"[^>]*>`))![0];
            expect(btn).toMatch(/disabled/);
            expect(btn).toContain(t.noCoords.replace(/"/g, '&quot;'));
        }
        expect(ed.hintHtml!(hv, ctx)).toContain('data-pc="fixone"');
        // The phone's one control: the same rows disabled with the reason.
        ed.click!(hv, ctl('kmpick'), ctx);
        const kmRows = last(menus).rows;
        expect(kmRows.map(r => r.id)).toEqual(['0', '5', '10', '25', '50', 'other']);
        expect(kmRows[0]).toMatchObject({ checked: true });
        expect(kmRows[0].disabled).toBeUndefined();
        for (const r of kmRows.slice(1)) expect(r).toMatchObject({ disabled: true, why: t.noCoords });

        // Mlýnky has a location: the distances are free; 10 km take Vrbatín (6 km) in.
        menus.length = 0;
        ed.click!(hv, ctl('place'), ctx);
        menus[0].onPick(menus[0].rows.find(r => r.label === 'Mlýnky')!.id);
        const ml = last(updates).cond as typeof c;
        expect(ed.paramsHtml(ml, ctx)).not.toMatch(/data-pc="km" data-v="10"[^>]*disabled/);
        ed.click!(ml, ctl('km', { v: '10' }), ctx);
        const ten = last(updates).cond as typeof c;
        expect(ten.p.km).toBe(10);
        expect(ed.hintHtml!(ten, ctx)).toContain(t.summary(10, 2, 0));
        // "Other": a field 1–500 starting at 100; out of range it is incomplete.
        expect((ed.input!(ten, ctl('kmn', { value: '501' }), ctx) as RuleParamsMap['near']).km).toBeNaN();
        expect(condNeed(condOf('near', { ...ten.p, km: NaN }))).toBe('km');
        expect(ed.input!(ten, ctl('kmn', { value: '120' }), ctx)).toMatchObject({ km: 120 });
        // No event ticked: incomplete.
        const none = ['birth', 'death', 'marriage', 'residence'].reduce<RuleParamsMap['near']>(
            (p, e) => ed.change!(condOf('near', p), ctl(`ev-${e}`, { checked: false }), ctx) as RuleParamsMap['near'], ten.p);
        expect(none.events).toEqual([]);
        expect(condNeed(condOf('near', none))).toBe('events');
    });

    it('a tree without any located place says so in place of a place\'s reason', () => {
        const ix = lineageIndexOf(tree({ coords: false }));
        const { ctx } = fakeCtx(ix);
        const ed = ruleCondEditor('near')!;
        const t = strings.lists.rules.near;
        const c = condOf('near', { placeKey: rulePlaceChoices(ix)[0].key, placeName: 'Mlýnky', events: ['birth'], km: 0 });
        expect(ed.paramsHtml(c, ctx)).toContain(t.noneInTree.replace(/"/g, '&quot;'));
        expect(ed.hintHtml!(c, ctx)).toContain('data-pc="map"');
    });
});

describe('occupations', () => {
    it('grouped by the folded text, the most used spelling as the label, most people first', () => {
        const ix = lineageIndexOf(tree());
        const occs = ruleOccupationChoices(ix);
        expect(occs).toHaveLength(2);
        expect(occs[0]).toMatchObject({ persons: 2 });
        expect([occs[0].label, ...occs[0].forms].sort()).toEqual(['Mlynář', 'mlynář']);
        expect(occs[1]).toMatchObject({ label: 'Učitel', forms: [], persons: 1 });
    });

    it('several at once: each pick toggles without drawing, the choice is drawn once when it closes', () => {
        const ix = lineageIndexOf(tree());
        const { ctx, updates, menus } = fakeCtx(ix);
        const ed = ruleCondEditor('occupation')!;
        const c = newRuleCond('occupation', { index: ix, focusId: null }) as Extract<RuleCond, { c: 'occupation' }>;
        expect(condNeed(c)).toBe('occupation');
        ed.click!(c, ctl('values'), ctx);
        const m = menus[0];
        expect(m.opts).toMatchObject({ multi: true, search: expect.any(String) });
        const [miller, teacher] = ruleOccupationChoices(ix);
        m.onPick(miller.key);
        m.onPick(teacher.key);
        m.onPick(miller.key);
        expect(updates.every(u => u.render === false)).toBe(true);
        m.opts!.onClose!();
        const closed = last(updates);
        expect(closed.render).toBeUndefined();
        expect((closed.cond as typeof c).p).toEqual({ values: [teacher.key], labels: ['Učitel'] });
    });

    it('a chosen value no longer in the tree stays offered, ticked', () => {
        const ix = lineageIndexOf(tree());
        const { ctx, menus } = fakeCtx(ix);
        ruleCondEditor('occupation')!.click!(condOf('occupation', { values: ['kovar'], labels: ['Kovář'] }), ctl('values'), ctx);
        expect(menus[0].rows[0]).toMatchObject({ id: 'kovar', label: 'Kovář', checked: true });
    });
});

describe('the catalog', () => {
    it('conditions without data in the tree are not offered; groups in order', () => {
        const withOcc = ruleCatalog(lineageIndexOf(tree())).map(e => e.c);
        expect(withOcc).toContain('occupation');
        expect(ruleCatalog(lineageIndexOf(tree({ occupations: false }))).map(e => e.c)).not.toContain('occupation');
        // Another list only when the tree has more lists than this one.
        expect(withOcc).not.toContain('list');
        vi.spyOn(DataManager, 'getPersonLists').mockReturnValue([{ id: 'a' }, { id: 'b' }] as unknown as PersonList[]);
        expect(ruleCatalog(lineageIndexOf(tree())).map(e => e.c)).toContain('list');
        // No table views, no research lines: neither is offered.
        expect(withOcc).not.toContain('tableFilter');
        expect(withOcc).not.toContain('line');
        const groups = ruleCatalog(lineageIndexOf(tree())).map(e => e.group);
        expect(groups).toEqual([...groups].sort());
        expect(withOcc[0]).toBe('family');
        expect(withOcc).toEqual(expect.arrayContaining(['near', 'livedIn', 'deathAge', 'has', 'count', 'text', 'added', 'changed', 'ancestors', 'descendants']));
    });

    it('"has": the research\'s facts only in a research tree, a chosen one stays', () => {
        const all = (r: boolean, keep?: Parameters<typeof hasChoices>[1]) => hasChoices(r, keep).flatMap(g => g.what);
        expect(all(false)).not.toContain('conflict');
        expect(all(true)).toEqual(expect.arrayContaining(['conflict', 'openTask']));
        expect(all(false, 'openTask')).toContain('openTask');
        expect(all(false, 'openTask')).not.toContain('conflict');
    });
});

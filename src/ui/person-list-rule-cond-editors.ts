/**
 * The parameter editors of the conditions of the catalog (spec 136 §3.2):
 * lived in a period (with the centuries), age at death, has a fact, count,
 * text, added / changed in a period, occupation, another list, family line,
 * research line, a saved Table filter, ancestors and descendants of a
 * person. Registered for the builder (src/ui/person-list-rule-ui.ts), which
 * imports this module; "Place and surroundings" and "Family of a person" have
 * their own modules.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import type { PersonId, RuleCond, RuleHasWhat, RuleParamsMap, RulePeriod, RuleYears } from '../types.js';
import type { LineageIndex } from '../lineage.js';
import { rodLabels, type RodId } from '../lineage.js';
import { rodPickerItems, rodPickerSmallItems } from '../rod-picker.js';
import { listCycle, ruleOccupationChoices } from '../person-list-rules.js';
import { listPersonIds, tableModelOf } from '../person-lists.js';
import { researchLinesOf, selectionLines } from './table-view/table-research.js';
import { researchTableLive } from './research-ui.js';
import { filterSummary, type TableFilter } from './table-view/table-filter.js';
import { shownName } from '../person-name.js';
import { cardYears } from '../card-fields.js';
import { getUI } from '../ui-ref.js';
import {
    ctlPick, ctlSeg, ctlSelect, escHtml, readYears, registerRuleCondEditor, typedInt, yearsFieldsHtml,
    type RuleCondEditor, type RuleEditorCtx, type RulePickRow,
} from './person-list-rule-editors.js';

/** The version that started recording when a person was added (as the "Added" list says). */
const ADDED_FROM = '3.30';
/** The version that started recording when a person was changed (D4). */
export const CHANGED_FROM = '3.32';

const COUNT_MAX = 999;
const AGE_MAX = 130;
const GEN_MAX = 10;

/** Whether the open tree is a research's (its conflicts and open tasks can be asked about). */
export function ruleResearchTree(): boolean {
    try { return !!getUI().activeResearchId(); } catch { return false; }
}

// ---------------------------------------------------------------------------
// Lived in a period: the years, or a century by a segment
// ---------------------------------------------------------------------------

const CENTURIES = [18, 19, 20] as const;

/** The years of a century: 19 → 1801–1900. */
export function centuryYears(c: number): Required<RuleYears> {
    return { from: (c - 1) * 100 + 1, to: c * 100 };
}

/** The century a period is exactly (1801–1900 → 19), or null. */
export function centuryOf(y: RuleYears): number | null {
    if (y.from === undefined || y.to === undefined) return null;
    if (y.to - y.from !== 99 || y.from % 100 !== 1) return null;
    return y.to / 100;
}

registerRuleCondEditor('livedIn', {
    group: 'b', order: 3,
    create: () => centuryYears(19),
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        const c = centuryOf(cond.p);
        return yearsFieldsHtml(cond.p, ctx)
            + ctlSeg(ctx, 'century', t.century, CENTURIES.map(n => [String(n), t.centuryN(n)]), c === null ? null : String(c))
            + `<span class="plr-u">${escHtml(t.century)}</span>`;
    },
    change: (cond, el) => readYears(cond, el),
    input: (cond, el) => readYears(cond, el),
    click: (cond, el, ctx) => {
        const c = Number(el.dataset.v);
        if (CENTURIES.includes(c as 18)) ctx.update({ ...cond, p: centuryYears(c) });
    },
    hint: () => strings.lists.rules.livedHint,
    firstControl: 'from',
});

// ---------------------------------------------------------------------------
// Age at death
// ---------------------------------------------------------------------------

registerRuleCondEditor('deathAge', {
    group: 'b', order: 4,
    create: () => ({ to: 5 }),
    paramsHtml: (cond, ctx) => yearsFieldsHtml(cond.p, ctx, { min: 0, max: AGE_MAX, aria: strings.lists.rules.ageAria })
        + `<span class="plr-u">${escHtml(strings.lists.rules.ageUnit)}</span>`,
    change: (cond, el) => readYears(cond, el, 0, AGE_MAX),
    input: (cond, el) => readYears(cond, el, 0, AGE_MAX),
    firstControl: 'from',
});

// ---------------------------------------------------------------------------
// Has a fact
// ---------------------------------------------------------------------------

const HAS_GROUPS: Array<{ head: 'life' | 'docs' | 'family' | 'story' | 'research'; what: RuleHasWhat[] }> = [
    { head: 'life', what: ['birthDate', 'birthPlace', 'deathDate', 'deathPlace'] },
    { head: 'docs', what: ['source', 'photo', 'material'] },
    { head: 'family', what: ['parents', 'partner', 'children'] },
    { head: 'story', what: ['story', 'note'] },
    { head: 'research', what: ['conflict', 'openTask'] },
];

/** The facts the "has" menu offers: a research's only in a research tree (the one chosen stays). */
export function hasChoices(research: boolean, keep?: RuleHasWhat): Array<{ head: string; what: RuleHasWhat[] }> {
    const h = strings.lists.rules.has.head;
    return HAS_GROUPS
        .map(g => ({ head: h[g.head], what: g.what.filter(w => g.head !== 'research' || research || w === keep) }))
        .filter(g => g.what.length > 0);
}

registerRuleCondEditor('has', {
    group: 'e', order: 0,
    create: () => ({ have: false, what: 'source' }),
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules.has;
        return ctlSeg(ctx, 'have', t.aria, [['1', t.yes], ['0', t.no]], cond.p.have ? '1' : '0')
            + ctlPick(ctx, 'what', t.aria, t.what[cond.p.what]);
    },
    click: (cond, el, ctx) => {
        if (el.dataset.pc === 'have') {
            const have = el.dataset.v === '1';
            if (have !== cond.p.have) ctx.update({ ...cond, p: { ...cond.p, have } });
            return;
        }
        if (el.dataset.pc !== 'what') return;
        const t = strings.lists.rules.has;
        const rows: RulePickRow[] = [];
        for (const g of hasChoices(ruleResearchTree(), cond.p.what)) {
            g.what.forEach((w, i) => rows.push({ id: w, label: t.what[w], checked: w === cond.p.what, ...(i === 0 ? { head: g.head } : {}) }));
        }
        ctx.menu(el, t.aria, rows, (id) => {
            if (id !== cond.p.what) ctx.update({ ...cond, p: { ...cond.p, what: id as RuleHasWhat } });
        });
    },
    firstControl: 'have-1',
});

// ---------------------------------------------------------------------------
// Count
// ---------------------------------------------------------------------------

registerRuleCondEditor('count', {
    group: 'f', order: 0,
    create: () => ({ what: 'children', cmp: 'min', n: 5 }),
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        return ctlSelect(ctx, 'what', t.countWhatAria, (['children', 'marriages', 'sources'] as const).map(w => [w, t.countWhat[w]]), cond.p.what)
            + ctlSeg(ctx, 'cmp', t.countAria, [['min', t.cmp.min], ['max', t.cmp.max]], cond.p.cmp)
            + `<input type="number" class="pln-ctl plr-num" data-pc="n" data-key="${escHtml(ctx.key('n'))}" min="0" max="${COUNT_MAX}" step="1"`
            + ` inputmode="numeric" value="${Number.isFinite(cond.p.n) ? cond.p.n : ''}" aria-label="${escHtml(t.countAria)}">`;
    },
    change: (cond, el) => {
        if (el.dataset.pc === 'what') {
            const what = el.value === 'marriages' ? 'marriages' : el.value === 'sources' ? 'sources' : 'children';
            return { ...cond.p, what };
        }
        if (el.dataset.pc === 'n') return { ...cond.p, n: typedInt(el.value, 0, COUNT_MAX) ?? NaN };
        return null;
    },
    input: (cond, el) => el.dataset.pc === 'n' ? { ...cond.p, n: typedInt(el.value, 0, COUNT_MAX) ?? NaN } : null,
    click: (cond, el, ctx) => {
        const cmp = el.dataset.v === 'max' ? 'max' : 'min';
        if (el.dataset.pc === 'cmp' && cmp !== cond.p.cmp) ctx.update({ ...cond, p: { ...cond.p, cmp } });
    },
    firstControl: 'what',
});

// ---------------------------------------------------------------------------
// Text in the story or the notes
// ---------------------------------------------------------------------------

registerRuleCondEditor('text', {
    group: 'g', order: 0,
    create: () => ({ query: '', where: 'both' }),
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        return `<input type="text" class="pln-ctl plr-txt" data-pc="query" data-key="${escHtml(ctx.key('query'))}" maxlength="200"`
            + ` value="${escHtml(cond.p.query)}" aria-label="${escHtml(t.textAria)}" autocomplete="off" spellcheck="false">`
            + ctlSeg(ctx, 'where', t.cond.text, (['story', 'note', 'both'] as const).map(w => [w, t.where[w]]), cond.p.where);
    },
    change: (cond, el) => el.dataset.pc === 'query' ? { ...cond.p, query: el.value } : null,
    input: (cond, el) => el.dataset.pc === 'query' ? { ...cond.p, query: el.value } : null,
    click: (cond, el, ctx) => {
        const where = el.dataset.v === 'story' ? 'story' : el.dataset.v === 'note' ? 'note' : 'both';
        if (el.dataset.pc === 'where' && where !== cond.p.where) ctx.update({ ...cond, p: { ...cond.p, where } });
    },
    hint: () => strings.lists.rules.textHint,
    firstControl: 'query',
});

// ---------------------------------------------------------------------------
// Added / changed in a period
// ---------------------------------------------------------------------------

/** A day as YYYY-MM-DD (local). */
function isoDay(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The segment's choice of a period: h24, d7, d30, since (null: another number of days). */
export function periodChoice(p: RulePeriod): 'h24' | 'd7' | 'd30' | 'since' | null {
    if ('hours' in p) return 'h24';
    if ('since' in p) return 'since';
    return p.days === 7 ? 'd7' : p.days === 30 ? 'd30' : null;
}

/** The period of a segment's choice (`since` keeps its day, or starts at today). */
export function periodOfChoice(v: string, before: RulePeriod, now: number): RulePeriod {
    switch (v) {
        case 'h24': return { hours: 24 };
        case 'd30': return { days: 30 };
        case 'since': return 'since' in before ? before : { since: isoDay(now) };
        default: return { days: 7 };
    }
}

function periodEditor(c: 'added' | 'changed', order: number): RuleCondEditor<'added' | 'changed'> {
    return {
        group: 'h', order,
        create: () => ({ days: 7 }),
        paramsHtml: (cond, ctx) => {
            const t = strings.lists.rules;
            const s = t.periodSeg;
            const p = cond.p;
            return ctlSeg(ctx, 'period', t.cond[c], [['h24', s.h24], ['d7', s.d7], ['d30', s.d30], ['since', s.since]], periodChoice(p))
                + ('since' in p
                    ? `<input type="date" class="pln-ctl plr-date" data-pc="since" data-key="${escHtml(ctx.key('since'))}" value="${escHtml(p.since)}" aria-label="${escHtml(t.sinceAria)}">`
                    : '');
        },
        change: (cond, el) => el.dataset.pc === 'since' && /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? { since: el.value } : null,
        click: (cond, el, ctx) => {
            if (el.dataset.pc !== 'period') return;
            const next = periodOfChoice(el.dataset.v ?? '', cond.p, Date.now());
            if (JSON.stringify(next) === JSON.stringify(cond.p)) return;
            ctx.update({ ...cond, p: next } as RuleCond);
            if ('since' in next) {
                // The day's field appears: it takes the focus.
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`.pln-overlay [data-key="${CSS.escape(ctx.key('since'))}"]`)?.focus());
            }
        },
        hint: (_cond, ctx) => {
            // "Nothing yet – … from version X" only when no person has the time at all (§15); when some
            // have it, the version without "Nothing yet"; when everyone has the date added, nothing.
            const t = strings.lists.rules;
            const people = Object.values(ctx.index.data.persons).filter(p => p && !p.isPlaceholder);
            const has = (p: typeof people[number]): boolean => !!(c === 'changed' ? p.changedAt : p.addedAt);
            const some = people.some(has);
            if (c === 'changed') return some ? t.changedFrom(CHANGED_FROM) : t.changedNone(CHANGED_FROM);
            if (!some) return strings.lists.addedNone(ADDED_FROM);
            return people.every(has) ? '' : t.addedFrom(ADDED_FROM);
        },
        firstControl: 'period-d7',
    };
}

registerRuleCondEditor('added', periodEditor('added', 0) as RuleCondEditor<'added'>);
registerRuleCondEditor('changed', periodEditor('changed', 1) as RuleCondEditor<'changed'>);

// ---------------------------------------------------------------------------
// Occupation: the tree's values, several at once
// ---------------------------------------------------------------------------

registerRuleCondEditor('occupation', {
    group: 'd', order: 1,
    available: (index) => ruleOccupationChoices(index).length > 0,
    create: () => ({ values: [], labels: [] }),
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        const text = cond.p.labels.length ? cond.p.labels.join(', ') : cond.p.values.length ? cond.p.values.join(', ') : t.pick.choose;
        return ctlPick(ctx, 'values', t.pick.occupation, text, !cond.p.values.length, 'plr-pick--wide');
    },
    click: (cond, el, ctx) => {
        const t = strings.lists.rules;
        const choices = ruleOccupationChoices(ctx.index);
        let cur = { values: [...cond.p.values], labels: [...cond.p.labels] };
        // A value no longer in the tree stays offered while it is chosen.
        const rows: RulePickRow[] = cur.values.filter(v => !choices.some(c => c.key === v))
            .map(v => ({ id: v, label: cur.labels[cur.values.indexOf(v)] || v, checked: true }));
        for (const c of choices) {
            rows.push({ id: c.key, label: c.label, ...(c.forms.length ? { sub: c.forms.join(', ') } : {}), value: strings.lists.persons(c.persons), checked: cur.values.includes(c.key) });
        }
        let changed = false;
        ctx.menu(el, t.pick.occupation, rows, (id) => {
            const at = cur.values.indexOf(id);
            if (at >= 0) cur = { values: cur.values.filter((_, i) => i !== at), labels: cur.labels.filter((_, i) => i !== at) };
            else cur = { values: [...cur.values, id], labels: [...cur.labels, choices.find(c => c.key === id)?.label ?? id] };
            changed = true;
            ctx.update({ ...cond, p: cur }, { render: false });
        }, {
            wide: true, multi: true, search: t.pick.search,
            onClose: () => { if (changed) ctx.update({ ...cond, p: cur }); },
        });
    },
    firstControl: 'values',
    openOnAdd: true,
});

// ---------------------------------------------------------------------------
// Another list
// ---------------------------------------------------------------------------

registerRuleCondEditor('list', {
    group: 'a', order: 5,
    available: () => DataManager.getPersonLists().length > 1,
    create: () => ({ listId: '', listName: '' }),
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        const list = DataManager.getPersonLists().find(l => l.id === cond.p.listId);
        const gone = !list && !!cond.p.listId;
        const text = list ? list.name : gone ? cond.p.listName || '?' : t.pick.choose;
        return ctlPick(ctx, 'list', t.pick.list, text, !cond.p.listId, '', gone);
    },
    click: (cond, el, ctx) => {
        const t = strings.lists.rules;
        const lists = DataManager.getPersonLists();
        const self = ctx.listId;
        // A list leading back to this one is disabled with the loop's path (§11); the list's people as the value.
        const rows: RulePickRow[] = lists.filter(l => l.id !== self).map(l => {
            const cycle = self ? listCycle(lists, self, l.id) : null;
            const value = String(listPersonIds(ctx.index, l).length);
            return cycle
                ? { id: l.id, label: l.name, value, checked: l.id === cond.p.listId, disabled: true, why: t.cycle(cycle.join(' → ')), sub: t.cycle(cycle.join(' → ')) }
                : { id: l.id, label: l.name, value, checked: l.id === cond.p.listId };
        });
        ctx.menu(el, t.pick.list, rows, (id) => {
            const l = lists.find(x => x.id === id);
            if (l && id !== cond.p.listId) ctx.update({ ...cond, p: { listId: l.id, listName: l.name } });
        }, { search: rows.length > 8 ? t.pick.search : undefined });
    },
    firstControl: 'list',
    openOnAdd: true,
});

// ---------------------------------------------------------------------------
// Family line (rod), research line
// ---------------------------------------------------------------------------

function rodRows(index: LineageIndex): { big: RulePickRow[]; small: RulePickRow[] } {
    const lang = getCurrentLanguage();
    const labels = rodLabels(index);
    const big = rodPickerItems(index, undefined, undefined, lang)
        .filter(i => i.id !== 'tree' && i.id !== 'other')
        .map(i => ({ id: i.id as string, label: i.label, value: strings.lists.persons(i.members) }));
    const small = rodPickerSmallItems(index, lang, labels).map(i => ({ id: i.id as string, label: i.label, value: strings.lists.persons(i.members) }));
    return { big, small };
}

registerRuleCondEditor('rod', {
    group: 'a', order: 3,
    available: (index) => index.rods.size > 0,
    create: ({ index }) => {
        const r = rodRows(index);
        const first = r.big[0] ?? r.small[0];
        return first ? { rodIds: [first.id], rodName: first.label } : { rodIds: [], rodName: '' };
    },
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        const labels = rodLabels(ctx.index);
        const names = cond.p.rodIds.map(id => labels.get(id as RodId) ?? '').filter(Boolean);
        const gone = !names.length && !!cond.p.rodIds.length;
        const text = names.length ? names.join(', ') : gone ? cond.p.rodName || '?' : t.pick.choose;
        return ctlPick(ctx, 'rod', t.pick.rod, text, !cond.p.rodIds.length, '', gone);
    },
    click: (cond, el, ctx) => {
        const t = strings.lists.rules;
        const r = rodRows(ctx.index);
        const rows = [...r.big, ...r.small.map((x, i) => ({ ...x, ...(i === 0 && r.big.length ? { sep: true } : {}) }))]
            .map(x => ({ ...x, checked: cond.p.rodIds.includes(x.id) }));
        ctx.menu(el, t.pick.rod, rows, (id) => {
            const row = rows.find(x => x.id === id);
            if (row && !(cond.p.rodIds.length === 1 && cond.p.rodIds[0] === id)) ctx.update({ ...cond, p: { rodIds: [id], rodName: row.label } });
        }, { wide: true, search: rows.length > 8 ? t.pick.search : undefined });
    },
    firstControl: 'rod',
});

registerRuleCondEditor('line', {
    group: 'a', order: 4,
    available: (index) => researchLinesOf(index.data).lines.length > 0,
    create: ({ index }) => {
        const first = researchLinesOf(index.data).lines[0];
        return first ? { directionId: first.id, lineName: first.name } : { directionId: '', lineName: '' };
    },
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        const line = researchLinesOf(ctx.index.data).lines.find(l => l.id === cond.p.directionId);
        const gone = !line && !!cond.p.directionId;
        const text = line ? `${line.id} ${line.name}` : gone ? cond.p.lineName || cond.p.directionId : t.pick.choose;
        return ctlPick(ctx, 'line', t.pick.line, text, !cond.p.directionId, '', gone);
    },
    click: (cond, el, ctx) => {
        const t = strings.lists.rules;
        const lines = selectionLines(ctx.index.data, researchTableLive().places, cond.p.directionId || null);
        const rows: RulePickRow[] = lines.map(l => ({ id: l.id, label: `${l.id} ${l.name}`, checked: l.id === cond.p.directionId }));
        ctx.menu(el, t.pick.line, rows, (id) => {
            const l = lines.find(x => x.id === id);
            if (l && id !== cond.p.directionId) ctx.update({ ...cond, p: { directionId: l.id, lineName: l.name } });
        }, { wide: true, search: rows.length > 8 ? t.pick.search : undefined });
    },
    firstControl: 'line',
});

// ---------------------------------------------------------------------------
// A saved Table filter (a copy of a view's filter and sort)
// ---------------------------------------------------------------------------

function ruleViews(index: LineageIndex): NonNullable<typeof index.data.tableViews> {
    return (index.data.tableViews ?? []).filter(v => v.rowType === 'persons' || v.rowType === 'unions');
}

function viewParams(v: NonNullable<LineageIndex['data']['tableViews']>[number]): RuleParamsMap['tableFilter'] {
    return {
        viewName: v.name, rowType: v.rowType === 'unions' ? 'unions' : 'persons',
        filter: JSON.parse(JSON.stringify(v.filter)), sort: JSON.parse(JSON.stringify(v.sort)),
    };
}

/** The filter of a "saved Table filter" condition in words (the Table's own summary). */
export function ruleFilterWords(index: LineageIndex, p: RuleParamsMap['tableFilter']): string {
    try {
        return filterSummary(tableModelOf(index, {}), p.rowType, p.filter as unknown as TableFilter);
    } catch {
        return p.viewName;
    }
}

registerRuleCondEditor('tableFilter', {
    group: 'h', order: 2,
    available: (index) => ruleViews(index).length > 0,
    create: ({ index }) => viewParams(ruleViews(index)[0]),
    paramsHtml: (cond, ctx) => ctlPick(ctx, 'view', strings.lists.rules.pick.view, cond.p.viewName || strings.lists.rules.pick.choose),
    click: (cond, el, ctx) => {
        const t = strings.lists.rules;
        const views = ruleViews(ctx.index);
        const rows: RulePickRow[] = views.map(v => ({ id: v.id, label: v.name, checked: v.name === cond.p.viewName }));
        ctx.menu(el, t.pick.view, rows, (id) => {
            const v = views.find(x => x.id === id);
            if (v) ctx.update({ ...cond, p: viewParams(v) });
        }, { search: rows.length > 8 ? t.pick.search : undefined });
    },
    hint: (cond, ctx) => strings.lists.rules.filterCopy(ruleFilterWords(ctx.index, cond.p)),
    firstControl: 'view',
    openOnAdd: true,
});

// ---------------------------------------------------------------------------
// Ancestors / descendants of a person
// ---------------------------------------------------------------------------

/** "Name · 1798–1861" of a person's control (or the stored name when the person is gone, §11). */
export function rulePersonText(ctx: RuleEditorCtx, id: PersonId, stored: string): { text: string; missing: boolean; gone: boolean } {
    const t = strings.lists.rules;
    if (!id) return { text: t.pick.choose, missing: true, gone: false };
    const p = ctx.index.data.persons[id];
    if (!p || p.isPlaceholder) return { text: stored || '?', missing: false, gone: true };
    const years = cardYears(p);
    return { text: years ? `${shownName(p)} · ${years}` : shownName(p), missing: false, gone: false };
}

function generationsEditor(c: 'ancestors' | 'descendants', order: number): RuleCondEditor<'ancestors' | 'descendants'> {
    return {
        group: 'a', order,
        create: ({ index, focusId }) => {
            const p = focusId ? index.data.persons[focusId] : undefined;
            return p ? { personId: p.id, personName: shownName(p) } : { personId: '' as PersonId, personName: '' };
        },
        paramsHtml: (cond, ctx) => {
            const t = strings.lists.rules;
            const who = rulePersonText(ctx, cond.p.personId, cond.p.personName);
            const gens: Array<[string, string]> = [['all', t.allGen]];
            for (let n = 1; n <= GEN_MAX; n++) gens.push([String(n), t.gen(n)]);
            return ctlPick(ctx, 'person', t.pick.person, who.text, who.missing, '', who.gone)
                + ctlSelect(ctx, 'gen', t.family.axes[c === 'ancestors' ? 'up' : 'down'], gens, cond.p.generations === undefined ? 'all' : String(cond.p.generations));
        },
        change: (cond, el) => {
            if (el.dataset.pc !== 'gen') return null;
            const n = typedInt(el.value, 1, GEN_MAX);
            const next = { personId: cond.p.personId, personName: cond.p.personName } as RuleParamsMap['ancestors'];
            if (n !== undefined && Number.isFinite(n)) next.generations = n;
            return next;
        },
        click: (cond, el, ctx) => {
            if (el.dataset.pc !== 'person') return;
            ctx.pickPerson(el, cond.p.personId || null, (id) => {
                const p = ctx.index.data.persons[id];
                if (p) ctx.update({ ...cond, p: { ...cond.p, personId: id, personName: shownName(p) } } as RuleCond);
            });
        },
        firstControl: 'person',
    };
}

registerRuleCondEditor('ancestors', generationsEditor('ancestors', 1) as RuleCondEditor<'ancestors'>);
registerRuleCondEditor('descendants', generationsEditor('descendants', 2) as RuleCondEditor<'descendants'>);

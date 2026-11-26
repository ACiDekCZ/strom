/**
 * The editor of "Lived in the house" (spec 030 §15), next to "Place and
 * surroundings": the house (the tree's houses by town and number, with their
 * people, with a search), the years "from – to" (both may stay empty), and
 * under them the preview of the people it takes in. Offered only when the
 * tree has a house.
 */

import { strings } from '../strings.js';
import type { RuleParamsMap, RuleYears } from '../types.js';
import { condMissing, livedInHouseIds, ruleHouseChoices, ruleHouseOf } from '../person-list-rules.js';
import { houseTitle } from '../houses.js';
import { ctlPick, escHtml, readYears, registerRuleCondEditor, yearsFieldsHtml, type RulePickRow } from './person-list-rule-editors.js';

type Lived = RuleParamsMap['livedInHouse'];

/** The condition's parameters with the years typed (none when both ends are empty). */
export function withYears(p: Lived, years: RuleYears): Lived {
    const next: Lived = { house: p.house, houseName: p.houseName };
    if (years.from !== undefined || years.to !== undefined) next.years = years;
    return next;
}

registerRuleCondEditor('livedInHouse', {
    group: 'c', order: 1,
    available: index => ruleHouseChoices(index).length > 0,
    create: () => ({ house: '', houseName: '' }),
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        const I = strings.houses.integration;
        const p = cond.p;
        const house = ruleHouseOf(ctx.index, p.house);
        const gone = !!condMissing(ctx.index, cond);
        const name = house ? houseTitle(house) : p.houseName || p.house;
        return ctlPick(ctx, 'place', t.cond.livedInHouse, p.house ? name : t.pick.choose, !p.house, '', gone)
            + `<span class="plr-u">${escHtml(I.ruleYears)}</span>`
            + yearsFieldsHtml(p.years ?? {}, ctx);
    },
    change: (cond, el) => {
        const y = readYears({ p: cond.p.years ?? {} }, el);
        return y ? withYears(cond.p, y) : null;
    },
    input: (cond, el) => {
        const y = readYears({ p: cond.p.years ?? {} }, el);
        return y ? withYears(cond.p, y) : null;
    },
    click: (cond, el, ctx) => {
        if (el.dataset.pc !== 'place') return;
        const t = strings.lists.rules;
        const p = cond.p;
        const rows: RulePickRow[] = ruleHouseChoices(ctx.index).map(h => ({
            id: h.id, label: h.name, value: strings.lists.persons(h.persons), checked: h.id === p.house,
        }));
        ctx.menu(el, t.cond.livedInHouse, rows, (id) => {
            const h = rows.find(r => r.id === id);
            if (!h || id === p.house) return;
            ctx.update({ ...cond, p: { ...p, house: id, houseName: h.label } });
        }, { wide: true, search: t.pick.search });
    },
    hint: (cond, ctx) => cond.p.house && ruleHouseOf(ctx.index, cond.p.house)
        ? strings.houses.integration.rulePreview(livedInHouseIds(ctx.index, cond.p).size)
        : '',
    firstControl: 'place',
    openOnAdd: true,
});

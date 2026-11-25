/**
 * The editor of "Family of a person" (spec 136 §4): the person, the quick
 * choices (chips; the one the axes match exactly is pressed, a change of an
 * axis puts it out), and the axes: up (generations, through both parents or
 * the father's / mother's side), down, sideways (direct line, + siblings,
 * + cousins up to a degree) and spouses. Under them the rule in words.
 */

import { strings } from '../strings.js';
import type { PersonId, RuleDepth, RuleParamsMap } from '../types.js';
import { FAMILY_PRESETS, familyPresetOf, type FamilyPreset } from '../lineage.js';
import { condLabel } from '../person-list-rules.js';
import { shownName } from '../person-name.js';
import { ctlPick, ctlSeg, ctlSelect, escHtml, registerRuleCondEditor, type RuleEditorCtx } from './person-list-rule-editors.js';
import { rulePersonText } from './person-list-rule-cond-editors.js';

type Family = RuleParamsMap['family'];

/** Generations up or down: 0 … 10, then all. */
export const FAMILY_GEN_MAX = 10;
/** Cousin degrees: 1 … 5, then all. */
export const FAMILY_COUSIN_MAX = 5;

const PRESET_ORDER: readonly FamilyPreset[] = ['closest', 'ancestors', 'descendants', 'blood', 'wholeFamily', 'paternal', 'maternal'];

/** One step of a stepper: `dir` +1 / −1 from `v` within min … max, past max is 'all' (null: no step that way). */
export function stepDepth(v: RuleDepth, dir: 1 | -1, min: number, max: number): RuleDepth | null {
    if (v === 'all') return dir < 0 ? max : null;
    if (dir > 0) return v >= max ? 'all' : v + 1;
    return v <= min ? null : v - 1;
}

/** The axes of a quick choice over a person's family (the person kept). */
export function familyWithPreset(p: Family, preset: FamilyPreset): Family {
    const a = FAMILY_PRESETS[preset];
    const next: Family = { personId: p.personId, personName: p.personName, up: a.up, via: a.via, down: a.down, width: a.width, spouses: a.spouses };
    if (a.width === 'cousins') next.cousins = a.cousins ?? 'all';
    return next;
}

/** The family after the width changed (a cousin degree only with cousins; 1 when it starts). */
export function familyWithWidth(p: Family, width: Family['width']): Family {
    const next: Family = { ...p, width };
    if (width === 'cousins') next.cousins = p.cousins ?? 1;
    else delete next.cousins;
    return next;
}

function stepper(ctx: RuleEditorCtx, name: string, label: string, v: RuleDepth, text: string, min: number, max: number): string {
    const f = strings.lists.rules.family;
    const btn = (dir: 1 | -1): string => {
        const off = stepDepth(v, dir, min, max) === null;
        return `<button type="button" class="plr-stb" data-pc="${name}" data-v="${dir}" data-key="${escHtml(ctx.key(`${name}${dir > 0 ? '-inc' : '-dec'}`))}"`
            + ` aria-label="${escHtml(`${label}: ${dir > 0 ? f.more : f.fewer}`)}"${off ? ' aria-disabled="true"' : ''}><span aria-hidden="true">${dir > 0 ? '+' : '−'}</span></button>`;
    };
    return `<span class="plr-step" role="group" aria-label="${escHtml(label)}">${btn(-1)}<span class="plr-sv" aria-live="polite">${escHtml(text)}</span>${btn(1)}</span>`;
}

registerRuleCondEditor('family', {
    group: 'a', order: 0,
    create: ({ index, focusId }) => {
        const p = focusId ? index.data.persons[focusId] : undefined;
        return { personId: p ? p.id : '' as PersonId, personName: p ? shownName(p) : '', up: 2, via: 'both', down: 2, width: 'line', spouses: 'none' };
    },
    paramsHtml: (cond, ctx) => {
        const t = strings.lists.rules;
        const f = t.family;
        const p = cond.p;
        const who = rulePersonText(ctx, p.personId, p.personName);
        const preset = familyPresetOf(p);
        const gens = (d: RuleDepth): string => d === 'all' ? t.allGen : t.gen(d);
        const chips = `<div class="plr-quick" role="group" aria-label="${escHtml(f.quick)}">`
            + PRESET_ORDER.map(k => `<button type="button" class="sel-opt" data-sel-form="chip" data-pc="preset" data-v="${k}"`
                + ` data-key="${escHtml(ctx.key(`preset-${k}`))}" aria-pressed="${preset === k}">${escHtml(t.preset[k])}</button>`).join('')
            + `</div>`;
        const axis = (label: string, body: string): string => `<div class="plr-ax"><span class="plr-al">${escHtml(label)}</span><div class="plr-ac">${body}</div></div>`;
        const cousins = p.width === 'cousins'
            ? stepper(ctx, 'cd', f.degree, p.cousins ?? 'all', (p.cousins ?? 'all') === 'all' ? f.cousinAll : f.cousinDeg(p.cousins as number), 1, FAMILY_COUSIN_MAX)
            : '';
        const axes = `<div class="plr-axes">`
            + axis(f.axes.up, stepper(ctx, 'up', f.axes.up, p.up, gens(p.up), 0, FAMILY_GEN_MAX)
                + ctlSelect(ctx, 'via', f.axes.up, (['both', 'father', 'mother'] as const).map(v => [v, f.via[v]]), p.via))
            + axis(f.axes.down, stepper(ctx, 'down', f.axes.down, p.down, gens(p.down), 0, FAMILY_GEN_MAX))
            + axis(f.axes.width, ctlSeg(ctx, 'width', f.axes.width, (['line', 'siblings', 'cousins'] as const).map(w => [w, f.width[w]]), p.width) + cousins)
            + axis(f.axes.spouses, ctlSeg(ctx, 'spouses', f.axes.spouses, (['none', 'spouses', 'families'] as const).map(s => [s, f.spouses[s]]), p.spouses))
            + `</div>`;
        return ctlPick(ctx, 'person', t.pick.person, who.text, who.missing, 'plr-pick--wide') + chips + axes;
    },
    change: (cond, el) => {
        if (el.dataset.pc !== 'via') return null;
        const via = el.value === 'father' ? 'father' : el.value === 'mother' ? 'mother' : 'both';
        return { ...cond.p, via };
    },
    click: (cond, el, ctx) => {
        const p = cond.p;
        const v = el.dataset.v ?? '';
        let next: Family | null = null;
        switch (el.dataset.pc) {
            case 'person':
                ctx.pickPerson(el, p.personId || null, (id) => {
                    const person = ctx.index.data.persons[id];
                    if (person) ctx.update({ ...cond, p: { ...p, personId: id, personName: shownName(person) } });
                });
                return;
            case 'preset':
                if (v in FAMILY_PRESETS) next = familyWithPreset(p, v as FamilyPreset);
                break;
            case 'up': case 'down': {
                const d = stepDepth(p[el.dataset.pc], v === '1' ? 1 : -1, 0, FAMILY_GEN_MAX);
                if (d !== null) next = { ...p, [el.dataset.pc]: d };
                break;
            }
            case 'cd': {
                const d = stepDepth(p.cousins ?? 'all', v === '1' ? 1 : -1, 1, FAMILY_COUSIN_MAX);
                if (d !== null) next = { ...p, cousins: d };
                break;
            }
            case 'width':
                if (v === 'line' || v === 'siblings' || v === 'cousins') next = familyWithWidth(p, v);
                break;
            case 'spouses':
                if (v === 'none' || v === 'spouses' || v === 'families') next = { ...p, spouses: v };
                break;
        }
        if (next && JSON.stringify(next) !== JSON.stringify(p)) ctx.update({ ...cond, p: next });
    },
    hint: (cond, ctx) => cond.p.personId ? condLabel(cond, ctx.index) : '',
    firstControl: 'person',
});

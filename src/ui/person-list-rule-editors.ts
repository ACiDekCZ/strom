/**
 * The parameter editors of the custom rule's conditions (spec 136 §3): one
 * editor per condition name, registered here and used by the builder
 * (src/ui/person-list-rule-ui.ts). A condition without an editor is still
 * drawn (its name and its words) and can be moved, grouped and removed, but
 * it is not offered in the catalog.
 *
 * An editor gives:
 *  - `group`: its group in the catalog (§3.1, a–h) and its place in it (`order`);
 *  - `available(index)`: whether the tree can use it now (not drawn otherwise, §15);
 *  - `create(ctx)`: the parameters of a new condition (they may be incomplete:
 *    a person or a place to choose; the row then says what is missing);
 *  - `paramsHtml(cond, ctx)`: its controls (`.pln-ctl`), each with `data-pc`
 *    (the control's name) and `data-key` = `ctx.key(name)` (the focus is kept
 *    over a new drawing);
 *  - `change(cond, el, ctx)` (a `change` event of a control: the new
 *    parameters, the builder draws again), `input(…)` (typing: the new
 *    parameters without a new drawing, only the counts), `click(cond, el, ctx)`
 *    (a button with `data-pc`: e.g. open a person or place choice; it calls
 *    `ctx.update` when something is chosen);
 *  - `hint(cond, ctx)`: a quiet line under the row (`.plr-s`), '' for none;
 *  - `firstControl`: the `data-pc` focused after the condition is added (its
 *    first missing parameter; a choice opens at once when `openOnAdd`).
 */

import type { LineageIndex } from '../lineage.js';
import type { PersonId, RuleCond, RuleCondName, RuleParamsMap, RuleYears } from '../types.js';
import { strings } from '../strings.js';

export type RuleCatalogGroup = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';

/** What an editor gets: where its row is and how to change its condition. */
export interface RuleEditorCtx {
    /** The row's path (as in evalRuleCounts). */
    path: string;
    index: LineageIndex;
    /** The person in focus (a default for a person's conditions). */
    focusId: PersonId | null;
    /** The `data-key` of a control of this row (the focus is kept over a new drawing). */
    key(name: string): string;
    /** The overlay of the dialog (a popover or a choice is put there). */
    host: HTMLElement | null;
    /** Change the row's condition: drawn again (default) or only counted (`render: false`, while typing). */
    update(cond: RuleCond, opts?: { render?: boolean }): void;
}

type CondOf<C extends RuleCondName> = Extract<RuleCond, { c: C }>;
type Control = HTMLInputElement | HTMLSelectElement;

export interface RuleCondEditor<C extends RuleCondName = RuleCondName> {
    group: RuleCatalogGroup;
    order: number;
    available?(index: LineageIndex): boolean;
    create(ctx: { index: LineageIndex; focusId: PersonId | null }): RuleParamsMap[C];
    paramsHtml(cond: CondOf<C>, ctx: RuleEditorCtx): string;
    change?(cond: CondOf<C>, el: Control, ctx: RuleEditorCtx): RuleParamsMap[C] | null;
    input?(cond: CondOf<C>, el: Control, ctx: RuleEditorCtx): RuleParamsMap[C] | null;
    click?(cond: CondOf<C>, el: HTMLElement, ctx: RuleEditorCtx): void;
    hint?(cond: CondOf<C>, ctx: RuleEditorCtx): string;
    firstControl?: string;
    /** Open the first control's choice right after the condition is added (a person, a place, a list). */
    openOnAdd?: boolean;
}

const editors = new Map<RuleCondName, RuleCondEditor>();

/** Register (or replace) the editor of a condition. */
export function registerRuleCondEditor<C extends RuleCondName>(c: C, editor: RuleCondEditor<C>): void {
    editors.set(c, editor as unknown as RuleCondEditor);
}

export function ruleCondEditor(c: RuleCondName): RuleCondEditor | null {
    return editors.get(c) ?? null;
}

/** The conditions the catalog offers for this tree, by group and order. */
export function ruleCatalog(index: LineageIndex): Array<{ c: RuleCondName; group: RuleCatalogGroup }> {
    return [...editors.entries()]
        .filter(([, e]) => !e.available || e.available(index))
        .sort((a, b) => a[1].group.localeCompare(b[1].group) || a[1].order - b[1].order)
        .map(([c, e]) => ({ c, group: e.group }));
}

/** A new condition with the editor's defaults. */
export function newRuleCond(c: RuleCondName, ctx: { index: LineageIndex; focusId: PersonId | null }): RuleCond | null {
    const e = editors.get(c);
    return e ? ({ t: 'cond', c, p: e.create(ctx) } as RuleCond) : null;
}

export function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A `<select class="pln-ctl">` of an editor. */
export function ctlSelect(ctx: RuleEditorCtx, name: string, label: string, options: Array<[string, string]>, value: string): string {
    return `<select class="pln-ctl pln-select" data-pc="${escHtml(name)}" data-key="${escHtml(ctx.key(name))}" aria-label="${escHtml(label)}">`
        + options.map(([v, l]) => `<option value="${escHtml(v)}"${v === value ? ' selected' : ''}>${escHtml(l)}</option>`).join('')
        + `</select>`;
}

// ---------------------------------------------------------------------------
// The simple editors of this part: sex, living / deceased, the periods of
// birth, death and marriage (the others come with the catalog, §3).
// ---------------------------------------------------------------------------

const YEAR_MIN = 1;
const YEAR_MAX = 2999;

/** A year typed in a field: a whole number in range, '' = not set (undefined), NaN = not a year. */
function typedYear(v: string): number | undefined {
    const s = v.trim();
    if (!s) return undefined;
    const n = Number(s);
    return Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX ? n : NaN;
}

function yearsEditor(): RuleCondEditor<'born' | 'died' | 'married'> {
    const html = (p: RuleYears, ctx: RuleEditorCtx): string => {
        const a = strings.lists.rules.yearAria;
        const field = (name: 'from' | 'to', v: number | undefined, label: string): string =>
            `<input type="number" class="pln-ctl plr-yr" data-pc="${name}" data-key="${escHtml(ctx.key(name))}" min="${YEAR_MIN}" max="${YEAR_MAX}" step="1"`
            + ` inputmode="numeric" value="${v === undefined || !Number.isFinite(v) ? '' : v}" aria-label="${escHtml(label)}">`;
        return field('from', p.from, a.from) + `<span class="plr-dash" aria-hidden="true">–</span>` + field('to', p.to, a.to);
    };
    const read = (cond: { p: RuleYears }, el: Control): RuleYears | null => {
        const name = el.dataset.pc;
        if (name !== 'from' && name !== 'to') return null;
        const y = typedYear(el.value);
        const next: RuleYears = { ...cond.p };
        if (y === undefined) delete next[name]; else next[name] = y;
        return next;
    };
    return {
        group: 'b', order: 0,
        create: () => ({}),
        paramsHtml: (cond, ctx) => html(cond.p, ctx),
        change: (cond, el) => read(cond, el),
        input: (cond, el) => read(cond, el),
        firstControl: 'from',
    };
}

registerRuleCondEditor('born', yearsEditor() as RuleCondEditor<'born'>);
registerRuleCondEditor('died', { ...(yearsEditor() as RuleCondEditor<'died'>), order: 1 });
registerRuleCondEditor('married', { ...(yearsEditor() as RuleCondEditor<'married'>), order: 2 });

registerRuleCondEditor('alive', {
    group: 'b', order: 5,
    create: () => ({ value: 'living' }),
    paramsHtml: (cond, ctx) => {
        const w = strings.lists.rules.say.alive;
        return ctlSelect(ctx, 'value', strings.lists.rules.cond.alive, [['living', w.living], ['deceased', w.deceased]], cond.p.value);
    },
    change: (_cond, el) => el.value === 'deceased' ? { value: 'deceased' } : { value: 'living' },
    firstControl: 'value',
});

registerRuleCondEditor('gender', {
    group: 'd', order: 0,
    create: () => ({ value: 'female' }),
    paramsHtml: (cond, ctx) => {
        const w = strings.lists.rules.say.gender;
        return ctlSelect(ctx, 'value', strings.lists.rules.cond.gender, [['female', w.female], ['male', w.male], ['unknown', w.unknown]], cond.p.value);
    },
    change: (_cond, el) => ({ value: el.value === 'male' ? 'male' : el.value === 'unknown' ? 'unknown' : 'female' }),
    firstControl: 'value',
});

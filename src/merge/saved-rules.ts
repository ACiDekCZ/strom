/**
 * Rules saved for a program (spec 134 K10.4): the scope of step 1 and who is
 * right (step 4) remembered for files the same program wrote. Step 5 offers
 * to remember them, step 1 of the next guide with a file of that program is
 * filled in from them (it can be changed), Settings lists them with Remove.
 *
 * Only the scope and the rules for the whole merge and by kind of detail are
 * saved: rules by person or value belong to one tree's people. The rule lives
 * in this device's settings, never in a tree (no new data version).
 */

import type { SavedMergeRule } from '../types.js';
import type { PlanScope, RuleChoice, WizardChoices } from './plan.js';
import { strings } from '../strings.js';

/** A rule's name as step 4 says it ("My tree wins"). */
function ruleName(c: RuleChoice): string {
    const W = strings.mergeWizard;
    return { mine: W.rMine, import: W.rImport, both: W.rBoth, precise: W.rPrecise, each: W.rEach }[c];
}

/** The program that wrote the import's file, '' when the file does not say (a tree, a view, a .json). */
export function sourceProgram(c: Pick<WizardChoices, 'source'>): string {
    return c.source.kind === 'ged' ? c.source.program?.trim() ?? '' : '';
}

/** Step 5 offers to remember: a file that names its program, added to a tree or only compared (a new tree has no scope or rules). */
export function canRemember(c: WizardChoices): boolean {
    return !!sourceProgram(c) && (c.mode === 'add' || c.mode === 'compare') && !c.json;
}

/** The rule the choices would save (null when they cannot be remembered). */
export function ruleFromChoices(c: WizardChoices, now: Date = new Date()): SavedMergeRule | null {
    if (!canRemember(c)) return null;
    const kind = c.rules?.kind ? Object.fromEntries(Object.entries(c.rules.kind).filter(([, v]) => !!v)) : {};
    return {
        program: sourceProgram(c),
        scope: c.scope,
        rules: { all: c.rules?.all ?? 'mine', ...(Object.keys(kind).length ? { kind } : {}) },
        savedAt: now.toISOString(),
    };
}

/**
 * Fresh choices filled in from a saved rule: its scope and rules (by kind
 * too), and the program it came from for step 1's note. Without a rule (or
 * without a program) the choices stay as they are.
 */
export function applySavedRule(c: WizardChoices, rule: SavedMergeRule | null | undefined): WizardChoices {
    if (!rule || !sourceProgram(c)) return c;
    return {
        ...c,
        scope: rule.scope as PlanScope,
        rules: { all: rule.rules.all, ...(rule.rules.kind && Object.keys(rule.rules.kind).length ? { kind: { ...rule.rules.kind } } : {}) },
        prefilledFrom: sourceProgram(c),
    };
}

/** Who is right, said: the rule for the whole merge, and that kinds of detail have their own. */
export function ruleText(rules: Pick<SavedMergeRule['rules'], 'all' | 'kind'>): string {
    const all = ruleName(rules.all);
    return rules.kind && Object.keys(rules.kind).length ? `${all}, ${strings.mergeWizard.rememberKinds}` : all;
}

/** Step 5's checkbox: "Remember for files from {program}: scope a), My tree wins". */
export function rememberLabel(c: WizardChoices): string {
    return strings.mergeWizard.rememberRules(sourceProgram(c), c.scope, ruleText(c.rules ?? { all: 'mine' }));
}

/** A row of Settings' list: "scope a) Only missing people · My tree wins". */
export function savedRuleDetail(rule: SavedMergeRule): string {
    const W = strings.mergeWizard;
    const scope = { a: W.scopeA, b: W.scopeB, c: W.scopeC, d: W.scopeD }[rule.scope];
    return W.rulesRowDetail(scope, ruleText(rule.rules));
}

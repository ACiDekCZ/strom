/**
 * The built-in templates of custom list rules (spec 136 §7): offered only
 * when a new list is made. Each has a stable id (stored in the list's
 * `origin.template`), a menu group and a rule whose person or place is
 * still "to fill in" (an empty id). Names and descriptions are in
 * `strings.lists.templates.<id>`.
 */

import { FAMILY_PRESETS } from './lineage.js';
import { ruleNeeds, type RuleNeed } from './person-list-rules.js';
import { strings } from './strings.js';
import type { PersonId, RuleCond, RuleGroup, RuleNearEvent } from './types.js';

/** The stable ids of the built-in templates, in the menu's order. */
export const LIST_TEMPLATE_IDS = [
    'missingSource', 'lineEnds', 'noBirth', 'conflicts', 'inProgress',
    'paternal', 'descendantsN', 'nearPlace', 'diedYoung',
    'noPhoto', 'living', 'recent',
] as const;

export type ListTemplateId = typeof LIST_TEMPLATE_IDS[number];

/** The menu group of a built-in template (`strings.lists.templates.group.*`; `own` = saved on the device). */
export type ListTemplateGroup = 'missing' | 'family' | 'story';

export interface BuiltinListTemplate {
    id: ListTemplateId;
    group: ListTemplateGroup;
    /** Offered only in a research tree (needs its conflicts / open tasks). */
    research?: true;
}

export const LIST_TEMPLATES: readonly BuiltinListTemplate[] = [
    { id: 'missingSource', group: 'missing' },
    { id: 'lineEnds', group: 'missing' },
    { id: 'noBirth', group: 'missing' },
    { id: 'conflicts', group: 'missing', research: true },
    { id: 'inProgress', group: 'missing', research: true },
    { id: 'paternal', group: 'family' },
    { id: 'descendantsN', group: 'family' },
    { id: 'nearPlace', group: 'family' },
    { id: 'diedYoung', group: 'family' },
    { id: 'noPhoto', group: 'story' },
    { id: 'living', group: 'story' },
    { id: 'recent', group: 'story' },
];

const ALL_EVENTS: RuleNearEvent[] = ['birth', 'death', 'marriage', 'residence'];

function isTemplateId(id: string): id is ListTemplateId {
    return (LIST_TEMPLATE_IDS as readonly string[]).includes(id);
}

/**
 * The name of the template a list came from: a built-in one's in the current
 * language (its stable id), a template saved on the device or one this app
 * does not know by the name stored with the list.
 */
export function listTemplateName(origin: { template: string; name: string }): string {
    return isTemplateId(origin.template) ? strings.lists.templates[origin.template].name : origin.name;
}

/** "Family of a person" with a quick choice's axes and the person to fill in. */
function family(preset: keyof typeof FAMILY_PRESETS, over: { down?: number } = {}): RuleCond {
    return { t: 'cond', c: 'family', p: { personId: '' as PersonId, personName: '', ...FAMILY_PRESETS[preset], ...over } };
}

function all(...items: RuleCond[]): RuleGroup {
    return { t: 'group', op: 'all', items };
}

/**
 * The rule of a built-in template (a fresh copy every call), or null for an
 * unknown id. The person or place it needs is empty ("to fill in"; see
 * templateNeeds and fillRuleParams).
 */
export function templateRoot(id: string): RuleGroup | null {
    if (!isTemplateId(id)) return null;
    switch (id) {
        case 'missingSource': return all(family('ancestors'), { t: 'cond', c: 'has', p: { have: false, what: 'source' } });
        case 'lineEnds': return all(family('ancestors'), { t: 'cond', c: 'has', p: { have: false, what: 'parents' } });
        case 'noBirth': return {
            t: 'group', op: 'any', items: [
                { t: 'cond', c: 'has', p: { have: false, what: 'birthDate' } },
                { t: 'cond', c: 'has', p: { have: false, what: 'birthPlace' } },
            ],
        };
        case 'conflicts': return all({ t: 'cond', c: 'has', p: { have: true, what: 'conflict' } });
        case 'inProgress': return all({ t: 'cond', c: 'has', p: { have: true, what: 'openTask' } });
        case 'paternal': return all(family('paternal'));
        case 'descendantsN': return all(family('descendants', { down: 3 }));
        case 'nearPlace': return all({ t: 'cond', c: 'near', p: { placeKey: '', placeName: '', events: [...ALL_EVENTS], km: 10 } });
        case 'diedYoung': return all({ t: 'cond', c: 'deathAge', p: { to: 5 } });
        case 'noPhoto': return all(family('ancestors'), { t: 'cond', c: 'has', p: { have: false, what: 'photo' } });
        case 'living': return all({ t: 'cond', c: 'alive', p: { value: 'living' } });
        case 'recent': return all({ t: 'cond', c: 'added', p: { days: 7 } });
    }
}

/** What a template asks for before its rule can be saved: a person, a place or nothing (the menu's "needs a person"). */
export function templateNeeds(id: string): 'person' | 'place' | null {
    const root = templateRoot(id);
    if (!root) return null;
    const needs: RuleNeed[] = ruleNeeds(root);
    if (needs.includes('person')) return 'person';
    if (needs.includes('place')) return 'place';
    return null;
}

/** The built-in templates offered in a tree (the research's only in a research tree), in the menu's order. */
export function templatesFor(isResearchTree: boolean): BuiltinListTemplate[] {
    return LIST_TEMPLATES.filter(t => !t.research || isResearchTree);
}

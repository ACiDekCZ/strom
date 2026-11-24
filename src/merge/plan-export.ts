/**
 * "Save the list…" of step 5 (spec 134 §8, K6.4): the plan as text, group by
 * group as step 5 lists it, and as JSON (the plan itself). Only what is
 * ticked happens, so only items that are on are listed. Living people are
 * named as the protection of the living asks (§13 13e): initials, "Living
 * person", or in full; their details are not written out.
 * No DOM here: step 5 and the tests share it.
 */

import { strings } from '../strings.js';
import { inferBirthUpperBounds, isLivingPerson, type PrivacyMode } from '../privacy.js';
import type { Person, PersonId, StromData } from '../types.js';
import { changesValue, planCounts, type MergePlan, type PlanItem } from './plan.js';
import { afterText } from './plan-rules.js';

export interface PlanExportContext {
    /** The import's data (names of its people, sources, places, files). */
    source: StromData;
    /** The target as compared (names of the tree's people). */
    target: StromData;
    /** How living people are named; 'initials' when not given. */
    privacy?: PrivacyMode;
    /** The year living is judged by (tests); this year when not given. */
    year?: number;
}

/** Names of people as the protection of the living asks. */
function namer(data: StromData, mode: PrivacyMode, year: number): { name(id: string): string; living(id: string): boolean } {
    const bounds = mode === 'full' ? undefined : inferBirthUpperBounds(data);
    const cache = new Map<string, boolean>();
    const living = (id: string): boolean => {
        if (mode === 'full') return false;
        let v = cache.get(id);
        if (v === undefined) {
            const p = data.persons[id as PersonId];
            cache.set(id, v = !!p && !p.isPlaceholder && isLivingPerson(p, year, bounds));
        }
        return v;
    };
    const initial = (s: string): string => s.trim() ? `${s.trim()[0].toUpperCase()}.` : '';
    const name = (id: string): string => {
        const p: Person | undefined = data.persons[id as PersonId];
        if (!p) return '?';
        const full = [p.firstName, p.lastName].filter(Boolean).join(' ') || '?';
        if (!living(id)) {
            const years = [p.birthDate, p.deathDate].map(d => /\d{4}/.exec(d ?? '')?.[0] ?? '');
            return years[0] || years[1] ? `${full} (${years[0]}–${years[1]})` : full;
        }
        if (mode === 'initials') return [initial(p.firstName), initial(p.lastName)].filter(Boolean).join(' ') || '?';
        if (mode === 'minimal') return [strings.privacy.livingPerson, p.lastName].filter(Boolean).join(' ');
        return strings.privacy.livingPerson;
    };
    return { name, living };
}

/** The plan as text (group by group) and as JSON. */
export function exportPlan(plan: MergePlan, ctx: PlanExportContext): { txt: string; json: string } {
    const t = strings.mergeWizard;
    const mode = ctx.privacy ?? 'initials';
    const year = ctx.year ?? new Date().getFullYear();
    const src = namer(ctx.source, mode, year);
    const tree = namer(ctx.target, mode, year);
    const label = (field: string): string => (t.fieldNames as Record<string, string>)[field] ?? field;
    const on = <K extends PlanItem['kind']>(kind: K): Array<PlanItem & { kind: K }> =>
        plan.items.filter((i): i is PlanItem & { kind: K } => i.kind === kind && (!('on' in i) || i.on));

    const lines: string[] = [`${t.planTitle}: ${plan.source.label} → ${plan.target.name}`, plan.createdAt, ''];
    const group = (title: string, items: string[]): void => {
        if (!items.length) return;
        lines.push(`${title} (${items.length})`, ...items.map(i => `  ${i}`), '');
    };

    group(t.gNew, on('person-add').map(i => `+ ${src.name(i.id)}`));
    group(t.gJoined, on('person-join').filter(i => !i.standIn).map(i => `= ${src.name(i.id)} · ${t.joinedWith(tree.name(i.target))}`));
    group(t.gFields, on('field').filter(changesValue).map(i => tree.living(i.person)
        ? `~ ${tree.name(i.person)}: ${label(i.field)}`
        : `~ ${tree.name(i.person)}: ${label(i.field)}: ${i.before || '—'} → ${afterText(i.field, i.before, i.after) || '—'}`));
    group(t.gLinks, [
        ...on('partnership-add').map(i => {
            const u = ctx.source.partnerships[i.id as keyof StromData['partnerships']];
            return `+ ${u ? `${src.name(u.person1Id)} & ${src.name(u.person2Id)}` : i.id}`;
        }),
        ...on('link-add').map(i => {
            const [child, parent] = i.id.split('<');
            return `+ ${src.name(child)} ← ${src.name(parent)}`;
        }),
    ]);
    const record = (kind: 'source' | 'place' | 'media', title: (id: string) => string, joined: (id: string) => string): string[] =>
        on(kind).map(i => i.joinedWith ? `= ${title(i.id)} · ${t.joinedWith(joined(i.joinedWith))}` : `+ ${title(i.id)}`);
    group(t.gSources, record('source',
        id => ctx.source.sources?.[id]?.title || id,
        id => ctx.target.sources?.[id]?.title || id));
    group(t.gPlaces, record('place', id => id, id => id));
    group(t.gMedia, record('media',
        id => ctx.source.media?.[id]?.name || id,
        id => ctx.target.media?.[id]?.name || id));
    const skipped = plan.items.flatMap(i => i.kind === 'skip' || (i.kind === 'person-add' && !i.on) ? [i.id] : []);
    group(t.gSkipped, skipped.map(id => `- ${src.name(id)}`));
    group(t.cntPending, plan.items
        .filter((i): i is Extract<PlanItem, { kind: 'person-pending' | 'group-pending' }> => i.kind === 'person-pending' || i.kind === 'group-pending')
        .map(i => `? ${src.name(i.id)}`));
    group(t.gNotTaken, plan.notTaken.filter(d => d.count > 0).map(d => t.notTakenItem(d.label ? `${d.tag} – ${d.label}` : d.tag, d.count, d.example)));

    const c = planCounts(plan);
    lines.push(`${t.cntJoined} ${c.joined} · ${t.cntNew} ${c.added} · ${t.cntSkipped} ${c.skipped} · ${t.cntPending} ${c.pending} · ${t.cntTotal(c.total)}`, '');
    return { txt: lines.join('\n'), json: JSON.stringify(plan, null, 2) };
}

/**
 * The tree's merges in words (spec 134 §9, §10): a row of the Merge history
 * (9a), the list of a merge read from its record (9b), and what the undo
 * dialog says (10a–10f): what goes, what comes back, what is kept because it
 * changed since, the later merges standing on it, what was undone before.
 * Pure: no DOM (the dialogs: src/ui/merge-history-ui.ts).
 */

import type { MergeRecord, Partnership, Person, PersonId, StromData } from '../types.js';
import { strings, getCurrentLanguage, type Language } from '../strings.js';
import { yearOf } from '../dates.js';
import { inferBirthUpperBounds, isLivingPerson } from '../privacy.js';
import { displayName, familyName } from './plan-select.js';
import { fold, yearsText } from './steps/step3-model.js';
import type { PlanLine, PlanListGroup } from './steps/step5-plan.js';
import { relativesOf, undoneItems, undoPreview, type ChangedSince, type ChangedWhat, type UndoPreview } from './undo-plan.js';

// ==================== WORDS ====================

/** A day as the language writes it with its year ("22. 11. 2026"); '' when unknown. */
export function dayText(at: string, lang: Language = getCurrentLanguage()): string {
    if (!at) return '';
    const plain = /^\d{4}-\d{2}-\d{2}$/.test(at);
    const ts = plain ? new Date(`${at}T12:00:00`).getTime() : Date.parse(at);
    if (!Number.isFinite(ts)) return '';
    return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(ts);
}

/** The state's word on its tag: stands / partly undone / undone. */
export function stateLabel(state: MergeRecord['state']): string {
    const W = strings.mergeWizard;
    return state === 'undone' ? W.stUndone : state === 'partial' ? W.stPartial : W.stValid;
}

/** Where the merge came from: the file and its program, a tree, a view. */
export function historySource(r: MergeRecord): string {
    const label = r.source.label || '?';
    if (r.source.kind === 'tree') return strings.mergeWizard.histSrcTree(label);
    return [label, r.source.program].filter(Boolean).join(' · ');
}

/** A history row's second line: the source and what the merge brought. */
export function historyLine(r: MergeRecord): string {
    const c = r.counts;
    return `${historySource(r)} · ${strings.mergeWizard.histCounts(c.added, c.joined, c.fieldChanges)}`;
}

/** The merge can be undone from the history (something left of it; a merge into a tree that was there). */
export function canUndoRecord(r: MergeRecord): boolean {
    return r.state !== 'undone' && !r.target.newTree;
}

// ==================== THE LIST OF A RECORD (9b) ====================

function personYears(p: Person | undefined): string {
    return p ? yearsText({ born: yearOf(p.birthDate), died: yearOf(p.deathDate) }) : '';
}

function coupleName(data: StromData, u: Partnership | undefined, fallback: string): string {
    if (!u) return fallback;
    const n = (id: PersonId): string => displayName(data.persons[id]) || '?';
    return `${n(u.person1Id)} & ${n(u.person2Id)}`;
}

/**
 * What a merge brought, group by group as step 5 listed it, read from its
 * record and the tree as it is now (the import itself is not kept): the
 * people it added and joined, the details it changed, the couples, sources,
 * places and files it added. The counts are the record's; a record no longer
 * in the tree (undone, deleted since) is said in the group's line. Living
 * people's details are not shown.
 */
export function recordGroups(record: MergeRecord, data: StromData): PlanListGroup[] {
    const W = strings.mergeWizard;
    const c = record.counts;
    const groups: PlanListGroup[] = [];
    const add = (key: PlanListGroup['key'], title: string, count: number, summary: string, lines: PlanLine[]): void => {
        groups.push({ key, title, count, summary, lines, kept: [], keptText: '' });
    };
    const year = new Date().getFullYear();
    let bounds: Map<string, number> | null = null;
    const living = (id: PersonId): boolean => {
        const p = data.persons[id];
        if (!p || p.isPlaceholder) return false;
        bounds ??= inferBirthUpperBounds(data);
        return isLivingPerson(p, year, bounds);
    };
    const gone = (n: number, summary: string): string => n > 0 ? [summary, W.recNotInTree(n)].filter(Boolean).join(' · ') : summary;
    const personLine = (key: string, id: PersonId, text = ''): PlanLine => {
        const p = data.persons[id];
        const name = displayName(p) || '?';
        return { key, on: true, can: false, name, years: personYears(p), text, person: id, living: living(id), find: fold(`${name} ${text}`) };
    };

    // New, by family name.
    const rods = new Map<string, number>();
    const fresh: Array<{ line: PlanLine; rod: string }> = [];
    let missing = 0;
    for (const id of record.added) {
        const p = data.persons[id];
        if (!p) { missing++; continue; }
        if (p.isPlaceholder) continue;
        const rod = familyName(data, p) || W.s3NoSurname;
        rods.set(rod, (rods.get(rod) ?? 0) + 1);
        fresh.push({ line: personLine(`p:${id}`, id), rod });
    }
    fresh.sort((a, b) => a.rod.localeCompare(b.rod) || a.line.name.localeCompare(b.line.name));
    const rodSummary = [...rods].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} ${n.toLocaleString()}`).join(' · ');
    add('new', W.gNew, c.added, gone(missing, rodSummary), fresh.map(f => f.line));

    // Joined: the tree's people.
    const joined = record.joined.filter(([t]) => data.persons[t]).map(([t]) => personLine(`j:${t}`, t));
    add('joined', W.gJoined, c.joined, W.joinedSum(c.joined, c.fieldChanges), joined);

    // Detail changes, before → after (a living person's values not shown).
    const fieldName = (f: string): string => (W.fieldNames as Record<string, string>)[f] ?? f;
    const fields = record.fields.map(f => {
        const value = living(f.person) ? fieldName(f.field) : `${fieldName(f.field)}: ${f.before || '—'} → ${f.after || '—'}`;
        return personLine(`f:${f.person}|${f.field}`, f.person, value);
    });
    add('fields', W.gFields, c.fieldChanges + c.alongside, '', fields);

    // Couples and links.
    const couples = record.partnerships.filter(id => data.partnerships[id as keyof StromData['partnerships']]).map(id => {
        const name = coupleName(data, data.partnerships[id as keyof StromData['partnerships']], id);
        return { key: `l:${id}`, on: true, can: false, name, years: '', text: '', find: fold(name) } satisfies PlanLine;
    });
    add('links', W.gLinks, c.partnerships + c.links,
        gone(record.partnerships.length - couples.length, W.linksSum(c.partnerships, c.links)), couples);

    // Sources, places, files the merge added.
    const records = (key: 'sources' | 'places' | 'media', title: string, ids: readonly string[], nameOf: (id: string) => string | undefined): void => {
        if (key === 'media' && !ids.length) return;
        const lines: PlanLine[] = [];
        for (const id of ids) {
            const name = nameOf(id);
            if (name === undefined) continue;
            lines.push({ key: `r:${key}:${id}`, on: true, can: false, name: name || id, years: '', text: '', find: fold(name || id) });
        }
        add(key, title, ids.length, gone(ids.length - lines.length, W.recordsSum(ids.length, 0)), lines);
    };
    records('sources', W.gSources, record.sources, id => data.sources?.[id] ? data.sources[id].title ?? '' : undefined);
    records('places', W.gPlaces, record.places, id => data.places?.[id] ? id : undefined);
    records('media', W.gMedia, record.media, id => data.media?.[id] ? data.media[id].name ?? '' : undefined);

    // Not added: only their number is kept.
    add('skipped', W.gSkipped, c.skipped, '', []);
    return groups;
}

/** The list of a record as a text file (Save the list… of 9b). */
export function recordText(record: MergeRecord, treeName: string, groups: readonly PlanListGroup[]): string {
    const W = strings.mergeWizard;
    const out = [
        W.recTitle(dayText(record.at)),
        `${record.source.label || '?'} → ${treeName} · ${stateLabel(record.state)}`,
        '',
    ];
    for (const g of groups) {
        out.push(`${g.title} (${g.count.toLocaleString()})${g.summary ? ` – ${g.summary}` : ''}`);
        for (const l of g.lines) out.push(`  ${[l.name, l.years, l.text].filter(Boolean).join(' · ')}`);
        out.push('');
    }
    return out.join('\n');
}

// ==================== THE UNDO DIALOG (10a–10f) ====================

/** One thing the undo takes back, named for the dialog. */
export interface UndoLine {
    id: string;
    group: 'remove' | 'restore' | 'unjoin';
    name: string;
    text: string;
}

/** A thing kept because it changed since (K8.3), with why. */
export interface KeepRow {
    id: string;
    name: string;
    text: string;
    /** A later merge stands on it (said as a warning, 10c). */
    warn: boolean;
    /** It can be undone anyway (not a picture without the backup). */
    canUndo: boolean;
}

export interface UndoModel {
    preview: UndoPreview;
    /** Real people the undo removes when nothing is kept (placeholders aside). */
    people: number;
    couples: number;
    sources: number;
    places: number;
    files: number;
    /** Details back to their value before (records of the tree and the joined people's details). */
    restored: number;
    /** Joined people losing what the merge brought. */
    unjoined: number;
    lines: UndoLine[];
    keep: KeepRow[];
    /** The later merges standing on this one (10c). */
    builtOn: string[];
    /** What was undone before (10d), '' when nothing. */
    partly: string;
    /** Nothing of the merge is left to undo. */
    empty: boolean;
}

/** The name of what an undo item is about (a person, a couple, a source…). */
export function itemName(id: string, data: StromData): string {
    const W = strings.mergeWizard;
    const person = (pid: string): string => displayName(data.persons[pid as PersonId]) || '?';
    const kind = id.slice(0, 2);
    const ref = id.slice(2);
    switch (kind) {
        case 'p:': case 'j:': return person(ref);
        case 'f:': {
            const [pid, field] = ref.split('|');
            return `${person(pid)} · ${(W.fieldNames as Record<string, string>)[field] ?? field}`;
        }
        case 'u:': return coupleName(data, data.partnerships[ref as keyof StromData['partnerships']], ref);
        case 's:': return data.sources?.[ref]?.title || ref;
        case 'm:': return data.media?.[ref]?.name || ref;
        case 'l:': return ref;
        case 't:': {
            const slash = ref.indexOf('/');
            const coll = ref.slice(0, slash);
            const rid = ref.slice(slash + 1);
            if (coll === 'persons') return person(rid);
            if (coll === 'partnerships') return coupleName(data, data.partnerships[rid as keyof StromData['partnerships']], rid);
            if (coll === 'sources') return data.sources?.[rid]?.title || rid;
            if (coll === 'media') return data.media?.[rid]?.name || rid;
            return rid;
        }
        default: return id;
    }
}

/** Why an item is kept, in words. */
export function keepReason(c: ChangedSince, data: StromData): string {
    const W = strings.mergeWizard;
    const reasons: Record<ChangedWhat, () => string> = {
        edited: () => W.uEdited,
        proven: () => W.uProven(dayText(c.at)),
        relative: () => W.uRelative(displayName(data.persons[c.person as PersonId]) || '?', dayText(c.at)),
        merge: () => W.uLaterMerge(dayText(c.at)),
        used: () => W.uUsed,
        picture: () => W.uPicture,
    };
    return reasons[c.what]();
}

/** What the undo dialog says of merge `record` over the tree as it is now. */
export function undoModel(record: MergeRecord, data: StromData): UndoModel {
    const W = strings.mergeWizard;
    const preview = undoPreview(record, data);
    const real = (id: string): boolean => !data.persons[id as PersonId]?.isPlaceholder;
    const byKind = (k: string): number => preview.remove.filter(i => i.kind === k).length;
    const fieldCount = preview.unjoin.reduce((n, j) => n + j.fields.length, 0);
    const lines: UndoLine[] = [
        ...preview.remove.filter(i => i.kind !== 'person' || real(i.ref)).map(i => ({ id: i.id, group: 'remove' as const, name: itemName(i.id, data), text: '' })),
        ...preview.restore.map(i => ({ id: i.id, group: 'restore' as const, name: itemName(i.id, data), text: '' })),
        ...preview.unjoin.flatMap(j => j.fields.map(f => ({ id: f, group: 'restore' as const, name: itemName(f, data), text: '' }))),
        ...preview.unjoin.map(j => ({ id: j.id, group: 'unjoin' as const, name: itemName(j.id, data), text: '' })),
    ];

    // Kept unless chosen: one row per item, its reasons together.
    const keep: KeepRow[] = [];
    for (const c of preview.changedSince) {
        const text = keepReason(c, data);
        const row = keep.find(k => k.id === c.id);
        if (row) {
            if (!row.text.includes(text)) row.text += `; ${text}`;
            row.warn ||= c.what === 'merge';
            row.canUndo &&= c.what !== 'picture';
            continue;
        }
        keep.push({ id: c.id, name: itemName(c.id, data), text, warn: c.what === 'merge', canUndo: c.what !== 'picture' });
    }

    // Later merges standing on it (10c): which of our people, how many of theirs linked to them.
    const builtOn = preview.dependents.map(dep => {
        const hits = [...new Set(preview.changedSince.filter(c => c.what === 'merge' && c.merge === dep.id && c.person).map(c => c.person!))];
        const ours = new Set<string>(hits);
        const linked = dep.added.filter(id => {
            const p = data.persons[id];
            return !!p && !p.isPlaceholder && relativesOf(data, p).some(r => ours.has(r));
        }).length;
        const name = hits.length ? displayName(data.persons[hits[0]]) || '?' : '?';
        return W.builtOn(dayText(dep.at), linked || hits.length, name);
    });

    // Undone before (10d).
    let partly = '';
    const undone = record.undone ?? [];
    if (undone.length) {
        const done = undoneItems(record);
        const gone = [...done].filter(id => id.startsWith('p:')).length;
        partly = W.partlyDone(dayText(undone[undone.length - 1].at), gone, preview.remove.filter(i => i.kind === 'person' && real(i.ref)).length);
    }

    return {
        preview,
        people: preview.remove.filter(i => i.kind === 'person' && real(i.ref)).length,
        couples: byKind('partnership'),
        sources: byKind('source'),
        places: byKind('place'),
        files: byKind('media'),
        restored: preview.restore.length + fieldCount,
        unjoined: preview.unjoin.length,
        lines,
        keep,
        builtOn,
        partly,
        empty: !preview.remove.length && !preview.restore.length && !preview.unjoin.length,
    };
}

/**
 * Real people the undo removes with these choices: the ticked ones (all
 * when `only` is null), those kept because they changed since aside unless
 * chosen (`undo`).
 */
export function peopleRemoved(model: UndoModel, undo: ReadonlySet<string>, only: ReadonlySet<string> | null, data: StromData): number {
    const kept = new Set(model.keep.filter(k => !undo.has(k.id) || !k.canUndo).map(k => k.id));
    return model.preview.remove.filter(i => i.kind === 'person' && !data.persons[i.ref as PersonId]?.isPlaceholder
        && (!only || only.has(i.id)) && !kept.has(i.id)).length;
}

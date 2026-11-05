/**
 * A person the research works on who is not drawn in the fan: the nearest
 * person of the fan to label instead (the anchor), and how the two are
 * related. Order: the person is in the fan (no label) → a spouse of someone
 * in it → a sibling of someone in it → an ancestor of the centre beyond the
 * rings (the outermost ancestor on that line, "generation N") → a descendant
 * of the centre while descendants are not drawn (the centre) → the first
 * ancestor of the person that is in the fan (up to 12 generations) → none.
 * Pure: reads the data and the fan's model only.
 */

import { StromData, PersonId } from './types.js';
import { findRelationship, KinshipTerm } from './kinship.js';

/** What the anchor search needs of the fan's model. */
export interface FanAnchorModel {
    focus: { id: PersonId };
    generations: number;
    sectors: ReadonlyArray<{ person: { id: PersonId } | null }>;
    desc: ReadonlyArray<{ person: { id: PersonId } | null }>;
}

export type FanAnchorKind = 'in' | 'spouse' | 'sibling' | 'beyond' | 'descendant' | 'ancestor' | 'none';

export interface FanAnchor {
    kind: FanAnchorKind;
    /** The person of the fan the label stands at (null: 'in' and 'none'). */
    anchorId: PersonId | null;
    /** The target as seen from the anchor ("wife", "great-grandmother"); null when unknown. */
    term: KinshipTerm | null;
    /** 'beyond': the target's generation counted from the centre (parents = 1). */
    generation?: number;
}

const MAX_UP = 12;

/** The people drawn in the fan (the centre, the ancestor rings, descendants and their partners). */
export function fanPeople(model: FanAnchorModel): Set<PersonId> {
    const v = new Set<PersonId>([model.focus.id]);
    for (const s of model.sectors) if (s.person) v.add(s.person.id);
    for (const s of model.desc) if (s.person) v.add(s.person.id);
    return v;
}

function term(data: StromData, anchorId: PersonId, targetId: PersonId): KinshipTerm | null {
    return findRelationship(data, anchorId, targetId)?.term ?? null;
}

export function findFanAnchor(data: StromData, targetId: PersonId, model: FanAnchorModel, visible?: ReadonlySet<PersonId>): FanAnchor {
    const V = visible ?? fanPeople(model);
    const target = data.persons[targetId];
    if (!target) return { kind: 'none', anchorId: null, term: null };
    if (V.has(targetId)) return { kind: 'in', anchorId: null, term: null };
    const hit = (kind: FanAnchorKind, anchorId: PersonId, extra: Partial<FanAnchor> = {}): FanAnchor =>
        ({ kind, anchorId, term: term(data, anchorId, targetId), ...extra });

    // 2. A spouse of someone in the fan.
    for (const uid of target.partnerships ?? []) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const other = u.person1Id === targetId ? u.person2Id : u.person1Id;
        if (!other || !V.has(other)) continue;
        const a = hit('spouse', other);
        // "wife / partner": a marriage says which of the two.
        if (a.term && (u.status === 'married' || u.status === 'divorced')) {
            const first = (t: string) => t.split(' / ')[0];
            a.term = { cs: first(a.term.cs), en: first(a.term.en), de: first(a.term.de), pl: first(a.term.pl) };
        }
        return a;
    }

    // 3. A sibling of someone in the fan (half-siblings too).
    for (const pid of target.parentIds ?? []) {
        const parent = data.persons[pid];
        for (const sid of parent?.childIds ?? []) {
            if (sid !== targetId && V.has(sid)) return hit('sibling', sid);
        }
    }

    // 4. An ancestor of the centre beyond the rings: the outermost person of that line in the fan.
    const centre = model.focus.id;
    const down = new Map<PersonId, PersonId>(); // ancestor → the child on the way to the centre
    const depth = new Map<PersonId, number>([[centre, 0]]);
    let frontier: PersonId[] = [centre];
    for (let d = 1; d <= MAX_UP + model.generations && frontier.length; d++) {
        const next: PersonId[] = [];
        for (const id of frontier) {
            for (const pid of data.persons[id]?.parentIds ?? []) {
                if (depth.has(pid) || !data.persons[pid]) continue;
                depth.set(pid, d);
                down.set(pid, id);
                next.push(pid);
            }
        }
        frontier = next;
    }
    const gen = depth.get(targetId);
    if (gen !== undefined && gen > model.generations) {
        let at: PersonId | undefined = down.get(targetId);
        while (at && !V.has(at)) at = down.get(at);
        if (at) return hit('beyond', at, { generation: gen });
    }

    // 5. A descendant of the centre while the fan draws no descendants.
    if (model.desc.length === 0) {
        const seen = new Set<PersonId>([centre]);
        let level: PersonId[] = [centre];
        while (level.length) {
            const next: PersonId[] = [];
            for (const id of level) {
                for (const cid of data.persons[id]?.childIds ?? []) {
                    if (seen.has(cid)) continue;
                    if (cid === targetId) return hit('descendant', centre);
                    seen.add(cid);
                    next.push(cid);
                }
            }
            level = next;
        }
    }

    // 6. The first ancestor of the person that is in the fan.
    const seen = new Set<PersonId>([targetId]);
    let level: PersonId[] = [targetId];
    for (let d = 1; d <= MAX_UP && level.length; d++) {
        const next: PersonId[] = [];
        for (const id of level) {
            for (const pid of data.persons[id]?.parentIds ?? []) {
                if (seen.has(pid) || !data.persons[pid]) continue;
                if (V.has(pid)) return hit('ancestor', pid);
                seen.add(pid);
                next.push(pid);
            }
        }
        level = next;
    }

    return { kind: 'none', anchorId: null, term: null };
}

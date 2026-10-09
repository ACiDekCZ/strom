/**
 * The view layer: links "linked in the view only" (src/view-links.ts) laid
 * out as if they were real.
 *
 * The tree's data are never changed. The layout sees a derived copy where
 * each drawn link is applied the way a real link would stand in the data:
 *
 * - `child`, two shown parents: the anchor becomes a child of their family
 *   (their couple's family, or a new one when they have none).
 * - `child`, one shown parent beside a real one: the shown parent takes the
 *   place of the "?" stand-in of the anchor's family (alone in it: in its
 *   place; with siblings: the anchor moves into a family of the two, as
 *   "Add parent" does — src/single-parent.ts fillPlaceholder).
 * - `child`, one shown parent and no real one: a family of that parent and a
 *   "?" stand-in (the shape every single parent has in the data; the diagram
 *   leaves the empty "?" out).
 * - `partners`: a partnership of the anchor and the shown partner.
 *
 * Only copies of what a link touches are made; the rest of the copy shares
 * the tree's objects (read only, as the whole pipeline treats its input).
 *
 * After the layout every person of the shown families is a ghost and every
 * line is flagged (flagViewLayer): `ghost` for the lines inside a shown
 * family, `virtual` for the line(s) that exist only because of a link.
 */

import { Person, PersonId, PartnershipId, Partnership, StromData, oppositeGender } from '../../types.js';
import { isPurePlaceholder } from '../../single-parent.js';
import { ViewLink, ViewLinkContext, viewLinkContext, viewLinkIsland } from '../../view-links.js';
import { LayoutModel, LayoutResult, LayoutViewLayer } from './types.js';

/** A derived copy of the data with the view links applied, and what the flags need. */
export interface ViewLayer {
    /** The data the layout sees (the tree's data are untouched). */
    data: StromData;
    /** The links applied, in order (one skipped when its family is shown already or its people are gone). */
    links: ViewLink[];
    /** Each person of a shown family (and each "?" stand-in a link made) → its link. */
    ghostOf: Map<PersonId, ViewLink>;
    /** The anchor of each applied `child` link → its link. */
    childAnchors: Map<PersonId, ViewLink>;
    /** The couples of the tree's data ("a|b", ids sorted): a partner line between others exists only in the view. */
    realCouples: Set<string>;
}

const coupleKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The data with the drawn view links applied (null: nothing to apply). `links`
 * are the links the view draws (activeViewLinks); one family is shown in one
 * place — a later link showing a family an earlier one shows is skipped.
 */
export function buildViewLayer(data: StromData, links: readonly ViewLink[] | undefined, ctx?: ViewLinkContext): ViewLayer | null {
    if (!links || links.length === 0) return null;
    const context = ctx ?? viewLinkContext(data);
    const persons: Record<string, Person> = { ...data.persons };
    const partnerships: Record<string, Partnership> = { ...data.partnerships };
    const ownP = new Set<string>();
    const ownU = new Set<string>();
    const person = (id: PersonId): Person => {
        if (!ownP.has(id)) {
            const p = persons[id];
            persons[id] = { ...p, parentIds: [...p.parentIds], childIds: [...p.childIds], partnerships: [...p.partnerships] };
            ownP.add(id);
        }
        return persons[id];
    };
    const union = (id: PartnershipId): Partnership => {
        if (!ownU.has(id)) {
            partnerships[id] = { ...partnerships[id], childIds: [...partnerships[id].childIds] };
            ownU.add(id);
        }
        return partnerships[id];
    };
    const freshId = (base: string, taken: Record<string, unknown>): string => {
        let id = base;
        while (taken[id]) id = `${id}_`;
        return id;
    };
    const newUnion = (hypo: string, a: PersonId, b: PersonId, childIds: PersonId[]): PartnershipId => {
        const id = freshId(`vl_u_${hypo}`, partnerships) as PartnershipId;
        partnerships[id] = { id, person1Id: a, person2Id: b, childIds, status: 'married' };
        ownU.add(id);
        person(a).partnerships.push(id);
        person(b).partnerships.push(id);
        return id;
    };
    const without = (list: PersonId[], id: PersonId): PersonId[] => list.filter(x => x !== id);
    const draft = (): StromData => ({ ...data, persons: persons as StromData['persons'], partnerships: partnerships as StromData['partnerships'] });

    const applied: ViewLink[] = [];
    const ghostOf = new Map<PersonId, ViewLink>();
    const childAnchors = new Map<PersonId, ViewLink>();
    const shownGroups = new Set<number>();
    const touchedStandIns = new Set<PersonId>();

    for (const link of links) {
        const anchor = persons[link.anchorId];
        if (!anchor || link.islandIds.length === 0 || link.islandIds.some(id => !persons[id] || id === link.anchorId)) continue;
        const groups = link.islandIds.map(id => context.group.get(id)).filter((g): g is number => g !== undefined);
        const anchorGroup = context.group.get(link.anchorId);
        // One family, one place; a family already joined to the anchor is not shown again.
        if (groups.some(g => shownGroups.has(g) || g === anchorGroup)) continue;

        if (link.kind === 'partners') {
            newUnion(link.hypo, link.anchorId, link.islandIds[0], []);
        } else {
            const shown = link.islandIds;
            const a = person(link.anchorId);
            const realParents = a.parentIds.filter(id => persons[id] && !persons[id].isPlaceholder && !shown.includes(id));
            const standIns = a.parentIds.filter(id => persons[id]?.isPlaceholder);
            if (realParents.length + shown.length > 2) continue;
            if (shown.length === 1 && realParents.length === 1) {
                // A real parent and a shown one: the shown parent takes the "?" place.
                const real = realParents[0];
                const p = shown[0];
                const family = Object.values(partnerships).find(u => u.childIds.includes(link.anchorId)
                    && (u.person1Id === real || u.person2Id === real));
                const other = family ? (family.person1Id === real ? family.person2Id : family.person1Id) : undefined;
                if (family && other && standIns.includes(other)) {
                    touchedStandIns.add(other);
                    const stand = person(other);
                    if (family.childIds.length === 1) {
                        const u = union(family.id);
                        if (u.person1Id === other) u.person1Id = p;
                        else u.person2Id = p;
                        person(p).partnerships.push(u.id);
                        stand.partnerships = stand.partnerships.filter(x => x !== u.id);
                    } else {
                        const u = union(family.id);
                        u.childIds = without(u.childIds, link.anchorId);
                        newUnion(link.hypo, real, p, [link.anchorId]);
                    }
                    stand.childIds = without(stand.childIds, link.anchorId);
                    a.parentIds = a.parentIds.map(x => (x === other ? p : x));
                } else {
                    if (family) union(family.id).childIds = without(family.childIds, link.anchorId);
                    newUnion(link.hypo, real, p, [link.anchorId]);
                    a.parentIds.push(p);
                }
                person(p).childIds.push(link.anchorId);
            } else {
                if (realParents.length > 0) continue;
                // The shown parents are all the anchor has: it leaves the "?" families.
                for (const s of standIns) {
                    touchedStandIns.add(s);
                    const stand = person(s);
                    for (const uid of stand.partnerships) {
                        if (partnerships[uid]?.childIds.includes(link.anchorId)) union(uid).childIds = without(partnerships[uid].childIds, link.anchorId);
                    }
                    stand.childIds = without(stand.childIds, link.anchorId);
                    a.parentIds = without(a.parentIds, s);
                }
                if (shown.length === 2) {
                    const [p1, p2] = shown;
                    const couple = Object.values(partnerships).find(u =>
                        (u.person1Id === p1 && u.person2Id === p2) || (u.person1Id === p2 && u.person2Id === p1));
                    if (couple) union(couple.id).childIds.push(link.anchorId);
                    else newUnion(link.hypo, p1, p2, [link.anchorId]);
                } else {
                    const p = shown[0];
                    const standId = freshId(`vl_p_${link.hypo}`, persons) as PersonId;
                    persons[standId] = {
                        id: standId, firstName: '?', lastName: '', gender: oppositeGender(persons[p].gender),
                        isPlaceholder: true, partnerships: [], parentIds: [], childIds: [link.anchorId],
                    };
                    ownP.add(standId);
                    newUnion(link.hypo, p, standId, [link.anchorId]);
                    a.parentIds.push(standId);
                    ghostOf.set(standId, link);
                }
                a.parentIds.push(...shown);
                for (const p of shown) person(p).childIds.push(link.anchorId);
            }
            childAnchors.set(link.anchorId, link);
        }

        applied.push(link);
        for (const g of groups) shownGroups.add(g);
        for (const id of viewLinkIsland(data, link, context)) if (!ghostOf.has(id)) ghostOf.set(id, link);
    }
    if (applied.length === 0) return null;

    // A "?" stand-in left with nothing to stand for goes, with its empty families (as tidyPlaceholders).
    for (const s of touchedStandIns) {
        const current = draft();
        if (!isPurePlaceholder(current, s)) continue;
        const stand = person(s);
        for (const uid of [...stand.partnerships]) {
            const u = partnerships[uid];
            if (!u || u.childIds.length > 0) continue;
            delete partnerships[uid];
            const otherId = u.person1Id === s ? u.person2Id : u.person1Id;
            if (persons[otherId]) person(otherId).partnerships = persons[otherId].partnerships.filter(x => x !== uid);
            stand.partnerships = stand.partnerships.filter(x => x !== uid);
        }
        if (stand.partnerships.length === 0 && stand.childIds.length === 0) delete persons[s];
    }

    const realCouples = new Set<string>();
    for (const u of Object.values(data.partnerships)) if (u) realCouples.add(coupleKey(u.person1Id, u.person2Id));
    return { data: draft(), links: applied, ghostOf, childAnchors, realCouples };
}

/**
 * Flag the laid out persons and lines (the result is changed in place):
 * a drop to a link's anchor from a family of its shown parents is `virtual`,
 * a family line whose every drop is virtual is `virtual` as a whole, one of
 * a shown family's own parents `ghost` (its other drops too); a partner line
 * between two people who are no couple in the data is `virtual`, one between
 * two ghosts `ghost`.
 */
export function flagViewLayer(result: LayoutResult, model: LayoutModel, layer: ViewLayer): void {
    const ghost = (id: PersonId | null | undefined): boolean => !!id && layer.ghostOf.has(id);
    for (const conn of result.connections) {
        const u = model.unions.get(conn.unionId);
        if (!u) continue;
        const parents = [u.partnerA, u.partnerB].filter((id): id is PersonId => !!id);
        for (const drop of conn.drops) {
            const link = layer.childAnchors.get(drop.personId);
            if (link && parents.some(p => link.islandIds.includes(p))) drop.view = 'virtual';
        }
        const drawnParents = parents.filter(id => !model.hiddenPersonIds?.has(id) && !(layer.data.persons[id]?.isPlaceholder && ghost(id)));
        if (conn.drops.length > 0 && conn.drops.every(d => d.view === 'virtual')) conn.view = 'virtual';
        else if (drawnParents.length > 0 && drawnParents.every(ghost)) {
            conn.view = 'ghost';
            for (const drop of conn.drops) if (!drop.view) drop.view = 'ghost';
        }
    }
    for (const line of result.spouseLines) {
        if (!layer.realCouples.has(coupleKey(line.person1Id, line.person2Id))) line.view = 'virtual';
        else if (ghost(line.person1Id) && ghost(line.person2Id)) line.view = 'ghost';
    }
    const ghostIds = new Set<PersonId>();
    for (const id of result.positions.keys()) if (ghost(id)) ghostIds.add(id);
    const view: LayoutViewLayer = { links: layer.links, ghostIds, ghostOf: layer.ghostOf, data: layer.data };
    result.viewLayer = view;
}

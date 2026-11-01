/**
 * Links into the app beyond the tree (spec 019 U4, the macOS widget):
 *
 *   …/run/?tree=<slug>&research=<uuid>&person=<id>   a person: the tree opens,
 *       the person is focused, centred and lit, and the person page opens;
 *   …/run/?tree=<slug>&research=<uuid>&show=waiting  "Waiting for you" of the
 *       tree's research (the overview there when the research is followed).
 *
 * `person` is the research's own id of the person ("P0012", which the research
 * writes as the person's REFN and the app keeps as `Person.refn` after every
 * load), or the app's id of the person (`p_…`, for links made in the app).
 * `tree` / `research` pick the tree as before (TreeManager.getTreeFromUrl).
 * Both parameters leave the address once handled, like `research`. An older
 * app ignores them and opens the tree.
 *
 * Pure: the parsing, the person lookup and whether the tree on screen is the
 * one the address names. The UI part is UI.openDeepLink (research-follow-ui).
 */

import type { Person, PersonId } from './types.js';
import { normalizeResearchId, researchPersonRef } from './research-link.js';

/** The address parameters this module reads (and removes after startup). */
export const DEEP_LINK_PARAMS = ['person', 'show'] as const;

export type DeepLink =
    | { kind: 'person'; ref: string }
    | { kind: 'waiting' };

/** An app person id as the app makes them (`p_<time>_<random>`); anything plain enough to look up. */
const APP_PERSON_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * What the address asks for beyond the tree, or null. `person` wins over
 * `show` (the narrower target); an id of another shape is still a person
 * link (it is then not found, and that is said).
 */
export function parseDeepLink(params: URLSearchParams): DeepLink | null {
    const person = params.get('person');
    if (person !== null) {
        const ref = person.trim();
        if (ref) return { kind: 'person', ref };
    }
    const show = params.get('show')?.trim().toLowerCase();
    if (show === 'waiting') return { kind: 'waiting' };
    return null;
}

/**
 * The person a link names in `persons`: the research's id (`refn`) first,
 * then the app's own id. Null when nobody matches.
 */
export function findDeepLinkPerson(persons: Readonly<Record<string, Person>>, ref: string): PersonId | null {
    const research = researchPersonRef(ref);
    if (research) {
        for (const p of Object.values(persons)) {
            if (researchPersonRef(p.refn) === research) return p.id;
        }
        return null;
    }
    if (!APP_PERSON_ID.test(ref)) return null;
    return Object.prototype.hasOwnProperty.call(persons, ref) ? persons[ref].id : null;
}

/**
 * Whether the tree on screen is the one the address names: with `research`,
 * a tree of that research (else a P-id would find a person of another
 * research); with `tree` alone, the tree that slug picked; with neither, the
 * tree that opened. `picked` is what TreeManager.getTreeFromUrl found.
 */
export function deepLinkTreeMatches(
    params: URLSearchParams,
    current: { id: string; researchId?: string | null } | null,
    picked: { id: string } | null,
): boolean {
    if (!current) return false;
    const research = normalizeResearchId(params.get('research'));
    if (research) return (current.researchId ?? '').toLowerCase() === research;
    if (params.has('tree')) return !!picked && picked.id === current.id;
    return true;
}

/** Drop the deep-link parameters from `url`; whether there were any. */
export function stripDeepLinkParams(url: URL): boolean {
    let had = false;
    for (const key of DEEP_LINK_PARAMS) {
        if (url.searchParams.has(key)) {
            url.searchParams.delete(key);
            had = true;
        }
    }
    return had;
}

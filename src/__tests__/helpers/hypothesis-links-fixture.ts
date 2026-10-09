/**
 * The research file with hypothesis variants and their links
 * (e2e/fixtures/research-hypothesis-links.ged), invented data, read into a
 * tree — shared by the tests of the view links (data, layout, drawing).
 *
 * The tree: Karel P0001, son of Václav P0010 and Rozálie P0011; Rozálie's
 * parents Antonín P0012 and Ludmila P0013. Václav has no parents: his edge
 * is `named`, H0022 asks where he came from — A (no link), B (son of the
 * family F0042 of Jakub P0125 and Marie P0126: an island of five with their
 * son Josef P0127 and Jakub's parents Tomáš P0128 and Anna P0129), C (son of
 * Jan P0130, alone: `_PAR`). H0024 (Rozálie: partners with Martin P0140),
 * H0025 (Karel: same / siblings with P0141), H0026 decided for B (Rozálie's
 * real parents), H0027 abandoned (a parent not in the file), H0028 (Antonín:
 * son of the same family F0042 — the island wanted at another place), H0030
 * (Tomáš, inside the island: son of Vojtěch P0150, alone off the tree — a
 * link chained to H0022 B).
 */

import { readFileSync } from 'node:fs';
import { parseGedcom, convertToStrom } from '../../ged-parser.js';
import type { PersonId, StromData } from '../../types.js';

export const HYPOTHESIS_LINKS_GED = readFileSync(new URL('../../../e2e/fixtures/research-hypothesis-links.ged', import.meta.url), 'utf8');

/**
 * The same file with what variants claim that the tree records already
 * (e2e/fixtures/research-hypothesis-intree.ged): H0022 A and B say Václav and
 * Rozálie are a couple (F0001, 3 _INTREE partners; B beside its link), H0025
 * B says Karel is their son (3 _INTREE child, beside its siblings link).
 */
export const HYPOTHESIS_INTREE_GED = readFileSync(new URL('../../../e2e/fixtures/research-hypothesis-intree.ged', import.meta.url), 'utf8');

/** The tree read from the fixture (or from `text`, a changed copy of it) and its people by the research's numbers. */
export function loadHypothesisLinksTree(text: string = HYPOTHESIS_LINKS_GED): { data: StromData; id: (refn: string) => PersonId } {
    const data = convertToStrom(parseGedcom(text)).data;
    const id = (refn: string): PersonId => {
        const found = Object.values(data.persons).find(p => p.refn === refn);
        if (!found) throw new Error(`No person ${refn} in the fixture`);
        return found.id;
    };
    return { data, id };
}

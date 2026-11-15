/**
 * The bundled sample tree (demo-tree.ts) as a tree of the app: it is for
 * trying the app out, never sent to a research nor tied to one. A sample
 * made since 3.29 says so in its metadata (TreeMetadata.demo); an older one
 * is known by its content — its people's ids (`demo_…`, the emigrant Johan
 * among them) and no research number on anyone.
 */

import { StromData } from './types.js';
import { researchRefsOf } from './research-foreign-send.js';

/** The prefix of every id in the sample tree (demo-tree.ts DemoFamily). */
export const DEMO_ID_PREFIX = 'demo_';
/** The person the sample opens on (demo-tree.ts DEMO_FOCUS). */
const DEMO_FOCUS_ID = `${DEMO_ID_PREFIX}johan`;

/**
 * Whether `data` is the sample tree (an older one without the mark): its
 * emigrant Johan is there, most of its people still have the sample's ids,
 * and nobody carries a research's number.
 */
export function looksLikeSampleTree(data: Pick<StromData, 'persons'> | null | undefined): boolean {
    const persons = Object.entries(data?.persons ?? {}).filter(([, p]) => p && !p.isPlaceholder);
    if (!persons.some(([id]) => id === DEMO_FOCUS_ID)) return false;
    const sample = persons.filter(([id]) => id.startsWith(DEMO_ID_PREFIX)).length;
    return sample * 2 > persons.length && researchRefsOf(data).size === 0;
}

/**
 * The research's work on houses as the queue and "Awaiting action" show it
 * (spec 030 §14): a task of a house says its house ("House history čp. 16,
 * Bělokamen", "Take over research for house čp. 16") and leads to its page; a
 * town's frame says its town. A question of a house is the waiting task of a
 * house's row (`GET /houses` `question`), shown with its house.
 *
 * Pure: the research's list of houses, the tree's house of a key and the
 * towns of the frames met come from the caller. Anything not known keeps the
 * research's own text.
 */

import type { HouseListRow } from './house-bridge.js';
import type { TreeHouse } from './houses.js';
import type { LiveQueueItem } from './research-link.js';
import { strings } from './strings.js';

/** What a queued task of a house shows: its text, the tree's house it leads to, or the town of a frame. */
export interface HouseTaskView {
    text: string;
    /** The tree's house (its id): "House page ›". */
    house?: string;
    /** A town's frame: its name. */
    town?: string;
}

export interface HouseTaskContext {
    rows: readonly HouseListRow[];
    /** The tree's house of a key (or of a number joined into it), or null. */
    treeHouse: (key: string) => TreeHouse | null;
    /** The town of a frame's task (T…), or null. */
    townOfTask: (task: string) => string | null;
}

/** The number of a house as the tree writes it ("čp. 16"), else as the research does. */
function numberOf(key: string, house: TreeHouse | null, row: HouseListRow | undefined): string {
    return house?.text ?? row?.house ?? key.slice(key.indexOf('|') + 1);
}

/**
 * A queued task of a house in words (null: not a task of a house). The house's own task:
 * "House history {n}, {town}", a takeover of an own research "Take over research for house {n}", the house's
 * look the research's own text;
 * a town's frame (a task of a house without a house) "Town skeleton {town} for houses" when its
 * town is known, else the research's text.
 */
export function houseTaskView(q: Pick<LiveQueueItem, 'id' | 'text' | 'taskKind' | 'house'>, ctx: HouseTaskContext): HouseTaskView | null {
    if (q.taskKind !== 'house') return null;
    const I = strings.houses.integration;
    if (!q.house) {
        const town = ctx.townOfTask(q.id) ?? ctx.rows.find(r => r.task === q.id && r.work === 'town')?.place.name ?? null;
        return town ? { text: I.taskSkeleton(town), town } : { text: q.text };
    }
    const row = ctx.rows.find(r => r.key === q.house);
    const house = ctx.treeHouse(q.house);
    const n = numberOf(q.house, house, row);
    const town = house?.ref.town ?? row?.place.name ?? '';
    const takeover = row?.task === q.id && row.work === 'takeover';
    // The house's look (spec 145 T1): the research names it ("Look of the house Lhota 9").
    const look = row?.task === q.id && row.look === true;
    const text = takeover ? I.taskImport(n) : !look && town ? I.taskHouse(n, town) : q.text;
    return { text, ...(house ? { house: house.id } : {}) };
}

/**
 * The house a waiting item is a question of (null: none): the row whose question, or whose
 * waiting task, is that item.
 */
export function houseOfQuestion(id: string, rows: readonly HouseListRow[]): HouseListRow | null {
    return rows.find(r => r.question?.id === id) ?? rows.find(r => r.state === 'waiting' && r.task === id) ?? null;
}

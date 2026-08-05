/**
 * How wide a chain block's card row actually is (getBlockCardExtent).
 *
 * A chain block holds a couple plus the appendage spouses of one of them, and
 * its `coupleWidth` is a LAYOUT reservation, not a measurement of the row: it
 * grows a slot when an extra partner has children, and those children stand a
 * generation BELOW and take no width beside the cards. The row is not centred
 * on xCenter either — xCenter stays on the primary couple while appendages
 * hang off one side.
 *
 * Reading the extent off coupleWidth therefore reported cards that were not
 * there. A pass resolving overlaps between neighbours in a row saw a collision
 * against empty space and pushed the whole chain sideways to clear it, which
 * carried a deep ancestor's second wife a full card across the side of the
 * couple her descendant's branch belongs to.
 */

import { describe, it, expect } from 'vitest';
import { getBlockCardExtent } from '../pipeline/index.js';
import { FamilyBlock, FamilyBlockId, UnionId, LayoutModel } from '../pipeline/types.js';
import { DEFAULT_LAYOUT_CONFIG, PersonId, toPersonId } from '../../types.js';

const config = DEFAULT_LAYOUT_CONFIG;
const CARD = config.cardWidth;
const GAP = config.partnerGap;

/** A model with a single two-partner union, enough for the non-chain paths. */
function modelWithCouple(unionId: string, a: string, b: string | null): LayoutModel {
    return {
        persons: new Map(),
        unions: new Map([[unionId as UnionId, {
            id: unionId as UnionId,
            partnerA: toPersonId(a),
            partnerB: b ? toPersonId(b) : null,
            partnershipId: null,
            childIds: [],
        }]]),
        edges: [],
        personToUnion: new Map(),
        childToParentUnion: new Map(),
        partnerChains: new Map(),
    } as unknown as LayoutModel;
}

function block(over: Partial<FamilyBlock>): FamilyBlock {
    return {
        id: 'b1' as FamilyBlockId,
        rootUnionId: 'u1' as UnionId,
        childBlockIds: [], parentBlockId: null, side: 'HUSBAND', generation: -4,
        branchId: null,
        width: 0, coupleWidth: 0, childrenWidth: 0,
        envelopeWidth: 0, leftExtent: 0, rightExtent: 0,
        xLeft: 0, xRight: 0, xCenter: 0,
        husbandAnchorX: 0, wifeAnchorX: 0, childrenCenterX: 0, coupleCenterX: 0,
        ...over,
    } as FamilyBlock;
}

function chainInfo(positions: Array<[string, number]>): FamilyBlock['chainInfo'] {
    return {
        chainPersonId: toPersonId(positions[0]?.[0] ?? 'nobody'),
        unionIds: [],
        personOrder: positions.map(([id]) => toPersonId(id)),
        personPositions: new Map(positions.map(([id, x]) => [toPersonId(id), x] as [PersonId, number])),
        personSlotCenters: new Map(),
        unionChildBlockIds: new Map(),
        personsWithChildren: new Set(),
        personSlotWidths: new Map(),
    } as unknown as FamilyBlock['chainInfo'];
}

describe('getBlockCardExtent', () => {
    it('measures a chain by its cards, not by its reserved width', () => {
        // Three cards in a row: an appendage second wife, the shared husband,
        // his first wife. xCenter sits on the primary couple (husband+first
        // wife), and coupleWidth carries an extra slot for the second wife's
        // children — who hang below and are not in this row at all.
        const positions: Array<[string, number]> = [
            ['second_wife', -206], ['husband', 0], ['first_wife', 206],
        ];
        const b = block({
            xCenter: 103,                        // midpoint of husband + first wife
            coupleWidth: 3 * CARD + 2 * GAP + 206, // row + one grown slot
            chainInfo: chainInfo(positions),
        });

        const ext = getBlockCardExtent(b, modelWithCouple('u1', 'husband', 'first_wife'), config);

        expect(ext.left).toBe(-206 - CARD / 2);
        expect(ext.right).toBe(206 + CARD / 2);
        // The reserved slot is NOT reported as card width standing beside them.
        expect(ext.right).toBeLessThan(b.xCenter + b.coupleWidth / 2);
        // And the row is measured where it is, not centred on xCenter.
        expect(ext.left).toBeLessThan(b.xCenter - b.coupleWidth / 2 + 1);
    });

    it('falls back to the reserved width when a chain has no card positions yet', () => {
        const b = block({ xCenter: 50, coupleWidth: 600, chainInfo: chainInfo([]) });
        const ext = getBlockCardExtent(b, modelWithCouple('u1', 'a', 'b'), config);
        expect(ext).toEqual({ left: -250, right: 350 });
    });

    it('is unchanged for a plain couple and for a single parent', () => {
        const couple = block({ xCenter: 100 });
        expect(getBlockCardExtent(couple, modelWithCouple('u1', 'a', 'b'), config))
            .toEqual({ left: 100 - GAP / 2 - CARD, right: 100 + GAP / 2 + CARD });

        const single = block({ xCenter: 100 });
        expect(getBlockCardExtent(single, modelWithCouple('u1', 'a', null), config))
            .toEqual({ left: 100 - CARD / 2, right: 100 + CARD / 2 });
    });
});

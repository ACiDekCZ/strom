import { describe, it } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { buildLayoutModel } from '../pipeline/2-build-model.js';
import { assignGenerations } from '../pipeline/3-assign-generations.js';
import { measureSubtrees } from '../pipeline/4-measure.js';
import { placeX } from '../pipeline/5-place-x.js';
import { PersonId, PartnershipId, DEFAULT_LAYOUT_CONFIG } from '../../types.js';
import { GraphSelection, FamilyBlockModel } from '../pipeline/types.js';

describe('debug positions', () => {
    it('prints positions', () => {
        const data = loadFixture('t6_constraints_overlap');
        const ALL_PERSON_IDS = ['p1','p2','c1','c1p','c2','c2p','gc1','gc2','gc3','gc4','gc5'] as PersonId[];
        const ALL_PARTNERSHIP_IDS = ['part_parents','part_c1','part_c2'] as PartnershipId[];

        const selection: GraphSelection = {
            persons: new Set(ALL_PERSON_IDS),
            partnerships: new Set(ALL_PARTNERSHIP_IDS),
            focusPersonId: 'c1' as PersonId,
            maxAncestorGen: 1,
            maxDescendantGen: 1
        };

        const config = DEFAULT_LAYOUT_CONFIG;
        const model = buildLayoutModel({ data, selection, focusPersonId: 'c1' as PersonId });
        const genModel = assignGenerations({ model, focusPersonId: 'c1' as PersonId });
        const measured = measureSubtrees({ genModel, config });

        const fbm = measured as FamilyBlockModel;
        console.log('\n=== BLOCKS ===');
        for (const [id, block] of fbm.blocks) {
            const kids = block.childBlockIds.join(',');
            console.log('Block ' + id + ': side=' + block.side + ' gen=' + block.generation + ' width=' + block.width + ' envelope=' + block.envelopeWidth + ' couple=' + block.coupleWidth + ' children=[' + kids + ']');
        }
        console.log('\n=== UNION TO BLOCK ===');
        for (const [uid, bid] of fbm.unionToBlock) {
            const u = model.unions.get(uid);
            const pB = u?.partnerB || 'single';
            console.log('Union ' + uid + ' (' + u?.partnerA + '+' + pB + ') -> Block ' + bid);
        }

        const placed = placeX({ measured, config });

        console.log('\n=== UNION X ===');
        for (const [uid, x] of placed.unionX) {
            const u = model.unions.get(uid);
            const pB = u?.partnerB || 'single';
            console.log('Union ' + uid + ' (' + u?.partnerA + '+' + pB + '): x=' + x.toFixed(1));
        }
        console.log('\n=== PERSON X ===');
        for (const pid of ALL_PERSON_IDS) {
            const x = placed.personX.get(pid);
            const gen = genModel.personGen.get(pid);
            console.log('Person ' + pid + ': x=' + (x !== undefined ? x.toFixed(1) : 'undefined') + ' gen=' + gen);
        }
    });
});

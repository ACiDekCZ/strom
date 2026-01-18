import { describe, it } from 'vitest';
import { loadFixture } from './helpers/loadFixture.js';
import { runPipeline } from './helpers/runPipeline.js';
import { PersonId } from '../../types.js';
import { FamilyBlockModel, UnionId } from '../pipeline/types.js';

describe('diag ancestors', () => {
    it('traces gen -5 ancestor placement', () => {
        const data = loadFixture('comprehensive');
        const result = runPipeline(data, 'focus' as PersonId, {
            ancestorDepth: 5,
            descendantDepth: 5
        });
        const { constrained } = result;
        const { placed } = constrained;
        const { measured, unionX } = placed;
        const { genModel } = measured;
        const { model, unionGen } = genModel;

        const fbm = measured as FamilyBlockModel;
        const blocks = fbm.blocks;

        // Find ancestor unions at various generations
        const ancestorUnions: UnionId[] = [];
        for (const [uid, gen] of unionGen) {
            if (gen < 0) {
                ancestorUnions.push(uid);
            }
        }

        // Log first few ancestor unions for diagnostic purposes
        for (const uid of ancestorUnions.slice(0, 5)) {
            const gen = unionGen.get(uid);
            const ux = unionX.get(uid);
            console.log('\nUnion ' + uid + ': gen=' + gen + ', centerX=' + (ux !== undefined ? ux.toFixed(1) : 'N/A'));

            // Find block
            const blockId = fbm.unionToBlock.get(uid);
            if (blockId) {
                const block = blocks.get(blockId);
                if (block) {
                    console.log('  Block: id=' + block.id + ', side=' + block.side + ', gen=' + block.generation);
                    console.log('  Position: xCenter=' + block.xCenter.toFixed(1) + ', xLeft=' + block.xLeft.toFixed(1) + ', xRight=' + block.xRight.toFixed(1));
                    console.log('  Width: width=' + block.width.toFixed(1) + ', envelope=' + block.envelopeWidth.toFixed(1) + ', couple=' + block.coupleWidth.toFixed(1));
                    console.log('  childBlockIds: [' + block.childBlockIds.join(', ') + ']');
                    console.log('  parentBlockId: ' + block.parentBlockId);

                    // Show children positions
                    for (const childId of block.childBlockIds) {
                        const childBlock = blocks.get(childId);
                        if (childBlock) {
                            const cu = model.unions.get(childBlock.rootUnionId);
                            const pA = cu ? model.persons.get(cu.partnerA) : null;
                            const pB = (cu && cu.partnerB) ? model.persons.get(cu.partnerB) : null;
                            const pAName = pA ? (pA.firstName + ' ' + pA.lastName) : '?';
                            const pBName = pB ? (pB.firstName + ' ' + pB.lastName) : 'single';
                            console.log('    Child ' + childId + ': rootUnion=' + childBlock.rootUnionId + ' (' + pAName + ' + ' + pBName + '), xCenter=' + childBlock.xCenter.toFixed(1) + ', parentBlockId=' + childBlock.parentBlockId);
                        }
                    }

                    // Now check what centerBlockOverChildren would find:
                    const union = model.unions.get(block.rootUnionId);
                    if (union) {
                        console.log('  Union childIds: [' + union.childIds.join(', ') + ']');
                        for (const childPersonId of union.childIds) {
                            const childUnionId = model.personToUnion.get(childPersonId);
                            const childBlockIdViaModel = childUnionId ? fbm.unionToBlock.get(childUnionId) : null;
                            const childBlockViaModel = childBlockIdViaModel ? blocks.get(childBlockIdViaModel) : null;
                            const person = model.persons.get(childPersonId);
                            const pName = person ? (person.firstName + ' ' + person.lastName) : '?';
                            const xStr = childBlockViaModel ? childBlockViaModel.xCenter.toFixed(1) : 'N/A';
                            const parentStr = childBlockViaModel ? String(childBlockViaModel.parentBlockId) : 'N/A';
                            const isInChildren = childBlockIdViaModel ? block.childBlockIds.includes(childBlockIdViaModel) : false;
                            console.log('    Person ' + childPersonId + ' (' + pName + '): unionId=' + childUnionId + ', blockId=' + childBlockIdViaModel + ', xCenter=' + xStr + ', parentBlockId=' + parentStr + ', IS_IN_childBlockIds=' + isInChildren);
                        }
                    }
                }
            }
        }
    });
});

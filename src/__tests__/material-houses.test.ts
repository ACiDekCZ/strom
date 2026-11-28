/**
 * The houses a file is material of (`material.houses`, research 1.38, 1128): `houses [{id, key}]` on a file of
 * `GET /material` read once per key (a valid A… kept), absent without houses; the caps only with the feature.
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { materialCaps, materialHousesOf, parseMaterialFile, type MaterialEnv } from '../materials.js';

const sha = (n: number) => n.toString(16).padStart(64, '0');

describe('a file\'s houses', () => {
    it('each key once, its A… when valid; anything else left out', () => {
        expect(materialHousesOf([
            { id: 'A0001', key: 'belokamen|16' },
            { id: 'A0001', key: 'belokamen|16' },
            { key: 'lhota|9', id: 'x' },
            { key: 'no-bar' }, { key: '|16' }, { key: 'a|b|c' }, { id: 'A0003' }, null, 'belokamen|16',
        ])).toEqual([{ id: 'A0001', key: 'belokamen|16' }, { key: 'lhota|9' }]);
        expect(materialHousesOf([])).toBeUndefined();
        expect(materialHousesOf(undefined)).toBeUndefined();
        expect(materialHousesOf([{ key: 'nope' }])).toBeUndefined();
    });

    it('on the file of /material; a file without houses has none', () => {
        const withHouses = parseMaterialFile({ id: 'I0001', sha: sha(1), name: 'krest.jpg', houses: [{ id: 'A0001', key: 'belokamen|16' }] })!;
        expect(withHouses.houses).toEqual([{ id: 'A0001', key: 'belokamen|16' }]);
        const without = parseMaterialFile({ id: 'I0002', sha: sha(2), name: 'dopis.jpg' })!;
        expect(without.houses).toBeUndefined();
    });

    it('drawn only with material.houses (an older research: as before)', () => {
        const env = { linked: true, onComputer: true, bridgeUp: true, features: ['material.list', 'material.houses'] } as MaterialEnv;
        expect(materialCaps(env).houses).toBe(true);
        expect(materialCaps({ ...env, features: ['material.list'] }).houses).toBeUndefined();
        expect(materialCaps({ ...env, features: ['material.houses'] }).houses).toBeUndefined();
    });
});

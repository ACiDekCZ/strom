/**
 * GEDCOM place coordinates (PLAC > MAP > LATI/LONG) and the surname-variant
 * header NOTE — both directions. Fixtures are inline; no real family data.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom, SURNAME_GROUPS_MARKER } from '../ged-exporter.js';
import { placeKey } from '../places.js';
import { StromData, PersonId, PlaceGeo } from '../types.js';

function importGed(ged: string): StromData {
    return convertToStrom(parseGedcom(ged)).data;
}

/** A one-person tree with a birthplace and its coordinates. */
function treeWith(place: string, geo: PlaceGeo, surnameVariants?: string[][]): StromData {
    return {
        persons: {
            ['p1' as PersonId]: {
                id: 'p1' as PersonId,
                firstName: 'Jan', lastName: 'Novák', gender: 'male',
                isPlaceholder: false, parentIds: [], childIds: [],
                birthPlace: place, partnerships: [],
            },
        },
        partnerships: {},
        places: { [placeKey(place)]: geo },
        ...(surnameVariants ? { surnameVariants } : {}),
    };
}

describe('GEDCOM place coordinates', () => {
    it('exports PLAC > MAP > LATI/LONG with N/E hemispheres', () => {
        const ged = exportToGedcom(treeWith('Praha', { lat: 50.088, lon: 14.421, label: 'Praha' })).content;
        expect(ged).toContain('2 PLAC Praha');
        expect(ged).toContain('3 MAP');
        expect(ged).toContain('4 LATI N50.088');
        expect(ged).toContain('4 LONG E14.421');
    });

    it('exports southern/western coordinates with S/W hemispheres', () => {
        const ged = exportToGedcom(treeWith('Ushuaia', { lat: -54.8019, lon: -68.303, label: 'Ushuaia' })).content;
        expect(ged).toContain('4 LATI S54.8019');
        expect(ged).toContain('4 LONG W68.303');
    });

    it('round-trips coordinates back into data.places', () => {
        const out = importGed(exportToGedcom(treeWith('Praha', { lat: 50.088, lon: 14.421, label: 'Praha' })).content);
        const geo = out.places?.[placeKey('Praha')];
        expect(geo).toBeDefined();
        expect(geo!.lat).toBeCloseTo(50.088, 5);
        expect(geo!.lon).toBeCloseTo(14.421, 5);
    });

    it('round-trips negative coordinates', () => {
        const out = importGed(exportToGedcom(treeWith('Ushuaia', { lat: -54.8019, lon: -68.303, label: 'Ushuaia' })).content);
        const geo = out.places?.[placeKey('Ushuaia')];
        expect(geo!.lat).toBeCloseTo(-54.8019, 4);
        expect(geo!.lon).toBeCloseTo(-68.303, 4);
    });

    it('imports MAP coordinates from a hand-written GEDCOM', () => {
        const ged = [
            '0 HEAD', '1 SOUR X', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Jan /Novák/', '1 SEX M',
            '1 BIRT', '2 PLAC Wien', '3 MAP', '4 LATI N48.2082', '4 LONG E16.3738',
            '0 TRLR',
        ].join('\n');
        const out = importGed(ged);
        const geo = out.places?.[placeKey('Wien')];
        expect(geo).toBeDefined();
        expect(geo!.lat).toBeCloseTo(48.2082, 4);
        expect(geo!.lon).toBeCloseTo(16.3738, 4);
    });

    it('drops a MAP that carries only a latitude (needs both)', () => {
        const ged = [
            '0 HEAD', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME A /B/', '1 SEX M',
            '1 BIRT', '2 PLAC Half', '3 MAP', '4 LATI N10.0',
            '0 TRLR',
        ].join('\n');
        const out = importGed(ged);
        expect(out.places?.[placeKey('Half')]).toBeUndefined();
    });

    it('a place with no coordinates emits no MAP', () => {
        const data: StromData = {
            persons: { ['p1' as PersonId]: { id: 'p1' as PersonId, firstName: 'A', lastName: 'B', gender: 'male', isPlaceholder: false, parentIds: [], childIds: [], birthPlace: 'Nowhere', partnerships: [] } },
            partnerships: {},
        };
        const ged = exportToGedcom(data).content;
        expect(ged).toContain('2 PLAC Nowhere');
        expect(ged).not.toContain('3 MAP');
    });
});

describe('GEDCOM surname-variant groups', () => {
    const groups = [['Víšek', 'Vyšek', 'Wischek'], ['Novák', 'Nowak']];

    it('exports groups as a header NOTE marker', () => {
        const ged = exportToGedcom(treeWith('Praha', { lat: 50, lon: 14 }, groups)).content;
        expect(ged).toContain(`1 NOTE ${SURNAME_GROUPS_MARKER}`);
        expect(ged).toContain('2 CONT Víšek | Vyšek | Wischek');
        expect(ged).toContain('2 CONT Novák | Nowak');
    });

    it('round-trips groups back into surnameVariants', () => {
        const out = importGed(exportToGedcom(treeWith('Praha', { lat: 50, lon: 14 }, groups)).content);
        expect(out.surnameVariants).toEqual(groups);
    });

    it('emits no surname NOTE when there are none', () => {
        const ged = exportToGedcom(treeWith('Praha', { lat: 50, lon: 14 })).content;
        expect(ged).not.toContain(SURNAME_GROUPS_MARKER);
    });
});

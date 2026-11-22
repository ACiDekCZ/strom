/**
 * An image the research found from the scans it keeps of an entry (GEDCOM
 * `2 _STROM_DERIVED Y` under `1 _STROM_IMAGE`, Source.imageDerived): the
 * location may name another image on purpose (an index's page), so composing
 * the PAGE cuts nothing of it and only adds "snímek N" when the location does
 * not say the image (a range when it names each of its numbers). Without the
 * mark the PAGE is composed as before.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { composePage, sourcePlaceKey } from '../source-location.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { setLanguage } from '../strings.js';
import { type Source, type StromData, type TreeId } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

beforeAll(() => setLanguage('cs'));

const INDEX = 'č. 12; rejstřík obr. 70 Lit. C';
const TWO_FOLIOS = 'fol. 55 (obr. 54 vpravo dole) – fol. 56 (obr. 55 nahoře)';

describe('composePage: an image found from the scans cuts nothing', () => {
    it('another image the location names (an index\'s page) stays; the image is added', () => {
        expect(composePage({ reference: INDEX, image: '35', imageDerived: true })).toBe(`${INDEX}, snímek 35`);
        // without the mark: as before, the other image gives way to the field
        expect(composePage({ reference: INDEX, image: '35' })).toBe('č. 12; rejstřík, Lit. C, snímek 35');
    });

    it('a range named number by number is said: nothing added, nothing cut', () => {
        expect(composePage({ reference: TWO_FOLIOS, image: '54–55', imageDerived: true })).toBe(TWO_FOLIOS);
        expect(composePage({ reference: TWO_FOLIOS, image: '54-55', imageDerived: true })).toBe(TWO_FOLIOS);
        // without the mark: the first image cut, the range added (the old, broken reading)
        expect(composePage({ reference: TWO_FOLIOS, image: '54–55' })).toBe('fol. 55 (, vpravo dole) – fol. 56 (obr. 55 nahoře), snímek 54–55');
    });

    it('a range of which the location names only some numbers is added', () => {
        expect(composePage({ reference: 'fol. 55 (obr. 54 vpravo dole)', image: '54–55', imageDerived: true }))
            .toBe('fol. 55 (obr. 54 vpravo dole), snímek 54–55');
    });

    it('the same image the location names is said once', () => {
        expect(composePage({ reference: 'č. 5, snímek 34', image: '34', imageDerived: true })).toBe('č. 5, snímek 34');
        expect(composePage({ reference: 'č. 5, scan 34', image: '34', imageDerived: true })).toBe('č. 5, scan 34');
        expect(composePage({ reference: 'č. 5, obr. 33–35', image: '33-35', imageDerived: true })).toBe('č. 5, obr. 33–35');
    });

    it('no location: the image alone; the folio as before', () => {
        expect(composePage({ image: '35', imageDerived: true })).toBe('snímek 35');
        expect(composePage({ folio: 'fol. 49', reference: '3. zápis', image: '51', imageDerived: true })).toBe('fol. 49, 3. zápis, snímek 51');
        // a folio the location names otherwise still gives way to the field (only the image is the research's)
        expect(composePage({ folio: 'fol. 50', reference: 'fol. 49, obr. 70', image: '51', imageDerived: true }))
            .toBe('fol. 50, obr. 70, snímek 51');
        expect(sourcePlaceKey({ reference: INDEX, image: '35', imageDerived: true })).toBe(`${INDEX}, snímek 35`);
    });
});

function researchGed(derived: boolean): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.36.0', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Ludmila /Vzorová/', '1 SEX F', '1 BIRT', '2 DATE 3 FEB 1865', '2 SOUR @S1@', `3 PAGE ${INDEX}`,
        '0 @S1@ SOUR', '1 TITL Křty Vzorov', `1 PAGE ${INDEX}`, '1 _STROM_IMAGE 35', ...(derived ? ['2 _STROM_DERIVED Y'] : []),
        `1 _STROM_LOCATOR ${INDEX}`, '1 REFN S0054',
        '0 TRLR',
    ].join('\n');
}

const sourceOf = (d: StromData): Source => Object.values(d.sources ?? {})[0];

describe('GEDCOM: `2 _STROM_DERIVED Y` under `_STROM_IMAGE`', () => {
    it('read as the source\'s mark, counted as nothing dropped; the citation cites the record', () => {
        const r = convertToStrom(parseGedcom(researchGed(true)), {});
        const s = sourceOf(r.data);
        expect(s).toMatchObject({ image: '35', imageDerived: true, reference: INDEX });
        expect(r.stats.droppedTagSummary ?? '').not.toMatch(/_STROM_/);
        expect(Object.keys(r.data.sources ?? {})).toHaveLength(1);
        expect(composePage(s)).toBe(`${INDEX}, snímek 35`);
    });

    it('without the mark (an older research, an image of its own): no mark, the PAGE as before', () => {
        const s = sourceOf(convertToStrom(parseGedcom(researchGed(false)), {}).data);
        expect(s.imageDerived).toBeUndefined();
        expect(composePage(s)).toBe('č. 12; rejstřík, Lit. C, snímek 35');
    });

    it('written back under the image, the composed PAGE keeping the location whole; read again the same', () => {
        const data = convertToStrom(parseGedcom(researchGed(true)), {}).data;
        data.version = STROM_DATA_VERSION;
        const ged = exportToGedcom(data).content;
        const rec = ged.split(/\r?\n(?=0 )/).find(r => r.includes('1 TITL Křty Vzorov'))!.split(/\r?\n/);
        const at = rec.indexOf('1 _STROM_IMAGE 35');
        expect(at).toBeGreaterThan(0);
        expect(rec[at + 1]).toBe('2 _STROM_DERIVED Y');
        expect(ged).toContain(`PAGE ${INDEX}, snímek 35`);
        const again = sourceOf(convertToStrom(parseGedcom(ged), {}).data);
        expect(again).toMatchObject({ image: '35', imageDerived: true, reference: INDEX });
        // an image of one's own has no mark
        delete sourceOf(data).imageDerived;
        expect(exportToGedcom(data).content).not.toContain('_STROM_DERIVED');
    });
});

describe('the image changed by hand is no longer the research\'s', () => {
    const TREE = 'derived-image-tree' as TreeId;
    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        vi.spyOn(DataManager, 'isTreeLocked').mockReturnValue(false);
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = { persons: {}, partnerships: {} } as unknown as StromData;
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('an edit keeping the image keeps the mark; another image (or none) drops it', () => {
        const src = DataManager.addSource({ title: 'Křty Vzorov', image: '35', imageDerived: true, reference: INDEX })!;
        DataManager.updateSource(src.id, { title: 'Křty Vzorov 1860', image: '35', reference: INDEX });
        expect(DataManager.getData().sources?.[src.id].imageDerived).toBe(true);
        DataManager.updateSource(src.id, { image: '36' });
        expect(DataManager.getData().sources?.[src.id]).not.toHaveProperty('imageDerived');
        const other = DataManager.addSource({ title: 'Oddaní Vzorov', image: '12', imageDerived: true })!;
        DataManager.updateSource(other.id, { image: undefined });
        expect(DataManager.getData().sources?.[other.id]).not.toHaveProperty('imageDerived');
    });
});

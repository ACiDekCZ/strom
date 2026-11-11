/**
 * The reliability of a fact is that of its citation (spec 077 K1.4, K1.6,
 * K1.7): the status tip and the person's sources say the citation's QUAY, a
 * tree of 3.26 joined on load gives the research nothing to send and keeps
 * one census with its image, the source form changes the default only, and a
 * merge of the same file again keeps one source. Invented data.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseGedcom, convertToStrom, GedcomImportOrigin } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData, DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { StorageManager } from '../storage.js';
import { UndoManager } from '../undo.js';
import { strings } from '../strings.js';
import { citationQuality, joinQualityOnlySources, setCitationQuality } from '../citation-quality.js';
import { factReliability } from '../reliability.js';
import { factSourcesModel } from '../ui/status-tip.js';
import { personSourceRows, rowQuality } from '../person-sources.js';
import { diffByPerson, diffOther, diffValues, otherRowCount } from '../research-changes.js';
import { shownExcerpts } from '../research-images.js';
import { createMergeState } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { LifeEvent, Person, Source, StromData, TreeId } from '../types.js';

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));
/** A JPEG header (SOI + APP0 + SOF0) claiming 1200×240. */
const JPEG = 'data:image/jpeg;base64,' + b64([0xFF, 0xD8,
    0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xFF, 0xC0, 0, 17, 8, 0, 240, 1200 >> 8, 1200 & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xFF, 0xD9]);

const CENSUS = 'Census Bludovec 1857';

/** The reported pattern: a census entry with one image, the occupation read first hand (QUAY 3), the birth from the age (QUAY 2). */
function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.30.1', '2 NAME Strom Research', '1 DATE 11 NOV 2026', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Drahoslav /Zlatoňák/', '1 SEX M', '1 REFN P0001',
        '1 BIRT', '2 DATE 1821', '2 SOUR @S0001@', '3 PAGE fol. 7', '3 QUAY 2',
        '1 OCCU chalupník', '2 SOUR @S0001@', '3 PAGE fol. 7', '3 QUAY 3',
        '0 @S0001@ SOUR', '1 TITL Census Bludovec 1857', '1 REFN S0001', '1 PUBL Bludovec archive',
        '1 OBJE', '2 FORM jpg', '2 TITL fol. 7', '2 _STROM_KIND excerpt',
        `2 FILE ${JPEG.slice(0, 40)}`, `3 CONC ${JPEG.slice(40)}`,
        '0 TRLR',
    ].join('\n');
}

/** The same as another program writes it (no Strom tags, no REFN). */
function otherProgramGed(): string {
    return [
        '0 HEAD', '1 SOUR FAMILYPROG', '2 NAME Family Program', '2 VERS 7.0', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Drahoslav /Zlatoňák/', '1 SEX M',
        '1 BIRT', '2 DATE 1821', '2 SOUR @S1@', '3 PAGE fol. 7', '3 QUAY 2',
        '1 OCCU chalupník', '2 SOUR @S1@', '3 PAGE fol. 7', '3 QUAY 3',
        '1 DEAT', '2 DATE 1880', '2 SOUR @S1@', '3 PAGE fol. 7',
        '0 @S1@ SOUR', '1 TITL Census Bludovec 1857', '1 PUBL Bludovec archive',
        '0 TRLR',
    ].join('\n');
}

const read = (ged: string, origin?: GedcomImportOrigin): StromData =>
    migrateData(convertToStrom(parseGedcom(ged), origin ? { importOrigin: origin } : {}).data);
const ORIGIN = (at: string): GedcomImportOrigin => ({ at, file: 'family.ged', encoding: 'utf-8' });
const censusOf = (d: StromData): Source[] => Object.values(d.sources ?? {}).filter(s => s.title === CENSUS);
const drahoslav = (d: StromData): Person => Object.values(d.persons).find(p => p.firstName === 'Drahoslav')!;
const occupation = (p: Person): LifeEvent => p.events!.find(e => e.type === 'occupation')!;

/**
 * What 3.26 stored of the research's version: the citation whose QUAY is not
 * the entry's on a source of its own `<id>~1`, made of the entry without its
 * image (version 18). `research` is that version itself, the same ids.
 */
function storedBy326(): { research: StromData; tree: StromData; census: Source; derived: Source } {
    const research = read(researchGed());
    const tree = structuredClone(research);
    const [census] = censusOf(tree);
    const p = drahoslav(tree);
    const occu = occupation(p);
    const derived: Source = {
        id: `${census.id}~1`, title: census.title, reference: census.reference,
        ...(census.repository ? { repository: census.repository } : {}),
        ...(census.note ? { note: census.note } : {}),
    };
    // The citation with a QUAY of its own went to the derived source, which had that QUAY.
    if (p.citationQuay?.birthSourceIds) {
        derived.quality = citationQuality(p, 'birthSourceIds', census.id, tree.sources);
        p.birthSourceIds = [derived.id];
        delete p.citationQuay;
    } else {
        derived.quality = citationQuality(occu, 'sourceIds', census.id, tree.sources);
        occu.sourceIds = [derived.id];
        delete occu.citationQuay;
    }
    tree.sources![derived.id] = derived;
    tree.version = 18;
    return { research, tree, census, derived };
}

describe('the status tip and the person\'s sources say the citation\'s QUAY (K1.4)', () => {
    const OPTS = { researchTree: true, originFeature: true };

    it('the tip of the birth says "copy", that of the occupation "original", of one census', () => {
        const d = read(researchGed());
        const p = drahoslav(d);
        const sub = (fact: string) => factSourcesModel(d, p, fact, factReliability(d, p, fact, OPTS), p.id).rows.map(r => r.sub);
        const [birth] = sub('birth');
        const [occu] = sub(`event:${occupation(p).id}`);
        expect(birth).toContain(strings.sources.quality2);
        expect(birth).not.toContain(strings.sources.quality3);
        expect(occu).toContain(strings.sources.quality3);
        // Whichever the entry's default is, the other citation says its own.
        const [census] = censusOf(d);
        census.quality = census.quality === 3 ? 2 : 3;
        setCitationQuality(p, 'birthSourceIds', census.id, 2, {});
        setCitationQuality(occupation(p), 'sourceIds', census.id, 3, {});
        expect(sub('birth')[0]).toContain(strings.sources.quality2);
        expect(sub(`event:${occupation(p).id}`)[0]).toContain(strings.sources.quality3);
    });

    it('the person\'s sources: one census row, each citation with its own reliability', () => {
        const d = read(researchGed());
        const rows = personSourceRows(d, drahoslav(d).id, strings);
        expect(rows).toHaveLength(1);
        expect(rows[0].cites.map(c => c.quality).sort()).toEqual([2, 3]);
        expect(rowQuality(rows[0])).toBeNull();
        // Citations that agree: the row says it once.
        const same = read(researchGed());
        const p = drahoslav(same);
        const [census] = censusOf(same);
        setCitationQuality(p, 'birthSourceIds', census.id, 3, same.sources);
        setCitationQuality(occupation(p), 'sourceIds', census.id, 3, same.sources);
        expect(rowQuality(personSourceRows(same, p.id, strings)[0])).toBe(3);
    });
});

describe('a tree of 3.26 joined on load: nothing for the research, one census with its image (K1.6)', () => {
    it('the changes since the kept research version and the research\'s version itself: none', () => {
        const { research, tree } = storedBy326();
        // The kept copy of the research's version, stored by 3.26 too (joined on load as the tree).
        const kept = structuredClone(tree);
        joinQualityOnlySources(kept);
        const loaded = migrateData(structuredClone(tree));
        expect(diffByPerson(kept, loaded)).toEqual([]);
        expect(otherRowCount(diffOther(kept, loaded))).toBe(0);
        // The research's version as it is (read anew): nothing would change here, nothing to send.
        expect(diffByPerson(research, loaded)).toEqual([]);
        expect(otherRowCount(diffOther(research, loaded))).toBe(0);
        const values = diffValues(loaded, research);
        expect(values.rows).toEqual([]);
        expect(values.addedFacts).toBe(0);
        // Not joined, the kept copy would name the entry without its image: that is why it is joined too.
        expect(diffByPerson(tree, loaded).flatMap(c => c.kinds)).toContain('citation');
        // And the file written to the research gives every citation its QUAY as the research has it.
        const quays = (data: StromData) => exportToGedcom(data, 'Zlatoňák', { research: { id: 'r-test' } }).content
            .split('\n').filter(l => /^\d QUAY /.test(l));
        expect(quays(loaded)).toEqual(quays(research));
    });

    it('the census without its image is gone: the one left has its image (no "image only in the research")', () => {
        const { tree, derived } = storedBy326();
        // As 3.26 stored it: a census row without an image.
        expect(censusOf(tree).filter(s => shownExcerpts('quay-tree', s).length === 0)).toHaveLength(1);
        const loaded = migrateData(structuredClone(tree));
        expect(loaded.sources?.[derived.id]).toBeUndefined();
        const census = censusOf(loaded);
        expect(census).toHaveLength(1);
        expect(shownExcerpts('quay-tree', census[0])).toHaveLength(1);
        expect(census[0].imageHeld).toBeUndefined();
    });
});

describe('the source form changes the default reliability; a citation of its own keeps it (K1.7)', () => {
    const TREE = 'quay-form-tree' as TreeId;
    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        vi.spyOn(DataManager, 'isTreeLocked').mockReturnValue(false);
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = read(researchGed());
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('citations without their own follow the default, those with their own stay', () => {
        const d = DataManager.getData();
        const p = drahoslav(d);
        const [census] = censusOf(d);
        // The entry's default 3; the birth's own 2; a death citation that gave no QUAY.
        DataManager.updateSource(census.id, { quality: 3 });
        setCitationQuality(p, 'birthSourceIds', census.id, 2, d.sources);
        delete occupation(p).citationQuay;
        p.deathSourceIds = [census.id];
        setCitationQuality(p, 'deathSourceIds', census.id, undefined, d.sources);
        const now = () => {
            const data = DataManager.getData();
            const q = drahoslav(data);
            return [citationQuality(q, 'birthSourceIds', census.id, data.sources),
                citationQuality(occupation(q), 'sourceIds', census.id, data.sources),
                citationQuality(q, 'deathSourceIds', census.id, data.sources)];
        };
        expect(now()).toEqual([2, 3, undefined]);
        // As the form saves it ("Reliability of the source": copy / index).
        DataManager.updateSource(census.id, { quality: 2 });
        expect(now()).toEqual([2, 2, undefined]);
        // The birth's own 2 is the default now; it stays the birth's when the default moves on.
        DataManager.updateSource(census.id, { quality: 1 });
        expect(now()).toEqual([2, 1, undefined]);
        DataManager.updateSource(census.id, { quality: undefined });
        expect(now()).toEqual([2, undefined, undefined]);
        DataManager.undo();
        DataManager.undo();
        expect(now()).toEqual([2, 2, undefined]);
    });
});

describe('a merge keeps one source and every citation\'s QUAY', () => {
    beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });
    afterEach(() => { vi.restoreAllMocks(); });
    it('the same file merged again into a tree whose source has another default: one census', async () => {
        const tree = read(otherProgramGed(), ORIGIN('2026-11-10'));
        const [census] = censusOf(tree);
        const p = drahoslav(tree);
        // The default changed in the source form (the citations without their own follow it).
        const before = [citationQuality(p, 'birthSourceIds', census.id, tree.sources),
            citationQuality(occupation(p), 'sourceIds', census.id, tree.sources)];
        const other = census.quality === 3 ? 2 : 3;
        const was = census.quality;
        census.quality = other;
        // Keep what each citation says (the birth and the occupation as the file).
        for (const [holder, field, q] of [[p, 'birthSourceIds', before[0]], [occupation(p), 'sourceIds', before[1]]] as const) {
            const map = ((holder as { citationQuay?: Record<string, Record<string, number | null>> }).citationQuay ??= {});
            if (q === other) delete map[field]?.[census.id];
            else (map[field] ??= {})[census.id] = q ?? null;
        }
        expect(was).not.toBe(other);
        const result = await executeMerge(createMergeState(tree, read(otherProgramGed(), ORIGIN('2026-11-11'))));
        expect(result.success).toBe(true);
        const merged = result.mergedData!;
        expect(censusOf(merged)).toHaveLength(1);
        const m = drahoslav(merged);
        expect(m.birthSourceIds).toEqual([census.id]);
        expect(citationQuality(m, 'birthSourceIds', census.id, merged.sources)).toBe(2);
        expect(citationQuality(occupation(m), 'sourceIds', census.id, merged.sources)).toBe(3);
        expect(citationQuality(m, 'deathSourceIds', census.id, merged.sources)).toBeUndefined();
    });
});

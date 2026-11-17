/**
 * A tree's own files written to a research that keeps them (spec 108 U8,
 * Strom Research 1.35): the gates (`media.app`, `material.links`, the
 * material capabilities), the write that says it carries every file
 * (`POST /sync?media=app`) and when it may say so, the couple's photo marked
 * `_PRIM Y` and read back by it, each file's `_DATE`, and the first write
 * after the update that goes by itself (K2.7). Invented data only.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
    MEDIA_APP_FEATURE, MATERIAL_LINKS_FEATURE, NO_MEDIA_FEATURES, researchKeepsAppMedia, researchMediaOut,
    researchSendDeclaresMedia, researchSyncUrl, researchMediaFirstSendDue, sanitizeAccepts, withAppVersion,
} from '../research-link.js';
import {
    MATERIAL_USES_FEATURE, MATERIAL_EDIT_FEATURE, MATERIAL_SORT_FEATURE, matUses, matEdit, matSort, MaterialEnv,
} from '../materials.js';
import { treeHasAppMedia } from '../browser-media.js';
import { researchAutoState, patchResearchAutoState } from '../research-device.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { addPersonMedia, personMedia } from '../media.js';
import { SettingsManager } from '../settings.js';
import { Partnership, Person, StromData, TreeId, ResearchLink } from '../types.js';

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));
/** A JPEG header (SOI + APP0 + SOF0) claiming the given size. */
function jpegDataUrl(width: number, height: number): string {
    const app0 = [0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof0 = [0xFF, 0xC0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3,
        1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return 'data:image/jpeg;base64,' + b64([0xFF, 0xD8, ...app0, ...sof0, 0xFF, 0xD9]);
}
const COUPLE_JPEG = jpegDataUrl(1600, 1067);
const OTHER_JPEG = jpegDataUrl(900, 1200);
const PORTRAIT_JPEG = jpegDataUrl(256, 256);

const COUPLE = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Bratrolib /Ječmínek/
1 SEX M
1 DEAT Y
1 FAMS @F1@
0 @I2@ INDI
1 NAME Zvonimíra /Lopuchová/
1 SEX F
1 DEAT Y
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1911
`;

const load = (text: string) => convertToStrom(parseGedcom(text));

function byName(data: StromData, first: string): Person {
    const p = Object.values(data.persons).find(x => x.firstName === first);
    if (!p) throw new Error(`no ${first}`);
    return p;
}
function onlyCouple(data: StromData): Partnership {
    const all = Object.values(data.partnerships);
    expect(all).toHaveLength(1);
    return all[0];
}
/** The lines of the FAM records. */
const famRecords = (ged: string): string[][] => ged.split(/\r?\n(?=0 )/)
    .map(r => r.split(/\r?\n/).filter(l => l !== ''))
    .filter(r => / FAM$/.test(r[0]));

/** The couple with its photo, the wife's portrait and an attachment, each dated; titles in other scripts. */
function treeWithFiles(): StromData {
    const data = migrateData(load(COUPLE + '0 TRLR\n').data);
    const union = onlyCouple(data);
    union.photo = COUPLE_JPEG;
    union.photoOriginalName = 'svatba 1911 💍 婚礼 Škoda.jpg';
    union.photoDate = '12 JUN 1911';
    const wife = byName(data, 'Zvonimíra');
    wife.photo = PORTRAIT_JPEG;
    wife.photoOriginalName = 'zvonimira.jpg';
    wife.photoDate = '1930';
    addPersonMedia(data, wife.id, { id: 'att_1', name: 'list 👪 家族.jpg', mimeType: 'image/jpeg', dataUrl: OTHER_JPEG, sizeBytes: 40, date: '3 MAR 1912' });
    return data;
}

describe('gates of a research that keeps the app’s files (/status.features)', () => {
    it('media.app and material.links, each on its own; nothing said or not reached: as ever', () => {
        expect(MEDIA_APP_FEATURE).toBe('media.app');
        expect(MATERIAL_LINKS_FEATURE).toBe('material.links');
        expect(researchKeepsAppMedia({ features: ['media.app'] })).toBe(true);
        expect(researchKeepsAppMedia({ features: ['material.links'] })).toBe(false);
        expect(researchKeepsAppMedia({ features: null })).toBe(false);
        expect(researchKeepsAppMedia(null)).toBe(false);
        expect(researchMediaOut({ features: ['media.app', 'material.links'] })).toEqual({ appMedia: true, mediaDates: true });
        expect(researchMediaOut({ features: ['material.links'] })).toEqual({ appMedia: false, mediaDates: true });
        expect(researchMediaOut(undefined)).toEqual(NO_MEDIA_FEATURES);
    });

    it('the material capabilities for later (uses, edit, sort) come only with the list', () => {
        const env: MaterialEnv = { linked: true, onComputer: true, bridgeUp: true,
            features: ['material.list', MATERIAL_USES_FEATURE, MATERIAL_EDIT_FEATURE, MATERIAL_SORT_FEATURE] };
        expect([MATERIAL_USES_FEATURE, MATERIAL_EDIT_FEATURE, MATERIAL_SORT_FEATURE]).toEqual(['material.uses', 'material.edit', 'material.sort']);
        expect([matUses(env), matEdit(env), matSort(env)]).toEqual([true, true, true]);
        // An archive (no agent): no sort.
        expect(matSort({ ...env, features: ['material.list', MATERIAL_USES_FEATURE] })).toBe(false);
        // Without the list nothing of it.
        const noList = { ...env, features: [MATERIAL_USES_FEATURE, MATERIAL_EDIT_FEATURE, MATERIAL_SORT_FEATURE] };
        expect([matUses(noList), matEdit(noList), matSort(noList)]).toEqual([false, false, false]);
    });

    it('accepts.media.family: kept when the research says it takes a couple’s original', () => {
        expect(sanitizeAccepts({ media: { max: 1, family: true } })?.mediaFamily).toBe(true);
        expect(sanitizeAccepts({ media: { max: 1 } })).not.toHaveProperty('mediaFamily');
        expect(sanitizeAccepts({ media: { max: 1, family: 'yes' } })).not.toHaveProperty('mediaFamily');
    });
});

describe('the write that says it carries every file (POST /sync?media=app, P4)', () => {
    const on = { features: ['media.app'] };
    const takes = { importImages: true, loadedWithoutImages: false };

    it('only to a research with media.app, while the tree holds the research’s files too', () => {
        expect(researchSendDeclaresMedia(on, takes)).toBe(true);
        // An older research: as ever.
        expect(researchSendDeclaresMedia({ features: ['material.links'] }, takes)).toBe(false);
        expect(researchSendDeclaresMedia(null, takes)).toBe(false);
        // Images not taken (the setting off; the last load without them): it only adds.
        expect(researchSendDeclaresMedia(on, { importImages: false, loadedWithoutImages: false })).toBe(false);
        expect(researchSendDeclaresMedia(on, { importImages: true, loadedWithoutImages: true })).toBe(false);
    });

    it('the address: ?media=app beside the app’s version, or the plain /sync', () => {
        const base = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';
        expect(researchSyncUrl(base, false)).toBe(`${base}/sync`);
        expect(researchSyncUrl(base, true)).toBe(`${base}/sync?media=app`);
        const url = new URL(withAppVersion(researchSyncUrl(base, true), '3.30.0'));
        expect(url.searchParams.get('media')).toBe('app');
        expect(url.searchParams.get('app')).toBe('3.30.0');
        expect(new URL(withAppVersion(researchSyncUrl(base, false), '3.30.0')).searchParams.has('media')).toBe(false);
    });

    it('the write carries every file: portraits, the couple’s photo, attachments, one only its original by name and hash', () => {
        const data = treeWithFiles();
        const sha = 'a'.repeat(64);
        addPersonMedia(data, byName(data, 'Bratrolib').id, { id: 'att_2', name: 'matrika.tif', mimeType: 'image/tiff', dataUrl: '', sizeBytes: 9e6,
            originalOnly: true, original: { sha256: sha, mimeType: 'image/tiff', sizeBytes: 9e6 } } as never);
        const ged = exportToGedcom(data, 'T', { research: { id: 'r', head: 'h', appTree: 't' }, appMedia: true, mediaDates: true }).content;
        expect(ged).toContain(PORTRAIT_JPEG.slice(0, 40));
        expect(ged).toContain(OTHER_JPEG.slice(0, 40));
        expect(ged).toContain(COUPLE_JPEG.slice(0, 40));
        expect(ged).toContain(`2 _STROM_SHA ${sha}`);
        expect(ged).toContain('2 FILE matrika.tif');
    });
});

describe('the couple’s photo marked _PRIM Y for a research that keeps the app’s files', () => {
    it('with media.app: 2 _PRIM Y under the family’s photo; without: no tag of its own (spec 107)', () => {
        const data = treeWithFiles();
        const [withGate] = famRecords(exportToGedcom(data, 'T', { appMedia: true }).content);
        expect(withGate.filter(l => l === '1 OBJE')).toHaveLength(1);
        expect(withGate).toContain('2 _PRIM Y');
        const [without] = famRecords(exportToGedcom(data).content);
        expect(without.some(l => l.includes('_PRIM'))).toBe(false);
        // A person's portrait never carries it (its own mark is _STROM_KIND photo).
        const ged = exportToGedcom(data, 'T', { appMedia: true }).content;
        expect(ged.split(/\r?\n/).filter(l => l.includes('_PRIM'))).toEqual(['2 _PRIM Y']);
    });

    it('round trip: the photo comes back as the photo with its title (emoji, CJK, diacritics) and goes out the same', () => {
        const first = exportToGedcom(treeWithFiles(), 'T', { appMedia: true, mediaDates: true }).content;
        const back = load(first);
        expect(back.stats.droppedTagSummary).toBe('');
        const union = onlyCouple(back.data);
        expect(union.photo).toBe(COUPLE_JPEG);
        expect(union.photoOriginalName).toBe('svatba 1911 💍 婚礼 Škoda.jpg');
        expect(union.photoDate).toBe('12 JUN 1911');
        expect(union.gedcomExtra).toBeUndefined();
        const att = personMedia(back.data, byName(back.data, 'Zvonimíra').id)[0];
        expect(att?.name).toBe('list 👪 家族.jpg');
        const again = exportToGedcom(migrateData(back.data), 'T', { appMedia: true, mediaDates: true }).content;
        expect(famRecords(again)).toEqual(famRecords(first));
    });
});

describe('reading a family’s _PRIM (the research’s answer)', () => {
    const fam = (objes: string): StromData => load(COUPLE + objes + '0 TRLR\n').data;

    it('once a picture of the family says _PRIM, the photo is only the one with Y — wherever it stands', () => {
        const data = fam(`1 OBJE
2 FORM jpeg
2 TITL dopis.jpg
2 _PRIM N
2 FILE ${OTHER_JPEG}
1 OBJE
2 FORM jpeg
2 TITL svatba.jpg
2 _PRIM Y
2 FILE ${COUPLE_JPEG}
`);
        expect(onlyCouple(data).photo).toBe(COUPLE_JPEG);
        expect(onlyCouple(data).photoOriginalName).toBe('svatba.jpg');
    });

    it('only the family’s files (all N): no couple’s photo', () => {
        const data = fam(`1 OBJE
2 FORM jpeg
2 _PRIM N
2 FILE ${OTHER_JPEG}
`);
        expect(onlyCouple(data).photo).toBeUndefined();
    });

    it('no _PRIM at all: the first image, as before', () => {
        const data = fam(`1 OBJE
2 FORM jpeg
2 FILE ${OTHER_JPEG}
1 OBJE
2 FORM jpeg
2 FILE ${COUPLE_JPEG}
`);
        expect(onlyCouple(data).photo).toBe(OTHER_JPEG);
    });

    it('through a media record: the link’s or the record’s _PRIM counts the same', () => {
        const data = load(COUPLE + `1 OBJE @M1@
1 OBJE @M2@
2 _PRIM Y
0 @M1@ OBJE
1 FILE ${OTHER_JPEG}
2 FORM jpeg
1 _PRIM N
0 @M2@ OBJE
1 FILE ${COUPLE_JPEG}
2 FORM jpeg
0 TRLR
`).data;
        expect(onlyCouple(data).photo).toBe(COUPLE_JPEG);
    });
});

describe('each file’s date (_DATE) for a research that keeps it (material.links)', () => {
    const dates = (ged: string): string[] => ged.split(/\r?\n/).filter(l => l.startsWith('2 _DATE '));

    it('with material.links: the portrait’s, the couple photo’s and the attachment’s date; without: none (as before)', () => {
        const data = treeWithFiles();
        expect(dates(exportToGedcom(data, 'T', { research: { id: 'r', head: 'h', appTree: 't' }, mediaDates: true }).content).sort())
            .toEqual(['2 _DATE 12 JUN 1911', '2 _DATE 1930', '2 _DATE 3 MAR 1912']);
        expect(dates(exportToGedcom(data, 'T', { research: { id: 'r', head: 'h', appTree: 't' } }).content)).toEqual([]);
    });
});

describe('the first write after the update goes by itself (K2.7)', () => {
    it('due: a research with media.app, a tree with files, not yet sent there with them', () => {
        const due = (o: Partial<Parameters<typeof researchMediaFirstSendDue>[0]>) =>
            researchMediaFirstSendDue({ declares: true, hasMedia: true, researchId: 'r1', sentTo: undefined, ...o });
        expect(due({})).toBe(true);
        expect(due({ sentTo: 'r1' })).toBe(false);
        // Sent to another research (the tree tied anew): this one has not had them.
        expect(due({ sentTo: 'r0' })).toBe(true);
        expect(due({ hasMedia: false })).toBe(false);
        // An older research, or images not taken: never by itself.
        expect(due({ declares: false })).toBe(false);
    });

    it('a tree has files: a portrait, a couple’s photo, any attachment (one only its original too)', () => {
        const data = migrateData(load(COUPLE + '0 TRLR\n').data);
        expect(treeHasAppMedia(data)).toBe(false);
        onlyCouple(data).photo = COUPLE_JPEG;
        expect(treeHasAppMedia(data)).toBe(true);
        delete onlyCouple(data).photo;
        addPersonMedia(data, byName(data, 'Bratrolib').id, { id: 'a', name: 'x.tif', mimeType: 'image/tiff', dataUrl: '', sizeBytes: 1, originalOnly: true });
        expect(treeHasAppMedia(data)).toBe(true);
    });

    describe('in the app (researchMediaFirstDue)', () => {
        const TREE = 'tree_1700000000000_ab12c' as TreeId;
        const RID = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
        let methods: Record<string, unknown>;
        let store: Map<string, string>;
        type Ui = { researchMediaFirstDue(treeId: TreeId, link: ResearchLink, data: StromData | null): boolean };

        beforeAll(async () => {
            const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> };
            methods = researchSyncMethods;
        }, 60000);
        beforeEach(() => {
            store = new Map();
            vi.stubGlobal('localStorage', {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => { store.set(k, v); },
                removeItem: (k: string) => { store.delete(k); },
                key: (i: number) => [...store.keys()][i] ?? null,
                get length() { return store.size; },
            });
        });
        afterEach(() => {
            vi.unstubAllGlobals();
            vi.restoreAllMocks();
        });
        const ui = (features: string[]): Ui => ({ ...methods, researchStatusOf: () => ({ features }) } as unknown as Ui);
        const link = (over: Partial<ResearchLink> = {}): ResearchLink => ({ id: RID, fingerprint: 'f', syncedAt: '2026-11-17T08:00:00Z', ...over } as ResearchLink);

        it('due once, until a write with the files went to that research', () => {
            const data = treeWithFiles();
            expect(ui(['media.app']).researchMediaFirstDue(TREE, link(), data)).toBe(true);
            expect(ui([]).researchMediaFirstDue(TREE, link(), data)).toBe(false);
            patchResearchAutoState(TREE, { appMediaSent: RID });
            expect(researchAutoState(TREE).appMediaSent).toBe(RID);
            expect(ui(['media.app']).researchMediaFirstDue(TREE, link(), data)).toBe(false);
        });

        it('not with images not taken: the import setting off, or the last load without them', () => {
            const data = treeWithFiles();
            expect(ui(['media.app']).researchMediaFirstDue(TREE, link({ treeEtag: { tag: 't', head: 'h', fingerprint: 'f', images: false } }), data)).toBe(false);
            vi.spyOn(SettingsManager, 'isImportImages').mockReturnValue(false);
            expect(ui(['media.app']).researchMediaFirstDue(TREE, link(), data)).toBe(false);
        });
    });
});

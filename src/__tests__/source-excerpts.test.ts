/**
 * Register entries on sources (plan "citace a výřezy", phase 1): transcript,
 * record date, refn and excerpt crops — model helpers, load sanitising, the
 * GEDCOM contract (import + round-trip), content stripping, merge, subtree and
 * research id stabilisation. Invented data only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { imageSizeFromDataUrl, excerptFromDataUrl } from '../excerpts.js';
import { safeHttpUrl, stripUnsafeMediaDataUrls } from '../validation.js';
import { stripAttachments, stripMedia, countImages, totalAttachmentBytes } from '../attachments.js';
import { applyContentOptions, CONTENT_PRESETS } from '../privacy.js';
import { createMergeState } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { extractSubtree } from '../subtree.js';
import { stabilizeIds } from '../research-link.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { StorageManager } from '../storage.js';
import { StromData, Person, PersonId, PartnershipId, TreeId, Source, SourceExcerpt } from '../types.js';

// ---------- tiny images ----------

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

/** A PNG header (signature + IHDR) claiming the given size. */
function pngDataUrl(width: number, height: number): string {
    const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    return 'data:image/png;base64,' + b64([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height), 8, 2, 0, 0, 0,
    ]);
}

/** A JPEG header (SOI + APP0 + SOF0) claiming the given size. */
function jpegDataUrl(width: number, height: number): string {
    const app0 = [0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    const sof0 = [0xFF, 0xC0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3,
        1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
    return 'data:image/jpeg;base64,' + b64([0xFF, 0xD8, ...app0, ...sof0, 0xFF, 0xD9]);
}

const JPEG = jpegDataUrl(1200, 240);

function excerpt(o: Partial<SourceExcerpt> = {}): SourceExcerpt {
    return { id: 'exc1', dataUrl: JPEG, width: 1200, height: 240, sizeBytes: 50, ...o };
}

function person(id: string, first: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'Novák', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...o,
    };
}

const GED = (body: string[]) => `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${body.join('\n')}\n0 TRLR`;
const conv = (text: string) => convertToStrom(parseGedcom(text));
const onlySource = (d: StromData): Source => Object.values(d.sources ?? {})[0];

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

// ---------- helpers ----------

describe('image size from the header', () => {
    it('reads PNG and JPEG sizes', () => {
        expect(imageSizeFromDataUrl(pngDataUrl(640, 120))).toEqual({ width: 640, height: 120 });
        expect(imageSizeFromDataUrl(jpegDataUrl(1200, 240))).toEqual({ width: 1200, height: 240 });
    });

    it('gives up on other formats and garbage', () => {
        expect(imageSizeFromDataUrl('data:image/webp;base64,UklGRg==')).toBeNull();
        expect(imageSizeFromDataUrl('data:image/jpeg;base64,!!!')).toBeNull();
    });

    it('builds an excerpt only from a raster image', () => {
        const exc = excerptFromDataUrl(JPEG, { caption: 'levá strana' })!;
        expect(exc).toMatchObject({ width: 1200, height: 240, caption: 'levá strana' });
        expect(exc.id).toMatch(/^exc_/);
        expect(excerptFromDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    });
});

describe('safeHttpUrl', () => {
    it('passes only absolute http(s) links', () => {
        expect(safeHttpUrl('https://archive.example/page/57')).toBe('https://archive.example/page/57');
        expect(safeHttpUrl(' http://a.example ')).toBe('http://a.example/');
        expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
        expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull();
        expect(safeHttpUrl('data:text/html,<b>')).toBeNull();
        expect(safeHttpUrl('/relative/page')).toBeNull();
        expect(safeHttpUrl('')).toBeNull();
        expect(safeHttpUrl(undefined)).toBeNull();
    });
});

describe('load sanitising', () => {
    it('drops non-image excerpts and impossible regions', () => {
        const data: StromData = {
            persons: {}, partnerships: {},
            sources: {
                s1: {
                    id: 's1', title: 'Křest', excerpts: [
                        excerpt({ id: 'ok', region: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 } }),
                        excerpt({ id: 'bad-region', region: { x: 0.8, y: 0, w: 0.5, h: 0.1 } }),
                        excerpt({ id: 'html', dataUrl: 'data:text/html;base64,PGI+' }),
                    ],
                },
                s2: { id: 's2', title: 'Only evil', excerpts: [excerpt({ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })] },
            },
        };
        expect(stripUnsafeMediaDataUrls(data)).toBe(2);
        const kept = data.sources!.s1.excerpts!;
        expect(kept.map(e => e.id)).toEqual(['ok', 'bad-region']);
        expect(kept[0].region).toBeDefined();
        expect(kept[1].region).toBeUndefined();
        expect(data.sources!.s2.excerpts).toBeUndefined();
    });
});

// ---------- GEDCOM ----------

describe('GEDCOM: a register entry as a source', () => {
    const researchFile = GED([
        '0 @I1@ INDI', '1 NAME Jan /Novák/', '1 SEX M',
        '1 BAPM', '2 DATE 13 MAR 1865', '2 SOUR @S1@', '3 PAGE fol. 45, č. 12', '3 DATA', '4 DATE 14 MAR 1865',
        '0 @S1@ SOUR', '1 TITL Křest: Jan Novák, Týnec 1865', '1 REFN S0042',
        '1 TEXT Jan, syn Josefa Nováka,', '2 CONT sedláka č. 12',
        '1 NOTE Kniha Týnec 17',
        '1 OBJE', '2 FORM jpg', '2 TITL levá strana', '2 _STROM_KIND excerpt',
        '2 _URL https://archive.example/page/57', '2 _REGION 0.1 0.4 0.7 0.08',
        `2 FILE ${JPEG.slice(0, 40)}`, `3 CONC ${JPEG.slice(40)}`,
    ]);

    it('reads transcript, refn, record date and the excerpt', () => {
        const r = conv(researchFile);
        const src = onlySource(r.data);
        expect(src.transcript).toBe('Jan, syn Josefa Nováka,\nsedláka č. 12');
        expect(src.note).toBe('Kniha Týnec 17');   // the transcript no longer lands in the note
        expect(src.refn).toBe('S0042');
        expect(src.recordDate).toBe('1865-03-14');
        expect(src.reference).toBe('fol. 45, č. 12');
        expect(src.excerpts).toHaveLength(1);
        expect(src.excerpts![0]).toMatchObject({
            dataUrl: JPEG, width: 1200, height: 240, caption: 'levá strana',
            pageUrl: 'https://archive.example/page/57',
        });
        expect(src.excerpts![0].region).toBeUndefined();
        expect(r.stats.unsupportedTags).toBe(0);
    });

    it('reads the record date from a citation at person and family level too', () => {
        const r = conv(GED([
            '0 @I1@ INDI', '1 NAME Jan /Novák/', '1 SEX M', '1 SOUR @S1@', '2 DATA', '3 DATE 2 FEB 1901',
            '0 @I2@ INDI', '1 NAME Anna /Nová/', '1 SEX F',
            '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 SOUR @S2@', '2 DATA', '3 DATE 1 MAY 1900',
            '0 @S1@ SOUR', '1 TITL Narození',
            '0 @S2@ SOUR', '1 TITL Sňatek',
        ]));
        const byTitle = (t: string) => Object.values(r.data.sources!).find(s => s.title === t)!;
        expect(byTitle('Narození').recordDate).toBe('1901-02-02');
        expect(byTitle('Sňatek').recordDate).toBe('1900-05-01');
    });

    it('cites one entry once when it backs both birth and death', () => {
        const r = conv(GED([
            '0 @I1@ INDI', '1 NAME Anna /Nová/', '1 SEX F',
            '1 BIRT', '2 DATE 3 JAN 1880', '2 SOUR @S1@',
            '1 DEAT', '2 DATE 9 JAN 1880', '2 SOUR @S1@',
            '0 @S1@ SOUR', '1 TITL Narození: Anna Nová, Týnec 1880',
        ]));
        const person = Object.values(r.data.persons).find(p => p.firstName === 'Anna')!;
        expect(person.sourceIds).toEqual([onlySource(r.data).id]);
    });

    it('skips a source image that is not an embedded raster image', () => {
        const r = conv(GED([
            '0 @S1@ SOUR', '1 TITL Křest',
            '1 OBJE', '2 FILE C:\\scans\\57.jpg',
            '1 OBJE', '2 FILE data:image/svg+xml;base64,PHN2Zz4=',
        ]));
        expect(onlySource(r.data).excerpts).toBeUndefined();
        expect(r.stats.skippedMedia).toBe(2);
    });

    it('survives an export → import round-trip', () => {
        const first = conv(researchFile).data;
        const out = exportToGedcom(first).content;
        for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(255);
        expect(out).toContain('1 REFN S0042');
        expect(out).toContain('2 _STROM_KIND excerpt');
        expect(out).toMatch(/3 DATA\n4 DATE 14 MAR 1865/);

        const src = onlySource(conv(out).data);
        const orig = onlySource(first);
        expect(src.transcript).toBe(orig.transcript);
        expect(src.refn).toBe(orig.refn);
        expect(src.recordDate).toBe(orig.recordDate);
        expect(src.excerpts?.map(e => [e.dataUrl, e.caption, e.pageUrl]))
            .toEqual(orig.excerpts?.map(e => [e.dataUrl, e.caption, e.pageUrl]));
    });
});

// ---------- content options ----------

describe('excerpts travel with attachments', () => {
    const data = (): StromData => ({
        persons: { a: person('a', 'Jan', { photo: JPEG }) } as StromData['persons'],
        partnerships: {},
        sources: { s1: { id: 's1', title: 'Křest', transcript: 'Jan…', excerpts: [excerpt()] } },
    });

    it('counts and sizes images', () => {
        expect(countImages(data())).toEqual({ photos: 1, attachments: 0, excerpts: 1, bytes: expect.any(Number) });
        expect(totalAttachmentBytes(data())).toBe(50);
    });

    it('leaving attachments out drops excerpts but keeps the text', () => {
        for (const out of [stripAttachments(data()), stripMedia(data()), applyContentOptions(data(), CONTENT_PRESETS.small)]) {
            expect(out.sources!.s1.excerpts).toBeUndefined();
            expect(out.sources!.s1.transcript).toBe('Jan…');
        }
        expect(stripMedia(data()).persons['a' as PersonId].photo).toBeUndefined();
    });
});

// ---------- DataManager ----------

describe('DataManager', () => {
    const TREE = 'excerpt-test' as TreeId;
    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        vi.spyOn(DataManager, 'isTreeLocked').mockReturnValue(false);
        const dm = DataManager as unknown as {
            data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
        };
        dm.data = { persons: {}, partnerships: {} };
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('lists every place citing a source', () => {
        const a = DataManager.createPerson({ firstName: 'Jan', lastName: 'N', gender: 'male' });
        const b = DataManager.createPerson({ firstName: 'Anna', lastName: 'N', gender: 'female' });
        const ev = DataManager.addLifeEvent(a.id, { type: 'baptism' })!;
        const union = DataManager.createPartnership(a.id, b.id)!;
        const src = DataManager.addSource({ title: 'Matrika' })!;
        DataManager.citePerson(a.id, src.id);
        DataManager.citeEvent(a.id, ev.id, src.id);
        DataManager.citePartnership(union.id, src.id);
        expect(DataManager.listSourceCitations(src.id)).toEqual([
            { kind: 'person', personId: a.id },
            { kind: 'event', personId: a.id, eventId: ev.id },
            { kind: 'partnership', partnershipId: union.id },
        ]);
    });

    it('removing the full page keeps the excerpt but unlinks it', () => {
        const a = DataManager.createPerson({ firstName: 'Jan', lastName: 'N', gender: 'male' });
        const att = DataManager.addAttachment(a.id, { name: 'p57.jpg', mimeType: 'image/jpeg', dataUrl: JPEG, sizeBytes: 50 })!;
        const src = DataManager.addSource({
            title: 'Křest', excerpts: [excerpt({ fromAttachmentId: att.id, region: { x: 0, y: 0, w: 1, h: 0.2 } })],
        })!;
        expect(DataManager.removeAttachment(a.id, att.id)).toBe(true);
        const exc = DataManager.getData().sources![src.id].excerpts![0];
        expect(exc.dataUrl).toBe(JPEG);
        expect(exc.fromAttachmentId).toBeUndefined();
        expect(exc.region).toBeUndefined();
        DataManager.undo();
        expect(DataManager.getData().sources![src.id].excerpts![0].fromAttachmentId).toBe(att.id);
    });
});

// ---------- merge / subtree / research ----------

describe('merge', () => {
    it('the same refn is the same entry; the kept one gains the excerpt and transcript', async () => {
        const existing: StromData = {
            persons: { a: person('a', 'Jan', { sourceIds: ['s1'] }) } as StromData['persons'],
            partnerships: {},
            sources: { s1: { id: 's1', title: 'Křest Jana', refn: 'S0042' } },
        };
        const incoming: StromData = {
            persons: { b: person('b', 'Petr', { sourceIds: ['t9'] }) } as StromData['persons'],
            partnerships: {},
            sources: { t9: { id: 't9', title: 'Křest: Jan Novák (upraveno)', refn: 'S0042', transcript: 'Jan…', excerpts: [excerpt()] } },
        };
        const { mergedData } = await executeMerge(createMergeState(existing, incoming));
        const sources = Object.values(mergedData.sources!);
        expect(sources).toHaveLength(1);
        expect(sources[0]).toMatchObject({ id: 's1', title: 'Křest Jana', transcript: 'Jan…' });
        expect(sources[0].excerpts).toHaveLength(1);
        const petr = Object.values(mergedData.persons).find(p => p.firstName === 'Petr')!;
        expect(petr.sourceIds).toEqual(['s1']);
    });
});

describe('subtree', () => {
    it('an excerpt whose page stays behind loses only its re-crop link', () => {
        const data: StromData = {
            persons: {
                a: person('a', 'Jan', { sourceIds: ['s1'] }),
                b: person('b', 'Petr', { attachments: [{ id: 'att1', name: 'p', mimeType: 'image/jpeg', dataUrl: JPEG, sizeBytes: 50 }] }),
            } as StromData['persons'],
            partnerships: {},
            sources: { s1: { id: 's1', title: 'Křest', excerpts: [excerpt({ fromAttachmentId: 'att1', region: { x: 0, y: 0, w: 1, h: 0.2 } })] } },
        };
        const sub = extractSubtree(data, new Set(['a' as PersonId]));
        const exc = sub.sources!.s1.excerpts![0];
        expect(exc.dataUrl).toBe(JPEG);
        expect(exc.fromAttachmentId).toBeUndefined();
        expect(exc.region).toBeUndefined();
        // The original tree is untouched.
        expect(data.sources!.s1.excerpts![0].fromAttachmentId).toBe('att1');
    });
});

describe('research update keeps source ids', () => {
    it('matches sources by refn', () => {
        const previous: StromData = {
            persons: { p_old: person('p_old', 'Jan', { refn: 'P0001', sourceIds: ['src_old'] }) } as StromData['persons'],
            partnerships: {} as Record<PartnershipId, never>,
            sources: { src_old: { id: 'src_old', title: 'Křest', refn: 'S0042' } },
        };
        const next: StromData = {
            persons: { p_new: person('p_new', 'Jan', { refn: 'P0001', sourceIds: ['src_new'] }) } as StromData['persons'],
            partnerships: {},
            sources: { src_new: { id: 'src_new', title: 'Křest', refn: 'S0042' } },
        };
        const out = stabilizeIds(next, previous);
        expect(Object.keys(out.sources!)).toEqual(['src_old']);
        expect(out.persons['p_old' as PersonId].sourceIds).toEqual(['src_old']);
    });
});

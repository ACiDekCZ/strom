/**
 * Splitting older locations into fields, all sources at once (spec 075 §5):
 * the note line of an earlier GEDCOM import, the local plan and preview, the
 * offer lines, the short date of the undo row and the one undo step.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localSplitOf, localSplitPlan, localSplitPreview, noteCallNumber, splitOffer, splitPreviewMark } from '../source-split.js';
import { formatShortDateTime } from '../format.js';
import { clipWithEllipsis } from '../text-clip.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import type { Source, StromData, TreeId } from '../types.js';

const src = (id: string, title: string, extra: Partial<Source> = {}): Source => ({ id, title, ...extra } as Source);

describe('noteCallNumber', () => {
    it('reads the line in every import language and takes it out of the note', () => {
        expect(noteCallNumber('Signatura: N 7')).toEqual({ callNumber: 'N 7' });
        expect(noteCallNumber('Call number: N 7')).toEqual({ callNumber: 'N 7' });
        expect(noteCallNumber('Signatur: N 7')).toEqual({ callNumber: 'N 7' });
        expect(noteCallNumber('Sygnatura: N 7')).toEqual({ callNumber: 'N 7' });
        expect(noteCallNumber('Matrika obce Vzorov\nSignatura: N 7')).toEqual({ callNumber: 'N 7', note: 'Matrika obce Vzorov' });
        expect(noteCallNumber('Matrika\n\nSignatura: N 7')).toEqual({ callNumber: 'N 7', note: 'Matrika' });
        expect(noteCallNumber('Signatura: N 7\n\nMatrika')).toEqual({ callNumber: 'N 7', note: 'Matrika' });
        expect(noteCallNumber('Matrika\n\nSignatura: N 7\n\nPoznámka')).toEqual({ callNumber: 'N 7', note: 'Matrika\n\nPoznámka' });
    });

    it('leaves a note without such a line alone', () => {
        expect(noteCallNumber(undefined)).toBeUndefined();
        expect(noteCallNumber('Signatura neznámá')).toBeUndefined();
        expect(noteCallNumber('Viz signatura: N 7')).toBeUndefined();
        expect(noteCallNumber('Signatura: ')).toBeUndefined();
    });
});

describe('the local plan', () => {
    it('splits a recognised location, keeps a filled field, counts the unrecognised', () => {
        const sources = [
            src('s2', 'Matrika N 7 Vzorov', { reference: 'fol. 12v, č. 5, snímek 34' }),
            src('s1', 'Kniha zápisů Vzorov', { reference: 'Kniha N 7, zápis bez čísla' }),
            src('s3', 'Matrika N 8 Vzorov', { reference: 'str. 9, obr. 16', folio: 'str. 9' }),
            src('s4', 'Pozemková kniha', { reference: 'S. 12 edice (PDF S. 14), fol. 3r' }),
            src('s5', 'Bez umístění'),
            src('s6', 'Rozdělený pramen', { folio: 'fol. 3', image: '4' }),
        ];
        const plan = localSplitPlan(sources);
        const ids = plan.changes.map(c => c.row.source);
        expect(ids).toContain('s2');
        expect(ids).not.toContain('s1');
        expect(ids).not.toContain('s5');
        expect(ids).not.toContain('s6');
        const s2 = plan.changes.find(c => c.row.source === 's2')!;
        expect(s2.row.before).toEqual({ reference: 'fol. 12v, č. 5, snímek 34' });
        expect(s2.row.after).toEqual({ folio: 'fol. 12v', image: '34', reference: 'č. 5' });
        expect(s2.source).toMatchObject({ id: 's2', title: 'Matrika N 7 Vzorov', folio: 'fol. 12v', image: '34', reference: 'č. 5' });
        expect(plan.unrecognized).toBeGreaterThanOrEqual(1);
        expect(plan.unrecognizedExamples[0]).toBe('Kniha N 7, zápis bez čísla');
        // Ordered by title, as the Sources manager lists them.
        const titles = plan.changes.map(c => c.row.title);
        expect([...titles].sort((a, b) => a.localeCompare(b))).toEqual(titles);
        const pv = localSplitPreview(plan);
        expect(pv).toMatchObject({ count: plan.changes.length, complete: true, fromNote: 0 });
        expect(pv.rows).toHaveLength(plan.changes.length);
    });

    it('moves a note line to an empty call number, never over a filled one', () => {
        const a = localSplitOf(src('a', 'Matrika', { note: 'Matrika obce\nSignatura: N 7' }))!;
        expect(a.row.callNumberFromNote).toBe(true);
        expect(a.source.callNumber).toBe('N 7');
        expect(a.source.note).toBe('Matrika obce');
        expect(a.row.after.callNumber).toBe('N 7');
        const b = localSplitOf(src('b', 'Matrika', { note: 'Signatura: N 7' }))!;
        expect(b.source.note).toBeUndefined();
        expect('note' in b.source).toBe(false);
        expect(localSplitOf(src('c', 'Matrika', { callNumber: 'N 8', note: 'Signatura: N 7' }))).toBeUndefined();
        expect(localSplitPlan([src('d', 'Matrika', { note: 'Call number: N 9' })]).fromNote).toBe(1);
    });

    it('counts as not recognised only a location without folio and image fields; names each example once, NFC', () => {
        const nfd = 'Kniha N 7, zápis bez čísla'.normalize('NFD');
        const plan = localSplitPlan([
            // Split already: the rest of the location beside a folio or an image field is nothing to split.
            src('a1', 'Matrika A', { reference: 'č. 5', folio: 'fol. 3' }),
            src('a2', 'Matrika B', { reference: 'č. 6', image: '12' }),
            src('b1', 'Kniha 1', { reference: 'Kniha N 7, zápis bez čísla' }),
            src('b2', 'Kniha 2', { reference: nfd }),
            src('b3', 'Kniha 3', { reference: '  Kniha N 7, zápis bez čísla ' }),
            src('c1', 'Kniha 4', { reference: '家譜 第三巻 👨‍👩‍👧 🇨🇿' }),
            src('c2', 'Kniha 5', { reference: 'svazek bez označení' }),
            src('c3', 'Kniha 6', { reference: 'Ještě jeden' }),
        ]);
        expect(plan.changes).toEqual([]);
        expect(plan.unrecognized).toBe(6);
        expect(plan.unrecognizedExamples).toEqual(['Kniha N 7, zápis bez čísla', '家譜 第三巻 👨‍👩‍👧 🇨🇿', 'svazek bez označení']);
        expect(plan.unrecognizedExamples.every(x => x === x.normalize('NFC'))).toBe(true);
    });

    it('marks a preview by what it does', () => {
        const one = localSplitPreview(localSplitPlan([src('s', 'A', { reference: 'fol. 12v, snímek 34' })]));
        const two = localSplitPreview(localSplitPlan([src('s', 'A', { reference: 'fol. 13r, snímek 35' })]));
        expect(splitPreviewMark(one.rows)).toBe(splitPreviewMark(one.rows));
        expect(splitPreviewMark(one.rows)).not.toBe(splitPreviewMark(two.rows));
    });
});

describe('the offer lines', () => {
    const preview = (count: number) => ({ rows: [], count, complete: true, unrecognized: 0, unrecognizedExamples: [], fromNote: 0 });
    const undo = { id: 'local-1', at: 1, count: 3 };
    it('offers, says the research is needed, names the split done, or hides', () => {
        expect(splitOffer({ kind: 'local', preview: preview(4), undo: null }, 'sources')).toEqual({ line: 'offer', count: 4 });
        expect(splitOffer({ kind: 'local', preview: preview(4), undo }, 'table')).toEqual({ line: 'offer', count: 4 });
        expect(splitOffer({ kind: 'local', preview: preview(0), undo }, 'sources')).toEqual({ line: 'done', undo });
        expect(splitOffer({ kind: 'local', preview: preview(0), undo }, 'table')).toEqual({ line: 'hidden' });
        expect(splitOffer({ kind: 'local', preview: preview(0), undo: null }, 'sources')).toEqual({ line: 'hidden' });
        expect(splitOffer({ kind: 'needsResearch', preview: null, undo: null }, 'sources')).toEqual({ line: 'needsResearch' });
        expect(splitOffer({ kind: 'needsResearch', preview: null, undo: null }, 'table')).toEqual({ line: 'hidden' });
        expect(splitOffer({ kind: 'needsResearch', preview: preview(2), undo: null }, 'sources')).toEqual({ line: 'needsResearch' });
        expect(splitOffer({ kind: 'needsResearch', preview: preview(0), undo: null }, 'sources')).toEqual({ line: 'hidden' });
        expect(splitOffer({ kind: 'archive', preview: preview(4), undo: null }, 'sources')).toEqual({ line: 'hidden' });
        expect(splitOffer({ kind: 'none', preview: preview(4), undo: null }, 'table')).toEqual({ line: 'hidden' });
        expect(splitOffer({ kind: 'bridge', preview: null, undo: null }, 'sources')).toEqual({ line: 'hidden' });
    });
});

describe('formatShortDateTime', () => {
    it('writes the day, the month and the time short in each language', () => {
        const ts = new Date(2026, 10, 11, 14, 20).getTime();
        expect(formatShortDateTime(ts, 'cs')).toBe('11. 11. 14:20');
        expect(formatShortDateTime(ts, 'en')).toBe('11 Nov, 14:20');
        expect(formatShortDateTime(ts, 'de')).toBe('11. 11., 14:20');
        expect(formatShortDateTime(ts, 'pl')).toBe('11.11, 14:20');
    });
});

describe('the split as one undo step', () => {
    const TREE = 'source-split-tree' as TreeId;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 11, 14, 20));
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = {
            persons: {}, partnerships: {},
            sources: {
                s1: src('s1', 'Matrika N 7 Vzorov', { reference: 'fol. 12v, č. 5, snímek 34' }),
                s2: src('s2', 'Matrika N 8 Vzorov', { reference: 's. 15, sn. 7', note: 'Signatura: N 8' }),
            },
        } as StromData;
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('splits all sources in one step that Undo takes back whole, Redo again with its mark', () => {
        const plan = localSplitPlan(Object.values(DataManager.getData().sources!));
        expect(plan.changes).toHaveLength(2);
        const mark = DataManager.splitSourcePlaces(plan.changes.map(c => c.source));
        expect(mark).toEqual({ kind: 'sourcesSplit', at: new Date(2026, 10, 11, 14, 20).getTime(), count: 2 });
        expect(DataManager.lastUndoMark()).toEqual(mark);
        const s2 = DataManager.getData().sources!.s2!;
        expect(s2).toMatchObject({ folio: 's. 15', image: '7', callNumber: 'N 8' });
        expect(s2.note).toBeUndefined();
        expect(localSplitPlan(Object.values(DataManager.getData().sources!)).changes).toHaveLength(0);

        expect(DataManager.undo()).not.toBeNull();
        expect(DataManager.getData().sources!.s1).toEqual(src('s1', 'Matrika N 7 Vzorov', { reference: 'fol. 12v, č. 5, snímek 34' }));
        expect(DataManager.getData().sources!.s2).toEqual(src('s2', 'Matrika N 8 Vzorov', { reference: 's. 15, sn. 7', note: 'Signatura: N 8' }));
        expect(DataManager.lastUndoMark()).toBeNull();

        expect(DataManager.redo()).not.toBeNull();
        expect(DataManager.lastUndoMark()).toEqual(mark);
        expect(DataManager.getData().sources!.s1).toMatchObject({ folio: 'fol. 12v', image: '34', reference: 'č. 5' });
    });

    it('is no longer the step to undo once another change follows', () => {
        const plan = localSplitPlan(Object.values(DataManager.getData().sources!));
        DataManager.splitSourcePlaces(plan.changes.map(c => c.source));
        DataManager.createPerson({ firstName: 'Kvido', lastName: 'Pokusný', gender: 'male' });
        expect(DataManager.lastUndoMark()).toBeNull();
    });
});

describe('an example cut for the dialog', () => {
    it('keeps a short one, cuts a long one to 60 characters with "…", never inside a character', () => {
        expect(clipWithEllipsis('Kniha N 7', 60)).toBe('Kniha N 7');
        const emoji = '👨‍👩‍👧'.repeat(70);
        const cut = clipWithEllipsis(emoji, 60);
        expect(cut).toBe(`${'👨‍👩‍👧'.repeat(59)}…`);
        const flags = clipWithEllipsis('🇨🇿'.repeat(61), 60);
        expect(flags).toBe(`${'🇨🇿'.repeat(59)}…`);
        // A letter with a combining mark that has no composed form stays one character.
        const marks = clipWithEllipsis('q\u0303'.repeat(61), 60);
        expect(marks).toBe(`${'q\u0303'.repeat(59)}…`);
        const cjk = clipWithEllipsis('家譜第三巻'.repeat(13), 60);
        expect(Array.from(cjk)).toHaveLength(60);
        expect(cjk.endsWith('…')).toBe(true);
        expect(clipWithEllipsis('é'.repeat(60), 60)).toBe('é'.repeat(60));
    });
});

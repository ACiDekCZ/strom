/**
 * "Add materials" (C2): the rules of a batch — what is left out and why, the
 * research's limits, the rough cost, the default name, the folder tree.
 * Invented paths only.
 */

import { describe, it, expect } from 'vitest';
import {
    batchSkip, batchLimitsOf, batchOverLimit, batchEstimate, batchDefaultName, batchTree, batchFolderFiles,
    batchPathHeader, sanitizeUnfinishedBatch, isZip,
} from '../batch.js';

const MB = 1024 * 1024;

describe('what a batch leaves out', () => {
    it('system files and hidden ones can be ticked back; programs, other archives, too large and trees cannot', () => {
        expect(batchSkip({ path: 'Krabice/.DS_Store', size: 10 }, 500 * MB)).toEqual({ reason: 'system', fixed: false });
        expect(batchSkip({ path: 'Krabice/Thumbs.db', size: 10 }, 500 * MB)).toEqual({ reason: 'system', fixed: false });
        expect(batchSkip({ path: 'Krabice/._foto.jpg', size: 10 }, 500 * MB)).toEqual({ reason: 'system', fixed: false });
        expect(batchSkip({ path: 'Krabice/.skryte/foto.jpg', size: 10 }, 500 * MB)).toEqual({ reason: 'system', fixed: false });
        expect(batchSkip({ path: 'Krabice/hesla.txt', size: 10 }, 500 * MB)).toBeNull();
        expect(batchSkip({ path: 'Krabice/moje-heslo.txt', size: 10 }, 500 * MB)).toEqual({ reason: 'secret', fixed: false });
        expect(batchSkip({ path: 'Krabice/.env', size: 10 }, 500 * MB)).toEqual({ reason: 'secret', fixed: false });
        expect(batchSkip({ path: 'Krabice/id_rsa', size: 10 }, 500 * MB)).toEqual({ reason: 'secret', fixed: false });
        expect(batchSkip({ path: 'Krabice/setup.exe', size: 10 }, 500 * MB)).toEqual({ reason: 'program', fixed: true });
        expect(batchSkip({ path: 'Krabice/stare.rar', size: 10 }, 500 * MB)).toEqual({ reason: 'archive', fixed: true });
        expect(batchSkip({ path: 'Krabice/film.mov', size: 600 * MB }, 500 * MB)).toEqual({ reason: 'tooBig', fixed: true });
        expect(batchSkip({ path: 'Krabice/rodokmen.ged', size: 10 }, 500 * MB)).toEqual({ reason: 'ged', fixed: true });
        expect(batchSkip({ path: 'Krabice/dopis-1946.jpg', size: 2 * MB }, 500 * MB)).toBeNull();
        expect(batchSkip({ path: 'krabice.zip', size: 2 * MB }, 500 * MB)).toBeNull();
        expect(isZip('krabice.ZIP')).toBe(true);
    });
});

describe('limits and cost', () => {
    const accepts = { mediaMaxBytes: 500 * MB, mediaBatch: { files: 5000, bytes: 20 * 1024 * MB, zip: true } };

    it('reads the limits; over them by how much', () => {
        const limits = batchLimitsOf(accepts)!;
        expect(limits).toEqual({ maxFile: 500 * MB, files: 5000, bytes: 20 * 1024 * MB, zip: true });
        expect(batchOverLimit(10, 10 * MB, limits)).toBeNull();
        expect(batchOverLimit(5003, 21 * 1024 * MB, limits)).toEqual({ files: 3, bytes: 1024 * MB });
        expect(batchLimitsOf({ mediaMaxBytes: 1, mediaBatch: null })).toBeNull();
    });

    it('estimates tasks and amount; nothing without rates', () => {
        expect(batchEstimate(214, { filesPerTask: 25, perTask: 1, currency: 'USD' })).toEqual({ tasks: 9, amount: 9, currency: 'USD' });
        expect(batchEstimate(214, null)).toBeNull();
        expect(batchEstimate(0, { filesPerTask: 25, perTask: 1, currency: 'USD' })).toBeNull();
    });
});

describe('the name and the list', () => {
    it('names the batch after the folder or the one ZIP', () => {
        expect(batchDefaultName(['Krabice/a.jpg', 'Krabice/Dopisy/b.jpg'], 'Materials')).toBe('Krabice');
        expect(batchDefaultName(['krabice.zip'], 'Materials')).toBe('krabice');
        expect(batchDefaultName(['a.jpg', 'b.jpg'], 'Materials')).toBe('Materials');
    });

    it('builds the folder tree in name order', () => {
        const paths = ['K/Dopisy/2.jpg', 'K/a.jpg', 'K/Dopisy/1.jpg', 'K/Fotky/x.jpg'];
        const root = batchTree(paths);
        const k = root.folders[0];
        expect(k.name).toBe('K');
        expect(k.folders.map(f => f.name)).toEqual(['Dopisy', 'Fotky']);
        expect(k.folders[0].files.map(i => paths[i])).toEqual(['K/Dopisy/1.jpg', 'K/Dopisy/2.jpg']);
        expect(batchFolderFiles(k).length).toBe(4);
    });

    it('sends relative paths only, each part encoded', () => {
        expect(batchPathHeader('Babička/Dopisy/1946 (1).jpg')).toBe('Babi%C4%8Dka/Dopisy/1946%20(1).jpg');
        expect(batchPathHeader('../etc/passwd')).toBe('etc/passwd');
    });

    it('remembers an unfinished batch by counts only', () => {
        expect(sanitizeUnfinishedBatch({ id: '4f1c0000-aaaa', name: 'Krabice', total: 214, done: 80, bytes: 5, startedAt: 'x' }))
            .toEqual({ id: '4f1c0000-aaaa', name: 'Krabice', total: 214, done: 80, bytes: 5, startedAt: 'x' });
        expect(sanitizeUnfinishedBatch({ id: 'bad id', name: 'x' })).toBeNull();
    });
});

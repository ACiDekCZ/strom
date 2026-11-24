/**
 * Where files dropped onto the window go (spec 134 K10.2): a GEDCOM file and
 * a Strom tree (.json) open the import guide, also for a tree whose research
 * takes batches (a tree is never offered as material); a backup of all trees
 * and a change packet go the JSON import's way; anything else is material
 * for such a research, or refused / unreadable.
 */

import { describe, it, expect } from 'vitest';
import { dragLooksLikeJson, dropRoute, isJsonFileName, jsonDropKind } from '../drop-route.js';

describe('dropRoute', () => {
    it('one .ged or one .json opens the guide, with or without a batch', () => {
        for (const batch of [false, true]) {
            expect(dropRoute(['rodokmen-jilmovi.ged'], { batch })).toBe('guide-ged');
            expect(dropRoute(['RODOKMEN.GED '], { batch })).toBe('guide-ged');
            expect(dropRoute(['strom-jilmovi.json'], { batch })).toBe('json');
            expect(dropRoute(['Strom-Jilmovi.JSON'], { batch })).toBe('json');
        }
    });

    it('anything else goes to the batch when the research takes one', () => {
        expect(dropRoute(['dopis.jpg'], { batch: true })).toBe('batch');
        expect(dropRoute(['a.ged', 'b.ged'], { batch: true })).toBe('batch');
        expect(dropRoute(['strom.json', 'foto.jpg'], { batch: true })).toBe('batch');
    });

    it('without a batch: the first file decides, anything but a tree is refused', () => {
        expect(dropRoute(['dopis.jpg'], { batch: false })).toBe('refuse');
        expect(dropRoute(['poznamky.txt'], { batch: false })).toBe('refuse');
        expect(dropRoute(['a.ged', 'foto.jpg'], { batch: false })).toBe('guide-ged');
        expect(dropRoute(['strom.json', 'foto.jpg'], { batch: false })).toBe('json');
        expect(dropRoute([], { batch: false })).toBe('none');
        expect(dropRoute([], { batch: true })).toBe('none');
    });

    it('isJsonFileName', () => {
        expect(isJsonFileName('a.json')).toBe(true);
        expect(isJsonFileName('a.json.txt')).toBe(false);
        expect(isJsonFileName(undefined)).toBe(false);
    });
});

describe('jsonDropKind', () => {
    it('a tree, also an empty one, and an encrypted file are trees for the guide', () => {
        expect(jsonDropKind({ version: 26, persons: { p1: { id: 'p1' } }, partnerships: {} })).toBe('tree');
        expect(jsonDropKind({ persons: {}, partnerships: {} })).toBe('tree');
        expect(jsonDropKind({ encrypted: true, version: 1, salt: 's', iv: 'i', data: 'd' })).toBe('tree');
    });

    it('an "Export all" backup and a change packet go the JSON import\'s way', () => {
        expect(jsonDropKind({ t1: { name: 'Jilmovi', data: { persons: {}, partnerships: {} } } })).toBe('app-file');
        expect(jsonDropKind({ kind: 'strom-changes', formatVersion: 2, baseExportId: 'x' })).toBe('app-file');
    });

    it('anything else is no file of the app', () => {
        for (const v of [undefined, null, 1, 'text', [], {}, { persons: [] }, { notes: 'x' }]) expect(jsonDropKind(v)).toBe('other');
    });
});

describe('dragLooksLikeJson', () => {
    it('only one file of type JSON while dragging', () => {
        expect(dragLooksLikeJson([{ kind: 'file', type: 'application/json' }])).toBe(true);
        expect(dragLooksLikeJson([{ kind: 'file', type: 'Application/JSON' }])).toBe(true);
        expect(dragLooksLikeJson([{ kind: 'file', type: '' }])).toBe(false);
        expect(dragLooksLikeJson([{ kind: 'file', type: 'application/json' }, { kind: 'file', type: 'image/jpeg' }])).toBe(false);
        expect(dragLooksLikeJson([{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'application/json' }])).toBe(true);
        expect(dragLooksLikeJson(null)).toBe(false);
    });
});

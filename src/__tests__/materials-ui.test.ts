/**
 * Materials at the person (spec 017 U5, E2): the fast per-person counter of
 * cards and menus, the remembered material capabilities, the disconnect note
 * and forgetting the tree's list, the short dates of the rows, and which
 * files "Also keep in the tree" takes. Invented data.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Attachment } from '../types.js';
import { setLanguage } from '../strings.js';
import {
    MaterialFile, MaterialList, personMaterials, materialCounter,
    setMaterialsBackend, memoryMaterialsBackend, saveMaterialList, cachedMaterialList, primeMaterials,
} from '../materials.js';
import {
    rememberedMaterialFeatures, rememberMaterialFeatures, forgetMaterialFeatures,
    shownFileCount, materialsDisconnectNote, forgetTreeMaterials, materialShortDate, materialsMethods, MaterialsContext,
} from '../ui/materials-ui.js';
import { MaterialItem } from '../materials.js';
import { alsoTreeEligible } from '../ui/material-ui.js';

const sha = (n: number) => n.toString(16).padStart(64, '0');

function file(n: number, init: Partial<MaterialFile> = {}): MaterialFile {
    return { id: `I${String(n).padStart(4, '0')}`, name: `scan-${n}.jpg`, sha: sha(n), mime: 'image/jpeg', persons: [], ...init };
}

function list(files: MaterialFile[], extra: Partial<MaterialList> = {}): MaterialList {
    return { files, batches: [], people: {}, fetchedAt: 1, ...extra };
}

function att(id: string, init: Partial<Attachment> = {}): Attachment {
    return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AA==', sizeBytes: 10, ...init };
}

function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: k => m.get(k) ?? null,
        key: i => [...m.keys()][i] ?? null,
        removeItem: k => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

describe('materials counter', () => {
    it('counts what the person section shows: joined attachments once, hidden files and foreign files not', () => {
        const joined = att('a1', { original: { sha256: sha(1).toUpperCase(), name: 'x.jpg', mimeType: 'image/jpeg', bytes: 5 } });
        const l = list([
            file(1, { persons: ['P0001'] }),
            file(2, { persons: ['P0001'], hidden: {} }),
            file(3, { batch: 'b1' }),
            file(4, { persons: ['P0002'] }),
            file(5, { sorted: { persons: ['P0001'] } }),
        ], { batches: [{ id: 'b1', name: 'Box', files: 1, persons: ['P0001'] }] });
        const people = [
            { refn: 'P0001', attachments: [joined, att('a2')] },
            { refn: 'P0002', attachments: [] },
            { refn: undefined, attachments: [att('a3'), att('a4')] },
            { refn: 'P0009', attachments: [att('a5')] },
        ];
        const count = materialCounter(l);
        for (const p of people) expect(count(p)).toBe(personMaterials(p, l).length);
        expect(count(people[0])).toBe(4);
    });

    it('without a list counts the attachments', () => {
        expect(materialCounter(null)({ refn: 'P0001', attachments: [att('a')] })).toBe(1);
    });
});

describe('remembered material capabilities', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

    it('keeps only the material capabilities and says whether they changed', () => {
        expect(rememberedMaterialFeatures('r1')).toBeNull();
        expect(rememberMaterialFeatures('r1', ['media', 'material.list', 'material.thumb'])).toBe(true);
        expect(rememberedMaterialFeatures('r1')).toEqual(['material.list', 'material.thumb']);
        expect(rememberMaterialFeatures('r1', ['material.thumb', 'material.list', 'batch'])).toBe(false);
        expect(rememberMaterialFeatures('r1', ['material.list'])).toBe(true);
        forgetMaterialFeatures('r1');
        expect(rememberedMaterialFeatures('r1')).toBeNull();
    });

    it('ignores what is not a list of names', () => {
        localStorage.setItem('strom-material-features:r2', '{"material.list":true}');
        expect(rememberedMaterialFeatures('r2')).toBeNull();
        localStorage.setItem('strom-material-features:r2', '["material.list", 3, "evil"]');
        expect(rememberedMaterialFeatures('r2')).toEqual(['material.list']);
    });
});

describe('disconnecting', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
        setMaterialsBackend(memoryMaterialsBackend());
        setLanguage('en');
    });

    it('counts shown files only', () => {
        expect(shownFileCount(null)).toBe(0);
        expect(shownFileCount(list([file(1), file(2, { hidden: {} }), file(3)]))).toBe(2);
    });

    it('adds the note only when the remembered list has files, worded by research kind', async () => {
        expect(await materialsDisconnectNote('t1', false)).toBeNull();
        await saveMaterialList('t1', list([file(1), file(2), file(3, { hidden: {} })]), { kind: 'all' });
        expect(await materialsDisconnectNote('t1', false)).toContain('Strom archive (2)');
        expect(await materialsDisconnectNote('t1', true)).toContain('research (2)');
    });

    it('forgets the list and the capabilities, the attachments are not touched', async () => {
        rememberMaterialFeatures('r1', ['material.list']);
        await saveMaterialList('t1', list([file(1)]), { kind: 'all' });
        await forgetTreeMaterials('t1', 'r1');
        await primeMaterials('t1');
        expect(cachedMaterialList('t1')).toBeNull();
        expect(rememberedMaterialFeatures('r1')).toBeNull();
        expect(await materialsDisconnectNote('t1', true)).toBeNull();
    });
});

describe('rows', () => {
    it('short date: without the year this year, with it otherwise, empty when unknown', () => {
        setLanguage('cs');
        const now = new Date(2026, 9, 23);
        expect(materialShortDate('2026-10-01T10:00:00', now)).toBe('1. 10.');
        expect(materialShortDate('2025-03-04T10:00:00', now)).toBe('4. 3. 2025');
        expect(materialShortDate(undefined, now)).toBe('');
        expect(materialShortDate('not a date', now)).toBe('');
        setLanguage('en');
    });

    it("a sender's note is quoted with the UI language's own marks (no Czech „…“ in English)", () => {
        const item: MaterialItem = {
            key: 'm:I0001', origin: 'archive', title: 'Letter from an aunt', persons: ['P0001'], viaBatch: [],
            noteUser: 'From the attic box', here: true,
        };
        const ctx = { treeId: 't1', researchId: 'r1', base: null, agent: true } as unknown as MaterialsContext;
        const note = (lang: 'en' | 'cs' | 'de') => {
            setLanguage(lang);
            const html = materialsMethods.materialRowHtml.call({} as never, item, ctx, null, false);
            return /<span class="material-note">([^<]*)<\/span>/.exec(html)?.[1];
        };
        expect(note('en')).toBe('\u201cFrom the attic box\u201d');
        expect(note('cs')).toBe('\u201eFrom the attic box\u201c');
        expect(note('de')).toBe('\u201eFrom the attic box\u201c');
        setLanguage('en');
    });
});

describe('Also keep in the tree', () => {
    it('takes images and PDFs up to 2 MB', () => {
        expect(alsoTreeEligible({ type: 'image/jpeg', size: 100 })).toBe(true);
        expect(alsoTreeEligible({ type: 'image/png', size: 2 * 1024 * 1024 })).toBe(true);
        expect(alsoTreeEligible({ type: 'application/pdf', size: 2 * 1024 * 1024 + 1 })).toBe(false);
        expect(alsoTreeEligible({ type: 'image/tiff', size: 100 })).toBe(false);
        expect(alsoTreeEligible({ type: 'text/plain', size: 10 })).toBe(false);
    });
});

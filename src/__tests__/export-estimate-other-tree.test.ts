/**
 * The export dialog opened from the tree manager for a tree that is not the
 * open one: the size estimate and the privacy note are the exported tree's,
 * never the open tree's. Tree A (open) has a large photo and no sources;
 * tree B (exported) is small and cites a source. Invented data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StromData, TreeId } from '../types.js';
import { DataManager, storedTreeForExport } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { encryptionUiMethods } from '../ui/encryption-ui.js';

const A = 'tree-a' as TreeId;
const B = 'tree-b' as TreeId;

const person = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
    id, firstName, lastName: 'Sliva', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
});
const treeA = (): StromData => ({
    persons: { a1: person('a1', 'Bedrich', { birthDate: '1950', photo: 'data:image/jpeg;base64,' + 'C'.repeat(90000) }) },
    partnerships: {},
} as unknown as StromData);
const treeB = (): StromData => ({
    persons: { b1: person('b1', 'Orvald', { birthDate: '1801', deathDate: '1870', sourceIds: ['s1'] }) },
    partnerships: {},
    sources: { s1: { id: 's1', title: 'Baptism of Orvald 1801', reference: 'fol. 3' } },
} as unknown as StromData);

/** The few dialog elements the estimate and the note use. */
function fakeDialog(privacy: string) {
    const el = (extra: Record<string, unknown> = {}) => ({
        textContent: '', hidden: true, disabled: false, checked: true, value: '', style: { display: '' },
        setAttribute() {}, removeAttribute() {}, closest: () => null, ...extra,
    });
    const els: Record<string, ReturnType<typeof el>> = {
        'export-content-section': el(),
        'export-content-size': el(),
        'export-privacy-mode': el({ value: privacy }),
        'export-privacy-drops': el(),
        'export-content-privacy-note': el(),
        'export-content-photos': el(),
        'export-content-attachments': el(),
        'export-content-notes': el(),
        'export-content-sources': el(),
    };
    vi.stubGlobal('document', { getElementById: (id: string) => els[id] ?? null });
    return els;
}

function dialogUi() {
    return {
        ...encryptionUiMethods,
        exportContentSizes: null,
        exportSourceImagesOption: () => undefined,
        exportSourceImagesBytes: () => null,
    } as unknown as typeof encryptionUiMethods & { exportContentSizes: { photos: number } | null };
}

describe('export dialog estimate for a tree that is not the open one', () => {
    beforeEach(() => {
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(A);
        vi.spyOn(DataManager, 'getData').mockImplementation(() => treeA());
        vi.spyOn(TreeManager, 'getTreeData').mockImplementation(async (id: TreeId) => (id === B ? treeB() : id === A ? treeA() : null));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** What the dialog says for tree B when B itself is the open tree (as loaded: migrated, versioned). */
    async function ownEstimate(privacy: string): Promise<{ size: string; note: boolean }> {
        const loaded = (await storedTreeForExport(B))!;
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(B);
        vi.spyOn(DataManager, 'getData').mockImplementation(() => loaded);
        const els = fakeDialog(privacy);
        const ui = dialogUi();
        void ui.setExportMeasuredTree(B);
        ui.syncExportPrivacyEffects();
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(A);
        vi.spyOn(DataManager, 'getData').mockImplementation(() => treeA());
        return { size: els['export-content-size'].textContent, note: !els['export-privacy-drops'].hidden };
    }

    it('tree B exported while tree A is open: the estimate and the note are B\'s', async () => {
        for (const privacy of ['full', 'initials']) {
            const own = await ownEstimate(privacy);
            const els = fakeDialog(privacy);
            const ui = dialogUi();
            const read = ui.setExportMeasuredTree(B);
            ui.syncExportPrivacyEffects();
            // Not read yet: no estimate at all, never the open tree's.
            expect(els['export-content-size'].textContent).toBe('');
            await read;
            expect(els['export-content-size'].textContent).toBe(own.size);
            expect(ui.exportContentSizes?.photos).toBe(0);
            // B cites a source (A does not): a privacy mode says it leaves sources out.
            expect(!els['export-privacy-drops'].hidden).toBe(privacy !== 'full');
            expect(own.note).toBe(privacy !== 'full');
        }
    });

    it('the open tree exported: measured at once from the open data', () => {
        const els = fakeDialog('full');
        const ui = dialogUi();
        void ui.setExportMeasuredTree(A);
        ui.syncExportPrivacyEffects();
        expect(ui.exportContentSizes?.photos).toBeGreaterThan(60000);
        expect(els['export-content-size'].textContent).not.toBe('');
        expect(els['export-privacy-drops'].hidden).toBe(true);
    });
});

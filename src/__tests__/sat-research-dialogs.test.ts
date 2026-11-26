/**
 * The research dialogs that need the bridge's address, in a window of its
 * own (a tree's satellite: the main window's bridge state mirrored, no
 * address of it there). The Materials window, "Send material…", a reading
 * and "Read again…" open in the main window (`research-dialog`, the main
 * window coming forward); a source's confirmation, the reading's choices,
 * the held images' loading, the duplicate verdicts and the surname
 * suggestions are not offered there, never said as "not running". One check
 * says where the bridge is: `bridgeHereOrMain`. With the main window closed,
 * and in the main window itself, as before. Invented data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const RID = 'r-dlg-0522';
const TREE = 'tree-dlg';
const BRIDGE = 'http://127.0.0.1:47219';

type Methods = Record<string, (...args: unknown[]) => unknown>;
type Fn = ReturnType<typeof vi.fn>;

/** One window of the app: its own modules (a page), the dialogs' methods and fakes of the rest of the UI. */
async function page(opts: { satellite: boolean; mainOpen?: boolean; features?: string[] }) {
    vi.resetModules();
    const device = await import('../research-device.js');
    device.setBridgelessWindow(opts.satellite);
    const { DataManager } = await import('../data.js');
    const { TreeManager } = await import('../tree-manager.js');
    const { StorageManager } = await import('../storage.js');
    const { SettingsManager } = await import('../settings.js');
    vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
    vi.spyOn(DataManager, 'isReadOnly').mockReturnValue(false);
    vi.spyOn(DataManager, 'isTreeLocked').mockReturnValue(false);
    vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE as never);
    vi.spyOn(DataManager, 'getPerson').mockImplementation(((id: string) => id === 'p-0418' ? { id, refn: 'I418', firstName: 'Vendelín', lastName: 'Fíšek' } : undefined) as never);
    vi.spyOn(DataManager, 'getData').mockReturnValue({ persons: {}, sources: { 's-77': { id: 's-77', refn: 'S77', transcript: 'Liber natorum 1841', reading: '' } } } as never);
    vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({ name: 'Fíšek', research: { id: RID } } as never);
    const sat = await import('../windows/window-sat-research.js');
    const main = await import('../ui/sat-research-main.js');
    const forward = { mainOpen: vi.fn(() => opts.mainOpen ?? true), run: vi.fn(), ask: vi.fn() };
    if (opts.satellite) sat.setSatResearchForward(forward);
    const load = async <T>(path: string, name: string): Promise<T> => (await import(path) as Record<string, T>)[name];
    const ui = Object.assign({},
        await load<Methods>('../ui/materials-ui.js', 'materialsMethods'),
        await load<Methods>('../ui/material-ui.js', 'materialMethods'),
        await load<Methods>('../ui/originals-ui.js', 'originalsMethods'),
        await load<Methods>('../ui/read-document-ui.js', 'readDocumentMethods'),
        await load<Methods>('../ui/read-source-ui.js', 'readSourceMethods'),
        await load<Methods>('../ui/source-confirm-ui.js', 'sourceConfirmMethods'),
        await load<Methods>('../ui/research-images-ui.js', 'researchImagesMethods'),
        await load<Methods>('../ui/duplicate-verdicts-ui.js', 'duplicateVerdictsMethods'),
        await load<Methods>('../ui/surname-suggest-ui.js', 'surnameSuggestMethods'),
        {
            researchSyncLink: vi.fn(() => ({ treeId: TREE, link: { id: RID } })),
            researchOriginalsLink: vi.fn(() => ({ treeId: TREE, researchId: RID })),
            researchBridgeUp: vi.fn(() => true),
            researchBridgeFresh: vi.fn(() => true),
            researchStatusOf: vi.fn(() => ({ features: opts.features ?? [] })),
            researchAcceptsOf: vi.fn(() => ({ media: true, mediaMaxBytes: 50_000_000, mediaRegion: false })),
            researchAgentlessFor: vi.fn(() => false),
            activeResearchAgentless: vi.fn(() => false),
            researchWriteHeldNow: vi.fn(() => null),
            researchStartUrl: vi.fn(() => null),
            closeActionsMenu: vi.fn(),
            hideContextMenu: vi.fn(),
            isResearchMenuOpen: vi.fn(() => false),
            closeResearchMenu: vi.fn(),
            closeMaterialsItemMenu: vi.fn(),
            showToast: vi.fn(),
            researchOriginalsKick: vi.fn(async () => undefined),
            sendOneOriginal: vi.fn(async () => 'sent'),
            researchJudgedDuplicates: vi.fn(async () => true),
            redrawDuplicateVerdicts: vi.fn(),
            escapeHtml: (s: string) => s,
        }) as unknown as Methods & Record<string, Fn>;
    return { ui, sat, main, forward, StorageManager, SettingsManager };
}

function stubBrowser(elements: Record<string, unknown> = {}, selectors: Record<string, unknown> = {}): void {
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => (k === `strom-research-bridge:${RID}` ? JSON.stringify({ base: BRIDGE }) : null),
        setItem: () => undefined, removeItem: () => undefined,
    });
    vi.stubGlobal('document', {
        activeElement: null, body: { appendChild: () => undefined },
        getElementById: (id: string) => elements[id] ?? null,
        querySelector: (sel: string) => selectors[sel] ?? null,
        querySelectorAll: () => [],
        createElement: () => { throw new Error('built here'); },
        addEventListener: () => undefined, removeEventListener: () => undefined,
    });
}

describe('research dialogs that need the bridge address, in a satellite window', { timeout: 60_000 }, () => {
    beforeEach(() => stubBrowser());

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('where the bridge is (bridgeHereOrMain)', () => {
        it('here with an address, through the main window in a satellite whose main window is open, else down', async () => {
            const satWin = await page({ satellite: true });
            expect(satWin.sat.bridgeHereOrMain(true, null)).toBe('main');
            expect(satWin.sat.bridgeHereOrMain(false, null)).toBe('down');
            expect(satWin.sat.bridgeHereOrMain(true, BRIDGE)).toBe('here');
            const closed = await page({ satellite: true, mainOpen: false });
            expect(closed.sat.bridgeHereOrMain(true, null)).toBe('down');
            const mainWin = await page({ satellite: false });
            expect(mainWin.sat.bridgeHereOrMain(true, null)).toBe('down');
            expect(mainWin.sat.bridgeHereOrMain(true, BRIDGE)).toBe('here');
        });
    });

    describe('the send path of material and originals in a satellite (audit §3: waits or fails)', () => {
        const original = { sha256: 'c'.repeat(64), name: 'matrika-1841.jpg', mimeType: 'image/jpeg', bytes: 4 };

        it('waits: with no address of the bridge the file goes into the device\'s queue, which the main window sends', async () => {
            const satWin = await page({ satellite: true });
            const set = vi.spyOn(satWin.StorageManager, 'set').mockResolvedValue(undefined as never);
            vi.spyOn(satWin.StorageManager, 'getAll').mockResolvedValue([] as never);
            vi.spyOn(satWin.SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
            const outcome = await satWin.ui.queueOriginal(original, new Blob(['scan']), { personId: 'p-0418', material: true });
            expect(outcome).toBe('queued');
            expect(set).toHaveBeenCalledWith('originals', expect.any(String), expect.objectContaining({ sha256: original.sha256, sendAnyway: true }));
            expect(satWin.ui.sendOneOriginal).not.toHaveBeenCalled();
        });

        it('fails for an encrypted tree: never kept in the browser, and no bridge here to send it to', async () => {
            const satWin = await page({ satellite: true });
            vi.spyOn(satWin.StorageManager, 'getAll').mockResolvedValue([] as never);
            vi.spyOn(satWin.SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
            const outcome = await satWin.ui.queueOriginal(original, new Blob(['scan']), { personId: 'p-0418', material: true });
            expect(outcome).toBe('encrypted');
            expect(satWin.ui.sendOneOriginal).not.toHaveBeenCalled();
        });
    });

    describe('dialogs opened in the main window (research-dialog)', () => {
        it('the Materials window of a research archive opens in the main window, which comes forward', async () => {
            const satWin = await page({ satellite: true, features: ['material.list'] });
            satWin.ui.openMaterials({ person: 'I418', group: 'date' });
            expect(satWin.forward.run).toHaveBeenCalledWith('research-dialog', { dialog: 'materials', person: 'I418', group: 'date' }, true);
        });

        it('a research file of the person\'s section opens in the main window\'s Materials, never "opens once the research runs"', async () => {
            const satWin = await page({ satellite: true, features: ['material.list'] });
            satWin.ui.openMaterial({ key: 'm:I1', origin: 'archive', title: 'Matrika', name: 'matrika.pdf', titled: false,
                file: { id: 'I1', sha: 'd'.repeat(64), name: 'matrika.pdf', mime: 'application/pdf', persons: ['I418'] } });
            expect(satWin.forward.run).toHaveBeenCalledWith('research-dialog', { dialog: 'materials', person: 'I418' }, true);
            expect(satWin.ui.showToast).not.toHaveBeenCalled();
        });

        it('"Send material…" opens in the main window', async () => {
            const satWin = await page({ satellite: true });
            satWin.ui.showMaterialDialog({ personId: 'p-0418' });
            expect(satWin.forward.run).toHaveBeenCalledWith('research-dialog', { dialog: 'material', personId: 'p-0418' }, true);
        });

        it('a reading\'s result, a source\'s reading and "Read again…" open in the main window; dropped files stay here', async () => {
            const satWin = await page({ satellite: true });
            satWin.ui.showReadDocumentDialog({ readId: 'R-20261120-1' });
            satWin.ui.showReadDocumentDialog({ sourceId: 's-77' });
            satWin.ui.showReadSourceAgain('s-77', 'clip-2');
            expect(satWin.forward.run.mock.calls).toEqual([
                ['research-dialog', { dialog: 'read', readId: 'R-20261120-1' }, true],
                ['research-dialog', { dialog: 'read', sourceId: 's-77' }, true],
                ['research-dialog', { dialog: 'read-again', sourceId: 's-77', clip: 'clip-2' }, true],
            ]);
            satWin.forward.run.mockClear();
            try { satWin.ui.showReadDocumentDialog({ files: [new Blob(['x'])] }); } catch { /* built here */ }
            expect(satWin.forward.run).not.toHaveBeenCalled();
        });

        it('with the main window closed, the Materials window and "Send material…" are built here as before', async () => {
            const satWin = await page({ satellite: true, mainOpen: false, features: ['material.list'] });
            expect(() => satWin.ui.openMaterials({ person: 'I418' })).toThrow('built here');
            satWin.ui.materialAvailable = vi.fn(() => true);
            satWin.ui.closeMaterialDialog = vi.fn(() => undefined);
            expect(() => satWin.ui.showMaterialDialog({ personId: 'p-0418' })).toThrow('built here');
            expect(satWin.forward.run).not.toHaveBeenCalled();
        });

        it('the main window opens each dialog from its arguments, and runs nothing malformed', async () => {
            const mainWin = await page({ satellite: false });
            const deps = {
                openMaterials: vi.fn(), showMaterialDialog: vi.fn(), showReadDocumentDialog: vi.fn(), showReadSourceAgain: vi.fn(),
            };
            mainWin.main.registerSatelliteResearchActions(deps as never);
            const run = (args: unknown) => mainWin.sat.runMainResearchAction('research-dialog', args);
            expect(run({ dialog: 'materials', batch: 'B-2026-11-20' }).handled).toBe(true);
            run({ dialog: 'material', sourceId: 's-77' });
            run({ dialog: 'read' });
            run({ dialog: 'read', personId: 'p-0418' });
            run({ dialog: 'read-again', sourceId: 's-77', clip: '' });
            expect(deps.openMaterials).toHaveBeenCalledWith({ batch: 'B-2026-11-20' });
            expect(deps.showMaterialDialog).toHaveBeenCalledWith({ sourceId: 's-77' });
            expect(deps.showReadDocumentDialog.mock.calls).toEqual([[{}], [{ personId: 'p-0418' }]]);
            expect(deps.showReadSourceAgain).toHaveBeenCalledWith('s-77', '');
            for (const bad of [
                { dialog: 'materials', group: 'size' }, { dialog: 'materials', person: 'I418', extra: 1 },
                { dialog: 'material', personId: 'p-0418', sourceId: 's-77' }, { dialog: 'material' },
                { dialog: 'read', readId: 'R-1', sourceId: 's-77' }, { dialog: 'read', readId: 'a b' },
                { dialog: 'read-again', sourceId: 's-77' }, { dialog: 'settings' }, null, 'materials',
            ]) expect(run(bad).result, JSON.stringify(bad)).toBeUndefined();
            expect(deps.openMaterials).toHaveBeenCalledTimes(1);
            expect(deps.showMaterialDialog).toHaveBeenCalledTimes(1);
            expect(deps.showReadDocumentDialog).toHaveBeenCalledTimes(2);
            expect(deps.showReadSourceAgain).toHaveBeenCalledTimes(1);
        });
    });

    describe('research controls not offered in a satellite (no "not running")', () => {
        const confirmState = { read: 'research', txt: 'Liber natorum 1841', conf: false } as never;

        it('a source\'s confirmation is not offered; with the main window closed it rests as before', async () => {
            const satWin = await page({ satellite: true, features: ['sources.confirm'] });
            expect(satWin.ui.sourceConfirmOfferFor({ id: 's-77', refn: 'S77', transcript: 'Liber natorum 1841' }, confirmState)).toEqual({ kind: 'none' });
            const closed = await page({ satellite: true, mainOpen: false, features: ['sources.confirm'] });
            expect(closed.ui.sourceConfirmOfferFor({ id: 's-77', refn: 'S77', transcript: 'Liber natorum 1841' }, confirmState)).toMatchObject({ kind: 'rest' });
        });

        it('the reading\'s choices are not offered in a satellite; the main window with its bridge offers them', async () => {
            const satWin = await page({ satellite: true, features: ['read.sourceTask'] });
            satWin.ui.readSourceSaidState = vi.fn(() => null);
            expect(satWin.ui.readSourceStateCtx({ id: 's-77', refn: 'S77' })).toMatchObject({ refn: 'S77', up: false });
            const mainWin = await page({ satellite: false, features: ['read.sourceTask'] });
            mainWin.ui.readSourceSaidState = vi.fn(() => null);
            expect(mainWin.ui.readSourceStateCtx({ id: 's-77', refn: 'S77' })).toMatchObject({ refn: 'S77', up: true });
        });

        it('held images load nowhere here and are not said to wait for the research to run', async () => {
            const satWin = await page({ satellite: true, features: ['sources.excerpts'] });
            expect(satWin.ui.researchImagesEnv()).toMatchObject({ mode: 'bridgeOff', viaMain: true });
            const closed = await page({ satellite: true, mainOpen: false });
            expect(closed.ui.researchImagesEnv()).toMatchObject({ mode: 'bridgeOff', viaMain: false });
        });

        it('the duplicate verdicts are not asked for nor noted in a satellite', async () => {
            const satWin = await page({ satellite: true, features: ['duplicates.judge'] });
            await satWin.ui.startDuplicateVerdicts(TREE, { persons: {} }, []);
            expect(satWin.ui.researchJudgedDuplicates).not.toHaveBeenCalled();
            expect(satWin.ui.redrawDuplicateVerdicts).toHaveBeenCalledWith(TREE);
        });

        it('the surname suggestions are not shown in a satellite; the main window shows them', async () => {
            const box = { hidden: false, innerHTML: '' };
            const toggles: [string, boolean][] = [];
            const modal = { classList: { toggle: (c: string, on: boolean) => { toggles.push([c, on]); } } };
            stubBrowser({ 'surnames-suggest': box }, { '#surnames-modal .surnames-modal': modal });
            const satWin = await page({ satellite: true });
            satWin.ui.noteSurnamesStatus(RID, { features: ['surnames.suggest'] });
            satWin.ui.renderSurnameSuggest();
            expect(box.hidden).toBe(true);
            expect(toggles).toContainEqual(['is-suggest', false]);
            toggles.length = 0;
            const mainWin = await page({ satellite: false });
            mainWin.ui.noteSurnamesStatus(RID, { features: ['surnames.suggest'] });
            try { mainWin.ui.renderSurnameSuggest(); } catch { /* the rest of the part needs the whole page */ }
            expect(box.hidden).toBe(false);
            expect(toggles).toContainEqual(['is-suggest', true]);
        });
    });
});

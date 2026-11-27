import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialSha, MATERIAL_FEATURES, openResearch, poll, researchGed, HEAD, UUID, BRIDGE,
    FakeBridge, FakeMaterial, FakeMaterialFile,
} from './research-bridge.js';
import { seedResearchPromoSeen, seedSetting, seedWhatsNewSeen } from './helpers.js';

/**
 * Sorting that never offers the same again (spec 147, the diagnosis of 27 Nov):
 * accepting a proposal for a file the tree has too writes the research as well
 * (`/material/edit`, `/material/assign`), so the list has its person and the
 * next sorting leaves it; "Link to…" of such a file assigns the person in the
 * research too; a row accepted or rejected is kept (`…/decided`) and never
 * offered again; a tree followed live writes the research's part through the
 * bridge instead of "not written"; a sorting done reads the list again.
 * Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };
const FEATURES = [...MATERIAL_FEATURES, 'material.edit', 'material.sort', 'material.decided'];
const BATCH = { id: 'b-12345678', name: 'Krabice od babičky', at: '2026-11-10T09:00:00Z' };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const win = (page: Page) => page.locator('#materials-modal');
const strip = (page: Page) => win(page).locator('.mw-sort--top');
const sortDialog = (page: Page) => page.locator('.mdlg--sort');
const proposal = (page: Page) => page.locator('#material-sort-proposal');
const row = (page: Page, id: string) => proposal(page).locator(`.msp-row[data-id="${id}"]`);
const toast = (page: Page) => page.locator('body > .undo-toast.show .undo-toast-msg, .toast.show, .toast-container .toast').first();

const files = (): FakeMaterialFile[] => [1, 2, 3].map(n => materialFile(n, { batch: BATCH.id }));

/** I0001 is a file of the tree too (at Jan), I0002 only the research's; the agent proposes both, I0003 nothing. */
const PROPOSALS = [
    { id: 'I0001', title: 'Wedding 1924', kind: 'photo', links: [{ type: 'person', ref: 'P0001' }], why: 'A veil and a bouquet', sure: 'high' },
    { id: 'I0002', title: 'At the well', links: [{ type: 'person', ref: 'P0002' }], why: 'A well', sure: 'low' },
];

async function useBridge(page: Page, material: FakeMaterial, ged: string): Promise<FakeBridge> {
    return fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: FEATURES, material, treeGed: ged });
}

/** A tree of its own beside the research, I0001's original attached to Jan. */
async function setup(page: Page): Promise<{ material: FakeMaterial; bridge: FakeBridge }> {
    const material = fakeMaterial({ files: files(), batches: [BATCH], people: PEOPLE, sortProposals: PROPOSALS });
    const bridge = await useBridge(page, material, researchGed());
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await page.evaluate(({ px, sha }) => {
        const dm = window.Strom.DataManager;
        const jan = (Object.values(dm.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id;
        dm.addAttachment(jan as never, { name: 'scan-1.jpg', mimeType: 'image/png', dataUrl: px, sizeBytes: 70,
            original: { sha256: sha, name: 'scan-1.jpg', mimeType: 'image/jpeg', bytes: 400_001 } } as never);
    }, { px: PX, sha: materialSha('I0001') });
    await poll(page);
    return { material, bridge };
}

async function openWindow(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await expect(win(page).locator('.mw-canvas .mw-tile').first()).toBeVisible();
}

async function sortAndOpen(page: Page): Promise<void> {
    await strip(page).locator('[data-sort="sort"]').click();
    await sortDialog(page).locator('.mdlg-sort-go').click();
    await expect(strip(page)).toHaveAttribute('data-state', 'D');
    await strip(page).locator('[data-sort="open"]').click();
    await expect(proposal(page)).toBeVisible();
}

const materialGets = (b: FakeBridge) => (b.seen ?? []).filter(x => /^GET \/material(\?|$)/.test(x)).length;

test.describe('Sorting that never offers the same again (spec 147)', () => {
    test.use({ viewport: DESKTOP });

    test('a tree\'s file the research keeps: accepted, its title and person go to the research too; decided rows are kept and not offered again; done reads the list again', async ({ page }) => {
        const { material, bridge } = await setup(page);
        await openWindow(page);
        // The tree's file at Jan has a person: never "without a person" in the count.
        await expect(strip(page).locator('.mw-sort-text')).toHaveText('3 files without title or person');
        const before = materialGets(bridge);
        await sortAndOpen(page);
        // K5: the sorting done, the list is read again (its result at once, not after a reload).
        await expect.poll(() => materialGets(bridge)).toBeGreaterThan(before);

        // K2: rejected is kept for good; Undo makes it open again, rejected once more.
        await row(page, 'I0002').locator('.msp-reject').click();
        await expect.poll(() => material.decisions ?? []).toEqual([expect.objectContaining({ ids: ['I0002'], how: 'refused' })]);

        // K3: the tree's file accepted writes the research as well.
        await row(page, 'I0001').locator('.msp-accept').click();
        await expect.poll(() => JSON.stringify(material.edits ?? [])).toContain('Wedding 1924');
        expect(material.edits![0]).toMatchObject({ ids: ['I0001'], title: 'Wedding 1924' });
        await expect.poll(() => material.assigns).toEqual([expect.objectContaining({ files: ['I0001'], add: ['P0001'] })]);
        await expect.poll(() => (material.decisions ?? []).map(d => d.how)).toEqual(['refused', 'accepted']);
        expect(material.decisions![1]).toMatchObject({ ids: ['I0001'] });
        // The tree has it too, as before.
        await expect.poll(() => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().media ?? {}) as { title?: string }[]).map(a => a.title)))
            .toEqual(['Wedding 1924']);

        // Closed: nothing decided is offered again (K1, K2): the agent's unassigned I0003 is left too, so nothing to sort.
        await proposal(page).locator('.msp-close').click();
        await expect(proposal(page)).toHaveCount(0);
        await expect(strip(page).locator('[data-sort="next"]')).toHaveCount(0);
        await expect(strip(page)).not.toContainText('Not assigned by the agent');
        // At once, the rejected file says so, never "Not assigned by the agent" (K6); the agent's unassigned one keeps its tag.
        await expect(win(page).locator('.mw-tile[data-key="m:I0002"] [data-tag]')).toHaveText('Proposal rejected');
        await expect(win(page).locator('.mw-tile[data-key="m:I0003"] [data-tag]')).toHaveText('Not assigned by the agent');
    });

    test('Link to… a tree\'s file the research keeps assigns the person in the research too', async ({ page }) => {
        const { material } = await setup(page);
        await openWindow(page);
        await win(page).locator('.mw-canvas .mw-tile', { hasText: 'scan-1.jpg' }).click();
        const panel = page.locator('#image-viewer-panel');
        await panel.locator('.mv-act[data-action="attach"]').click();
        const dialog = page.locator('.mdlg-overlay .mdlg');
        await dialog.locator('.ppm-row', { hasText: 'Anna Svobodová' }).click();
        await dialog.locator('.mdlg-foot .mdlg-btn.is-primary').click();
        await expect(dialog).toHaveCount(0);
        // Before the fix only the tree had it; the research's list kept the file "Without a person".
        await expect.poll(() => material.assigns).toEqual([expect.objectContaining({ files: ['I0001'], add: ['P0002'] })]);
    });
});

/** The research followed from its bridge (`?live=`), its tree's file I0001 at Jan. */
async function followLive(page: Page, material: FakeMaterial): Promise<FakeBridge> {
    await page.addInitScript(() => {
        class FakeEventSource {
            url: string;
            readyState = 1;
            onerror: ((e: Event) => void) | null = null;
            private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
            constructor(url: string) {
                this.url = url;
                void fetch(url.replace(/\/events(\?.*)?$/, '/status')).then(r => r.json()).then(st => this.emit('hello', st));
            }
            addEventListener(type: string, fn: (e: MessageEvent) => void): void { (this.listeners[type] ??= []).push(fn); }
            removeEventListener(): void { /* not needed */ }
            close(): void { this.readyState = 2; }
            emit(type: string, data: unknown): void {
                for (const fn of this.listeners[type] ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) }));
            }
        }
        Object.defineProperty(window, 'EventSource', { value: FakeEventSource, configurable: true, writable: true });
    });
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await seedSetting(page, 'fileCopyReminders', false);
    await seedSetting(page, 'onThisDay', false);
    const obje = ['1 OBJE', '2 FORM png', '2 TITL scan-1.jpg', `2 FILE ${PX}`, `2 _STROM_SHA ${materialSha('I0001')}`];
    const bridge = await useBridge(page, material, researchGed(HEAD, obje));
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect.poll(() => page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(true);
    await poll(page);
    return bridge;
}

test.describe('Sorting in a tree followed live (spec 147 K4)', () => {
    test.use({ viewport: DESKTOP });

    test('the tree\'s file accepted is written to the research through the bridge, the locked tree stays as it is, never "not written"', async ({ page }) => {
        const material = fakeMaterial({ files: files(), batches: [BATCH], people: PEOPLE, sortProposals: [PROPOSALS[0]] });
        await followLive(page, material);
        const titles = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().media ?? {}) as { title?: string }[]).map(a => a.title ?? ''));
        await expect.poll(titles).toEqual(['']);
        await openWindow(page);
        await sortAndOpen(page);
        await row(page, 'I0001').locator('.msp-accept').click();
        await expect.poll(() => material.assigns).toEqual([expect.objectContaining({ files: ['I0001'], add: ['P0001'] })]);
        expect(material.edits![0]).toMatchObject({ ids: ['I0001'], title: 'Wedding 1924' });
        await expect(page.getByText(/not written/)).toHaveCount(0);
        expect(await titles()).toEqual(['']);
    });
});

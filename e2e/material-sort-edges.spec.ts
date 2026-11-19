import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE,
    type FakeBridge, type FakeMaterial, type FakeMaterialFile,
} from './research-bridge.js';

/**
 * Sorting with the agent at its edges (spec 102 §11, §12): the research not
 * running (the strip off, its action said and not done), a read-only tree
 * (the state alone, no Delete permanently), an older research without runs
 * of batches (the next 50 only, said so) and a tablet (the dialog and the
 * proposal window without a sideways scroll). Invented data.
 */

const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Aaro Quellmayer (1898–1960)', P0002: 'Ilsa Talvanenová (1901–1980)' };
const SORT = [...MATERIAL_FEATURES, 'material.edit', 'material.sort'];
const RUN = [...SORT, 'material.sortRun', 'material.left', 'material.sourceOf'];
const BATCH = { id: 'b-12345678', name: 'Krabice z půdy Ostrovid', at: '2026-11-10T09:00:00Z' };

const win = (page: Page) => page.locator('#materials-modal');
const strip = (page: Page) => win(page).locator('.mw-sort--top');
const sortDialog = (page: Page) => page.locator('.mdlg--sort');
const proposal = (page: Page) => page.locator('#material-sort-proposal');
const photos = (n: number): FakeMaterialFile[] => Array.from({ length: n }, (_, i) => materialFile(100 + i, {
    batch: BATCH.id, name: `Quellmayer-Talvanen_Ostrovid_svatba-${1900 + i}.jpg`, path: `Ostrovid/${String(i).padStart(4, '0')}.jpg`,
}));

async function setup(page: Page, opts: { features?: string[]; files?: FakeMaterialFile[]; init?: Partial<FakeMaterial> } = {}): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files: opts.files ?? photos(5), batches: [BATCH], people: PEOPLE, ...(opts.init ?? {}) });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features ?? SORT, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return { bridge, material };
}

async function openWindow(page: Page): Promise<void> {
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
    await expect(win(page).locator('.mw-canvas .mw-tile').first()).toBeVisible();
}

/** Elements inside `el` wider than their box and not cut with an ellipsis, and the box's own sideways scroll. */
async function sideways(page: Page, selector: string): Promise<{ own: number; wide: number; right: number }> {
    return page.locator(selector).evaluate((el) => ({
        own: el.scrollWidth - el.clientWidth,
        wide: [...el.querySelectorAll('*')].filter((x) => {
            const e = x as HTMLElement;
            const s = getComputedStyle(e);
            return e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis' && s.overflowX !== 'visible';
        }).length,
        right: el.getBoundingClientRect().right,
    }));
}

test.describe('Sorting with the agent at its edges (spec 102 §12)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the research not running: the strip off, Sort with the agent said and not done; running again, it is offered', async ({ page }) => {
        const { bridge, material } = await setup(page);
        await openWindow(page);
        await expect(strip(page)).toHaveAttribute('data-state', 'A');
        await expect(strip(page)).not.toHaveClass(/is-off/);
        bridge.down = true;
        await poll(page);
        await expect(strip(page)).toHaveClass(/is-off/);
        const go = strip(page).locator('[data-sort="sort"]');
        await expect(go).toHaveAttribute('aria-disabled', 'true');
        await expect(go).toHaveAttribute('title', 'Sorting with the agent works while the research runs.');
        await expect(strip(page).locator('.mw-sort-note')).toHaveText('Sorting with the agent works while the research runs.');
        await go.click({ force: true });
        await expect(sortDialog(page)).toHaveCount(0);
        bridge.down = false;
        await poll(page);
        await expect(strip(page)).not.toHaveClass(/is-off/);
        await expect(strip(page).locator('[data-sort="sort"]')).not.toHaveAttribute('aria-disabled', 'true');
        expect(material.sorts ?? []).toHaveLength(0);
    });

    test('a read-only tree: the state alone with its sentence, no action; Delete permanently nowhere', async ({ page }) => {
        const { material } = await setup(page, { features: [...SORT, 'material.delete'] });
        await page.evaluate(() => { window.Strom.DataManager.isReadOnly = () => true; });
        await openWindow(page);
        await expect(strip(page)).toHaveAttribute('data-state', 'A');
        await expect(strip(page)).toHaveClass(/is-off/);
        await expect(strip(page).locator('.mw-sort-note')).toHaveText('The tree is read-only.');
        await expect(strip(page).locator('button')).toHaveCount(0);
        await win(page).locator('.mw-canvas .mw-tile').first().click();
        await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
        await expect(page.locator('#image-viewer-panel .mv-act[data-action="delete"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
        await win(page).locator('[data-mw="select"]').click();
        await win(page).locator('.mw-canvas .mw-tile').first().click();
        await win(page).locator('[data-mw="sel-more"]').click();
        await expect(page.locator('.mw-pop-selMenu [data-action]').first()).toBeVisible();
        await expect(page.locator('.mw-pop-selMenu [data-action="sel-delete"]')).toHaveCount(0);
        expect(material.deletes ?? []).toHaveLength(0);
        expect(material.sorts ?? []).toHaveLength(0);
    });

    test('an older research without runs of batches: after a proposal closed, Sort the next 50… and why', async ({ page }) => {
        const files = photos(120);
        const { material } = await setup(page, {
            files,
            init: { sortProposals: [{ id: files[0].id, title: 'Svatba Quellmayer 1924', links: [{ type: 'person', ref: 'P0001' }], why: 'A veil', sure: 'high' }] },
        });
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 50 files');
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await strip(page).locator('[data-sort="close-proposal"]').click();
        await page.locator('.msp-close-go').click();
        await expect(strip(page)).toHaveAttribute('data-state', 'E');
        // The 49 the agent left unassigned are not sent again (its one proposal closed unwritten stays unsorted): 71 left, 50 at once.
        await expect(strip(page).locator('.mw-sort-what')).toHaveText('Done: 0 handled · 49 unassigned · 71 unsorted left');
        await expect(strip(page).locator('.mw-sort-note')).toHaveText('The agent takes at most 50 files at once. A newer version of the research sorts in batches.');
        const next = strip(page).locator('[data-sort="next"]');
        await expect(next).toContainText('Sort the next 50…');
        await expect(next.locator('.research-ai-badge')).toHaveCount(1);
        await next.click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Sort with the agent · 50 files');
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect.poll(() => material.sorts?.length).toBe(2);
        expect(material.sorts![1].ids as string[]).toHaveLength(50);
        // Never one the agent left unassigned (the closed proposal's own file stays unsorted and may go again).
        const left = (material.sorts![0].ids as string[]).filter(id => id !== files[0].id);
        expect((material.sorts![1].ids as string[]).filter(id => left.includes(id))).toEqual([]);
    });
});

test.describe('Sorting with the agent on a tablet (spec 102 §11)', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('the dialog of 1,500 files and the proposal window in German: nothing scrolls sideways', async ({ page }) => {
        await setup(page, { features: RUN, files: photos(1500) });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await expect(sortDialog(page).locator('.mdlg-title')).toHaveText('Mit dem Agenten sortieren · 1.500 Dateien');
        let fit = await sideways(page, '.mdlg--sort');
        expect(fit.own).toBeLessThanOrEqual(0);
        expect(fit.wide).toBe(0);
        expect(fit.right).toBeLessThanOrEqual(1024);
        await page.keyboard.press('Escape');
        await expect(sortDialog(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.setLanguage('en' as never));
    });

    test('the proposal window in German: nothing scrolls sideways', async ({ page }) => {
        const files = photos(3);
        await setup(page, {
            files,
            init: { sortProposals: [{ id: files[0].id, title: 'Hochzeit von Aaro Quellmayer und Ilsa Talvanenová in Ostrovid 1924', kind: 'photo',
                links: [{ type: 'person', ref: 'P0001' }, { type: 'back', ref: files[1].id }, { type: 'portrait', ref: 'P0002' }], why: 'Ein Schleier und ein Blumenstrauß', sure: 'high' }] },
        });
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await openWindow(page);
        await strip(page).locator('[data-sort="sort"]').click();
        await sortDialog(page).locator('.mdlg-sort-go').click();
        await expect(strip(page)).toHaveAttribute('data-state', 'D');
        await strip(page).locator('[data-sort="open"]').click();
        await expect(proposal(page).locator('.msp-row')).toHaveCount(1);
        await expect(proposal(page).locator('.msp-chip[data-chip="back"]')).toBeVisible();
        const fit = await sideways(page, '#material-sort-proposal');
        expect(fit.own).toBeLessThanOrEqual(0);
        expect(fit.wide).toBe(0);
        expect(fit.right).toBeLessThanOrEqual(1024);
    });
});

/**
 * A button keeps its width while it works (waiting buttons §1.2): its working words are drawn with it from the
 * start (`.bl`), so the state that comes after 120 ms does not widen it. The places of the heavy computations
 * (§8): Validation details in the tree overview (C102), another cut of Split into families (B211), the Table's
 * Export (C99), Start merge and Re-analyze (C23/C86), Accept changes and Review in detail of a packet (C84/C85).
 * German (the longest words) and a wide font (CI's fonts are wider than a Mac's).
 *
 * The state is held while it is measured: requestAnimationFrame waits while `window.__holding` (the work waits for
 * its painted frame), so the button stays working until the test lets it go.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { openApp, openTreeStructure } from './helpers.js';

function mk(id: string, first: string, last: string, gender: string, birth: string,
    partnerships: string[], parentIds: string[], childIds: string[]) {
    return { id, firstName: first, lastName: last, gender, birthDate: birth, isPlaceholder: false, partnerships, parentIds, childIds };
}

// Three generations, the wife's parents (an in-law branch: a second family), one couple tied to no one.
const TREE = {
    version: 5,
    defaultPersonId: 'me',
    persons: {
        gpa: mk('gpa', 'Old', 'Novák', 'male', '1900', ['u_g'], [], ['dad']),
        gma: mk('gma', 'Stará', 'Nováková', 'female', '1902', ['u_g'], [], ['dad']),
        dad: mk('dad', 'Jan', 'Novák', 'male', '1930', ['u_p'], ['gpa', 'gma'], ['me', 'bro']),
        mom: mk('mom', 'Marie', 'Nováková', 'female', '1932', ['u_p'], [], ['me', 'bro']),
        me: mk('me', 'Petr', 'Novák', 'male', '1960', ['u_m'], ['dad', 'mom'], ['kid']),
        bro: mk('bro', 'Josef', 'Novák', 'male', '1963', [], ['dad', 'mom'], []),
        wife: mk('wife', 'Eva', 'Nováková', 'female', '1962', ['u_m'], ['wdad', 'wmom'], ['kid']),
        kid: mk('kid', 'Adam', 'Novák', 'male', '1990', [], ['me', 'wife'], []),
        wdad: mk('wdad', 'Karel', 'Svoboda', 'male', '1935', ['u_w'], [], ['wife']),
        wmom: mk('wmom', 'Anna', 'Svobodová', 'female', '1937', ['u_w'], [], ['wife']),
        lx: mk('lx', 'Bořivoj', 'Klenovský', 'male', '1880', ['u_x'], [], []),
        ly: mk('ly', 'Ludmila', 'Klenovská', 'female', '1884', ['u_x'], [], []),
    },
    partnerships: {
        u_g: { id: 'u_g', person1Id: 'gpa', person2Id: 'gma', childIds: ['dad'], status: 'married' },
        u_p: { id: 'u_p', person1Id: 'dad', person2Id: 'mom', childIds: ['me', 'bro'], status: 'married' },
        u_m: { id: 'u_m', person1Id: 'me', person2Id: 'wife', childIds: ['kid'], status: 'married' },
        u_w: { id: 'u_w', person1Id: 'wdad', person2Id: 'wmom', childIds: ['wife'], status: 'married' },
        u_x: { id: 'u_x', person1Id: 'lx', person2Id: 'ly', childIds: [], status: 'married' },
    },
};

const WIDE_FONT = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }';

/** requestAnimationFrame held while window.__holding (installed before the app loads). */
async function installHold(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const w = window as unknown as { __holding: boolean; __release: () => void };
        const orig = window.requestAnimationFrame.bind(window);
        const q: FrameRequestCallback[] = [];
        w.__holding = false;
        window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            if (w.__holding) { q.push(cb); return 900000 + q.length; }
            return orig(cb);
        }) as typeof window.requestAnimationFrame;
        w.__release = () => { w.__holding = false; for (const cb of q.splice(0)) orig(cb); };
    });
}

const hold = (page: Page) => page.evaluate(() => { (window as unknown as { __holding: boolean }).__holding = true; });
const release = (page: Page) => page.evaluate(() => (window as unknown as { __release: () => void }).__release());

async function loadTree(page: Page, width: number, wide: boolean): Promise<string> {
    await installHold(page);
    await page.setViewportSize({ width, height: width < 641 ? 844 : 900 });
    await openApp(page);
    if (wide) await page.addStyleTag({ content: WIDE_FONT });
    return page.evaluate(async (data) => {
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree(data as never, 'Vrbečtí z Klenové nad Sázavou');
        S.TreeRenderer.setFocus('me' as never);
        await S.TreeRenderer.renderAsync();
        S.UI.setLanguage('de' as never);
        return id as string;
    }, TREE);
}

/** Click `btn` with the frames held: its width at rest and while it shows the working state, and the words seen. */
async function workingWidth(page: Page, btn: Locator): Promise<{ rest: number; working: number; words: string }> {
    await btn.scrollIntoViewIfNeeded();
    const rest = (await btn.boundingBox())!.width;
    await hold(page);
    await btn.click();
    await expect(btn).toHaveAttribute('data-busy', 'busy');
    const working = (await btn.boundingBox())!.width;
    const words = await btn.evaluate((b) => {
        const busy = b.querySelector<HTMLElement>(':scope > .bl > .b-busy');
        return busy && getComputedStyle(busy).visibility === 'visible' ? (busy.textContent ?? '') : '';
    });
    return { rest, working, words };
}

for (const wide of [false, true]) {
    test.describe(`a working button keeps its width (de${wide ? ', a wide font' : ''})`, () => {
        test('Validation details in the tree overview (C102)', async ({ page }) => {
            const treeId = await loadTree(page, 1440, wide);
            await page.evaluate((id) => window.Strom.UI.showTreeOverview(id), treeId);
            const quality = page.locator('#tree-overview-modal .tov-sec[data-section="quality"]');
            const head = quality.locator('.tov-sec-head');
            if (await head.getAttribute('aria-expanded') !== 'true') await head.click();
            const btn = quality.locator('.tov-actions [data-tov="validation"]');
            const m = await workingWidth(page, btn);
            expect(Math.abs(m.working - m.rest)).toBeLessThanOrEqual(1);
            expect(m.words).toBe('Wird geprüft…');
            // Its name stays its own (the working words are hidden from the screen reader).
            await expect(btn).toHaveAccessibleName('Validierungsdetails');
            await release(page);
            await expect(page.locator('#tree-validation-modal')).toBeVisible({ timeout: 20_000 });
        });

        test('another cut of Split into families (B211): the spinner in the segment, the words under it', async ({ page }) => {
            await loadTree(page, 1440, wide);
            await page.evaluate(() => { void window.Strom.UI.showSplitFamiliesDialog(); });
            const modal = page.locator('#split-families-modal');
            await expect(modal).toBeVisible({ timeout: 20_000 });
            const hint = modal.locator('.splitfam-mode-hint');
            const hintHeight = (await hint.boundingBox())!.height;
            const btn = modal.locator('.splitfam-mode-btn:not(.active)').first();
            const m = await workingWidth(page, btn);
            expect(Math.abs(m.working - m.rest)).toBeLessThanOrEqual(1);
            expect(m.words).toBe('');
            await expect(hint).toHaveText('Familien werden gesucht…');
            await expect(hint.locator('.busy-st .busy-spin')).toBeVisible();
            // The hint keeps its height: the list under it does not jump.
            expect(Math.abs((await hint.boundingBox())!.height - hintHeight)).toBeLessThanOrEqual(1);
            await release(page);
            await expect(modal.locator('.splitfam-mode-btn.active')).toBeVisible();
            await expect(modal.locator('.splitfam-mode-hint .busy-st')).toHaveCount(0);
        });

        test('the Table\'s Export (C99)', async ({ page }) => {
            await loadTree(page, 1440, wide);
            await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table' as never));
            await expect(page.locator('#table-container .tv-grid')).toBeVisible();
            const btn = page.locator('#table-container .tv-export-btn');
            await btn.click();
            const apply = page.locator('.tv-fpanel.tv-xpanel .tv-fpanel-apply').first();
            await expect(apply).toBeVisible();
            const rest = (await btn.boundingBox())!.width;
            await hold(page);
            const dl = page.waitForEvent('download', { timeout: 20_000 });
            await apply.click();
            await expect(btn).toHaveAttribute('data-busy', 'busy');
            expect(Math.abs((await btn.boundingBox())!.width - rest)).toBeLessThanOrEqual(1);
            await expect(btn.locator('.b-busy')).toHaveText('Export');
            await expect(btn.locator('.b-busy .busy-spin')).toBeVisible();
            await release(page);
            await dl;
            await expect(btn).toHaveAttribute('data-busy', 'idle');
        });

        test('Start merge and Re-analyze (C23/C86)', async ({ page }) => {
            const targetId = await loadTree(page, 1440, wide);
            const sourceId = await page.evaluate(async (data) => window.Strom.DataManager.importAsNewTree(data as never, 'Kopie') as Promise<string>, TREE);
            await page.evaluate((id) => window.Strom.UI.showMergeTreesDialog(id), sourceId);
            await expect(page.locator('#merge-trees-modal')).toBeVisible();
            await page.evaluate((id) => window.Strom.UI.selectMergeTarget(id), targetId);
            const start = page.locator('#merge-trees-btn');
            const a = await workingWidth(page, start);
            expect(Math.abs(a.working - a.rest)).toBeLessThanOrEqual(1);
            expect(a.words).toBe('Wird analysiert…');
            await release(page);
            const wizard = page.locator('#merge-modal');
            await expect(wizard).toBeVisible({ timeout: 30_000 });
            // Re-analyze stands in step 2's list of pairs: the guide compares first.
            await wizard.locator('#merge-next').click();
            await expect(wizard.locator('#merge-progress [aria-current="step"]')).toHaveAttribute('data-step', '2', { timeout: 30_000 });
            const again = wizard.getByRole('button', { name: 'Neu analysieren' });
            const footer = wizard.locator('.merge-actions');
            const footerHeight = (await footer.boundingBox())!.height;
            // In one row at rest too (the wizard is wide enough for Re-analyze holding its working words).
            if (!wide) {
                const boxes = await footer.locator(':scope > button').evaluateAll(bs => bs.filter(b => b.getClientRects().length)
                    .map(b => { const r = b.getBoundingClientRect(); return { mid: r.top + r.height / 2, h: r.height }; }));
                expect(Math.max(...boxes.map(b => b.mid)) - Math.min(...boxes.map(b => b.mid)), JSON.stringify(boxes)).toBeLessThanOrEqual(1);
                expect(boxes.every(b => b.h < 48), JSON.stringify(boxes)).toBe(true);
            }
            const b = await workingWidth(page, again);
            expect(Math.abs(b.working - b.rest)).toBeLessThanOrEqual(1);
            expect(b.words).toBe('Wird analysiert…');
            // The wizard's footer does not wrap into another row.
            expect(Math.abs((await footer.boundingBox())!.height - footerHeight)).toBeLessThanOrEqual(1);
            await release(page);
            await expect(again).not.toHaveAttribute('aria-busy', 'true', { timeout: 30_000 });
        });

        for (const which of ['accept', 'review'] as const) {
            test(`${which === 'accept' ? 'Accept changes (C84)' : 'Review in detail (C85)'} of a packet of changes`, async ({ page }) => {
                await loadTree(page, 1440, wide);
                await page.evaluate(() => {
                    const S = window.Strom as unknown as { DataManager: { getData(): unknown }; UI: Record<string, unknown> & {
                        showChangePacketPreview(p: unknown, s: unknown, n: string): void } };
                    const base = JSON.parse(JSON.stringify(S.DataManager.getData()));
                    const np = { id: 'np1', firstName: 'Bohumila', lastName: 'Vrbecká', gender: 'female', birthDate: '1911',
                        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };
                    const none = { added: [], changed: [], removedIds: [] };
                    const packet = { kind: 'strom-changes', formatVersion: 1, baseExportId: 'w', senderName: 'Bohumila', treeName: 'T',
                        persons: { added: [np], changed: [], removedIds: [] }, partnerships: none, sources: none };
                    S.UI.pendingChangePacket = packet;
                    S.UI.pendingChangePacketBase = base;
                    S.UI.showChangePacketPreview(packet, { newPersons: [{ id: 'np1', name: 'Bohumila Vrbecká' }], modifiedPersons: [],
                        removedPersonCount: 0, newPartnershipCount: 0, modifiedPartnershipCount: 0, removedPartnershipCount: 0,
                        sourceChangeCount: 0, mediaCount: 0, placeCount: 0, surnameGroupCount: 0, hasEffect: true }, 'T');
                });
                const preview = page.locator('#share-packet-modal');
                await expect(preview).toBeVisible();
                const btn = preview.getByRole('button', { name: which === 'accept' ? 'Änderungen übernehmen' : 'Im Detail prüfen' });
                const m = await workingWidth(page, btn);
                expect(Math.abs(m.working - m.rest)).toBeLessThanOrEqual(1);
                expect(m.words).toBe(which === 'accept' ? 'Wird übernommen…' : 'Wird analysiert…');
                await release(page);
                if (which === 'accept') await expect(preview).toBeHidden({ timeout: 20_000 });
                else await expect(page.locator('#merge-modal')).toBeVisible({ timeout: 20_000 });
            });
        }
    });
}

test.describe('on a phone (390, de)', () => {
    for (const wide of [false, true]) {
        test(`the three cuts of Split into families stay inside the dialog${wide ? ' (a wide font)' : ''}`, async ({ page }) => {
            await loadTree(page, 390, wide);
            await page.evaluate(() => { void window.Strom.UI.showSplitFamiliesDialog(); });
            const modal = page.locator('#split-families-modal');
            await expect(modal).toBeVisible({ timeout: 20_000 });
            const fit = await modal.evaluate((m) => {
                const seg = m.querySelector<HTMLElement>('.splitfam-mode')!;
                const box = m.querySelector<HTMLElement>('.modal')!.getBoundingClientRect();
                const cells = Array.from(seg.querySelectorAll<HTMLElement>('.splitfam-mode-btn')).map(b => b.getBoundingClientRect());
                return {
                    scroll: seg.scrollWidth - seg.clientWidth,
                    inside: cells.every(r => r.left >= box.left - 1 && r.right <= box.right + 1),
                    tall: cells.every(r => r.height >= 44 - 0.5) || !matchMedia('(pointer: coarse)').matches,
                };
            });
            expect(fit.scroll).toBeLessThanOrEqual(1);
            expect(fit.inside).toBe(true);
            expect(fit.tall).toBe(true);
        });
    }

    test('the Table\'s Export from ⋯ says its state in a progress toast (C99: the toolbar\'s Export is hidden)', async ({ page }) => {
        await loadTree(page, 390, false);
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table' as never));
        await expect(page.locator('#table-container .tv-grid')).toBeVisible();
        await expect(page.locator('#table-container .tv-export-btn')).toBeHidden();
        await page.locator('#table-container .tv-more-menu-btn').click();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Export' }).click();
        const apply = page.locator('.tv-fsheet.tv-xpanel .tv-fs-apply').first();
        await expect(apply).toBeVisible();
        await hold(page);
        const dl = page.waitForEvent('download', { timeout: 20_000 });
        await apply.click();
        const toast = page.locator('.toast--progress');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('Die Datei wird gespeichert…');
        await release(page);
        await dl;
        await expect(toast).toBeHidden();
    });
});

test.describe('a working element hidden in its closed menu', () => {
    test('Split into families from a tree manager row says its state in a progress toast (B210: its menu closed, the item kept hidden)', async ({ page }) => {
        await loadTree(page, 1440, false);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const active = page.locator('.tree-manager-item.active');
        await active.locator('.tree-row-menu-btn').click();
        const structure = await openTreeStructure(page, active.locator('.tree-row-menu.open'));
        await hold(page);
        await structure.locator('.tree-row-menu-item', { hasText: 'In Familien aufteilen' }).click();
        const toast = page.locator('.toast--progress');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('Familien werden gesucht…');
        await release(page);
        await expect(page.locator('#split-families-modal')).toBeVisible();
        await expect(toast).toBeHidden();
    });
});

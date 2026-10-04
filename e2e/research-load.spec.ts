import { test, expect, Page } from '@playwright/test';
import { NEW_HEAD, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * "Load the research version?" (data protection 3.2): every value here the
 * research's version changes or removes, one row each, what it adds, the
 * backup — and, when the tree only loads from the research, said in amber
 * that these values go ("Load and overwrite", or open it as a copy).
 */

const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const dialog = (page: Page) => page.locator('#research-load-modal');
const head = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head);

/** Values here the research's version does not have: three people, ten values. */
async function editMany(page: Page): Promise<void> {
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const by = (n: string) => (Object.values(dm.getData().persons) as any[]).find(p => p.firstName === n);
        dm.updatePerson(by('Jan').id, { birthPlace: 'Kolín', deathPlace: 'Brno', deathDate: '1932', notes: 'kovář', deathCause: 'tyfus' });
        dm.updatePerson(by('Josef').id, { birthPlace: 'Lipany', deathPlace: 'Chlumec', notes: 'sedlák' });
        dm.updatePerson(by('Anna').id, { birthPlace: 'Hořice', deathPlace: 'Jičín' });
    });
}

test.describe('loading the research version', () => {
    test('only loading: the values here that go, 8 rows then "and N more" (expand, hide), the amber box, Load and overwrite', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: ACCEPTS });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.setResearchSendMode(window.Strom.TreeManager.getActiveTreeId()!, 'off'));
        await editMany(page);
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD, ['1 OCCU tesař']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page)).toContainText('Load the research version?');
        await expect(dialog(page).locator('.research-load-warn')).toHaveText('Changes from this tree are not sent to the research. These values here will be overwritten by the research version.');
        await expect(dialog(page).locator('thead')).toContainText('Person · 3');
        await expect(dialog(page).locator('thead')).toContainText('here → from research');
        const rows = dialog(page).locator('tbody tr');
        await expect(rows).toHaveCount(10);
        await expect(dialog(page).locator('tbody tr:visible')).toHaveCount(8);
        // A row: the person on its first row only, the fact, the value here struck through → none there.
        const jan = dialog(page).locator('tbody tr', { hasText: 'Birth · Place' }).filter({ hasText: 'Kolín' });
        await expect(jan.locator('.research-load-here')).toHaveText('Kolín');
        await expect(jan.locator('.research-load-there')).toHaveText('–');
        const more = dialog(page).locator('#research-load-more');
        await expect(more).toHaveText('and 2 more');
        await more.click();
        await expect(dialog(page).locator('tbody tr:visible')).toHaveCount(10);
        await expect(more).toHaveText('Hide');
        await more.click();
        await expect(dialog(page).locator('tbody tr:visible')).toHaveCount(8);
        await expect(dialog(page).locator('.research-load-added')).toHaveText('Added from the research: 1 fact');
        await expect(dialog(page).locator('.research-load-backup')).toHaveText('A backup is saved before loading; you can go back.');
        await expect(dialog(page).getByRole('button', { name: 'Open as copy' })).toBeVisible();
        await dialog(page).getByRole('button', { name: 'Load and overwrite' }).click();
        await expect.poll(() => head(page)).toBe(NEW_HEAD);
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Jan').birthPlace ?? '')).toBe('');
    });

    test('Cancel and Escape load nothing; a tree unchanged since: Load, nothing overwritten', async ({ page }) => {
        await page.clock.install();
        await openResearch(page);
        const bridge = await fakeBridge(page, { accepts: ACCEPTS });
        await poll(page);
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD, ['1 BIRT', '2 PLAC Praha', '1 OCCU tesař']);
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('.research-load-warn')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        expect(await head(page)).not.toBe(NEW_HEAD);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await dialog(page).getByRole('button', { name: 'Cancel' }).click();
        expect(await head(page)).not.toBe(NEW_HEAD);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        await expect(dialog(page).getByRole('button', { name: 'Open as copy' })).toHaveCount(0);
        await dialog(page).locator('#research-load-ok').click();
        await expect.poll(() => head(page)).toBe(NEW_HEAD);
    });
});

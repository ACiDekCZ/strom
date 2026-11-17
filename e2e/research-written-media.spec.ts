import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, FakeBridge } from './research-bridge.js';

/**
 * "What was written" with the tree's own files (spec 108 K2.6): a research
 * that keeps them (`media.app`) says in its answer what it wrote of them
 * (`media`, `mediaCount`), so a portrait and a couple's photo are written
 * changes — "Jan Fíšek · photo", the couple's photo not "app only", "+ N
 * more" beyond the listed. A research without the gate: the couple's photo
 * stays "app only", as the tree's files are not written there. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const picture = (fill: string) => `data:image/jpeg;base64,${fill.repeat(3000)}`;

async function researchTree(page: Page, features: string[], reply: Record<string, unknown> = {}): Promise<FakeBridge> {
    await page.clock.install({ time: new Date('2026-11-17T10:30:00Z') });
    await openResearch(page);
    const b = await fakeBridge(page, { features, accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null },
        syncReply: { status: 200, body: { ok: true, inbox: false, changes: 2, applied: 2, input: 'I0042', ...reply } } });
    await poll(page);
    return b;
}

/** A portrait of Jan and a photo of his parents' couple. */
async function addPhotos(page: Page): Promise<void> {
    await page.evaluate((pic) => {
        const dm = window.Strom.DataManager;
        const d = dm.getData();
        const jan = (Object.values(d.persons) as any[]).find(p => p.firstName === 'Jan');
        dm.updatePerson(jan.id, { photo: pic.portrait });
        const u = Object.values(d.partnerships)[0] as any;
        dm.updatePartnership(u.id, { photo: pic.couple });
    }, { portrait: picture('A'), couple: picture('B') });
}

async function sendAndShowWritten(page: Page, b: FakeBridge): Promise<void> {
    await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
    await expect.poll(() => b.posts.length).toBe(1);
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('written');
    await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
}

test.describe('what was written of the tree\'s own files', () => {
    test.use({ viewport: DESKTOP });

    test('a research with media.app: the portrait and the couple\'s photo written as its answer names them, "+ N more" beyond', async ({ page }) => {
        // Its answer: what it wrote of the files (one more than it lists).
        const b = await researchTree(page, ['media.app'], {
            media: [
                { kind: 'media.photo', person: 'P0003', record: 'I0042', title: 'jan.jpg' },
                { kind: 'media.couplePhoto', family: 'F0001', record: 'I0042' },
            ],
            mediaCount: 3,
        });
        await addPhotos(page);
        await sendAndShowWritten(page, b);
        expect(b.postQueries?.[0].get('media')).toBe('app');
        const panel = page.locator('#research-changes-panel');
        const jan = panel.locator('[data-kind="person"]').filter({ hasText: 'Jan Fíšek' });
        await expect(jan.locator('.research-changes-kinds')).toHaveText('photo');
        const couple = panel.locator('[data-kind="couple"]');
        await expect(couple.locator('.research-changes-name')).toHaveText('Josef Fíšek and Anna Svobodová');
        await expect(couple.locator('.research-changes-kinds')).toHaveText('photo');
        // Nothing of the files stays in the app only.
        await expect(panel.locator('[data-section="appOnly"]')).toHaveCount(0);
        await expect(panel.locator('.research-changes-tag')).toHaveCount(0);
        await expect(panel.locator('.research-changes-more')).toHaveText('+ 1 more');
    });

    test('a research without media.app: the couple\'s photo stays "app only", as before', async ({ page }) => {
        const b = await researchTree(page, []);
        await addPhotos(page);
        await sendAndShowWritten(page, b);
        expect(b.postQueries?.[0].get('media')).toBeNull();
        const panel = page.locator('#research-changes-panel');
        await expect(panel.locator('[data-section="appOnly"]')).toHaveText('App only · 1');
        await expect(panel.locator('[data-group="appOnly"] .research-changes-name')).toHaveText('Josef Fíšek and Anna Svobodová');
        await expect(panel.locator('.research-changes-more')).toHaveCount(0);
    });
});

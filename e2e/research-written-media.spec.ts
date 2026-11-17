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
        // The new portrait's preview at the row's end (spec 102 §10).
        await expect(jan.locator('img.research-changes-pic')).toHaveCount(1);
        const couple = panel.locator('[data-kind="couple"]');
        await expect(couple.locator('.research-changes-name')).toHaveText('Josef Fíšek and Anna Svobodová');
        await expect(couple.locator('.research-changes-kinds')).toHaveText('photo of the union');
        // Nothing of the files stays in the app only.
        await expect(panel.locator('[data-section="appOnly"]')).toHaveCount(0);
        await expect(panel.locator('.research-changes-tag')).toHaveCount(0);
        await expect(panel.locator('.research-changes-more')).toHaveText('+ 1 more');
    });

    test('a research without media.app: the photos are not promised, no "app only" step (spec 102 §10, R10 b)', async ({ page }) => {
        const b = await researchTree(page, []);
        await addPhotos(page);
        // About to send: one sentence why, no row of the portrait or the couple's photo.
        await page.evaluate(() => window.Strom.UI.showResearchChanges('send'));
        const panel = page.locator('#research-changes-panel');
        await expect(panel.locator('.research-changes-body .research-changes-note')).toHaveText(/does not write photos of people and unions/);
        await expect(panel.locator('[data-kind="person"]').filter({ hasText: 'Jan Fíšek' })).toHaveCount(0);
        await expect(panel.locator('[data-kind="couple"]')).toHaveCount(0);
        // The sync bar counts as the list shows: the portrait and the couple's photo are not counted.
        const counted = await page.evaluate(() => (window.Strom.UI as unknown as { researchChangesCount(): { persons: number; other: number } | null }).researchChangesCount());
        expect(counted?.persons).toBe(await panel.locator('[data-kind="person"]').count());
        expect(counted?.other).toBe(0);
        await page.evaluate(() => window.Strom.UI.closeResearchChanges());
        await sendAndShowWritten(page, b);
        expect(b.postQueries?.[0].get('media')).toBeNull();
        await expect(panel.locator('[data-section="appOnly"]')).toHaveCount(0);
        await expect(panel.locator('[data-kind="couple"]')).toHaveCount(0);
        await expect(panel.locator('.research-changes-more')).toHaveCount(0);
        // What was written says the same sentence (spec 102 §10).
        await expect(panel.locator('.research-changes-body .research-changes-note')).toHaveText(/does not write photos of people and unions/);
    });

    test('a research with material.links: a file\'s title, its new place and a source\'s evidence are told as they are', async ({ page }) => {
        const b = await researchTree(page, ['media.app', 'material.links']);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const d = dm.getData();
            const jan = (Object.values(d.persons) as any[]).find(p => p.firstName === 'Jan');
            const att = dm.addAttachment(jan.id, { name: 'mlyn.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3 });
            return att?.id;
        });
        // Written there: the research's version has the file, the next changes are its title and its place at the birth.
        await sendAndShowWritten(page, b);
        await page.evaluate(() => window.Strom.UI.closeResearchChanges());
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const d = dm.getData();
            const jan = (Object.values(d.persons) as any[]).find(p => p.firstName === 'Jan');
            const att = (Object.values(d.media) as any[]).find(a => a.name === 'mlyn.jpg');
            dm.setMediaDetails(att.id, { title: 'Jan at the mill' });
            dm.addMediaPlace(att.id, { personId: jan.id, fact: 'birth' });
        });
        await page.evaluate(() => window.Strom.UI.showResearchChanges('send'));
        const jan = page.locator('#research-changes-panel [data-kind="person"]').filter({ hasText: 'Jan Fíšek' });
        await expect(jan.locator('.research-changes-kinds')).toContainText('attachment title');
        await expect(jan.locator('.research-changes-kinds')).toContainText('+ attachment at birth');
        await expect(page.locator('#research-changes-panel .research-changes-body .research-changes-note')).toHaveCount(0);
    });
});

import { test, expect, Page } from '@playwright/test';
import { HEAD, editJan, fakeBridge, openResearch, poll, researchGed, FakeBridge } from './research-bridge.js';

/**
 * A research that keeps the app's own files (spec 108, Strom Research 1.35,
 * `media.app` in `/status.features`): each write says it carries every file
 * (`POST /sync?media=app`), and the first one after the update goes by
 * itself (K2.7). A research without the gate gets the plain `/sync`, as
 * before, and nothing goes unasked. The bridge is answered by page.route.
 */

/** A picture of Jan (an attachment: a landscape picture without a kind), a tiny JPEG (640×480 header only). */
const PORTRAIT = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/wAARCAHgAoADASIAAhEBAxEB/9k=';
const withPortrait = researchGed(HEAD, ['1 OBJE', '2 FORM jpeg', '2 TITL jan.jpg', `2 FILE ${PORTRAIT}`]);

async function researchTree(page: Page, features: string[], auto: boolean): Promise<FakeBridge> {
    await page.clock.install({ time: new Date('2026-11-17T10:30:00Z') });
    await openResearch(page, { auto, ged: withPortrait });
    expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[])
        .find(p => p.firstName === 'Jan')?.attachments?.[0]?.dataUrl ?? null)).toBe(PORTRAIT);
    const bridge = await fakeBridge(page, { features, accepts: { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null } });
    await page.evaluate(() => localStorage.setItem('strom-research-auto-intro-seen', '1'));
    return bridge;
}

test('a research with media.app: the first write after the update goes by itself, once, and says it carries every file', async ({ page }) => {
    const bridge = await researchTree(page, ['media.app'], true);
    await poll(page);
    await expect.poll(() => bridge.posts.length).toBe(1);
    expect(bridge.postQueries?.[0].get('media')).toBe('app');
    expect(bridge.posts[0]).toContain(PORTRAIT.slice('data:image/jpeg;base64,'.length));
    // Sent there with its files: not again by itself.
    await poll(page);
    await page.clock.fastForward(5_000);
    await poll(page);
    expect(bridge.posts).toHaveLength(1);
    // The next write says it too.
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.postQueries?.[1].get('media')).toBe('app');
});

test('images not taken into the app: a write to a research with media.app only adds (no ?media=app), nothing unasked', async ({ page }) => {
    const bridge = await researchTree(page, ['media.app'], true);
    await page.evaluate(() => window.Strom.SettingsManager.setImportImages(false));
    await poll(page);
    await page.clock.fastForward(5_000);
    expect(bridge.posts).toHaveLength(0);
});

test('an older research (no media.app): the plain /sync as before, nothing goes unasked', async ({ page }) => {
    const bridge = await researchTree(page, [], false);
    await poll(page);
    await page.clock.fastForward(5_000);
    expect(bridge.posts).toHaveLength(0);
    await editJan(page);
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(1);
    expect(bridge.postQueries?.[0].has('media')).toBe(false);
    expect(bridge.postQueries?.[0].get('app')).toBeTruthy();
});

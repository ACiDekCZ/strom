import { test, expect, Page } from '@playwright/test';
import { HEAD, editJan, fakeBridge, foreignCommit, openResearch, poll, researchGed, FakeBridge } from './research-bridge.js';

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
        .filter(p => p.firstName === 'Jan').flatMap(p => window.Strom.DataManager.personMedia(p.id))[0]?.dataUrl ?? null)).toBe(PORTRAIT);
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

test('a version back without files the tree has (carried over): one write with them goes by itself again', async ({ page }) => {
    // Its tree asked with the tree's own files (`?images=ref&media=app`): the return the archive is the truth for.
    const bridge = await researchTree(page, ['media.app', 'ged.imagesByHash'], true);
    await poll(page);
    await expect.poll(() => bridge.posts.length).toBe(1);
    // The research's own commit, its file without Jan's picture: taken, the picture carried over from here.
    foreignCommit(bridge);
    expect(bridge.treeGed).not.toContain(PORTRAIT.slice('data:image/jpeg;base64,'.length));
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await page.getByRole('dialog', { name: 'Load the research version?' }).getByRole('button', { name: 'Load' }).click();
    await expect.poll(() => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[])
        .some(p => p.firstName === 'Jan Václav'))).toBe(true);
    expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[])
        .filter(p => p.firstName === 'Jan Václav').flatMap(p => window.Strom.DataManager.personMedia(p.id))[0]?.dataUrl ?? null)).toBe(PORTRAIT);
    await poll(page);
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.postQueries?.[1].get('media')).toBe('app');
    expect(bridge.posts[1]).toContain(PORTRAIT.slice('data:image/jpeg;base64,'.length));
    // Once: not again by itself.
    await poll(page);
    await page.clock.fastForward(5_000);
    await poll(page);
    expect(bridge.posts).toHaveLength(2);
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

test('a version whose own files could not all be had (the file with its images in it): writes only add until a version with them', async ({ page }) => {
    const bridge = await researchTree(page, ['media.app', 'ged.imagesByHash'], false);
    // The research's own commit; its file with the tree's files names a picture by its hash, which cannot be had.
    foreignCommit(bridge);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, if-none-match' };
    const missing = `1 OBJE\n2 FILE strom-image:${'d'.repeat(64)}\n3 _MIME image/jpeg\n3 _BYTES 4096\n`;
    await page.route(/\/tree\.ged(\?|$)/, async (route) => {
        const q = new URL(route.request().url()).searchParams;
        if (q.get('images') !== 'ref' || q.get('media') !== 'app') return route.fallback();
        await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8', 'x-strom-images': 'ref' },
            body: bridge.treeGed.replace('1 NAME Jan Václav /Fíšek/\n', `1 NAME Jan Václav /Fíšek/\n${missing}`) });
    });
    await page.route(/\/images(\?|$)/, (route) => route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: cors, body: '' })
        : route.fulfill({ status: 404, headers: cors, body: '' }));
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await page.getByRole('dialog', { name: 'Load the research version?' }).getByRole('button', { name: 'Load' }).click();
    const jan = () => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[])
        .find(p => p.firstName === 'Jan Václav') ?? null);
    await expect.poll(async () => !!(await jan())).toBe(true);
    const editJanVaclav = (place: string) => page.evaluate((place) => {
        const dm = window.Strom.DataManager;
        const p = (Object.values(dm.getData().persons) as any[]).find(x => x.firstName === 'Jan Václav');
        dm.updatePerson(p.id, { birthPlace: place });
    }, place);
    await editJanVaclav('Praha');
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(1);
    // Without the archive's files the tree may lack some: never said to carry every file.
    expect(bridge.postQueries?.[0].has('media')).toBe(false);

    // A version with them again: the next write says it carries every file.
    await page.unroute(/\/tree\.ged(\?|$)/);
    await page.unroute(/\/images(\?|$)/);
    foreignCommit(bridge);
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    // The first write still waits in the research's inbox: loaded over it.
    await page.getByRole('button', { name: 'Load without changes' }).click();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head)).toBe(bridge.head);
    await editJanVaclav('Brno');
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(2);
    expect(bridge.postQueries?.[1].get('media')).toBe('app');
});

test('own files that could not be had: tried again by itself, then said with Try again, which takes that very version with them and lifts the guard', async ({ page }) => {
    const bridge = await researchTree(page, ['media.app', 'ged.imagesByHash'], false);
    foreignCommit(bridge);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, if-none-match' };
    const missing = `1 OBJE\n2 FILE strom-image:${'d'.repeat(64)}\n3 _MIME image/jpeg\n3 _BYTES 4096\n`;
    const asked: string[] = [];
    await page.route(/\/tree\.ged(\?|$)/, async (route) => {
        const q = new URL(route.request().url()).searchParams;
        if (q.get('images') !== 'ref' || q.get('media') !== 'app') return route.fallback();
        asked.push(route.request().url());
        await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8', 'x-strom-images': 'ref' },
            body: bridge.treeGed.replace('1 NAME Jan Václav /Fíšek/\n', `1 NAME Jan Václav /Fíšek/\n${missing}`) });
    });
    await page.route(/\/images(\?|$)/, (route) => route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: cors, body: '' })
        : route.fulfill({ status: 404, headers: cors, body: '' }));
    await poll(page);
    await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
    await page.getByRole('dialog', { name: 'Load the research version?' }).getByRole('button', { name: 'Load' }).click();
    await expect.poll(() => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[])
        .some(p => p.firstName === 'Jan Václav'))).toBe(true);
    const tries = asked.length;
    const notice = page.locator('.toast[data-kind="research-media-missed"]');
    // Each attempt's wait starts once the one before has ended (its images asked as well), a while after its
    // file was asked: moved on by that wait until the attempt is made (a wait started after a move needs another).
    const attempted = (n: number, wait: number) => expect(async () => {
        await page.clock.fastForward(wait);
        expect(asked.length).toBe(tries + n);
    }).toPass();
    await attempted(1, 5_000);
    await expect(notice).toHaveCount(0);
    await attempted(2, 30_000);
    await expect(notice).toBeVisible();
    // The research gives them now: Try again takes that very version with them, nothing asked.
    await page.unroute(/\/tree\.ged(\?|$)/);
    await page.unroute(/\/images(\?|$)/);
    await notice.getByRole('button', { name: 'Try again' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The guard lifted: the next write says it carries every file.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = (Object.values(dm.getData().persons) as any[]).find(x => x.firstName === 'Jan Václav');
        dm.updatePerson(p.id, { birthPlace: 'Brno' });
    });
    await page.evaluate(() => window.Strom.UI.researchSendNow());
    await expect.poll(() => bridge.posts.length).toBe(1);
    expect(bridge.postQueries?.[0].get('media')).toBe('app');
});

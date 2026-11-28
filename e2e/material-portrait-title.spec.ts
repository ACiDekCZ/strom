import { test, expect, Page } from '@playwright/test';
import { fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE } from './research-bridge.js';

/**
 * A portrait from the research's material keeps the research's title and kind
 * (1128): the file of the tree takes them as the research has them when it is
 * made, not as the remembered list had them — a send of the tree without them
 * would take them off in the research.
 */

const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };

const media = (page: Page) => page.evaluate(() => (Object.values(window.Strom.DataManager.getData().media ?? {}) as { title?: string; kind?: string }[])
    .map(a => ({ title: a.title ?? null, kind: a.kind ?? null })));

test.use({ viewport: { width: 1440, height: 900 } });

test('portrait from material: the title and kind given meanwhile stay in the research', async ({ page }) => {
    await page.clock.setFixedTime(new Date(2026, 10, 22, 14, 30));
    const material = fakeMaterial({ files: [materialFile(1, { persons: ['P0001'] })], people: PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: MATERIAL_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => { localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts })); },
        { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    const id = await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[])
        .find(p => p.firstName === 'Josef')!.id);
    await page.evaluate((id) => { const ui = window.Strom.UI as never as { pushDialog(n: string): void; showEditPersonModal(id: string): void };
        ui.pushDialog('person-modal'); ui.showEditPersonModal(id); }, id);
    await page.locator('#person-modal #photo-choose-btn').click();
    await expect(page.locator('#portrait-pick .portrait-pick-tile').first()).toBeVisible();
    // Titled in another window while the choice is open: the remembered list does not know it yet.
    Object.assign(material.files[0], { title: 'Svatba 1924', kind: 'photo' });
    await page.locator('#portrait-pick .portrait-pick-tile').first().click();
    await page.locator('.pe-overlay').getByRole('button', { name: 'Done' }).click();
    await page.locator('#person-modal #btn-save').click();
    await expect.poll(() => media(page)).toEqual([{ title: 'Svatba 1924', kind: 'photo' }]);
    await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
    await expect.poll(() => bridge.posts.length).toBeGreaterThan(0);
    const sent = bridge.posts.at(-1)!;
    expect(sent).toMatch(/\n\d TITL Svatba 1924\r?\n/);
    expect(sent).toMatch(/\n\d TYPE photo\r?\n/);
});

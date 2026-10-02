import { test, expect, Page } from '@playwright/test';
import { openApp, cardAction } from './helpers.js';

/**
 * Sources on a couple's own events (3.8): citing from the event editor in its
 * couple mode, the chips and ×, a new source titled from the event with the
 * pages of both partners to crop from, the source then listed in both
 * partners' sources and counted in the register, and deleting the source
 * taking the citation off the event. Invented data only.
 */

type Rec = Record<string, unknown>;

async function tree(page: Page, opts: { events?: Rec[]; jan?: Rec; marie?: Rec } = {}): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async (opts) => {
        window.Strom.SettingsManager.setAdvancedFields(true);
        const p = (id: string, extra: Record<string, unknown>) => ({
            id, gender: 'male', isPlaceholder: false, partnerships: ['u1'], parentIds: [], childIds: [], ...extra,
        });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                j: p('j', { firstName: 'Jan', lastName: 'Vlk', birthDate: '1862', ...opts.jan }),
                m: p('m', { firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', birthDate: '1869', ...opts.marie }),
            },
            partnerships: {
                u1: {
                    id: 'u1', person1Id: 'j', person2Id: 'm', status: 'married', childIds: [], startDate: '1888-02-14',
                    events: opts.events ?? [{ id: 'c1', type: 'banns', date: '1888-01-22', place: 'Dolní Lhota' }],
                },
            },
            sources: {
                s1: { id: 's1', title: 'Ohlášky Dolní Lhota', reference: 'fol. 3' },
                s2: { id: 's2', title: 'Sčítání 1900' },
            },
        } as never, 'Vlkovi');
    }, opts);
}

/** A JPEG data URL drawn in the page (a stand-in for a scanned page). */
function jpegDataUrl(page: Page, width: number, height: number): Promise<string> {
    return page.evaluate(({ width, height }) => {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#f4ecd8'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#333';
        for (let y = 30; y < height; y += 50) ctx.fillRect(30, y, width - 60, 5);
        return c.toDataURL('image/jpeg', 0.8);
    }, { width, height });
}

const getData = (page: Page) => page.evaluate(() => window.Strom.DataManager.getData() as unknown as {
    persons: Record<string, any>; partnerships: Record<string, any>; sources?: Record<string, any>;
});
const eventSources = async (page: Page) => (await getData(page)).partnerships.u1.events[0].sourceIds;

const panel = (page: Page) => page.locator('#relationships-modal');
const rows = (page: Page) => page.locator('#relationships-modal .couple-event-row');
const eventEditor = (page: Page) => page.locator('#event-editor-modal');
const chips = (page: Page) => page.locator('#event-sources-chips');
const picker = (page: Page) => page.locator('#source-picker-modal');
const sourceEditor = (page: Page) => page.locator('#source-editor-modal');
const cropper = (page: Page) => page.locator('.crop-overlay');

/** The relationships panel of a partner, then the couple's first event in the editor. */
async function openFirstEvent(page: Page, personId: string): Promise<void> {
    await page.evaluate((id) => window.Strom.UI.showRelationshipsPanel(id as never), personId);
    await expect(panel(page)).toBeVisible();
    await rows(page).first().click();
    await expect(eventEditor(page)).toBeVisible();
    await expect(page.locator('#event-editor-title')).toHaveText('Edit couple event');
    await expect(page.locator('#event-sources-section')).toBeVisible();
}

/** Save the event editor, then the panel (its session commits). */
async function saveBoth(page: Page): Promise<void> {
    await eventEditor(page).locator('button.primary').click();
    await expect(eventEditor(page)).toBeHidden();
    await panel(page).locator('button.primary').click();
    await expect(panel(page)).toBeHidden();
}

test.describe("sources on a couple's events", () => {
    test('cite an existing source from the editor: the chip, the panel row, both partners\' sources, the register and the viewer', async ({ page }) => {
        await tree(page);
        await openFirstEvent(page, 'm');
        await expect(chips(page)).toHaveText('No sources yet');

        await page.locator('#btn-cite-event').click();
        await expect(picker(page)).toHaveClass(/active/);
        await expect(picker(page).locator('#source-picker-fact')).toBeHidden();
        await expect(picker(page).locator('.source-picker-item')).toHaveCount(2);
        await picker(page).locator('.source-picker-item', { hasText: 'Ohlášky' }).click();
        await expect(picker(page)).not.toHaveClass(/active/);
        await expect(chips(page).locator('.source-chip-label')).toHaveText(['Ohlášky Dolní Lhota']);
        expect(await eventSources(page)).toEqual(['s1']);
        // Cited on the event, not on the marriage itself.
        expect((await getData(page)).partnerships.u1.sourceIds).toBeUndefined();
        // The row under the wedding counts it right away.
        await expect(rows(page).first().locator('.couple-event-sub')).toHaveText('1 source');

        // Once cited, the picker leaves it out.
        await page.locator('#btn-cite-event').click();
        await expect(picker(page).locator('.source-picker-item')).toHaveText([/Sčítání 1900/]);
        await picker(page).locator('.close-btn').click();

        await saveBoth(page);
        expect(await eventSources(page)).toEqual(['s1']);

        // Both partners list it, labelled with the event and its year.
        for (const name of ['Marie', 'Jan']) {
            await cardAction(page, name, 'sources');
            const dlg = page.locator('#person-sources-modal');
            await expect(dlg.locator('#person-sources-subtitle')).toContainText('1 source');
            const row = dlg.locator('.person-source-row');
            await expect(row).toHaveCount(1);
            await expect(row.locator('.person-source-title')).toHaveText('Ohlášky Dolní Lhota');
            await expect(row.locator('.person-source-meta')).toHaveText('Banns 1888');
            await expect(row.locator('.person-source-meta span')).toHaveAttribute('title', 'Jan Vlk & Marie Dvořáková — Banns');
            if (name === 'Jan') {
                // The row opens the viewer, which names the couple's event.
                await row.click();
                await expect(page.locator('#source-viewer-modal .viewer-cites li')).toHaveText(['Jan Vlk & Marie Dvořáková — Banns (1888)']);
                await page.keyboard.press('Escape');
                await expect(page.locator('#source-viewer-modal')).toBeHidden();
            }
            await dlg.locator('#person-sources-close').click();
            await expect(dlg).toHaveCount(0);
        }

        // The register counts the citation.
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        await expect(page.locator('#sources-list .source-row', { hasText: 'Ohlášky' }).locator('.source-count')).toHaveText('1×');
        await expect(page.locator('#sources-list .source-row', { hasText: 'Sčítání' }).locator('.source-count')).toHaveCount(0);
    });

    test('a new source from the event: titled from it, the pages of both partners to crop from, no "keep the whole page"; cited on the event', async ({ page }) => {
        await tree(page);
        const scanJ = await jpegDataUrl(page, 900, 600);
        const scanM = await jpegDataUrl(page, 800, 600);
        await page.evaluate(({ scanJ, scanM }) => {
            const dm = window.Strom.DataManager;
            dm.addAttachment('j' as never, { name: 'jan-list.jpg', mimeType: 'image/jpeg', dataUrl: scanJ, sizeBytes: 1000 });
            dm.addAttachment('m' as never, { name: 'ohlasky-57.jpg', mimeType: 'image/jpeg', dataUrl: scanM, sizeBytes: 1000 });
        }, { scanJ, scanM });
        const marieAtt = (await getData(page)).persons.m.attachments[0].id;

        await openFirstEvent(page, 'j');
        await page.locator('#btn-cite-event').click();
        await picker(page).getByRole('button', { name: 'New source…' }).click();
        await expect(sourceEditor(page)).toBeVisible();
        await expect(sourceEditor(page).locator('#input-source-title')).toHaveValue('Banns – Jan Vlk & Marie Dvořáková, 1888');

        const box = sourceEditor(page).locator('#source-excerpts');
        await box.getByRole('button', { name: 'Crop from attachment' }).click();
        const pages = box.locator('.excerpt-page-picker button');
        await expect(pages).toHaveCount(2);
        await expect(pages.nth(0)).toHaveAttribute('aria-label', 'jan-list.jpg');
        await expect(pages.nth(1)).toHaveAttribute('aria-label', 'ohlasky-57.jpg');
        await pages.nth(1).click();
        await cropper(page).locator('.crop-buttons .crop-apply').click();
        await expect(box.locator('.excerpt-item')).toHaveCount(1);

        // An uploaded page has no single person to be kept with: no checkbox.
        await box.getByRole('button', { name: /Add continuation/ }).click();
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            box.locator('.excerpt-adder-menu').getByRole('button', { name: 'Upload image' }).click(),
        ]);
        const png = Buffer.from((await jpegDataUrl(page, 600, 400)).split(',')[1], 'base64');
        await chooser.setFiles({ name: 'p2.jpg', mimeType: 'image/jpeg', buffer: png });
        await expect(cropper(page)).toBeVisible();
        await expect(cropper(page).locator('#crop-keep-page')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(cropper(page)).toHaveCount(0);
        await expect(sourceEditor(page)).toBeVisible();
        await expect(box.locator('.excerpt-item')).toHaveCount(1);

        await sourceEditor(page).getByRole('button', { name: 'Save' }).click();
        await expect(sourceEditor(page)).toBeHidden();
        await expect(picker(page)).not.toHaveClass(/active/);
        await expect(chips(page).locator('.source-chip-label')).toHaveText(['Banns – Jan Vlk & Marie Dvořáková, 1888']);
        await expect(chips(page).locator('img.source-chip-thumb')).toHaveCount(1);
        await expect(rows(page).first().locator('.couple-event-sub')).toHaveText('1 source');

        const data = await getData(page);
        const created = Object.values(data.sources ?? {}).find((s: any) => s.title.startsWith('Banns'));
        expect(data.partnerships.u1.events[0].sourceIds).toEqual([created.id]);
        expect(created.excerpts).toHaveLength(1);
        expect(created.excerpts[0].fromAttachmentId).toBe(marieAtt);
        // Nothing was added to either partner.
        expect(data.persons.j.attachments).toHaveLength(1);
        expect(data.persons.m.attachments).toHaveLength(1);
        expect(data.persons.j.sourceIds).toBeUndefined();
        expect(data.persons.m.sourceIds).toBeUndefined();
    });

    test('× on a chip uncites it from the event; Cancel of the panel takes the change back', async ({ page }) => {
        await tree(page, { events: [{ id: 'c1', type: 'banns', date: '1888-01-22', sourceIds: ['s1', 's2'] }] });
        await openFirstEvent(page, 'm');
        await expect(chips(page).locator('.source-chip')).toHaveCount(2);
        await chips(page).locator('.source-chip', { hasText: 'Ohlášky' }).locator('.source-chip-remove').click();
        await expect(chips(page).locator('.source-chip-label')).toHaveText(['Sčítání 1900']);
        expect(await eventSources(page)).toEqual(['s2']);

        await eventEditor(page).locator('button.primary').click();
        await expect(rows(page).first().locator('.couple-event-sub')).toHaveText('1 source');

        // Everything done inside the panel goes with its Cancel → Discard.
        await panel(page).locator('button.secondary', { hasText: 'Cancel' }).click();
        await page.locator('#confirm-discard-btn').click();
        await expect(panel(page)).toBeHidden();
        expect(await eventSources(page)).toEqual(['s1', 's2']);
    });

    // Regression: × in the couple event editor refreshed only the chips, so
    // the event's row under the wedding kept saying "2 sources" after Cancel.
    test('× then Cancel of the event editor: the panel row counts what is left', async ({ page }) => {
        await tree(page, { events: [{ id: 'c1', type: 'banns', date: '1888-01-22', sourceIds: ['s1', 's2'] }] });
        await openFirstEvent(page, 'm');
        await chips(page).locator('.source-chip', { hasText: 'Ohlášky' }).locator('.source-chip-remove').click();
        expect(await eventSources(page)).toEqual(['s2']);
        await eventEditor(page).locator('button.secondary', { hasText: 'Cancel' }).click();
        await expect(eventEditor(page)).toBeHidden();
        await expect(rows(page).first().locator('.couple-event-sub')).toHaveText('1 source');
    });

    test('deleting the source in the register takes it off the event, out of both partners\' sources and off the panel row', async ({ page }) => {
        await tree(page, { events: [{ id: 'c1', type: 'banns', date: '1888-01-22', sourceIds: ['s1', 's2'] }] });
        await page.evaluate(() => window.Strom.UI.showSourcesDialog());
        const catalog = page.locator('#sources-modal');
        await catalog.locator('.source-row', { hasText: 'Ohlášky' }).locator('.source-delete-btn').click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm.locator('#confirm-title')).toContainText('Delete source Ohlášky Dolní Lhota?');
        await expect(confirm.locator('#confirm-message')).toContainText('It is cited in 1 place; those citations are removed too.');
        await confirm.locator('#confirm-ok-btn').click();
        await expect(catalog.locator('.source-row')).toHaveCount(1);
        await catalog.locator('.close-btn').click();

        const data = await getData(page);
        expect(data.sources?.s1).toBeUndefined();
        expect(data.partnerships.u1.events[0].sourceIds).toEqual(['s2']);

        for (const name of ['Marie', 'Jan']) {
            await cardAction(page, name, 'sources');
            const dlg = page.locator('#person-sources-modal');
            await expect(dlg.locator('.person-source-title')).toHaveText(['Sčítání 1900']);
            await dlg.locator('#person-sources-close').click();
            await expect(dlg).toHaveCount(0);
        }
        await page.evaluate(() => window.Strom.UI.showRelationshipsPanel('m' as never));
        await expect(rows(page).first().locator('.couple-event-sub')).toHaveText('1 source');
        await rows(page).first().click();
        await expect(chips(page).locator('.source-chip-label')).toHaveText(['Sčítání 1900']);
    });

    // Regression: "Manage sources" opened the catalog beneath the event
    // editor (z-index 210), where it could not be clicked.
    test('deleting the source from "Manage sources" in the open editor takes it off the event at once', async ({ page }) => {
        await tree(page, { events: [{ id: 'c1', type: 'banns', date: '1888-01-22', sourceIds: ['s1', 's2'] }] });
        await openFirstEvent(page, 'm');
        await page.locator('#btn-cite-event').click();
        // Both are cited already: the picker has nothing left to offer.
        await expect(picker(page).locator('#source-picker-list')).toHaveText('No sources — create one');
        await picker(page).getByRole('button', { name: 'Manage sources' }).click();
        const catalog = page.locator('#sources-modal');
        await expect(catalog).toHaveClass(/active/);
        await catalog.locator('.source-row', { hasText: 'Ohlášky' }).locator('.source-delete-btn').click({ timeout: 3000 });
        await page.locator('#confirmation-modal #confirm-ok-btn').click();
        await expect(catalog.locator('.source-row')).toHaveCount(1);
        await catalog.locator('.close-btn').click();
        await expect(picker(page)).toHaveClass(/active/);
        await picker(page).locator('.close-btn').click();
        // The open editor's chips follow at once.
        await expect(chips(page).locator('.source-chip-label')).toHaveText(['Sčítání 1900']);
        expect(await eventSources(page)).toEqual(['s2']);
        await saveBoth(page);
        expect(await eventSources(page)).toEqual(['s2']);
    });
});

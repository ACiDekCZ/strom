import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, materialFixture3000, MATERIAL_FEATURES, openResearch, openResearchMenu, poll,
    researchGed, UUID, BRIDGE, FakeBridge, FakeMaterial, FakeMaterialFile, FakeMaterialBatch,
} from './research-bridge.js';
import { card } from './helpers.js';

/**
 * The materials window (spec 017 U5, §3): all the research's files and the
 * tree's attachments, filtered, grouped by batch (with folders) or by date,
 * as a grid or a list, a virtual list for thousands of files, lazy previews
 * from a shared queue, selecting several items and the states while the
 * research is not running. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek' };

interface Setup {
    features?: string[];
    files?: FakeMaterialFile[];
    batches?: FakeMaterialBatch[];
    people?: Record<string, string>;
    before?: (page: Page, material: FakeMaterial) => Promise<void>;
    down?: boolean;
}

async function setup(page: Page, opts: Setup = {}): Promise<{ bridge: FakeBridge; material: FakeMaterial }> {
    const material = fakeMaterial({ files: opts.files ?? [], batches: opts.batches ?? [], people: opts.people ?? PEOPLE });
    const bridge = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features ?? MATERIAL_FEATURES, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    if (opts.before) await opts.before(page, material);
    bridge.down = !!opts.down;
    await poll(page);
    return { bridge, material };
}

const rememberFeatures = (page: Page) => page.evaluate((uuid) =>
    localStorage.setItem(`strom-material-features:${uuid}`, JSON.stringify(['material.list', 'material.assign', 'material.thumb'])), UUID);

const janId = (page: Page) => page.evaluate(() =>
    (Object.values(window.Strom.DataManager.getData().persons) as { id: string; firstName: string }[]).find(p => p.firstName === 'Jan')!.id);

async function attach(page: Page, names: string[]): Promise<void> {
    const id = await janId(page);
    await page.evaluate(({ id, names, px }) => {
        for (const name of names) {
            window.Strom.DataManager.addAttachment(id as never, { name, mimeType: 'image/png', dataUrl: px, sizeBytes: 70 } as never);
        }
    }, { id, names, px: PX });
}

/** Hold the whole list (`GET /material` without a query): only the batches and `?batch=` answer. */
async function holdFullList(page: Page): Promise<void> {
    await page.route(url => url.href.startsWith(`${BRIDGE}/material`) && !/[?&](files|batch|person)=/.test(url.search), () => { /* never answered */ });
}

const win = (page: Page) => page.locator('#materials-modal');
const tiles = (page: Page) => win(page).locator('.mw-canvas .mw-tile');
const groupHead = (page: Page, name: string) => win(page).locator('.mw-canvas .mw-group', { has: page.locator('.mw-group-name', { hasText: name }) });

async function openWindow(page: Page, opts: { person?: string; batch?: string; group?: 'batch' | 'date' } = {}): Promise<void> {
    await page.evaluate((opts) => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials(opts), opts);
    await expect(win(page)).toBeVisible();
}

/** The research's writes asked by the window (instead of the dialogs of the next stage). */
async function recordActions(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { __acts: unknown[] };
        w.__acts = [];
        (window.Strom.UI as unknown as { materialAction: unknown }).materialAction = (id: string, items: { key: string }[], ctx: Record<string, unknown>) => {
            w.__acts.push({ id, keys: items.map(i => i.key), ctx: { ...ctx, batch: (ctx.batch as { id?: string } | undefined)?.id } });
            return true;
        };
    });
}

const actions = (page: Page) => page.evaluate(() => (window as unknown as { __acts: { id: string; keys: string[]; ctx: Record<string, unknown> }[] }).__acts);

const fixture = materialFixture3000();
const SHOWN = fixture.files.filter(f => !f.hidden);
const NO_PERSON = SHOWN.filter(f => f.persons.length === 0).length;

test.describe('Materials window: thousands of files', () => {
    test.use({ viewport: DESKTOP });

    async function big(page: Page): Promise<FakeMaterial> {
        const { material } = await setup(page, { files: fixture.files.map(f => ({ ...f })), batches: fixture.batches, people: fixture.people });
        await openWindow(page);
        await expect(win(page).locator('.mw-summary')).toHaveText(`${SHOWN.length.toLocaleString('en')} files · 1 batch · ${NO_PERSON.toLocaleString('en')} without a person`);
        return material;
    }

    test('only a part of 3000 tiles is drawn; the end of the list shows the last files', async ({ page }) => {
        await big(page);
        await win(page).locator('[data-mw="group-date"]').click();
        await expect(win(page)).toHaveAttribute('data-group', 'date');
        await expect(tiles(page).first()).toBeVisible();
        const drawn = await tiles(page).count();
        expect(drawn).toBeGreaterThan(10);
        expect(drawn).toBeLessThan(300);
        await win(page).locator('.mw-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
        // The oldest files (1 Sep) are last.
        await expect(win(page).locator('.mw-tile', { hasText: 'foto-2996.jpg' })).toBeVisible();
        expect(await tiles(page).count()).toBeLessThan(300);
        // A group's header stays on top while its files scroll.
        await expect(win(page).locator('.mw-sticky .mw-group-name')).toHaveCount(1);
    });

    test('"No person" and the search without diacritics filter over the remembered list', async ({ page }) => {
        await big(page);
        await win(page).locator('[data-mw="noperson"]').click();
        await expect(win(page).locator('.mw-summary')).toHaveText(`${NO_PERSON.toLocaleString('en')} files without a person, of ${SHOWN.length.toLocaleString('en')}`);
        await expect(win(page).locator('[data-mw="noperson"]')).toHaveAttribute('aria-pressed', 'true');
        await win(page).locator('[data-mw="noperson"]').click();
        await win(page).locator('#materials-search').fill('zdaru');
        const titled = SHOWN.filter(f => f.title?.startsWith('Pohled ze Žďáru')).length;
        await expect(groupHead(page, 'Krabice z půdy').locator('.mw-group-count')).toHaveText(`${titled} of ${(2600 - 10).toLocaleString('en')}`);
        await expect(tiles(page).first()).toContainText('Pohled ze Žďáru');
        await expect(win(page).locator('.mw-tile', { hasText: 'foto-' })).toHaveCount(0);
        await win(page).locator('#materials-search').fill('zzzz-nothing');
        await expect(win(page).locator('.mw-empty.is-nomatch')).toContainText('No file matches the filter.');
    });

    test('"Show hidden": the label under the tile; "Restore" asks the research through the hook', async ({ page }) => {
        await big(page);
        await recordActions(page);
        await win(page).locator('[data-mw="hidden"]').click();
        await expect(win(page).locator('.mw-summary')).toContainText('· 10 hidden');
        await win(page).locator('#materials-search').fill('sken-250.jpg');
        const tile = win(page).locator('.mw-tile.is-hidden');
        await expect(tile).toHaveCount(1);
        await expect(tile.locator('.mw-hidden-label')).toHaveText('Hidden · duplicate');
        await tile.locator('.mw-restore').click();
        const acts = await actions(page);
        expect(acts).toHaveLength(1);
        expect(acts[0].id).toBe('restore');
        expect(acts[0].keys).toHaveLength(1);
        expect(acts[0].ctx.where).toBe('window');
    });

    test('lazy previews: asked only for tiles in view, at 256 px', async ({ page }) => {
        const material = await big(page);
        await expect(tiles(page).first().locator('img')).toHaveCount(1);
        const asked = material.thumbAsks.length;
        expect(asked).toBeGreaterThan(0);
        expect(asked).toBeLessThan(200);
        expect(material.thumbAsks.every(a => a.endsWith('@256'))).toBe(true);
    });
});

test.describe('Materials window: loading, grouping and views', () => {
    test.use({ viewport: DESKTOP });

    test('batches first (?files=0), the open batch by ?batch=, its folders by path', async ({ page }) => {
        const { material } = await setup(page, {
            files: fixture.files.slice(0, 120).map(f => ({ ...f })), batches: fixture.batches, people: fixture.people,
            before: page => holdFullList(page),
        });
        await openWindow(page);
        await expect.poll(() => material.asks).toEqual(expect.arrayContaining(['files=0', 'batch=b-box-2600']));
        expect(material.asks.indexOf('files=0')).toBeLessThan(material.asks.indexOf('batch=b-box-2600'));
        const head = groupHead(page, 'Krabice z půdy');
        await expect(head).toBeVisible();
        await expect(head.locator('.mw-group-meta')).toContainText('“Půda, 1980”');
        // The batch's own files first, then the first folder open; others closed.
        const toggles = win(page).locator('.mw-canvas .mw-folder-toggle');
        await expect(toggles.first()).toContainText('Dopisy');
        await expect(toggles.first()).toHaveAttribute('aria-expanded', 'true');
        await expect(win(page).locator('.mw-tile', { hasText: 'sken-6.jpg' })).toBeVisible();
        await toggles.first().click();
        await expect(win(page).locator('.mw-canvas .mw-folder-name')).toHaveText(['Dopisy', 'Fotky / 1930', 'Fotky / 1950', 'Fotky / Svatby', 'Listiny', 'Pohlednice']);
        await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'false');
        await toggles.nth(1).click();
        await expect(toggles.nth(1)).toHaveAttribute('aria-expanded', 'true');
        await expect(win(page).locator('.mw-tile', { hasText: 'sken-8.jpg' })).toBeVisible();
        // Closing the batch leaves only its header.
        await head.locator('.mw-group-toggle').click();
        await expect(win(page).locator('.mw-canvas .mw-folder')).toHaveCount(0);
    });

    test('grouping by date and list view are remembered', async ({ page }) => {
        await setup(page, {
            files: [
                materialFile(1, { batch: 'b-a', path: 'a/scan-1.jpg', at: '2026-10-10T10:00:00.000Z' }),
                materialFile(2, { at: '2026-10-12T10:00:00.000Z', persons: ['P0003'] }),
                materialFile(3, { at: '2026-10-12T11:00:00.000Z' }),
            ],
            batches: [{ id: 'b-a', name: 'Krabice', at: '2026-10-10T10:00:00.000Z' }],
        });
        await openWindow(page);
        await expect(win(page)).toHaveAttribute('data-group', 'batch');
        await win(page).locator('[data-mw="group-date"]').click();
        await expect(win(page)).toHaveAttribute('data-group', 'date');
        const days = win(page).locator('.mw-canvas .mw-group-name');
        await expect(days).toHaveText([/10\/12\/2026|12\/10\/2026/, /10\/10\/2026/]);
        await expect(win(page).locator('.mw-canvas .mw-group-meta').nth(1)).toContainText('Krabice');
        await win(page).locator('[data-mw="view-list"]').click();
        await expect(win(page).locator('.mw-canvas .mw-li')).toHaveCount(3);
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(0);
        expect(JSON.parse(await page.evaluate(() => localStorage.getItem('strom.materials.view') ?? '{}'))).toEqual({ group: 'date', view: 'list' });
        await win(page).locator('.close-btn').click();
        await openWindow(page);
        await expect(win(page)).toHaveAttribute('data-group', 'date');
        await expect(win(page).locator('.mw-canvas .mw-li')).toHaveCount(3);
    });
});

test.describe('Materials window: entry points', () => {
    test.use({ viewport: DESKTOP });

    test('from the person: their filter as an active chip; from "Show in batch": the batch chip', async ({ page }) => {
        await setup(page, {
            files: [
                materialFile(1, { persons: ['P0003'], batch: 'b-box', path: 'Dopisy/a.jpg', at: '2026-10-20T10:00:00.000Z' }),
                ...[2, 3, 4, 5, 6, 7].map(n => materialFile(n, { persons: ['P0003'] })),
                materialFile(8, { persons: ['P0001'] }),
            ],
            batches: [{ id: 'b-box', name: 'Krabice', at: '2026-10-10T10:00:00.000Z' }],
        });
        await page.evaluate((id) => {
            const ui = window.Strom.UI as unknown as { pushDialog(id: string): void; showEditPersonModal(id: string): void };
            ui.pushDialog('person-modal');
            ui.showEditPersonModal(id);
        }, await janId(page));
        const section = page.locator('#materials-section');
        await section.locator('.materials-all').click();
        await expect(win(page)).toHaveAttribute('data-person', 'P0003');
        const chip = win(page).locator('.mw-chip.is-active', { hasText: 'Person: Jan Fíšek' });
        await expect(chip).toBeVisible();
        // Filtered, every group is open: the batch's file and the 6 single ones.
        await expect(tiles(page)).toHaveCount(7);
        await chip.locator('.mw-chip-x').click();
        await expect(win(page).locator('.mw-chip.is-active')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(win(page)).toHaveCount(0);

        await section.locator('.material-row', { hasText: 'Krabice' }).locator('.material-more').click();
        await page.locator('#materials-item-menu [data-action="showInBatch"]').click();
        await expect(win(page)).toHaveAttribute('data-batch', 'b-box');
        await expect(win(page).locator('.mw-chip.is-active', { hasText: 'Batch: Krabice' })).toBeVisible();
        await expect(tiles(page)).toHaveCount(1);
    });

    test('the Research menu opens the whole overview', async ({ page }) => {
        await setup(page, { files: [materialFile(1), materialFile(2, { persons: ['P0003'] })] });
        await openResearchMenu(page, { expandMore: true });
        await page.locator('#research-item-materials').click();
        await expect(win(page)).toBeVisible();
        await expect(win(page).locator('.mw-chip.is-active')).toHaveCount(0);
        await expect(tiles(page)).toHaveCount(2);
    });
});

test.describe('Materials window: selecting', () => {
    test.use({ viewport: DESKTOP });

    const files = [
        ...[1, 2, 3].map(n => materialFile(n, { batch: 'b-box', name: `kořen-${n}.jpg`, path: `kořen-${n}.jpg` })),
        ...[4, 5, 6].map(n => materialFile(n, { batch: 'b-box', name: `dopis-${n}.jpg`, path: `Dopisy/dopis-${n}.jpg` })),
        materialFile(7, { name: 'volny.jpg', at: '2026-09-01T10:00:00.000Z' }),
    ];
    const batches = [{ id: 'b-box', name: 'Krabice', at: '2026-10-10T10:00:00.000Z' }];

    test('click, Shift+click, "Select whole batch", the count in the bar; a tree attachment stays out', async ({ page }) => {
        await setup(page, { files, batches, before: page => attach(page, ['jen-strom.png']) });
        await recordActions(page);
        await openWindow(page);
        await win(page).locator('[data-mw="select"]').click();
        await expect(win(page)).toHaveClass(/is-selecting/);
        const bar = win(page).locator('.mw-selbar');
        await expect(bar).toBeVisible();
        await expect(bar.locator('.mw-selcount')).toHaveText('Nothing selected');
        await win(page).locator('.mw-tile', { hasText: 'kořen-1.jpg' }).click();
        await win(page).locator('.mw-tile', { hasText: 'kořen-3.jpg' }).click({ modifiers: ['Shift'] });
        await expect(bar.locator('.mw-selcount')).toHaveText('3 files selected');
        await expect(win(page).locator('.mw-tile.is-selected')).toHaveCount(3);
        await expect(win(page).locator('.mw-tile[aria-selected="true"]')).toHaveCount(3);
        await bar.locator('.mw-selwhole').click();
        await expect(bar.locator('.mw-selcount')).toHaveText('6 files selected');
        // The tree's attachment: counted, said to stay, left out of the action.
        await win(page).locator('.mw-group-toggle', { hasText: 'In the tree' }).click();
        await win(page).locator('.mw-tile', { hasText: 'jen-strom.png' }).click();
        await expect(bar.locator('.mw-selcount')).toHaveText('7 files selected');
        await expect(win(page).locator('.mw-skipped')).toHaveText('1 only in the tree stay unchanged.');
        await bar.locator('[data-mw="sel-assign"]').click();
        const acts = await actions(page);
        expect(acts[0].id).toBe('assign');
        expect(acts[0].keys).toHaveLength(6);
        expect(acts[0].ctx.selection).toBe(true);
        // Esc ends selecting first, then closes.
        await page.keyboard.press('Escape');
        await expect(bar).toBeHidden();
        await expect(win(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(win(page)).toHaveCount(0);
    });

    test('a batch\'s ⋯: select it whole, its actions go to the hook with the batch', async ({ page }) => {
        await setup(page, { files, batches });
        await recordActions(page);
        await openWindow(page);
        await win(page).locator('.mw-canvas [data-mw="batch-menu"]').first().click();
        const menu = page.locator('.mw-pop-batchMenu');
        await expect(menu.locator('[data-action]')).toHaveText(['Select whole batch (6)', 'Assign whole batch to a person…', 'Hide whole batch…', 'Open the batch in the research ↗']);
        await menu.locator('[data-action="hide"]').click();
        const acts = await actions(page);
        expect(acts[0]).toMatchObject({ id: 'hide', ctx: { batch: 'b-box', where: 'window' } });
        expect(acts[0].keys).toHaveLength(6);
        await win(page).locator('.mw-canvas [data-mw="folder-menu"]').first().click();
        await page.locator('.mw-pop-folderMenu [data-action="select"]').click();
        await expect(win(page).locator('.mw-selbar .mw-selcount')).toHaveText('3 files selected');
    });

    test('an older research (no assigning): no Select, no "Show hidden"', async ({ page }) => {
        await setup(page, { files, batches, features: ['material.list'] });
        await openWindow(page);
        await expect(tiles(page).first()).toBeVisible();
        await expect(win(page).locator('[data-mw="select"]')).toHaveCount(0);
        await expect(win(page).locator('[data-mw="hidden"]')).toHaveCount(0);
        await tiles(page).first().click({ modifiers: ['Shift'] });
        await expect(win(page).locator('.mw-selbar')).toBeHidden();
    });
});

test.describe('Materials window: the research not running', () => {
    test.use({ viewport: DESKTOP });

    test('with a remembered list: the strip with its time, the writes off', async ({ page }) => {
        const { bridge } = await setup(page, {
            files: [materialFile(1, { batch: 'b-box', path: 'a.jpg' }), materialFile(2, { persons: ['P0003'] })],
            batches: [{ id: 'b-box', name: 'Krabice', at: '2026-10-10T10:00:00.000Z' }],
        });
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-story')).toHaveText('Materials 1');
        bridge.down = true;
        await poll(page);
        await openWindow(page);
        await expect(win(page)).toHaveAttribute('data-state', 'stale');
        await expect(win(page).locator('.mw-status')).toContainText('The research is not running · state from');
        // The first group (the batch) is open, the single files closed.
        await expect(tiles(page)).toHaveCount(1);
        await win(page).locator('.mw-canvas [data-mw="batch-menu"]').first().click();
        await expect(page.locator('.mw-pop-batchMenu [data-action="assign"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('.mw-pop-batchMenu [data-action="select"]')).not.toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Escape');
        await win(page).locator('[data-mw="select"]').click();
        await tiles(page).first().click();
        await expect(win(page).locator('[data-mw="sel-assign"]')).toHaveAttribute('aria-disabled', 'true');
        // Running again: the strip goes, quietly.
        bridge.down = false;
        await poll(page);
        await expect(win(page).locator('.mw-status')).toBeHidden();
        await expect(win(page).locator('[data-mw="sel-assign"]')).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('never listed: the empty state and the tree\'s attachments', async ({ page }) => {
        await setup(page, { down: true, before: async page => { await rememberFeatures(page); await attach(page, ['a.png', 'b.png']); } });
        await openWindow(page);
        await expect(win(page)).toHaveAttribute('data-state', 'nocache');
        await expect(win(page).locator('.mw-empty.is-nocache')).toContainText('Materials from the archive load once the research runs.');
        const tree = groupHead(page, 'Attachments in the tree');
        await expect(tree).toBeVisible();
        await expect(tree.locator('.mw-group-count')).toHaveText('2');
        await expect(tiles(page)).toHaveCount(2);
    });
});

test.describe('Materials window: previews', () => {
    test.use({ viewport: DESKTOP });

    test('a type without previews (415) keeps its icon and is not asked again', async ({ page }) => {
        const tif = materialFile(1, { name: 'sken.tif', mime: 'image/tiff', at: '2026-10-20T10:00:00.000Z' });
        const { material } = await setup(page, { files: [tif, materialFile(2), materialFile(3)] });
        await openWindow(page);
        const tile = win(page).locator('.mw-tile', { hasText: 'sken.tif' });
        await expect(win(page).locator('.mw-tile img')).toHaveCount(2);
        await expect(tile.locator('img')).toHaveCount(0);
        await expect(tile.locator('.mw-type')).toHaveText('TIF');
        await win(page).locator('[data-mw="view-list"]').click();
        await win(page).locator('[data-mw="view-grid"]').click();
        await expect(win(page).locator('.mw-tile img')).toHaveCount(2);
        expect(material.thumbAsks.filter(a => a.startsWith(tif.sha))).toEqual([`${tif.sha}@256`]);
    });

    test('a busy research: the strip with Pause / Resume', async ({ page }) => {
        const { material } = await setup(page, { files: Array.from({ length: 6 }, (_, i) => materialFile(i + 1)) });
        material.thumbBusy = true;
        await openWindow(page);
        const strip = win(page).locator('.mw-thumbs');
        await expect(strip).toBeVisible();
        await expect(strip).toContainText('Loading previews');
        await strip.locator('[data-mw="thumbs-pause"]').click();
        await expect(strip).toContainText('Previews paused');
        const asked = material.thumbAsks.length;
        material.thumbBusy = false;
        await page.waitForTimeout(1500);
        expect(material.thumbAsks.length).toBe(asked);
        await strip.locator('[data-mw="thumbs-resume"]').click();
        await expect(win(page).locator('.mw-tile img')).toHaveCount(6);
        await expect(strip).toBeHidden();
    });
});

test.describe('Materials window: sizes', () => {
    const files = Array.from({ length: 12 }, (_, i) => materialFile(i + 1));

    test('390: a full-screen sheet with 3 columns', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await setup(page, { files });
        await openWindow(page);
        const box = await win(page).locator('.materials-window').boundingBox();
        expect(box?.width).toBe(390);
        expect(box?.height).toBe(844);
        await expect(win(page).locator('.mw-canvas .mw-r-tiles').first().locator('.mw-tile')).toHaveCount(3);
        await expect(win(page).locator('.mw-filters-btn')).toBeVisible();
        await expect(win(page).locator('.mw-tile-title').first()).toBeHidden();
    });

    test('820: the whole area, filters in a sheet', async ({ page }) => {
        await page.setViewportSize({ width: 820, height: 1180 });
        await setup(page, { files });
        await openWindow(page);
        const box = await win(page).locator('.materials-window').boundingBox();
        expect(box?.width).toBe(820);
        await expect(win(page).locator('.mw-filters-btn')).toBeVisible();
        await expect(win(page).locator('.mw-chips [data-mw="noperson"]')).toBeHidden();
        await win(page).locator('.mw-filters-btn').click();
        const sheet = page.locator('.mw-pop-sheet');
        await expect(sheet).toBeVisible();
        await sheet.locator('[data-pop="noperson"]').click();
        await expect(win(page).locator('.mw-filters-btn')).toHaveText('Filters · 1');
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(win(page)).toBeVisible();
    });

    test('1440: the toolbar with all chips, tiles with names', async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await setup(page, { files });
        await openWindow(page);
        const box = await win(page).locator('.materials-window').boundingBox();
        expect(box?.width).toBe(1200);
        await expect(win(page).locator('.mw-filters-btn')).toBeHidden();
        await expect(win(page).locator('[data-mw="person"]')).toBeVisible();
        await expect(win(page).locator('.mw-tile-title').first()).toBeVisible();
        // Keyboard: arrows move through the tiles; Space selects in select mode.
        await win(page).locator('[data-mw="select"]').click();
        await tiles(page).first().focus();
        await page.keyboard.press('ArrowRight');
        await expect(tiles(page).nth(1)).toBeFocused();
        await page.keyboard.press(' ');
        await expect(tiles(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    });
});

import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, materialFile, MATERIAL_FEATURES, openResearch, poll, researchGed, UUID, BRIDGE, FakeMaterialFile,
} from './research-bridge.js';

/**
 * The file of a source in the Materials window (spec 102 §7, the research's
 * gate `material.sourceOf`, `uses.of` of `GET /material` as Strom Research
 * 1.35 sends it): the tile's tag "File of a source" with the people citing
 * the source and "In the tree" by the source's `inTree`; the list's Source
 * column with the tag and the source's title; "Where used" with "File of a
 * source" (the source the tree has is a link to it, without a mark), how the
 * file belongs to it and who cites it; "Without a person" leaves it out.
 * Without the gate the files are as before. A phone (390) shows the tag in
 * the list row's people. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const PEOPLE = { P0001: 'Josef Fíšek', P0002: 'Anna Svobodová', P0003: 'Jan Fíšek', P0042: 'Ilsa Talvanenová (1901–1980)' };
const GATED = [...MATERIAL_FEATURES, 'material.uses', 'material.sourceOf'];
const OLDER = [...MATERIAL_FEATURES, 'material.uses'];

/** S0001 is the research GED's register (in the tree); S0009 a source the tree does not get. */
function files(): FakeMaterialFile[] {
    return [
        materialFile(1, { uses: { excerpts: 0, sources: ['S0001'], tasks: 0, of: [
            { source: 'S0001', via: 'input', title: 'Oddací matrika Čapkov', cited: ['P0001', 'P0002'], citedCount: 3, inTree: true },
        ] } }),
        materialFile(2, { uses: { excerpts: 0, sources: ['S0009'], tasks: 0, of: [
            { source: 'S0009', via: 'media', title: 'Sčítání lidu Talvany 1921', cited: ['P0042'], citedCount: 1, inTree: false },
        ] } }),
        materialFile(3),
    ];
}

const win = (page: Page) => page.locator('#materials-modal');
const tile = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-tile', { hasText: text });
const row = (page: Page, text: string) => win(page).locator('.mw-canvas .mw-li', { hasText: text });
const viewer = (page: Page) => page.locator('#attachment-overlay');
const panel = (page: Page) => page.locator('#image-viewer-panel');
const uses = (page: Page) => panel(page).locator('.mv-uses');

async function research(page: Page, features: string[], opts: { list?: boolean } = {}): Promise<void> {
    const material = fakeMaterial({ files: files(), batches: [], people: PEOPLE });
    await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features, material, treeGed: researchGed() });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts, list }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
        if (list) localStorage.setItem('strom.materials.view', JSON.stringify({ view: 'list' }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS, list: !!opts.list });
    await poll(page);
    await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
    await expect(win(page)).toBeVisible();
}

test.describe('The file of a source in Materials (material.sourceOf)', () => {
    test.use({ viewport: DESKTOP });

    test('tiles: the tag with the people citing the source, "In the tree" by the source; "Without a person" leaves them out', async ({ page }) => {
        await research(page, GATED);
        const register = tile(page, 'scan-1.jpg');
        await expect(register.locator('.mw-tile-persons')).toHaveText('File of a sourceJosef Fíšek +2');
        await expect(register.locator('.mw-tile-persons')).not.toHaveClass(/is-none/);
        await expect(register.locator('.mw-srcof-tag')).toHaveText('File of a source');
        await expect(register.locator('.mw-intree')).toHaveText('In the tree');
        await expect(register.locator('.mw-places')).toHaveText('1');
        // A source the tree does not get: the tag and its people, not in the tree.
        const census = tile(page, 'scan-2.jpg');
        await expect(census.locator('.mw-tile-persons')).toHaveText('File of a sourceIlsa Talvanenová');
        await expect(census.locator('.mw-intree')).toHaveCount(0);
        await expect(tile(page, 'scan-3.jpg').locator('.mw-tile-persons')).toHaveText('No person');

        await expect(win(page).locator('[data-mw="noperson"]')).toHaveText('No person · 1');
        await win(page).locator('[data-mw="noperson"]').click();
        await expect(win(page).locator('.mw-canvas .mw-tile')).toHaveCount(1);
        await expect(tile(page, 'scan-3.jpg')).toBeVisible();
    });

    test('list rows: Source with the tag and the title, In the tree, the places', async ({ page }) => {
        await research(page, GATED, { list: true });
        const register = row(page, 'scan-1.jpg');
        await expect(register.locator('.mw-li-source')).toHaveText('File of a source Oddací matrika Čapkov');
        await expect(register.locator('.mw-li-source')).not.toHaveClass(/is-none/);
        await expect(register.locator('.mw-li-persons')).toHaveText('File of a sourceJosef Fíšek +2');
        // The tag before the people is only for a phone (the Source column says it here).
        await expect(register.locator('.mw-li-persons .mw-li-srctag')).toBeHidden();
        await expect(register.locator('.mw-li-intree')).toHaveText('In the tree');
        await expect(register.locator('.mw-li-used')).toHaveText('1 place');
        await expect(row(page, 'scan-2.jpg').locator('.mw-li-intree')).toHaveText('only in the archive');
        await expect(row(page, 'scan-3.jpg').locator('.mw-li-source')).toHaveClass(/is-none/);
    });

    test('Where used: "File of a source" with its link to the tree\'s source, how and who cites it; the sentence', async ({ page }) => {
        await research(page, GATED);
        await tile(page, 'scan-1.jpg').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(uses(page).locator('.mv-uses-count')).toHaveText('1 source');
        // In the tree only through the source: no "In the tree" with "Not in the tree yet.".
        await expect(uses(page).locator('.mv-uses-sub')).toHaveText(['File of a source', 'In the archive']);
        await expect(uses(page).locator('.mv-uses-none')).toHaveCount(0);
        const link = uses(page).locator('.mv-use-link[data-use="sourceof"]');
        await expect(link).toHaveText('Oddací matrika Čapkov');
        // A link that stays in the app: no mark.
        await expect(link.locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        await expect(uses(page).locator('.mv-uses-sourceof .mv-use-sub')).toHaveText('the file is its source · Cited by: Josef Fíšek, + 2');
        await expect(uses(page).locator('.mv-uses-sourceof .mv-use-sub .is-person')).toHaveText('Josef Fíšek');
        await expect(panel(page).locator('.mv-body > .mv-sentence').first()).toHaveText('The file is in the research; in the tree it is there through a source.');
        await link.click();
        await expect(viewer(page)).not.toHaveClass(/active/);
        await expect(page.locator('#source-viewer-modal')).toBeVisible();
        await expect(page.locator('#source-viewer-modal')).toContainText('Oddací matrika Čapkov');
    });

    test('Where used: a source the tree does not have is its title without a link; the file stays "Not in the tree yet."', async ({ page }) => {
        await research(page, GATED);
        await tile(page, 'scan-2.jpg').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(uses(page).locator('.mv-uses-sub')).toHaveText(['File of a source', 'In the tree', 'In the archive']);
        await expect(uses(page).locator('.mv-uses-sourceof .mv-use-text')).toHaveText('Sčítání lidu Talvany 1921');
        await expect(uses(page).locator('.mv-uses-sourceof .mv-use-link')).toHaveCount(0);
        await expect(uses(page).locator('.mv-uses-sourceof .mv-use-sub')).toHaveText('same content as the source’s media · Cited by: Ilsa Talvanenová');
        await expect(uses(page).locator('.mv-uses-none')).toContainText('Not in the tree yet.');
    });

    test('an older research without the gate: the files as before', async ({ page }) => {
        await research(page, OLDER);
        await expect(tile(page, 'scan-1.jpg').locator('.mw-tile-persons')).toHaveText('No person');
        await expect(win(page).locator('.mw-srcof-tag')).toHaveCount(0);
        await expect(tile(page, 'scan-1.jpg').locator('.mw-intree')).toHaveCount(0);
        await expect(win(page).locator('[data-mw="noperson"]')).toHaveText('No person · 3');
        await tile(page, 'scan-1.jpg').click();
        await expect(viewer(page)).toHaveClass(/active/);
        await expect(uses(page).locator('.mv-uses-sourceof')).toHaveCount(0);
        await expect(uses(page).locator('.mv-uses-sub')).toHaveText(['In the tree', 'In the archive']);
    });
});

test.describe('The file of a source on a narrow screen', () => {
    // A touch phone shows the research's material only on the computer (the window's note); the width alone here.
    test.use({ viewport: PHONE });

    test('the list row shows the tag before the people (no Source column); nothing wider than the screen', async ({ page }) => {
        await research(page, GATED, { list: true });
        const register = row(page, 'scan-1.jpg');
        await expect(register.locator('.mw-li-persons .mw-li-srctag')).toBeVisible();
        await expect(register.locator('.mw-li-persons')).toHaveText('File of a sourceJosef Fíšek +2');
        await expect(register.locator('.mw-li-source')).toBeHidden();
        const wide = await page.evaluate(() => {
            const el = document.querySelector('#materials-modal .mw-scroll') as HTMLElement | null;
            return el ? el.scrollWidth - el.clientWidth : 0;
        });
        expect(wide).toBeLessThanOrEqual(0);
        // A redraw of the window (names or the research's status arriving) replaces the rows: a box read
        // between finding the cell and measuring it is null, so the right edge is read again until it is there.
        await expect.poll(async () => {
            const box = await register.locator('.mw-li-persons').boundingBox();
            return box ? box.x + box.width : Infinity;
        }).toBeLessThanOrEqual(PHONE.width);
    });
});

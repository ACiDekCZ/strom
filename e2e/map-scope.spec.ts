/**
 * The map's scope Selection (spec 098 §3, §4, §10): the segment's third
 * part, the choice of a selection under it, the map of the selection's
 * people (points, counts, the place's bubble, the ancestors' path, the
 * toolbar's search), its empty states and the phone's "Scope: … ▾".
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedPathTree, setYear, stubTiles } from './map-path-fixture.js';

/** Lists of people of the path tree (map-path-fixture): ids are the fixture's keys. */
async function seedLists(page: Page): Promise<void> {
    await page.evaluate(() => {
        const D = window.Strom.DataManager;
        D.createPersonList({ name: 'Quillfen line', dynamic: false, personIds: ['tamsin', 'orrin', 'corwen', 'ansel'] as never[], sort: 'manual' });
        D.createPersonList({ name: 'Nobody yet', dynamic: false, personIds: [] as never[], sort: 'manual' });
        D.createPersonList({ name: 'Without places', dynamic: false, personIds: ['elowen'] as never[], sort: 'manual' });
        D.createPersonList({
            name: 'Letters to the parish offices of Lambda, Mu and the neighbouring villages', dynamic: false,
            personIds: ['ansel', 'ivar'] as never[], sort: 'manual',
        });
    });
}

async function setup(page: Page, opts: { timeOn?: boolean } = {}): Promise<void> {
    await stubTiles(page);
    await seedPathTree(page, {}, { timeOn: opts.timeOn ?? false });
    await seedLists(page);
}

const sel = (page: Page): Locator => page.locator('#map-scope-sel');
const pop = (page: Page): Locator => page.locator('#map-container .map-scope-pick .sp-rodpick-pop');
const marker = (page: Page, key: string): Locator => page.locator(`.map-marker[data-key="${key}"]`);

/** Pick a list in the open choice. */
async function pickList(page: Page, name: string): Promise<void> {
    await expect(pop(page)).toBeVisible();
    await pop(page).locator('li.sp-selpick-row[data-sec="lists"]', { hasText: name }).locator('button').click();
    await expect(pop(page)).toHaveCount(0);
}

test.describe('the map scope Selection on a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('three parts; without a selection the part opens the choice; a list picked is the scope @smoke', async ({ page }) => {
        await setup(page);
        await expect(page.locator('.map-scope')).toHaveAttribute('role', 'group');
        await expect(page.locator('.map-scope')).toHaveAttribute('aria-label', 'Map scope');
        await expect(page.locator('.map-scope .sel-opt')).toHaveText(['This view', 'Selection▾', 'Whole tree']);
        await expect(sel(page)).toHaveAttribute('aria-haspopup', 'listbox');
        await expect(page.locator('#map-scope-tree')).toHaveClass(/active/);

        // No selection: the part opens the choice, the scope stays.
        await sel(page).click();
        await expect(pop(page)).toBeVisible();
        await expect(sel(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#map-scope-tree')).toHaveClass(/active/);
        await pickList(page, 'Quillfen line');

        await expect(sel(page)).toHaveClass(/active/);
        await expect(page.locator('#map-scope-tree')).not.toHaveClass(/active/);
        await expect(sel(page).locator('.map-scope-name')).toHaveText(/Quillfen line$/);
        await expect(sel(page).locator('.map-scope-n')).toHaveText('· 4');
        await expect(sel(page)).toHaveAttribute('aria-label', /^Scope: selection .*Quillfen line, 4 people$/);
        // Only the selection's places: Zeta, Eta, Iota, Lambda (not Theta, Kappa, Mu).
        await expect(page.locator('.map-marker')).toHaveCount(4);
        for (const k of ['zeta', 'eta', 'iota', 'lambda']) await expect(marker(page, k)).toBeVisible();
        await expect(page.locator('#map-status')).toContainText('4');

        // This view, then the part not chosen with a selection: the scope at once, no choice.
        await page.locator('#map-scope-view').click();
        await expect(page.locator('#map-scope-view')).toHaveClass(/active/);
        await sel(page).click();
        await expect(sel(page)).toHaveClass(/active/);
        await expect(pop(page)).toHaveCount(0);
        // The part chosen: the choice; Escape closes it back to the part.
        await sel(page).click();
        await expect(pop(page)).toBeVisible();
        // Escape belongs to the choice once the keyboard is in it (its search field, focused a frame after it opens).
        await expect(page.locator('#map-container .map-scope-pick .sp-rodpick-q')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(pop(page)).toHaveCount(0);
        await expect(sel(page)).toBeFocused();
        // ↓ opens it from the keyboard.
        await page.keyboard.press('ArrowDown');
        await expect(pop(page)).toBeVisible();
        // No selection: back to This view.
        await pop(page).locator('.sp-rodpick-tree button').click();
        await expect(page.locator('#map-scope-view')).toHaveClass(/active/);
        await expect(sel(page)).toHaveText('Selection▾');
    });

    test('a long name is cut with an ellipsis only where the corner\'s room ends, its whole in the title', async ({ page }) => {
        // A narrow window: the name longer than the room left of the zoom buttons (a wide one shows it whole, selection-room.spec.ts).
        await page.setViewportSize({ width: 700, height: 900 });
        await setup(page);
        await sel(page).click();
        await pickList(page, 'Letters to the parish offices');
        const name = sel(page).locator('.map-scope-name');
        await expect(name).toContainText('Letters to the parish offices');
        await expect.poll(() => name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        // Cut at the room's end: the switch ends before the zoom buttons, the name wider than the old fixed 200 px.
        const seg = (await page.locator('.map-scope').boundingBox())!;
        expect(seg.x + seg.width).toBeLessThanOrEqual((await page.locator('.map-controls').boundingBox())!.x);
        expect((await name.boundingBox())!.width).toBeGreaterThan(200);
        await expect(sel(page)).toHaveAttribute('title', /Letters to the parish offices of Lambda, Mu and the neighbouring villages/);
        await expect(marker(page, 'lambda')).toBeVisible();
        await expect(marker(page, 'mu')).toBeVisible();
        await expect(page.locator('.map-marker')).toHaveCount(2);
    });

    test('the Places dialog from the map shows its scope, the selection chosen; a part changes the dialog\'s list and the map', async ({ page }) => {
        await setup(page);
        await sel(page).click();
        await pickList(page, 'Quillfen line');
        await page.evaluate(() => window.Strom.UI.showPlacesManager());
        const dialog = page.locator('#places-modal');
        const scope = dialog.locator('.places-scope');
        await expect(scope).toHaveAttribute('role', 'group');
        await expect(scope).toHaveAttribute('aria-label', 'Map scope');
        await expect(scope.locator('.sel-opt')).toHaveText(['This view', /Quillfen line\s*· 4/, 'Whole tree']);
        const part = (s: string): Locator => scope.locator(`[data-places-scope="${s}"]`);
        await expect(part('sel')).toHaveAttribute('aria-pressed', 'true');
        await expect(part('sel')).toHaveClass(/active/);
        await expect(part('sel')).toHaveAttribute('aria-label', /Quillfen line, 4 people/);
        await expect(part('tree')).toHaveAttribute('aria-pressed', 'false');
        await expect(dialog.locator('.places-total')).toHaveText('4 places');

        // Whole tree: the dialog lists every place, the map behind it has the same scope.
        await part('tree').click();
        await expect(part('tree')).toHaveAttribute('aria-pressed', 'true');
        await expect(part('tree')).toBeFocused();
        await expect(part('sel')).toHaveAttribute('aria-pressed', 'false');
        await expect(dialog.locator('.places-total')).toHaveText('7 places');
        await expect(page.locator('#map-scope-tree')).toHaveClass(/active/);

        // Back to the selection.
        await part('sel').click();
        await expect(part('sel')).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.locator('.places-total')).toHaveText('4 places');
        await expect(sel(page)).toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);

        // Opened for the whole tree from elsewhere (a person's page, the tree's menu): no scope to show.
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.places-scope')).toHaveCount(0);
    });

    test('the place\'s bubble: the selection\'s people, the others as one line with Whole tree', async ({ page }) => {
        await setup(page);
        await sel(page).click();
        await pickList(page, 'Quillfen line');
        // Zeta: Tamsin (selection) and Bram (outside).
        await marker(page, 'zeta').click();
        const popup = page.locator('.map-popup');
        await expect(popup).toBeVisible();
        await expect(popup).toContainText('Tamsin');
        await expect(popup).not.toContainText('Bram');
        await expect(popup.locator('.map-popup-outside')).toContainText('and 1 person outside the selection');
        // A place of the selection's people alone: no such line.
        await marker(page, 'lambda').click();
        await expect(popup).toContainText('Ansel');
        await expect(popup.locator('.map-popup-outside')).toHaveCount(0);
        await marker(page, 'zeta').click();
        await popup.locator('.map-popup-whole').click();
        await expect(page.locator('#map-scope-tree')).toHaveClass(/active/);
        await expect(popup).toContainText('Bram');
        await expect(popup.locator('.map-popup-outside')).toHaveCount(0);
    });

    test('empty states: nobody in the selection, nobody placed (a link to the people without a place); no status bar', async ({ page }) => {
        await setup(page);
        await sel(page).click();
        await pickList(page, 'Nobody yet');
        await expect(page.locator('.map-empty')).toHaveText('The selection is empty.');
        await expect(page.locator('#map-status')).toBeHidden();
        await expect(page.locator('.map-marker')).toHaveCount(0);

        await sel(page).click();
        await pickList(page, 'Without places');
        await expect(page.locator('.map-empty')).toContainText('No one in the selection has a place yet.');
        await expect(page.locator('.map-empty .map-empty-link')).toHaveText('1 person without a place ›');
        await expect(page.locator('#map-status')).toBeHidden();

        // Back to the whole tree: no sentence, the bar again.
        await page.locator('#map-scope-tree').click();
        await expect(page.locator('.map-empty')).toHaveCount(0);
        await expect(page.locator('#map-status')).toBeVisible();
    });

    test('the toolbar\'s search: a person outside the selection says so, with the way to the whole tree', async ({ page }) => {
        await setup(page);
        await sel(page).click();
        await pickList(page, 'Quillfen line');
        const input = page.locator('#toolbar-search-picker .person-picker-input');
        await input.fill('Bram');
        const row = page.locator('#toolbar-search-picker .person-picker-item', { hasText: 'Bram' });
        await expect(row.locator('.tagx')).toHaveText('outside the selection');
        await input.fill('Tamsin');
        await expect(page.locator('#toolbar-search-picker .person-picker-item', { hasText: 'Tamsin' }).locator('.tagx')).toHaveCount(0);
        await input.fill('Bram');
        await row.locator('.person-picker-rowact').click();
        await expect(page.locator('#map-scope-tree')).toHaveClass(/active/);
        await expect(marker(page, 'zeta')).toBeVisible();
    });
});

test.describe('the ancestors\' path with the scope Selection', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the path keeps to the selection; its person outside: the chip dimmed, no path, the bar says why', async ({ page }) => {
        await setup(page, { timeOn: true });
        await sel(page).click();
        await pickList(page, 'Quillfen line');
        await page.evaluate(() => window.Strom.UI.setMapPathTarget('tamsin' as never));
        // The scope stays beside the chip; the path runs only through the selection's people.
        await expect(page.locator('.map-path-chip')).toBeVisible();
        await expect(page.locator('.map-scope')).toBeVisible();
        await setYear(page, 1950);
        // Tamsin ← Orrin ← Corwen ← Ansel: three lines; Maelis, Ysolde and Ivar are outside.
        await expect(page.locator('path.map-path-line')).toHaveCount(3);
        const ids = await page.evaluate(() => window.Strom.UI.mapPathModel()?.ancestors.map(a => a.personId as string).sort());
        expect(ids).toEqual(['ansel', 'corwen', 'orrin']);

        await page.evaluate(() => window.Strom.UI.setMapPathTarget('bram' as never));
        const chip = page.locator('.map-path-chip');
        await expect(chip).toHaveClass(/is-outside/);
        await expect(chip).toContainText('· outside the selection');
        await expect(page.locator('path.map-path-line')).toHaveCount(0);
        await expect(page.locator('#map-status')).toContainText('The path\'s person is outside the selection');
        // × clears the path as before.
        await chip.locator('.map-path-chip-clear').click();
        await expect(chip).toBeHidden();
    });
});

test.describe('the map scope in German', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the parts and the group in German', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await expect(page.locator('.map-scope')).toHaveAttribute('aria-label', 'Kartenbereich');
        await expect(sel(page)).toHaveText('Auswahl▾');
        await sel(page).click();
        await pickList(page, 'Quillfen line');
        await expect(sel(page)).toHaveAttribute('aria-label', /Quillfen line/);
        await expect(page.locator('.map-marker')).toHaveCount(4);
    });
});

test.describe('the map scope on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('"Scope: … ▾" beside Kinds opens the sheet: the scopes with their people, selections to change to, All selections…', async ({ page }) => {
        await setup(page);
        await expect(page.locator('.map-scope')).toBeHidden();
        const btn = page.locator('#map-container .map-scope-btn');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveText(/Scope:\s*Whole tree/);
        // Beside the kinds' button, in one row.
        const a = (await btn.boundingBox())!;
        const k = (await page.locator('.map-kinds-btn').boundingBox())!;
        expect(Math.abs(a.y - k.y)).toBeLessThan(2);

        await btn.click();
        const sheet = page.locator('.map-scope-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[role="radio"]')).toHaveCount(3);
        await expect(sheet.locator('[role="radio"][aria-checked="true"]')).toHaveAttribute('data-scope', 'tree');
        await expect(sheet.locator('[data-scope="tree"] .map-scope-row-c')).toHaveText('10');
        const quick = sheet.locator('.map-scope-row[data-sel]');
        expect(await quick.count()).toBeLessThanOrEqual(5);
        await sheet.locator('.map-scope-row[data-sel]', { hasText: 'Quillfen line' }).click();
        await expect(sheet).toHaveCount(0);
        await expect(btn).toHaveText(/Scope:.*Quillfen line/);
        await expect(page.locator('.map-marker')).toHaveCount(4);

        // All selections…: the sheet of the window's selection.
        await btn.click();
        await expect(page.locator('.map-scope-sheet [data-scope="sel"]')).toHaveAttribute('aria-checked', 'true');
        await page.locator('.map-scope-sheet .map-scope-all').click();
        await expect(page.locator('.rod-pick-sheet')).toBeVisible();
    });

    test('the Places dialog\'s scope fits the phone, 44 px parts, the selection chosen', async ({ page }) => {
        await setup(page);
        const btn = page.locator('#map-container .map-scope-btn');
        await btn.click();
        await page.locator('.map-scope-sheet .map-scope-row[data-sel]', { hasText: 'Quillfen line' }).click();
        await expect(btn).toHaveText(/Scope:.*Quillfen line/);
        await page.evaluate(() => window.Strom.UI.showPlacesManager());
        const scope = page.locator('#places-modal .places-scope');
        await expect(scope.locator('[data-places-scope="sel"]')).toHaveAttribute('aria-pressed', 'true');
        const box = (await scope.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390.5);
        for (const s of ['view', 'sel', 'tree']) {
            expect((await scope.locator(`[data-places-scope="${s}"]`).boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        }
    });
});

test.describe('the map scope on a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });

    test('the segment stays, the name cut at 140 px', async ({ page }) => {
        await setup(page);
        await expect(page.locator('.map-scope')).toBeVisible();
        await expect(page.locator('#map-container .map-scope-btn')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.setMapScope('sel'));
        // Held sideways the choice is the sheet.
        await expect(page.locator('.rod-pick-sheet')).toBeVisible();
        await page.locator('.rod-pick-sheet li.sp-selpick-row[data-sec="lists"]', { hasText: 'Letters to the parish' }).locator('button').click();
        await expect(sel(page)).toHaveClass(/active/);
        const w = await sel(page).locator('.map-scope-name').evaluate(el => el.getBoundingClientRect().width);
        expect(w).toBeLessThanOrEqual(140.5);
    });
});

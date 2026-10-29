import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * The person page (spec 025): the window from the person menu's header and
 * the phone's sheet, its folds, switches and navigation, Escape, Edit only
 * where editing is possible, and "Save as HTML" — a file that opens offline,
 * readable without JavaScript, the privacy of the living applied.
 * Fictional family (Jan Fisek of Capkov).
 */

/** A 1×1 JPEG. */
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function seedFisek(page: Page): Promise<void> {
    const P = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...extra });
    const persons = {
        jan: P('jan', 'Jan', 'Fisek', 'male', {
            birthDate: '1860-03-12', birthPlace: 'Capkov', deathDate: '1910-11-02', deathPlace: 'Capkov',
            parentIds: ['otec', 'matka'], childIds: ['petr', 'rosa'], partnerships: ['u1'], birthSourceIds: ['s1'],
            notes: 'A farmer of house number 12.',
            events: [{ id: 'e1', type: 'baptism', date: '1860-03-13', place: 'Capkov', sourceIds: ['s1'] }],
        }),
        otec: P('otec', 'Vaclav', 'Fisek', 'male', { birthDate: '1830', deathDate: '1890', childIds: ['jan', 'karel'], partnerships: ['u0'] }),
        matka: P('matka', 'Anna', 'Nova', 'female', { birthDate: '1835', deathDate: '1895', childIds: ['jan', 'karel'], partnerships: ['u0'] }),
        karel: P('karel', 'Karel', 'Fisek', 'male', { birthDate: '1862', deathDate: '1930', parentIds: ['otec', 'matka'] }),
        marie: P('marie', 'Marie', 'Dvorakova', 'female', { birthDate: '1865', deathDate: '1930', partnerships: ['u1'], childIds: ['petr', 'rosa'] }),
        petr: P('petr', 'Petr', 'Fisek', 'male', { birthDate: '1890-01-01', deathDate: '1892-05-05', parentIds: ['jan', 'marie'] }),
        rosa: P('rosa', 'Rosa', 'Fiskova', 'female', {
            birthDate: '1893', deathDate: '1970', parentIds: ['jan', 'marie'], childIds: ['eva'], partnerships: ['u2'], deathSourceIds: ['s1'],
        }),
        tomas: P('tomas', 'Tomas', 'Maly', 'male', { birthDate: '1890', deathDate: '1960', partnerships: ['u2'], childIds: ['eva'] }),
        eva: P('eva', 'Evelina', 'Mala', 'female', { birthDate: '1955-04-04', birthPlace: 'Lhota', parentIds: ['tomas', 'rosa'] }),
    };
    const partnerships = {
        u0: { id: 'u0', person1Id: 'otec', person2Id: 'matka', childIds: ['jan', 'karel'], status: 'married' },
        u1: { id: 'u1', person1Id: 'jan', person2Id: 'marie', childIds: ['petr', 'rosa'], status: 'married', startDate: '1888-02-02', startPlace: 'Capkov' },
        u2: { id: 'u2', person1Id: 'tomas', person2Id: 'rosa', childIds: ['eva'], status: 'married', startDate: '1950' },
    };
    const sources = {
        s1: {
            id: 's1', title: 'Birth register Capkov 1850-1870', repository: 'Capkov archive',
            excerpts: [{ id: 'x1', dataUrl: IMG, width: 1, height: 1, sizeBytes: 100 }],
        },
    };
    await page.evaluate(async ({ persons, partnerships, sources }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, sources } as never, 'Fisek');
        await window.Strom.TreeRenderer.setFocus('jan' as never);
    }, { persons, partnerships, sources });
    await expect(card(page, 'Jan')).toBeVisible();
}

const win = (page: Page) => page.locator('#person-page-modal');

async function openPageFromMenu(page: Page, name = 'Jan'): Promise<void> {
    await card(page, name).click();
    await page.locator('.context-menu .context-menu-header--page').click();
    await expect(win(page)).toBeVisible();
}

test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('the menu header opens the window; folds and switches; Escape closes it, focus back on the card', { tag: '@smoke' }, async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await card(page, 'Jan').click();
        const header = page.locator('.context-menu .context-menu-header--page');
        await expect(header).toHaveAttribute('aria-label', 'Person page: Jan Fisek');
        await expect(header.locator('.cmh-page')).toHaveText('Person page ›');
        await header.click();

        const w = win(page);
        await expect(w.locator('h1')).toContainText('Jan Fisek');
        await expect(w.locator('.pp-sub')).toHaveText('Jan Fisek · 1860–1910');
        await expect(w.locator('.pp-body')).toBeFocused();
        // Four sections or more: the contents beside the page.
        await expect(w.locator('.pp-toc .pp-toc-link')).not.toHaveCount(0);

        // Sources: folded; the button opens and closes the region.
        const disc = w.locator('[data-pp-toggle="sources"]');
        const region = w.locator('#pp-sources-body');
        await expect(disc).toHaveAttribute('aria-expanded', 'false');
        await expect(region).toBeHidden();
        await disc.click();
        await expect(disc).toHaveAttribute('aria-expanded', 'true');
        await expect(region).toBeVisible();
        await disc.click();
        await expect(region).toBeHidden();

        // Children's events: on by default; off hides the children's rows.
        const sw = w.locator('[data-pp-switch="childEvents"]');
        await expect(sw).toHaveAttribute('aria-checked', 'true');
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'false');
        await expect(w.locator('article.pp')).toHaveClass(/pp-no-kids/);
        // No research: no History switch.
        await expect(w.locator('[data-pp-switch="history"]')).toHaveCount(0);

        await page.keyboard.press('Escape');
        await expect(w).toHaveCount(0);
        await expect(card(page, 'Jan')).toBeFocused();
    });

    test('a relative opens in the same window; back restores scroll, folds and switches', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await openPageFromMenu(page);
        const w = win(page);
        await w.locator('[data-pp-toggle="sources"]').click();
        await w.locator('[data-pp-switch="childEvents"]').click();
        const top = await w.locator('.pp-body').evaluate((el) => { el.scrollTop = 220; return el.scrollTop; });
        expect(top).toBeGreaterThan(0);
        // Clicked in place (a pointer click would scroll the link into view first).
        await w.locator('[data-pp-person="karel"]').first().evaluate((el) => (el as HTMLElement).click());
        await expect(w.locator('h1')).toContainText('Karel Fisek');
        const back = w.locator('.pp-back');
        await expect(back).toBeVisible();
        await expect(back).toHaveAttribute('aria-label', 'Back to Jan Fisek');
        await expect(w.locator('[data-pp-switch="childEvents"]')).toHaveCount(0);

        await back.click();
        await expect(w.locator('h1')).toContainText('Jan Fisek');
        await expect(back).toBeHidden();
        await expect(w.locator('[data-pp-toggle="sources"]')).toHaveAttribute('aria-expanded', 'true');
        await expect(w.locator('[data-pp-switch="childEvents"]')).toHaveAttribute('aria-checked', 'false');
        await expect(w.locator('article.pp')).toHaveClass(/pp-no-kids/);
        expect(await w.locator('.pp-body').evaluate((el) => el.scrollTop)).toBe(top);

        // Alt+← goes back too.
        await w.locator('[data-pp-person="karel"]').first().evaluate((el) => (el as HTMLElement).click());
        await expect(w.locator('h1')).toContainText('Karel Fisek');
        await page.keyboard.press('Alt+ArrowLeft');
        await expect(w.locator('h1')).toContainText('Jan Fisek');
    });

    test('⋯ offers Edit and Focus; a read-only view and a locked person have no Edit', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await openPageFromMenu(page);
        const w = win(page);
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Edit person', 'Focus in tree']);
        await w.locator('[data-pp-menu="edit"]').click();
        const editor = page.locator('#person-modal');
        await expect(editor).toBeVisible();
        await editor.locator('#input-notes').fill('Farmer and mayor.');
        await editor.locator('#btn-save').click();
        await expect(editor).toBeHidden();
        // The page redraws with the edit.
        await expect(w.locator('#pp-sec-notes')).toContainText('Farmer and mayor.');
        await page.keyboard.press('Escape');
        await expect(w).toHaveCount(0);

        // A locked person.
        await page.evaluate(() => window.Strom.UI.runPersonMenuAction('jan' as never, 'toggle-lock'));
        await openPageFromMenu(page);
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Focus in tree']);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(w).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.runPersonMenuAction('jan' as never, 'toggle-lock'));

        // A read-only view: the header is still offered, Edit is not.
        await page.evaluate(() => { window.Strom.DataManager.isReadOnly = () => true; });
        await openPageFromMenu(page);
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Focus in tree']);
        // Focus in tree closes the window.
        await w.locator('[data-pp-menu="focus"]').click();
        await expect(w).toHaveCount(0);
    });

    test('Save as HTML: the dialog, a file that opens offline and reads without JavaScript', { tag: '@smoke' }, async ({ page, browser }) => {
        await openApp(page);
        await seedFisek(page);
        await openPageFromMenu(page);
        await win(page).locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await expect(dlg).toBeVisible();
        await expect(dlg.locator('#ppx-file')).toHaveText('jan-fisek-1860-1910.html');
        // The groups the page has, with counts; nobody living on Jan's page: no privacy choice.
        await expect(dlg.locator('[data-ppx-group="excerpts"]')).toBeChecked();
        await expect(dlg.locator('[data-ppx-group="sources"]')).toBeChecked();
        await expect(dlg.locator('[data-ppx-group="history"]')).toHaveCount(0);
        await expect(dlg.locator('[data-ppx-privacy]')).toHaveCount(0);
        await expect(dlg.locator('#ppx-size-mb')).toContainText('MB');
        // Desktop: no Share.
        await expect(dlg.locator('[data-ppx="share"]')).toHaveCount(0);

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            dlg.locator('[data-ppx="save"]').click(),
        ]);
        expect(download.suggestedFilename()).toBe('jan-fisek-1860-1910.html');
        await expect(dlg).toHaveCount(0);
        await expect(page.locator('.toast')).toContainText('Saved: jan-fisek-1860-1910.html');
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).not.toMatch(/<link\b|<script\s+src|https?:\/\/[^"'\s]*\.(js|css|woff2?)/i);

        // Offline: every request is refused, and none is even attempted.
        const offline = await browser.newContext();
        const requests: string[] = [];
        await offline.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
        const filePage = await offline.newPage();
        filePage.on('request', (r) => { if (!r.url().startsWith('data:')) requests.push(r.url()); });
        await filePage.setContent(html, { waitUntil: 'load' });
        await expect(filePage.locator('h1')).toContainText('Jan Fisek');
        await expect(filePage.locator('#pp-sec-timeline')).toBeVisible();
        await expect(filePage).toHaveTitle('Jan Fisek (1860–1910)');
        expect(requests).toEqual([]);
        await offline.close();

        // Without JavaScript: readable, the folds are <details>.
        const noJs = await browser.newContext({ javaScriptEnabled: false });
        const plain = await noJs.newPage();
        await plain.setContent(html, { waitUntil: 'load' });
        await expect(plain.locator('h1')).toContainText('Jan Fisek');
        await expect(plain.locator('#pp-sec-timeline')).toBeVisible();
        expect(await plain.locator('details').count()).toBeGreaterThan(0);
        await expect(plain.locator('.pp-toggle')).toBeHidden();
        await noJs.close();

        // The choice is remembered for the tree: excerpts off, saved, offered off again.
        await win(page).locator('.pp-save').click();
        await dlg.locator('[data-ppx-group="excerpts"]').uncheck();
        const [second] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        expect(readFileSync(await second.path(), 'utf-8')).not.toContain('<img');
        await win(page).locator('.pp-save').click();
        await expect(dlg.locator('[data-ppx-group="excerpts"]')).not.toBeChecked();
    });

    test('privacy: offered with a living relative only; initials keep the living name out of the file', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('rosa' as never));
        const w = win(page);
        await expect(w.locator('h1')).toContainText('Rosa Fiskova');
        await w.locator('.pp-save').click();
        const dlg = page.locator('#person-page-export-modal');
        await expect(dlg.locator('[data-ppx-privacy]')).toHaveCount(4);
        await expect(dlg.locator('[data-ppx-privacy="full"]')).toHaveAttribute('aria-checked', 'true');
        await expect(dlg.locator('.ppx-note', { hasText: 'Applies to living people only' })).toContainText('Evelina Mala');
        await expect(dlg.locator('#ppx-drops')).toBeHidden();
        await dlg.locator('[data-ppx-privacy="initials"]').click();
        await expect(dlg.locator('[data-ppx-privacy="initials"]')).toHaveAttribute('aria-checked', 'true');
        // Sources go with a privacy other than full data: their rows inert, the ticks kept.
        await expect(dlg.locator('[data-ppx-group="sources"]')).toBeDisabled();
        await expect(dlg.locator('#ppx-drops')).toBeVisible();
        const [download] = await Promise.all([page.waitForEvent('download'), dlg.locator('[data-ppx="save"]').click()]);
        const html = readFileSync(await download.path(), 'utf-8');
        expect(html).toContain('Rosa');
        expect(html).not.toContain('Evelina');
        expect(html).not.toContain('Mala');
        expect(html).not.toContain('1955-04-04');
        expect(html).not.toContain('Lhota');
    });
});

test.describe('a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the sheet’s button opens the page on the whole screen, nothing wider than the screen', async ({ page }) => {
        await openApp(page);
        await seedFisek(page);
        await card(page, 'Jan').click();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        const btn = sheet.locator('.bs-page-btn');
        await expect(btn).toHaveText('Person page ›');
        expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await btn.click();
        await expect(sheet).toHaveCount(0);
        const w = win(page);
        await expect(w.locator('h1')).toContainText('Jan Fisek');
        const box = (await w.locator('.modal--page').boundingBox())!;
        expect(box.x).toBe(0);
        expect(box.y).toBe(0);
        expect(Math.round(box.width)).toBe(390);
        expect(Math.round(box.height)).toBe(844);
        await expect(w.locator('.pp-mname')).toHaveText('Jan Fisek');
        await expect(w.locator('.pp-save')).toBeHidden();
        await expect(w.locator('.pp-share')).toBeVisible();
        const fits = await w.locator('.pp-body').evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
        // Save and Print in ⋯ on a phone.
        await w.locator('.pp-more').click();
        await expect(w.locator('.pp-menu-item:visible')).toHaveText(['Save as HTML', 'Print', 'Edit person', 'Focus in tree']);
    });
});

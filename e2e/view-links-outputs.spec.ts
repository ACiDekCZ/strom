import { test, expect, Page, BrowserContext } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, card } from './helpers.js';

/**
 * Linked in the view only, the outputs: the poster (SVG, PNG, the sheets),
 * the book's tree page and the browser's print lay the view out without the
 * shown links (no ghosts, no hole where they stood, a card of details as
 * wide as the people printed need); the view's export, a tree from the view,
 * sharing a branch and the presentation leave out everyone seen only through
 * a link; GEDCOM, JSON, CSV, the app file, the fan and the timeline are what
 * they are without them; loading a research version and what will be sent
 * know nothing of them. The output dialogs say "View-only links (n) are not
 * included" while some are shown. Invented data only
 * (e2e/fixtures/research-hypothesis-links.ged).
 */

const GED = readFileSync('e2e/fixtures/research-hypothesis-links.ged', 'utf-8');
/** Jakub (shown as Václav's father in version B) with a long trade: the widest text of a card of details. */
const GED_LONG = GED.replace('1 REFN P0125\n2 TYPE strom-research\n1 BIRT\n2 DATE 1790\n',
    '1 REFN P0125\n2 TYPE strom-research\n1 BIRT\n2 DATE 1790\n1 OCCU domkář a podruhý na velkostatku hraběte Kolowrata v Lhotě čp. 12\n');

type Rec = { hypo: string; variant: string; kind: string; anchor: string; island: string[]; on?: boolean };
const B: Rec = { hypo: 'H0022', variant: 'B', kind: 'child', anchor: 'P0010', island: ['P0125', 'P0126'] };
const PARTNER: Rec = { hypo: 'H0024', variant: 'A', kind: 'partners', anchor: 'P0011', island: ['P0140'] };
/** People only the links show (the families of H0022 B and H0024 A). */
const GHOSTS = ['Jakub', 'Josef', 'Tomáš', 'Martin'];

async function setup(page: Page, ged = GED): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate((t) => window.Strom.UI.openGedcomText(t), ged);
    await expect(card(page, 'Karel').first()).toBeVisible();
}

/** Store the records (the main switch on or off) and focus a person by research number. */
async function show(page: Page, records: Rec[], master = true, focus = 'P0001'): Promise<void> {
    await page.evaluate(({ records, master, focus }) => {
        const S = window.Strom;
        const treeId = S.DataManager.getCurrentTreeId()!;
        const byRefn = (refn: string) => S.DataManager.getAllPersons().find(p => p.refn === refn)!.id;
        localStorage.setItem(`strom-view-links:${treeId}`, JSON.stringify(records.map((r, i) => ({
            hypo: r.hypo, variant: r.variant, kind: r.kind, anchorId: byRefn(r.anchor),
            islandIds: r.island.map(byRefn), on: r.on ?? true, addedAt: i + 1,
        }))));
        if (master) localStorage.removeItem(`strom-view-links-master:${treeId}`);
        else localStorage.setItem(`strom-view-links-master:${treeId}`, 'false');
        S.TreeRenderer.setFocus(byRefn(focus));
    }, { records, master, focus });
    await page.evaluate(() => window.Strom.TreeRenderer.renderAsync());
}

const ghosts = (page: Page) => page.locator('.person-card.view-ghost');
const note = (page: Page, dialog: string) => page.locator(`#${dialog} .view-links-note`);

/** The poster of the current view as an SVG (privacy: full). */
async function posterSvg(page: Page): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const dialog = page.locator('#poster-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#poster-privacy-mode').selectOption('full');
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        dialog.locator('.menu-option', { hasText: 'SVG' }).click(),
    ]);
    return readFileSync(await download.path(), 'utf-8');
}

/** The book's tree page (privacy: full). */
async function bookTree(page: Page, context: BrowserContext): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showBookDialog());
    const dialog = page.locator('#book-modal');
    await dialog.locator('#book-privacy-mode').selectOption('full');
    const [book] = await Promise.all([
        context.waitForEvent('page'),
        dialog.getByRole('button', { name: 'Open book' }).click(),
    ]);
    await book.waitForLoadState('domcontentloaded');
    const svg = await book.locator('.book-tree-wrap svg').evaluate(el => el.outerHTML);
    await book.close();
    return svg;
}

/** The people of the outputs, the poster's card box, by first name. */
const outputs = (page: Page) => page.evaluate(() => {
    const S = window.Strom;
    const names = (ids: Iterable<string>) => [...ids].map(id => S.DataManager.getPerson(id as never)?.firstName ?? id).sort();
    return {
        poster: names(S.TreeRenderer.getPosterLayout().positions.keys()),
        visible: names(S.TreeRenderer.getVisiblePersonIds()),
        focused: names(Object.keys(S.TreeRenderer.getFocusedData()?.persons ?? {})),
        slideshow: names(S.UI.buildSlideshowStops()),
        count: document.getElementById('focus-person-count')?.textContent ?? '',
        box: S.TreeRenderer.getPosterCardBox(),
    };
});

test.describe('linked in the view only: the outputs', () => {
    test('the poster is the view laid out without the links: the same SVG as with them off, in every view; its dialog says so', async ({ page }) => {
        await setup(page);
        for (const mode of ['family', 'fan', 'timeline'] as const) {
            await page.evaluate((m) => window.Strom.TreeRenderer.setViewMode(m), mode);
            await show(page, [B, PARTNER], false);
            await expect(ghosts(page)).toHaveCount(0);
            const off = await posterSvg(page);
            await expect(note(page, 'poster-modal')).toHaveCount(0);
            await page.evaluate(() => window.Strom.UI.closePosterDialog());

            await show(page, [B, PARTNER]);
            if (mode === 'family') await expect(ghosts(page)).toHaveCount(6);
            const on = await posterSvg(page);
            await expect(note(page, 'poster-modal')).toHaveText('View-only links (2) are not included');
            await expect(note(page, 'poster-modal').locator('.view-link-icon--12')).toHaveCount(1);
            await page.evaluate(() => window.Strom.UI.closePosterDialog());
            expect(on, mode).toBe(off);
            for (const name of GHOSTS) expect(on, `${mode}: ${name}`).not.toContain(name);
            expect(on).toContain('Karel');
        }
        // The footer names the depth the poster has (the shown generations count on screen only).
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('family'));
        await show(page, [B, PARTNER]);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusDepthUp())).toBe(3);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getOutputFocusDepth())).toEqual({ up: 2, down: 1 });
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await expect(page.locator('#poster-view-label')).toContainText('(depth 2/1)');
    });

    test('the Descendants of a shown parent: the poster and the view\'s people leave out the tree reached only through the link', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('descendants'));
        await show(page, [B], false, 'P0125');
        const off = { svg: await posterSvg(page), ...(await outputs(page)) };
        await page.evaluate(() => window.Strom.UI.closePosterDialog());
        await show(page, [B], true, 'P0125');
        await expect(card(page, 'Karel')).toBeVisible();
        const on = { svg: await posterSvg(page), ...(await outputs(page)) };
        expect(on).toEqual(off);
        expect(on.poster).not.toContain('Karel');
        expect(on.poster).not.toContain('Václav');
        expect(on.poster).toContain('Jakub');
    });

    test('a card of details is as wide as the people printed need, not a shown family\'s longest text: poster and book as with the links off', async ({ page, context }) => {
        await setup(page, GED_LONG);
        await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));
        await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('detailed');
        await show(page, [B, PARTNER], false);
        const off = { svg: await posterSvg(page), ...(await outputs(page)) };
        await page.evaluate(() => window.Strom.UI.closePosterDialog());
        const offBook = await bookTree(page, context);

        await show(page, [B, PARTNER]);
        await expect(ghosts(page)).toHaveCount(6);
        // On screen the cards make room for Jakub's trade.
        const screen = await page.evaluate(() => window.Strom.TreeRenderer.getCardBox().cardWidth);
        expect(screen).toBeGreaterThan(off.box.cardWidth);
        const on = { svg: await posterSvg(page), ...(await outputs(page)) };
        await page.evaluate(() => window.Strom.UI.closePosterDialog());
        expect(on.box).toEqual(off.box);
        expect(on.svg).toBe(off.svg);
        expect(on.svg).not.toContain('Kolowrata');
        const onBook = await bookTree(page, context);
        expect(onBook).toBe(offBook);
        expect(onBook).not.toContain('Jakub');
        // The screen keeps its own width.
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getCardBox().cardWidth)).toBe(screen);
    });

    test('the book: its tree page as with the links off, its dialog says so', async ({ page, context }) => {
        await setup(page);
        await show(page, [B, PARTNER], false);
        const off = await bookTree(page, context);
        await expect(note(page, 'book-modal')).toHaveCount(0);
        await show(page, [B, PARTNER]);
        await expect(ghosts(page)).toHaveCount(6);
        const on = await bookTree(page, context);
        expect(on).toBe(off);
        for (const name of GHOSTS) expect(on).not.toContain(name);
        await page.evaluate(() => window.Strom.UI.showBookDialog());
        await expect(note(page, 'book-modal')).toHaveText('View-only links (2) are not included');
        // Above the options, under the title.
        expect(await note(page, 'book-modal').evaluate(n => n.previousElementSibling?.classList.contains('modal-header'))).toBe(true);
    });

    test('the browser\'s print: the tree laid out without the links while it prints, drawn as before afterwards', async ({ page }) => {
        await setup(page);
        await show(page, [B, PARTNER]);
        await expect(ghosts(page)).toHaveCount(6);
        const layout = await page.evaluate(() => [...window.Strom.TreeRenderer.getPosterLayout().positions]
            .map(([id, p]) => `${id}@${p.x},${p.y}`).sort());
        // A print stylesheet hides them whatever happens.
        await page.emulateMedia({ media: 'print' });
        for (const sel of ['.person-card.view-ghost', '#tree-lines .view-virtual', '.view-link-label', '#view-links-pill']) {
            expect(await page.locator(sel).first().evaluate(el => getComputedStyle(el).display), sel).toBe('none');
        }
        // The print itself: laid out again before the page is printed (no later frame needed).
        const printed = await page.evaluate(async () => {
            window.dispatchEvent(new Event('beforeprint'));
            await new Promise(r => setTimeout(r, 0));
            return {
                cards: [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')]
                    .map(c => `${c.dataset.id}@${parseFloat(c.style.left)},${parseFloat(c.style.top)}`).sort(),
                view: document.querySelectorAll('.view-ghost, .view-virtual, .view-link-label').length,
            };
        });
        expect(printed.view).toBe(0);
        expect(printed.cards).toEqual(layout);
        await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        await page.emulateMedia({ media: 'screen' });
        await expect(ghosts(page)).toHaveCount(6);
        await expect(page.locator('#tree-lines .view-virtual')).not.toHaveCount(0);
        await expect(page.locator('#view-links-pill')).toBeVisible();
        // The poster's own print (its sheets) leaves the tree alone.
        await page.evaluate(() => {
            document.body.classList.add('poster-printing');
            window.dispatchEvent(new Event('beforeprint'));
        });
        await page.waitForTimeout(50);
        await expect(ghosts(page)).toHaveCount(6);
        await page.evaluate(() => {
            window.dispatchEvent(new Event('afterprint'));
            document.body.classList.remove('poster-printing');
        });
    });

    test('the view\'s export, a tree from the view, sharing and the presentation count nobody seen only through a link; their dialogs say so', async ({ page }) => {
        await setup(page);
        await show(page, [B, PARTNER], false);
        const off = await outputs(page);
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        const offScope = await page.locator('#export-scope-view').textContent();
        await page.evaluate(() => window.Strom.UI.closeExportDialog());

        await show(page, [B, PARTNER]);
        await expect(ghosts(page)).toHaveCount(6);
        const on = await outputs(page);
        expect(on).toEqual(off);
        for (const name of GHOSTS) expect(on.visible).not.toContain(name);

        // Export: the view's count as without the links; the row only in the view's scope.
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        const exportModal = page.locator('#export-modal');
        await expect(page.locator('#export-scope-view')).toHaveText(offScope!);
        await exportModal.locator('.segment-btn[data-scope="tree"]').click();
        await expect(note(page, 'export-modal')).toHaveCount(0);
        await page.locator('#export-scope-view').click();
        await expect(note(page, 'export-modal')).toHaveText('View-only links (2) are not included');
        expect(await note(page, 'export-modal').evaluate(n => n.previousElementSibling?.id)).toBe('export-scope');
        await page.evaluate(() => window.Strom.UI.closeExportDialog());

        // A tree from the view: its counts as without the links, the row under them.
        await page.evaluate(() => window.Strom.UI.makeTreeFromCurrentView());
        const importModal = page.locator('#import-tree-modal');
        await expect(importModal).toBeVisible();
        await expect(page.locator('#import-tree-persons')).toHaveText(String(off.visible.filter(n => n !== '?').length));
        await expect(note(page, 'import-tree-modal')).toHaveText('View-only links (2) are not included');
        await page.evaluate(() => window.Strom.UI.closeImportTreeDialog());

        // Sharing: the row under the introduction.
        await page.evaluate(() => window.Strom.UI.showShareDialog());
        await expect(note(page, 'share-modal')).toHaveText('View-only links (2) are not included');
        await page.evaluate(() => window.Strom.UI.closeShareDialog());

        // No row once the main switch is off, nor in another import.
        await show(page, [B, PARTNER], false);
        await page.evaluate(() => window.Strom.UI.showShareDialog());
        await expect(note(page, 'share-modal')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeShareDialog());
        await show(page, [B, PARTNER]);
        await page.evaluate(() => window.Strom.UI.showImportTreeDialog(window.Strom.DataManager.getData(), 'x'));
        await expect(note(page, 'import-tree-modal')).toHaveCount(0);
    });

    test('the row in Czech and German, light and dark, on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await openApp(page);
        await page.evaluate((t) => window.Strom.UI.openGedcomText(t), GED);
        await expect(card(page, 'Karel').first()).toBeVisible();
        await show(page, [B]);
        await expect(ghosts(page)).toHaveCount(5);
        await page.evaluate(() => window.Strom.UI.setLanguage('cs'));
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await expect(note(page, 'poster-modal')).toHaveText('Připojení jen v zobrazení (1) se do výstupu nepřenášejí');
        const light = await note(page, 'poster-modal').evaluate(n => getComputedStyle(n).backgroundColor);
        expect(light).toBe('rgb(228, 235, 241)');
        await page.evaluate(() => window.Strom.UI.closePosterDialog());
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const row = note(page, 'poster-modal');
        await expect(row).toHaveText('Nur angezeigte Verbindungen (1) werden nicht übernommen');
        expect(await row.evaluate(n => getComputedStyle(n).backgroundColor)).toBe('rgb(42, 49, 57)');
        // It fits the phone's dialog.
        const fits = await row.evaluate(n => {
            const r = n.getBoundingClientRect();
            const text = n.querySelector('.view-links-note__text') as HTMLElement;
            return r.left >= 0 && r.right <= window.innerWidth && text.scrollWidth <= text.clientWidth + 1;
        });
        expect(fits).toBe(true);
    });

    test('GEDCOM, JSON, CSV and the app file are the same with links shown', async ({ page }) => {
        await setup(page);
        const files = async (): Promise<Record<string, string>> => {
            const out: Record<string, string> = {};
            for (const [kind, run, submit] of [
                ['ged', 'exportTargetTreeGedcom', true],
                ['csv', 'exportTargetTreeCsv', true],
                ['json', 'exportBackupFromDialog', true],
                ['html', 'exportTargetTreeApp', true],
            ] as const) {
                await page.evaluate(() => {
                    window.Strom.UI.showExportDialog();
                    window.Strom.UI.setExportScope('tree');
                });
                await page.evaluate((m) => (window.Strom.UI as unknown as Record<string, () => void>)[m](), run);
                const pwd = page.locator('#export-password-modal');
                await expect(pwd).toBeVisible();
                await pwd.locator('#export-privacy-mode').selectOption('full');
                const [download] = await Promise.all([page.waitForEvent('download'), submit ? pwd.locator('#export-submit-btn').click() : Promise.resolve()]);
                out[kind] = readFileSync(await download.path(), 'utf-8')
                    .replace(/^1 DATE .*\n(2 TIME .*\n)?/m, '')
                    .replace(/"(exportId|exportedAt)":"[^"]*"/g, '');
            }
            return out;
        };
        await show(page, [B, PARTNER], false);
        const off = await files();
        await show(page, [B, PARTNER]);
        await expect(ghosts(page)).toHaveCount(6);
        const on = await files();
        for (const kind of Object.keys(off)) expect(on[kind], kind).toBe(off[kind]);
        expect(on.json).not.toMatch(/view-links|addedAt/);
        // The app file's data: the tree as it is.
        const embedded = (html: string) => html.match(/window\.STROM_EMBEDDED_DATA = (\{.*?\});<\/script>/s)?.[1] ?? '';
        expect(embedded(on.html)).not.toBe('');
        expect(embedded(on.html)).not.toMatch(/view-links|addedAt/);
    });

    test('loading a research version and what will be sent know nothing of the shown links', async ({ page }) => {
        await setup(page);
        // What will be sent: nothing changed, with the links shown or not.
        await expect.poll(() => page.evaluate(() => window.Strom.UI.researchChangesNow())).toEqual([]);
        await show(page, [B, PARTNER]);
        await expect(ghosts(page)).toHaveCount(6);
        expect(await page.evaluate(() => window.Strom.UI.researchChangesNow())).toEqual([]);
        expect(await page.evaluate(() => window.Strom.DataManager.canUndo())).toBe(false);

        // A later research version with a changed birth year: the dialog lists that, nothing of the links.
        const later = GED.replace(/1 _STROM_HEAD \w+/, '1 _STROM_HEAD 1111111111111111111111111111111111111111')
            .replace('2 DATE 1860\n2 PLAC Lhota', '2 DATE 1861\n2 PLAC Lhota');
        const ask = async (): Promise<string> => {
            const done = page.evaluate((t) => window.Strom.UI.openGedcomText(t), later);
            const dialog = page.getByRole('dialog', { name: 'Load the research version?' });
            await expect(dialog).toBeVisible();
            const text = (await dialog.innerText()).replace(/\d{1,2}:\d{2}/g, '');
            await dialog.locator('#research-load-cancel').click();
            await done;
            return text;
        };
        const on = await ask();
        await show(page, [B, PARTNER], false);
        const off = await ask();
        expect(on).toBe(off);
        expect(on).toContain('Karel');
        expect(on).not.toMatch(/Jakub|Martin|H0022|H0024|view/i);
    });
});

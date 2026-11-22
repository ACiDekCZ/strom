import { test, expect, Locator, Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';
import { buildPageSet } from '../src/family-pages';
import { buildPageSetHtml } from '../src/family-pages-html';
import { buildLineages, rods } from '../src/lineage';
import { familyPagesFixture, FP_NOW } from '../src/__tests__/helpers/family-pages-fixture';

/**
 * Small targets a finger hits (at least 24 × 24 px on touch): the person
 * page's and the family pages' links in the text (the app's window and the
 * saved file), Backups' "Where is my data?" and its switch, the help mark of
 * Places, "More" of Surname spellings, the family line's name in Edit person
 * and "Don't show" of What's new. The target is measured as the area where
 * the finger lands on it (elementFromPoint from its middle outwards), so a
 * target grown by padding or a pseudo element counts. Invented names only.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const MIN = 24;

/**
 * The area around the middle of a target's first box where a tap lands on it
 * (or on the label that owns it), in px.
 */
async function hitArea(target: Locator): Promise<{ w: number; h: number }> {
    await target.scrollIntoViewIfNeeded();
    return target.evaluate((el) => {
        const r = el.getClientRects()[0];
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const owns = (x: number, y: number): boolean => {
            const hit = document.elementFromPoint(x, y);
            if (!hit) return false;
            if (el.contains(hit)) return true;
            const label = hit.closest('label');
            return !!label && label.control === el;
        };
        const reach = (dx: number, dy: number): number => {
            let d = 0;
            while (d < 80 && owns(cx + dx * (d + 1), cy + dy * (d + 1))) d++;
            return d;
        };
        return { w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 };
    });
}

async function expectTappable(target: Locator, what: string): Promise<void> {
    await expect(target).toBeVisible();
    const a = await hitArea(target);
    expect.soft(a.w, `${what}: width of the target (${a.w}×${a.h})`).toBeGreaterThanOrEqual(MIN);
    expect.soft(a.h, `${what}: height of the target (${a.w}×${a.h})`).toBeGreaterThanOrEqual(MIN);
}

/** Every visible link in the text of a page: each one reached by a finger. */
async function expectLinksTappable(links: Locator, what: string): Promise<void> {
    const n = await links.count();
    expect(n, `${what}: links in the text`).toBeGreaterThan(2);
    for (let i = 0; i < n; i++) {
        const link = links.nth(i);
        if (!(await link.isVisible())) continue;
        await expectTappable(link, `${what} #${i} “${(await link.textContent())?.trim()}”`);
    }
}

async function lines(page: Page): Promise<void> {
    await openApp(page);
    await page.evaluate(async (data) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data as never, 'Brandvold');
        S.TreeRenderer.setFocus(data.defaultPersonId as never);
        await S.TreeRenderer.renderAsync();
    }, rodsTree());
}

/** No sideways scroll of the page or of the open window. */
async function expectNoOverflow(page: Page, scroller: Locator): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await scroller.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test.describe('small targets on touch (390 px)', () => {
    test('the person page and the family pages window: the links in the text', async ({ page }) => {
        await lines(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('b14' as never));
        const win = page.locator('#person-page-modal');
        await expect(win).toBeVisible();
        await expectLinksTappable(win.locator('.pp-body .pp-link'), 'person page');
        await expectNoOverflow(page, win.locator('.modal'));

        await page.evaluate(() => (window.Strom.UI as unknown as { openTreePages(): void }).openTreePages());
        await expect(win).toHaveClass(/pp-is-set/);
        await expectLinksTappable(win.locator('.sp-app section.sp-page:visible .pp-link'), 'tree pages');
        await expectNoOverflow(page, win.locator('.modal'));
    });

    test('the saved family pages: the links in the text of a person page', async ({ page }) => {
        const { data, ids } = familyPagesFixture();
        const rodIds = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
        const set = buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang: 'en', now: FP_NOW });
        const file = join(mkdtempSync(join(tmpdir(), 'strom-touch-targets-')), 'Lines.html');
        writeFileSync(file, buildPageSetHtml(set), 'utf-8');
        await page.goto(`${pathToFileURL(file).href}#${set.personSlug.get(ids.josef)!}`);
        await expectLinksTappable(page.locator('section.sp-page:visible .pp-link'), 'saved pages');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('Backups, Places, Surname spellings, Edit person and What\'s new', async ({ page }) => {
        await lines(page);

        await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
        const backups = page.locator('#snapshots-modal');
        await expect(backups).toBeVisible();
        await expectTappable(backups.locator('#snapshots-persistence .link-button'), 'Backups: Where is my data?');
        await expectTappable(backups.locator('#snapshots-auto-toggle'), 'Backups: automatic backups switch');
        await page.evaluate(() => window.Strom.UI.closeSnapshotsDialog());

        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        const places = page.locator('#places-modal');
        await expect(places).toBeVisible();
        await expectTappable(places.locator('.modal-header button.help-mark'), 'Places: help mark');
        await page.evaluate(() => window.Strom.UI.closePlacesManager());

        await page.evaluate(() => window.Strom.UI.showSurnamesDialog());
        const surnames = page.locator('#surnames-modal');
        await expect(surnames).toBeVisible();
        await expectTappable(surnames.locator('.surnames-more > summary'), 'Surname spellings: More');
        await surnames.locator('#surnames-close-x').click();
        await expect(surnames).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.showEditPersonModal('b14' as never));
        const edit = page.locator('#person-modal');
        await expect(edit).toBeVisible();
        await expectTappable(edit.locator('.pm-rod-link').first(), 'Edit person: family line');
        await expectNoOverflow(page, edit.locator('.modal'));
        await page.keyboard.press('Escape');
        await expect(edit).not.toBeVisible();

        await page.evaluate(() => window.Strom.UI.showReleaseNotesDialog());
        const notes = page.locator('#release-notes-modal');
        await expect(notes).toBeVisible();
        await expectTappable(notes.locator('#release-notes-dont-show'), 'What\'s new: Don\'t show');
    });
});

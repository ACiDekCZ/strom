import { test, expect, Page, BrowserContext, TestInfo } from '@playwright/test';
import { pathToFileURL } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { openApp, createFirstPerson, card, waitForPersist, exportTreeJson } from './helpers.js';

/**
 * Strom Research in the app (3.0): the welcome-screen offer, the permanent
 * "AI ancestor research" menu item with its "New" label + trigger dots, the
 * in-app explanation dialog and the one-time "What's new in 3.0" card —
 * shown once, dismissed for good, never in exports / view mode / locked data /
 * research trees, and remembered in the browser settings only.
 *
 * Every test opts out of openApp's default "promotion already seen" seeding.
 * The website itself is never contacted: requests to stromapp.info are
 * answered locally.
 */

const SITE = 'https://stromapp.info/research/';
const DESKTOP = { width: 1440, height: 900 };
const SCREENSHOTS = path.join(process.cwd(), 'screenshots');

type PromoSettings = { researchNewFirstSeen?: string; researchNewDismissed?: boolean; whatsNew30Shown?: boolean };

/** Answer every request to the website locally (no network from the tests). */
async function stubSite(context: BrowserContext): Promise<void> {
    await context.route('https://stromapp.info/**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Strom Research</title>' }));
}

/** Click `trigger` and return the address of the tab it opens. */
async function popupUrlAfter(page: Page, trigger: () => Promise<void>): Promise<string> {
    const popupPromise = page.context().waitForEvent('page');
    await trigger();
    const popup = await popupPromise;
    await popup.waitForURL(/stromapp\.info\/research\//);
    const url = popup.url();
    await popup.close();
    return url;
}

function readSettings(page: Page): Promise<PromoSettings & Record<string, unknown>> {
    return page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('strom-settings') || '{}'); } catch { return {}; }
    });
}

/** Rewrite the three promotion keys (undefined = remove) in the stored settings. */
async function setPromoSettings(page: Page, values: PromoSettings): Promise<void> {
    await page.evaluate((v) => {
        const s = JSON.parse(localStorage.getItem('strom-settings') || '{}');
        for (const key of ['researchNewFirstSeen', 'researchNewDismissed', 'whatsNew30Shown']) {
            const value = (v as Record<string, unknown>)[key];
            if (value === undefined) delete s[key];
            else s[key] = value;
        }
        localStorage.setItem('strom-settings', JSON.stringify(s));
    }, values);
}

/**
 * A browser that already has a tree and now runs 3.0 for the first time:
 * create a person, wait until it is stored, clear the promotion keys, reload.
 */
async function existingTreeFirstRun(page: Page): Promise<void> {
    await openApp(page, { researchPromo: true });
    await createFirstPerson(page, 'Jan', 'Novak');
    await waitForPersist(page, 'Jan');
    await setPromoSettings(page, {});
    await page.reload();
    await expect(card(page, 'Jan')).toBeVisible();
}

const whatsNew = (page: Page) => page.locator('.whats-new[role="dialog"]');
const newDot = (page: Page) => page.locator('#actions-menu-new-dot');
const moreDot = (page: Page) => page.locator('#bottom-bar-more-dot');
const menuRow = (page: Page) => page.locator('#research-menu-row');
const infoDialog = (page: Page) => page.locator('#research-info-modal');

async function openActionsMenu(page: Page): Promise<void> {
    await page.locator('.actions-menu-btn').click();
    await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
}

/** No horizontal overflow of the page or of any element inside `selector`. */
async function expectNoOverflow(page: Page, selector: string): Promise<void> {
    const res = await page.evaluate((sel) => {
        const root = document.querySelector(sel) as HTMLElement | null;
        if (!root) return { missing: true, doc: 0, inner: window.innerWidth, offenders: [] as string[] };
        const inner = window.innerWidth;
        const offenders: string[] = [];
        for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.left < -0.5 || r.right > inner + 0.5) offenders.push(`${el.tagName}.${el.className}: ${Math.round(r.left)}..${Math.round(r.right)}`);
            if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') {
                offenders.push(`${el.tagName}.${el.className} scrolls: ${el.scrollWidth} > ${el.clientWidth}`);
            }
        }
        return { missing: false, doc: document.documentElement.scrollWidth, inner, offenders };
    }, selector);
    expect(res.missing, `${selector} exists`).toBe(false);
    expect(res.offenders, `${selector} fits the viewport`).toEqual([]);
    expect(res.doc).toBeLessThanOrEqual(res.inner);
}

async function shot(page: Page, name: string, testInfo: TestInfo, target?: string): Promise<void> {
    fs.mkdirSync(SCREENSHOTS, { recursive: true });
    const file = path.join(SCREENSHOTS, name);
    if (target) await page.locator(target).first().screenshot({ path: file });
    else await page.screenshot({ path: file });
    await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

// ---- 1 + 2: the welcome screen ----

test.describe('welcome screen offer', () => {
    for (const size of [DESKTOP, { width: 400, height: 800 }, { width: 700, height: 900 }]) {
        test(`is shown at ${size.width}px and opens the site (EN, no language parameter)`, async ({ page, context }) => {
            await stubSite(context);
            await page.setViewportSize(size);
            await openApp(page, { researchPromo: true });
            const offer = page.locator('#empty-state .research-offer');
            await expect(offer).toBeVisible();
            await expect(offer).toContainText('Not sure where to start?');
            await expect(offer).toContainText('Let an AI agent find your ancestors');
            // Content stays left-aligned even where the column is centred.
            expect(await offer.evaluate(el => getComputedStyle(el).textAlign)).toBe('left');
            // Sits between "I have data elsewhere" and the demo link.
            const order = await page.locator('#empty-state .empty-state-text:not(.empty-state-locked) .empty-state-actions > button')
                .evaluateAll(els => els.map(e => e.className));
            expect(order).toEqual(['primary', 'ghost', 'research-offer', 'link']);
            // A new user meets the news here: the one-time card is never due.
            await expect.poll(async () => (await readSettings(page)).whatsNew30Shown).toBe(true);
            expect(await popupUrlAfter(page, () => offer.click())).toBe(SITE);
            await expect(whatsNew(page)).toHaveCount(0);
        });
    }

    test('"Runs on a computer" shows at 400px, not on desktop', async ({ page }) => {
        await page.setViewportSize(DESKTOP);
        await openApp(page, { researchPromo: true });
        const runs = page.locator('#empty-state .research-offer-runs');
        await expect(page.locator('#empty-state .research-offer')).toBeVisible();
        await expect(runs).toBeHidden();
        await page.setViewportSize({ width: 400, height: 800 });
        await expect(runs).toBeVisible();
        await expect(runs).toHaveText('Runs on a computer (Windows, Mac, Linux)');
    });

    test.describe('in Czech', () => {
        test.use({ locale: 'cs-CZ' });
        test('opens the Czech page', async ({ page, context }) => {
            await stubSite(context);
            await openApp(page, { researchPromo: true });
            const offer = page.locator('#empty-state .research-offer');
            await expect(offer).toContainText('Nechte předky dohledat AI agenta');
            expect(await popupUrlAfter(page, () => offer.click())).toBe(`${SITE}?lang=cs`);
        });
    });

    test.describe('in German', () => {
        test.use({ locale: 'de-DE' });
        test('opens the German page', async ({ page, context }) => {
            await stubSite(context);
            await openApp(page, { researchPromo: true });
            const offer = page.locator('#empty-state .research-offer');
            await expect(offer).toContainText('Lassen Sie einen KI-Agenten Ihre Vorfahren finden');
            expect(await popupUrlAfter(page, () => offer.click())).toBe(`${SITE}?lang=de`);
        });
    });

    test.describe('on a touch device', () => {
        test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
        test('"Runs on a computer" shows on touch even on a wide screen', async ({ page }) => {
            await openApp(page, { researchPromo: true });
            await expect(page.locator('#empty-state .research-offer-runs')).toBeVisible();
        });
    });
});

// ---- 3 + 4 + 5 + 8: existing tree, desktop ----

test.describe('existing tree on desktop', () => {
    test.use({ viewport: DESKTOP });

    test('the 3.0 card shows once, anchored under Actions; "Learn more" opens the site and puts "New" out', async ({ page, context }) => {
        await stubSite(context);
        await existingTreeFirstRun(page);
        const cardEl = whatsNew(page);
        await expect(cardEl).toBeVisible();
        await expect(cardEl).toHaveAttribute('aria-modal', 'false');
        await expect(cardEl).toContainText('Ancestor research with an AI agent');
        await expect(cardEl).toContainText('Also in 3.0');
        // Focus moves onto the card.
        expect(await page.evaluate(() => document.activeElement?.classList.contains('whats-new'))).toBe(true);
        // Anchored under the Actions button, arrow over its centre, ≥ 16px from the right edge.
        const geo = await page.evaluate(() => {
            const btn = document.querySelector('.actions-menu-btn')!.getBoundingClientRect();
            const c = document.querySelector('.whats-new-card')!.getBoundingClientRect();
            const a = document.querySelector('.whats-new-arrow')!.getBoundingClientRect();
            return { btnBottom: btn.bottom, btnCentre: btn.left + btn.width / 2, top: c.top, right: c.right, width: c.width, arrowCentre: a.left + a.width / 2, inner: window.innerWidth };
        });
        expect(geo.top - geo.btnBottom).toBeCloseTo(14, 0);
        expect(geo.width).toBeCloseTo(384, 0);
        expect(geo.inner - geo.right).toBeGreaterThanOrEqual(16);
        expect(Math.abs(geo.arrowCentre - geo.btnCentre)).toBeLessThanOrEqual(2);
        // The "New" dot is lit meanwhile.
        await expect(newDot(page)).toBeVisible();

        expect(await popupUrlAfter(page, () => cardEl.getByRole('button', { name: /Learn more/ }).click())).toBe(SITE);
        await expect(cardEl).toHaveCount(0);
        await expect(newDot(page)).toBeHidden();
        const s = await readSettings(page);
        expect(s.whatsNew30Shown).toBe(true);
        expect(s.researchNewDismissed).toBe(true);
        // The item stays, without the label.
        await openActionsMenu(page);
        await expect(menuRow(page)).toBeVisible();
        await expect(menuRow(page).locator('.research-new-badge')).toBeHidden();
        await expect(menuRow(page)).toHaveAttribute('aria-label', 'AI ancestor research');

        // Once only: not after a reload.
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await page.waitForTimeout(1200);
        await expect(whatsNew(page)).toHaveCount(0);
    });

    test('"Not now" closes the card and puts the dot and the label out', async ({ page }) => {
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        await whatsNew(page).getByRole('button', { name: 'Not now' }).click();
        await expect(whatsNew(page)).toHaveCount(0);
        await expect(newDot(page)).toBeHidden();
        await openActionsMenu(page);
        await expect(menuRow(page).locator('.research-new-badge')).toBeHidden();
    });

    test('the card counts as shown even when it is just ignored', async ({ page }) => {
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        // Ignored (no button pressed): still counted as shown.
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await page.waitForTimeout(1200);
        await expect(whatsNew(page)).toHaveCount(0);
        // … and the "New" marker is still lit (only the buttons put it out).
        await expect(newDot(page)).toBeVisible();
    });

    test('the "New" dot on Actions; the item opens the dialog, which puts "New" out; the item stays', async ({ page, context }) => {
        await stubSite(context);
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        const actionsBtn = page.locator('.actions-menu-btn');
        await expect(newDot(page)).toBeVisible();
        await expect(actionsBtn).toHaveAttribute('aria-label', 'Actions, new item');
        // The red anniversaries dot wins: only one dot on the trigger.
        await page.evaluate(() => window.Strom.UI.refreshResearchNewMarker(1));
        await expect(newDot(page)).toBeHidden();
        await page.evaluate(() => window.Strom.UI.refreshResearchNewMarker(0));
        await expect(newDot(page)).toBeVisible();

        // Opening the menu closes the card (without putting "New" out).
        await openActionsMenu(page);
        await expect(whatsNew(page)).toHaveCount(0);
        await expect(menuRow(page)).toBeVisible();
        await expect(menuRow(page)).toHaveAttribute('aria-label', 'AI ancestor research, new');
        const badge = menuRow(page).locator('.research-new-badge');
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText('New');
        // Right below the "Strom:" row, above Settings.
        const after = await page.evaluate(() => {
            const wrap = document.getElementById('actions-tree-wrap')!;
            return [wrap.nextElementSibling?.className, wrap.nextElementSibling?.nextElementSibling?.id];
        });
        expect(after).toEqual(['tree-switcher-divider research-menu-divider', 'research-menu-row']);

        await menuRow(page).click();
        const dialog = infoDialog(page);
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.modal.modal--sm h2')).toHaveText('AI ancestor research');
        await expect(dialog.locator('.research-info-point')).toHaveCount(3);
        await expect(dialog.locator('.research-info-need')).toContainText('What you need');
        await expect(dialog.locator('.research-info-need')).toContainText('we recommend Claude');
        await expect(newDot(page)).toBeHidden();
        await expect(actionsBtn).toHaveAttribute('aria-label', 'Actions');
        expect((await readSettings(page)).researchNewDismissed).toBe(true);

        // The primary button opens the site and closes the dialog.
        expect(await popupUrlAfter(page, () => dialog.getByRole('button', { name: /Open the Strom Research page/ }).click())).toBe(SITE);
        await expect(dialog).toHaveCount(0);

        await openActionsMenu(page);
        await expect(menuRow(page)).toBeVisible();
        await expect(menuRow(page).locator('.research-new-badge')).toBeHidden();
        // Close / click outside close the dialog too.
        await menuRow(page).click();
        await infoDialog(page).locator('.research-info-buttons button.secondary').click();
        await expect(infoDialog(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.showResearchInfoDialog());
        await infoDialog(page).click({ position: { x: 5, y: 5 } });
        await expect(infoDialog(page)).toHaveCount(0);
    });

    test('keyboard: Esc on the card = "Not now", focus back to the tree; the item by arrows / Tab, Enter opens, Esc closes and returns focus', async ({ page }) => {
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(whatsNew(page)).toHaveCount(0);
        expect((await readSettings(page)).researchNewDismissed).toBe(true);
        expect(await page.evaluate(() => document.activeElement?.classList.contains('person-card'))).toBe(true);

        // Arrows: from the trigger, ArrowUp lands on the last row — the item (1440px: no Settings row).
        const trigger = page.locator('.actions-menu-btn');
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
        await page.keyboard.press('ArrowUp');
        await expect(menuRow(page)).toBeFocused();
        // Tab: from the "Strom:" row the next stop is the item.
        await page.locator('#actions-tree-row').focus();
        await page.keyboard.press('Tab');
        await expect(menuRow(page)).toBeFocused();

        await page.keyboard.press('Enter');
        await expect(infoDialog(page)).toBeVisible();
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
        await page.keyboard.press('Escape');
        await expect(infoDialog(page)).toHaveCount(0);
        await expect(trigger).toBeFocused();
    });

    test('30 days after it was first shown the "New" label is out by itself', async ({ page }) => {
        await existingTreeFirstRun(page);
        await expect(newDot(page)).toBeVisible();
        const firstSeen = (await readSettings(page)).researchNewFirstSeen;
        expect(typeof firstSeen).toBe('string');
        const past = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
        await setPromoSettings(page, { researchNewFirstSeen: past, whatsNew30Shown: true });
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await openActionsMenu(page);
        await expect(menuRow(page)).toBeVisible();
        await expect(menuRow(page).locator('.research-new-badge')).toBeHidden();
        await expect(newDot(page)).toBeHidden();
        await expect(page.locator('.actions-menu-btn')).toHaveAttribute('aria-label', 'Actions');
    });

    test('state lives in the browser settings, never in the tree data or its export', async ({ page }) => {
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        await whatsNew(page).getByRole('button', { name: 'Not now' }).click();
        const s = await readSettings(page);
        expect(s.whatsNew30Shown).toBe(true);
        expect(s.researchNewDismissed).toBe(true);
        expect(typeof s.researchNewFirstSeen).toBe('string');

        const exported = fs.readFileSync(await exportTreeJson(page), 'utf8');
        for (const key of ['researchNewFirstSeen', 'researchNewDismissed', 'whatsNew30Shown']) {
            expect(exported).not.toContain(key);
        }
        const stored = await page.evaluate(() => new Promise<string>((resolve) => {
            const req = indexedDB.open('strom-db');
            req.onsuccess = () => {
                const db = req.result;
                const out: unknown[] = [];
                const names = Array.from(db.objectStoreNames);
                const tx = db.transaction(names, 'readonly');
                let left = names.length;
                for (const n of names) {
                    const all = tx.objectStore(n).getAll();
                    all.onsuccess = () => { out.push(all.result); if (--left === 0) resolve(JSON.stringify(out)); };
                    all.onerror = () => { if (--left === 0) resolve(JSON.stringify(out)); };
                }
                if (names.length === 0) resolve('');
            };
            req.onerror = () => resolve('');
        }));
        expect(stored).toContain('Jan');
        for (const key of ['researchNewFirstSeen', 'researchNewDismissed', 'whatsNew30Shown']) {
            expect(stored).not.toContain(key);
        }
    });

    test('dark theme: the card and the dialog use the dark tokens (screenshots/)', async ({ page }, testInfo) => {
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        await page.evaluate(() => window.Strom.SettingsManager.setTheme('dark'));
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        const bg = await whatsNew(page).evaluate(el => getComputedStyle(el).backgroundColor);
        expect(bg).toBe('rgb(44, 42, 36)'); // --surface (dark)
        await shot(page, 'research-card-desktop-dark.png', testInfo);
        await whatsNew(page).getByRole('button', { name: 'Not now' }).click();
        await page.evaluate(() => window.Strom.UI.showResearchInfoDialog());
        await expect(infoDialog(page)).toBeVisible();
        const needBg = await infoDialog(page).locator('.research-info-need').evaluate(el => getComputedStyle(el).backgroundColor);
        // Warm like the palette (copper mixed into the surface), not the cold --info-soft.
        const [r, , b] = (needBg.match(/[\d.]+/g) ?? []).map(Number);
        expect(needBg).not.toBe('rgb(42, 49, 57)');
        expect(r).toBeGreaterThan(b);
        await shot(page, 'research-dialog-desktop-dark.png', testInfo);
    });
});

// ---- 3 + 4: the bottom-navigation regime ----

test.describe('existing tree on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the card is a bottom sheet; "Not now" puts the More dot out; the item stays in the More sheet', async ({ page }) => {
        await existingTreeFirstRun(page);
        const sheet = whatsNew(page);
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveClass(/bottom-sheet/);
        await expect(sheet).toContainText('Runs on a computer (Windows, Mac, Linux)');
        // The dot rides the bottom-bar "More" tab only — never the top ⋯.
        await expect(moreDot(page)).toBeVisible();
        // Other states may prefix it ("More – changes only in the browser"); the new item is always said.
        await expect(page.locator('#bb-view-more')).toHaveAttribute('aria-label', /^More.*, new item$/);
        await expect(page.locator('.mobile-more-btn [class*="dot"]')).toHaveCount(0);
        await expect(newDot(page)).toBeHidden();

        const buttons = await sheet.locator('.whats-new-actions button').evaluateAll(els =>
            els.map(e => ({ h: e.getBoundingClientRect().height })));
        for (const b of buttons) expect(b.h).toBeGreaterThanOrEqual(48);
        await sheet.getByRole('button', { name: 'Not now' }).click();
        await expect(whatsNew(page)).toHaveCount(0);
        await expect(moreDot(page)).toBeHidden();
        await expect(page.locator('#bb-view-more')).not.toHaveAttribute('aria-label', /new item/);

        await page.locator('#bb-view-more').click();
        const row = page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'AI ancestor research' });
        await expect(row).toBeVisible();
        await expect(row.locator('.research-new-badge')).toHaveCount(0);
    });

    test('while new: the More sheet row right below the "Strom:" row carries the label; it opens the dialog', async ({ page }) => {
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        // A tap on the backdrop = "Not now" — reset the marker to test the row while new.
        await page.mouse.click(195, 100);
        await expect(whatsNew(page)).toHaveCount(0);
        await setPromoSettings(page, { whatsNew30Shown: true });
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(moreDot(page)).toBeVisible();

        await page.locator('#bb-view-more').click();
        const items = page.locator('.bottom-sheet-menu .bottom-sheet-items > *');
        const classes = await items.evaluateAll(els => els.map(e => e.className + '|' + (e.textContent || '').trim()));
        const treeIdx = classes.findIndex(c => c.includes('bottom-sheet-tree-row'));
        expect(classes[treeIdx + 1]).toContain('bottom-sheet-divider');
        expect(classes[treeIdx + 2]).toContain('AI ancestor research');
        const row = page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'AI ancestor research' });
        await expect(row).toHaveAttribute('aria-label', 'AI ancestor research, new');
        await expect(row.locator('.research-new-badge')).toHaveText('New');
        await row.click();
        const dialog = infoDialog(page);
        await expect(dialog).toBeVisible();
        await expect(moreDot(page)).toBeHidden();
        // ≤ 499px: stacked full-width buttons, the primary on top, ≥ 48px.
        const geo = await dialog.locator('.research-info-buttons button').evaluateAll(els =>
            els.map(e => { const r = e.getBoundingClientRect(); return { cls: e.className, top: r.top, h: r.height, w: r.width }; }));
        const primary = geo.find(g => g.cls.includes('primary'))!;
        const secondary = geo.find(g => g.cls.includes('secondary'))!;
        expect(primary.top).toBeLessThan(secondary.top);
        expect(primary.h).toBeGreaterThanOrEqual(48);
        expect(Math.abs(primary.w - secondary.w)).toBeLessThanOrEqual(1);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });
});

test.describe('existing tree on a tablet (bottom navigation up to 1024px)', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('the card is the sheet and the dot sits on the More tab', async ({ page }) => {
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        await expect(whatsNew(page)).toHaveClass(/whats-new-sheet/);
        await expect(moreDot(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(whatsNew(page)).toHaveCount(0);
        await expect(moreDot(page)).toBeHidden();
    });
});

// ---- 7: where nothing is shown ----

test.describe('hidden', () => {
    test.use({ viewport: DESKTOP });

    test('view mode / exported strom.html from disk: no offer, no item, no card, no dots', async ({ page }, testInfo) => {
        await openApp(page, { researchPromo: true });
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.showExportDialog());
        await page.evaluate(() => window.Strom.UI.exportTargetTreeApp());
        const pwd = page.locator('#export-password-modal');
        await expect(pwd).toBeVisible();
        await pwd.locator('#export-privacy-mode').selectOption('full');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            pwd.getByRole('button', { name: 'Export without encryption' }).click(),
        ]);
        const out = testInfo.outputPath('exported.html');
        await download.saveAs(out);
        await page.goto(pathToFileURL(out).href);
        await expect(card(page, 'Jan')).toBeVisible();
        await expect(page.locator('body')).toHaveClass(/view-mode/);
        await page.waitForTimeout(1200);
        await expect(whatsNew(page)).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveClass(/research-promo/);
        await expect(newDot(page)).toBeHidden();
        await expect(moreDot(page)).toBeHidden();
        await page.locator('.actions-menu-btn').click();
        await expect(menuRow(page)).toBeHidden();
        const settings = await readSettings(page);
        expect(settings.whatsNew30Shown).toBeUndefined();
        expect(settings.researchNewFirstSeen).toBeUndefined();
    });

    test('an exported app without data opened from disk shows no welcome-screen offer', async ({ page }, testInfo) => {
        // The built single file itself, opened via file:// (embedded mode).
        const out = testInfo.outputPath('strom.html');
        fs.copyFileSync(path.join(process.cwd(), 'strom.html'), out);
        await page.goto(pathToFileURL(out).href);
        await expect(page.locator('#empty-state')).toBeVisible();
        await expect(page.locator('#empty-state .research-offer')).toBeHidden();
        await page.locator('.actions-menu-btn').click();
        await expect(menuRow(page)).toBeHidden();
        await expect(newDot(page)).toBeHidden();
    });

    test('locked data / password prompt: no card, no item, no dots, no offer', async ({ page }) => {
        const PASSWORD = 'linden-tree-42';
        await openApp(page, { researchPromo: true });
        await createFirstPerson(page, 'Jan', 'Novak');
        await waitForPersist(page, 'Jan');
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settingsModal = page.locator('#settings-modal');
        await settingsModal.locator('#encryption-toggle').check();
        const setup = page.locator('#password-setup-modal');
        await setup.locator('#password-setup-input').fill(PASSWORD);
        await setup.locator('#password-setup-confirm').fill(PASSWORD);
        await setup.getByRole('button', { name: 'Save' }).click();
        await expect(setup).toBeHidden();
        await expect(settingsModal.locator('#encryption-status')).toHaveText('Encryption enabled');
        await page.keyboard.press('Escape');
        await setPromoSettings(page, {});

        await page.reload();
        const prompt = page.locator('#password-prompt-modal');
        await expect(prompt).toBeVisible();
        await page.waitForTimeout(1200);
        await expect(whatsNew(page)).toHaveCount(0);
        await prompt.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.locator('body')).toHaveClass(/\bdata-locked\b/);
        await page.waitForTimeout(1200);
        await expect(whatsNew(page)).toHaveCount(0);
        await expect(page.locator('#empty-state .research-offer')).toBeHidden();
        await expect(newDot(page)).toBeHidden();
        await page.locator('.actions-menu-btn').click();
        await expect(menuRow(page)).toBeHidden();
        expect((await readSettings(page)).whatsNew30Shown).toBeUndefined();
    });

    test('a tree from Strom Research: no card, no "New" — but the item is there', async ({ page }) => {
        await openApp(page, { researchPromo: true });
        const ged = [
            '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 23 SEP 2026',
            '1 _STROM_TREE 3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', '1 CHAR UTF-8', '1 NOTE Víškovi',
            '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 REFN P0001',
            '0 TRLR',
        ].join('\n');
        const dataTransfer = await page.evaluateHandle((content) => {
            const dt = new DataTransfer();
            dt.items.add(new File([content], 'tree-strom.ged', { type: 'text/plain' }));
            return dt;
        }, ged);
        await page.dispatchEvent('#tree-container', 'dragenter', { dataTransfer });
        await page.dispatchEvent('#tree-container', 'dragover', { dataTransfer });
        await page.dispatchEvent('#tree-container', 'drop', { dataTransfer });
        await expect(card(page, 'Josef')).toBeVisible();
        await waitForPersist(page, 'Josef');
        await setPromoSettings(page, {});
        await page.reload();
        await expect(card(page, 'Josef')).toBeVisible();
        await page.waitForTimeout(1200);
        await expect(whatsNew(page)).toHaveCount(0);
        await expect(newDot(page)).toBeHidden();
        await openActionsMenu(page);
        await expect(menuRow(page)).toBeVisible();
        await expect(menuRow(page).locator('.research-new-badge')).toBeHidden();
    });

    test('an open from the command line: no card, but the "New" marker', async ({ page }) => {
        await existingTreeFirstRun(page);
        await expect(whatsNew(page)).toBeVisible();
        await setPromoSettings(page, {});
        // The installed app's file handler start (?open=file) — a Strom Research open.
        await page.goto('/strom.html?open=file');
        await expect(card(page, 'Jan')).toBeVisible();
        await page.waitForTimeout(1200);
        await expect(whatsNew(page)).toHaveCount(0);
        await expect(newDot(page)).toBeVisible();
        expect((await readSettings(page)).whatsNew30Shown).toBeUndefined();
    });
});

// ---- 11: nothing overflows on a small phone in German ----

test.describe('layout-overflow at 360 × 780 (DE)', () => {
    test.use({ viewport: { width: 360, height: 780 }, locale: 'de-DE', hasTouch: true, isMobile: true });

    test('welcome offer, 3.0 card sheet, More sheet and dialog fit', async ({ page }) => {
        await openApp(page, { researchPromo: true });
        await expect(page.locator('#empty-state .research-offer')).toBeVisible();
        await expectNoOverflow(page, '#empty-state .research-offer');

        await page.evaluate(() => window.Strom.DataManager.createPerson({ firstName: 'Jan', lastName: 'Novak', gender: 'male' }));
        await waitForPersist(page, 'Jan');
        await setPromoSettings(page, {});
        await page.reload();
        await expect(whatsNew(page)).toBeVisible();
        await expect(whatsNew(page)).toContainText('Ahnenforschung mit einem KI-Agenten');
        await expectNoOverflow(page, '.whats-new-sheet');
        const sheetBox = await whatsNew(page).boundingBox();
        expect(sheetBox!.y).toBeGreaterThanOrEqual(0);
        await whatsNew(page).getByRole('button', { name: 'Jetzt nicht' }).click();

        await setPromoSettings(page, { whatsNew30Shown: true, researchNewDismissed: undefined });
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await page.locator('#bb-view-more').click();
        await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
        await expect(page.locator('.bottom-sheet-menu .research-new-badge')).toHaveText('Neu');
        await expectNoOverflow(page, '.bottom-sheet-menu');
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'KI-Ahnenforschung' }).click();
        await expect(infoDialog(page)).toBeVisible();
        await expectNoOverflow(page, '#research-info-modal .modal');
    });
});

/**
 * On a phone (390 px) a long label wraps instead of being cut with "…" in the
 * middle of a word: the person sheet's tiles (de "Fokussieren", pl "Ustaw w
 * centrum"), the tree overview's title (de "Stammbaum-Überblick: <tree>") and
 * the title of the research overview's own window ("<tree> ·
 * Forschungsübersicht"). Each word of the label stands whole on one line,
 * nothing is wider than its box or the window. Invented names only.
 */

import { test, expect, Locator, Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';
import { followManaged } from './live-directions-bridge.js';

const LONG = 'Familienforschung Fíšek-Smrkov';
const PHONE = { width: 390, height: 844 };

/** The label is whole: not cut ("…", hidden overflow), each word on one line, within its box. */
async function whole(label: Locator): Promise<void> {
    const r = await label.evaluate((el) => {
        const cs = getComputedStyle(el);
        const text = el.textContent ?? '';
        // Each word on one line (a run without spaces; a hyphen ends a part, a line may break after it):
        // one line for its range.
        const node = el.firstChild;
        const broken: string[] = [];
        if (node && node.nodeType === Node.TEXT_NODE) {
            for (const m of text.matchAll(/[^\s-]+-?/g)) {
                const range = document.createRange();
                range.setStart(node, m.index!);
                range.setEnd(node, m.index! + m[0].length);
                const lines = new Set(Array.from(range.getClientRects()).filter(q => q.width > 0).map(q => Math.round(q.top)));
                if (lines.size !== 1) broken.push(m[0]);
            }
        }
        return {
            text,
            nowrap: cs.whiteSpace === 'nowrap',
            wide: el.scrollWidth - el.clientWidth,
            tall: el.scrollHeight - el.clientHeight,
            broken,
            right: el.getBoundingClientRect().right,
        };
    });
    expect(r.nowrap, `"${r.text}" may wrap`).toBe(false);
    expect(r.wide, `"${r.text}" wider than its box`).toBeLessThanOrEqual(0);
    expect(r.tall, `"${r.text}" taller than its box`).toBeLessThanOrEqual(1);
    expect(r.broken, `"${r.text}": words torn apart`).toEqual([]);
    expect(r.right).toBeLessThanOrEqual(PHONE.width);
}

async function noSidewaysScroll(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function phoneTree(page: Page, lang: string): Promise<void> {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(([l, name]) => {
        const id = Object.keys(window.Strom.DataManager.getData().persons)[0];
        window.Strom.DataManager.updatePerson(id as never, { story: { text: 'A story.' } } as never);
        window.Strom.TreeManager.renameTree(window.Strom.TreeManager.getActiveTreeId()!, name);
        window.Strom.UI.setLanguage(l as never);
        window.Strom.TreeRenderer.render();
    }, [lang, LONG]);
}

test.describe('a phone (390): long labels wrap, never cut in a word', () => {
    test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

    for (const [lang, focus] of [['de', 'Fokussieren'], ['pl', 'Ustaw w centrum']] as const) {
        test(`${lang}: the person sheet's tiles show their labels whole ("${focus}")`, async ({ page }) => {
            await phoneTree(page, lang);
            await card(page, 'Jan').click();
            const sheet = page.locator('.bottom-sheet-person');
            await expect(sheet).toBeVisible();
            await page.waitForTimeout(300);
            const labels = sheet.locator('.sheet-tile-label');
            await expect(labels).toHaveCount(4);
            await expect(sheet.locator('.sheet-tile[data-action="focus"] .sheet-tile-label')).toHaveText(focus);
            for (let i = 0; i < 4; i++) {
                await whole(labels.nth(i));
                // Within its tile.
                const [tile, label] = await Promise.all([
                    sheet.locator('.sheet-tile').nth(i).boundingBox(),
                    labels.nth(i).boundingBox(),
                ]);
                expect(label!.x).toBeGreaterThanOrEqual(tile!.x);
                expect(label!.x + label!.width).toBeLessThanOrEqual(tile!.x + tile!.width + 0.5);
                expect(label!.y + label!.height).toBeLessThanOrEqual(tile!.y + tile!.height + 0.5);
            }
            await noSidewaysScroll(page);
        });
    }

    test('de: the tree overview\'s title wraps whole beside its buttons; the person row sticks right under the head', async ({ page }) => {
        await phoneTree(page, 'de');
        await page.evaluate(() => window.Strom.UI.showTreeOverview(window.Strom.TreeManager.getActiveTreeId()! as never));
        const modal = page.locator('#tree-overview-modal .modal.tov');
        const title = modal.locator('.tov-title');
        await expect(title).toHaveText(`Stammbaum-Überblick: ${LONG}`);
        await whole(title);
        // More lines than one, the head's buttons beside it within the window.
        expect((await title.boundingBox())!.height).toBeGreaterThan(30);
        for (const sel of ['.tov-pages', '.tov-close']) {
            const b = (await modal.locator(sel).boundingBox())!;
            expect(b.x + b.width).toBeLessThanOrEqual(PHONE.width);
        }
        await whole(modal.locator('.tov-pages'));
        // Scrolled: the person row sticks under the head, not under it.
        await modal.locator('.tov-scroll').evaluate((el) => { el.scrollTop = 400; });
        await expect.poll(async () => {
            const [bar, root] = await Promise.all([modal.locator('.tov-titlebar').boundingBox(), modal.locator('.tov-root').boundingBox()]);
            return Math.round(root!.y - (bar!.y + bar!.height));
        }).toBe(0);
        await noSidewaysScroll(page);
    });
});

test.describe('the research overview\'s own window 390 wide', () => {
    test('de: its title wraps whole', async ({ page }) => {
        await followManaged(page);
        await page.evaluate((name) => {
            window.Strom.TreeManager.renameTree(window.Strom.TreeManager.getActiveTreeId()!, name);
            window.Strom.UI.setLanguage('de' as never);
        }, LONG);
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        await popup.setViewportSize(PHONE);
        const title = popup.locator('#research-overview.research-overview--window .research-overview__head--window .research-overview__title');
        await expect(title).toHaveText(`${LONG} · Forschungsübersicht`);
        await whole(title);
        // The head's dot stays beside the title (not on a line of its own above it).
        const head = popup.locator('.research-overview__head--window');
        const [dot, t] = await Promise.all([head.locator('> .live-dot').boundingBox(), title.boundingBox()]);
        expect(dot!.y + dot!.height / 2).toBeGreaterThan(t!.y);
        expect(dot!.y + dot!.height / 2).toBeLessThan(t!.y + t!.height);
        // The head's buttons within the window.
        for (const b of await head.locator('> button').all()) {
            const box = (await b.boundingBox())!;
            expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
        }
        await noSidewaysScroll(popup);
    });
});

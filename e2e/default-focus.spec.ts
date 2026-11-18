import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp, reloadApp } from './helpers.js';

/**
 * "Focus default person" (spec 111): ⌂ first in "Focused on" — the desktop
 * pill, the tablet toolbar and a phone held sideways. A click focuses the
 * tree's default person as a step of the history ("Focused on … · ↩ Back",
 * Back returns); with the default person in focus it is filled, muted and
 * inert, and nothing beside it moves. The target follows "Default person and
 * view": a specific person, the first person, the person the tree opened on
 * ("Last focused"); a deleted default person leads to the first person
 * (variant A), Undo brings it back; an empty tree has no ⌂. Invented data:
 * the comprehensive fixture (first person ggp_h_h).
 */

const FIRST = 'ggp_h_h';
const DEFAULT = 'grandchild_1';
const OTHER = 'father';

const pillHome = (page: Page) => page.locator('#focus-home-btn');
const barHome = (page: Page) => page.locator('#toolbar-focus-home-btn');
const focusOf = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId());
const toast = (page: Page) => page.locator('.focus-toast-box');

/** Import the fixture as a new tree with `defaultPersonId` set (undefined = first person). */
async function setupTree(page: Page, defaultPersonId?: string): Promise<void> {
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8'));
    if (defaultPersonId) data.defaultPersonId = defaultPersonId;
    await page.evaluate(async (tree) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Home');
    }, data);
    await expect(page.locator(`#tree-canvas .person-card[data-id="${defaultPersonId ?? FIRST}"]`)).toBeVisible();
}

async function focus(page: Page, id: string): Promise<void> {
    await page.evaluate(async (pid) => { await window.Strom.TreeRenderer.setFocus(pid as never); }, id);
    await expect.poll(() => focusOf(page)).toBe(id);
}

test.describe('desktop 1440 × 900', () => {
    test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });

    test('⌂ focuses the default person as a history step; at home it is inert and nothing moves', async ({ page }) => {
        await openApp(page);
        await setupTree(page, DEFAULT);
        const home = pillHome(page);
        // Opened on the default person: filled, muted, inert, still in place.
        await expect(home).toBeVisible();
        await expect(home).toHaveAttribute('data-state', 'home');
        await expect(home).toHaveAttribute('aria-disabled', 'true');
        await expect(home).toHaveAttribute('aria-label', /^Default person is in focus: /);
        await expect(home).not.toHaveAttribute('title', /\(H\)/);
        // First in the pill, before "Focused on".
        const order = await page.evaluate(() => {
            const info = document.querySelector('#focus-controls .focus-info')!;
            return [...info.children].map(c => c.className);
        });
        expect(order[0]).toContain('focus-home');
        expect(order.indexOf('focus-label')).toBeGreaterThan(0);

        await focus(page, OTHER);
        await expect(home).toHaveAttribute('data-state', 'active');
        await expect(home).toHaveAttribute('aria-disabled', 'false');
        await expect(home).toHaveAttribute('title', /^Focus default person: .+ \(H\)$/);
        const nameBefore = await page.locator('#focus-label, #focus-controls .focus-label').boundingBox();

        await home.click();
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);
        await expect(toast(page)).toBeVisible();
        await expect(home).toHaveAttribute('data-state', 'home');
        // The state change moves nothing beside ⌂ (§4).
        const nameAfter = await page.locator('#focus-controls .focus-label').boundingBox();
        expect(Math.round(nameAfter!.x)).toBe(Math.round(nameBefore!.x));

        // A click at home does nothing: no step, no toast.
        await page.evaluate(() => document.querySelector('.focus-toast-box')?.remove());
        await home.click({ force: true });   // aria-disabled: Playwright would wait for it
        await page.waitForTimeout(150);
        expect(await focusOf(page)).toBe(DEFAULT);
        await expect(toast(page)).toHaveCount(0);

        // Back returns to the previous person.
        await page.locator('#focus-back-btn').click();
        await expect.poll(() => focusOf(page)).toBe(OTHER);
        await expect(home).toHaveAttribute('data-state', 'active');
    });

    test('the pill holds a long German name: the name ellipsizes, the steppers stay whole', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        await setupTree(page, DEFAULT);
        await page.evaluate((id) => {
            window.Strom.DataManager.updatePerson(id as never, { firstName: 'Maximiliane Konstanze', lastName: 'Zbořilová-Hohenwart' } as never);
        }, OTHER);
        await focus(page, OTHER);
        const fit = await page.evaluate(() => {
            const pill = document.getElementById('focus-controls')!;
            const box = pill.getBoundingClientRect();
            const inside = [...pill.querySelectorAll<HTMLElement>('.focus-home, .depth-stepper, .focus-clear')]
                .filter(el => el.getClientRects().length > 0)
                .every(el => { const r = el.getBoundingClientRect(); return r.left >= box.left - 0.5 && r.right <= box.right + 0.5; });
            return { inside, pillOverflow: pill.scrollWidth - pill.clientWidth, right: box.right, vw: innerWidth };
        });
        expect(fit.inside).toBe(true);
        expect(fit.pillOverflow).toBeLessThanOrEqual(0);
        expect(fit.right).toBeLessThanOrEqual(fit.vw);
    });

    test('the target follows the setting: first person, the dialog, a deleted default person and Undo', async ({ page }) => {
        await openApp(page);
        await setupTree(page);
        const home = pillHome(page);
        await focus(page, OTHER);
        await expect(home).toHaveAttribute('aria-label', /– first person in the tree$/);
        await home.click();
        await expect.poll(() => focusOf(page)).toBe(FIRST);

        // "Default person and view" → a specific person: ⌂ leads there at once.
        await page.evaluate((id) => {
            window.Strom.DataManager.setDefaultPerson(id as never);
            window.Strom.TreeRenderer.render();
        }, DEFAULT);
        await expect(home).toHaveAttribute('data-state', 'active');
        await expect(home).toHaveAttribute('aria-label', /^Focus default person: [^–]+$/);
        await home.click();
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);

        // The dialog's "First person" saved: the first person again.
        await page.evaluate(async () => {
            await window.Strom.UI.showDefaultPersonDialog(window.Strom.DataManager.getCurrentTreeId()!);
        });
        await page.locator('#default-person-first').check();
        await page.locator('#default-person-modal button.primary').click();
        await expect(home).toHaveAttribute('aria-label', /– first person in the tree$/);

        // A specific default person deleted: the first person (variant A); Undo brings the person back.
        await page.evaluate((id) => {
            window.Strom.DataManager.setDefaultPerson(id as never);
            window.Strom.DataManager.deletePerson(id as never);
        }, OTHER);
        await expect(home).toHaveAttribute('aria-label', /– first person in the tree$/);
        await page.evaluate(() => window.Strom.UI.performUndo());
        await expect(home).toHaveAttribute('aria-label', /^Focus default person: [^–]+$/);
        await home.click();
        await expect.poll(() => focusOf(page)).toBe(OTHER);
    });

    test('"Last focused" leads to the person the tree opened on, not the last one focused', async ({ page }) => {
        await openApp(page);
        await setupTree(page);
        await page.evaluate(() => window.Strom.DataManager.setDefaultPerson('__last_focused__' as never));
        await focus(page, DEFAULT);
        await reloadApp(page);
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);
        const home = pillHome(page);
        await expect(home).toHaveAttribute('data-state', 'home');
        for (const id of [OTHER, FIRST, 'sibling_1']) await focus(page, id);
        await expect(home).toHaveAttribute('aria-label', /– focused when the tree opened$/);
        await home.click();
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);
    });

    test('an empty tree has no ⌂', async ({ page }) => {
        await openApp(page);
        await page.evaluate(async () => {
            await window.Strom.DataManager.importAsNewTree({ version: 1, persons: {}, partnerships: {} } as never, 'Empty');
        });
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getAllPersons().length)).toBe(0);
        await expect(pillHome(page)).toBeHidden();
        await expect(pillHome(page)).toHaveAttribute('hidden', '');
    });
});

for (const [label, viewport] of [
    ['tablet 1024 × 768', { width: 1024, height: 768 }],
    ['tablet 768 × 1024', { width: 768, height: 1024 }],
    ['phone held sideways 844 × 390', { width: 844, height: 390 }],
] as const) {
    test.describe(label, () => {
        test.use({ viewport, locale: 'de-DE', hasTouch: true, isMobile: label.startsWith('phone') });

        test('⌂ is first in the toolbar, focuses the default person, ⋯ stays in the bar', async ({ page }) => {
            await openApp(page);
            await setupTree(page, DEFAULT);
            await page.evaluate((id) => {
                window.Strom.DataManager.updatePerson(id as never, { firstName: 'Wendelin Maximilian', lastName: 'Zbořil-Wendelsteiner' } as never);
            }, OTHER);
            await focus(page, OTHER);
            const home = barHome(page);
            await expect(home).toBeVisible();
            await expect(home).toHaveAttribute('data-state', 'active');
            const geo = await page.evaluate(() => {
                const bar = document.querySelector<HTMLElement>('.toolbar')!;
                const focusBox = document.querySelector<HTMLElement>('.toolbar .toolbar-focus')!;
                const first = [...focusBox.children].find(c => (c as HTMLElement).getClientRects().length > 0) as HTMLElement;
                const more = [...document.querySelectorAll<HTMLElement>('.mobile-more-btn')].find(el => el.getClientRects().length > 0);
                const mr = more?.getBoundingClientRect();
                const hr = document.getElementById('toolbar-focus-home-btn')!.getBoundingClientRect();
                return {
                    firstId: first.id, overflow: bar.scrollWidth - bar.clientWidth,
                    moreInside: !mr || (mr.right <= innerWidth + 0.5 && mr.width > 0),
                    homeSize: [Math.round(hr.width), Math.round(hr.height)],
                };
            });
            expect(geo.firstId).toBe('toolbar-focus-home-btn');
            expect(geo.overflow).toBeLessThanOrEqual(0);
            expect(geo.moreInside).toBe(true);
            expect(geo.homeSize).toEqual([44, 44]);
            await home.click();
            await expect.poll(() => focusOf(page)).toBe(DEFAULT);
            await expect(home).toHaveAttribute('data-state', 'home');
        });

        test('the map has no ⌂', async ({ page }) => {
            await openApp(page);
            await setupTree(page, DEFAULT);
            await focus(page, OTHER);
            await expect(barHome(page)).toBeVisible();
            await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('map' as never));
            await expect(barHome(page)).toBeHidden();
        });
    });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }]) {
    test.describe(`phone ${viewport.width} × ${viewport.height}`, () => {
        test.use({ viewport, locale: 'de-DE', hasTouch: true, isMobile: true });

        test('⌂ first in the person panel: 44 px, the panel stays 48 px, a tap focuses without the person sheet, the name keeps its place', async ({ page }) => {
            await openApp(page);
            await setupTree(page, DEFAULT);
            await page.evaluate((id) => {
                window.Strom.DataManager.updatePerson(id as never, { firstName: 'Maximiliane Konstanze', lastName: 'Zbořilová-Hohenwart' } as never);
                // The change's own toast would hold the focus toast back (one toast at a time).
                window.Strom.UI.dismissUndoToast();
            }, OTHER);
            await focus(page, OTHER);
            const home = pillHome(page);
            await expect(home).toBeVisible();
            await expect(home).toHaveAttribute('data-state', 'active');
            const geo = () => page.evaluate(() => {
                const panel = document.getElementById('focus-controls')!;
                const info = panel.querySelector<HTMLElement>('.focus-info')!;
                const first = [...info.children].find(c => (c as HTMLElement).getClientRects().length > 0) as HTMLElement;
                const h = document.getElementById('focus-home-btn')!.getBoundingClientRect();
                const name = document.getElementById('focus-name')!;
                const n = name.getBoundingClientRect();
                return {
                    firstId: first.id, panelH: Math.round(panel.getBoundingClientRect().height),
                    home: [Math.round(h.width), Math.round(h.height)], homeLeft: Math.round(h.left),
                    nameX: Math.round(n.left), nameEllipsized: name.scrollWidth > name.clientWidth,
                    overflow: document.documentElement.scrollWidth - innerWidth, panelOverflow: panel.scrollWidth - panel.clientWidth,
                    overlap: h.right > n.left + 0.5,
                };
            });
            const before = await geo();
            expect(before.firstId).toBe('focus-home-btn');
            expect(before.panelH).toBe(48);
            expect(before.home).toEqual([44, 44]);
            expect(before.homeLeft).toBeLessThanOrEqual(4);
            expect(before.nameEllipsized).toBe(true);
            expect(before.overflow).toBeLessThanOrEqual(0);
            expect(before.panelOverflow).toBeLessThanOrEqual(0);
            expect(before.overlap).toBe(false);

            await home.tap();
            await expect.poll(() => focusOf(page)).toBe(DEFAULT);
            await expect(home).toHaveAttribute('data-state', 'home');
            await expect(toast(page)).toBeVisible();
            await expect(page.locator('.bottom-sheet-overlay')).toHaveCount(0);
            const after = await geo();
            expect(after.panelH).toBe(48);
            expect(after.nameX).toBe(before.nameX);

            // At home a tap does nothing (no sheet either).
            await page.evaluate(() => document.querySelector('.focus-toast-box')?.remove());
            await home.tap({ force: true });
            await page.waitForTimeout(150);
            expect(await focusOf(page)).toBe(DEFAULT);
            await expect(toast(page)).toHaveCount(0);
            await expect(page.locator('.bottom-sheet-overlay')).toHaveCount(0);
        });
    });
}

test.describe('the shortcut H (and ⌘1 / Ctrl+1)', () => {
    test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });

    /** The canvas has the keyboard: nothing typed into. */
    const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    test('H, h and Shift+H focus the default person as a step with Back; at home nothing; the button tells ⌘1 / Ctrl+1 by platform', async ({ page }) => {
        await openApp(page);
        await setupTree(page, DEFAULT);
        const mac = await page.evaluate(() => window.Strom.UI.isMacPlatform());
        await expect(pillHome(page)).toHaveAttribute('aria-keyshortcuts', mac ? 'H Meta+1' : 'H Control+1');
        for (const key of ['h', 'H', 'Shift+H']) {
            await focus(page, OTHER);
            await blur(page);
            await page.keyboard.press(key);
            await expect.poll(() => focusOf(page)).toBe(DEFAULT);
            await expect(toast(page)).toBeVisible();
        }
        await page.locator('#focus-back-btn').click();
        await expect.poll(() => focusOf(page)).toBe(OTHER);

        // At home: no step, no toast.
        await focus(page, DEFAULT);
        await page.evaluate(() => document.querySelector('.focus-toast-box')?.remove());
        const canBack = await page.evaluate(() => window.Strom.TreeRenderer.canGoBack());
        await page.keyboard.press('h');
        await page.waitForTimeout(150);
        await expect(toast(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.canGoBack())).toBe(canBack);
    });

    test('⌘1 / Ctrl+1 by the key\'s place (Digit1): a Czech keyboard\'s "+" there focuses and does not zoom', async ({ page }) => {
        await openApp(page);
        await setupTree(page, DEFAULT);
        const mac = await page.evaluate(() => window.Strom.UI.isMacPlatform());
        await focus(page, OTHER);
        await blur(page);
        await page.keyboard.press(mac ? 'Meta+1' : 'Control+1');
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);

        await focus(page, OTHER);
        const scale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
        const prevented = await page.evaluate((m) => {
            const e = new KeyboardEvent('keydown', { key: '+', code: 'Digit1', metaKey: m, ctrlKey: !m, bubbles: true, cancelable: true });
            document.body.dispatchEvent(e);
            return e.defaultPrevented;
        }, mac);
        expect(prevented).toBe(true);
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(scale);
    });

    test('not in a text field, an editable element, a dialog or a menu', async ({ page }) => {
        await openApp(page);
        await setupTree(page, DEFAULT);
        await focus(page, OTHER);

        // The toolbar search: the letter is typed.
        const search = page.locator('#toolbar-search-picker .person-picker-input');
        await search.focus();
        await page.keyboard.press('h');
        await expect(search).toHaveValue(/h/);
        await page.keyboard.press('Escape');
        await blur(page);

        // An editable element.
        await page.evaluate(() => {
            const el = document.createElement('div');
            el.id = 'probe-editable';
            el.contentEditable = 'true';
            el.textContent = 'x';
            document.body.appendChild(el);
            el.focus();
        });
        await page.keyboard.press('h');
        await expect(page.locator('#probe-editable')).toContainText('h');
        await page.evaluate(() => document.getElementById('probe-editable')?.remove());
        await blur(page);

        // A dialog.
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#settings-modal')).toHaveClass(/active/);
        await page.keyboard.press('h');
        await page.waitForTimeout(150);
        expect(await focusOf(page)).toBe(OTHER);
        await expect(toast(page)).toHaveCount(0);
        await expect(page.locator('#settings-modal')).toHaveClass(/active/);
        await page.evaluate(() => window.Strom.UI.closeSettingsDialog());

        // The person menu.
        await page.locator(`#tree-canvas .person-card[data-id="${OTHER}"]`).click();
        await expect(page.locator('.context-menu')).toBeVisible();
        await page.keyboard.press('h');
        await page.waitForTimeout(150);
        expect(await focusOf(page)).toBe(OTHER);
        await expect(toast(page)).toHaveCount(0);
    });

    test('the map, the timeline and the table: H does nothing and is not taken', async ({ page }) => {
        await openApp(page);
        await setupTree(page, DEFAULT);
        await focus(page, OTHER);
        for (const mode of ['map', 'timeline', 'table']) {
            await page.evaluate((m) => window.Strom.TreeRenderer.setViewMode(m as never), mode);
            await blur(page);
            const prevented = await page.evaluate(() => {
                const e = new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true, cancelable: true });
                document.body.dispatchEvent(e);
                return e.defaultPrevented;
            });
            expect(prevented, mode).toBe(false);
            await page.waitForTimeout(100);
            expect(await focusOf(page), mode).toBe(OTHER);
        }
    });
});

test.describe('the descendants and the fan views (§7)', () => {
    test.use({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });

    const descHome = (page: Page) => page.locator('#descendants-home-btn');
    const fanHome = (page: Page) => page.locator('#fan-home-btn');

    test('descendants: ⌂ first in the badge; the root becomes the default person, the view stays; H too; Back returns', async ({ page }) => {
        await openApp(page);
        await setupTree(page, DEFAULT);
        await focus(page, OTHER);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('descendants' as never));
        const home = descHome(page);
        await expect(home).toBeVisible();
        await expect(pillHome(page)).toBeHidden();
        await expect(home).toHaveAttribute('data-state', 'active');
        const first = await page.evaluate(() => {
            const badge = document.getElementById('descendants-badge')!;
            return ([...badge.children].find(c => (c as HTMLElement).getClientRects().length > 0) as HTMLElement).id;
        });
        expect(first).toBe('descendants-home-btn');
        await home.click();
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('descendants');
        await expect(toast(page)).toBeVisible();
        await expect(home).toHaveAttribute('data-state', 'home');
        await expect(page.locator('#descendants-badge .descendants-badge-name')).not.toHaveText('');
        await page.locator('#focus-back-btn').click();
        await expect.poll(() => focusOf(page)).toBe(OTHER);
        await expect(home).toHaveAttribute('data-state', 'active');

        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('h');
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('descendants');
    });

    test('fan: a small ⌂ pill at the top left, the original person pill beside it; ⌂ and H centre the default person', async ({ page }) => {
        await openApp(page);
        await setupTree(page, DEFAULT);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('fan' as never));
        await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
        const home = fanHome(page);
        await expect(home).toBeVisible();
        await expect(home).toHaveAttribute('data-state', 'home');
        // Another centre (a sector's tap): the original person pill appears, beside ⌂.
        await focus(page, OTHER);
        await expect(home).toHaveAttribute('data-state', 'active');
        await expect(page.locator('#fan-origin-pill')).toBeVisible();
        const geo = await page.evaluate(() => {
            const h = document.getElementById('fan-home-pill')!.getBoundingClientRect();
            const o = document.getElementById('fan-origin-pill')!.getBoundingClientRect();
            return { overlap: h.right > o.left && o.right > h.left && h.bottom > o.top && o.bottom > h.top, hTop: h.top, oTop: o.top, gap: o.left - h.right };
        });
        expect(geo.overlap).toBe(false);
        expect(Math.abs(geo.hTop - geo.oTop)).toBeLessThanOrEqual(1);
        expect(geo.gap).toBeGreaterThanOrEqual(6);
        await home.click();
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);
        await expect.poll(() => page.evaluate(() => document.querySelector('#fan-chart [data-fan-key="f"]')?.getAttribute('data-fan-person') ?? null)).toBe(DEFAULT);
        await expect(home).toHaveAttribute('data-state', 'home');

        await focus(page, OTHER);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('h');
        await expect.poll(() => focusOf(page)).toBe(DEFAULT);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('fan');
    });
});

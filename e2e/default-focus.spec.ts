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

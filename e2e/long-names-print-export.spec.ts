/**
 * Long names outside the cards (1110): printing the page (Ctrl+P) keeps the
 * focus chip off the cards, and the poster with Compact cards shortens a long
 * name with "…" as the screen does instead of squeezing it unreadable.
 * Invented names only.
 */

import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './helpers.js';

const LONG = 'Wolkenhammerstrandvoldeckenbergsheim';

/** A deceased couple and their son, all with one long word for a surname; the son in focus. */
async function setup(page: Page): Promise<void> {
    await openApp(page);
    const P = (id: string, firstName: string, lastName: string, gender: string, birthDate: string, extra = {}) => ({
        id, firstName, lastName, gender, birthDate, deathDate: String(Number(birthDate) + 70), isPlaceholder: false,
        partnerships: [] as string[], parentIds: [] as string[], childIds: [] as string[], ...extra,
    });
    const persons = {
        f: P('f', 'Bonifác Hieronymus', LONG, 'male', '1840', { partnerships: ['u'], childIds: ['s'] }),
        m: P('m', 'Adelheid', 'Ekhammarsbergstrandvoldwinterlund', 'female', '1845', { partnerships: ['u'], childIds: ['s'] }),
        s: P('s', 'Kasimír', LONG, 'male', '1870', { parentIds: ['f', 'm'] }),
    };
    const partnerships = { u: { id: 'u', person1Id: 'f', person2Id: 'm', childIds: ['s'], status: 'married' } };
    await page.evaluate(async (data) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Long');
        S.TreeRenderer.setFocus('s' as never);
        await S.TreeRenderer.renderAsync();
    }, { persons, partnerships, defaultPersonId: 's' });
    await expect(page.locator('.person-card').first()).toBeVisible();
}

test.describe('long names outside the cards (1110)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('printing the page: the focus chip is not printed, nothing fixed lies over a card', async ({ page }) => {
        await setup(page);
        await expect(page.locator('#focus-controls')).toBeVisible();
        await page.emulateMedia({ media: 'print' });
        await expect(page.locator('#focus-controls')).toBeHidden();
        // No element fixed over the view (a chip, a badge, a bar) covers a card on paper.
        const over = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('#tree-canvas .person-card')].map(c => c.getBoundingClientRect());
            return [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
                if (getComputedStyle(el).position !== 'fixed' || el.getClientRects().length === 0) return false;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') return false;
                return cards.some(c => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top);
            }).map(el => el.id || el.className);
        });
        expect(over).toEqual([]);
    });

    test('the poster with Compact cards: a long name shortened with "…", not squeezed unreadable (SVG and PNG)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const poster = page.locator('#poster-modal');
        await expect(poster).toBeVisible();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            poster.locator('.menu-option', { hasText: 'SVG' }).click(),
        ]);
        const svg = readFileSync(await download.path(), 'utf-8');
        const names = [...svg.matchAll(/<text [^>]*>((?:Bonifác|Adelheid|Kasimír)[^<]*)<\/text>/g)];
        expect(names.map(m => m[1].split(' ')[0]).sort()).toEqual(['Adelheid', 'Bonifác', 'Kasimír']);
        for (const [el, text] of names) {
            expect(text.endsWith('…')).toBe(true);
            // Drawn at its own width: shortened, not squeezed.
            expect(el).not.toContain('textLength');
        }
        // The PNG is drawn from the same picture.
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        const [png] = await Promise.all([
            page.waitForEvent('download'),
            poster.locator('.menu-option', { hasText: 'PNG' }).click(),
        ]);
        expect(readFileSync(await png.path()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });
});

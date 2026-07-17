import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers';

/**
 * Round 4 card geometry (§1) + staged long-name fitting (§2).
 * The 188px card gives a 125px text column; the acceptance names must render
 * unshrunk, and nothing may fall below 12.5px (the old ~9.5px shrink is gone).
 */

/** Wait for the render's requestAnimationFrame name-fitting pass to settle. */
async function settleFitting(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Computed font-size (px) of a card's name text. */
async function nameFontPx(page: Page, firstName: string): Promise<number> {
    const fs = await card(page, firstName).locator('.name-text')
        .evaluate((n) => getComputedStyle(n).fontSize);
    return parseFloat(fs);
}

/** True when the name is truncated with an ellipsis (any rendered line overflows). */
async function nameEllipsized(page: Page, firstName: string): Promise<boolean> {
    return card(page, firstName).locator('.name-text').evaluate((n) => {
        const over = (e: HTMLElement) => e.scrollWidth > e.clientWidth + 0.5;
        const lines = n.querySelectorAll<HTMLElement>('.name-line');
        if (lines.length) return Array.from(lines).some(over);
        return over(n as HTMLElement);
    });
}

test('normal card is 188x64 and shows the acceptance name + meta unshrunk', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Kateřina', 'Výšková', {
        gender: 'female', birthDate: '1874', birthPlace: 'Bělušice',
    });
    // Give her a death year so the meta reads "1874 – 1879 · Bělušice".
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Kateřina');
        if (p) dm.updatePerson(p.id, { deathDate: '1879' });
        window.Strom.TreeRenderer.render();
    });

    const c = card(page, 'Kateřina');
    await expect(c).toBeVisible();
    await settleFitting(page);

    // §1 geometry: the layout box is 188x64 (offsetWidth ignores the focus scale).
    const size = await c.evaluate((n) => ({ w: (n as HTMLElement).offsetWidth, h: (n as HTMLElement).offsetHeight }));
    expect(size).toEqual({ w: 188, h: 64 });

    // §2: the name fits at the full 15px, no ellipsis (poll until fitting settles).
    await expect.poll(() => nameFontPx(page, 'Kateřina')).toBe(15);
    expect(await nameEllipsized(page, 'Kateřina')).toBe(false);

    // The meta row carries the full "years · place" at the unshrunk 11px.
    const meta = c.locator('.birth-date');
    await expect(meta).toContainText('1874 – 1879 · Bělušice');
    const metaPx = await meta.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
    expect(metaPx).toBe(11);
});

test('a long name stays readable without ellipsis and never drops below 12.5px', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Marianna', 'Frydrychová', { gender: 'female', birthDate: '1901' });

    const c = card(page, 'Marianna');
    await expect(c).toBeVisible();
    await settleFitting(page);

    // Readable: no ellipsis truncation (fits by shrink or by wrapping to two
    // lines). Poll until the render's rAF fitting pass has settled.
    await expect.poll(() => nameEllipsized(page, 'Marianna')).toBe(false);
    // The full name is always preserved for hover/title.
    await expect(c.locator('.name-text')).toHaveAttribute('title', 'Marianna Frydrychová');
    // Floor: never smaller than the two-line 12.5px.
    expect(await nameFontPx(page, 'Marianna')).toBeGreaterThanOrEqual(12.5);
});

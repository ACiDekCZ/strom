import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card, cardBoxesMatchLayout } from './helpers';

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
    await createFirstPerson(page, 'Kateřina', 'Fýšková', {
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

    // §2: the acceptance name fits the top step, no ellipsis (poll until fitting
    // settles). The reference platform holds 15px with ~0.8px to spare; a
    // platform whose serif renders a hair wider shrinks one step to 14px to
    // avoid clipping (the fitting measures fractional width, see fitCardNames).
    // The portable invariant is "top-or-one-step and never clipped", not an
    // exact pixel — assert that, so CI font metrics don't make it flaky.
    await expect.poll(() => nameFontPx(page, 'Kateřina')).toBeGreaterThanOrEqual(14);
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

/** Count of two-line split spans inside a card's name. */
async function nameLineCount(page: Page, firstName: string): Promise<number> {
    return card(page, firstName).locator('.name-text .name-line').count();
}

test('the Detailed card widens for Kateřina Fýšková and a long birth place, never clipping either (U03a)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Kateřina', 'Fýšková', { gender: 'female', birthDate: '1874', birthPlace: 'Landsberg an der Warthe' });
    await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));

    const c = card(page, 'Kateřina');
    await expect(c).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    // A card of details: 200 up to the medium cap, the name whole at its size.
    const size = await c.evaluate((n) => (n as HTMLElement).offsetWidth);
    expect(size).toBeGreaterThanOrEqual(200);
    expect(size).toBeLessThanOrEqual(320);
    expect(await nameEllipsized(page, 'Kateřina')).toBe(false);
    // The place on the birth line reads in full (the whole detail, wrapped if it must).
    await expect(c.locator('.card-line--birth .card-line-place')).toHaveText('Landsberg an der Warthe');
    await expect(c.locator('.card-line--birth .card-line-place [title]')).toHaveCount(0);
});

test('compact shrinks a long name to the 12.5px floor as one line before ellipsis', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Maximiliana', 'Kolodziejczyk', { birthDate: '1900' });
    await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));

    const c = card(page, 'Maximiliana');
    await expect(c).toBeVisible();
    await settleFitting(page);

    // The compact density selector no longer blocks the shrink: the name reaches
    // the 12.5px floor. Compact has no two-line step — it ellipsizes one line.
    await expect.poll(() => nameFontPx(page, 'Maximiliana')).toBe(12.5);
    expect(await nameLineCount(page, 'Maximiliana')).toBe(0);
    expect(await nameEllipsized(page, 'Maximiliana')).toBe(true);
});

test('a sub-pixel overflow shrinks the name instead of clipping it (Adéla Pospíšilová)', async ({ page }) => {
    // "Adéla Pospíšilová" measures about 126.6px at 15px in the card serif —
    // half a pixel over the normal card's 126px column (it was "Maria
    // Laroulková" on the old detailed card's 128px column). The browser ellipsizes on
    // ANY layout overflow, but the integer scrollWidth rounds it away (and
    // never reports below the box width), so the old fitting pass left the
    // name at 15px, cut. The fix measures fractional Range rects.
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Fýšek', { birthDate: '1871' });
    await addRelation(page, 'Jan', 'partner', 'Adéla', 'Pospíšilová', 'female');
    await page.evaluate(() => window.Strom.UI.setCardDensity('normal'));

    const c = card(page, 'Adéla');
    await expect(c).toBeVisible();
    await settleFitting(page);

    // The invariant that actually matters: no single-line name may carry a
    // fractional overflow — that is exactly the state the ellipsis clips.
    await expect.poll(() => c.locator('.name-text').evaluate((n) => {
        const range = document.createRange();
        range.selectNodeContents(n);
        let contentW = 0;
        for (const r of range.getClientRects()) contentW = Math.max(contentW, r.width);
        return contentW <= n.getBoundingClientRect().width + 0.05;
    })).toBe(true);
    // And she got there by shrinking, not by losing letters.
    expect(await nameFontPx(page, 'Adéla')).toBeLessThan(15);
    await expect(c.locator('.name-text')).toHaveAttribute('title', 'Adéla Pospíšilová');
});

test('B-2: a birth given as a range of years shows the range on the card, not its first year', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    // Born between 1872 and 1875: more than 120 years ago, so presumed dead (the dagger), the range whole.
    await createFirstPerson(page, 'Anna', 'Svobodová', { gender: 'female', birthDate: '1872..1875' });
    await expect(card(page, 'Anna').locator('.birth-date')).toHaveAttribute('data-years', '1872–1875 †');
    // A death year after it: the life span keeps its spaced dash, the range its own.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.updatePerson(dm.getAllPersons()[0].id, { deathDate: '1940' });
        window.Strom.TreeRenderer.render();
    });
    await expect(card(page, 'Anna').locator('.birth-date')).toHaveAttribute('data-years', '1872–1875 – 1940');
});

test('Q2: two ranges of years beside the status mark go short instead of losing the death year to the ellipsis', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    // A source in the tree gives every card the status mark, which narrows the meta row (an imported file does the same).
    await page.evaluate(async () => {
        const base = { isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], sourceIds: ['s1'] };
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                a: { ...base, id: 'a', firstName: 'Otakar', lastName: 'Zvonkovec', gender: 'male',
                    birthDate: '1650..1655', deathDate: '1720..1725', birthPlace: 'Dolní Bukovina', childIds: ['b'] },
                b: { ...base, id: 'b', firstName: 'Bertold', lastName: 'Zvonkovec', gender: 'male',
                    birthDate: '1698..1702', deathDate: '1760', birthPlace: 'Hořice', parentIds: ['a'] },
            },
            partnerships: {}, sources: { s1: { id: 's1', title: 'Matrika' } },
        } as never, 'Rozsahy');
    });
    const a = card(page, 'Otakar');
    await expect(a.locator(':scope > .card-status-mark')).toBeVisible();
    const meta = a.locator('.birth-date');
    await expect(meta).toHaveAttribute('data-years', '1650–1655 – 1720–1725');
    // The place shortens with "…" after them or, with no room for that, leaves the row (the tooltip keeps it).
    await expect(meta.locator('.meta-text')).toHaveText(/^1650–55 – 1720–25( · |$)/);
    await expect(meta).toHaveAttribute('data-full', '1650–1655 – 1720–1725 · Dolní Bukovina');
    // The years show whole: inside the row, and the ellipsis cuts none of them
    // (Chromium reports the visible part of a cut text as a second, narrower rect).
    const yearsWhole = await meta.evaluate((m) => {
        const text = m.querySelector('.meta-text')!.firstChild as Text;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, '1650–55 – 1720–25'.length);
        const widths = [...range.getClientRects()].map(r => r.width);
        return Math.max(...widths) <= m.getBoundingClientRect().width + 0.5
            && Math.min(...widths) >= Math.max(...widths) - 0.5;
    });
    expect(yearsWhole).toBe(true);
    // Years that fit keep their whole form (a range across centuries is never shortened).
    const b = card(page, 'Bertold').locator('.birth-date');
    await expect(b.locator('.meta-text')).toHaveText(/^1698–1702 – 1760/);
    await expect(b).not.toHaveAttribute('data-years-short', /./);
});

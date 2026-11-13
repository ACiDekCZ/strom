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

/**
 * Every name row of every card: shown whole, or (only where the grown status
 * mark takes the room) ending in "…" — never cut off hard. `whole` lists the
 * rows that must show whole at this zoom.
 */
async function nameRows(page: Page): Promise<{ cut: string[]; hardCut: string[] }> {
    return page.evaluate(() => {
        const cut: string[] = [];
        const hardCut: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('#tree-canvas .person-card .name-text, #tree-canvas .person-card .name-line, #tree-canvas .person-card .name-row')) {
            const range = document.createRange();
            range.selectNodeContents(el);
            let w = 0;
            for (const r of range.getClientRects()) w = Math.max(w, r.width);
            const box = el.getBoundingClientRect().width;
            // Screen pixels: a quarter of a layout pixel at the scale it is drawn.
            const scale = box / Math.max(1, el.offsetWidth);
            if (w <= box + 0.25 * scale) continue;
            const label = `${el.textContent} ${w.toFixed(1)}>${box.toFixed(1)}`;
            cut.push(label);
            if (getComputedStyle(el).textOverflow !== 'ellipsis') hardCut.push(label);
        }
        return { cut, hardCut };
    });
}

test('§5: changing the zoom leaves the names whole where the status mark does not reach them, and a cut one ends in "…"', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    // A source in the tree gives every card the status mark (bottom right), which grows far out.
    await page.evaluate(async () => {
        const kids = ['a', 'b', 'c', 'd', 'e'];
        const P = (id: string, firstName: string, lastName: string, gender: string, birthDate: string, extra: Record<string, unknown>) =>
            ({ id, firstName, lastName, gender, birthDate, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], sourceIds: ['s1'], ...extra });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                f: P('f', 'Hostivít', 'Zvonkovec', 'male', '1900', { partnerships: ['u1'], childIds: kids }),
                m: P('m', 'Otylie', 'Zvonkovcová', 'female', '1902', { partnerships: ['u1'], childIds: kids }),
                a: P('a', 'Eufrozína', 'Křemenáčová', 'female', '1925', { parentIds: ['f', 'm'] }),
                b: P('b', 'Radegunda', 'Pomněnková-Zvonkovcová', 'female', '1927', { parentIds: ['f', 'm'] }),
                c: P('c', 'Kunhuta', 'Slunéčková', 'female', '1929', { parentIds: ['f', 'm'] }),
                d: P('d', 'Ermelinda', 'Bukvicová', 'female', '1931', { parentIds: ['f', 'm'] }),
                e: P('e', 'Ota', 'Křemenáč', 'male', '1933', { parentIds: ['f', 'm'] }),
            },
            partnerships: { u1: { id: 'u1', person1Id: 'f', person2Id: 'm', childIds: kids, status: 'married' } },
            sources: { s1: { id: 's1', title: 'Matrika' } },
        } as never, 'Zvonkovec');
        await window.Strom.TreeRenderer.setFocus('b' as never);
    });
    await expect(card(page, 'Kunhuta').locator(':scope > .card-status-mark')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await settleFitting(page);
    const canvas = page.locator('#tree-canvas');
    const scale = () => page.evaluate(() => window.Strom.ZoomPan.getTransform().scale);
    // The zoom's animation has ended: two frames apart, the same scale.
    const settled = async () => {
        let last = -1;
        await expect.poll(async () => {
            const now = await scale();
            const same = now === last;
            last = now;
            return same;
        }, { intervals: [50] }).toBe(true);
    };
    const whole = async () => expect.poll(async () => (await nameRows(page)).cut).toEqual([]);
    await whole();
    const fitted = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card .name')]
        .map(n => `${n.querySelector('.name-text')?.getAttribute('title') ?? n.textContent} ${n.className}`).sort());
    const fittedAt100 = await fitted();

    // Out by the buttons into the far band (the mark grows, still drawn): the names above it stay whole.
    const zoomOut = page.locator('.zoom-controls button').nth(1);
    while (!(await canvas.evaluate(c => c.classList.contains('zoom-far')))) {
        const before = await scale();
        await zoomOut.click();
        await expect.poll(scale).toBeLessThan(before);
        await settled();
    }
    // Into the band where the grown mark stays below the one-line names (from 45 % to 55 %).
    await page.locator('#tree-container').hover();
    while (await scale() < 0.45) {
        await page.mouse.wheel(0, -20);
        await settled();
    }
    expect(await scale()).toBeLessThan(0.55);
    await expect(canvas).toHaveClass(/\bzoom-far\b/);
    await expect(canvas).not.toHaveClass(/\bzoom-tiny\b/);
    // The status mark has grown from the card's bottom-right corner.
    expect(await card(page, 'Kunhuta').locator(':scope > .card-status-mark').evaluate(m => getComputedStyle(m).transform)).not.toBe('none');
    const far = await nameRows(page);
    expect(far.hardCut).toEqual([]);
    // A one-line name ends above the grown mark: nothing takes its room.
    const oneLine = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card .name:not(.name-fit-2lines) .name-text')]
        .map(el => el.textContent ?? ''));
    expect(oneLine.length).toBeGreaterThan(0);
    for (const name of oneLine) expect(far.cut.some(c => c.startsWith(name))).toBe(false);
    // Drawn again far out (any change of the tree does that): the names are fitted as at 100 %, not against the mark's room.
    await page.evaluate(() => window.Strom.TreeRenderer.render());
    await expect.poll(fitted).toEqual(fittedAt100);
    expect((await nameRows(page)).hardCut).toEqual([]);

    // Further out by the wheel, below 30 % the mark goes: every row has its whole width again.
    for (let i = 0; i < 20 && !(await canvas.evaluate(c => c.classList.contains('zoom-tiny'))); i++) {
        await page.mouse.wheel(0, 100);
        await settled();
    }
    await expect(canvas).toHaveClass(/\bzoom-tiny\b/);
    await whole();

    // Deeper into the far band by the wheel (about 35 %): a row the mark reaches ends in "…", none is cut off hard.
    while (await scale() < 0.34) {
        await page.mouse.wheel(0, -40);
        await settled();
    }
    await expect(canvas).not.toHaveClass(/\bzoom-tiny\b/);
    expect((await nameRows(page)).hardCut).toEqual([]);

    // Back to 100 % by the buttons: all whole, as before.
    const zoomIn = page.locator('.zoom-controls button').first();
    while (await scale() < 0.99) {
        const before = await scale();
        await zoomIn.click();
        await expect.poll(scale).toBeGreaterThan(before);
        await settled();
    }
    await expect(canvas).not.toHaveClass(/\bzoom-far\b/);
    await whole();
});

import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, seedSetting, seedTree, card, cardBoxesMatchLayout } from './helpers.js';

/**
 * A long name on the Normal and the Detailed card is shown whole, on as many
 * rows as it needs, and the card grows (T40): no "…", no text running out of
 * its row or its card, no two cards overlapping; the Compact card keeps its
 * one shortened row. Phone and desktop widths, Czech, German and Polish.
 * Invented names.
 */

const LONG_GIVEN = 'Rosamunda Theodolinda Adalgisa';
const LONG_WORD = 'Wolfeschlegelsteinhausenbergerdorffvonkrummhorn';

/** Rosamunda (a long name, one long word for a surname) + Florimund → Hyacinta and Zdenimíra; Kasimir and Kordula her parents. */
async function setup(page: Page, lang: string, width: number): Promise<void> {
    await page.clock.setFixedTime(new Date(2026, 5, 15, 14, 30));
    await page.setViewportSize({ width, height: 900 });
    await seedSetting(page, 'language', lang);
    await seedSetting(page, 'cardDensity', 'normal');
    await openApp(page);
    await seedTree(page, {
        r: { firstName: LONG_GIVEN, lastName: LONG_WORD, gender: 'female', birthDate: '1901', deathDate: '1975', birthPlace: 'Horní Krummhorn',
            parents: ['k', 'o'], partners: ['f'] },
        f: { firstName: 'Florimund Kasimir Eulalio', lastName: 'Oberhollenzer-Grünwaldinger', gender: 'male', birthDate: '1898', partners: ['r'] },
        k: { firstName: 'Kasimir', lastName: 'Krummhorn', gender: 'male', birthDate: '1870', partners: ['o'] },
        o: { firstName: 'Kordula', lastName: 'Krummhorn', gender: 'female', birthDate: '1874', partners: ['k'] },
        h: { firstName: 'Hyacinta', lastName: 'Oberhollenzer', gender: 'female', birthDate: '1925', parents: ['r', 'f'] },
        z: { firstName: 'Zdenimíra Eulalie', lastName: 'Kolodziejczyk-Wiśniewska', gender: 'female', birthDate: '1928', parents: ['r', 'f'] },
    }, 'Krummhorn', 'r');
    await page.evaluate(() => document.fonts.ready);
}

/** Switch the card type and wait until the cards stand at the size the layout gave them and their names are fitted. */
async function density(page: Page, kind: 'normal' | 'detailed' | 'compact'): Promise<void> {
    await page.evaluate((k) => window.Strom.UI.setCardDensity(k), kind);
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

interface Problems {
    ellipsis: string[];
    overflowX: string[];
    overflowY: string[];
    overlaps: string[];
}

/** What a reader would see as cut: "…" in a name, a name text wider than its row, text below the card's bottom, cards over each other. */
async function problems(page: Page): Promise<Problems> {
    return page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')];
        const out = { ellipsis: [] as string[], overflowX: [] as string[], overflowY: [] as string[], overlaps: [] as string[] };
        for (const c of cards) {
            const title = c.querySelector<HTMLElement>('.name-text')?.title ?? c.dataset.id ?? '';
            const name = c.querySelector<HTMLElement>('.name');
            if (name?.textContent?.includes('…')) out.ellipsis.push(title);
            for (const el of c.querySelectorAll<HTMLElement>('.name-text, .name-line, .name-row')) {
                if (el.scrollWidth > el.clientWidth) out.overflowX.push(`${title}: ${el.className} ${el.scrollWidth}>${el.clientWidth}`);
                // The text's own width (fractional), not only the rounded scrollWidth.
                const range = document.createRange();
                range.selectNodeContents(el);
                let w = 0;
                for (const r of range.getClientRects()) w = Math.max(w, r.width);
                const box = el.getBoundingClientRect().width;
                if (w > box + 0.5) out.overflowX.push(`${title}: ${el.className} text ${w.toFixed(2)}>${box.toFixed(2)}`);
            }
            // The content ends inside the card (unscaled layout pixels).
            const inner = c.clientHeight + c.clientTop;
            for (const el of c.querySelectorAll<HTMLElement>(':scope > .card-body, :scope > .card-body > *, .card-head, .card-lines')) {
                let top = 0;
                for (let e: HTMLElement | null = el; e && e !== c; e = e.offsetParent as HTMLElement | null) top += e.offsetTop;
                if (top + el.offsetHeight > inner + 0.5) out.overflowY.push(`${title}: ${el.className} ${top + el.offsetHeight}>${inner}`);
            }
        }
        const rects = cards.map(c => ({ id: c.querySelector<HTMLElement>('.name-text')?.title ?? '', x: c.offsetLeft, y: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight }));
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.overlaps.push(`${a.id} × ${b.id}`);
            }
        }
        return out;
    });
}

const NONE: Problems = { ellipsis: [], overflowX: [], overflowY: [], overlaps: [] };

/** The name rows of a card, as read. */
async function nameRows(page: Page, first: string): Promise<string[]> {
    return card(page, first).locator('.name-row').allTextContents();
}

for (const lang of ['cs', 'de', 'pl']) {
    for (const width of [390, 1440]) {
        test(`a long name shows whole on the Normal and the Detailed card, Compact shortens it (${lang}, ${width}px)`, async ({ page }) => {
            await setup(page, lang, width);

            // Normal: the long names on rows of their own, the card taller than 64px.
            await density(page, 'normal');
            await expect.poll(() => problems(page)).toEqual(NONE);
            const r = card(page, 'Rosamunda');
            await expect(r.locator('.name')).toHaveClass(/name-fit-wrap/);
            const rows = await r.locator('.name-line').evaluateAll(lines => lines.map(l => l.querySelectorAll('.name-row').length || 1));
            expect(rows.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3);
            // The long word reads whole across its rows; the given names keep their spaces.
            expect((await r.locator('.name-surname .name-row').allTextContents()).join('')).toBe(LONG_WORD);
            await expect(r.locator('.name-given')).toHaveText(LONG_GIVEN);
            expect(await r.evaluate(c => (c as HTMLElement).offsetHeight)).toBeGreaterThan(64);
            // A name of two rows at most stays as it was: no rows of its own, 64px.
            const k = card(page, 'Kordula');
            await expect(k.locator('.name-row')).toHaveCount(0);
            expect(await k.evaluate(c => (c as HTMLElement).offsetHeight)).toBe(64);

            // Detailed: the name's rows as many as it needs, never "…".
            await density(page, 'detailed');
            await expect.poll(() => problems(page)).toEqual(NONE);
            const detailed = await nameRows(page, 'Rosamunda');
            expect(detailed.length).toBeGreaterThanOrEqual(3);
            expect(detailed.join(' ')).not.toContain('…');
            expect(detailed.join('').replace(/\s/g, '')).toBe(`${LONG_GIVEN}${LONG_WORD}`.replace(/\s/g, ''));

            // Compact: one row, shortened, the full name in its title.
            await density(page, 'compact');
            const compact = card(page, 'Rosamunda').locator('.name-text');
            await expect(compact).toHaveAttribute('title', new RegExp(LONG_WORD));
            await expect(card(page, 'Rosamunda').locator('.name-line, .name-row')).toHaveCount(0);
            expect(await compact.evaluate(n => n.scrollWidth > n.clientWidth)).toBe(true);
            expect(await card(page, 'Rosamunda').evaluate(c => (c as HTMLElement).offsetHeight)).toBe(44);
        });
    }
}

test('printed, the Normal card keeps its name rows whole inside the 2px print border', async ({ page }) => {
    await setup(page, 'de', 1440);
    await density(page, 'normal');
    await page.emulateMedia({ media: 'print' });
    await expect.poll(() => problems(page)).toEqual(NONE);
    await page.emulateMedia({ media: 'screen' });
});

/** The poster's SVG of the view as drawn now (Export → Poster → SVG). */
async function posterSvg(page: Page): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.locator('.menu-option', { hasText: 'SVG' }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    await page.keyboard.press('Escape');
    await expect(poster).toBeHidden();
    return svg;
}

test('the image export draws the long name whole on its rows, each card as tall as on screen (Normal, Detailed)', async ({ page }) => {
    await setup(page, 'de', 1440);
    for (const kind of ['normal', 'detailed'] as const) {
        await density(page, kind);
        const svg = await posterSvg(page);
        const rows = [...svg.matchAll(/<text class="card-name-row"[^>]*>([^<]*)</g)].map(m => m[1]);
        expect(rows.join(' '), kind).not.toContain('…');
        // Rosamunda's name: every letter, across its rows.
        expect(rows.join('').replace(/\s/g, ''), kind).toContain(`${LONG_GIVEN}${LONG_WORD}`.replace(/\s/g, ''));
        // The cards as tall as the screen's, none over another.
        const rects = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="([\d.]+)" rx="8"/g)]
            .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
        const screen = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')]
            .map(c => c.offsetHeight).sort((a, b) => a - b));
        expect(rects.map(r => r.h).sort((a, b) => a - b), kind).toEqual(screen);
        expect(Math.max(...rects.map(r => r.h)), kind).toBeGreaterThan(kind === 'normal' ? 64 : 0);
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${kind}: cards ${i} × ${j}`).toBe(false);
            }
        }
    }
});

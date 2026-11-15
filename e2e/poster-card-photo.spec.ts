import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp } from './helpers.js';
import { syntheticTree } from '../src/__tests__/helpers/synthetic-tree';

/**
 * The photo on the card in the outputs (spec 096 P2): the image export, the
 * poster and its tiled PDF draw the cards with the chosen photo size and
 * shape, as the screen does, on a dense invented tree: every card at the
 * screen's box, no two cards overlapping, no line through a card, each photo
 * inside its card. The default (small + circle) keeps the 188 × 64 card.
 */

/** A photo (a 1 × 1 PNG data URI), so no file is needed. */
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

type Size = 'small' | 'medium' | 'large';
type Shape = 'circle' | 'rounded';

/** An invented tree of 1500 people, a third with a photo; the founder with the most descendants in focus, 2 up and 4 down. */
async function denseTree(page: Page): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-11-15T10:00:00Z'));
    await openApp(page);
    const { data } = syntheticTree({ persons: 1500, seed: 7 });
    let i = 0;
    for (const p of Object.values(data.persons)) if (!p.isPlaceholder && i++ % 3 === 0) p.photo = PHOTO;
    const children = new Map<string, string[]>();
    for (const u of Object.values(data.partnerships)) {
        for (const pid of [u.person1Id, u.person2Id]) children.set(pid, [...(children.get(pid) ?? []), ...u.childIds]);
    }
    const descendants = (id: string): number => {
        const seen = new Set<string>();
        const stack = [...(children.get(id) ?? [])];
        while (stack.length) {
            const c = stack.pop()!;
            if (seen.has(c)) continue;
            seen.add(c);
            stack.push(...(children.get(c) ?? []));
        }
        return seen.size;
    };
    const founders = Object.values(data.persons).filter(p => p.parentIds.length === 0 && !p.isPlaceholder);
    const rootId = founders.map(p => ({ id: p.id, n: descendants(p.id) })).sort((a, b) => b.n - a.n)[0].id;
    await page.evaluate(async ({ data, rootId }) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Lindenau');
        S.TreeRenderer.setFocus(rootId);
        S.TreeRenderer.setFocusDepth(2, 4);
        await S.TreeRenderer.renderAsync();
    }, { data, rootId });
    await page.evaluate(() => document.fonts.ready);
}

async function choose(page: Page, density: string, size: Size, shape: Shape, spacing: 'normal' | 'dense' = 'normal'): Promise<void> {
    await page.evaluate(async ({ density, size, shape, spacing }) => {
        const S = window.Strom;
        S.SettingsManager.setCardPhoto({ size, shape });
        S.SettingsManager.setPosterSpacing(spacing);
        S.UI.setCardDensity(density as never);
        await S.TreeRenderer.renderAsync();
    }, { density, size, shape, spacing });
    await expect(page.locator('body')).toHaveAttribute('data-card-photo', size);
}

async function downloadSvg(page: Page): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#poster-modal .menu-option', { hasText: 'SVG' }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    await page.evaluate(() => window.Strom.UI.closePosterDialog?.());
    await page.keyboard.press('Escape');
    return svg;
}

interface Box { x: number; y: number; w: number; h: number }

const cardRects = (svg: string): Box[] => [...svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)" rx="8"/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
const images = (svg: string): Box[] => [...svg.matchAll(/<image href="[^"]*" x="(-?[\d.]+)" y="(-?[\d.]+)" width="(\d+)" height="(\d+)"/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
const lines = (svg: string) => [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"/g)]
    .map(m => m.slice(1, 5).map(Number) as [number, number, number, number]);

/** The pairs of cards that overlap, the lines that run through a card, the photos outside every card. */
function audit(svg: string): { overlaps: number; through: number; outside: number } {
    const rects = cardRects(svg);
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) overlaps++;
    }
    // A line through a card's inside (1px in from its border); touching its edge is how lines meet cards.
    let through = 0;
    for (const [x1, y1, x2, y2] of lines(svg)) {
        const [minX, maxX, minY, maxY] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
        if (rects.some(r => minX < r.x + r.w - 1 && maxX > r.x + 1 && minY < r.y + r.h - 1 && maxY > r.y + 1)) through++;
    }
    const outside = images(svg).filter(i => !rects.some(r => i.x >= r.x && i.x + i.w <= r.x + r.w && i.y >= r.y && i.y + i.h <= r.y + r.h)).length;
    return { overlaps, through, outside };
}

test.describe('the photo on the card in the image export, the poster and the PDF (spec 096 P2)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the default small + circle: the 188 × 64 card and the 34px photo, as before', async ({ page }) => {
        await denseTree(page);
        await choose(page, 'normal', 'small', 'circle');
        const svg = await downloadSvg(page);
        const rects = cardRects(svg);
        expect(rects.length).toBeGreaterThan(60);
        expect(new Set(rects.map(r => r.w))).toEqual(new Set([188]));
        expect(new Set(images(svg).map(i => i.w))).toEqual(new Set([34]));
        expect(audit(svg)).toEqual({ overlaps: 0, through: 0, outside: 0 });
    });

    const cases: Array<[string, Size, Shape, 'normal' | 'dense']> = [
        ['normal', 'medium', 'circle', 'normal'],
        ['normal', 'large', 'rounded', 'normal'],
        ['normal', 'large', 'circle', 'dense'],
        ['detailed', 'large', 'circle', 'normal'],
        ['register', 'medium', 'rounded', 'dense'],
    ];
    for (const [density, size, shape, spacing] of cases) {
        test(`${density}, ${size} ${shape} photo, ${spacing} spacing: the screen's card box, no overlap, no line through a card`, async ({ page }) => {
            await denseTree(page);
            await choose(page, density, size, shape, spacing);
            const svg = await downloadSvg(page);
            const rects = cardRects(svg);
            expect(rects.length).toBeGreaterThan(60);
            // The cards as wide as the screen's, the photo of the chosen size and shape.
            const screen = await page.evaluate(() => window.Strom.TreeRenderer.getCardBox().cardWidth);
            expect(new Set(rects.map(r => r.w))).toEqual(new Set([screen]));
            const avatar = density === 'normal' ? { medium: 48, large: 80 }[size as 'medium' | 'large'] : { medium: 44, large: 72 }[size as 'medium' | 'large'];
            const photos = images(svg);
            expect(photos.length).toBeGreaterThan(10);
            expect(new Set(photos.map(i => i.w))).toEqual(new Set([avatar]));
            if (shape === 'rounded') {
                const r = { 44: 6, 48: 7, 72: 10, 80: 12 }[avatar];
                expect(svg).toContain(`width="${avatar}" height="${avatar}" rx="${r}" fill="none"`);
            } else {
                expect(svg).toContain(`r="${avatar / 2}" fill="none"`);
            }
            // A Normal card with a large photo is 96px or taller; the others 64 (T40: taller for a long name).
            if (density === 'normal' && size === 'large') {
                expect(Math.max(...rects.map(r => r.h))).toBeGreaterThanOrEqual(96);
                expect(Math.min(...rects.map(r => r.h))).toBe(64);
            }
            expect(audit(svg)).toEqual({ overlaps: 0, through: 0, outside: 0 });
        });
    }

    test('the tiled PDF prints the same image as the export, with the large rounded photo', async ({ page }) => {
        await denseTree(page);
        await choose(page, 'normal', 'large', 'rounded');
        const svg = await downloadSvg(page);
        await page.evaluate(() => {
            (window as unknown as { print: () => void }).print = () => {
                (window as unknown as { __printed?: boolean }).__printed = true;
            };
        });
        await page.evaluate(() => window.Strom.UI.showPosterDialog());
        await page.evaluate(() => window.Strom.UI.printPosterPdf());
        await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed ?? false)).toBe(true);
        const printed = await page.evaluate(() => {
            const src = (document.querySelector('#poster-print .poster-page:not(.poster-guide) img') as HTMLImageElement).src;
            return decodeURIComponent(src.slice(src.indexOf(',') + 1));
        });
        expect(printed).toBe(svg);
        expect(printed).toContain('width="80" height="80" rx="12" fill="none"');
    });
});

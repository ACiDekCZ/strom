import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp, card, seedSetting } from './helpers.js';

/**
 * Drawing details of the dense spacing (spec 069, D1): the marriage-order
 * pill only on the card's edge, shortened to "∞ 2" with the whole order in
 * its bubble (a mouse, the keyboard, a tap); by touch every pill on a card's
 * edge answers 44 × 44 px around its middle, so in the 48 px gap between two
 * rows the areas of the upper and the lower card do not meet; the research
 * stub keeps its 20 px line, with its touch area 24 px out of the card and
 * 20 px into it, and never reaches a bus above the card. The normal spacing
 * draws all of it as before. Invented data.
 */

const EDGE = { missing: 'parents', scope: 'in', books: [], covered: [], noRecords: [], tasks: [], tried: [], conflicts: [], hypos: [] };

/** Josef and his three marriages (data order 1908, undated, 1866), his parents and Anna's research edge. */
async function setup(page: Page, opts: { dense: boolean; width?: number } = { dense: true }): Promise<void> {
    if (opts.dense) await seedSetting(page, 'treeSpacing', 'dense');
    await page.setViewportSize({ width: opts.width ?? 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async (edge) => {
        const p = (id: string, extra: Record<string, unknown>) => ({
            id, gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
        });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                j: p('j', { firstName: 'Josef', lastName: 'Fíšek', gender: 'male', birthDate: '1841',
                    partnerships: ['u2', 'u3', 'u1'], childIds: ['k', 'h', 'r'] }),
                a: p('a', { firstName: 'Anna', lastName: 'Králová', birthDate: '1845', partnerships: ['u1'], childIds: ['k'],
                    research: { edge: { ...edge, end: 'unsearched', next: 'queued' } } }),
                m: p('m', { firstName: 'Marie', lastName: 'Nováková', birthDate: '1870', partnerships: ['u2'], childIds: ['h'] }),
                e: p('e', { firstName: 'Eva', lastName: 'Malá', birthDate: '1850', partnerships: ['u3'], childIds: ['r'] }),
                k: p('k', { firstName: 'Karel', lastName: 'Fíšek', gender: 'male', birthDate: '1867',
                    partnerships: ['u4'], parentIds: ['j', 'a'] }),
                l: p('l', { firstName: 'Ludmila', lastName: 'Fíšková', birthDate: '1870', partnerships: ['u4'] }),
                h: p('h', { firstName: 'Hana', lastName: 'Fíšková', birthDate: '1909', parentIds: ['j', 'm'] }),
                r: p('r', { firstName: 'Rudolf', lastName: 'Fíšek', gender: 'male', parentIds: ['j', 'e'] }),
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'j', person2Id: 'a', status: 'married', childIds: ['k'], startDate: '1866-02-14', startPlace: 'Dolní Lhota' },
                u2: { id: 'u2', person1Id: 'j', person2Id: 'm', status: 'married', childIds: ['h'], startDate: '1908', startPlace: 'Praha' },
                u3: { id: 'u3', person1Id: 'j', person2Id: 'e', status: 'married', childIds: ['r'] },
                u4: { id: 'u4', person1Id: 'k', person2Id: 'l', status: 'married', childIds: [], startDate: '1890' },
            },
        } as never, 'Fíškovi');
        window.Strom.TreeRenderer.setFocus('j' as never);
    }, EDGE);
    await expect(card(page, 'Marie')).toBeVisible();
    await expect(card(page, 'Eva')).toBeVisible();
}

async function zoomTo(page: Page, scale: number, around = 'j'): Promise<void> {
    await page.evaluate(([s, id]) => window.Strom.ZoomPan.glideToPerson(id as never, s as number, 0), [scale, around] as const);
    await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(scale, 2);
}

const pill = (page: Page, name: string) => card(page, name).locator('.union-order-pill');

/** The pill's visible text (the bubble left out). */
const pillText = (page: Page, name: string) => pill(page, name).evaluate(el =>
    [...el.querySelectorAll('.uo-num, .uo-glyph, .uo-year')]
        .filter(s => !s.closest('.uo-tip') && getComputedStyle(s).display !== 'none')
        .map(s => s.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim());

/** The element the page hits at a point (viewport px), as the pill or card it belongs to. */
const hitAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    const edgeItem = el?.closest('.card-edge > *, .research-edge');
    if (edgeItem) return `${edgeItem.closest('.person-card')?.getAttribute('data-id')}:${edgeItem.classList[0]}`;
    const c = el?.closest('.person-card');
    if (c && el?.closest('.card-avatar-wrap')) return `${c.getAttribute('data-id')}:avatar`;
    return c ? `${c.getAttribute('data-id')}:card` : `none:${el?.tagName}.${el?.getAttribute('class')}`;
}, [x, y] as const);

/** The vertical middle of a pill (viewport px) and its horizontal middle. */
async function middleOf(l: Locator): Promise<{ x: number; y: number }> {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe('dense spacing: the marriage-order pill "∞ N" on the card edge (D1)', () => {
    test('each wife\'s pill is short, on the edge, in the corner toward her husband', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1);
        expect(await pillText(page, 'Anna')).toBe('∞ 1');
        expect(await pillText(page, 'Marie')).toBe('∞ 2');
        expect(await pillText(page, 'Eva')).toBe('∞ 3');
        await expect(page.locator('.union-order-pill')).toHaveCount(3);
        await expect(page.locator('.union-order-pill[data-label="short"]')).toHaveCount(3);
        await expect(page.locator('.edge-top-above')).toHaveCount(0);
        for (const [name, side] of [['Anna', 'right'], ['Marie', 'right'], ['Eva', 'left']] as const) {
            await expect(pill(page, name)).toHaveAttribute('tabindex', '0');
            const c = (await card(page, name).boundingBox())!;
            const b = (await pill(page, name).boundingBox())!;
            // half over the card's top border, in the half toward Josef
            expect(Math.abs(b.y + b.height / 2 - c.y)).toBeLessThanOrEqual(1.5);
            if (side === 'right') expect(b.x).toBeGreaterThan(c.x + c.width / 2);
            else expect(b.x + b.width).toBeLessThan(c.x + c.width / 2);
        }
    });

    test('the normal spacing keeps "1st ∞ 1866", without a focus stop of its own', async ({ page }) => {
        await setup(page, { dense: false });
        await zoomTo(page, 1);
        expect(await pillText(page, 'Anna')).toBe('1st ∞ 1866');
        expect(await pillText(page, 'Marie')).toBe('2nd ∞ 1908');
        await expect(page.locator('.union-order-pill[data-label="short"]')).toHaveCount(0);
        await expect(pill(page, 'Anna')).not.toHaveAttribute('tabindex', /.*/);
    });

    test('a mouse and the keyboard show the bubble with the whole order; hidden below 60 % zoom', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1);
        const tip = pill(page, 'Anna').locator('.uo-tip');
        await expect(tip).toBeHidden();
        await pill(page, 'Anna').hover();
        await expect(tip).toBeVisible();
        await expect(tip).toHaveText("Josef Fíšek's 1st marriage, 1866, Dolní Lhota");
        await expect(pill(page, 'Marie')).toHaveAttribute('aria-label', "Josef Fíšek's 2nd marriage, 1908, Praha");
        await page.mouse.move(5, 5);
        await expect(tip).toBeHidden();

        // The keyboard: the focus on the pill opens its bubble, Escape closes it.
        const marieTip = pill(page, 'Marie').locator('.uo-tip');
        await page.keyboard.press('Shift');
        await pill(page, 'Marie').focus();
        await expect(marieTip).toBeVisible();
        await expect(marieTip).toHaveText("Josef Fíšek's 2nd marriage, 1908, Praha");
        await page.keyboard.press('Escape');
        await expect(marieTip).toBeHidden();

        await zoomTo(page, 0.59);
        await expect(pill(page, 'Anna')).toBeHidden();
        await zoomTo(page, 0.6);
        await expect(pill(page, 'Anna')).toBeVisible();
    });
});

test.describe('dense spacing by touch', () => {
    test.use({ hasTouch: true });

    test('a tap on the short pill opens its bubble, not the person\'s sheet', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1);
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
        const m = await middleOf(pill(page, 'Anna'));
        await page.touchscreen.tap(m.x, m.y);
        const tip = pill(page, 'Anna').locator('.uo-tip');
        await expect(tip).toBeVisible();
        await expect(tip).toHaveText("Josef Fíšek's 1st marriage, 1866, Dolní Lhota");
        await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
    });

    // GF (FA's father) carries "▸ ∞" on his bottom edge; FA his tabs on the top edge.
    const openTaps = async (page: Page, dense: boolean) => {
        const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'edge-childless-partners.json'), 'utf-8'));
        await seedSetting(page, 'treeSpacing', dense ? 'dense' : 'normal');
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(async (tree) => {
            await window.Strom.DataManager.importAsNewTree(tree as never, 'Taps');
            await window.Strom.TreeRenderer.setFocus('f' as never);
        }, data);
        await expect(page.locator('#tree-canvas .person-card[data-id="gf"] .hidden-partners-btn')).toHaveCount(1);
        await zoomTo(page, 1, 'gf');
    };

    test('each pill on the edge answers 44 × 44 px around its middle', async ({ page }) => {
        await openTaps(page, true);
        const items = page.locator('#tree-canvas .person-card .card-edge > :is(.branch-tab, .hidden-partners-btn, .union-order-pill)');
        const n = await items.count();
        expect(n).toBeGreaterThan(1);
        let bottoms = 0;
        for (let i = 0; i < n; i++) {
            const item = items.nth(i);
            if (!(await item.isVisible())) continue;
            const id = await item.evaluate(el => `${el.closest('.person-card')!.getAttribute('data-id')}:${el.classList[0]}`);
            const c = (await item.locator('xpath=ancestor::div[contains(@class, "person-card")][1]').boundingBox())!;
            const m = await middleOf(item);
            if (m.y < 30 || m.y > 870 || m.x < 30 || m.x > 1410) continue;   // off the screen
            const out = m.y < c.y + c.height / 2 ? -1 : 1;
            if (out > 0) bottoms++;
            // 21 px from its middle out of the card and into it: the pill's; 23 px: not
            expect(await hitAt(page, m.x, m.y + out * 21), `${id} 21 px out`).toBe(id);
            // (a pill over the avatar's corner leaves the avatar above it, its badge whole)
            const inside = await hitAt(page, m.x, m.y - out * 21);
            if (inside !== `${id.split(':')[0]}:avatar`) expect(inside, `${id} 21 px in`).toBe(id);
            expect(await hitAt(page, m.x, m.y + out * 23), `${id} 23 px out`).not.toBe(id);
            expect(await hitAt(page, m.x, m.y - out * 23), `${id} 23 px in`).not.toBe(id);
        }
        expect(bottoms, 'a pill on a bottom edge').toBeGreaterThan(0);
    });

    test('the normal spacing keeps the touch area reaching further out of the card', async ({ page }) => {
        await openTaps(page, false);
        const gfPill = page.locator('#tree-canvas .person-card[data-id="gf"] .hidden-partners-btn');
        const m = await middleOf(gfPill);
        expect(await hitAt(page, m.x, m.y + 30)).toBe('gf:hidden-partners-btn');
    });

    test('the research stub: its line 20 px above the card, its touch area 24 px out of the card and 20 px into it', async ({ page }) => {
        await setup(page);
        await zoomTo(page, 1, 'a');
        const stub = card(page, 'Anna').locator('.research-edge');
        await expect(stub).toBeVisible();
        const c = (await card(page, 'Anna').boundingBox())!;
        const line = (await stub.locator('.research-edge-line').boundingBox())!;
        const s = (await stub.boundingBox())!;
        // the card's top border at c.y + 1 (the line stands on it)
        expect(Math.abs(line.y + line.height - (c.y + 1))).toBeLessThanOrEqual(1.5);
        expect(Math.round(line.height)).toBe(20);
        expect(Math.abs(s.y - (c.y + 1 - 24))).toBeLessThanOrEqual(1.5);
        expect(Math.abs(s.y + s.height - (c.y + 1 + 20))).toBeLessThanOrEqual(1.5);
        const x = line.x + line.width / 2;
        expect(await hitAt(page, x, c.y - 22)).toBe('a:research-edge');
        expect(await hitAt(page, x, c.y + 18)).toBe('a:research-edge');
    });
});

test('dense spacing: no research stub reaches a bus above its card (it stops 4 px below)', async ({ page }) => {
    // The man of etalon-multi-partners' fourth union, expanded around his
    // grandson: a bus runs 1 px above where a 20 px stub of his wife would end.
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'etalon-multi-partners.json'), 'utf-8'));
    for (const p of Object.values(data.persons) as Array<{ isPlaceholder?: boolean; parentIds?: string[]; research?: object }>) {
        if (!p.isPlaceholder && !(p.parentIds ?? []).length) p.research = { edge: { ...EDGE, end: 'unsearched', next: 'queued' } };
    }
    await seedSetting(page, 'treeSpacing', 'dense');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async (tree) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Stubs');
        const r = window.Strom.TreeRenderer as unknown as { showAllPartnerships: boolean };
        r.showAllPartnerships = true;
        await window.Strom.TreeRenderer.setFocus('eE_v4_k3' as never);
    }, data);
    await expect(page.locator('#tree-canvas .person-card[data-id="eE_v4_k2_sp"] .research-edge')).toHaveCount(1);
    await zoomTo(page, 1, 'eE_v4_k2_sp');
    const r = await page.evaluate(() => {
        const R = window.Strom.TreeRenderer as unknown as {
            config: { cardWidth: number };
            positions: Map<string, { x: number; y: number }>;
            connections: Array<{ branchY: number; branchLeftX: number; branchRightX: number;
                connectorY: number; connectorFromX: number; connectorToX: number }>;
        };
        const lines = R.connections.flatMap(c => [
            { y: c.branchY, x0: Math.min(c.branchLeftX, c.branchRightX), x1: Math.max(c.branchLeftX, c.branchRightX) },
            { y: c.connectorY, x0: Math.min(c.connectorFromX, c.connectorToX), x1: Math.max(c.connectorFromX, c.connectorToX) },
        ]);
        const gaps: Array<{ id: string; d: number }> = [];
        let capped = 0;
        document.querySelectorAll<HTMLElement>('#tree-canvas .person-card .research-edge').forEach(el => {
            const cardEl = el.closest<HTMLElement>('.person-card')!;
            const id = cardEl.dataset.id!;
            const pos = R.positions.get(id)!;
            if (el.style.getPropertyValue('--edge-cap')) capped++;
            const cr = cardEl.getBoundingClientRect(), lr = el.querySelector('.research-edge-line')!.getBoundingClientRect();
            const k = cr.width / R.config.cardWidth;
            const x = pos.x + (lr.left + lr.width / 2 - cr.left) / k;
            const top = pos.y + (lr.top - cr.top) / k;
            for (const l of lines) {
                if (x < l.x0 - 1 || x > l.x1 + 1 || l.y >= pos.y || l.y < pos.y - 60) continue;
                gaps.push({ id, d: Math.round((top - l.y) * 10) / 10 });
            }
        });
        return { gaps, capped };
    });
    expect(r.capped, 'a stub shortened by a bus').toBeGreaterThan(0);
    for (const g of r.gaps) expect(g.d, `stub of ${g.id} below the bus`).toBeGreaterThanOrEqual(4);
});

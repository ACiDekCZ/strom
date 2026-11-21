/**
 * The Timeline's scope (spec 098 §11a): the bar over the axis with "Scope",
 * This view / Selection ▾ / Whole tree and how many people on the right; the
 * scope Selection draws only the selection's rows, This view or the Whole tree
 * with a selection dims the others; the scope remembered per tree; a cleared
 * selection takes Selection back to This view; a phone's "Scope: … ▾" with its
 * sheet; a long timeline draws the rows in view (5 000 people within budget).
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';
import { syntheticTree } from '../src/__tests__/helpers/synthetic-tree';
import { calibrationWorkload, machineFactor, normalizedMs } from '../src/__tests__/helpers/perf-budget';

/**
 * Tamsin's family (seven people, the view around her) and three people with
 * no tie to it (Bram, Elowen, Fennick: only in the Whole tree), Wren without
 * a birth year (left out of the rows, counted in the bar).
 */
const PEOPLE: Record<string, SeedPerson> = {
    tamsin: { firstName: 'Tamsin', lastName: 'Quillfen', gender: 'female', birthDate: '1950', parents: ['orrin', 'maelis'] },
    orrin: { firstName: 'Orrin', lastName: 'Quillfen', gender: 'male', birthDate: '1920', parents: ['corwen', 'ysolde'], partners: ['maelis'] },
    maelis: { firstName: 'Maelis', lastName: 'Ostrowbek', gender: 'female', birthDate: '1922' },
    corwen: { firstName: 'Corwen', lastName: 'Quillfen', gender: 'male', birthDate: '1890', parents: ['ansel'], partners: ['ysolde'] },
    ysolde: { firstName: 'Ysolde', lastName: 'Zandmeer', gender: 'female', birthDate: '1893', parents: ['ivar'] },
    ansel: { firstName: 'Ansel', lastName: 'Quillfen', gender: 'male', birthDate: '1860' },
    ivar: { firstName: 'Ivar', lastName: 'Zandmeer', gender: 'male', birthDate: '1865' },
    bram: { firstName: 'Bram', lastName: 'Pellwick', gender: 'male', birthDate: '1960' },
    elowen: { firstName: 'Elowen', lastName: 'Yarrowby', gender: 'female', birthDate: '1930', parents: ['fennick'] },
    fennick: { firstName: 'Fennick', lastName: 'Yarrowby', gender: 'male', birthDate: '1900' },
    wren: { firstName: 'Wren', lastName: 'Yarrowby', gender: 'female' },
};

/** The tree on the Timeline, with a list of three people (two of the view, Bram outside it); its id. */
async function setup(page: Page): Promise<string> {
    await openApp(page);
    await seedTree(page, PEOPLE, 'Quillfen');
    const listId = await page.evaluate(() => window.Strom.DataManager.createPersonList({
        name: 'Quillfen line', dynamic: false, personIds: ['tamsin', 'orrin', 'bram'] as never[], sort: 'manual',
    })!.id);
    // A phone has the Timeline in the More sheet: switched to directly.
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('timeline'));
    await expect(page.locator('#timeline-toolbar')).toBeVisible();
    return listId;
}

const bars = (page: Page): Locator => page.locator('#timeline-container .timeline-bar');
const bar = (page: Page, id: string): Locator => page.locator(`#timeline-container .timeline-bar[data-person-id="${id}"]`);
const rowIds = (page: Page): Promise<string[]> =>
    bars(page).evaluateAll(els => els.map(el => el.getAttribute('data-person-id') ?? '').sort());

/** The list chosen as the Timeline's selection from the Selection part's choice. */
async function chooseList(page: Page): Promise<void> {
    await page.locator('#timeline-scope-sel').click();
    const pop = page.locator('#timeline-container .timeline-scope-pick .sp-rodpick-pop');
    await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: 'Quillfen line' }).locator('button').click();
    await expect(page.locator('#timeline-scope-sel')).toHaveClass(/active/);
}

test.describe('the Timeline\'s scope, a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the bar: This view by default; the Whole tree adds the people outside the view, the note counts them; Selection only its rows @smoke', async ({ page }) => {
        await setup(page);
        const toolbar = page.locator('#timeline-toolbar');
        await expect(toolbar.locator('.tl-toolbar-label')).toHaveText('Scope');
        await expect(page.locator('#timeline-scope-view')).toHaveClass(/active/);
        const note = toolbar.locator('.tl-toolbar-note');
        await expect(note).toHaveText('7 people');
        expect(await rowIds(page)).toEqual(['ansel', 'corwen', 'ivar', 'maelis', 'orrin', 'tamsin', 'ysolde']);
        // The line under the axis is gone: the bar says it.
        await expect(page.locator('.tl-omitted')).toHaveCount(0);

        await page.locator('#timeline-scope-tree').click();
        await expect(page.locator('#timeline-scope-tree')).toHaveClass(/active/);
        await expect(bars(page)).toHaveCount(10);
        await expect(note).toHaveText('10 people · 1 person without a birth year not shown');
        // The bar sits over the axis: the first row starts below it.
        const barBox = (await toolbar.boundingBox())!;
        const first = (await bars(page).first().boundingBox())!;
        expect(first.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);

        await chooseList(page);
        expect(await rowIds(page)).toEqual(['bram', 'orrin', 'tamsin']);
        await expect(note).toHaveText('3 people');
        // Only the selection is shown: nothing highlighted, nothing dimmed.
        await expect(page.locator('#timeline-container .timeline-bar.evidence-dim')).toHaveCount(0);
        await expect(page.locator('#timeline-container .timeline-bar.evidence-hit')).toHaveCount(0);
    });

    test('This view with a selection: its rows outlined, the others dimmed; cleared: back to This view, nothing dimmed', async ({ page }) => {
        const listId = await setup(page);
        await chooseList(page);
        await page.locator('#timeline-scope-view').click();
        await expect(page.locator('#timeline-scope-view')).toHaveClass(/active/);
        await expect(bars(page)).toHaveCount(7);
        await expect(page.locator('#timeline-toolbar .tl-toolbar-note')).toHaveText('7 people · selection highlighted');
        for (const id of ['tamsin', 'orrin']) await expect(bar(page, id)).toHaveClass(/evidence-hit/);
        for (const id of ['maelis', 'corwen', 'ysolde', 'ansel', 'ivar']) await expect(bar(page, id)).toHaveClass(/evidence-dim/);
        await expect(bar(page, 'maelis')).toHaveCSS('opacity', '0.45');
        // The highlighted row's outline: dashed, in the accent.
        const dash = await bar(page, 'orrin').locator('.tl-bar-rect').evaluate(el => getComputedStyle(el).strokeDasharray);
        expect(dash).toMatch(/4(px)?,?\s+3(px)?/);

        // Selection again, then the list deleted: the selection is gone, the scope goes back to This view.
        await page.locator('#timeline-scope-sel').click();
        await expect(page.locator('#timeline-scope-sel')).toHaveClass(/active/);
        await expect(bars(page)).toHaveCount(3);
        await page.evaluate((l) => window.Strom.DataManager.deletePersonList(l), listId);
        await expect(page.locator('#timeline-scope-view')).toHaveClass(/active/);
        await expect(bars(page)).toHaveCount(7);
        await expect(page.locator('#timeline-container .timeline-bar.evidence-dim')).toHaveCount(0);
        await expect(page.locator('#timeline-toolbar .tl-toolbar-note')).toHaveText('7 people');
    });

    test('the scope remembered per tree: another tree opens with This view, back in the first the Whole tree', async ({ page }) => {
        await setup(page);
        const first = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
        await page.locator('#timeline-scope-tree').click();
        await expect(bars(page)).toHaveCount(10);

        await page.evaluate(async () => {
            const S = window.Strom;
            const persons = {
                odo: { id: 'odo', firstName: 'Odo', lastName: 'Brackwater', gender: 'male', birthDate: '1901', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] },
                pim: { id: 'pim', firstName: 'Pim', lastName: 'Brackwater', gender: 'female', birthDate: '1935', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] },
            };
            await S.DataManager.importAsNewTree({ persons, partnerships: {} } as never, 'Brackwater');
            await S.TreeRenderer.setFocus('odo' as never);
            S.UI.setDisplayViewMode('timeline');
        });
        await expect(page.locator('#timeline-scope-view')).toHaveClass(/active/);
        await expect(bars(page)).toHaveCount(1);

        await page.evaluate(async (id) => {
            await window.Strom.DataManager.switchTree(id as never);
            window.Strom.UI.setDisplayViewMode('timeline');
        }, first);
        await expect(page.locator('#timeline-scope-tree')).toHaveClass(/active/);
        await expect(bars(page)).toHaveCount(10);
    });
});

test.describe('the Timeline\'s scope, a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('"Scope: … ▾" over the axis opens its sheet; a scope and a selection chosen there', async ({ page }) => {
        await setup(page);
        const btn = page.locator('#timeline-toolbar .timeline-scope-btn');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveText(/Scope:\s*This view/);
        // The segment and the note are the computer's.
        await expect(page.locator('#timeline-toolbar .timeline-scope.scope-seg')).toBeHidden();
        await expect(page.locator('#timeline-toolbar .tl-toolbar-note')).toBeHidden();
        expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);

        await btn.click();
        await page.locator('.timeline-scope-sheet [data-scope="tree"]').click();
        await expect(btn).toHaveText(/Scope:\s*Whole tree/);
        await expect(bars(page)).toHaveCount(10);

        await btn.click();
        await page.locator('.timeline-scope-sheet .scope-row[data-sel]', { hasText: 'Quillfen line' }).click();
        await expect(btn).toHaveText(/Scope:.*Quillfen line/);
        await expect(bars(page)).toHaveCount(3);
        // The button stays above the first row.
        const b = (await btn.boundingBox())!;
        expect((await bars(page).first().boundingBox())!.y).toBeGreaterThanOrEqual(b.y + b.height);
    });
});

/**
 * The calibration of the performance check (src/__tests__/helpers/perf-budget.ts):
 * rounds of the script workload and the best time of the whole calibration
 * (script + DOM) on the reference machine at rest (the K1.5 calibration of
 * e2e/tree-overview.spec.ts).
 */
const CALIBRATION_ROUNDS = 16;
const CALIBRATION_REFERENCE_MS = 155;
/** Spec 098 §11a: the Whole tree of a 5 000-person tree on the Timeline. */
const WHOLE_TREE_BUDGET_MS = 300;

test.describe('the Timeline of a large tree', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('5 000 people, the Whole tree: drawn within the budget, only the rows in view; a scroll draws the rows it reaches', async ({ page }) => {
        test.setTimeout(120_000);
        await openApp(page);
        const { data, rootId } = syntheticTree({ persons: 5000, seed: 7 });
        await page.evaluate(async ({ data, rootId }) => {
            const S = window.Strom;
            await S.DataManager.importAsNewTree(data, 'Synthetic');
            S.TreeRenderer.setFocus(rootId);
            S.UI.setDisplayViewMode('timeline');
            await S.TreeRenderer.renderAsync();
        }, { data, rootId });
        await expect(page.locator('#timeline-toolbar')).toBeVisible();

        const calibrate = async (): Promise<number> => {
            const script = await page.evaluate(([fn, rounds]) => {
                const w = window as unknown as { __calibration?: (r: number) => number };
                w.__calibration ??= new Function(`return (${fn})`)() as (r: number) => number;
                const t = performance.now();
                w.__calibration(rounds);
                return performance.now() - t;
            }, [calibrationWorkload.toString(), CALIBRATION_ROUNDS] as const);
            const dom = await page.evaluate(() => {
                const t = performance.now();
                const box = document.createElement('div');
                box.style.cssText = 'position:absolute;left:0;top:0;width:1200px;visibility:hidden';
                for (let i = 0; i < 2000; i++) {
                    const el = document.createElement('div');
                    el.style.cssText = 'display:inline-block;width:110px;padding:4px;margin:2px;border:1px solid';
                    el.textContent = `Calibration ${i} · ${1700 + (i % 300)}`;
                    box.appendChild(el);
                }
                document.body.appendChild(box);
                let h = 0;
                for (let i = 0; i < 2000; i += 100) h += (box.children[i] as HTMLElement).offsetTop;
                box.remove();
                return h >= 0 ? performance.now() - t : 0;
            });
            return script + dom;
        };
        // One switch there and back as a warm-up (JIT), then the best of three.
        const run = (): Promise<number> => page.evaluate(async () => {
            const UI = window.Strom.UI;
            await UI.setViewScope('timeline', 'view');
            const t0 = performance.now();
            await UI.setViewScope('timeline', 'tree');
            // Laid out: the drawn rows measured.
            document.querySelector('#timeline-container .timeline-bar')?.getBoundingClientRect();
            return performance.now() - t0;
        });
        await calibrate();
        await run();
        const runs: { ms: number; cal: number; normalized: number }[] = [];
        for (let i = 0; i < 3; i++) {
            const cal = await calibrate();
            const ms = await run();
            runs.push({ ms, cal, normalized: normalizedMs(ms, cal, CALIBRATION_REFERENCE_MS) });
        }
        const best = runs.reduce((a, b) => (b.normalized < a.normalized ? b : a));
        console.log(`[timeline-scope] 5000 persons, Whole tree: ${runs.map(r => `${r.ms.toFixed(0)} (cal ${r.cal.toFixed(0)})`).join(' / ')} ms, best ${
            best.normalized.toFixed(0)} ms normalized (machine ×${machineFactor(best.cal, CALIBRATION_REFERENCE_MS).toFixed(2)})`);
        expect(best.normalized).toBeLessThan(WHOLE_TREE_BUDGET_MS);

        // Thousands of rows, a few dozen drawn; the SVG as tall as all of them.
        const note = page.locator('#timeline-toolbar .tl-toolbar-note');
        const rows = Number((await note.textContent())!.match(/^([\d,]+) people/)![1].replace(/,/g, ''));
        expect(rows).toBeGreaterThan(3000);
        const drawn = await bars(page).count();
        expect(drawn).toBeGreaterThan(10);
        expect(drawn).toBeLessThan(120);
        const svgH = await page.locator('#timeline-container svg.timeline-svg').evaluate(el => el.getBoundingClientRect().height);
        expect(svgH).toBeGreaterThan(rows * 28);

        // Scrolled to the middle: the rows there are drawn (the first ones no longer).
        const firstId = await bars(page).first().getAttribute('data-person-id');
        await page.locator('#timeline-container').evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
        await expect(page.locator('#timeline-container')).not.toHaveAttribute('data-rows-drawn', /^0-/);
        await expect(bar(page, firstId!)).toHaveCount(0);
        const box = (await page.locator('#timeline-container').boundingBox())!;
        const inView = await bars(page).evaluateAll((els, b) => els.filter(el => {
            const r = el.getBoundingClientRect();
            return r.bottom > b.y && r.top < b.y + b.height;
        }).length, box);
        expect(inView).toBeGreaterThan(10);
    });
});

import { test, expect, type Locator, type Page } from '@playwright/test';
import { openApp, mergeCompare, mergeCount, mergeCurrentStep, mergeDecide, mergeGroup, mergeOpenList, mergePair, mergeRow } from './helpers.js';
import { syntheticTree } from '../src/__tests__/helpers/synthetic-tree';
import { calibrationWorkload, machineFactor, normalizedMs } from '../src/__tests__/helpers/perf-budget';
import type { StromData } from '../src/types';

/**
 * Step 2 of the import guide (spec 134 §4, K3.3–K3.5): the comparison in
 * parts with its progress and Stop, the recalculated suggestions after a
 * decision, the rest decided at once, Continue locked while pairs are left,
 * several candidates of the tree, the joins undone, and the phone frames
 * (14b, 14f). The family Modřín and the places Křemenná and Mechová are
 * invented; the trees are built here.
 */

type P = StromData['persons'][string];

function person(id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<P> = {}): P {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra } as P;
}

/**
 * The tree Modřínovi (Kvido 1921, Florentýna 1924, their son Teofil 1950,
 * all of Křemenná) and, with `namesake`, another Teofil Modřín (1953, Mechová).
 */
function modrinovi(namesake: boolean): StromData {
    const d = {
        version: 26,
        persons: {
            m_kvido: person('m_kvido', 'Kvido', 'Modřín', 'male', { birthDate: '1921', birthPlace: 'Křemenná', partnerships: ['m_u1'], childIds: ['m_teofil'] } as Partial<P>),
            m_florentyna: person('m_florentyna', 'Florentýna', 'Modřínová', 'female', { birthDate: '1924', birthPlace: 'Křemenná', partnerships: ['m_u1'], childIds: ['m_teofil'] } as Partial<P>),
            m_teofil: person('m_teofil', 'Teofil', 'Modřín', 'male', { birthDate: '1950', birthPlace: 'Křemenná', parentIds: ['m_kvido', 'm_florentyna'] } as Partial<P>),
        },
        partnerships: { m_u1: { id: 'm_u1', person1Id: 'm_kvido', person2Id: 'm_florentyna', childIds: ['m_teofil'], status: 'married' } },
    } as unknown as StromData;
    if (namesake) d.persons['m_teofil2' as never] = person('m_teofil2', 'Teofil', 'Modřín', 'male', { birthDate: '1953', birthPlace: 'Mechová' } as Partial<P>);
    return d;
}

/**
 * The file: Kvido Modřín 1921 (The same), Florentýna and their son Teofil
 * without dates (Maybe the same) and, with `namesake`, a Teofil Modřín 1953 of
 * Mechová (The same as the tree's namesake).
 */
function modrinoviFile(namesake: boolean): StromData {
    const d = {
        version: 26,
        persons: {
            i_kvido: person('i_kvido', 'Kvido', 'Modřín', 'male', { birthDate: '1921', partnerships: ['i_u1'], childIds: ['i_teofil'] } as Partial<P>),
            i_flor: person('i_flor', 'Florentýna', 'Modřínová', 'female', { partnerships: ['i_u1'], childIds: ['i_teofil'] } as Partial<P>),
            i_teofil: person('i_teofil', 'Teofil', 'Modřín', 'male', { parentIds: ['i_kvido', 'i_flor'] } as Partial<P>),
        },
        partnerships: { i_u1: { id: 'i_u1', person1Id: 'i_kvido', person2Id: 'i_flor', childIds: ['i_teofil'], status: 'married' } },
    } as unknown as StromData;
    if (namesake) d.persons['i_teofil_b' as never] = person('i_teofil_b', 'Teofil', 'Modřín', 'male', { birthDate: '1953', birthPlace: 'Mechová' } as Partial<P>);
    return d;
}

/** The tree opened, the file merged into it: the guide on step 1. */
async function openGuide(page: Page, tree: StromData, file: StromData, name = 'Modřínovi'): Promise<Locator> {
    await page.evaluate(async ({ tree, file, name }) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(tree, name);
        S.MergerUI.startMerge(file, 'modrinovi-2.json');
    }, { tree, file, name });
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    return wizard;
}

test.describe('the comparison of a large tree (K3.5)', () => {
    /** The calibration of e2e/card-photo.spec.ts (script + DOM, src/__tests__/helpers/perf-budget.ts). */
    const PERF_CALIBRATION_ROUNDS = 16;
    const PERF_CALIBRATION_REFERENCE_MS = 155;
    /**
     * The longest pause between two frames while the comparison runs, on the
     * reference machine at rest (normalized ms): the parts take about 40 ms
     * each, so a pause stays well under 200 ms; the comparison in one piece
     * (about 12 s for these trees) is far over it.
     */
    const PERF_BUDGET_FRAME_MS = 600;

    async function calibrate(page: Page): Promise<number> {
        const script = await page.evaluate(([fn, rounds]) => {
            const w = window as unknown as { __calibration?: (r: number) => number };
            w.__calibration ??= new Function(`return (${fn})`)() as (r: number) => number;
            const t = performance.now();
            w.__calibration(rounds);
            return performance.now() - t;
        }, [calibrationWorkload.toString(), PERF_CALIBRATION_ROUNDS] as const);
        const dom = await page.evaluate(() => {
            const t = performance.now();
            const box = document.createElement('div');
            box.style.cssText = 'position:absolute;left:0;top:0;width:1200px;visibility:hidden';
            for (let i = 0; i < 2000; i++) {
                const el = document.createElement('div');
                el.className = 'tov-card';
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
    }

    test('a 10 000-person tree: the progress grows, the window keeps working, Stop returns to step 1 with its choices', async ({ page }) => {
        test.setTimeout(240_000);
        await openApp(page);
        const tree = syntheticTree({ persons: 10_000, seed: 5 }).data;
        const file = syntheticTree({ persons: 10_000, seed: 6 }).data;
        const wizard = await openGuide(page, tree, file, 'Křemenná');
        await calibrate(page); // warm-up
        const cal = await calibrate(page);

        // The frames are counted from the press of the primary button on.
        await page.evaluate(() => {
            const w = window as unknown as { __gaps: number[]; __frames: boolean };
            w.__gaps = [];
            w.__frames = true;
            let last = performance.now();
            const tick = (t: number) => {
                w.__gaps.push(t - last);
                last = t;
                if (w.__frames) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        await wizard.locator('#merge-next').click();

        // Step 2 "comparing…": the bar, how far, the note and Stop; Continue waits.
        const comparing = wizard.locator('.merge-comparing');
        await expect(comparing).toBeVisible();
        await expect(comparing).toHaveAttribute('aria-busy', 'true');
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
        await expect(wizard.locator('#merge-next')).toBeDisabled();
        const bar = comparing.locator('[role="progressbar"]');
        await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 60_000 }).toBeGreaterThan(0);
        const first = Number(await bar.getAttribute('aria-valuenow'));
        // "i of n people of the tree Křemenná": n is the tree's named people, near 10 000.
        await expect(comparing.locator('.merge-comparing-of')).toHaveText(/^\d+ of (9 ?9\d\d|10 ?000) people of the tree Křemenná/);

        // The window answers meanwhile: a click on the step list's step 1 is taken (it has the focus).
        const stepOne = wizard.locator('#merge-progress button.merge-step[data-step="1"]');
        await stepOne.focus();
        await expect(stepOne).toBeFocused();
        await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { timeout: 60_000 }).toBeGreaterThan(first);

        const gaps = await page.evaluate(() => {
            const w = window as unknown as { __gaps: number[]; __frames: boolean };
            w.__frames = false;
            return w.__gaps;
        });
        expect(gaps.length).toBeGreaterThan(10);
        const longest = Math.max(...gaps.slice(1));
        const normalized = normalizedMs(longest, cal, PERF_CALIBRATION_REFERENCE_MS);
        console.log(`[merge compare] ${gaps.length} frames, longest pause ${longest.toFixed(0)} ms (×${
            machineFactor(cal, PERF_CALIBRATION_REFERENCE_MS).toFixed(2)}) = ${normalized.toFixed(0)} normalized`);
        expect(normalized).toBeLessThan(PERF_BUDGET_FRAME_MS);

        // Stop: back on step 1, nothing compared, the primary compares again.
        await comparing.locator('#merge-compare-stop').click();
        await expect(comparing).toBeHidden();
        await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
        await expect(wizard.locator('#merge-next')).toBeEnabled();
        await expect(wizard.locator('#merge-next')).toContainText('Křemenná');
        expect(await page.evaluate(() => (window.Strom.MergerUI as unknown as { mergeState?: { matches: unknown[] } }).mergeState?.matches.length ?? 0)).toBe(0);
    });
});

test.describe('step 2: decisions (K3.3, K3.4)', () => {
    test('Continue is locked while pairs are left and says why; the rest Do not add decides them all and the counts add up', async ({ page }) => {
        await openApp(page);
        const wizard = await openGuide(page, modrinovi(false), modrinoviFile(false));
        await mergeCompare(wizard);
        // Florentýna and Teofil without dates are only offered: two pairs to decide.
        await expect(mergeCount(wizard, 'pending')).toHaveText('2');
        await expect(wizard.locator('#merge-next')).toBeDisabled();
        await expect(wizard.locator('#merge-next')).toContainText('What will happen');
        await expect(wizard.locator('#merge-next-why')).toHaveText('2 pairs left to decide');

        // Under the pair: "Remaining 2 undecided: Add as new (2) · Do not add (2)".
        await mergeGroup(wizard, 'maybe');
        const rest = wizard.locator('#merge-rest');
        await expect(rest).toContainText('Remaining 2 undecided');
        await rest.locator('[data-rest="skip"]').click();
        await expect(mergeCount(wizard, 'pending')).toHaveText('0');
        await expect(mergeCount(wizard, 'skipped')).toHaveText('2');
        await expect(mergeCount(wizard, 'joined')).toHaveText('1');
        const counts = (await wizard.locator('#merge-counts .merge-stat .merge-stat-value').allTextContents()).map(Number);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
        await expect(wizard.locator('#merge-rest')).toHaveCount(0);
        await expect(wizard.locator('#merge-next')).toBeEnabled();
        await expect(wizard.locator('#merge-next-why')).toHaveText('');
        await expect(mergeRow(wizard, 'Teofil')).toHaveAttribute('data-fate', 'skipped');
    });

    test('a decision recalculates the undecided pairs: the sentence names them, Show lists only them', async ({ page }) => {
        await openApp(page);
        const wizard = await openGuide(page, modrinovi(true), modrinoviFile(true));
        await mergeCompare(wizard);
        await expect(wizard.locator('.merge-recalc')).toHaveCount(0);
        // The file's Teofil without a date is in fact the tree's Teofil of 1953: Another person…
        await mergeDecide(wizard, /Teofil/, 'other', 'maybe');
        const dialog = page.locator('#merge-manual-dialog');
        await expect(dialog).toHaveClass(/active/);
        await dialog.locator('.person-picker-input').fill('Teofil');
        await dialog.locator('.person-picker-item', { hasText: '1953' }).first().click();
        await dialog.locator('.buttons button.primary').click();
        await expect(dialog).not.toHaveClass(/active/);

        // So the file's Teofil of 1953 has no pair any more: the sentence says so, decided pairs stay.
        const recalc = wizard.locator('.merge-recalc');
        await expect(recalc).toContainText('The decision recalculated 1 suggestion for relatives (Teofil Modřín). Decided pairs do not change.');
        await expect(mergeCount(wizard, 'joined')).toHaveText('2');
        const show = recalc.locator('.merge-recalc-show');
        await expect(show).toHaveText('Show');
        await show.click();
        await expect(show).toHaveAttribute('aria-pressed', 'true');
        await expect(show).toHaveText('Show all');
        const rows = wizard.locator('#merge-match-list .merge-item');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('1953');
        await expect(wizard.locator('.merge-tab[aria-selected="true"]')).toHaveCount(0);
        // A tab shows its group again.
        await mergeGroup(wizard, 'same');
        await expect(rows).not.toHaveCount(1);
    });

    test('several candidates of the tree: the chosen one stands in the pair and is the one joined', async ({ page }) => {
        await openApp(page);
        const tree = modrinovi(true);
        const wizard = await openGuide(page, tree, modrinoviFile(false));
        await mergeCompare(wizard);
        await mergePair(wizard, /Teofil/, 'maybe');
        const pane = wizard.locator('#merge-pair');
        await expect(pane.locator('.merge-pair-sub')).toContainText('2 candidates');
        const cands = pane.locator('.merge-cand');
        await expect(cands).toHaveCount(2);
        await expect(cands.first().locator('input')).toBeChecked();
        await expect(pane.locator('.pair')).toContainText('1950');
        // The other candidate: the pair shows the Teofil of 1953 of Mechová.
        await cands.nth(1).click();
        await expect(cands.nth(1).locator('input')).toBeChecked();
        await expect(pane.locator('.pair')).toContainText('1953');
        await expect(pane.locator('.pair')).not.toContainText('1950');
        await pane.locator('.merge-dec[data-dec="same"]').click();
        const decision = await page.evaluate(() => {
            const s = (window.Strom.MergerUI as unknown as { mergeState: { decisions: Map<string, { type: string; targetId?: string }>; matches: { incomingId: string; existingId: string }[] } }).mergeState;
            return { d: s.decisions.get('i_teofil'), pair: s.matches.find(m => m.incomingId === 'i_teofil')?.existingId };
        });
        expect(decision.pair).toBe('m_teofil2');
        expect(['manual_match', 'confirm']).toContain(decision.d?.type);
        await expect(mergeCount(wizard, 'joined')).toHaveText('2');
        await expect(mergeCount(wizard, 'pending')).toHaveText('1');
    });

    test('Undo the joins of the selected: the chosen rows of The same become new people', async ({ page }) => {
        await openApp(page);
        const wizard = await openGuide(page, modrinovi(true), modrinoviFile(true));
        await mergeCompare(wizard);
        await mergeGroup(wizard, 'same');
        const unjoin = wizard.locator('.merge-unjoin');
        await expect(unjoin).toBeDisabled();
        await expect(mergeCount(wizard, 'joined')).toHaveText('2');
        await mergeRow(wizard, 'Kvido').locator('.merge-item-check').check();
        await expect(unjoin).toBeEnabled();
        await unjoin.click();
        await expect(mergeCount(wizard, 'joined')).toHaveText('1');
        await expect(mergeRow(wizard, 'Kvido')).toHaveAttribute('data-fate', 'added');
        await expect(wizard.locator('.merge-unjoin')).toBeDisabled();
    });
});

for (const vp of [{ width: 390, height: 844, name: 'a phone (14b)' }, { width: 844, height: 390, name: 'a phone held sideways (14f)' }]) {
    test(`step 2 on ${vp.name}: the list a sheet, the decisions in view, no sideways scroll`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await openApp(page);
        const wizard = await openGuide(page, modrinovi(false), modrinoviFile(false));
        await mergeCompare(wizard);
        const noSideways = () => page.evaluate(() => {
            const wide = [document.documentElement, ...document.querySelectorAll<HTMLElement>('#merge-modal *')]
                .filter(el => el.clientWidth > 0 && getComputedStyle(el).overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1)
                .map(el => `${el.tagName}.${el.className}`);
            return { page: document.documentElement.scrollWidth <= window.innerWidth, wide };
        });

        // The pair first, the list behind "Pair i of n ▾".
        const open = wizard.locator('.merge-pair-open');
        await expect(open).toBeVisible();
        await expect(open).toHaveAttribute('aria-expanded', 'false');
        await expect(wizard.locator('#merge-match-list')).toBeHidden();
        await expect(wizard.locator('#merge-next')).toBeInViewport();
        for (const dec of await wizard.locator('#merge-pair .merge-dec').all()) {
            await dec.scrollIntoViewIfNeeded();
            await expect(dec).toBeInViewport({ ratio: 1 });
            expect((await dec.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        expect(await noSideways()).toEqual({ page: true, wide: [] });

        if (vp.width < 641) {
            // One column of the pair at a time: the tree's or the import's.
            const seg = wizard.locator('.merge-pair-seg');
            await expect(seg).toBeVisible();
            await expect(seg.locator('[data-side="tree"]')).toHaveText('Modřínovi');
            await expect(wizard.locator('#merge-pair .pair')).toHaveClass(/show-tree/);
            await expect(wizard.locator('#merge-pair .pair .c2').first()).toBeHidden();
            await seg.locator('[data-side="import"]').click();
            await expect(wizard.locator('#merge-pair .pair')).toHaveClass(/show-import/);
            await expect(wizard.locator('#merge-pair .pair .c1').first()).toBeHidden();
            await expect(wizard.locator('#merge-pair .pair .c2').first()).toBeVisible();
        } else {
            // Sideways the pair stands side by side.
            await expect(wizard.locator('.merge-pair-seg')).toBeHidden();
            await expect(wizard.locator('#merge-pair .pair .c1').first()).toBeVisible();
            await expect(wizard.locator('#merge-pair .pair .c2').first()).toBeVisible();
        }

        // The sheet: its tabs and rows in view; a row chosen closes it and shows that pair.
        await mergeOpenList(wizard);
        await expect(wizard.locator('.merge-s2-sheet-close')).toBeInViewport();
        await expect(wizard.locator('.merge-tab[data-group="maybe"]')).toBeInViewport();
        expect(await noSideways()).toEqual({ page: true, wide: [] });
        await mergeGroup(wizard, 'maybe');
        const row = mergeRow(wizard, 'Florentýna');
        await row.scrollIntoViewIfNeeded();
        await expect(row).toBeInViewport();
        await row.click();
        await expect(wizard.locator('#merge-match-list')).toBeHidden();
        await expect(open).toBeFocused();
        await expect(wizard.locator('#merge-pair .pair')).toContainText('Florentýna');
        // The sheet closes by its ×, too.
        await mergeOpenList(wizard);
        await wizard.locator('.merge-s2-sheet-close').click();
        await expect(wizard.locator('#merge-match-list')).toBeHidden();
        // A decision by a finger: Do not add.
        await wizard.locator('#merge-pair .merge-dec[data-dec="skip"]').click();
        await expect(mergeCount(wizard, 'skipped')).toHaveText('1');
    });
}

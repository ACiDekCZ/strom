import { test, expect, Page } from '@playwright/test';
import { openApp, card, createFirstPerson } from './helpers.js';

/**
 * Fan chart view: semicircular ancestor diagram as the fourth display mode.
 */
test('fan view shows ancestor sectors and clicking one refocuses', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

    await page.locator('#view-mode-fan').click();
    const container = page.locator('#fan-container');
    await expect(container).toBeVisible();
    await expect(container.locator('.fan-svg')).toBeVisible();
    // The family canvas is hidden while the fan is up.
    await expect(page.locator('#tree-canvas')).toBeHidden();

    // Focus disc shows the focus person; his father is a clickable sector.
    await expect(container.locator('.fan-focus')).toContainText('Johan');
    const father = container.locator('[data-fan-person]', { hasText: 'Peter' }).first();
    await expect(father).toBeVisible();
    await father.click();
    await expect(container.locator('.fan-focus')).toContainText('Peter');

    // Back to the family view: cards return, fan hidden.
    await page.locator('#view-mode-family').click();
    await expect(container).toBeHidden();
    await expect(card(page, 'Johan')).toBeVisible();
});

test('fan view: the generations stepper changes the ring count and is remembered (3-10)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await page.locator('#view-mode-fan').click();

    const stepper = page.locator('#fan-gen-stepper');
    const value = stepper.locator('.depth-stepper-value');
    const fewer = stepper.locator('[data-step="-1"]');
    const more = stepper.locator('[data-step="1"]');
    await expect(value).toHaveText('5');
    const countAt = () => page.locator('#fan-chart .fan-sector').count();
    // Counted once the chart is drawn (a slow machine counts a half-drawn fan otherwise).
    const settled = async (): Promise<number> => {
        let last = -1;
        await expect.poll(async () => { const n = await countAt(); const same = n > 0 && n === last; last = n; return same; },
            { intervals: [150] }).toBe(true);
        return last;
    };
    const at5 = await settled();
    await fewer.click();
    await expect(value).toHaveText('4');
    const at4 = await settled();
    expect(at4).toBeLessThanOrEqual(at5);
    // The lower limit: 3, the button off there.
    await fewer.click();
    await expect(value).toHaveText('3');
    await expect(fewer).toBeDisabled();
    await expect(more).toBeEnabled();
    // The upper limit: 10.
    for (let n = 4; n <= 10; n++) {
        await more.click();
        await expect(value).toHaveText(String(n));
    }
    await expect(more).toBeDisabled();
    await page.reload();
    // A start opens the tree view (1101); the fan's own settings stay.
    await page.locator('#view-mode-fan').click();
    await expect(page.locator('#fan-container .fan-svg')).toBeVisible();
    await expect(page.locator('#fan-gen-stepper .depth-stepper-value')).toHaveText('10');
});

test('fan view: empty ancestor slot offers adding a parent', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#view-mode-fan').click();
    const container = page.locator('#fan-container');
    await expect(container).toBeVisible();

    // Jan has no parents: two dashed "+" slots; a click offers adding the father, which opens the add-parent modal.
    const addSlots = container.locator('[data-fan-add]');
    await expect(addSlots).toHaveCount(2);

    // The "+" slots stay on screen only: printing leaves them out (spec 029 §7.3).
    await page.emulateMedia({ media: 'print' });
    await expect(addSlots.first()).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(addSlots.first()).toBeVisible();

    await addSlots.first().click();
    await page.locator('[data-fan-menu="add"], #fan-menu-add').first().click();
    await expect(page.locator('#relation-modal')).toBeVisible();
});

test('Kekule numbers are off by default, drawn when enabled, always in the tooltip (K9)', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(page.locator('#fan-container .fan-svg')).toBeVisible();

    // Default: no numbers drawn, but the tooltip carries the ahnentafel.
    await expect(page.locator('.fan-kekule')).toHaveCount(0);
    await expect(page.locator('.fan-sector title').first()).toHaveText(/^#2 · Peter/);

    // Enabled: numbers appear in the sectors.
    await page.evaluate(() => window.Strom.UI.toggleFanKekule(true));
    await expect.poll(() => page.locator('.fan-kekule').count()).toBeGreaterThan(0);
    await expect(page.locator('.fan-kekule').first()).toHaveText(/^\d+$/);

    await page.evaluate(() => window.Strom.UI.toggleFanKekule(false));
    await expect(page.locator('.fan-kekule')).toHaveCount(0);
});

test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the primary views live on the bottom bar; Fan opens from the More sheet', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        // The three primary views are bottom-bar tabs.
        for (const m of ['family', 'descendants', 'timeline']) {
            await expect(page.locator(`#bb-view-${m}`)).toBeVisible();
        }
        // Fan lives in the More sheet.
        await page.locator('#bb-view-more').click();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Fan' }).click();
        await expect(page.locator('#fan-container .fan-svg')).toBeVisible();

        // The bottom bar marks "More" active while a sheet view (fan) is shown.
        await expect(page.locator('#bb-view-more')).toHaveClass(/active/);
        // Reopening the sheet marks the Fan row active.
        await page.locator('#bb-view-more').click();
        await expect(page.locator('.bottom-sheet-menu .bottom-sheet-item.active', { hasText: 'Fan' })).toBeVisible();
    });
});

// ---------------------------------------------------------------- the Fan view (spec 029 §1-§3, §9.4-§9.5)


/** The fan SVG's viewBox as numbers. */
async function viewBox(page: Page): Promise<number[]> {
    const vb = await page.locator('#fan-chart .fan-svg').getAttribute('viewBox');
    return (vb ?? '').split(/[ ,]+/).map(Number);
}

/** The viewBox once the zoom's animation has stopped: the same over two reads further apart than the animation. */
async function settledViewBox(page: Page): Promise<number[]> {
    let last = '';
    await expect.poll(async () => {
        const now = (await viewBox(page)).join(' ');
        const same = now === last;
        last = now;
        return same;
    }, { intervals: [400], timeout: 10_000 }).toBe(true);
    return last.split(' ').map(Number);
}

/** A screen point inside the sector of a person (the bounding box centre of a wedge may lie outside it). */
async function sectorPoint(page: Page, name: string): Promise<{ x: number; y: number }> {
    const p = await page.evaluate((who) => {
        const g = [...document.querySelectorAll<SVGGElement>('#fan-chart [data-fan-person]')]
            .find(el => (el.querySelector('title')?.textContent ?? '').includes(who));
        if (!g) return null;
        const chart = document.getElementById('fan-chart')!.getBoundingClientRect();
        const r = g.getBoundingClientRect();
        const left = Math.max(r.left, chart.left), right = Math.min(r.right, chart.right);
        const top = Math.max(r.top, chart.top), bottom = Math.min(r.bottom, chart.bottom);
        for (let fy = 0.5, i = 0; i < 9; i++, fy = 0.1 + i * 0.1) {
            for (let fx = 0.5, j = 0; j < 9; j++, fx = 0.1 + j * 0.1) {
                const x = left + (right - left) * fx, y = top + (bottom - top) * fy;
                if (g.contains(document.elementFromPoint(x, y))) return { x, y };
            }
        }
        return null;
    }, name);
    expect(p, `a point inside the sector of ${name}`).not.toBeNull();
    return p!;
}

async function openFan(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await expect(page.locator('.fan-focus')).toContainText('Johan');
}

test('fan view: ＋ − ⛶ and the wheel zoom the fan, the toolbar stands still (1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFan(page);
    const bar = page.locator('#fan-toolbar');
    const barBox = await bar.boundingBox();
    const whole = await viewBox(page);
    // The SVG fills the stage (no minimum width, no scrolling).
    const stage = (await page.locator('#fan-stage').boundingBox())!;
    const svg = (await page.locator('#fan-chart .fan-svg').boundingBox())!;
    expect(Math.abs(svg.width - stage.width)).toBeLessThan(2);
    expect(Math.abs(svg.height - stage.height)).toBeLessThan(2);

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(whole[2] * 0.7);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(async () => (await viewBox(page))[2]).toBeGreaterThan(whole[2] * 0.99);
    // The wheel zooms around the cursor.
    const at = await sectorPoint(page, 'Peter');
    await page.mouse.move(at.x, at.y);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(whole[2] / 2);
    expect(await bar.boundingBox()).toEqual(barBox);
    // ⛶ goes back to the whole fan.
    await page.getByRole('button', { name: 'Whole fan' }).click();
    await expect.poll(async () => (await viewBox(page)).map(n => Math.round(n))).toEqual(whole.map(n => Math.round(n)));
    // The keys on the chart: + zooms in, 0 the whole fan.
    await page.locator('#fan-chart').focus();
    await page.keyboard.press('+');
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(whole[2] * 0.7);
    await page.keyboard.press('0');
    await expect.poll(async () => Math.round((await viewBox(page))[2])).toBe(Math.round(whole[2]));

    // The evidence highlight stays through the redraws of a zoom.
    await page.evaluate(() => {
        const peter = document.querySelector<SVGGElement>('#fan-chart [data-fan-ahnentafel="2"][data-fan-person]')!.dataset.fanPerson!;
        window.Strom.TreeRenderer.setEvidenceHighlight(new Set([peter as never]));
    });
    await expect(page.locator('#fan-chart [data-fan-ahnentafel="2"]')).toHaveClass(/evidence-hit/);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('#fan-chart [data-fan-ahnentafel="2"]')).toHaveClass(/evidence-hit/);
    await expect(page.locator('#fan-chart [data-fan-ahnentafel="3"]')).toHaveClass(/evidence-dim/);
});

test('fan view: a tap after zooming in re-centres the person under it; a drag moves the fan (K1.2, 1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFan(page);
    const whole = await viewBox(page);
    const at = await sectorPoint(page, 'Peter');
    await page.mouse.move(at.x, at.y);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(whole[2] / 2);
    // The point under the cursor is still Peter's sector.
    const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-fan-person]')?.querySelector('title')?.textContent ?? '', at);
    expect(under).toContain('Peter');

    // A drag pans and is no tap.
    const before = await viewBox(page);
    const chart = (await page.locator('#fan-chart').boundingBox())!;
    const cx = chart.x + chart.width / 2, cy = chart.y + chart.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 10, { steps: 6 });
    await page.mouse.move(cx + 120, cy + 20, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await viewBox(page))[0]).toBeLessThan(before[0] - 1);
    await page.waitForTimeout(400);
    await expect(page.locator('.fan-focus')).toContainText('Johan');

    // A tap on Peter re-centres the fan on him (and starts from the whole fan).
    const peter = await sectorPoint(page, 'Peter');
    await page.mouse.click(peter.x, peter.y);
    await expect(page.locator('.fan-focus')).toContainText('Peter');
    await expect.poll(async () => (await viewBox(page))[2]).toBeGreaterThan(whole[2] * 0.9);
});

test('fan view: three shapes, kept after a reload; the descendants stepper only for two-way (1-5) (1031)', async ({ page }) => {
    await openFan(page);
    const svg = page.locator('#fan-chart .fan-svg');
    const shape = (name: string) => page.locator('#fan-toolbar [role="radio"]', { hasText: name });
    await expect(shape('Half circle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#fan-desc-stepper')).toBeHidden();
    const halfCount = await page.locator('#fan-chart .fan-sector').count();

    await shape('Full circle').click();
    await expect(svg).toHaveAttribute('data-fan-shape', 'full');
    await expect(shape('Full circle')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#fan-desc-stepper')).toBeHidden();

    await shape('Two-way').click();
    await expect(svg).toHaveAttribute('data-fan-shape', 'two');
    await expect(page.locator('#fan-desc-stepper')).toBeVisible();
    await expect.poll(() => page.locator('#fan-chart [data-fan-kind="desc"]').count()).toBeGreaterThan(0);
    expect(await page.locator('#fan-chart .fan-sector').count()).toBeGreaterThanOrEqual(halfCount);
    // Arrow keys move the choice inside the group.
    await shape('Two-way').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(svg).toHaveAttribute('data-fan-shape', 'full');
    await page.keyboard.press('ArrowRight');
    await expect(svg).toHaveAttribute('data-fan-shape', 'two');

    const desc = page.locator('#fan-desc-stepper');
    const value = desc.locator('.depth-stepper-value');
    await expect(value).toHaveText('3');
    for (const n of ['2', '1']) { await desc.locator('[data-step="-1"]').click(); await expect(value).toHaveText(n); }
    await expect(desc.locator('[data-step="-1"]')).toBeDisabled();
    for (const n of ['2', '3', '4', '5']) { await desc.locator('[data-step="1"]').click(); await expect(value).toHaveText(n); }
    await expect(desc.locator('[data-step="1"]')).toBeDisabled();

    await page.reload();
    // A start opens the tree view (1101); the fan's own settings stay.
    await page.locator('#view-mode-fan').click();
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute('data-fan-shape', 'two');
    await expect(page.locator('#fan-desc-stepper .depth-stepper-value')).toHaveText('5');
});

test('fan view: the colour choice and the legend; a colour keeps the zoom; the legend folds and is remembered (1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFan(page);
    const legend = page.locator('#fan-legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.fan-legend-items')).toBeVisible();
    await expect(legend).toContainText('men');
    await expect(page.locator('#fan-color-select')).toBeHidden();

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(400);
    const zoomed = await viewBox(page);
    await page.locator('#fan-toolbar [data-fan-color="line"]').click();
    await expect(page.locator('#fan-toolbar [data-fan-color="line"]')).toHaveAttribute('aria-checked', 'true');
    await expect(legend).toContainText("father's father");
    expect((await viewBox(page)).map(n => Math.round(n))).toEqual(zoomed.map(n => Math.round(n)));

    await page.locator('#fan-legend-head').click();
    await expect(page.locator('#fan-legend-head')).toHaveAttribute('aria-expanded', 'false');
    await expect(legend.locator('.fan-legend-items')).toBeHidden();
    await page.reload();
    // A start opens the tree view (1101); the fan's own settings stay.
    await page.locator('#view-mode-fan').click();
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await expect(page.locator('#fan-legend-head')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#fan-toolbar [data-fan-color="line"]')).toHaveAttribute('aria-checked', 'true');

    // Tablet: the colours are a dropdown.
    await page.setViewportSize({ width: 800, height: 1000 });
    await expect(page.locator('#fan-toolbar .fan-color-seg')).toBeHidden();
    await page.locator('#fan-color-select').selectOption('rod');
    await expect(page.locator('#fan-legend-head')).toContainText('Family lines');
});

test('fan view: more text after zooming in (K1.4, 1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFan(page);
    // The outermost known ancestor: the least room at the whole fan.
    const outer = await page.evaluate(() => {
        const all = [...document.querySelectorAll<SVGGElement>('#fan-chart [data-fan-kind="anc"][data-fan-person]')];
        all.sort((a, b) => Number(b.dataset.fanAhnentafel) - Number(a.dataset.fanAhnentafel));
        return all[0]?.dataset.fanPerson ?? null;
    });
    expect(outer).not.toBeNull();
    const textOf = () => page.locator(`#fan-chart [data-fan-person="${outer}"] text:not(.fan-kekule)`).allTextContents()
        .then(t => t.join(' ').replace(/\s+/g, ' ').trim().length);
    const before = await textOf();
    const name = await page.locator(`#fan-chart [data-fan-person="${outer}"] title`).first().textContent();
    const at = await sectorPoint(page, (name ?? '').split(' · ').pop()!.split(' ')[0]);
    await page.mouse.move(at.x, at.y);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -250);
    await expect.poll(textOf, { timeout: 5000 }).toBeGreaterThan(before);
});

test('fan view: printing shows the whole fan without the toolbar, then the zoom comes back (§9.4, 1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openFan(page);
    const whole = await viewBox(page);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(whole[2] / 2);
    // The zoom animates: the view to come back is the one it stops at, not one on the way (under load
    // the width passes half the fan well before the animation ends).
    const zoomed = await settledViewBox(page);
    const bounds = await page.evaluate(() => window.Strom.TreeRenderer.getFanView()?.getModel()?.bounds ?? null);
    expect(bounds).not.toBeNull();

    // The browser's order: beforeprint, then the print layout (its new size alone would start from the whole fan, §1.6).
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#fan-toolbar')).toBeHidden();
    await expect(page.locator('#fan-zoom-controls')).toBeHidden();
    await expect(page.locator('#fan-legend-items')).toBeVisible();
    // Polled: the print layout's new size first fits the view, the redraw after it shows the frame.
    await expect.poll(async () => (await viewBox(page)).map(n => Math.round(n)))
        .toEqual([bounds!.x, bounds!.y, bounds!.w, bounds!.h].map(n => Math.round(n)));

    // The browser fires afterprint once the screen is back.
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#fan-toolbar')).toBeVisible();
    await expect.poll(async () => (await viewBox(page)).map(n => Math.round(n))).toEqual(zoomed.map(n => Math.round(n)));
});

test.describe('fan view on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a double tap zooms in and back; the colours and the legend in a sheet from the chip (1031)', async ({ page }) => {
        await openFan(page);
        const whole = await viewBox(page);
        await expect(page.locator('#fan-legend')).toBeHidden();
        // Touch: only ⛶ of the zoom buttons.
        await expect(page.locator('.fan-zoom-in')).toBeHidden();
        await expect(page.locator('.fan-zoom-fit')).toBeVisible();

        const chart = (await page.locator('#fan-chart').boundingBox())!;
        const x = chart.x + chart.width / 2, y = chart.y + chart.height * 0.3;
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(80);
        await page.touchscreen.tap(x, y);
        await expect.poll(async () => (await viewBox(page))[2]).toBeLessThan(whole[2] / 2);
        await page.waitForTimeout(400);
        await expect(page.locator('.fan-focus')).toContainText('Johan');
        await page.touchscreen.tap(x, y);
        await page.waitForTimeout(80);
        await page.touchscreen.tap(x, y);
        await expect.poll(async () => Math.round((await viewBox(page))[2])).toBe(Math.round(whole[2]));

        const chip = page.locator('#fan-legend-chip');
        await expect(chip).toBeVisible();
        await expect(chip).toContainText('Sex');
        await chip.click();
        const sheet = page.locator('#fan-sheet');
        await expect(sheet.getByRole('dialog')).toBeVisible();
        await expect(sheet).toContainText('women');
        await sheet.locator('[data-fan-color="line"]').click();
        await expect(sheet).toContainText("father's father");
        await expect(chip).toContainText('Lines');
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
        await expect(chip).toBeFocused();
    });

    for (const [w, h] of [[390, 844], [844, 390]] as const) {
        test(`German fits the toolbar at ${w}×${h}, also in the two-way shape (1031)`, async ({ page }) => {
            await page.setViewportSize({ width: w, height: h });
            await openFan(page);
            await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
            await page.locator('#fan-toolbar [data-fan-shape="two"]').click();
            await expect(page.locator('#fan-desc-stepper')).toBeVisible();
            const overflow = await page.evaluate(() => {
                const bar = document.getElementById('fan-toolbar')!;
                const r = bar.getBoundingClientRect();
                const out: string[] = [];
                if (bar.scrollWidth > bar.clientWidth + 1) out.push('toolbar scrolls');
                bar.querySelectorAll<HTMLElement>('.fan-shapes, .fan-stepper, .depth-stepper-label, .depth-stepper-btn').forEach(el => {
                    const b = el.getBoundingClientRect();
                    if (b.width === 0) return;
                    if (b.left < r.left - 0.5 || b.right > r.right + 0.5) out.push(el.className);
                });
                return out;
            });
            expect(overflow).toEqual([]);
            await expect(page.locator('#fan-gen-stepper .depth-stepper-label')).toHaveText('Generationen');
        });
    }
});

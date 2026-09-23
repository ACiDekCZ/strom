import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, cardAction } from './helpers.js';

/**
 * Kolo 14 S1 / S4 / N1: the "− n +" depth stepper (focus chip, tablet
 * toolbar, descendants badge), the two-row mobile descendants badge, and the
 * generation labels that keep clear of the chip and toolbar.
 */

/** Jan with two ancestor (optional) and two descendant generations, focused. */
async function buildFamily(page: Page, withAncestors = true): Promise<void> {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    if (withAncestors) {
        await addRelation(page, 'Jan', 'parent', 'Otto', 'Novak');
        await addRelation(page, 'Otto', 'parent', 'Karel', 'Novak');
    }
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await addRelation(page, 'Petr', 'child', 'Emil', 'Novak');
    await cardAction(page, 'Jan', 'focus');
}

/** Numeric option range of a hidden depth select. */
async function selectRange(page: Page, id: string): Promise<{ min: number; max: number }> {
    return page.evaluate((selId) => {
        const sel = document.getElementById(selId) as HTMLSelectElement;
        const vals = Array.from(sel.options).map(o => parseInt(o.value, 10));
        return { min: Math.min(...vals), max: Math.max(...vals) };
    }, id);
}

test('focus chip stepper: no visible select, disabled at min/max, keyboard steps', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await buildFamily(page);

    const chip = page.locator('#focus-controls');
    await expect(chip).toBeVisible();
    // No native select is visible anywhere in the chip.
    const visibleSelects = await chip.locator('select').evaluateAll(els =>
        els.filter(e => (e as HTMLElement).getBoundingClientRect().width > 0).length);
    expect(visibleSelects).toBe(0);

    const up = chip.locator('.depth-stepper').first();
    const dec = up.locator('.depth-stepper-btn[data-step="-1"]');
    const inc = up.locator('.depth-stepper-btn[data-step="1"]');
    const value = up.locator('.depth-stepper-value');
    const { min, max } = await selectRange(page, 'focus-depth-up');
    expect(max).toBeGreaterThan(min);

    // Walk down to the minimum → − disabled, + enabled.
    for (let i = 0; i < 6 && !(await dec.isDisabled()); i++) await dec.click();
    await expect(value).toHaveText(String(min));
    await expect(dec).toBeDisabled();
    await expect(inc).toBeEnabled();
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusDepthUp())).toBe(min);

    // Walk up to the maximum → + disabled.
    for (let i = 0; i < 6 && !(await inc.isDisabled()); i++) await inc.click();
    await expect(value).toHaveText(String(max));
    await expect(inc).toBeDisabled();
    await expect(dec).toBeEnabled();
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusDepthUp())).toBe(max);

    // Keyboard: Tab moves between the stepper buttons; ArrowDown / ArrowUp
    // change the value. Focus lands on − (the only live button at max).
    await dec.focus();
    await page.keyboard.press('ArrowDown');
    await expect(value).toHaveText(String(max - 1));
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusDepthUp())).toBe(max - 1);
    if (max - 1 === min) {
        // − went disabled while focused → focus was handed to +, not lost.
        await expect(inc).toBeFocused();
    } else {
        await page.keyboard.press('Tab');
        await expect(inc).toBeFocused();
    }
    await page.keyboard.press('ArrowUp');
    await expect(value).toHaveText(String(max));
    // + went disabled while focused → focus is handed back to −, not lost.
    await expect(dec).toBeFocused();
});

for (const width of [360, 600]) {
    test(`descendants badge: stepper, no visible select, nothing overflows at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 780 });
        await buildFamily(page, false);
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('descendants'));
        const badge = page.locator('#descendants-badge');
        await expect(badge).toBeVisible();
        await expect(badge.locator('.depth-stepper')).toBeVisible();
        await expect(page.locator('#descendants-depth-down')).toBeHidden();

        const audit = await page.evaluate(() => {
            const b = document.getElementById('descendants-badge')!;
            const br = b.getBoundingClientRect();
            const out: string[] = [];
            if (br.left < 0 || br.right > window.innerWidth) out.push('badge-off-viewport');
            b.querySelectorAll('*').forEach(el => {
                const r = (el as HTMLElement).getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return;
                if (r.left < br.left - 0.5 || r.right > br.right + 0.5
                    || r.top < br.top - 0.5 || r.bottom > br.bottom + 0.5) {
                    out.push((el as HTMLElement).className || el.tagName);
                }
            });
            // The blood-only chip label is never truncated.
            const seg = document.getElementById('descendants-families-toggle')!;
            if (seg.scrollWidth > seg.clientWidth + 1) out.push('seg-truncated');
            return out;
        });
        expect(audit, `width ${width}`).toEqual([]);

        if (width === 360) {
            // Two rows on a phone: the stepper sits below the name.
            const nameBox = await badge.locator('.descendants-badge-name').boundingBox();
            const stepBox = await badge.locator('.depth-stepper').boundingBox();
            expect(stepBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height - 1);
        }
    });
}

for (const width of [1280, 1440]) {
    test(`generation labels never overlap the focus chip or toolbar at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 860 });
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(page.locator('.person-card').first()).toBeVisible();
        await expect(page.locator('#focus-controls')).toBeVisible();

        // Sweep the tree vertically so every band boundary passes under the
        // chip and the toolbar; at each stop audit the visible labels.
        const problems = await page.evaluate(async () => {
            const zp = window.Strom.ZoomPan;
            const rects = window.Strom.TreeRenderer.getCardWorldRects();
            const minY = Math.min(...rects.map(r => r.y));
            const maxY = Math.max(...rects.map(r => r.y + r.h));
            const cx = rects.reduce((s, r) => s + r.x + r.w / 2, 0) / rects.length;
            const container = document.getElementById('tree-container')!.getBoundingClientRect();
            const chip = document.getElementById('focus-controls')!.getBoundingClientRect();
            const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect();
            const hit = (a: DOMRect, b: DOMRect) =>
                a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            const out: string[] = [];
            let checked = 0;
            for (let y = minY - 300; y <= maxY + 300; y += 17) {
                zp.centerOnWorldPoint(cx, y);
                await new Promise(r => requestAnimationFrame(() => r(null)));
                const labels = Array.from(document.querySelectorAll('#gen-labels .gen-label'))
                    .filter(el => (el as HTMLElement).style.display !== 'none'
                        && getComputedStyle(document.getElementById('gen-labels')!).display !== 'none');
                for (const el of labels) {
                    const r = el.getBoundingClientRect();
                    checked++;
                    const name = `${el.textContent} @y=${Math.round(y)}`;
                    if (hit(r, chip)) out.push(`chip: ${name}`);
                    if (hit(r, toolbar)) out.push(`toolbar: ${name}`);
                    if (r.top < chip.bottom + 7.5 && r.left < chip.right && r.right > chip.left) {
                        out.push(`chip-gap: ${name}`);
                    }
                    // Hidden, never clipped: fully inside the canvas.
                    if (r.top < container.top - 0.5 || r.bottom > container.bottom + 0.5) {
                        out.push(`clipped: ${name}`);
                    }
                }
            }
            return { out, checked };
        });
        expect(problems.checked).toBeGreaterThan(0);
        expect(problems.out).toEqual([]);
    });
}

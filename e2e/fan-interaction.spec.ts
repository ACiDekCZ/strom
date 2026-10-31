import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedTree } from './helpers.js';

/**
 * The Fan view's interaction (spec 029 §5, §1.7, §7.2): re-centring with a
 * way back and to the original person, the sector menu (a context menu with
 * a mouse, a bottom sheet after a long press), the first occurrence of a
 * repeated ancestor and the keys.
 */

/**
 * Oskar's grandfather Kaspar and grandmother Greta are siblings: their
 * parents Anton and Lina come twice (no. 8 and 9, again as no. 14 and 15).
 */
const IMPLEX = {
    oskar: { firstName: 'Oskar', lastName: 'Velden', parents: ['emil', 'rosa'] },
    emil: { firstName: 'Emil', lastName: 'Velden', parents: ['kaspar', 'ida'], partners: ['rosa'] },
    rosa: { firstName: 'Rosa', lastName: 'Brakel', gender: 'female' as const, parents: ['bruno', 'greta'], partners: ['emil'] },
    kaspar: { firstName: 'Kaspar', lastName: 'Velden', parents: ['anton', 'lina'], partners: ['ida'] },
    ida: { firstName: 'Ida', lastName: 'Ostring', gender: 'female' as const, partners: ['kaspar'] },
    bruno: { firstName: 'Bruno', lastName: 'Brakel', partners: ['greta'] },
    greta: { firstName: 'Greta', lastName: 'Velden', gender: 'female' as const, parents: ['anton', 'lina'], partners: ['bruno'] },
    anton: { firstName: 'Anton', lastName: 'Velden', partners: ['lina'] },
    lina: { firstName: 'Lina', lastName: 'Sorel', gender: 'female' as const, partners: ['anton'] },
};

async function openImplexFan(page: Page): Promise<void> {
    await openApp(page);
    await seedTree(page, IMPLEX, 'Velden', 'oskar');
    await page.evaluate(() => {
        window.Strom.TreeRenderer.setFanGenerations(4);
        window.Strom.UI.setDisplayViewMode('fan');
    });
    await expect(page.locator('#fan-chart .fan-svg')).toBeVisible();
    await expect(focusDisc(page)).toContainText('Oskar');
}

async function openSampleFan(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(focusDisc(page)).toContainText('Johan');
}

const focusDisc = (page: Page) => page.locator('#fan-chart [data-fan-key="f"]');
const pill = (page: Page) => page.locator('#fan-origin-pill');

/** A screen point inside a sector (by its key), clear of its labels. */
async function keyPoint(page: Page, key: string): Promise<{ x: number; y: number }> {
    const p = await page.evaluate((k) => {
        const g = document.querySelector<SVGGElement>(`#fan-chart [data-fan-key="${k}"]`);
        if (!g) return null;
        const chart = document.getElementById('fan-chart')!.getBoundingClientRect();
        const r = g.getBoundingClientRect();
        const left = Math.max(r.left, chart.left), right = Math.min(r.right, chart.right);
        const top = Math.max(r.top, chart.top), bottom = Math.min(r.bottom, chart.bottom);
        for (let i = 0; i < 9; i++) {
            for (let j = 0; j < 9; j++) {
                const x = left + (right - left) * (0.5 + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * 0.1);
                const y = top + (bottom - top) * (0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.1);
                if (g.contains(document.elementFromPoint(x, y))) return { x, y };
            }
        }
        return null;
    }, key);
    expect(p, `a point inside sector ${key}`).not.toBeNull();
    return p!;
}

/** Wait until no re-centring animation runs (taps are ignored meanwhile). */
async function settled(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('.fan-swap-old').length
        + (document.getElementById('fan-chart')?.getAnimations().length ?? 0))).toBe(0);
}

async function tapKey(page: Page, key: string): Promise<void> {
    await settled(page);
    const p = await keyPoint(page, key);
    await page.mouse.click(p.x, p.y);
}

test('fan: a tap re-centres with an animation, the focus disc steps back (1031)', async ({ page }) => {
    // The suite runs with reduced motion: this test wants the swap.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openImplexFan(page);
    await page.evaluate(() => {
        const w = window as unknown as { __swapSeen: boolean };
        w.__swapSeen = false;
        new MutationObserver(() => { if (document.querySelector('.fan-swap-old')) w.__swapSeen = true; })
            .observe(document.getElementById('fan-stage')!, { childList: true });
    });
    await expect(pill(page)).toBeHidden();
    await expect(page.locator('#fan-chart .fan-back')).toHaveCount(0);

    await tapKey(page, 'a2');
    await expect(focusDisc(page)).toContainText('Emil');
    expect(await page.evaluate(() => (window as unknown as { __swapSeen: boolean }).__swapSeen)).toBe(true);
    await expect(pill(page)).toBeVisible();
    await expect(pill(page)).toHaveAttribute('aria-label', 'Original person: Oskar Velden');
    await expect(page.locator('#fan-chart .fan-back')).toHaveText('↶ back');
    await expect(focusDisc(page).locator('title')).toContainText('Back: Oskar Velden');

    // The disc goes back one step: no way back is left, the pill fades.
    await tapKey(page, 'f');
    await expect(focusDisc(page)).toContainText('Oskar');
    await expect(page.locator('#fan-chart .fan-back')).toHaveCount(0);
    await expect(pill(page)).toBeHidden();
});

test('fan: the original person pill returns and clears the way back; leaving the view forgets it (1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openImplexFan(page);
    await tapKey(page, 'a2');
    await expect(focusDisc(page)).toContainText('Emil');
    await tapKey(page, 'a2');
    await expect(focusDisc(page)).toContainText('Kaspar');
    await expect(pill(page)).toContainText('Oskar Velden');

    await settled(page);
    await pill(page).click();
    await expect(focusDisc(page)).toContainText('Oskar');
    await expect(pill(page)).toBeHidden();
    await expect(page.locator('#fan-chart .fan-back')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFanView()!.getHistory().length)).toBe(0);

    // Another view and back: the fan opens on the current person with no way back.
    await tapKey(page, 'a2');
    await expect(focusDisc(page)).toContainText('Emil');
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('family'));
    await expect(page.locator('#fan-container')).toBeHidden();
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
    await expect(focusDisc(page)).toContainText('Emil');
    await expect(pill(page)).toBeHidden();
    await expect(page.locator('#fan-chart .fan-back')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFanView()!.getOrigin())).toBe('emil');
});

test('fan: the right click menu re-centres, opens the detail and the page; Esc puts the focus back (1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openImplexFan(page);
    const menu = page.locator('.fan-menu');

    let p = await keyPoint(page, 'a3');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('.fan-menu-head')).toContainText('Rosa Brakel');
    await expect(menu.locator('.fan-menu-head')).toContainText('no. 3');
    await expect(menu.locator('[role="menuitem"]')).toHaveText(['Re-centreEnter', 'Person details', 'Person page']);
    // At the cursor (+10 px).
    const left = await menu.evaluate(el => parseFloat(el.style.left));
    expect(Math.abs(left - (p.x + 10))).toBeLessThan(2);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-fan-key'))).toBe('a3');

    await page.mouse.click(p.x, p.y, { button: 'right' });
    await menu.locator('[data-fan-menu="detail"]').click();
    await expect(page.locator('#person-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#person-modal')).toBeHidden();

    await page.mouse.click(p.x, p.y, { button: 'right' });
    await menu.locator('[data-fan-menu="page"]').click();
    await expect(page.locator('#person-page-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#person-page-modal')).toHaveCount(0);

    // The focus disc has no "Re-centre"; a click outside closes the menu without a tap.
    p = await keyPoint(page, 'f');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(menu.locator('[role="menuitem"]')).toHaveText(['Person details', 'Person page']);
    await expect(menu.locator('.fan-menu-head')).toContainText('no. 1');
    const a2 = await keyPoint(page, 'a2');
    await page.mouse.click(a2.x, a2.y);
    await expect(menu).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(focusDisc(page)).toContainText('Oskar');

    p = await keyPoint(page, 'a3');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await menu.locator('[data-fan-menu="recenter"]').click();
    await expect(focusDisc(page)).toContainText('Rosa');
});

test('fan: a long name in the menu header wraps instead of being cut (1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await seedTree(page, { ...IMPLEX, rosa: { ...IMPLEX.rosa, firstName: 'Wilhelmina', lastName: 'Quellbach-Tarnholm' } }, 'Velden', 'oskar');
    await page.evaluate(() => {
        window.Strom.TreeRenderer.setFanGenerations(4);
        window.Strom.UI.setDisplayViewMode('fan');
    });
    await expect(focusDisc(page)).toContainText('Oskar');
    const p = await keyPoint(page, 'a3');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const name = page.locator('.fan-menu .fan-menu-name');
    await expect(name).toHaveText('Wilhelmina Quellbach-Tarnholm');
    expect(await name.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= el.closest('.fan-menu')!.getBoundingClientRect().right)).toBe(true);
});

test('fan: a repeated ancestor shows its first occurrence, outlined and panned into view (1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openImplexFan(page);
    await expect(page.locator('#fan-chart [data-fan-key="a14"]')).toHaveAttribute('data-fan-repeat-of', 'a8');

    // Hover on the repeat outlines the first occurrence.
    let p = await keyPoint(page, 'a14');
    await page.mouse.move(p.x, p.y);
    await expect(page.locator('#fan-chart .fan-mark-hint')).toHaveCount(1);
    await page.mouse.move(5, 5);

    // Zoomed in on the repeat: the first occurrence lies outside the view.
    await page.evaluate(() => {
        const v = window.Strom.TreeRenderer.getFanView()!;
        const s = v.getModel()!.sectors.find(x => x.key === 'a14')!;
        const r = (s.r1 + s.r2) / 2, a = ((s.lo + s.hi) / 2) * Math.PI / 180;
        v.getZoom()!.setView({ z: 6, cx: r * Math.cos(a), cy: -r * Math.sin(a) });
    });
    const before = (await page.locator('#fan-chart .fan-svg').getAttribute('viewBox'))!.split(' ').map(Number);
    p = await keyPoint(page, 'a14');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(page.locator('.fan-menu [role="menuitem"]').last()).toHaveText('Show first occurrence (no. 8)');
    await page.locator('.fan-menu [data-fan-menu="first"]').click();
    await expect(page.locator('#fan-chart .fan-mark')).toHaveCount(1);
    await expect.poll(async () => {
        const vb = (await page.locator('#fan-chart .fan-svg').getAttribute('viewBox'))!.split(' ').map(Number);
        return Math.abs(vb[0] - before[0]) > before[2] * 0.5 && Math.abs(vb[2] - before[2]) < 0.5;
    }).toBe(true);
    // The outline goes after 1.8 s.
    await expect(page.locator('#fan-chart .fan-mark')).toHaveCount(0, { timeout: 4000 });
});

test('fan: keys move between sectors, Enter re-centres, Backspace steps back, Shift+F10 opens the menu (1031)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openImplexFan(page);
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-fan-key') ?? document.activeElement?.id);

    await page.locator('#fan-chart').focus();
    // Arrows on the stage itself pan the view.
    const vb0 = await page.locator('#fan-chart .fan-svg').getAttribute('viewBox');
    await page.keyboard.press('+');
    await expect.poll(() => page.locator('#fan-chart .fan-svg').getAttribute('viewBox')).not.toBe(vb0);
    await page.keyboard.press('0');

    await page.keyboard.press('Tab');
    await expect.poll(active).toBe('f');
    await expect(page.locator('#fan-chart [tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('ArrowUp');
    await expect.poll(active).toBe('a2');
    await page.keyboard.press('ArrowRight');
    await expect.poll(active).toBe('a3');
    await page.keyboard.press('ArrowDown');
    await expect.poll(active).toBe('f');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect.poll(active).toBe('a4');
    await expect(page.locator('#fan-chart [data-fan-key="a4"]')).toHaveAttribute('tabindex', '0');

    await page.keyboard.press('Enter');
    await expect(focusDisc(page)).toContainText('Kaspar');
    await expect.poll(active).toBe('f');
    await settled(page);
    await page.keyboard.press('Backspace');
    await expect(focusDisc(page)).toContainText('Oskar');

    await settled(page);
    await page.keyboard.press('ArrowUp');
    await expect.poll(active).toBe('a2');
    await page.keyboard.press('Shift+F10');
    await expect(page.locator('.fan-menu')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-fan-menu'))).toBe('recenter');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-fan-menu'))).toBe('detail');
    await page.keyboard.press('Escape');
    await expect(page.locator('.fan-menu')).toHaveCount(0);
    await expect.poll(active).toBe('a2');
});

test('fan: with reduced motion the fans swap at once (1031)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });  // the suite's default, stated
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSampleFan(page);
    await page.evaluate(() => {
        const w = window as unknown as { __swapSeen: boolean };
        w.__swapSeen = false;
        new MutationObserver(() => { if (document.querySelector('.fan-swap-old')) w.__swapSeen = true; })
            .observe(document.getElementById('fan-stage')!, { childList: true });
    });
    const p = await keyPoint(page, 'a2');
    await page.mouse.click(p.x, p.y);
    await expect(focusDisc(page)).toContainText('Peter');
    expect(await page.evaluate(() => (window as unknown as { __swapSeen: boolean }).__swapSeen)).toBe(false);
    expect(await page.evaluate(() => document.getElementById('fan-chart')!.getAnimations().length)).toBe(0);
    // Straight back (no animation to wait for).
    await page.keyboard.press('Backspace');
    await expect(focusDisc(page)).toContainText('Johan');
});

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    /** Hold a finger on a sector until its sheet opens, then lift it. */
    async function longPress(page: Page, key: string): Promise<void> {
        const p = await keyPoint(page, key);
        const fire = (type: string) => page.evaluate(({ type, x, y }) => {
            const el = document.elementFromPoint(x, y) ?? document.getElementById('fan-chart')!;
            el.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 }));
        }, { type, ...p });
        await fire('pointerdown');
        await expect(page.locator('.fan-menu-sheet .bottom-sheet')).toBeVisible();
        await fire('pointerup');
    }

    test('fan: a long press opens the sector sheet; Details and Page open the person (1031)', async ({ page }) => {
        await openImplexFan(page);
        await longPress(page, 'a2');
        const sheet = page.locator('.fan-menu-sheet .bottom-sheet');
        await expect(sheet.locator('.bottom-sheet-menu-title')).toHaveText('Emil Velden');
        await expect(sheet.locator('.bottom-sheet-menu-sub')).toContainText('no. 2');
        await expect(sheet.locator('.bottom-sheet-item')).toHaveText(['Re-centre', 'Person details', 'Person page', 'Cancel']);
        await expect(page.locator('.fan-press-ring')).toBeVisible();

        await sheet.locator('#fan-menu-cancel').click();
        await expect(sheet).toHaveCount(0);
        await expect(page.locator('.fan-press-ring')).toHaveCount(0);
        await expect(focusDisc(page)).toContainText('Oskar');

        await longPress(page, 'a2');
        await page.locator('#fan-menu-detail').click();
        await expect(page.locator('#person-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-modal')).toBeHidden();

        await longPress(page, 'a2');
        await page.locator('#fan-menu-page').click();
        await expect(page.locator('#person-page-modal')).toBeVisible();
    });
});

for (const [w, h] of [[390, 844], [844, 390], [800, 1100], [1440, 900]]) {
    test(`fan: the original person pill stays clear of the evidence pill, the chip and the toolbar at ${w}×${h} (1031)`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await openImplexFan(page);
        await page.evaluate(() => {
            window.Strom.UI.showEvidenceLevels();
            window.Strom.TreeRenderer.setFocus('kaspar' as never);
        });
        await expect(page.locator('#evidence-pill')).toBeVisible();
        await expect(pill(page)).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
            const rect = (sel: string) => {
                const el = document.querySelector<HTMLElement>(sel);
                if (!el || el.offsetParent === null) return null;
                const r = el.getBoundingClientRect();
                return r.width > 0 ? r : null;
            };
            const p = rect('#fan-origin-pill')!;
            const hits = ['#fan-legend-chip', '#fan-legend', '#fan-zoom-controls', '#evidence-pill', '#live-follow-pill', '#fan-toolbar']
                .filter(sel => {
                    const o = rect(sel);
                    return o && p.left < o.right && p.right > o.left && p.top < o.bottom && p.bottom > o.top;
                });
            return p.right <= window.innerWidth ? hits : ['off screen'];
        })).toEqual([]);
    });
}

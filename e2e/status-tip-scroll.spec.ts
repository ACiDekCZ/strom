import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The status tip of a card's mark (the step, its sources, "Sources of the
 * person (N) ›", "What the marks mean") shows no scrollbar while its content
 * fits: never a horizontal one (long source titles wrap), a vertical one only
 * when it is taller than the window. Under the mark and above it, on a
 * desktop and a phone. Invented data.
 */

function ged(sources: number, longTitles: boolean): string {
    const title = (i: number) => longTitles
        ? (i % 2 ? `Matrika narozených, oddaných a zemřelých farnosti Dolní Bramborov 1784–1850, svazek ${i}`
            : `Sbírka_listin_velkostatku_Dolní_Bramborov_inventární_číslo_${i}_karton_${i * 7}`)
        : `Matrika ${i}`;
    const lines = ['0 HEAD', '1 SOUR STROM_RESEARCH', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'];
    for (let i = 1; i <= sources; i++) lines.push(`0 @S${i}@ SOUR`, `1 TITL ${title(i)}`, `1 REFN S${String(i).padStart(4, '0')}`);
    lines.push('0 @I1@ INDI', '1 NAME Bonifác /Kvapilík/', '1 SEX M', '1 REFN P0001',
        '1 BIRT', '2 DATE 3 FEB 1850', '2 PLAC Dolní Bramborov', '2 _STROM_STATUS proven');
    for (let i = 1; i <= sources; i++) lines.push(`2 SOUR @S${i}@`, `3 PAGE fol. ${i}`);
    lines.push('1 DEAT', '2 DATE 1912', '2 _STROM_STATUS proven', '2 SOUR @S1@', '3 PAGE fol. 99');
    for (let i = 1; i <= sources; i++) lines.push(`1 SOUR @S${i}@`, `2 PAGE s. ${i}`);
    lines.push('0 TRLR');
    return lines.join('\n');
}

async function setup(page: Page, content: string): Promise<void> {
    await openApp(page);
    const dataTransfer = await page.evaluateHandle((text) => {
        const dt = new DataTransfer();
        dt.items.add(new File([text], 'kvapilik.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
    await expect(card(page, 'Bonifác')).toBeVisible();
}

/** The card's mark clicked: its tip, how far its content overflows it, and whether it is taller than the window. */
async function openTip(page: Page): Promise<{ x: number; y: number; tooTall: boolean; above: boolean }> {
    const mark = card(page, 'Bonifác').locator(':scope > .card-status-mark[data-mark="status"]');
    await mark.click();
    const tip = page.locator('#status-tip');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.st-help')).toBeVisible();
    return tip.evaluate((outer) => {
        // The bubble itself never scrolls (its arrow and bridge stand outside it); its content box does, only when it must.
        const css = getComputedStyle(outer);
        if (css.overflowX !== 'visible' || css.overflowY !== 'visible') return { x: 999, y: 999, tooTall: false, above: false };
        const el = outer.querySelector<HTMLElement>(':scope > .st-scroll')!;
        const all = el.scrollHeight + (outer.offsetHeight - el.clientHeight);
        // Nothing in it wider than the box, even where the box would clip it.
        const wide = [...el.querySelectorAll<HTMLElement>('*')].some(c => c.getBoundingClientRect().right > el.getBoundingClientRect().right + 0.5);
        return {
            x: Math.max(el.scrollWidth - el.clientWidth, wide ? 1 : 0), y: el.scrollHeight - el.clientHeight,
            tooTall: all > window.innerHeight - 16, above: outer.classList.contains('st-above'),
        };
    });
}

for (const [name, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]] as const) {
    test.describe(`the card mark's tip on a ${name}`, () => {
        test.use({ viewport: { width, height } });

        for (const [list, n, long] of [['short list', 2, false], ['long titles', 4, true], ['long list', 14, true]] as const) {
            test(`${list}: no horizontal scrollbar, a vertical one only when it does not fit`, async ({ page }) => {
                await setup(page, ged(n, long));
                for (const side of ['below', 'above'] as const) {
                    if (side === 'above') {
                        // The card near the window's bottom: the tip opens above its mark.
                        await card(page, 'Bonifác').evaluate((el) => {
                            const r = el.getBoundingClientRect();
                            const bar = document.getElementById('bottom-bar')?.getBoundingClientRect();
                            const floor = bar && bar.height > 0 ? Math.min(bar.top, window.innerHeight) : window.innerHeight;
                            const zoom = window.Strom.ZoomPan;
                            zoom.shiftWorld(0, -(floor - r.bottom - 12) / zoom.getScale());
                        });
                    }
                    const o = await openTip(page);
                    if (side === 'above' && n === 2) expect(o.above, 'the tip opens above its mark').toBe(true);
                    expect(o.x, `${side}: no horizontal overflow`).toBeLessThanOrEqual(0);
                    if (!o.tooTall) expect(o.y, `${side}: no vertical overflow while it fits`).toBeLessThanOrEqual(0);
                    await page.keyboard.press('Escape');
                    await expect(page.locator('#status-tip')).toBeHidden();
                }
            });
        }
    });
}

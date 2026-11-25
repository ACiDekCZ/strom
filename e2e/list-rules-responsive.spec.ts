/**
 * The screens of custom list rules at every size (spec 136 §14): the builder
 * with three levels, Family of a person and a place with its surroundings
 * (the long name "Bětka Ostrovidová-Quellmayerová" and a long place name),
 * the catalog of conditions, the template menu, the person choice, a row's ⋯
 * and the list's detail with the rule in words and its origin - at 390 × 844
 * (touch), 1024 × 768, 1440 × 900 and a phone held sideways (844 × 390), light
 * and dark, English and German. Nothing is wider inside than its box
 * (scrollWidth), the parts of a row do not overlap, the page does not scroll
 * sideways and a phone's controls are at least 44 px high. On a computer each
 * menu is checked open (its button scrolled into view first, as a scroll of the
 * dialog closes it) and styled as a menu: its rows span its width, left
 * aligned, with no frame and no fill; the catalog's search is the flat field
 * on top. The German shots
 * at 1440, 1024 and 390, light and dark, go to SHOTS when it is set (the
 * review folder; test-results is wiped at every run). Invented names only.
 */

import { test, expect, Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { form, lists, openList, overflowing, overlapping, seedFamily, LONG_NAME, LONG_PLACE } from './list-rules-seed';

const SHOTS = process.env.STROM_LIST_RULES_SHOTS ?? '';

const SIZES = [
    { name: '390', viewport: { width: 390, height: 844 }, touch: true },
    { name: '1024', viewport: { width: 1024, height: 768 }, touch: false },
    { name: '1440', viewport: { width: 1440, height: 900 }, touch: false },
    { name: 'sideways', viewport: { width: 844, height: 390 }, touch: true },
] as const;

const ROW_PARTS = '.plr-row .plr-n, .plr-row .plr-pick, .plr-row .plr-k, .plr-row .plr-k2, .plr-row .plr-d, .plr-row .plr-s, .plr-row .sel-seg';

async function shot(page: Page, name: string): Promise<void> {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function noOverflow(page: Page, root: string, width: number): Promise<void> {
    expect(await overflowing(page, root), `${root} wider inside than its box`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

/** Buttons of `root` whose tap area is lower than 44 px (a phone's touch targets). */
async function smallTargets(page: Page, root: string): Promise<string[]> {
    return page.evaluate((sel) => Array.from(document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} [role="menuitem"]`))
        .filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
        .map(b => {
            // A tap area wider than the button (an absolute ::after reaching past it) counts.
            const a = getComputedStyle(b, '::after');
            const out = a.content !== 'none' && a.position === 'absolute' ? Math.max(0, -parseFloat(a.top) || 0) + Math.max(0, -parseFloat(a.bottom) || 0) : 0;
            return [b, b.getBoundingClientRect().height + out] as const;
        })
        .filter(([, h]) => h > 0 && h < 43.5)
        .map(([b, h]) => `${b.className || b.tagName} "${(b.textContent ?? '').trim().slice(0, 30)}" ${Math.round(h)}px`), root);
}

/** Waits until `el` stays put for three frames (a scroll or a sheet sliding in is over). */
async function settled(el: Locator): Promise<void> {
    await el.evaluate(node => new Promise<void>(done => {
        const at = (): string => { const r = node.getBoundingClientRect(); return `${r.left},${r.top},${r.width},${r.height}`; };
        let last = at();
        let still = 0;
        const step = (): void => {
            const now = at();
            if (now === last) still += 1; else { still = 0; last = now; }
            if (still >= 3) done(); else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }));
}

/**
 * Opens a menu by its button the way a person does: the button is scrolled
 * into view first and left to settle, as a scroll of the dialog closes an open
 * menu (a click that scrolled would show the menu only for a moment); then the
 * menu (a phone's sheet slides in) settles.
 */
async function openMenu(page: Page, button: Locator, menu: string): Promise<void> {
    await button.scrollIntoViewIfNeeded();
    await settled(button);
    await button.click();
    await expect(page.locator(menu)).toBeVisible();
    await settled(page.locator(menu));
}

/**
 * What is wrong with the look of the open computer menu `sel` (spec 136 §3,
 * §7): every row (not the hovered, focused or open one) spans the menu's inner
 * width, is left aligned, has no frame and no fill and the text colour; a
 * search field is the flat 34 px field across the top.
 */
async function menuFaults(page: Page, sel: string): Promise<string[]> {
    return page.evaluate((s) => {
        const menu = document.querySelector<HTMLElement>(s);
        if (!menu) return ['no open menu'];
        const out: string[] = [];
        const ms = getComputedStyle(menu);
        const inner = menu.clientWidth - parseFloat(ms.paddingLeft) - parseFloat(ms.paddingRight);
        const probe = document.createElement('span');
        probe.style.color = 'var(--text)';
        menu.appendChild(probe);
        const text = getComputedStyle(probe).color;
        probe.remove();
        const rows = Array.from(menu.querySelectorAll<HTMLElement>('.pl-menu-item'))
            .filter(r => r.getClientRects().length && !r.matches(':hover, :focus, .is-open, .is-danger, [aria-disabled="true"]'));
        if (!rows.length) out.push('no rows');
        for (const r of rows) {
            const cs = getComputedStyle(r);
            const name = `"${(r.textContent ?? '').trim().slice(0, 24)}"`;
            if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') out.push(`${name} filled ${cs.backgroundColor}`);
            if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0) out.push(`${name} framed ${cs.borderTopWidth} ${cs.borderTopStyle}`);
            if (cs.textAlign !== 'left' && cs.textAlign !== 'start') out.push(`${name} aligned ${cs.textAlign}`);
            if (cs.color !== text) out.push(`${name} colour ${cs.color} ≠ ${text}`);
            const w = (r.closest<HTMLElement>('.plr-mrow') ?? r).getBoundingClientRect().width;
            if (Math.abs(w - inner) > 1.5) out.push(`${name} ${Math.round(w)} px wide in a menu of ${Math.round(inner)} px`);
        }
        const search = menu.querySelector<HTMLElement>('.pl-msearch');
        if (search) {
            const cs = getComputedStyle(search);
            if (parseFloat(cs.borderTopWidth) > 0) out.push(`search framed ${cs.borderTopWidth} ${cs.borderTopStyle}`);
            if (Math.abs(parseFloat(cs.height) - 34) > 0.5) out.push(`search ${cs.height} high`);
            if (Math.abs(search.getBoundingClientRect().width - menu.clientWidth) > 1.5) out.push(`search ${Math.round(search.getBoundingClientRect().width)} px wide in a menu of ${menu.clientWidth} px`);
        }
        return out;
    }, sel);
}

for (const size of SIZES) {
    for (const scheme of ['light', 'dark'] as const) {
        test.describe(`Custom rules at ${size.name}, ${scheme}`, () => {
            test.use({ viewport: size.viewport, colorScheme: scheme, hasTouch: size.touch, isMobile: size.touch && size.viewport.width < 640 });

            for (const lang of ['en', 'de'] as const) {
                test(`${lang}: the builder with three levels, the catalog, the menus and the detail fit`, async ({ page }) => {
                    await seedFamily(page, lang);
                    const w = size.viewport.width;
                    const tag = `${lang}-${size.name}-${scheme}`;
                    const keep = lang === 'de' && size.name !== 'sideways';
                    // A phone and a phone held sideways choose in a sheet from below.
                    const menu = size.touch ? '.plr-sheet' : '.plr-menu';

                    // The detail: the rule in words, the origin.
                    await openList(page, 'l-wide');
                    const d = lists(page);
                    await expect(d.locator('.pl-rule-v')).toContainText(LONG_NAME);
                    await expect(d.locator('.pl-origin')).toBeVisible();
                    await noOverflow(page, '#person-lists-modal', w);
                    if (keep) await shot(page, `seznamy-detail-${tag}`);

                    // The builder: three levels, Family of a person with the long name, the long place.
                    await d.locator('.pl-rule [data-act="edit-rule"], .pl-rule [data-act="whole-rule"]').first().click();
                    const f = form(page);
                    await expect(f.locator('.plr-row[data-path="1.1"]')).toBeVisible();
                    await expect(f.locator('.plr-row[data-path="0"] [data-pc="person"]')).toContainText(LONG_NAME);
                    await expect(f.locator('.plr-row[data-path="1.0"]')).toContainText(LONG_PLACE);
                    await noOverflow(page, '#person-list-new', w);
                    expect(await overlapping(page, '#person-list-new', ROW_PARTS), 'parts of a row overlap').toEqual([]);
                    if (size.touch) expect(await smallTargets(page, '#person-list-new .plr')).toEqual([]);
                    // A checkbox beside its word, not above it.
                    const chk = await f.locator('.plr-row[data-path="1.0"] .plr-chk').first().evaluate(l => {
                        const a = l.querySelector('input')!.getBoundingClientRect();
                        const b = l.getBoundingClientRect();
                        return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2);
                    });
                    expect(chk).toBeLessThan(2);
                    if (keep) await shot(page, `seznamy-builder-${tag}`);

                    // The bottom of the builder (a phone scrolls).
                    await f.locator('.plr-row[data-path="1.1.1"]').scrollIntoViewIfNeeded();
                    await noOverflow(page, '#person-list-new', w);
                    if (keep && w < 640) await shot(page, `seznamy-builder-dole-${tag}`);

                    // The person choice and a row's ⋯.
                    await f.locator('.plr-row[data-path="0"] [data-pc="person"]').click();
                    await expect(page.locator('.tov-pop')).toBeVisible();
                    await noOverflow(page, '.tov-pop', w);
                    await page.keyboard.press('Escape');
                    await expect(page.locator('.tov-pop')).toHaveCount(0);
                    await openMenu(page, f.locator('.plr-row[data-path="1.0"] > .plr-d'), menu);
                    await noOverflow(page, menu, w);
                    if (!size.touch) expect(await menuFaults(page, menu), 'a row\'s ⋯ styled as a menu').toEqual([]);
                    await page.keyboard.press('Escape');
                    // Escape closes the menu (a phone's sheet too) and not the builder under it.
                    await expect(page.locator(menu)).toHaveCount(0);
                    await expect(f).toBeVisible();

                    // The catalog of conditions.
                    await openMenu(page, f.locator('.plr > .plr-add [data-rb="add"]'), menu);
                    await noOverflow(page, menu, w);
                    if (size.touch) expect(await smallTargets(page, menu)).toEqual([]);
                    else expect(await menuFaults(page, menu), 'the catalog styled as a menu').toEqual([]);
                    if (keep) await shot(page, `seznamy-katalog-${tag}`);
                    // Still open after the shot: nothing scrolled the dialog under it.
                    await expect(page.locator(menu)).toBeVisible();
                    await page.keyboard.press('Escape');
                    await page.evaluate(() => window.Strom.UI.closeNewPersonList());

                    // A new list: the template menu.
                    await page.evaluate(() => window.Strom.UI.showNewPersonList());
                    await expect(f).toBeVisible();
                    await openMenu(page, f.locator('.pln-tbtn'), menu);
                    await noOverflow(page, menu, w);
                    if (!size.touch) expect(await menuFaults(page, menu), 'the template menu styled as a menu').toEqual([]);
                    if (keep) await shot(page, `seznamy-sablony-${tag}`);
                    await expect(page.locator(menu)).toBeVisible();
                });
            }
        });
    }
}

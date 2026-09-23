import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * Dialogs whose header is a bare <h2> — the confirm box, the event editor,
 * every form-modal — keep that heading as a direct child of .modal. The shared
 * skeleton drops the modal's own padding (header and body bring their own), so
 * the bare heading alone lost its inset and sat flush against the panel edge,
 * in the rounded corner, while the text under it was properly indented.
 */
async function insets(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const modal = document.querySelector('#confirmation-modal .modal') as HTMLElement;
        const title = document.getElementById('confirm-title') as HTMLElement;
        const message = document.getElementById('confirm-message') as HTMLElement;
        const panel = modal.getBoundingClientRect();
        // A block heading fills the width, so its box says nothing about where
        // the text starts — measure the glyphs.
        const range = document.createRange();
        range.selectNodeContents(title);
        const text = range.getBoundingClientRect();
        return {
            title: Math.round(text.x - panel.x),
            titleTop: Math.round(text.y - panel.y),
            message: Math.round(message.getBoundingClientRect().x - panel.x),
        };
    });
}

for (const [label, width] of [['mobile', 420], ['tablet', 700], ['desktop', 1200]] as const) {
    test(`dialog title lines up with the dialog body (${label})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 760 });
        await openApp(page);
        await page.evaluate(() => {
            window.Strom.UI.showConfirm('Zkontrolovali jsme data.', 'Kontrola dat',
                { ok: 'Zobrazit', cancel: 'Zavrit' });
        });
        await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);

        const m = await insets(page);
        expect(m.title, 'title text starts at the same inset as the body').toBe(m.message);
        expect(m.title, 'and is not flush against the panel edge').toBeGreaterThan(8);
        expect(m.titleTop, 'nor against the top edge').toBeGreaterThan(8);
    });
}

/**
 * Dialog rules (round 14, S6): three widths, footers only for actions (the
 * header × closes), at most one primary button and it sits last (bottom right).
 */
// The person modal keeps its own 560px.
const WIDTH_EXEMPT = new Set(['person-modal']);

test('every dialog has one of the three width classes', async ({ page }) => {
    await openApp(page);
    const missing = await page.evaluate((exempt) => {
        return Array.from(document.querySelectorAll('.modal-overlay'))
            .filter(o => !exempt.includes(o.id))
            .filter(o => {
                const m = o.querySelector(':scope > .modal');
                return m && !/\bmodal--(sm|md|lg)\b/.test(m.className);
            })
            .map(o => o.id);
    }, [...WIDTH_EXEMPT]);
    expect(missing).toEqual([]);
});

test('no dialog footer carries a Close button, and one primary sits last', async ({ page }) => {
    await openApp(page);
    const problems = await page.evaluate(() => {
        const out: string[] = [];
        const footers = '.buttons, .modal-buttons, .pm-footer, .tree-manager-footer, .wiz-actions';
        document.querySelectorAll('.modal-overlay').forEach(o => {
            const hasX = !!o.querySelector('.close-btn');
            o.querySelectorAll(footers).forEach(f => {
                const btns = Array.from(f.querySelectorAll(':scope > button, :scope > a, :scope > span > button'));
                if (hasX && btns.some(b => /^(Close|Zavřít|Schließen)$/.test((b.textContent || '').trim()))) {
                    out.push(`${o.id}: footer Close`);
                }
                const prim = btns.filter(b => b.classList.contains('primary') || b.classList.contains('btn-primary'));
                if (prim.length > 1) out.push(`${o.id}: ${prim.length} primaries`);
                if (prim.length === 1 && btns[btns.length - 1] !== prim[0]) out.push(`${o.id}: primary not last`);
            });
        });
        return out;
    });
    expect(problems).toEqual([]);
});

test('the confirm dialog is the small width and its title keeps the 20px/24px inset', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await page.evaluate(() => { void window.Strom.UI.showConfirm('m', 't'); });
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    const m = await page.evaluate(() => {
        const modal = document.querySelector('#confirmation-modal .modal') as HTMLElement;
        const h = getComputedStyle(document.getElementById('confirm-title')!);
        return { width: Math.round(modal.getBoundingClientRect().width), pad: `${h.paddingTop} ${h.paddingRight} ${h.paddingBottom} ${h.paddingLeft}` };
    });
    expect(m.width).toBe(440);
    expect(m.pad).toBe('20px 24px 0px 24px');
});

test('tree manager: New tree is the only primary, rows offer "Open at startup"', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();
    const footer = manager.locator('.tree-manager-footer');
    await expect(footer.locator('button.primary')).toHaveCount(1);
    await expect(footer.locator('button').last()).toHaveClass(/primary/);
    await expect(footer).not.toContainText('Default tree');

    const more = manager.locator('.tree-row-menu-btn').first();
    await expect(more).toHaveAttribute('aria-label', 'More actions');
    await more.click();
    const toggle = manager.locator('.tree-startup-toggle').first();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    const id = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    expect(await page.evaluate(() => window.Strom.TreeManager.getDefaultTree())).toBe(id);
    await manager.locator('.tree-row-menu-btn').first().click();
    await expect(manager.locator('.tree-startup-toggle').first()).toHaveAttribute('aria-checked', 'true');
});

test('surname spellings: Link is the footer primary, typed spellings use an Add button', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showSurnamesDialog());
    const modal = page.locator('#surnames-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal-buttons #surnames-link')).toHaveClass(/primary/);
    await expect(modal.locator('.modal-buttons button')).toHaveCount(1);
    await expect(modal.locator('#surname-other-add')).toHaveText('Add');
    await expect(modal.locator('.surnames-none .empty-block-title')).toBeVisible();
});

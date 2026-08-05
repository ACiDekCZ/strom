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

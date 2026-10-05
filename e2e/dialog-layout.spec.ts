import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card } from './helpers.js';

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

// Desktop is checked in "the confirm dialog is the small width…" below.
for (const [label, width] of [['mobile', 420], ['tablet', 700]] as const) {
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

/**
 * Dialog kinds (dialogs unification): every dialog declares data-dialog-kind.
 * form / info / choice / picker: a header × AND exactly one footer button
 * [data-dismiss] — "Close" for info, "Cancel" otherwise — standing right
 * before the single primary (or last when there is none). Decisions have no ×.
 */
async function dialogRuleProblems(page: import('@playwright/test').Page): Promise<string[]> {
    return page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('.modal-overlay').forEach(o => {
            const modal = o.querySelector(':scope > .modal');
            if (!modal) return;
            const id = o.id || '(no id)';
            const kind = modal.getAttribute('data-dialog-kind');
            if (!kind) { out.push(`${id}: no data-dialog-kind`); return; }
            const hasX = !!modal.querySelector('.close-btn');
            const prim = Array.from(modal.querySelectorAll('.buttons .primary, .buttons .btn-primary'));
            if (prim.length > 1) out.push(`${id}: ${prim.length} primaries`);
            if (kind === 'decision') {
                if (hasX) out.push(`${id}: decision with ×`);
                return;
            }
            if (!['form', 'info', 'choice', 'picker'].includes(kind)) { out.push(`${id}: unknown kind ${kind}`); return; }
            if (!hasX) out.push(`${id}: no ×`);
            const dismiss = Array.from(modal.querySelectorAll('.buttons [data-dismiss]'));
            if (dismiss.length !== 1) { out.push(`${id}: ${dismiss.length} [data-dismiss]`); return; }
            const d = dismiss[0] as HTMLElement;
            const want = kind === 'info' ? 'Close' : 'Cancel';
            if ((d.textContent || '').trim() !== want) out.push(`${id}: dismiss says "${(d.textContent || '').trim()}", want ${want}`);
            if (!d.classList.contains('secondary')) out.push(`${id}: dismiss not secondary`);
            const next = d.nextElementSibling;
            if (prim.length === 1 ? next !== prim[0] : next !== null) out.push(`${id}: dismiss not right before the primary / last`);
        });
        return out;
    });
}

test('every dialog follows its kind: ×, one Close|Cancel before the primary', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    const janId = await card(page, 'Jan').getAttribute('data-id');
    const petrId = await card(page, 'Petr').getAttribute('data-id');
    // Built-per-open dialogs: open each, check, close.
    const dynamic: Array<[string, string]> = [
        ['kinship-modal', `window.Strom.UI.showRelationshipCalculator('${janId}')`],
        ['archives-modal', `window.Strom.UI.showArchiveSearch('${janId}')`],
        ['surnames-modal', 'window.Strom.UI.showSurnamesDialog()'],
        ['split-modal', 'window.Strom.UI.showSplitDialog()'],
        ['reassign-modal', `window.Strom.UI.openReassignPicker('${petrId}', '${janId}', 'parent')`],
        ['research-info-modal', 'window.Strom.UI.showResearchInfoDialog()'],
        ['person-sources-modal', `window.Strom.UI.showPersonSourcesDialog('${janId}')`],
        ['person-story-modal', `window.Strom.UI.showPersonStoryDialog('${janId}')`],
    ];
    await page.evaluate((id) => window.Strom.DataManager.updatePerson(id, { story: { text: 'Kovar.' } }), janId!);
    expect(await dialogRuleProblems(page)).toEqual([]);
    for (const [id, open] of dynamic) {
        await page.evaluate(open);
        await expect(page.locator(`#${id}`), id).toBeVisible();
        expect(await dialogRuleProblems(page), id).toEqual([]);
        // Its footer Close/Cancel runs the dialog's own close (a click on
        // the title first folds away an open person-picker list).
        await page.locator(`#${id} .modal-header h2`).click();
        await page.locator(`#${id} [data-dismiss]`).click();
        await expect(page.locator(`#${id}`), id).toBeHidden();
    }
});

test('info dialogs close on the backdrop and on Close; forms ignore the backdrop', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    // Info: backdrop click closes.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const settings = page.locator('#settings-modal');
    await expect(settings).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(settings).toBeHidden();
    // Info: the footer Close closes, and so does Escape.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await settings.locator('[data-dismiss]').click();
    await expect(settings).toBeHidden();
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    // Form: a backdrop click keeps it open.
    await page.evaluate(() => window.Strom.UI.showNewTreeDialog());
    const form = page.locator('#new-tree-modal');
    await expect(form).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(form).toBeVisible();
    await form.locator('[data-dismiss]').click();
    await expect(form).toBeHidden();
});

test('a decision without a "leave it" option ignores Escape', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => document.getElementById('newer-version-storage-modal')!.classList.add('active'));
    const modal = page.locator('#newer-version-storage-modal');
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeVisible();
});

// 600px is a phone too (the phone band runs to 640px, like the phone chrome).
for (const [id, width] of [['storage-status-modal', 360], ['storage-status-modal', 600]] as const) {
    test(`${width}px: ${id} footer stacks full width, primary on top`, async ({ page }) => {
        await page.setViewportSize({ width, height: 740 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate((dialog) => {
            if (dialog === 'tree-manager-modal') void window.Strom.UI.showTreeManagerDialog();
            else void window.Strom.UI.showStorageStatusDialog();
        }, id);
        const modal = page.locator(`#${id}`);
        await expect(modal).toBeVisible();
        const m = await page.evaluate((dialog) => {
            const footer = document.querySelector(`#${dialog} .buttons`) as HTMLElement;
            const btns = Array.from(footer.children).filter(b => (b as HTMLElement).offsetParent && !b.classList.contains('link-button')) as HTMLElement[];
            const f = footer.getBoundingClientRect();
            const primary = footer.querySelector('.primary') as HTMLElement;
            const dismiss = footer.querySelector('[data-dismiss]') as HTMLElement;
            return {
                overflow: btns.some(b => b.getBoundingClientRect().right > f.right + 0.5 || b.getBoundingClientRect().left < f.left - 0.5),
                fullWidth: btns.every(b => b.getBoundingClientRect().width > f.width - 40),
                primaryAbove: primary.getBoundingClientRect().top < dismiss.getBoundingClientRect().top,
                pageScroll: document.documentElement.scrollWidth > window.innerWidth,
            };
        }, id);
        expect(m).toEqual({ overflow: false, fullWidth: true, primaryAbove: true, pageScroll: false });
    });
}

test('360px: the tree manager footer has Export all and New tree side by side, no Close (× and the drag close it)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => void window.Strom.UI.showTreeManagerDialog());
    const modal = page.locator('#tree-manager-modal');
    await expect(modal).toBeVisible();
    const m = await page.evaluate(() => {
        const footer = document.querySelector('#tree-manager-modal .buttons') as HTMLElement;
        const btns = Array.from(footer.children).filter(b => (b as HTMLElement).offsetParent) as HTMLElement[];
        const f = footer.getBoundingClientRect();
        const [a, b] = btns.map(x => x.getBoundingClientRect());
        return {
            labels: btns.map(x => x.innerText.replace(/\s+/g, ' ').trim()),
            sideBySide: Math.abs(a.top - b.top) < 1,
            tall: btns.every(x => x.getBoundingClientRect().height >= 48),
            overflow: btns.some(x => x.getBoundingClientRect().right > f.right + 0.5 || x.getBoundingClientRect().left < f.left - 0.5),
            pageScroll: document.documentElement.scrollWidth > window.innerWidth,
        };
    });
    expect(m).toEqual({ labels: ['Export all', '+ New tree'], sideBySide: true, tall: true, overflow: false, pageScroll: false });
});

test('the confirm dialog is the small width and its title keeps the 20px/24px inset, lined up with the body (desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await page.evaluate(() => {
        void window.Strom.UI.showConfirm('Zkontrolovali jsme data.', 'Kontrola dat',
            { ok: 'Zobrazit', cancel: 'Zavrit' });
    });
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    const m = await page.evaluate(() => {
        const modal = document.querySelector('#confirmation-modal .modal') as HTMLElement;
        const h = getComputedStyle(document.getElementById('confirm-title')!);
        return { width: Math.round(modal.getBoundingClientRect().width), pad: `${h.paddingTop} ${h.paddingRight} ${h.paddingBottom} ${h.paddingLeft}` };
    });
    expect(m.width).toBe(440);
    expect(m.pad).toBe('20px 24px 0px 24px');

    const i = await insets(page);
    expect(i.title, 'title text starts at the same inset as the body').toBe(i.message);
    expect(i.title, 'and is not flush against the panel edge').toBeGreaterThan(8);
    expect(i.titleTop, 'nor against the top edge').toBeGreaterThan(8);
});

test('tree manager: New tree is the only primary, rows offer "Open at startup"', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');
    await expect(manager).toBeVisible();
    const footer = manager.locator('.tree-manager-footer');
    await expect(footer.locator('button.primary')).toHaveCount(1);
    await expect(footer.locator('button').last()).toHaveClass(/primary/);
    await expect(footer.locator('[data-dismiss]')).toHaveText('Close');
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
    await expect(modal.locator('.buttons #surnames-link')).toHaveClass(/primary/);
    await expect(modal.locator('.buttons button')).toHaveCount(2);
    await expect(modal.locator('.buttons [data-dismiss]')).toHaveText('Close');
    await expect(modal.locator('#surname-other-add')).toHaveText('Add');
    await expect(modal.locator('.surnames-none .empty-block-title')).toBeVisible();
});

test('1000px is a tablet: the dialog × is a 44px target (the tablet band runs to 1024px)', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 740 });
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => void window.Strom.UI.showStorageStatusDialog());
    const close = page.locator('#storage-status-modal .close-btn');
    await expect(close).toBeVisible();
    const box = (await close.boundingBox())!;
    expect(Math.round(box.width)).toBe(44);
    expect(Math.round(box.height)).toBe(44);
});

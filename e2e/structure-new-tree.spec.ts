import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, seedTree, openTreeActions, openStructureDialog, type SeedPerson } from './helpers.js';
import { syntheticTree } from '../src/__tests__/helpers/synthetic-tree';

/**
 * Change structure… › From a selection (spec 139 §3–§4): who to take as side
 * tabs of seven sources with the real count of the chosen people under the
 * pane, then the summary of what the new tree gets, then the new tree opened
 * with a toast leading back to the tree it was made of.
 */

/** Jesenští: Vojtěch and Marie (née Kalinovská) with three children, Petr's three; Marie's father Ota Kalinovský (a small line). */
const JESENSTI: Record<string, SeedPerson> = {
    vojtech: { firstName: 'Vojtěch', lastName: 'Jesenský', partners: ['marie'] },
    marie: { firstName: 'Marie', lastName: 'Kalinovská', gender: 'female', parents: ['ota'], partners: ['vojtech'] },
    ota: { firstName: 'Ota', lastName: 'Kalinovský' },
    petr: { firstName: 'Petr', lastName: 'Jesenský', parents: ['vojtech', 'marie'], partners: ['hana'] },
    anna: { firstName: 'Anna', lastName: 'Jesenská', gender: 'female', parents: ['vojtech', 'marie'] },
    karel: { firstName: 'Karel', lastName: 'Jesenský', parents: ['vojtech', 'marie'] },
    hana: { firstName: 'Hana', lastName: 'Ostrožná', gender: 'female', partners: ['petr'] },
    jakub: { firstName: 'Jakub', lastName: 'Jesenský', parents: ['petr', 'hana'] },
    eliska: { firstName: 'Eliška', lastName: 'Jesenská', gender: 'female', parents: ['petr', 'hana'] },
    tomas: { firstName: 'Tomáš', lastName: 'Jesenský', parents: ['petr', 'hana'] },
};

/** Change structure… › From a selection: the step "who to take". */
async function whoStep(page: Page): Promise<Locator> {
    const dialog = await openStructureDialog(page, await openTreeActions(page));
    await dialog.locator('.menu-option[data-action="select"]').click();
    await expect(dialog).toHaveAttribute('data-step', 'who');
    return dialog;
}

function tab(dialog: Locator, kind: string): Locator {
    return dialog.locator(`#structure-who-tab-${kind}`);
}

test('Rod: the chosen line says its real count; Create opens the new tree with a way back', async ({ page }) => {
    await openApp(page);
    await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
    const dialog = await whoStep(page);
    await expect(dialog.locator('#structure-title')).toHaveText('New tree from a selection');
    await expect(dialog.locator('.structure-who-tabs [role="tab"]')).toHaveCount(7);
    // Nothing chosen on Rod yet: nothing selected, Continue off.
    await tab(dialog, 'rod').click();
    await expect(tab(dialog, 'rod')).toHaveAttribute('aria-selected', 'true');
    // The folded "Other families" row is a row shown: no "No line of that name." under it.
    await expect(dialog.locator('li.sp-rodpick-other')).toBeVisible();
    await expect(dialog.locator('.structure-who-none')).toBeHidden();
    await expect(dialog.locator('.structure-who-chosen')).toHaveText('');
    const go = dialog.locator('#structure-footer [data-action="continue"]');
    await expect(go).toBeDisabled();

    const row = dialog.locator('li.sp-rodpick-rod', { hasText: 'Jesensk' }).first();
    await row.locator('button').click();
    await expect(row).toHaveAttribute('aria-current', 'true');
    // The count is the line's people (selectionPersonIds), the same number its row shows.
    const n = Number((await row.locator('.sp-rodpick-c').textContent())!.trim());
    expect(n).toBeGreaterThanOrEqual(4);
    await expect(dialog.locator('.structure-who-chosen b')).toHaveText(new RegExp(`^.*Jesensk.* line · ${n} people$`));
    await expect(go).toBeEnabled();

    await go.click();
    await expect(dialog).toHaveAttribute('data-step', 'summary');
    await expect(dialog.locator('.structure-stat b').first()).toHaveText(/^\d+$/);
    const name = dialog.locator('#structure-name');
    await expect(name).toHaveValue(/^Jesenští — .*Jesensk.* line$/);
    await name.fill('Jesenští — výřez');
    const create = dialog.getByRole('button', { name: 'Create tree' });
    await expect(create).toBeEnabled();
    await create.click();
    await expect(dialog).toBeHidden();

    // The new tree is open, not tied to a research; it names the tree it was made of.
    const made = await page.evaluate(() => {
        const T = window.Strom.TreeManager;
        const meta = T.getTreeMetadata(T.getActiveTreeId()!)! as unknown as { name: string; research?: unknown; fromTree?: { name: string } };
        return { name: meta.name, research: meta.research ?? null, from: meta.fromTree?.name ?? null, count: Object.keys(window.Strom.DataManager.getData().persons).length };
    });
    expect(made).toMatchObject({ name: 'Jesenští — výřez', research: null, from: 'Jesenští' });
    expect(made.count).toBeGreaterThanOrEqual(n);
    const toast = page.locator('.toast', { hasText: 'Tree “Jesenští — výřez” created' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Back to Jesenští' }).click();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Jesenští');
    expect(await page.evaluate(() => window.Strom.TreeManager.getTrees().map((t: { name: string }) => t.name).sort()))
        .toEqual(['Jesenští', 'Jesenští — výřez']);
});

/**
 * The new tree takes the other parents of chosen children with them (extractSubtree), so the summary
 * counts more people than were chosen: the step says so under "Selected: …", as Join does, and the
 * summary's count is that total. When nobody comes along, no such sentence.
 */
test('Selected: says the partners the new tree takes with them, and the summary counts them', async ({ page }) => {
    await openApp(page);
    await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
    const dialog = await whoStep(page);
    const chosen = dialog.locator('.structure-who-chosen');
    const go = dialog.locator('#structure-footer [data-action="continue"]');

    // Vojtěch's ancestors: Vojtěch alone, nobody comes along.
    await tab(dialog, 'ancestors').click();
    await expect(chosen.locator('b')).toHaveText(/ · 1 person$/);
    await expect(chosen.locator('.structure-who-partners')).toHaveCount(0);

    // The line is seven people; Marie and Hana (the other parents of chosen children) come along.
    await tab(dialog, 'rod').click();
    await dialog.locator('li.sp-rodpick-rod', { hasText: 'Jesensk' }).first().locator('button').click();
    await expect(chosen.locator('b')).toHaveText(/ line · 7 people$/);
    await expect(chosen.locator('.structure-who-partners')).toHaveText('The new tree gets 2 partners too, the other parents of chosen children – 9 people in all.');
    await go.click();
    await expect(dialog).toHaveAttribute('data-step', 'summary');
    await expect(dialog.locator('.structure-stat b').first()).toHaveText('9');
});

/**
 * Create the tree of a line from Change structure… and say what the canvas
 * shows then: the focus, whether it is a person of the new tree, the count
 * under it and whether its card lies whole inside the visible canvas.
 */
async function createLineTree(page: Page): Promise<{ focus: string | null; inTree: boolean; count: string; inside: boolean; start: string | null }> {
    // Opened as the phone's More › Tree does it too (one way for both widths).
    await page.evaluate(() => window.Strom.UI.showStructureDialog(window.Strom.TreeManager.getActiveTreeId()!));
    const dialog = page.locator('#structure-modal');
    await expect(dialog).toHaveAttribute('data-step', 'options');
    await dialog.locator('.menu-option[data-action="select"]').click();
    await expect(dialog).toHaveAttribute('data-step', 'who');
    await tab(dialog, 'rod').click();
    await dialog.locator('li.sp-rodpick-rod', { hasText: 'Jesensk' }).first().locator('button').click();
    await dialog.locator('#structure-footer [data-action="continue"]').click();
    await expect(dialog).toHaveAttribute('data-step', 'summary');
    await dialog.getByRole('button', { name: 'Create tree' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText(/^Jesenští — /);
    // The toast comes once the new tree is shown; the count then is the new tree's.
    await expect(page.locator('.toast', { hasText: 'created' })).toBeVisible();
    const total = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);
    // The focus panel's count (a phone keeps it in the panel behind the focus pill).
    const count = page.locator('#focus-person-count');
    await expect(count).toHaveText(new RegExp(` of ${total} people$`));
    await page.evaluate(() => window.Strom.ZoomPan.finishAnimation());
    return page.evaluate(() => {
        const S = window.Strom;
        const focus = S.TreeRenderer.getFocusPersonId() as string | null;
        const persons = S.DataManager.getData().persons as Record<string, unknown>;
        const box = (document.getElementById('tree-container') as HTMLElement).getBoundingClientRect();
        const el = focus ? document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${CSS.escape(focus)}"]`) : null;
        const r = el?.getBoundingClientRect();
        const inside = !!r && r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;
        const start = (S.DataManager.getStartupFocus()?.personId as string | undefined) ?? null;
        return { focus, inTree: !!focus && focus in persons, inside, start, count: '' };
    }).then(async (r) => ({ ...r, count: (await count.textContent())?.trim() ?? '' }));
}

for (const [label, use] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
] as const) test.describe(label, () => {
    test.use(use);
    test('Create tree opens the new tree on its own person, centred, all of it in view (not the focus of the tree left)', async ({ page }) => {
        await openApp(page);
        // Focused on Hana (married in, in the line's tree too) without generations, the view moved far away.
        await seedTree(page, JESENSTI, 'Jesenští', 'hana');
        await page.evaluate(() => {
            const S = window.Strom;
            S.TreeRenderer.setFocusDepth(0, 0);
            S.ZoomPan.centerOnWorldPoint(6000, 6000);
        });
        const made = await createLineTree(page);
        expect(made.inTree).toBe(true);
        // The same person a reload would open on (the tree's start person, else the default rule).
        if (made.start) expect(made.focus).toBe(made.start);
        const total = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);
        expect(made.count).toBe(`${total} of ${total} people`);
        expect(made.inside).toBe(true);
    });
});

test('a list of nobody: the row is chosen, but Continue stays off', async ({ page }) => {
    await openApp(page);
    await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
    await page.evaluate(() => window.Strom.DataManager.createPersonList({ name: 'Prázdný seznam', dynamic: false, personIds: [] }));
    const dialog = await whoStep(page);
    await tab(dialog, 'list').click();
    const row = dialog.locator('li[data-sel^="list:"]', { hasText: 'Prázdný seznam' });
    await expect(row.locator('.sp-rodpick-c')).toHaveText('0');
    await row.locator('button').click();
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(dialog.locator('.structure-who-chosen')).toHaveText('');
    await expect(dialog.locator('#structure-footer [data-action="continue"]')).toBeDisabled();
});

test('the view is greyed in the fan and says why; Rod is chosen instead', async ({ page }) => {
    await openApp(page);
    await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
    await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('fan' as never));
    const dialog = await whoStep(page);
    await expect(tab(dialog, 'view')).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.locator('#structure-who-view-why')).toHaveText('Only in the Family or Descendants view.');
    await expect(tab(dialog, 'rod')).toHaveAttribute('aria-selected', 'true');
    // A click on the greyed tab changes nothing; ↓ from Rod skips nothing it should not.
    await tab(dialog, 'view').click({ force: true });
    await expect(tab(dialog, 'rod')).toHaveAttribute('aria-selected', 'true');
    await tab(dialog, 'rod').focus();
    await page.keyboard.press('Home');
    await expect(tab(dialog, 'rod')).toHaveAttribute('aria-selected', 'true');
});

test('a large tree: the summary counts in batches with Create off, images only by reference', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    const { data, rootId } = syntheticTree({ persons: 3200, seed: 7 });
    // Every person with the same portrait, large enough to be pooled: counted, never read.
    const portrait = `data:image/png;base64,${'iVBORw0KGgo'.repeat(200)}`;
    for (const p of Object.values(data.persons) as Array<{ photo?: string; isPlaceholder?: boolean }>) {
        if (!p.isPlaceholder) p.photo = portrait;
    }
    await page.evaluate(async ({ data, rootId }) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data as never, 'Ostrožní z Mezihoře');
        S.TreeRenderer.setFocus(rootId as never);
        await S.TreeRenderer.renderAsync();
        await S.TreeManager.flush();
    }, { data, rootId });
    const dialog = await whoStep(page);
    await expect(tab(dialog, 'view')).toHaveAttribute('aria-selected', 'true');

    // Watch the summary: its waiting state, and every read of the image pool.
    await page.evaluate(() => {
        const w = window as unknown as { __seen: { waiting: boolean; createOff: boolean; note: boolean }; __mediaReads: number };
        w.__seen = { waiting: false, createOff: false, note: false };
        w.__mediaReads = 0;
        const tx = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (this: IDBDatabase, names: string | string[], ...rest: unknown[]) {
            if ((Array.isArray(names) ? names : [names]).includes('media')) w.__mediaReads++;
            return (tx as (...a: unknown[]) => IDBTransaction).call(this, names, ...rest);
        } as typeof tx;
        new MutationObserver(() => {
            const body = document.getElementById('structure-body');
            if (!body?.querySelector('.structure-counting')) return;
            w.__seen.waiting = true;
            if (body.querySelector('.structure-stat.is-wait')) w.__seen.waiting = true;
            const create = document.querySelector<HTMLButtonElement>('#structure-footer [data-action="create"]');
            if (create?.disabled) w.__seen.createOff = true;
            if (body.querySelector('.structure-images-note')?.textContent === 'Images are only counted, not loaded into memory.') w.__seen.note = true;
        }).observe(document.getElementById('structure-modal')!, { childList: true, subtree: true, attributes: true, characterData: true });
    });
    await dialog.locator('#structure-footer [data-action="continue"]').click();
    await expect(dialog).toHaveAttribute('data-step', 'summary');
    // The name is editable at once; Create comes on with the end of the count.
    await expect(dialog.locator('#structure-name')).toBeEditable();
    const create = dialog.locator('#structure-footer [data-action="create"]');
    await expect(create).toBeEnabled({ timeout: 60_000 });
    await expect(dialog.locator('.structure-counting')).toHaveCount(0);
    const persons = Number(await dialog.locator('.structure-stat[data-stat="persons"] b').textContent());
    expect(persons).toBeGreaterThan(1);
    // Every chosen person has a portrait: as many images as people, none of them read.
    await expect(dialog.locator('.structure-stat[data-stat="images"] b')).toHaveText(String(persons));
    const seen = await page.evaluate(() => {
        const w = window as unknown as { __seen: unknown; __mediaReads: number };
        return { ...(w.__seen as object), mediaReads: w.__mediaReads };
    });
    expect(seen).toEqual({ waiting: true, createOff: true, note: true, mediaReads: 0 });
});

test('the German kinds wrap in the side column: none runs under the pane, at the desktop, tablet and sideways phone widths', async ({ page }) => {
    await openApp(page);
    await seedTree(page, JESENSTI, 'Jesenští', 'vojtech');
    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => window.Strom.UI.showStructureDialog(window.Strom.TreeManager.getActiveTreeId()!));
        const dialog = page.locator('#structure-modal');
        await dialog.locator('.menu-option[data-action="select"]').click();
        await expect(dialog).toHaveAttribute('data-step', 'who');
        const over = await dialog.locator('.structure-who-nav').evaluate(nav => [nav, ...nav.querySelectorAll('.sel-tab')]
            .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent!.trim()));
        expect(over, `${viewport.width}px`).toEqual([]);
        await page.evaluate(() => window.Strom.UI.closeStructureDialog());
        await expect(dialog).toBeHidden();
    }
});

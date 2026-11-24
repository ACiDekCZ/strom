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
    await expect(dialog.locator('.structure-who-chosen')).toHaveText(new RegExp(`^Selected: .*Jesensk.* line · ${n} people$`));
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

import { Page, expect, Locator } from '@playwright/test';

/** Load the app and wait until the toolbar is interactive. */
export async function openApp(page: Page): Promise<void> {
    await page.goto('/strom.html');
    await expect(page.locator('.toolbar')).toBeVisible();
}

/** The visible person modal (add/edit). */
export function personModal(page: Page): Locator {
    return page.locator('#person-modal');
}

/** Fill and save the add-person form (modal must already be open). */
export async function fillPerson(
    page: Page,
    firstName: string,
    lastName: string,
    opts: { gender?: 'male' | 'female'; birthDate?: string; birthPlace?: string } = {}
): Promise<void> {
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await modal.locator('#input-firstname').fill(firstName);
    await modal.locator('#input-lastname').fill(lastName);
    if (opts.gender === 'female') {
        await modal.locator('#input-gender').selectOption('female');
    }
    if (opts.birthDate !== undefined) {
        await modal.locator('#input-birthdate').fill(opts.birthDate);
    }
    if (opts.birthPlace !== undefined) {
        await modal.locator('#input-birthplace').fill(opts.birthPlace);
    }
    await modal.getByRole('button', { name: 'Save' }).click();
}

/** Create the very first person from the empty state (or toolbar). */
export async function createFirstPerson(
    page: Page,
    firstName: string,
    lastName: string,
    opts: { gender?: 'male' | 'female'; birthDate?: string; birthPlace?: string } = {}
): Promise<void> {
    const addFirst = page.locator('#empty-state button').first();
    if (await addFirst.isVisible().catch(() => false)) {
        await addFirst.click();
    } else {
        await page.getByRole('button', { name: 'Add Person' }).first().click();
    }
    await fillPerson(page, firstName, lastName, opts);
}

/**
 * A person card by displayed first name. Matches the name element only — the
 * card's hover tooltip also contains partner/child names, so a plain hasText on
 * the whole card would be ambiguous.
 */
export function card(page: Page, firstName: string): Locator {
    return page.locator('.person-card', {
        has: page.locator('.name-text', { hasText: firstName }),
    }).first();
}

/** Open the context menu for a card and click an action. */
export async function cardAction(page: Page, firstName: string, action: string): Promise<void> {
    await card(page, firstName).click();
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await menu.locator(`.context-menu-item[data-action="${action}"]`).click();
}

/**
 * Wait until the persisted tree data (IndexedDB `strom-db`) contains `needle`.
 * Writes are fire-and-forget, so reloading right after a mutation can race the
 * flush; this polls the real store to make the reload deterministic.
 */
export async function waitForPersist(page: Page, needle: string): Promise<void> {
    await page.waitForFunction((n) => new Promise<boolean>((resolve) => {
        const req = indexedDB.open('strom-db');
        req.onsuccess = () => {
            try {
                const tx = req.result.transaction('trees', 'readonly');
                const all = tx.objectStore('trees').getAll();
                all.onsuccess = () => resolve(JSON.stringify(all.result).includes(n));
                all.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        };
        req.onerror = () => resolve(false);
    }), needle);
}

/** Focus a person through the toolbar search (works even if the card is off-screen). */
export async function focusViaSearch(page: Page, firstName: string): Promise<void> {
    const input = page.locator('#toolbar-search-picker .person-picker-input');
    await input.fill(firstName);
    await page.locator('#toolbar-search-picker .person-picker-item', { hasText: firstName }).first().click();
    await expect(card(page, firstName)).toHaveClass(/focused/);
}

/** Add a related person (parent/partner/child/sibling) via the relation modal. */
export async function addRelation(
    page: Page,
    fromName: string,
    action: 'parent' | 'partner' | 'child' | 'sibling',
    firstName: string,
    lastName: string,
    gender?: 'male' | 'female'
): Promise<void> {
    await cardAction(page, fromName, action);
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#rel-firstname').fill(firstName);
    await modal.locator('#rel-lastname').fill(lastName);
    if (gender === 'female') {
        await modal.locator('#rel-gender').selectOption('female');
    }
    await modal.locator('#rel-submit-btn').click();
    await expect(modal).toBeHidden();
}

/**
 * Export the active tree as JSON (no encryption) and return the download's
 * local file path. `privacy` picks the living-person privacy mode.
 */
export async function exportTreeJson(
    page: Page,
    privacy: 'full' | 'initials' | 'minimal' | 'anonymous' = 'full'
): Promise<string> {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeJSON());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption(privacy);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    return download.path();
}

/**
 * Import a JSON file as a NEW tree via the hidden file input, then confirm the
 * import-tree dialog. Switches the app to the imported tree.
 */
export async function importJsonAsNewTree(page: Page, filePath: string, treeName?: string): Promise<void> {
    await page.locator('#file-input').setInputFiles(filePath);
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    if (treeName) await dialog.locator('#import-tree-name').fill(treeName);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();
}

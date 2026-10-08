import { Page, expect, Locator } from '@playwright/test';

/**
 * Mark the Strom Research promotion (3.0) as already seen in this page's
 * browser settings: the one-time "What's new" card and the "New" marker would
 * otherwise appear over suites that test something else. Only keys the
 * settings do not have yet are set, on every navigation of the page.
 */
export async function seedResearchPromoSeen(page: Page): Promise<void> {
    await page.addInitScript(() => {
        try {
            const key = 'strom-settings';
            const raw = localStorage.getItem(key);
            const settings = raw ? JSON.parse(raw) : {};
            let changed = false;
            if (settings.whatsNew30Shown === undefined) { settings.whatsNew30Shown = true; changed = true; }
            if (settings.researchNewDismissed === undefined) { settings.researchNewDismissed = true; changed = true; }
            if (changed) localStorage.setItem(key, JSON.stringify(settings));
        } catch { /* no storage: nothing to seed */ }
    });
}

/**
 * Set one browser setting before the app starts, unless it is already set
 * (on every navigation of the page).
 */
export async function seedSetting(page: Page, name: string, value: unknown): Promise<void> {
    await page.addInitScript(([n, v]) => {
        try {
            const key = 'strom-settings';
            const raw = localStorage.getItem(key);
            const settings = raw ? JSON.parse(raw) : {};
            if (settings[n as string] === undefined) {
                settings[n as string] = v;
                localStorage.setItem(key, JSON.stringify(settings));
            }
        } catch { /* no storage: nothing to seed */ }
    }, [name, value] as const);
}

/**
 * Load the app and wait until the toolbar is interactive. By default the
 * Strom Research promotion counts as already seen (see seedResearchPromoSeen);
 * `{ researchPromo: true }` keeps the first-run state for suites testing it;
 * the "changes only in the browser" notice is off unless `{ fileCopyReminders: true }`;
 * the one-time tour offer after the sample tree counts as already made unless
 * `{ tourOffer: true }` — it sits over the bottom of the screen for 15 s and
 * would make every click there wait it out.
 */
export async function openApp(
    page: Page,
    opts: { researchPromo?: boolean; fileCopyReminders?: boolean; tourOffer?: boolean } = {},
): Promise<void> {
    if (!opts.researchPromo) await seedResearchPromoSeen(page);
    if (!opts.fileCopyReminders) await seedSetting(page, 'fileCopyReminders', false);
    if (!opts.tourOffer) {
        await page.addInitScript(() => {
            try {
                if (localStorage.getItem('strom-tour-offered') === null) localStorage.setItem('strom-tour-offered', '1');
            } catch { /* no storage: nothing to seed */ }
        });
    }
    await page.goto('/strom.html');
    await expect(page.locator('.toolbar')).toBeVisible();
    // The toolbar is static HTML: wait until the startup tree is read and
    // editing is allowed (html.app-loading, main.ts).
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
}

/**
 * What the app says once a tree is handed over to the research (the "linked"
 * toast, "The research is ready"): it first tries to load the research's
 * version, 0, 1 and 3 s after the hand-over (ADOPT_LOAD_WAITS in
 * src/ui/research-adopt-ui.ts). A research without a version yet takes all
 * three tries, 4 s of the default 5 s expect timeout: too little on a loaded
 * machine. Expectations right after a hand-over wait those 4 s more.
 */
export const AFTER_HAND_OVER = { timeout: 4_000 + 5_000 };

/** The visible person modal (add/edit). */
export function personModal(page: Page): Locator {
    return page.locator('#person-modal');
}

/**
 * Fill and save the add-person form (modal must already be open). The sex is
 * male unless `gender` says otherwise (a new person starts as unknown, U01).
 */
export async function fillPerson(
    page: Page,
    firstName: string,
    lastName: string,
    opts: { gender?: 'male' | 'female' | 'unknown'; birthDate?: string; birthPlace?: string } = {}
): Promise<void> {
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await modal.locator('#input-firstname').fill(firstName);
    await modal.locator('#input-lastname').fill(lastName);
    await modal.locator('#input-gender').selectOption(opts.gender ?? 'male');
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
    opts: { gender?: 'male' | 'female' | 'unknown'; birthDate?: string; birthPlace?: string } = {}
): Promise<void> {
    const addFirst = page.locator('#empty-state .empty-state-actions button').first();
    if (await addFirst.isVisible().catch(() => false)) {
        await addFirst.click();
    } else {
        await page.getByRole('button', { name: 'Add person' }).first().click();
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

/**
 * Every drawn card's box is the size the layout gave it: the view's card
 * width and the person's own height (custom card "by content",
 * LayoutConfig.personHeights) or the view's one height. True once the custom
 * cards are measured in their fonts and laid out again.
 */
export async function cardBoxesMatchLayout(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const cards = [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')];
        const config = (window.Strom.TreeRenderer as unknown as {
            config: { cardWidth: number; cardHeight: number; personHeights?: Map<string, number> };
        }).config;
        return cards.length > 0 && cards.every(c => c.offsetWidth === config.cardWidth
            && c.offsetHeight === (config.personHeights?.get(c.dataset.id ?? '') ?? config.cardHeight));
    });
}

/**
 * Open the person menu for a card and click an action. Above 1024px (fine
 * pointer) it is the floating `.context-menu`; in the bottom-navigation regime
 * (≤ 1024px) and on touch it is the `.bottom-sheet-person` sheet.
 */
export async function cardAction(page: Page, firstName: string, action: string): Promise<void> {
    await card(page, firstName).click();
    const menu = page.locator('.context-menu:not(.context-submenu), .bottom-sheet-person');
    await expect(menu).toBeVisible();
    // Lock / merge / delete live under "More ›", the research's actions under "Research ›".
    const more = ['toggle-lock', 'merge', 'delete'].includes(action);
    const research = action.startsWith('research-');
    const row = page.locator(`.context-menu [data-menu="${more ? 'more' : 'research'}"], .bottom-sheet-person [data-menu="${more ? 'more' : 'research'}"]`);
    if ((more || research) && await row.count() > 0) await row.click();
    await page.locator(`.context-menu [data-action="${action}"], .bottom-sheet-person [data-action="${action}"]`)
        .filter({ visible: true }).click();
}

/** Open the person menu's "More ›" or "Research ›" (desktop flyout / the sheet's second page). */
export async function openPersonSubmenu(page: Page, which: 'more' | 'research'): Promise<Locator> {
    await page.locator(`.context-menu [data-menu="${which}"], .bottom-sheet-person [data-menu="${which}"]`).click();
    const level = page.locator('.context-submenu, .bottom-sheet-person .sheet-page-sub');
    await expect(level).toBeVisible();
    return level;
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

/**
 * Add a related person (parent/partner/child/sibling) via the relation modal.
 * Without `gender`: a parent or partner keeps the dialog's choice (the other
 * parent's / partner's opposite), a child or sibling is male (the dialog
 * starts them as unknown, U01).
 */
export async function addRelation(
    page: Page,
    fromName: string,
    action: 'parent' | 'partner' | 'child' | 'sibling',
    firstName: string,
    lastName: string,
    gender?: 'male' | 'female' | 'unknown'
): Promise<void> {
    await cardAction(page, fromName, action);
    const modal = page.locator('#relation-modal');
    await expect(modal).toBeVisible();
    await modal.locator('#rel-firstname').fill(firstName);
    await modal.locator('#rel-lastname').fill(lastName);
    const sex = gender ?? (action === 'child' || action === 'sibling' ? 'male' : undefined);
    if (sex) await modal.locator('#rel-gender').selectOption(sex);
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
        pwd.locator('#export-submit-btn').click(),
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

/**
 * B17-1: with the zoom buttons off the bottom-right control card hides as
 * empty while the tree fits, and must come back with the minimap when zoomed
 * in, and with the buttons when they are turned on again. WebKit reports a
 * shown minimap inside the hidden card as `display: none`, so a decision from
 * computed style kept the card hidden until a reload. Sample tree, a desktop
 * viewport set by the caller.
 */
export async function controlCardComesBack(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    const block = page.locator('.control-block');
    const panel = page.locator('#minimap-panel');
    // A fit while a zoom or the opening view still glides is taken over by the
    // glide: fit again until the minimap has hidden.
    const fit = () => expect(async () => {
        await page.evaluate(() => window.Strom.ZoomPan.fitToScreen());
        await expect(panel).toBeHidden({ timeout: 1000 });
    }).toPass();

    // Buttons off, the tree fits: no minimap, so no card.
    await page.evaluate(() => window.Strom.UI.toggleZoomControls(false));
    await fit();
    await expect(block).toBeHidden();
    // Zoomed in: the tree overflows, the minimap and its card show.
    const scale = () => page.evaluate(() => window.Strom.ZoomPan.getTransform().scale);
    const fitted = await scale();
    for (let i = 0; i < 4; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
    await expect(panel).toBeVisible();
    await expect(block).toBeVisible();
    // Fitted again once the zoom has glided to its end: both hide.
    await expect.poll(scale).toBeCloseTo(fitted * 1.3 ** 4, 5);
    await fit();
    await expect(block).toBeHidden();
    // The buttons back on in Settings: they show, in their card.
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    await page.locator('#settings-modal #zoom-controls-toggle').check();
    await page.keyboard.press('Escape');
    await expect(page.locator('.zoom-controls')).toBeVisible();
    await expect(block).toBeVisible();
}

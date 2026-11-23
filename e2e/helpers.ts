import { Page, expect, Locator } from '@playwright/test';
import { readFileSync } from 'fs';

/** The version of the build under test (e2e-dist is built from this package.json). */
export const PACKAGE_VERSION: string = JSON.parse(readFileSync('package.json', 'utf-8')).version;

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
 * Mark the "What's new" of the running version as already seen in this
 * page's browser: an existing tree and no seen version would otherwise bring
 * the dialog over suites that test something else. Set only when nothing is
 * stored yet, on every navigation of the page.
 */
export async function seedWhatsNewSeen(page: Page): Promise<void> {
    await page.addInitScript((version) => {
        try {
            if (localStorage.getItem('strom-whats-new-seen') === null) localStorage.setItem('strom-whats-new-seen', version);
        } catch { /* no storage: nothing to seed */ }
    }, PACKAGE_VERSION);
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
 * Make the browser keep storage best-effort (refuse persistence) or grant it.
 * Without it the answer is the browser's own (Chromium decides by heuristics:
 * granted on one machine, refused on another), and so is whether the "only in
 * the browser" state shows.
 */
export async function stubPersistence(page: Page, granted: boolean): Promise<void> {
    await page.addInitScript((ok) => {
        let persistent = false;
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: {
                ...(navigator.storage ? { estimate: navigator.storage.estimate.bind(navigator.storage), getDirectory: navigator.storage.getDirectory?.bind(navigator.storage) } : {}),
                persisted: async () => persistent,
                persist: async () => { persistent = ok; (window as unknown as { __persistAsked: number }).__persistAsked = ((window as unknown as { __persistAsked?: number }).__persistAsked ?? 0) + 1; return ok; },
            },
        });
    }, granted);
}

/**
 * Load the app and wait until the toolbar is interactive. By default the
 * Strom Research promotion counts as already seen (see seedResearchPromoSeen);
 * `{ researchPromo: true }` keeps the first-run state for suites testing it;
 * the "changes only in the browser" notice is off unless `{ fileCopyReminders: true }`;
 * the one-time tour offer after the sample tree counts as already made unless
 * `{ tourOffer: true }` — it sits over the bottom of the screen for 15 s and
 * would make every click there wait it out; the "What's new" of this version
 * counts as seen unless `{ whatsNew: true }` (see seedWhatsNewSeen); the
 * "On this day" card is off unless `{ onThisDay: true }` — the fixtures and
 * the sample tree have anniversaries, and on those dates the card (shown once
 * the tree is idle) would cover the controls a suite taps, so a suite would
 * fail only on those days. The one-time offer of Migration over time on the
 * map counts as spent unless `{ mapTimeTip: true }` — it stands left of the
 * map's controls over the points a suite presses.
 */
export async function openApp(
    page: Page,
    opts: { researchPromo?: boolean; fileCopyReminders?: boolean; tourOffer?: boolean; whatsNew?: boolean; onThisDay?: boolean; mapTimeTip?: boolean } = {},
): Promise<void> {
    if (!opts.researchPromo) await seedResearchPromoSeen(page);
    if (!opts.whatsNew) await seedWhatsNewSeen(page);
    if (!opts.fileCopyReminders) await seedSetting(page, 'fileCopyReminders', false);
    if (!opts.onThisDay) await seedSetting(page, 'onThisDay', false);
    if (!opts.tourOffer) {
        await page.addInitScript(() => {
            try {
                if (localStorage.getItem('strom-tour-offered') === null) localStorage.setItem('strom-tour-offered', '1');
            } catch { /* no storage: nothing to seed */ }
        });
    }
    if (!opts.mapTimeTip) {
        await page.addInitScript(() => {
            try {
                if (localStorage.getItem('strom.map.timeTipSeen') === null) localStorage.setItem('strom.map.timeTipSeen', '1');
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
 * Reload the page and wait, as openApp does, until the startup tree is read
 * (html.app-loading gone). The load event comes before it: a research menu
 * opened or a bridge polled in between finds no tree yet and does nothing.
 */
export async function reloadApp(page: Page): Promise<void> {
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
}

/**
 * A page opened beside the app's main window as a whole app of its own: a
 * browser without Web Locks (no window roles, every tab loads and saves the
 * trees; another tab's save is told over tab-sync). Without it, another tab
 * of the app is "already open" and loads nothing. Call before its goto.
 */
export async function asWindowlessTab(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    });
}

/**
 * What the app says once a tree is handed over to the research (the "linked"
 * toast, "The research is ready"): it first tries to load the research's
 * version, 0, 1 and 3 s after the hand-over (ADOPT_LOAD_WAITS in
 * src/ui/research-adopt-ui.ts). A research without a version yet takes all
 * three tries, 4 s of the default 5 s expect timeout: too little on a loaded
 * machine. Expectations right after a hand-over wait those 4 s more.
 * A test that needs the hand-over only as a step serves the research's
 * version (its /tree.ged, the tree's people under the research's id), which
 * loads at the first try; research-adopt-ids walks the tries.
 */
export const AFTER_HAND_OVER = { timeout: 4_000 + 5_000 };

/**
 * The hand-over ended linked in its dialog (A175: the dialog stays with its steps): the sentence there,
 * every step done, then the dialog closed (its Close).
 */
export async function closeHandedOver(page: Page, opts: { timeout?: number } = AFTER_HAND_OVER): Promise<void> {
    const dialog = page.locator('#research-adopt-modal');
    await expect(dialog.locator('.research-adopt-end')).toHaveText('The tree is linked with the research.', opts);
    await expect(dialog.locator('ul.steps > li.done')).toHaveCount(4);
    await dialog.locator('#research-adopt-close').click();
    await expect(dialog).toHaveCount(0);
}

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

/** A person for seedTree: parents and partners by key; any other field goes on the person as it is. */
export interface SeedPerson {
    firstName: string;
    lastName: string;
    gender?: 'male' | 'female';
    parents?: string[];
    partners?: string[];
    [field: string]: unknown;
}

/**
 * Seed a tree as data, without clicking it together, for tests whose subject
 * is not building the tree: imported as a new tree, focused on `focus` (the
 * first person by default). One married union per partner pair; a child of
 * both partners belongs to their union.
 */
export async function seedTree(page: Page, people: Record<string, SeedPerson>, name = 'Novak', focus?: string): Promise<void> {
    const persons: Record<string, Record<string, unknown> & { partnerships: string[]; parentIds: string[]; childIds: string[] }> = {};
    for (const [id, { parents, partners: _partners, ...rest }] of Object.entries(people)) {
        persons[id] = { id, gender: 'male', isPlaceholder: false, ...rest, partnerships: [], parentIds: [...(parents ?? [])], childIds: [] };
    }
    for (const [id, p] of Object.entries(persons)) for (const parent of p.parentIds) persons[parent].childIds.push(id);
    const partnerships: Record<string, { id: string; person1Id: string; person2Id: string; childIds: string[]; status: string }> = {};
    for (const [id, { partners }] of Object.entries(people)) {
        for (const other of partners ?? []) {
            const uid = `u_${[id, other].sort().join('_')}`;
            if (partnerships[uid]) continue;
            const childIds = Object.keys(persons).filter(c => persons[c].parentIds.includes(id) && persons[c].parentIds.includes(other));
            partnerships[uid] = { id: uid, person1Id: id, person2Id: other, childIds, status: 'married' };
            persons[id].partnerships.push(uid);
            persons[other].partnerships.push(uid);
        }
    }
    const focusId = focus ?? Object.keys(people)[0];
    await page.evaluate(async ({ persons, partnerships, name, focusId }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships } as never, name);
        await window.Strom.TreeRenderer.setFocus(focusId as never);
    }, { persons, partnerships, name, focusId });
    await expect(card(page, people[focusId].firstName)).toBeVisible();
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

/**
 * Wait until the layout has settled after a resize (or another change that
 * re-measures in later frames): the window size, the toolbar's classes and
 * widths, the body's classes and the boxes of `selectors` read the same before
 * and after two whole frames. ResizeObserver callbacks and the measurements
 * they schedule for the next frame (toolbar-fit) have run by then. Each read
 * is taken after a frame has finished (rAF, then a task), not inside one.
 */
export async function settleLayout(page: Page, ...selectors: string[]): Promise<void> {
    await page.evaluate(async (sels) => {
        const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        const snap = () => {
            const tb = document.querySelector('.toolbar') as HTMLElement | null;
            const boxes = sels.map((s) => {
                const el = document.querySelector(s);
                if (!el) return '-';
                const r = el.getBoundingClientRect();
                return `${r.x},${r.y},${r.width},${r.height},${getComputedStyle(el).display}`;
            });
            return [window.innerWidth, window.innerHeight, document.body.className,
                tb?.className, tb?.scrollWidth, tb?.clientWidth, document.documentElement.scrollWidth, ...boxes].join('|');
        };
        let prev = snap();
        for (let i = 0; i < 30; i++) {
            await frame();
            await frame();
            const cur = snap();
            if (cur === prev) return;
            prev = cur;
        }
    }, selectors);
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
    // WebKit on a loaded machine (the whole suite in parallel) takes longer than 5 s to draw the sample tree.
    await expect(card(page, 'Johan')).toBeVisible({ timeout: 15000 });
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

/**
 * Desktop ⋯ → "Tree: {name} ›": the Actions menu and the tree's flyout open
 * (the one list of tree actions, menu 1020 §3). Returns the flyout.
 */
export async function openTreeActions(page: Page): Promise<Locator> {
    const dropdown = page.locator('#actions-menu-dropdown');
    if (!await dropdown.evaluate(el => el.classList.contains('active'))) await page.locator('.actions-menu-btn').click();
    await expect(dropdown).toHaveClass(/active/);
    if (!await page.locator('#actions-tree-wrap').evaluate(el => el.classList.contains('submenu-open'))) {
        await page.locator('#actions-tree-row').click();
    }
    const sub = page.locator('#actions-tree-submenu');
    await expect(sub.locator('[role^="menuitem"]').first()).toBeVisible();
    return sub;
}

/**
 * "Change structure ⌄" opened in the visible list of tree actions (the ⋯
 * flyout, the tree sheet, the tree manager's ⋯). Returns its group of rows.
 */
export async function openTreeStructure(page: Page, scope?: Locator): Promise<Locator> {
    const toggle = (scope ?? page.locator('body')).locator('.tree-actions-structure-toggle').filter({ visible: true }).first();
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
    await expect(group).toBeVisible();
    return group;
}

/** A satellite's "Follow selection" mode (spec 079 K2.1): switch, mark or off. */
export function followModeOf(page: Page): Promise<string | null> {
    return page.locator('.sat-follow').getAttribute('data-mode');
}

/** Choose a satellite's "Follow selection" mode in its header's menu. */
export async function setFollowMode(page: Page, mode: 'switch' | 'mark' | 'off'): Promise<void> {
    if (await followModeOf(page) === mode) return;
    await page.locator('.sat-follow').click();
    await page.locator(`.sat-follow-menu [role="menuitemradio"][data-mode="${mode}"]`).click();
    await expect(page.locator('.sat-follow')).toHaveAttribute('data-mode', mode);
}

// ---------------------------------------------------------------------------
// The import guide (spec 134): steps, counts and the write of part A.

/** The step the import guide stands on (its `aria-current` item in the step list). */
export function mergeCurrentStep(wizard: Locator): Locator {
    return wizard.locator('#merge-progress [aria-current="step"]');
}

/** One of the guide's four counts (joined, added = new, skipped = not added, pending = to decide). */
export function mergeCount(wizard: Locator, kind: 'joined' | 'added' | 'skipped' | 'pending'): Locator {
    return wizard.locator(`#merge-counts [data-count="${kind}"] .merge-stat-value`);
}

/** Step 1 → the primary button compares: the guide stands on step 2 with the list of pairs. */
export async function mergeCompare(wizard: Locator): Promise<void> {
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '2');
}

/** Step 2's groups: Maybe the same, The same (score 80+), New. */
export type MergeGroup = 'maybe' | 'same' | 'new';

/** A row of step 2's list (the shown group only). */
export function mergeRow(wizard: Locator, text: string | RegExp): Locator {
    return wizard.locator('#merge-match-list .merge-item').filter({ hasText: text });
}

/**
 * An import that is a copy of its tree (13b: everyone joined, the write would
 * change nothing in the chosen scope) shows a sentence in step 2 instead of
 * the list: Show the comparison brings the list.
 */
export async function mergeShowCopy(wizard: Locator): Promise<void> {
    const show = wizard.locator('.merge-s2-show-copy');
    if (!await show.isVisible()) return;
    await show.click();
    await expect(wizard.locator('#merge-match-list')).toBeAttached();
}

/**
 * Step 2's list of pairs: past the sentence of a copy of the tree (13b), and on
 * a phone (and a phone held sideways), where the list is a sheet over the
 * pair, opened by "Pair i of n ▾".
 */
export async function mergeOpenList(wizard: Locator): Promise<void> {
    await mergeShowCopy(wizard);
    if (await wizard.locator('#merge-match-list').isVisible()) return;
    const open = wizard.locator('.merge-pair-open');
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(wizard.locator('#merge-match-list')).toBeVisible();
}

/** Show a group of step 2 (its tab). */
export async function mergeGroup(wizard: Locator, group: MergeGroup): Promise<void> {
    await mergeOpenList(wizard);
    const tab = wizard.locator(`.merge-tab[data-group="${group}"]`);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Choose the pair (or new person) whose row says `text` in step 2, in
 * whichever group it stands (`group` to look in one only): the pair shows on
 * the right. Returns the chosen row.
 */
export async function mergePair(wizard: Locator, text: string | RegExp, group?: MergeGroup): Promise<Locator> {
    const groups: MergeGroup[] = group ? [group] : ['maybe', 'same', 'new'];
    await mergeOpenList(wizard);
    for (const g of groups) {
        const tab = wizard.locator(`.merge-tab[data-group="${g}"]`);
        if (await tab.getAttribute('aria-selected') !== 'true') await mergeGroup(wizard, g);
        const row = mergeRow(wizard, text);
        if (await row.count() > 0) {
            await row.first().click();
            await expect(mergeRow(wizard, text).first()).toHaveAttribute('aria-selected', 'true');
            await expect(wizard.locator('#merge-pair')).toBeVisible();
            return mergeRow(wizard, text).first();
        }
    }
    throw new Error(`No pair "${String(text)}" in step 2`);
}

/**
 * Every pair of step 2 still to decide (a row with a person of the tree on
 * its other side, in Maybe the same or The same) joined, one by one: the
 * pending count ends at 0.
 */
export async function mergeJoinPending(wizard: Locator): Promise<void> {
    for (const g of ['maybe', 'same'] as MergeGroup[]) {
        await mergeGroup(wizard, g);
        const open = wizard.locator('#merge-match-list .merge-item[data-fate="pending"]').filter({ has: wizard.page().locator('.merge-item-other') });
        for (let n = await open.count(); n > 0; n--) {
            await open.first().click();
            await wizard.locator('#merge-pair .merge-dec[data-dec="same"]').click();
            await expect(open).toHaveCount(n - 1);
        }
    }
    await expect(mergeCount(wizard, 'pending')).toHaveText('0');
}

/** A decision on the pair whose row says `text`: same, new, another person (its dialog opens) or not added. */
export async function mergeDecide(wizard: Locator, text: string | RegExp, decision: 'same' | 'new' | 'other' | 'skip', group?: MergeGroup): Promise<void> {
    await mergePair(wizard, text, group);
    await wizard.locator(`#merge-pair .merge-dec[data-dec="${decision}"]`).click();
}

/**
 * On to step 5 (What will happen; step 3 as it is, step 4 passed over)
 * and press its primary button: the plan is written into a new tree
 * "{target} + {source}" without asking its name.
 */
export async function mergeWrite(wizard: Locator): Promise<void> {
    await mergeToStep5(wizard);
    await expect(wizard.locator('#merge-next')).toBeEnabled();
    await wizard.locator('#merge-next').click();
}

/**
 * Step 3's unlinked groups still to decide are added unlinked (§6), one by
 * one in their tab; nothing when there are none.
 */
export async function mergeGroupsLoose(wizard: Locator): Promise<void> {
    const tab = wizard.locator('#merge-s3-tab-groups');
    if (!await tab.isVisible() || await wizard.locator('.merge-s3-undecided').isHidden()) return;
    await tab.click();
    const open = wizard.locator('#merge-s3-groups .merge-s3-grow:not(.is-decided)');
    for (let n = await open.count(); n > 0; n--) {
        await open.first().locator('[data-decide="loose"]').click();
        await expect(open).toHaveCount(n - 1);
    }
    await expect(wizard.locator('.merge-s3-undecided')).toBeHidden();
}

/**
 * On through the guide's steps (step 3 Whom to add as it is, its unlinked groups added unlinked, the steps
 * passed over skipped) until step 5 What will happen.
 */
export async function mergeToStep5(wizard: Locator): Promise<void> {
    const current = mergeCurrentStep(wizard);
    for (let i = 0; i < 4 && await current.getAttribute('data-step') !== '5'; i++) {
        const was = await current.getAttribute('data-step');
        if (was === '3') await mergeGroupsLoose(wizard);
        await wizard.locator('#merge-next').click();
        await expect(current).not.toHaveAttribute('data-step', was ?? '');
    }
    await expect(current).toHaveAttribute('data-step', '5');
}

/**
 * From step 2 or 3 of the guide to step 4 (Who is right), the unlinked
 * groups of step 3 added unlinked on the way.
 */
export async function mergeToStep4(wizard: Locator): Promise<void> {
    const current = mergeCurrentStep(wizard);
    for (let i = 0; i < 3 && await current.getAttribute('data-step') !== '4'; i++) {
        const was = await current.getAttribute('data-step');
        if (was === '3') await mergeGroupsLoose(wizard);
        await wizard.locator('#merge-next').click();
        await expect(current).not.toHaveAttribute('data-step', was ?? '');
    }
    await expect(current).toHaveAttribute('data-step', '4');
}

/**
 * Step 4 (Who is right), By person: one detail of one person (the tree's
 * id) taken from the import or kept from the tree by a click on its value.
 */
export async function mergePickValue(wizard: Locator, person: string, field: string, pick: 'mine' | 'import'): Promise<void> {
    const tab = wizard.locator('#merge-s4-tab-persons');
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
    const value = wizard.locator(`.merge-s4-row[data-person="${person}"][data-field="${field}"] .merge-s4-v[data-pick="${pick}"]`);
    await value.click();
    await expect(value).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Choose the guide's scope in step 1 (a: only add new people, b: also fill
 * what the tree lacks, c: also the differences, d: only update existing
 * people, §3): from a later step through step 1 and back to that step.
 */
export async function mergeSetScope(page: Page, scope: 'a' | 'b' | 'c' | 'd'): Promise<void> {
    const wizard = page.locator('#merge-modal');
    const current = mergeCurrentStep(wizard);
    const was = await current.getAttribute('data-step');
    if (was !== '1') {
        await wizard.locator('#merge-progress button.merge-step[data-step="1"]').click();
        await expect(current).toHaveAttribute('data-step', '1');
    }
    const more = wizard.locator('.merge-s1-more');
    if (await more.isVisible() && (scope === 'c' || scope === 'd')) await more.click();
    await wizard.locator(`.merge-s1-scope[data-scope="${scope}"]`).click();
    await expect(wizard.locator(`.merge-s1-scope[data-scope="${scope}"] input`)).toBeChecked();
    if (was && was !== '1') {
        await wizard.locator(`#merge-progress button.merge-step[data-step="${was}"]`).click();
        await expect(current).toHaveAttribute('data-step', was);
    }
}

/** Choose the guide's mode in step 1: New tree, Add to a tree, Only compare or Save as JSON (§3). */
export async function mergeSetMode(wizard: Locator, mode: 'new' | 'add' | 'compare' | 'json'): Promise<void> {
    const option = wizard.locator(`.merge-s1-modes [data-mode="${mode}"]`);
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
}

/**
 * Manage trees → ⋯ → Merge into another tree… (spec 134 §2, 2c): the guide
 * with the tree `sourceId` as the import, Add to a tree and the tree
 * `targetId` chosen in step 1. Resolves with the guide on step 1.
 */
export async function mergeTreeInto(page: Page, sourceId: string, targetId: string): Promise<Locator> {
    await page.evaluate((id) => window.Strom.UI.showMergeTreesDialog(id), sourceId);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await mergeSetMode(wizard, 'add');
    const tile = wizard.locator(`.merge-s1-target[data-tree="${targetId}"]`);
    await tile.click();
    await expect(tile.locator('input')).toBeChecked();
    return wizard;
}

/**
 * The guide on step 1 makes the import a new tree (spec 134 §3): New tree,
 * on to step 5, its primary creates the tree (named after the file; `name`
 * renames it afterwards). Resolves once the guide is closed and the new tree
 * is the open one.
 */
export async function mergeCreateNewTree(page: Page, wizard: Locator, name?: string): Promise<string> {
    const before: string[] = await page.evaluate(() => window.Strom.TreeManager.getTrees().map((t: { id: string }) => t.id));
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '1');
    await mergeSetMode(wizard, 'new');
    await wizard.locator('#merge-next').click();
    await expect(mergeCurrentStep(wizard)).toHaveAttribute('data-step', '5');
    await wizard.locator('#merge-next').click();
    await expect(wizard).toBeHidden();
    const id = await page.evaluate((before) =>
        window.Strom.TreeManager.getTrees().find((t: { id: string }) => !before.includes(t.id))?.id, before);
    expect(id, 'a new tree').toBeTruthy();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(id);
    if (name) {
        await page.evaluate(({ id, name }) => {
            window.Strom.TreeManager.renameTree(id as never, name);
            window.Strom.UI.updateTreeSwitcher();
        }, { id: id!, name });
    }
    return id!;
}

/**
 * A GEDCOM file imported as a new tree through the import guide: the file
 * read, then `mergeCreateNewTree`. `inStep1` runs on step 1 first (the
 * file's summary is there: images, media, encoding).
 */
export async function importGedcomAsNewTree(page: Page, file: string,
    opts: { name?: string; inStep1?: (wizard: Locator) => Promise<void> } = {}): Promise<string> {
    await page.locator('#gedcom-input').setInputFiles(file);
    const wizard = page.locator('#merge-modal');
    await expect(wizard).toBeVisible();
    if (opts.inStep1) await opts.inStep1(wizard);
    return mergeCreateNewTree(page, wizard, opts.name);
}

/**
 * Write (`mergeWrite`) and accept "Switch to the new tree?" after "Merge
 * complete": resolves with the new tree's id and name once it is the active tree.
 */
export async function mergeWriteAndSwitch(page: Page, wizard: Locator): Promise<{ id: string; name: string }> {
    const before: string[] = await page.evaluate(() => window.Strom.TreeManager.getTrees().map((t: { id: string }) => t.id));
    await mergeWrite(wizard);
    await expect(wizard).toBeHidden();
    await expect(page.locator('#confirm-title')).toHaveText('Merge complete');
    await page.locator('#confirmation-modal.active #confirm-ok-btn').click();
    const tree = await page.evaluate((before) =>
        window.Strom.TreeManager.getTrees().find((t: { id: string }) => !before.includes(t.id)) as { id: string; name: string } | undefined, before);
    expect(tree, 'a new tree').toBeTruthy();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(tree!.id);
    return { id: tree!.id, name: tree!.name };
}

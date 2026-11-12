import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * The satellite window's states (spec 079 §3): the view's skeleton until the
 * tree comes ("Loading the tree…" only after 300 ms, the header muted); the
 * read-only strip while the main window follows a live research; the amber
 * strip once the main window closed (not on its reload), before the live one,
 * with "Make this the main window" (the window starts again as the main one
 * with its tree and the Table; the lock held by another window: nothing) and
 * "Open Strom"; a refused edit (a toast, the cell's text kept as a draft;
 * the person dialog again with its fields); another tree in the main window
 * (a toast, the view stays); the tree deleted; the tree locked (after the
 * unlock the tree is shown again). A second tab becomes the main window once
 * the main window closed.
 *
 * The clock is installed (it runs): the silence of a closed main window is
 * measured with it, and the strip says the time.
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const PERSONS = {
    v: person('v', 'Bořivoj', 'Vrtišek', { birthDate: '1850-03-01', birthPlace: 'Lopuchov', partnerships: ['u1'], childIds: ['c'] }),
    k: person('k', 'Kunhuta', 'Hrnčíříková', { gender: 'female', birthDate: '1852-04-05', partnerships: ['u1'], childIds: ['c'] }),
    c: person('c', 'Celestýn', 'Vrtišek', { birthDate: '1875-06-07', parentIds: ['v', 'k'] }),
};
const PARTNERSHIPS = {
    u1: { id: 'u1', person1Id: 'v', person2Id: 'k', childIds: ['c'], status: 'married' },
};
const OTHER = { o: person('o', 'Radomil', 'Pastiňák', { birthDate: '1901-02-03' }) };
const PASSWORD = 'linden-tree-42';
const NOW = new Date('2026-06-15T10:00:00Z');

async function installClock(context: BrowserContext): Promise<void> {
    await context.clock.install({ time: NOW });
}

async function importTree(page: Page, persons: Record<string, unknown>, partnerships: Record<string, unknown>, name: string): Promise<string> {
    return page.evaluate(async ({ persons, partnerships, name }) => {
        const dm = window.Strom.DataManager;
        await dm.importAsNewTree({ persons, partnerships } as never, name);
        return dm.getCurrentTreeId() as string;
    }, { persons, partnerships, name });
}

async function openMain(page: Page): Promise<string> {
    await openApp(page);
    const treeId = await importTree(page, PERSONS, PARTNERSHIPS, 'Vrtišek');
    await page.evaluate(() => window.Strom.TreeRenderer.setFocus('c' as never));
    await expect(card(page, 'Celestýn')).toBeVisible();
    return treeId;
}

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);
const strip = (page: Page) => page.locator('.sat-strip');
const empty = (page: Page) => page.locator('.sat-empty');
const skeleton = (page: Page) => page.locator('.sat-skeleton');
const toast = (page: Page, text: string | RegExp) => page.locator('.toast', { hasText: text });

/** A satellite of the main window's tree; `opener`: opened by the main window, as ⧉ does (a window a script may close). */
async function openSatellite(context: BrowserContext, treeId: string, opener?: Page): Promise<Page> {
    const url = `/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=t1`;
    let sat: Page;
    if (opener) {
        const popup = opener.waitForEvent('popup');
        await opener.evaluate((u) => { window.open(u, 'strom-w-t1'); }, url);
        sat = await popup;
    } else {
        sat = await context.newPage();
        await sat.goto(url);
    }
    await expect(tv(sat, '.tv-status-count')).toHaveText('3 of 3 people');
    await expect(tv(sat, '.tv-status-ro')).toBeHidden();
    await expect(strip(sat)).toBeHidden();
    return sat;
}

/** A body cell of a row by its column's id. */
async function cell(page: Page, key: string, colId: string) {
    const head = tv(page, '.tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return tv(page, `.tv-body .tv-row[data-key="${key}"] [aria-colindex="${index}"]`);
}

const birthPlace = (page: Page, id: string) => page.evaluate((pid) => window.Strom.DataManager.getPerson(pid as never)?.birthPlace, id);

/** The main window's registry posts no messages of `type` until `release` (a patch held back: the satellite edits on an old revision). */
async function holdMessages(main: Page, type: string, delayMs: number | null): Promise<void> {
    await main.evaluate(({ type, delayMs }) => {
        const reg = window.Strom.Windows as unknown as { bus: { post: (m: { type: string }) => void } };
        const w = window as unknown as { __origPost?: (m: { type: string }) => void };
        w.__origPost ??= reg.bus.post.bind(reg.bus);
        const post = w.__origPost;
        reg.bus.post = (m) => {
            if (m.type !== type) { post(m); return; }
            if (delayMs !== null) setTimeout(() => post(m), delayMs);
        };
    }, { type, delayMs });
}

async function releaseMessages(main: Page): Promise<void> {
    await main.evaluate(() => {
        const reg = window.Strom.Windows as unknown as { bus: { post: (m: unknown) => void } };
        const w = window as unknown as { __origPost?: (m: unknown) => void };
        if (w.__origPost) reg.bus.post = w.__origPost;
    });
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('1 loading: the skeleton until the tree comes, its label only after 300 ms, the header muted', async ({ page, context }) => {
        await installClock(context);
        const treeId = await openMain(page);
        await holdMessages(page, 'tree', 1500);
        const sat = await context.newPage();
        await sat.addInitScript(() => {
            const log: { what: string; at: number }[] = [];
            (window as unknown as { __loadLog: typeof log }).__loadLog = log;
            new MutationObserver(() => {
                const sk = document.querySelector('.sat-skeleton') as HTMLElement | null;
                const label = document.querySelector('.sat-loading-label');
                if (sk && !sk.hidden && !log.some(l => l.what === 'skeleton')) log.push({ what: 'skeleton', at: performance.now() });
                if (label?.classList.contains('is-shown') && !log.some(l => l.what === 'label')) log.push({ what: 'label', at: performance.now() });
            }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
        });
        await sat.goto(`/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=t1`);
        await expect(skeleton(sat)).toBeVisible();
        await expect(sat.locator('.sat-loading-label')).toHaveText('Loading the tree…');
        await expect(sat.locator('.sat-loading-label')).toBeVisible();
        await expect(sat.locator('html')).toHaveClass(/\bsat-muted\b/);
        await expect(sat.locator('#tree-container')).toHaveAttribute('aria-hidden', 'true');
        const log = await sat.evaluate(() => (window as unknown as { __loadLog: { what: string; at: number }[] }).__loadLog);
        const at = (what: string) => log.find(l => l.what === what)!.at;
        expect(at('label') - at('skeleton')).toBeGreaterThanOrEqual(250);

        await expect(tv(sat, '.tv-status-count')).toHaveText('3 of 3 people');
        await expect(skeleton(sat)).toBeHidden();
        await expect(sat.locator('html')).not.toHaveClass(/\bsat-muted\b/);
        await expect(sat.locator('#tree-container')).not.toHaveAttribute('aria-hidden', 'true');
    });

    test('2 and 3: read-only while the main window follows a live research; the main window\'s reload shows nothing, its close the amber strip before the live one', async ({ page, context }) => {
        await installClock(context);
        const treeId = await openMain(page);
        const sat = await openSatellite(context, treeId);

        // 2: live research in the main window.
        await page.evaluate(() => window.Strom.DataManager.setLiveTree(window.Strom.DataManager.getCurrentTreeId()));
        await expect(strip(sat)).toBeVisible();
        await expect(strip(sat)).toHaveText(/Read-only · the main window is following research/);
        await expect(strip(sat).getByRole('button', { name: 'Go to the main window' })).toBeVisible();
        await expect(strip(sat)).not.toHaveClass(/sat-strip--amber/);
        await expect(tv(sat, '.tv-status-ro')).toBeVisible();
        // The view moves down by the strip's height.
        const stripBox = (await strip(sat).boundingBox())!;
        const viewTop = await sat.locator('#tree-container').evaluate(el => el.getBoundingClientRect().top);
        expect(viewTop).toBeGreaterThanOrEqual(stripBox.y + stripBox.height - 1);
        await page.evaluate(() => window.Strom.DataManager.setLiveTree(null));
        await expect(strip(sat)).toBeHidden();
        await expect(tv(sat, '.tv-status-ro')).toBeHidden();

        // A reload (F5) of the main window: no strip meanwhile, none after.
        let seen = false;
        const watch = setInterval(() => { void strip(sat).isVisible().then((v) => { if (v) seen = true; }).catch(() => {}); }, 100);
        await page.reload();
        await expect(card(page, 'Celestýn')).toBeVisible();
        await sat.waitForTimeout(4500);
        clearInterval(watch);
        expect(seen).toBe(false);
        await expect(strip(sat)).toBeHidden();

        // 3 before 2: the main window follows a live research, then closes.
        await page.evaluate(() => window.Strom.DataManager.setLiveTree(window.Strom.DataManager.getCurrentTreeId()));
        await expect(strip(sat)).toHaveText(/Read-only/);
        const closedAt = Date.now();
        await page.close();
        await expect(strip(sat)).toHaveClass(/sat-strip--amber/, { timeout: 4500 });
        expect(Date.now() - closedAt).toBeLessThan(4500);
        await expect(strip(sat)).toHaveText(/The main window is closed · as of \d{1,2}:\d{2}.*, read-only/);
        await expect(strip(sat).getByRole('button', { name: 'Make this the main window' })).toBeVisible();
        await expect(strip(sat).getByRole('button', { name: 'Open Strom' })).toBeVisible();
        await expect(strip(sat).getByRole('button', { name: 'Go to the main window' })).toHaveCount(0);
        // The copy stays, read-only.
        await expect(tv(sat, '.tv-status-count')).toHaveText('3 of 3 people');
        await expect(tv(sat, '.tv-status-ro')).toBeVisible();

        // "Open Strom": a new main window at the app's own address.
        const opened = context.waitForEvent('page');
        await strip(sat).getByRole('button', { name: 'Open Strom' }).click();
        const fresh = await opened;
        await fresh.waitForLoadState('domcontentloaded');
        expect(new URL(fresh.url()).pathname).toBe('/strom.html');
        expect(new URL(fresh.url()).search).toBe('');
        await expect(fresh.locator('.toolbar')).toBeVisible();
        // It is the main window again: the satellite hears it.
        await expect(strip(sat)).toBeHidden({ timeout: 6000 });
    });

    test('3 "Make this the main window": the lock held by another window does nothing; free, the window starts as the main one with its tree and the Table', async ({ page, context }) => {
        await installClock(context);
        const treeId = await openMain(page);
        const sat = await openSatellite(context, treeId);
        await page.close();
        await expect(strip(sat)).toHaveClass(/sat-strip--amber/, { timeout: 4500 });

        // Another window (of the same origin) takes the lock meanwhile.
        const other = await context.newPage();
        await other.route('**/lock-holder.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
        await other.goto('/lock-holder.html');
        await other.evaluate(() => new Promise<void>((resolve) => {
            void navigator.locks.request('strom-main', { ifAvailable: true }, (lock) => {
                resolve();
                return lock ? new Promise(() => {}) : undefined;
            });
        }));
        await sat.evaluate(() => { (window as unknown as { __stay: number }).__stay = 1; });
        await strip(sat).getByRole('button', { name: 'Make this the main window' }).click();
        await sat.waitForTimeout(800);
        expect(await sat.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);
        await expect(sat.locator('html')).toHaveClass(/\bwindow-satellite\b/);
        await expect(strip(sat)).toBeVisible();

        // The lock free again: the window becomes the main one (a reload), its tree and the Table kept.
        await other.close();
        await strip(sat).getByRole('button', { name: 'Make this the main window' }).click();
        await expect(sat.locator('.toolbar')).toBeVisible({ timeout: 10000 });
        await expect(sat.locator('html')).not.toHaveClass(/\bwindow-satellite\b/);
        await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
        expect(new URL(sat.url()).searchParams.get('okno')).toBeNull();
        await expect(strip(sat)).toHaveCount(0);
        expect(await sat.evaluate(() => window.Strom.DataManager.getCurrentTreeId())).toBe(treeId);
        expect(await sat.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('table');
        await expect(tv(sat, '.tv-status-count')).toHaveText('3 of 3 people');
        expect(await sat.evaluate(() => !!window.Strom.Windows)).toBe(true);
        expect(await sat.evaluate(() => sessionStorage.getItem('strom.win.becomeMain'))).toBeNull();

        // A new satellite gets its tree from it.
        const sat2 = await openSatellite(context, treeId);
        await expect(tv(sat2, '.tv-status-count')).toHaveText('3 of 3 people');
    });

    test('4 a refused edit: a toast, the fresh data, the cell\'s text kept as a draft (Esc discards, Enter applies)', async ({ page, context }) => {
        await installClock(context);
        const treeId = await openMain(page);
        const sat = await openSatellite(context, treeId);

        // The main window changes the tree; the satellite does not get the patch and edits on the old revision.
        await holdMessages(page, 'patch', null);
        await page.evaluate(() => window.Strom.DataManager.updatePerson('k' as never, { birthPlace: 'Fazolín' } as never));
        await (await cell(sat, 'p:v', 'bPlace')).dblclick();
        await tv(sat, '.tv-editor-input').fill('Kapustov');
        await tv(sat, '.tv-editor-input').press('Enter');

        await expect(toast(sat, 'The tree changed in another window meanwhile.')).toBeVisible();
        // Fresh data from the main window; this edit not applied anywhere.
        await expect.poll(() => birthPlace(sat, 'k')).toBe('Fazolín');
        expect(await birthPlace(page, 'v')).toBe('Lopuchov');
        // The text typed is back in the cell's editor, framed as a draft.
        await expect(tv(sat, '.tv-editor.is-draft-kept')).toBeVisible();
        await expect(tv(sat, '.tv-editor-input')).toHaveValue('Kapustov');
        await expect(tv(sat, '.tv-draft-kept')).toHaveText('Draft kept · Enter applies, Esc discards');
        await expect(tv(sat, '.tv-editor-input')).toBeFocused();

        // Esc discards it.
        await tv(sat, '.tv-editor-input').press('Escape');
        await expect(tv(sat, '.tv-editor')).toHaveCount(0);
        await expect(tv(sat, '.tv-draft-kept')).toHaveCount(0);
        expect(await birthPlace(page, 'v')).toBe('Lopuchov');

        // Once more; Enter applies it as a new edit.
        await page.evaluate(() => window.Strom.DataManager.updatePerson('k' as never, { birthPlace: 'Cibulín' } as never));
        await (await cell(sat, 'p:v', 'bPlace')).dblclick();
        await tv(sat, '.tv-editor-input').fill('Kapustov');
        await tv(sat, '.tv-editor-input').press('Enter');
        await expect(tv(sat, '.tv-editor.is-draft-kept')).toBeVisible();
        await expect(tv(sat, '.tv-editor-input')).toHaveValue('Kapustov');
        await tv(sat, '.tv-editor-input').press('Enter');
        await expect.poll(() => birthPlace(page, 'v')).toBe('Kapustov');
        expect(await birthPlace(page, 'k')).toBe('Cibulín');
        await expect(tv(sat, '.tv-editor')).toHaveCount(0);
    });

    test('4 a refused edit of the person dialog: it opens again with the fields typed and the conflict at its top', async ({ page, context }) => {
        await installClock(context);
        const treeId = await openMain(page);
        const sat = await openSatellite(context, treeId);
        await holdMessages(page, 'patch', null);
        await page.evaluate(() => window.Strom.DataManager.updatePerson('k' as never, { birthPlace: 'Fazolín' } as never));

        await sat.evaluate(() => window.Strom.UI.showEditPersonModal('v' as never));
        const modal = sat.locator('#person-modal');
        await expect(modal).toBeVisible();
        await modal.locator('#input-birthplace').fill('Kapustov');
        await modal.getByRole('button', { name: 'Save' }).click();

        await expect(toast(sat, 'The tree changed in another window meanwhile.')).toBeVisible();
        await expect(modal).toBeVisible();
        await expect(modal.locator('.pm-window-conflict')).toHaveText('The tree changed in another window meanwhile. The edit was not applied; the data is refreshed.');
        await expect(modal.locator('#input-birthplace')).toHaveValue('Kapustov');
        await expect.poll(() => birthPlace(sat, 'k')).toBe('Fazolín');
        expect(await birthPlace(page, 'v')).toBe('Lopuchov');

        // Save again: a new edit on the fresh revision.
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect.poll(() => birthPlace(page, 'v')).toBe('Kapustov');
        // Opened again later: no stale notice.
        await sat.evaluate(() => window.Strom.UI.showEditPersonModal('k' as never));
        await expect(modal).toBeVisible();
        await expect(modal.locator('.pm-window-conflict')).toHaveCount(0);
    });

    test('5a another tree in the main window: a toast, the view stays; 5b the tree deleted: Close window', async ({ page, context }) => {
        await installClock(context);
        const treeId = await openMain(page);
        const otherId = await importTree(page, OTHER, {}, 'Pastiňák');
        await page.evaluate((id) => window.Strom.UI.switchToTree(id as never), treeId);
        await expect(card(page, 'Celestýn')).toBeVisible();
        const sat = await openSatellite(context, treeId, page);
        await sat.evaluate(() => window.Strom.TreeRenderer.setFocus('v' as never));

        // 5a.
        await page.evaluate((id) => window.Strom.UI.switchToTree(id as never), otherId);
        await expect(toast(sat, 'Vrtišek → Pastiňák')).toBeVisible();
        await expect(tv(sat, '.tv-status-count')).toHaveText('1 of 1 person');
        expect(await sat.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('table');
        await expect(tv(sat, '.tv-body .tv-row[aria-selected="true"]')).toHaveCount(0);
        await expect(sat).toHaveTitle(/Pastiňák/);
        await expect(strip(sat)).toBeHidden();

        // 5b: back to the first tree, then it is deleted in the main window.
        await page.evaluate((id) => window.Strom.UI.switchToTree(id as never), treeId);
        await expect(tv(sat, '.tv-status-count')).toHaveText('3 of 3 people');
        await page.evaluate(async (id) => {
            const { TreeManager, DataManager } = window.Strom;
            await TreeManager.deleteTree(id as never);
            await DataManager.switchTree(TreeManager.getActiveTreeId()!);
        }, treeId);
        await expect(empty(sat)).toBeVisible();
        await expect(empty(sat).getByRole('heading', { name: 'The tree no longer exists' })).toBeVisible();
        await expect(empty(sat)).toContainText('It was deleted in the main window.');
        await expect(empty(sat).getByRole('button', { name: 'Close window' })).toBeVisible();
        await expect(sat.locator('html')).toHaveClass(/\bsat-muted\b/);
        await expect(sat.locator('#tree-container')).toHaveAttribute('aria-hidden', 'true');
        const closed = sat.waitForEvent('close');
        await empty(sat).getByRole('button', { name: 'Close window' }).click();
        await closed;
    });

    test('6 the tree locked in the main window: the state with Go to the main window; after the unlock the tree comes again', async ({ page, context }) => {
        await installClock(context);
        const treeId = await openMain(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const settings = page.locator('#settings-modal');
        await settings.locator('#encryption-toggle').check();
        const setup = page.locator('#password-setup-modal');
        await setup.locator('#password-setup-input').fill(PASSWORD);
        await setup.locator('#password-setup-confirm').fill(PASSWORD);
        await setup.getByRole('button', { name: 'Save' }).click();
        await expect(settings.locator('#encryption-status')).toHaveText('Encryption enabled');
        await page.evaluate(() => window.Strom.TreeManager.flush());
        await page.keyboard.press('Escape');
        const sat = await openSatellite(context, treeId);

        // The main window reloads and the password is not entered.
        await page.reload();
        const prompt = page.locator('#password-prompt-modal');
        await expect(prompt).toBeVisible();
        await prompt.getByRole('button', { name: 'Cancel' }).click();
        await expect(page.locator('#locked-data-notice')).toBeVisible();

        await expect(empty(sat)).toBeVisible();
        await expect(empty(sat).getByRole('heading', { name: 'The tree is locked' })).toBeVisible();
        await expect(empty(sat)).toContainText('The password is entered in the main window.');
        await expect(empty(sat).getByRole('button', { name: 'Go to the main window' })).toBeVisible();
        await expect(strip(sat)).toBeHidden();
        await expect(sat.locator('#tree-container')).toHaveAttribute('aria-hidden', 'true');
        await expect(sat.getByText('Celestýn')).toHaveCount(0);

        // Unlocked: the tree comes again.
        await page.locator('#locked-data-notice').getByRole('button', { name: 'Unlock' }).click();
        await prompt.locator('#password-prompt-input').fill(PASSWORD);
        await prompt.locator('#password-prompt-input').press('Enter');
        await expect(card(page, 'Celestýn')).toBeVisible();
        await expect(empty(sat)).toBeHidden();
        await expect(tv(sat, '.tv-status-count')).toHaveText('3 of 3 people');
        await expect(skeleton(sat)).toBeHidden();
        await expect(sat.locator('#tree-container')).not.toHaveAttribute('aria-hidden', 'true');
    });

    test('§5 a second tab becomes the main window once the main window closed (not on its reload)', async ({ page, context }) => {
        await installClock(context);
        const treeId = await openMain(page);
        const tab = await context.newPage();
        await tab.goto('/strom.html');
        await expect(tab.locator('main.second-tab')).toBeVisible();

        // A reload of the main window: the tab stays as it is.
        await page.reload();
        await expect(card(page, 'Celestýn')).toBeVisible();
        await tab.waitForTimeout(4500);
        await expect(tab.locator('main.second-tab')).toBeVisible();

        await page.close();
        await expect(tab.locator('.toolbar')).toBeVisible({ timeout: 10000 });
        await expect(tab.locator('main.second-tab')).toHaveCount(0);
        await expect(tab.locator('html')).not.toHaveClass(/app-loading/);
        await expect(card(tab, 'Celestýn')).toBeVisible();
        expect(await tab.evaluate(() => window.Strom.DataManager.getCurrentTreeId())).toBe(treeId);
        expect(await tab.evaluate(() => !!window.Strom.Windows)).toBe(true);
    });
});

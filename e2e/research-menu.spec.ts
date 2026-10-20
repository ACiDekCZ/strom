import { test, expect, Page } from '@playwright/test';
import { FakeBridge, NEW_HEAD, block, fakeBridge, fakePhone, openResearch, openResearchMenu, poll, researchGed, signal } from './research-bridge.js';

/**
 * The toolbar's Research button and menu (U04): left of Actions, the menu on
 * the first level (state on top, then the actions by how often they are
 * used), one signal on the button, the keyboard (arrows over every item,
 * Home / End, ← / → to Actions, Escape back to what opened it), the More
 * sheet's research group in a narrow window with a mouse, and the button
 * hidden up to 1024 px. Invented data; the bridge is answered by page.route.
 */

const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const WAITING = [{ id: 'T0001', what: 'Confirm a baptism' }, { id: 'T0002', what: 'Which register?' }, { id: 'T0003', what: 'A new version of the story' }];
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat'];

/** A research tree tied to a running research that says what it takes (sent by hand). */
async function researchTree(page: Page, opts: { edit?: boolean; waiting?: unknown[]; head?: string } = {}): Promise<FakeBridge> {
    await openResearch(page, { edit: opts.edit });
    const bridge = await fakeBridge(page, { accepts: ACCEPTS, links: LINKS, waiting: opts.waiting ?? [],
        ...(opts.head ? { head: opts.head, treeGed: researchGed(opts.head) } : {}) });
    await poll(page);
    await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
    return bridge;
}

const menu = (page: Page) => page.locator('#research-menu');
const button = (page: Page) => page.locator('#research-menu-btn');
/** The first level: the items above "Other actions" and the row itself. */
const firstLevel = (page: Page) => page.locator('#research-menu > .research-menu-group > .tree-switcher-action .research-item-label');
const FOOT_SENTENCE = 'Continues in the research on this computer. Nothing is written or paid without confirmation there.';
const focusedId = (page: Page) => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? el.id || el.dataset.action || el.className : '';
});

test.describe('the Research button and menu', () => {
    test('left of Actions; the menu under it (right edges level): the state block, at most six items and "Other actions", the footer', { tag: '@smoke' }, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page, { waiting: WAITING });
        const btn = button(page);
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
        await expect(btn).toHaveAttribute('aria-controls', 'research-menu');
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
        // Right before Actions in the toolbar; the chevron above 1280 px.
        expect(await btn.evaluate(b => b.parentElement?.nextElementSibling?.classList.contains('actions-menu'))).toBe(true);
        await expect(btn.locator('.research-menu-chevron')).toBeVisible();
        await btn.click();
        await expect(menu(page)).toBeVisible();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        await expect(btn).toHaveClass(/is-open/);
        const [b, m] = await Promise.all([btn.boundingBox(), menu(page).boundingBox()]);
        expect(m!.y).toBeGreaterThan(b!.y + b!.height - 1);
        expect(Math.abs((m!.x + m!.width) - (b!.x + b!.width))).toBeLessThan(2);
        expect(m!.width).toBeCloseTo(320, 0);
        // No heading (the button says "Research"): the state block, the items, "Other actions" folded, the footer.
        await expect(menu(page).locator('.research-menu-heading')).toHaveCount(0);
        await expect(menu(page)).toHaveAttribute('aria-label', 'Research');
        expect(await menu(page).evaluate(el => Array.from(el.children).map(c => c.className.split(' ')[0])))
            .toEqual(['research-sync-block', 'research-menu-group', 'research-menu-more', 'research-menu-foot']);
        await expect(firstLevel(page)).toHaveText(['Awaiting action', 'Continue with the agent', 'Open research', 'Send changes', 'Other actions']);
        expect((await page.locator('#research-item-open').boundingBox())!.height).toBeGreaterThanOrEqual(34);
        const more = page.locator('#research-item-more');
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        await expect(more).toHaveAttribute('aria-controls', 'research-menu-more');
        await expect(page.locator('#research-menu-more')).toBeHidden();
        await expect(page.locator('#research-menu-more')).toHaveAttribute('role', 'group');
        // The block is a group named by its title; its text a live region, its buttons items outside it.
        await expect(block(page)).toHaveAttribute('role', 'group');
        expect(await block(page).getAttribute('aria-label')).toBe((await block(page).locator('.research-sync-title').textContent())?.trim());
        await expect(block(page).locator('[role="status"][aria-live="polite"]')).toHaveCount(1);
        await expect(block(page).locator('[role="status"] [role="menuitem"]')).toHaveCount(0);
        // What continues in the research says so to a screen reader too.
        await expect(page.locator('#research-item-open')).toHaveAttribute('aria-description', FOOT_SENTENCE);
        await expect(page.locator('#research-item-waiting')).not.toHaveAttribute('aria-description', /./);
        // The footer: "trial" and what ↗ means (the whole sentence on hover); not an item itself.
        const foot = page.locator('#research-menu-foot');
        await expect(foot).toHaveAttribute('role', 'none');
        await expect(foot).toHaveAttribute('title', FOOT_SENTENCE);
        await expect(foot.locator('.research-trial-tag')).toHaveText('trial');
        await expect(foot.locator('.research-menu-foot-text')).toHaveText('↗ continues in the research');
        // "Other actions" by mouse: opens in place, the menu stays open; again: folds.
        await more.click();
        await expect(menu(page)).toBeVisible();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#research-menu-more')).toBeVisible();
        await expect(page.locator('#research-menu-more .research-item-label')).toHaveText(['Follow live', 'Research for this tree…']);
        await expect(page.locator('#research-menu-more .research-menu-group.is-quiet .research-item-label')).toHaveText(['Research for this tree…']);
        // Its items stand indented under the row.
        const [rowBox, liveBox] = await Promise.all([more.locator('.research-item-label').boundingBox(), page.locator('#research-item-live .research-item-label').boundingBox()]);
        expect(liveBox!.x - rowBox!.x).toBeGreaterThanOrEqual(12);
        // "Settings in the research ↗" is in the Research for this tree dialog, not a row.
        await expect(page.locator('#research-item-setup')).toHaveCount(0);
        await more.click();
        await expect(page.locator('#research-menu-more')).toBeHidden();
        // A click outside closes it; Actions and Research never open together.
        await page.mouse.click(200, 600);
        await expect(menu(page)).toBeHidden();
        await btn.click();
        await page.locator('.actions-menu-btn').click();
        await expect(menu(page)).toBeHidden();
        await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
        await btn.click();
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
        await expect(menu(page)).toBeVisible();
        // An item done closes the menu; opened again, "Other actions" is folded.
        await page.locator('#research-item-open').click();
        await expect(menu(page)).toBeHidden();
        await btn.click();
        await expect(page.locator('#research-menu-more')).toBeHidden();
    });

    test('nothing in the menu continues in the research: the footer has "trial" only, no "↗ continues…" (D8)', async ({ page }) => {
        await researchTree(page);
        const foot = await page.evaluate(() => {
            const host = document.createElement('div');
            const ui = window.Strom.UI as unknown as { researchMenuHtml(model: unknown): string };
            const item = (id: string, ext = false) => ({ id, label: id, method: 'researchActionOpen', ext });
            const model = (ext: boolean) => ({ foot: true, blocks: '', first: [item('a'), item('b', ext)], more: [], moreQuiet: [], moreAttention: '', note: 'Sentence.', waiting: 0 });
            const read = (ext: boolean) => {
                host.innerHTML = ui.researchMenuHtml(model(ext));
                const f = host.querySelector('#research-menu-foot')!;
                return { tag: f.querySelector('.research-trial-tag')?.textContent, text: f.querySelector('.research-menu-foot-text')?.textContent ?? null, title: f.getAttribute('title') };
            };
            return { without: read(false), with: read(true) };
        });
        expect(foot.without).toEqual({ tag: 'trial', text: null, title: null });
        expect(foot.with).toEqual({ tag: 'trial', text: '↗ continues in the research', title: 'Sentence.' });
    });

    test('"Research for this tree…" holds "Settings in the research ↗" (no menu row for it)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await openResearchMenu(page, { expandMore: true });
        await page.locator('#research-item-tree-settings').click();
        await expect(page.locator('#research-settings-in-research')).toBeVisible();
        await expect(page.locator('#research-settings-in-research')).toContainText('Settings in the research');
    });

    test('a phone whose connection fails moves up from "Other actions" and lights the button\'s dot (D7)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openResearch(page);
        await fakeBridge(page, { accepts: ACCEPTS, links: LINKS, features: ['phone'],
            phone: fakePhone({ state: 'error', error: { code: 'port-busy', detail: 'EADDRINUSE' } }) });
        await poll(page);
        await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
        expect(await signal(page)).toBe('attention');
        await button(page).click();
        await expect(firstLevel(page)).toHaveText(['Continue with the agent', 'Open research', 'Send changes', 'Phone', 'Other actions']);
        await expect(page.locator('#research-menu > .research-menu-group #research-item-phone .research-item-pill')).toHaveText('connection problem');
        await expect(page.locator('#research-menu-more #research-item-phone')).toHaveCount(0);
    });

    test('"Send changes" goes from the rows while the state block offers the send (Send, What will be sent), and is there when it does not', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await button(page).click();
        await expect(block(page)).toHaveAttribute('data-state', 'inSync');
        await expect(page.locator('#research-item-send')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { birthPlace: 'Brno' });
        });
        await button(page).click();
        await expect(block(page)).toHaveAttribute('data-state', 'unsent');
        await expect(block(page).locator('[data-action="send"]')).toBeVisible();
        await expect(page.locator('#research-item-send')).toHaveCount(0);
    });

    test('one signal on the button: the count before attention before changes not sent; the ⋯ dot is the anniversaries\' only', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const bridge = await researchTree(page, { edit: true });
        // Changes not sent: the dot, and the button says so.
        expect(await signal(page)).toBe('unsent');
        await expect(button(page)).toHaveAttribute('aria-label', 'Research – changes from the app not yet in the research');
        await expect(page.locator('#actions-menu-dot')).toBeHidden();
        // The research has a newer version too: the state asks for the user (still one dot).
        bridge.head = NEW_HEAD;
        bridge.treeGed = researchGed(NEW_HEAD);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
        expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('unsentAndNewer');
        expect(await signal(page)).toBe('attention');
        await expect(page.locator('#research-menu-signal')).toHaveText('');
        // Tasks waiting: their count wins.
        bridge.waiting = WAITING;
        await poll(page);
        await page.evaluate(() => window.Strom.UI.refreshActionMenuBadges());
        expect(await signal(page)).toBe('count');
        await expect(page.locator('#research-menu-signal')).toHaveText('3');
        await expect(button(page)).toHaveAttribute('aria-label', 'Research, awaiting action: 3');
        await expect(page.locator('#actions-menu-dot')).toBeHidden();
        expect(await page.locator('#research-menu-signal').count()).toBe(1);
    });

    test('a tree locked by hand: no state block and no "following live" line (that is only for following live)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await page.evaluate(() => {
            const tm = window.Strom.TreeManager;
            tm.toggleTreeLock(tm.getActiveTreeId()!);
        });
        expect(await page.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
        await button(page).click();
        await expect(menu(page)).toBeVisible();
        await expect(block(page)).toHaveCount(0);
        await expect(page.locator('#research-menu-following')).toHaveCount(0);
        await expect(button(page).locator('.research-menu-live')).toBeHidden();
    });

    test('locked data: no Research button (nothing of the research behind a lock)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await expect(button(page)).toBeVisible();
        await page.evaluate(() => {
            window.Strom.DataManager.isLocked = () => true;
            window.Strom.UI.refreshActionMenuBadges();
        });
        await expect(button(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.UI.researchMenuShown())).toBe(false);
    });

    test('up to 1280 px the word stays without the chevron; the toolbar keeps it whole', async ({ page }) => {
        await page.setViewportSize({ width: 1100, height: 800 });
        await researchTree(page, { waiting: WAITING });
        await expect(button(page)).toBeVisible();
        await expect(button(page).locator('.research-menu-label')).toHaveText('Research');
        await expect(button(page).locator('.research-menu-chevron')).toBeHidden();
        await expect(page.locator('#research-menu-signal')).toBeVisible();
    });
});

test.describe('the state block on two lines (menu 1020 §2.2)', () => {
    const SEND = { cs: 'Poslat', de: 'Senden', en: 'Send' } as const;
    /** "What will be sent" first, the default outside these tests (openResearch skips it). */
    const previewFirst = (page: Page) => page.evaluate(() => {
        const key = `strom-research-auto:${window.Strom.TreeManager.getActiveTreeId()}`;
        const state = JSON.parse(localStorage.getItem(key) ?? '{}');
        delete state.skipPreview;
        localStorage.setItem(key, JSON.stringify(state));
    });
    const lines = (page: Page, sel: string) => block(page).locator(sel).evaluate(el => {
        const r = el.getBoundingClientRect();
        return Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight));
    });
    for (const lang of ['cs', 'de', 'en'] as const) {
        test(`${lang}: one short button ("${SEND[lang]}…"), title and facts each on one line, 44–58 px high`, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            await researchTree(page, { edit: true });
            await previewFirst(page);
            await page.evaluate((lang) => window.Strom.UI.setLanguage(lang), lang);
            await button(page).click();
            await expect(block(page)).toHaveAttribute('data-state', 'unsent');
            // One button: Send opens what will be sent, so no second link for it.
            await expect(block(page).locator('button')).toHaveCount(1);
            await expect(block(page).locator('button')).toHaveText(`${SEND[lang]}…`);
            await expect(block(page).locator('[data-action="showChanges"]')).toHaveCount(0);
            await expect(page.locator('#research-item-changes')).toHaveCount(0);
            expect(await lines(page, '.research-sync-title')).toBe(1);
            expect(await lines(page, '.research-sync-sub')).toBe(1);
            // With room to spare: a font drawn a little wider (Linux, Windows) must not wrap the title.
            const room = await block(page).evaluate(el => {
                const title = el.querySelector('.research-sync-title') as HTMLElement;
                const probe = title.cloneNode(true) as HTMLElement;
                probe.style.cssText = 'position: absolute; white-space: nowrap; width: auto';
                el.appendChild(probe);
                const need = probe.getBoundingClientRect().width;
                probe.remove();
                return (el.querySelector('.research-sync-status') as HTMLElement).getBoundingClientRect().width - need;
            });
            expect(room).toBeGreaterThanOrEqual(16);
            const height = (await block(page).boundingBox())!.height;
            expect(height).toBeGreaterThanOrEqual(44);
            expect(height).toBeLessThanOrEqual(58);
        });
    }

    test('Send that sends at once: "What will be sent…" is a row of "Other actions"', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page, { edit: true });
        await openResearchMenu(page, { expandMore: true });
        await expect(block(page).locator('button')).toHaveText(['Send']);
        const row = page.locator('#research-menu-more #research-item-changes');
        await expect(row.locator('.research-item-label')).toHaveText('What will be sent…');
        await row.click();
        await expect(page.locator('#research-changes-panel')).toBeVisible();
    });
});

test.describe('the keyboard', () => {
    test('Enter opens it on the first item (the state block\'s button); arrows go over every shown item, Home / End; Escape back to the button', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page, { edit: true });
        await button(page).focus();
        await page.keyboard.press('Enter');
        await expect(menu(page)).toBeVisible();
        await expect(block(page).locator('[data-action="send"]')).toBeFocused();
        // The block's one button ("What will be sent" is a row of "Other actions" then).
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#research-item-chat')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#research-item-open')).toBeFocused();
        // Folded, the items of "Other actions" are skipped: from its row to the footer's "trial".
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#research-item-more')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu(page).locator('#research-menu-foot .research-trial-tag')).toBeFocused();
        await page.keyboard.press('Home');
        await expect(block(page).locator('[data-action="send"]')).toBeFocused();
        await page.keyboard.press('End');
        await expect(menu(page).locator('#research-menu-foot .research-trial-tag')).toBeFocused();
        // Round: back on the first one.
        await page.keyboard.press('ArrowDown');
        await expect(block(page).locator('[data-action="send"]')).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(menu(page).locator('#research-menu-foot .research-trial-tag')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu(page)).toBeHidden();
        await expect(button(page)).toBeFocused();
        // ↓ on the button opens it too.
        await page.keyboard.press('ArrowDown');
        await expect(menu(page)).toBeVisible();
        await expect(block(page).locator('[data-action="send"]')).toBeFocused();
        // Tab out: it closes.
        await page.keyboard.press('End');
        await page.keyboard.press('Tab');
        await expect(menu(page)).toBeHidden();
    });

    test('"Other actions" by keyboard: Enter or → opens it on its first item, ← or Enter on the row folds it back to the row', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await button(page).focus();
        await page.keyboard.press('Enter');
        const row = page.locator('#research-item-more');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await expect(row).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(row).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#research-item-live')).toBeFocused();
        // Its items are in the arrow order now.
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#research-item-tree-settings')).toBeFocused();
        // ← on one of them: folded, focus on the row (the menu stays, not switched to Actions).
        await page.keyboard.press('ArrowLeft');
        await expect(row).toHaveAttribute('aria-expanded', 'false');
        await expect(row).toBeFocused();
        await expect(menu(page)).toBeVisible();
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
        // → on the row: open on the first item; Enter on the row again: folded.
        await page.keyboard.press('ArrowRight');
        await expect(row).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#research-item-live')).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(row).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(row).toHaveAttribute('aria-expanded', 'false');
        await expect(row).toBeFocused();
        await expect(page.locator('#research-menu-more')).toBeHidden();
    });

    test('← / → switch between Research and Actions, never on the "Tree:" row (its flyout) ', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await researchTree(page);
        await button(page).focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('ArrowRight');
        await expect(menu(page)).toBeHidden();
        await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
        await expect(page.locator('#actions-ann-row')).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
        await expect(menu(page)).toBeVisible();
        expect(await focusedId(page)).toBe('research-item-chat');
        // On the "Tree:" row → opens its flyout and ← closes it (Actions stays open).
        await page.keyboard.press('ArrowRight');
        await page.locator('#actions-tree-row').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('#actions-tree-wrap')).toHaveClass(/submenu-open/);
        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#actions-tree-wrap')).not.toHaveClass(/submenu-open/);
        await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);
        await expect(menu(page)).toBeHidden();
    });

    test('opened from the toolbar pill: Escape puts focus back on the pill', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
        await researchTree(page);
        const mark = page.locator('#research-sync-mark');
        await expect(mark).toBeVisible();
        await mark.focus();
        await page.keyboard.press('Enter');
        await expect(menu(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu(page)).toBeHidden();
        await expect(mark).toBeFocused();
    });
});

test.describe('a narrow window with a mouse (≤ 1024 px)', () => {
    test('no Research button; More starts with the research group (state, Waiting, Agent, Read), "All research actions ›" shows the whole menu with "Other actions" open, Escape back', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 900 });
        await researchTree(page, { edit: true, waiting: WAITING });
        await expect(button(page)).toBeHidden();
        // The More tab carries the research's signal here.
        await expect(page.locator('#bottom-bar-more-dot')).toBeVisible();
        await page.locator('#bb-view-more').click();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        const items = sheet.locator('.bottom-sheet-items');
        // After the Undo | Redo tiles (and the storage state when it needs action), the group:
        // the title, the state in one line with its first action, the frequent ones, all of them.
        expect(await items.evaluate(el => {
            const kids = Array.from(el.children);
            const at = kids.findIndex(c => c.classList.contains('research-sheet-heading'));
            return kids.slice(0, at).map(c => c.className.split(' ').pop());
        })).toEqual(expect.arrayContaining(['bottom-sheet-pair']));
        expect(await items.evaluate(el => (el.firstElementChild as HTMLElement).className)).toContain('bottom-sheet-pair');
        await expect(items.locator('.research-sheet-heading')).toHaveCount(1);
        await expect(items.locator('.research-sheet-heading')).toContainText('Research');
        // "trial" on the right of the heading's line (D6), the line no taller for it.
        const heading = items.locator('.research-sheet-heading');
        const tag = heading.locator('.research-trial-tag');
        await expect(tag).toHaveText('trial');
        const [hb, tb] = [(await heading.boundingBox())!, (await tag.boundingBox())!];
        expect(hb.x + hb.width - (tb.x + tb.width)).toBeLessThanOrEqual(17);
        expect(hb.height).toBeLessThanOrEqual(34);
        await expect(page.locator('#research-sheet-state-text')).toHaveText('Not in the research yet');
        await expect(page.locator('#research-sheet-state [role="menuitem"]')).toHaveText('Send changes');
        const groupRows = await items.evaluate(el => {
            const out: string[] = [];
            const kids = Array.from(el.children);
            for (const c of kids.slice(kids.findIndex(k => k.classList.contains('research-sheet-heading')))) {
                if (c.classList.contains('bottom-sheet-divider')) break;
                if (c.matches('button.bottom-sheet-item')) out.push((c.querySelector('.bottom-sheet-label')?.textContent ?? '').trim());
            }
            return out;
        });
        // "Open research" waits on the second level (the toolbar's pill leads there too).
        expect(groupRows).toEqual(['Awaiting action', 'Continue with the agent', 'All research actions']);
        // Not "Ancestor research" beside it: this tree has its research.
        await expect(sheet).not.toContainText('Ancestor research');
        const all = page.locator('#research-sheet-all');
        await all.click();
        // The same sheet, its page: ‹ back, the whole menu (one place only: no ids twice).
        await expect(sheet).toHaveCount(1);
        await expect(items).toBeHidden();
        const body = page.locator('#research-sheet-menu');
        await expect(body).toBeVisible();
        await expect(body.locator('.research-menu-back')).toBeVisible();
        expect((await body.locator('.research-menu-back').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(page.locator('#research-sync-block')).toHaveCount(1);
        await expect(body.locator('#research-sync-block')).toHaveCount(1);
        await expect(page.locator('#research-menu #research-sync-block')).toHaveCount(0);
        await expect(body.locator('.research-item-label').first()).toHaveText('Awaiting action');
        expect((await body.locator('#research-item-waiting').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        // Everything at hand there: "Other actions" open, the footer with "trial".
        await expect(body.locator('#research-item-more')).toHaveAttribute('aria-expanded', 'true');
        await expect(body.locator('#research-menu-more')).toBeVisible();
        await expect(body.locator('#research-item-live')).toBeVisible();
        await expect(body.locator('#research-menu-foot .research-trial-tag')).toHaveText('trial');
        // Escape: back to the list, focus on "All research actions"; a second one closes.
        await page.keyboard.press('Escape');
        await expect(items).toBeVisible();
        await expect(body).toBeHidden();
        await expect(all).toBeFocused();
        // ‹ back works the same; an item done closes the sheet.
        await all.click();
        await body.locator('.research-menu-back').click();
        await expect(all).toBeFocused();
        await all.click();
        await body.locator('#research-item-open').click();
        await expect(sheet).toHaveCount(0);
    });

    test('the button hidden at 1024 and 700 px (shown from 1025); what opens the menu from the state opens the sheet on its research page', async ({ page }) => {
        await page.setViewportSize({ width: 1025, height: 800 });
        await researchTree(page);
        await expect(button(page)).toBeVisible();
        for (const width of [1024, 700]) {
            await page.setViewportSize({ width, height: 800 });
            await expect(button(page)).toBeHidden();
        }
        await page.setViewportSize({ width: 900, height: 900 });
        await page.evaluate(() => window.Strom.UI.openResearchSyncMenu());
        await expect(page.locator('#research-sheet-menu')).toBeVisible();
        await expect(page.locator('#research-sheet-menu .research-menu-heading')).toContainText('Research');
        await expect(menu(page)).toBeHidden();
    });
});

test.describe('"Awaiting action" in every language', () => {
    for (const [lang, item, aria] of [
        ['cs', 'Čeká na vyřízení', 'Výzkum, čeká na vyřízení: 3'],
        ['de', 'Wartet auf Bearbeitung', 'Forschung, wartet auf Bearbeitung: 3'],
        ['en', 'Awaiting action', 'Research, awaiting action: 3'],
    ] as const) {
        test(`${lang}: the menu row and the button's name`, async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            await researchTree(page, { waiting: WAITING });
            await page.evaluate((lang) => window.Strom.UI.setLanguage(lang), lang);
            await expect(button(page)).toHaveAttribute('aria-label', aria);
            await button(page).click();
            await expect(page.locator('#research-item-waiting .research-item-label')).toHaveText(item);
            await expect(page.locator('#research-item-waiting')).toHaveAttribute('aria-label', `${item}: 3`);
        });
    }
});

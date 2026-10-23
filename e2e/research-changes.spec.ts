import { test, expect } from '@playwright/test';
import { card } from './helpers.js';
import { fakeBridge, openResearch, openResearchMenu, poll, block, editJan, researchGed, NEW_HEAD } from './research-bridge.js';

/**
 * Changes per person (A2): what the user changed since the research's
 * version, person by person — "What will be sent" (the split Send button, the
 * block's link), "What was written" after the send, and the names in the
 * dialog that would load over them. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };

test.describe('changes per person', () => {
    test.use({ viewport: DESKTOP });

    test('what will be sent: the split button and the block say who changed; what was written after the send', { tag: '@smoke' }, async ({ page }) => {
        await openResearch(page);
        const b = await fakeBridge(page, { syncReply: { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042' } } });
        await poll(page);
        await editJan(page, 'Kolín');
        await page.evaluate(() => window.Strom.UI.refreshResearchSyncUi());

        // The toolbar: "Send | 1 ⌄"; the second part opens the panel.
        const more = page.locator('#research-sync-send-more');
        await expect(more).toHaveText(/1/);
        await expect(more).toHaveAttribute('aria-label', 'Show what will be sent (1 person)');
        await more.click();
        const panel = page.locator('#research-changes-panel');
        await expect(panel.locator('.research-changes-title')).toHaveText('What will be sent');
        await expect(panel.locator('.research-changes-row')).toHaveCount(1);
        await expect(panel.locator('.research-changes-name')).toHaveText('Jan Fíšek');
        await expect(panel.locator('.research-changes-kinds')).toHaveText('birth');
        // Esc closes it.
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);

        // The block in ⋯ → Research: how many people; the same panel from "Other actions" (Send sends at once here).
        await openResearchMenu(page, { expandMore: true });
        await expect(block(page)).toContainText('1 person changed');
        await page.locator('#research-item-changes').click();
        await expect(panel).toBeVisible();
        // A name selects the person and closes the panel.
        await panel.locator('.research-changes-name').click();
        await expect(panel).toHaveCount(0);

        // Sent and written: "What was written ›" lists the same person, ticked.
        await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
        await expect.poll(() => b.posts.length).toBe(1);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'written');
        await block(page).getByRole('menuitem', { name: 'What was written ›' }).click();
        await expect(panel.locator('.research-changes-title')).toContainText('Written');
        await expect(panel.locator('.research-changes-name')).toHaveText('Jan Fíšek');
        await expect(panel.locator('.research-changes-icon')).toHaveText('✓');
        // Nothing left to send: no split part.
        await page.keyboard.press('Escape');
        await expect(more).toHaveCount(0);
    });

    test('Esc closes What will be sent even when pressed the moment it opens (before any timer of the page ran)', async ({ page }) => {
        await openResearch(page, { edit: true });
        await fakeBridge(page);
        await poll(page);
        await page.evaluate(() => window.Strom.UI.refreshResearchSyncUi());
        await expect(page.locator('#research-sync-send-more')).toHaveText(/1/);
        // Opened and Esc in one go: a busy page takes the key before a timer set when it opened.
        const open = await page.evaluate(() => {
            window.Strom.UI.toggleResearchChanges();
            const shown = !!document.getElementById('research-changes-panel');
            document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            return shown;
        });
        expect(open).toBe(true);
        await expect(page.locator('#research-changes-panel')).toHaveCount(0);
    });

    test('a new version over unsent changes names the people it would overwrite', async ({ page }) => {
        await openResearch(page, { edit: true });
        await fakeBridge(page, { head: NEW_HEAD, treeGed: researchGed(NEW_HEAD) });
        await poll(page);
        await page.evaluate(() => { void window.Strom.UI.researchLoadNewer(); });
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toContainText("The research doesn't have these changes yet. Loading without sending would overwrite them:");
        await expect(dialog).toContainText('• Jan Fíšek (birth)');
    });

    test('a tree in step with the research: nothing to tell, no split part', async ({ page }) => {
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await expect(page.locator('#research-sync-send-more')).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.UI.researchChangesNow())).toEqual([]);
    });
});

test.describe('changes per person after a send the research took nothing from', () => {
    test.use({ viewport: DESKTOP });

    test('N40: a written send, then one the research took nothing from: the block counts the people, What will be sent lists them, after a reload and another edit too', async ({ page }) => {
        await openResearch(page);
        const b = await fakeBridge(page, { syncReply: { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0042' } } });
        await poll(page);
        // First a send the research wrote.
        await editJan(page, 'Kolín');
        await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
        await expect.poll(() => b.posts.length).toBe(1);
        await openResearchMenu(page);
        await expect(block(page)).toHaveAttribute('data-state', 'written');
        // Then one it took nothing from.
        b.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 0, applied: 0, input: 'I0043' } };
        await editJan(page, 'Brno');
        await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
        await expect.poll(() => b.posts.length).toBe(2);

        const panel = page.locator('#research-changes-panel');
        const listed = async () => {
            await openResearchMenu(page, { expandMore: true });
            await expect(block(page)).toHaveAttribute('data-state', 'notTaken');
            await expect(block(page)).toContainText('nothing new from the last send');
            await expect(block(page)).toContainText('1 person changed');
            await page.locator('#research-item-changes').click();
            await expect(panel.locator('.research-changes-title')).toHaveText('What will be sent');
            await expect(panel.locator('.research-changes-row')).toHaveCount(1);
            await expect(panel.locator('.research-changes-name')).toHaveText('Jan Fíšek');
            await expect(panel.locator('.research-changes-kinds')).toHaveText('birth');
            await page.keyboard.press('Escape');
            await expect(panel).toHaveCount(0);
            // The toolbar's Send carries the count.
            await expect(page.locator('#research-sync-send-more')).toHaveText(/1/);
        };
        await listed();

        // After a reload: the same.
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await poll(page);
        await listed();

        // Another edit: still listed against the research's version.
        await editJan(page, 'Plzeň');
        await page.evaluate(() => window.Strom.UI.refreshResearchSyncUi());
        await expect(page.locator('#research-sync-send-more')).toHaveText(/1/);
        await page.locator('#research-sync-send-more').click();
        await expect(panel.locator('.research-changes-row')).toHaveCount(1);
        await expect(panel.locator('.research-changes-name')).toHaveText('Jan Fíšek');
        await expect(panel.locator('.research-changes-kinds')).toHaveText('birth');
    });
});

test.describe('what will be sent beyond the people', () => {
    test.use({ viewport: DESKTOP });

    /** Jan's birth in Kolín, two new sources and the register retitled, the main marriage, Kolín's coordinates, a variant. */
    async function sample(page: import('@playwright/test').Page, extraSources = 0): Promise<void> {
        await editJan(page, 'Kolín');
        await page.evaluate((extra) => {
            const dm = window.Strom.DataManager;
            dm.addSource({ title: 'Sčítání lidu 1921' });
            dm.addSource({ title: 'Pozemková kniha Čáslav', transcript: 'Josef Fíšek, chalupník' });
            for (let i = 1; i <= extra; i++) dm.addSource({ title: `Urbář ${String(i).padStart(2, '0')}` });
            const s1 = Object.values(dm.getData().sources ?? {}).find((s: any) => s.title === 'Oddací matrika Čáslav') as any;
            dm.updateSource(s1.id, { title: 'Oddací matrika Čáslav 1880–1890' });
            const u = Object.values(dm.getData().partnerships)[0] as any;
            dm.updatePartnership(u.id, { isPrimary: true });
            dm.setPlaceGeos(new Map([['kolin', { lat: 50.0281, lon: 15.2006 }]]));
            dm.addSurnameGroup(['Fíšek', 'Fischek']);
            window.Strom.UI.refreshResearchSyncUi();
        }, extraSources);
    }

    test('sections in order, the count beyond the people, the context of a source, places expanded', async ({ page }) => {
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await sample(page);
        const more = page.locator('#research-sync-send-more');
        await expect(more).toHaveText(/7/);
        await expect(more).toHaveAttribute('aria-label', 'Show what will be sent (1 person · 6 other changes)');
        await more.click();
        const panel = page.locator('#research-changes-panel');
        await expect(panel.locator('.research-changes-sub')).toContainText('1 person · 6 other changes');
        await expect(panel.locator('.research-changes-inexact')).toHaveCount(0);
        await expect(panel.locator('.research-changes-section')).toHaveText(['People · 1', 'Sources · 3', 'Couples · 1', 'Places · 1', 'Surname variants · 1']);
        const sources = panel.locator('[data-kind="source"]');
        await expect(sources).toHaveCount(3);
        await expect(sources.nth(0)).toContainText('Oddací matrika Čáslav 1880–1890');
        await expect(sources.nth(0).locator('.research-changes-kinds')).toHaveText('title');
        await expect(sources.nth(0).locator('.research-changes-ctx')).toHaveText('not cited');
        await expect(sources.nth(1).locator('.research-changes-kinds')).toHaveText('new · transcript');
        await expect(panel.locator('[data-kind="couple"] .research-changes-name')).toHaveText('Josef Fíšek and Anna Svobodová');
        await expect(panel.locator('[data-kind="couple"] .research-changes-kinds')).toHaveText('main marriage');
        await expect(panel.locator('[data-kind="variants"]')).toContainText('for the surname Fíšek');
        // Places: one summary row, its list on demand.
        const toggle = panel.locator('[data-toggle="places"]');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(panel.locator('#research-changes-detail-places')).toBeHidden();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(panel.locator('#research-changes-detail-places .research-changes-detail-row')).toHaveText(['Kolín50.028, 15.201']);
        await expect(panel).toBeVisible();
    });

    test('a long section shows three, "+ N more" adds the rest', async ({ page }) => {
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await sample(page, 8);
        await page.locator('#research-sync-send-more').click();
        const panel = page.locator('#research-changes-panel');
        await expect(panel.locator('[data-section="sources"]')).toHaveText('Sources · 11');
        await expect(panel.locator('[data-kind="source"]')).toHaveCount(3);
        const moreBtn = panel.locator('[data-more="sources"]');
        await expect(moreBtn).toHaveText('+ 8 more');
        await moreBtn.click();
        await expect(panel.locator('[data-kind="source"]')).toHaveCount(11);
        await expect(moreBtn).toHaveCount(0);
        // The people's section of one: no grouping.
        await expect(panel.locator('[data-kind="person"]')).toHaveCount(1);
    });

    test('a source opens its viewer over the panel; Esc closes the viewer first; a couple centres the tree and closes the panel', async ({ page }) => {
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await sample(page);
        await page.locator('#research-sync-send-more').click();
        const panel = page.locator('#research-changes-panel');
        const viewer = page.locator('#source-viewer-modal');
        const row = panel.locator('[data-kind="source"] button.research-changes-name').first();
        await row.click();
        await expect(viewer).toHaveClass(/active/);
        await expect(panel).toBeVisible();
        // A click inside the viewer leaves the panel.
        await viewer.locator('.modal').click({ position: { x: 20, y: 20 } });
        await expect(panel).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(viewer).not.toHaveClass(/active/);
        await expect(panel).toBeVisible();
        await expect(row).toBeFocused();
        // A couple: the tree centred on its first partner, the panel closed.
        await panel.locator('[data-kind="couple"] button.research-changes-name').click();
        await expect(panel).toHaveCount(0);
    });

    test('what the research does not read is tagged "app only"; after the send: not written by type, written, app only quietly', async ({ page }) => {
        await openResearch(page);
        const b = await fakeBridge(page, { syncReply: { status: 200, body: { ok: true, inbox: false, changes: 7, applied: 3, input: 'I0043' } } });
        await poll(page);
        await sample(page);
        await page.locator('#research-sync-send-more').click();
        const panel = page.locator('#research-changes-panel');
        // The main marriage and the surname variants stay in the app; sources, places and people are read.
        await expect(panel.locator('[data-kind="couple"] .research-changes-tag')).toHaveText('app only');
        await expect(panel.locator('[data-kind="couple"] .research-changes-tag')).toHaveAttribute('title', 'The research does not read this; it stays in the app only.');
        await expect(panel.locator('[data-kind="variants"] .research-changes-tag')).toHaveText('app only');
        await expect(panel.locator('[data-kind="source"] .research-changes-tag, [data-kind="places"] .research-changes-tag, [data-kind="person"] .research-changes-tag')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // The research names a source by its number, one new source by the sent file's xref, a place by its name.
        b.onWrite = () => ({ head: 'd6d6d6d6d6d6', ged: researchGed('d6d6d6d6d6d6') });
        b.replyExtra = (posted) => {
            const xref = /0 (@[^@]+@) SOUR\n1 TITL Pozemková kniha Čáslav/.exec(posted)?.[1] ?? '@X@';
            return { notWritten: [
                { kind: 'source.title', source: 'S0001', why: 'report' },
                { kind: 'source.new', source: xref, why: 'pick' },
                { kind: 'place.coords', place: 'Kolín' },
                { kind: 'couple.edit', family: 'F0001' },
            ] };
        };
        await page.evaluate(() => window.Strom.UI.researchSyncAction('send'));
        await expect.poll(() => b.posts.length).toBe(1);
        // The post is counted when it goes; the panel reads the answer once it is taken.
        await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.sent?.state)).toBe('written');
        await page.evaluate(() => window.Strom.UI.showResearchChanges('written'));
        await expect(panel.locator('.research-changes-section.is-warn')).toHaveText('Not written · 4');
        const not = panel.locator('.research-changes-row.is-not-written');
        await expect(not).toHaveCount(4);
        await expect(not.nth(0).locator('.research-changes-type')).toHaveText('source');
        await expect(not.nth(0).locator('.research-changes-name')).toHaveText('Oddací matrika Čáslav 1880–1890');
        await expect(not.nth(0).locator('.research-changes-kinds')).toHaveText('title');
        await expect(not.nth(1).locator('.research-changes-name')).toHaveText('Pozemková kniha Čáslav');
        await expect(not.nth(1)).toContainText('no common ground: choose in the research');
        await expect(not.nth(2).locator('.research-changes-type')).toHaveText('places');
        await expect(not.nth(2).locator('.research-changes-name')).toHaveText('Kolín');
        // A couple's item: the app has no families of the research — counted, not named.
        await expect(not.nth(3).locator('.research-changes-name')).toHaveText('1 change the research did not name');
        // Written: Jan and the census; the sources and the place named above are not claimed.
        const written = panel.locator('.research-changes-list.is-quiet').first();
        await expect(written.locator('.research-changes-name')).toHaveText(['Jan Fíšek', 'Sčítání lidu 1921']);
        // What the research does not read: a quiet section of its own.
        await expect(panel.locator('[data-section="appOnly"]')).toHaveText('App only · 2');
        await expect(panel.locator('[data-group="appOnly"] .research-changes-type')).toHaveText(['couple', 'variants']);
        await expect(panel.locator('[data-group="appOnly"] .research-changes-name')).toHaveText(['Josef Fíšek and Anna Svobodová', '1 new variant']);
        // A source in the not written list opens its viewer.
        await not.nth(0).locator('button.research-changes-name').click();
        await expect(page.locator('#source-viewer-modal')).toHaveClass(/active/);
    });

    test('phone: the checkbox above Close and Send side by side', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await sample(page);
        await page.evaluate(() => {
            const id = window.Strom.TreeManager.getActiveTreeId()!;
            const k = `strom-research-auto:${id}`;
            const v = JSON.parse(localStorage.getItem(k) ?? '{}');
            delete v.skipPreview;
            localStorage.setItem(k, JSON.stringify(v));
            window.Strom.UI.showResearchChanges('send', { confirm: true });
        });
        const foot = page.locator('#research-changes-panel .research-changes-foot');
        await expect(foot).toHaveCSS('display', 'grid');
        const [skip, close, send] = await Promise.all([
            foot.locator('.research-changes-skip').boundingBox(), foot.locator('[data-act="close"]').boundingBox(), foot.locator('[data-act="send"]').boundingBox(),
        ]);
        expect(skip!.y + skip!.height).toBeLessThanOrEqual(close!.y + 1);
        expect(Math.abs(close!.y - send!.y)).toBeLessThan(2);
        const panelBox = await page.locator('#research-changes-panel').boundingBox();
        expect(panelBox!.width).toBeLessThanOrEqual(390 - 16 + 1);
    });

    for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 700 }]) {
        test(`${viewport.width}px: an Undo pill right after an edit leaves Close and Send clickable`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await openResearch(page);
            await fakeBridge(page);
            await poll(page);
            await sample(page, 8);
            await page.evaluate(() => {
                window.Strom.UI.showUndoToast('Edited Jan Fíšek: birth date, birth place and the occupation');
                window.Strom.UI.showResearchChanges('send', { confirm: true });
            });
            const pill = page.locator('.undo-toast.show');
            await expect(pill).toBeVisible();
            const panel = page.locator('#research-changes-panel');
            const send = panel.locator('[data-act="send"]');
            const close = panel.locator('[data-act="close"]');
            // All eleven sources: a list longer than the window.
            await panel.locator('[data-more="sources"]').click();
            await expect(panel.locator('[data-kind="source"]')).toHaveCount(11);
            // Nothing on top of either button: a trial click reaches it.
            await send.click({ trial: true, timeout: 2000 });
            await close.click({ trial: true, timeout: 2000 });
            const [panelBox, pillBox] = await Promise.all([panel.boundingBox(), pill.boundingBox()]);
            expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(pillBox!.y);
            // The pill gone, the panel takes the room back.
            await page.evaluate(() => window.Strom.UI.dismissUndoToast());
            await expect(page.locator('.undo-toast')).toHaveCount(0);
            await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(panelBox!.height);
        });
    }

    /**
     * Where "What will be sent" opens without Send in the toolbar (1024 px: the
     * bottom-bar regime hides ⋯ too): at the right under the toolbar, never over
     * it, and its foot above the Undo pill that is showing, also when a second
     * change came right after the first (the first pill still fading out).
     */
    test('1024px: the panel under the toolbar, its foot above the current Undo pill', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 700 });
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await sample(page, 8);
        const at = await page.evaluate(() => {
            window.Strom.UI.showUndoToast('Edited');
            window.Strom.UI.showUndoToast('Edited Jan Fíšek: birth date, birth place and the occupation');
            window.Strom.UI.showResearchChanges('send', { confirm: true });
            const panel = document.getElementById('research-changes-panel')!.getBoundingClientRect();
            const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect();
            const pills = Array.from(document.querySelectorAll<HTMLElement>('.undo-toast'));
            const pill = pills[pills.length - 1];
            const r = pill.getBoundingClientRect();
            return {
                pills: pills.length,
                panelTop: panel.top, panelBottom: panel.bottom, panelRight: panel.right,
                toolbarBottom: toolbar.bottom,
                pillRestTop: pill.classList.contains('show') ? r.top : r.top - 12,
            };
        });
        expect(at.pills).toBeGreaterThanOrEqual(2);
        expect(at.panelTop).toBeGreaterThanOrEqual(at.toolbarBottom);
        expect(at.panelRight).toBeGreaterThan(1024 / 2);
        expect(at.panelBottom).toBeLessThanOrEqual(at.pillRestTop);
    });

    test('1440px: the panel under its Send, clear of the toolbar', async ({ page }) => {
        await openResearch(page);
        await fakeBridge(page);
        await poll(page);
        await sample(page);
        await page.evaluate(() => window.Strom.UI.showResearchChanges('send', { confirm: true }));
        const at = await page.evaluate(() => ({
            panelTop: document.getElementById('research-changes-panel')!.getBoundingClientRect().top,
            toolbarBottom: document.querySelector('.toolbar')!.getBoundingClientRect().bottom,
        }));
        expect(at.panelTop).toBeGreaterThanOrEqual(at.toolbarBottom);
    });
});

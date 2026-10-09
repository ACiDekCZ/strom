import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import { BRIDGE, UUID, FakeBridge, poll, openResearchMenu, block } from './research-bridge.js';
import {
    Version, DecideRoute, setupConflict, openEdit, editJosef, cardOf, panel, choice, activeId, token, pageBoxes, partBoxes, KEEP_200, TAKE_200,
    tag as fieldTag, writtenWithConflict,
} from './research-conflict.js';

/**
 * The ways to a conflict decidable in the app (DEV §6): the panel by the edit
 * form's field ("conflict ›": decide from it, the form's unsaved edits saved
 * first, the field following the value loaded after Take, Esc and × giving
 * the keyboard back; on a phone a bottom sheet), the Research menu's "Show"
 * for the one conflict the write left (the dialog at its card, lit up a
 * moment), the overview's row (the dialog at the card; a conflict decided
 * leaves the list at once) and the card's ≠ (the dialog at the first open
 * conflict). Against a bridge answered by page.route. Invented data only.
 */

/**
 * The research opened from its file (`opened`), its bridge serving `serving` (default: the same version);
 * `features`: what its bridge says it can do (none: decided by a link into the research); `bridge: false`: it does
 * not answer here (no link announced either: not on this device).
 */
async function setup(page: Page, opened: Version = {}, serving?: Version, opts: { bridge?: boolean; features?: string[] } = {}): Promise<{ bridge: FakeBridge; decide: DecideRoute; treeId: string }> {
    return setupConflict(page, { opened, ...(serving ? { serving } : {}), ...opts, clock: true });
}

const editJan = (page: Page) => openEdit(page, 'Jan');
const tag = (page: Page) => fieldTag(page, 'input-birthdate');

test.describe('the panel by the edit form\'s field', () => {
    test.use({ locale: 'en-US' });
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

    test('"conflict ›" opens the panel by the field: the sides, short choices, the keyboard on Keep; Esc and × give it back to the tag', async ({ page }) => {
        await setup(page);
        await editJan(page);
        await expect(tag(page)).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(tag(page)).toHaveAttribute('aria-label', 'Conflict · Birth');
        await tag(page).click();
        const p = panel(page);
        await expect(p).toBeVisible();
        await expect(p).toHaveAttribute('role', 'dialog');
        await expect(tag(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(p.locator('.prc-panel-title')).toHaveText('Conflict · Birth');
        await expect(p.locator('.prc-panel-row[data-side="user"] .prc-panel-value')).toHaveText('1865');
        await expect(p.locator('.prc-panel-row[data-side="research"] .prc-panel-source')).toHaveText('Oddací matrika Čáslav');
        await expect(choice(page, 'user')).toHaveText('Keep');
        await expect(choice(page, 'user')).toHaveAttribute('aria-label', 'Keep the value from the app');
        await expect(choice(page, 'research')).toHaveText('Take');
        await expect(choice(page, 'research')).toHaveAttribute('aria-label', "Take the research's value");
        await expect(p.locator('#prc-panel-note-user')).toHaveText("The research writes the value from the app; the record's value stays in its history with the reason.");
        await expect(p.locator('#prc-panel-note-research')).toHaveText("The value here changes to the research's. A backup is saved first.");
        await expect(p.locator('.prc-panel-more')).toHaveText('More in What the research knows ›');
        await expect(choice(page, 'user')).toBeFocused();

        // Tab stays inside.
        for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('#prc-panel'))).toBe(true);

        // Inside the window, under the field, its arrow at the tag.
        const [box, field, t, arrow] = await pageBoxes(page, ['#prc-panel', '#input-birthdate', '#person-modal .pm-conflict-tag[data-field="input-birthdate"]', '#prc-panel .prc-panel-arrow']);
        expect(box.y).toBeGreaterThan(field.y + field.height);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(1280);
        expect(box.y + box.height).toBeLessThanOrEqual(900);
        expect(box.width).toBeLessThanOrEqual(400);
        expect(Math.abs(arrow.x + arrow.width / 2 - (t.x + t.width / 2))).toBeLessThan(4);

        // Esc: the panel goes, the form stays, the keyboard on the tag.
        await page.keyboard.press('Escape');
        await expect(p).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(tag(page)).toBeFocused();
        await expect(tag(page)).toHaveAttribute('aria-expanded', 'false');
        // ×: the same.
        await tag(page).click();
        await p.locator('.prc-panel-close').click();
        await expect(p).toHaveCount(0);
        await expect(tag(page)).toBeFocused();
        // "More in What the research knows ›": the dialog at the card.
        await tag(page).click();
        await p.locator('.prc-panel-more').click();
        await expect(p).toHaveCount(0);
        await expect(cardOf(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        await expect(tag(page)).toBeFocused();
    });

    test('keep from the panel: deciding, then the panel and the tag gone, the keyboard on the field, nothing of the form changed', async ({ page }) => {
        const { decide } = await setup(page);
        await editJosef(page);
        await editJan(page);
        await tag(page).click();
        decide.replies.push(KEEP_200);
        await choice(page, 'user').click();
        await expect(panel(page)).toHaveCount(0);
        await expect(tag(page)).toHaveCount(0);
        expect(await activeId(page)).toBe('input-birthdate');
        await expect(page.locator('.toast')).toHaveText('Conflict decided: 1865');
        await expect(page.locator('#input-birthdate')).toHaveValue('1865');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
        expect(decide.asks).toEqual([{ id: 'X0007', body: { do: 'decide', take: 'user' } }]);
    });

    test('the form with unsaved edits: the choices wait, "The person\'s edit is saved first, then the decision."; saved, they are on', async ({ page }) => {
        const { decide } = await setup(page);
        await editJan(page);
        await page.locator('#input-birthplace').fill('Kolín');
        await tag(page).click();
        await expect(panel(page).locator('.prc-notice--warn .prc-notice-text')).toHaveText("The person's edit is saved first, then the decision.");
        await expect(choice(page, 'user')).toBeDisabled();
        await expect(choice(page, 'research')).toBeDisabled();
        await expect(panel(page).locator('.prc-panel-note')).toHaveCount(0);
        await expect(panel(page)).toHaveAttribute('data-state', 'saveFirst');
        // The keyboard on the close button (no choice is on).
        await expect(panel(page).locator('.prc-panel-close')).toBeFocused();
        await page.keyboard.press('Escape');
        expect(decide.asks).toHaveLength(0);
        // Saved: opened again, the choices are on.
        await page.locator('#btn-save').click();
        await expect(page.locator('#person-modal')).toBeHidden();
        await editJan(page);
        await tag(page).click();
        await expect(choice(page, 'user')).toBeEnabled();
        await expect(panel(page).locator('.prc-notice--warn')).toHaveCount(0);
    });

    for (const how of ['quiet', 'asked'] as const) {
        test(`take from the panel (${how === 'quiet' ? 'only this value differs' : 'the research has more: the Load dialog'}): the field shows the value loaded, the form has nothing unsaved`, async ({ page }) => {
            const more = how === 'asked' ? { janDeath: '1933' } : {};
            const { decide } = await setup(page, {}, { janBirth: '3 FEB 1865', ...more });
            await editJan(page);
            await expect(page.locator('#input-birthdate')).toHaveValue('1865');
            await tag(page).click();
            decide.replies.push(TAKE_200({ janBirth: '3 FEB 1865', ...more }));
            await choice(page, 'research').click();
            if (how === 'asked') {
                await expect(page.locator('#research-load-modal')).toBeVisible();
                await page.locator('#research-load-modal #research-load-ok').click();
            }
            await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.birthDate)).toBe('1865-02-03');
            await expect(page.locator('#input-birthdate')).not.toHaveValue('1865');
            const shown = await page.locator('#input-birthdate').inputValue();
            if (how === 'asked') await expect(page.locator('#input-deathdate')).toHaveValue('1933');
            await expect(tag(page)).toHaveCount(0);
            expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
            // As the form shows it opened afresh.
            await page.locator('#person-modal').getByRole('button', { name: 'Cancel' }).click();
            await expect(page.locator('#person-modal')).toBeHidden();
            await editJan(page);
            await expect(page.locator('#input-birthdate')).toHaveValue(shown);
        });
    }

    test('take decided from the dialog above a form with unsaved edits: the field loaded follows, what was typed elsewhere stays', async ({ page }) => {
        const { decide } = await setup(page, {}, { janBirth: '3 FEB 1865' });
        await editJan(page);
        await page.locator('#input-birthplace').fill('Kolín');
        await tag(page).click();
        await panel(page).locator('.prc-panel-more').click();
        decide.replies.push(TAKE_200({ janBirth: '3 FEB 1865' }));
        await cardOf(page).locator('.prc-side[data-side="research"] .prc-choice').click();
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.birthDate)).toBe('1865-02-03');
        await expect(page.locator('#input-birthdate')).not.toHaveValue('1865');
        await expect(page.locator('#input-birthplace')).toHaveValue('Kolín');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(true);
    });

    test('an error with the panel open: said in the panel with "Try again" (no notice), the same side asked again', async ({ page }) => {
        const { decide } = await setup(page);
        await editJosef(page);
        await editJan(page);
        await tag(page).click();
        decide.replies.push({ status: 423, body: { code: 'locked' } });
        await choice(page, 'user').click();
        await expect(panel(page).locator('.prc-notice--error .prc-notice-text')).toHaveText('The tree in the research is locked by another session; the decision did not go through.');
        await expect(panel(page)).toHaveAttribute('data-state', 'error');
        await expect(page.locator('.toast').filter({ hasText: 'could not be decided' })).toHaveCount(0);
        decide.replies.push(KEEP_200);
        await panel(page).locator('.prc-notice-action').click();
        await expect(panel(page)).toHaveCount(0);
        expect(decide.asks.map(a => a.body)).toEqual([{ do: 'decide', take: 'user' }, { do: 'decide', take: 'user' }]);
    });

    test('not decidable from the app (422 conflict.no-edit) with the panel open: its own sentence in the panel, no "Try again", the choices off, "Decide in the research ↗"', async ({ page }) => {
        const { decide } = await setup(page);
        await editJan(page);
        await tag(page).click();
        decide.replies.push({ status: 422, body: { code: 'conflict.no-edit' } });
        await choice(page, 'research').click();
        const p = panel(page);
        await expect(p).toHaveAttribute('data-state', 'noEdit');
        await expect(p.locator('.prc-notice .prc-notice-text')).toHaveText('The research cannot decide this conflict from the app.');
        await expect(p.getByRole('button', { name: 'Try again' })).toHaveCount(0);
        await expect(choice(page, 'user')).toBeDisabled();
        await expect(choice(page, 'research')).toBeDisabled();
        await expect(p.locator('.prc-panel-note')).toHaveCount(0);
        await expect(page.locator('.toast').filter({ hasText: 'cannot decide' })).toHaveCount(0);
        const decideLink = p.locator('.prc-notice-action');
        await expect(decideLink).toHaveText('Decide in the research ↗');
        await expect(decideLink).toBeFocused();
        await decideLink.click();
        expect(await page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links)).toEqual([
            `strom-research://conflict?tree=${UUID}&id=X0007&do=decide`,
        ]);
        expect(decide.asks).toHaveLength(1);
        // Unsaved edits in the form change nothing here: nothing is decided in the app anyway.
        await page.keyboard.press('Escape');
        await page.locator('#input-birthplace').fill('Kolín');
        await tag(page).click();
        await expect(p).toHaveAttribute('data-state', 'noEdit');
    });

    test('not decidable from the app, no links here: the panel says it alone', async ({ page }) => {
        const { decide } = await setup(page, { links: ['send', 'open', 'live', 'app', 'setup'] });
        await editJan(page);
        await tag(page).click();
        decide.replies.push({ status: 422, body: { code: 'conflict.no-edit' } });
        await choice(page, 'user').click();
        await expect(panel(page)).toHaveAttribute('data-state', 'noEdit');
        await expect(panel(page).locator('.prc-notice')).toHaveText('The research cannot decide this conflict from the app.');
        await expect(panel(page).locator('.prc-notice-action')).toHaveCount(0);
        await expect(panel(page).locator('.prc-panel-close')).toBeFocused();
    });

    test('without the bridge\'s decision: the choices are links into the research (↗), taking a side', async ({ page }) => {
        const { decide } = await setup(page, {}, undefined, { features: [] });
        await editJan(page);
        await tag(page).click();
        await expect(panel(page)).toHaveAttribute('data-state', 'link');
        await expect(choice(page, 'research')).toHaveText('Take ↗');
        await expect(choice(page, 'research')).toHaveAttribute('aria-label', "Take the research's value ↗");
        await expect(panel(page).locator('.prc-link-note')).toHaveText('Opens the research; it only asks to confirm.');
        await choice(page, 'research').click();
        const opened = await page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links);
        expect(opened).toHaveLength(1);
        expect(opened[0]).toContain('id=X0007');
        expect(opened[0]).toContain('take=research');
        expect(decide.asks).toHaveLength(0);
    });

    test('not on this device: the sides without choices, "Decided on the computer with the research."', async ({ page }) => {
        await setup(page, { links: ['send', 'open', 'live', 'app', 'setup'] }, undefined, { bridge: false });
        await editJan(page);
        await tag(page).click();
        await expect(panel(page)).toHaveAttribute('data-state', 'none');
        await expect(panel(page).locator('.prc-notice--info .prc-notice-text')).toHaveText('Decided on the computer with the research.');
        await expect(panel(page).locator('.prc-panel-choice')).toHaveCount(0);
        await expect(panel(page).locator('.prc-panel-close')).toBeFocused();
    });

    test('a conflict of the sources: its tag opens the dialog, no panel', async ({ page }) => {
        await setup(page, { sources: true });
        await editJan(page);
        await expect(tag(page)).not.toHaveAttribute('aria-haspopup', 'dialog');
        await tag(page).click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(panel(page)).toHaveCount(0);
    });
});

test.describe('the panel on a phone: a bottom sheet', () => {
    test.use({ locale: 'en-US' });

    test('phone (360 px): the rows one under the other, the choices 44 px across the width; Keep decides, the sheet goes', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        const { decide } = await setup(page);
        await editJosef(page);
        await editJan(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toHaveClass(/prc-panel--sheet/);
        await expect(page.locator('.prc-panel-overlay')).toHaveClass(/active/);
        const [row, keep, value, sheet, close] = await partBoxes(p, ['.prc-panel-row[data-side="user"]', '.prc-panel-row[data-side="user"] .prc-panel-choice',
            '.prc-panel-row[data-side="user"] .prc-panel-value', ':scope', '.prc-panel-close']);
        expect(keep.height).toBeGreaterThanOrEqual(44);
        expect(keep.width).toBeGreaterThan(row.width - 30);
        // Under the value, not beside it.
        expect(keep.y).toBeGreaterThan(value.y + value.height - 1);
        expect(sheet.y + sheet.height).toBeLessThanOrEqual(740 + 1);
        expect(close.height).toBeGreaterThanOrEqual(44);
        await expect(choice(page, 'user')).toBeFocused();
        decide.replies.push(KEEP_200);
        await choice(page, 'user').click();
        await expect(page.locator('.prc-panel-overlay')).toHaveCount(0);
        await expect(tag(page)).toHaveCount(0);
    });

    test('phone (360 px): not decidable from the app (422) — the sheet says so with "Decide in the research ↗" 44 px, the choices off', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        const { decide } = await setup(page);
        await editJan(page);
        await tag(page).click();
        await expect(panel(page)).toHaveClass(/prc-panel--sheet/);
        decide.replies.push({ status: 422, body: { code: 'conflict.no-edit' } });
        await choice(page, 'user').click();
        const p = panel(page);
        await expect(p).toHaveAttribute('data-state', 'noEdit');
        await expect(p.locator('.prc-notice-text')).toHaveText('The research cannot decide this conflict from the app.');
        await expect(choice(page, 'user')).toBeDisabled();
        await expect(choice(page, 'research')).toBeDisabled();
        const [action, sheet] = await partBoxes(p, ['.prc-notice-action', ':scope']);
        expect(action.height).toBeGreaterThanOrEqual(44);
        expect(action.x + action.width).toBeLessThanOrEqual(sheet.x + sheet.width);
        await expect(p.locator('.prc-notice-action')).toHaveText('Decide in the research ↗');
        await expect(p.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    });

    test('phone (360 px): a tap on the backdrop closes the sheet, the form stays', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await setup(page);
        await editJan(page);
        await tag(page).click();
        await expect(page.locator('.prc-panel-overlay')).toHaveClass(/active/);
        await page.mouse.click(180, 10);
        await expect(page.locator('.prc-panel-overlay')).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
    });

    test('phone held sideways: a sheet inside the window, value and choice side by side, the choices 44 px', async ({ page }) => {
        await page.setViewportSize({ width: 844, height: 390 });
        await setup(page);
        await editJan(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toHaveClass(/prc-panel--sheet/);
        await expect(page.locator('.prc-panel-overlay')).toHaveClass(/active/);
        const [keep, value, sheet] = await partBoxes(p, ['.prc-panel-row[data-side="user"] .prc-panel-choice', '.prc-panel-row[data-side="user"] .prc-panel-value', ':scope']);
        expect(keep.height).toBeGreaterThanOrEqual(44);
        expect(keep.x).toBeGreaterThan(value.x + value.width);
        expect(sheet.y).toBeGreaterThanOrEqual(0);
        expect(sheet.y + sheet.height).toBeLessThanOrEqual(390 + 1);
        await page.keyboard.press('Escape');
        await expect(page.locator('.prc-panel-overlay')).toHaveCount(0);
        await expect(tag(page)).toBeFocused();
    });

    test('dark theme: the panel in the dark surface', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setup(page);
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await editJan(page);
        await tag(page).click();
        expect(await panel(page).evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--surface'));
    });
});

test.describe('the Research menu, the ≠ and the dialog at the card', () => {
    test.use({ locale: 'en-US' });
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

    test('one conflict decidable here: "Show" with whom and what above it — the dialog at the card, the keyboard on Keep, lit up 1.5 s', async ({ page }) => {
        const { bridge, treeId } = await setup(page);
        await writtenWithConflict(page, bridge, treeId);
        await openResearchMenu(page);
        await expect(block(page).locator('.research-sync-lead')).toHaveText('Jan Víšek · Birth');
        const show = block(page).locator('[data-action="showConflict"]');
        await expect(show).toHaveText('Show');
        await expect(show).toHaveClass(/research-sync-btn/);
        await expect(block(page).locator('[data-action="decideInResearch"], [data-action="showConflicts"]')).toHaveCount(0);
        await expect(block(page).locator('[data-action="loadNewer"]')).toBeVisible();
        await show.click();
        const c = cardOf(page);
        await expect(c).toBeVisible();
        await expect(c).toHaveClass(/prc--highlight/);
        await expect(c.locator('.prc-side[data-side="user"] .prc-choice')).toBeFocused();
        expect(await c.evaluate(el => getComputedStyle(el).outlineColor)).toBe(await token(page, '--primary', 'color'));
        await page.clock.fastForward(1600);
        await expect(c).not.toHaveClass(/prc--highlight/);
    });

    test('written, the research did not move on: "Show" too', async ({ page }) => {
        const { treeId } = await setup(page);
        await editJosef(page);
        await page.evaluate(id => {
            const tm = window.Strom.TreeManager;
            const link = tm.getTreeMetadata(id)!.research!;
            const fp = window.Strom.UI.researchSyncFingerprints(id, link).current;
            const at = new Date().toISOString();
            tm.patchResearchLink(id, { sent: { fingerprint: fp, at, closedAt: at, changes: 1, head: link.head ?? '', state: 'written', conflicts: 1, intake: 'R1' } });
            const st = JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}');
            st.lastWritten = { at, changes: 1, conflicts: 1, conflictIds: ['X0007'], fingerprint: fp, intake: 'R1' };
            localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify(st));
        }, treeId);
        await poll(page);
        expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('written');
        await openResearchMenu(page);
        await expect(block(page).locator('.research-sync-lead')).toHaveText('Jan Víšek · Birth');
        await block(page).locator('[data-action="showConflict"]').click();
        await expect(cardOf(page)).toHaveClass(/prc--highlight/);
    });

    test('reduced motion: the light comes and goes without a fade', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const { bridge, treeId } = await setup(page);
        await writtenWithConflict(page, bridge, treeId);
        await openResearchMenu(page);
        await block(page).locator('[data-action="showConflict"]').click();
        const c = cardOf(page);
        await expect(c).toHaveClass(/prc--highlight/);
        await page.clock.fastForward(1600);
        await expect(c).not.toHaveClass(/prc--highlight/);
        expect(await c.evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
    });

    test('a conflict of the sources: the menu keeps "Decide in the research ↗", no "Show"', async ({ page }) => {
        const { bridge, treeId } = await setup(page, { sources: true });
        await writtenWithConflict(page, bridge, treeId, { sources: true });
        await openResearchMenu(page);
        await expect(block(page).locator('[data-action="showConflict"]')).toHaveCount(0);
        await expect(block(page).locator('.research-sync-lead')).toHaveCount(0);
        await expect(block(page).locator('[data-action="decideInResearch"]')).toBeVisible();
    });

    test('the card\'s ≠: the dialog at the first open conflict, the keyboard on its first choice', async ({ page }) => {
        await setup(page);
        const badge = card(page, 'Jan').locator('.card-signal');
        await expect(badge).toHaveText('≠');
        await badge.click();
        await expect(cardOf(page)).toHaveClass(/prc--highlight/);
        await expect(cardOf(page).locator('.prc-side[data-side="user"] .prc-choice')).toBeFocused();
    });
});

test.describe('the overview while following', () => {
    test.use({ locale: 'en-US' });

    test('a conflict\'s row opens the dialog at its card; decided there, the row leaves the list at once', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const { bridge, decide } = await setup(page);
        // Following live; the research's events stay quiet.
        await page.route(`${BRIDGE}/events`, () => new Promise<void>(() => { /* never answers */ }));
        await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
        await expect(page.locator('#live-panel')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        const knows = ov.locator('.live-section__head').filter({ has: page.locator('.live-section__title', { hasText: 'What the research knows' }) });
        await expect(knows.locator('.live-section__sum')).toHaveText('1 conflict');
        if (await knows.getAttribute('aria-expanded') === 'false') await knows.click();
        const row = ov.locator('.research-overview__knows-row.is-conflict');
        await expect(row).toHaveCount(1);
        await row.click();
        await expect(cardOf(page)).toHaveClass(/prc--highlight/);
        await expect(cardOf(page).locator('.prc-side[data-side="user"] .prc-choice')).toBeFocused();
        // Its new version not said: nothing loads — the list follows the decision alone (its status no longer
        // answering: nothing else draws the overview again meanwhile).
        bridge.statusHang = true;
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user' } });
        await cardOf(page).locator('.prc-side[data-side="user"] .prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'kept');
        await expect(ov.locator('.research-overview__knows-row.is-conflict')).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.research!.conflicts![0].status)).toBe('open');
    });
});

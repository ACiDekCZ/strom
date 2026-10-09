import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { NEW_HEAD, links, dropFile } from './research-bridge.js';
import {
    ARCHIVE_ACCEPTS, KEEP_200, TAKE_200, Reply, conflictOf, setupConflict, openKnows, openEdit, editJosef, janBirth, cardOf, side, tag, panel, choice,
    activeId, pageBoxes, partBoxes,
} from './research-conflict.js';

/**
 * A conflict decidable by a side, in every way it is decided here — through
 * the bridge, by a link into the research, not on this device, in an archive —
 * across the card, the panel by the edit form's field and the phone's sheet;
 * the popover on a tablet and with touch, above the field when there is no
 * room under it and staying at the field while the form scrolls; the panel
 * for the name, the sex and the titles; the bridge's refusals answered from
 * the panel; and nothing new where nothing is decidable. Invented data only.
 */

const box = (b: { x: number; y: number; width: number; height: number }) => ({ left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height });

test.describe('a decision is no change of the tree', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('keep, nothing loading: Ctrl+Z undoes the last edit of the tree, not the decision', async ({ page }) => {
        const { decide } = await setupConflict(page);
        await editJosef(page);
        const undoBefore = await page.evaluate(() => window.Strom.DataManager.canUndo());
        expect(undoBefore).toBe(true);
        await openKnows(page);
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user', head: NEW_HEAD }, then: { head: NEW_HEAD, janState: 'decided' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'kept');
        await page.locator('#person-research-close').click();
        await page.keyboard.press('ControlOrMeta+z');
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Josef')!.birthPlace ?? '')).toBe('');
        // The decision stays: no ≠, the birth date as it was, nothing more to undo.
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        expect(await janBirth(page)).toBe('1865');
        expect(await page.evaluate(() => window.Strom.DataManager.canUndo())).toBe(false);
        expect(decide.asks).toHaveLength(1);
    });
});

test.describe('an archive: the choices, no agent', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('through the bridge: the card has its choices and "Decide in the research ↗", never "Leave it to the agent"', async ({ page }) => {
        const { decide } = await setupConflict(page, { opened: { archive: true }, accepts: ARCHIVE_ACCEPTS });
        expect(await page.evaluate(() => window.Strom.UI.activeResearchArchive())).toBe(true);
        await openKnows(page);
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'open');
        await expect(side(page, 'user').locator('.prc-choice')).toBeEnabled();
        await expect(side(page, 'research').locator('.prc-choice')).toBeEnabled();
        await expect(c.locator('.prc-links [data-do="decide"]')).toBeVisible();
        await expect(c.locator('[data-do="agent"], .research-ai-badge')).toHaveCount(0);
        decide.replies.push(KEEP_200);
        await side(page, 'user').locator('.prc-choice').click();
        await expect(c).toHaveAttribute('data-state', 'kept');
        expect(decide.asks).toEqual([{ id: 'X0007', body: { do: 'decide', take: 'user' } }]);
    });

    test('by a link (no conflict.decide): the choices are links, no agent anywhere', async ({ page }) => {
        await setupConflict(page, { opened: { archive: true }, accepts: ARCHIVE_ACCEPTS, features: [] });
        await openKnows(page);
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'link');
        await expect(side(page, 'user').locator('.prc-choice')).toHaveText('Keep the value from the app ↗');
        await expect(c.locator('[data-do="agent"], .research-ai-badge')).toHaveCount(0);
        await page.locator('#person-research-close').click();
        await openEdit(page);
        await tag(page).click();
        await expect(panel(page)).toHaveAttribute('data-state', 'link');
        await expect(choice(page, 'research')).toHaveText('Take ↗');
        await expect(panel(page).locator('.research-ai-badge, [data-do="agent"]')).toHaveCount(0);
    });

    test('the panel by the field: Keep and Take on', async ({ page }) => {
        await setupConflict(page, { opened: { archive: true }, accepts: ARCHIVE_ACCEPTS });
        await openEdit(page);
        await tag(page).click();
        await expect(panel(page)).toHaveAttribute('data-state', 'open');
        await expect(choice(page, 'user')).toBeEnabled();
        await expect(choice(page, 'research')).toBeEnabled();
    });
});

test.describe('the phone\'s sheet in every mode', () => {
    test.use({ locale: 'en-US' });

    test('by a link (360 px, no conflict.decide): Keep ↗ and Take ↗ 44 px across the width, the note under them; a choice opens the research taking its side', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        const { decide } = await setupConflict(page, { features: [] });
        await openEdit(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toHaveClass(/prc-panel--sheet/);
        await expect(p).toHaveAttribute('data-state', 'link');
        await expect(choice(page, 'user')).toHaveText('Keep ↗');
        await expect(choice(page, 'user')).toHaveAttribute('aria-label', 'Keep the value from the app ↗');
        await expect(choice(page, 'research')).toHaveText('Take ↗');
        await expect(p.locator('.prc-link-note')).toHaveText('Opens the research; it only asks to confirm.');
        await expect(choice(page, 'user')).toBeFocused();
        const [row, keep, take, note] = await partBoxes(p, ['.prc-panel-row[data-side="user"]', '.prc-panel-row[data-side="user"] .prc-panel-choice',
            '.prc-panel-row[data-side="research"] .prc-panel-choice', '.prc-link-note']);
        for (const b of [keep, take]) {
            expect(b.height).toBeGreaterThanOrEqual(44);
            expect(b.width).toBeGreaterThan(row.width - 30);
        }
        expect(note.y).toBeGreaterThan(take.y + take.height - 1);
        await choice(page, 'user').click();
        expect(await links(page)).toEqual([expect.stringMatching(/^strom-research:\/\/conflict\?.*id=X0007&do=decide&take=user$/)]);
        expect(decide.asks).toHaveLength(0);
    });

    test.describe('a touch phone', () => {
        test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

        test('not on this device: the sheet shows the sides with the notice, no choices; × and "More…" 44 px', async ({ page }) => {
            await setupConflict(page);
            await openEdit(page);
            await tag(page).tap();
            const p = panel(page);
            await expect(p).toHaveClass(/prc-panel--sheet/);
            await expect(p).toHaveAttribute('data-state', 'none');
            await expect(p.locator('.prc-notice--info .prc-notice-text')).toHaveText('Decided on the computer with the research.');
            await expect(p.locator('.prc-panel-row[data-side="user"] .prc-panel-value')).toHaveText('1865');
            await expect(p.locator('.prc-panel-row[data-side="research"] .prc-panel-source')).toHaveText('Oddací matrika Čáslav');
            await expect(p.locator('.prc-panel-choice, .prc-panel-note, .prc-link-note')).toHaveCount(0);
            await expect(p.locator('.prc-panel-close')).toBeFocused();
            const [close, more, sheet] = await partBoxes(p, ['.prc-panel-close', '.prc-panel-more', ':scope']);
            expect(close.height).toBeGreaterThanOrEqual(44);
            expect(close.width).toBeGreaterThanOrEqual(44);
            expect(more.height).toBeGreaterThanOrEqual(44);
            expect(sheet.y + sheet.height).toBeLessThanOrEqual(741);
            // "More…": the dialog at the card, as on the computer.
            await p.locator('.prc-panel-more').tap();
            await expect(cardOf(page)).toHaveAttribute('data-state', 'none');
        });
    });
});

test.describe('the popover on a tablet', () => {
    test.use({ locale: 'en-US' });

    test('a tablet with a mouse (820 px): a popover under the field, not a sheet, inside the window, its arrow at the tag', async ({ page }) => {
        await page.setViewportSize({ width: 820, height: 1180 });
        await setupConflict(page);
        await openEdit(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toBeVisible();
        await expect(p).not.toHaveClass(/prc-panel--sheet/);
        await expect(page.locator('.prc-panel-overlay')).toHaveCount(0);
        await expect(p).toHaveAttribute('data-state', 'open');
        const [pb, field, t, arrow] = (await pageBoxes(page, ['#prc-panel', '#input-birthdate', '#person-modal .pm-conflict-tag[data-field="input-birthdate"]', '#prc-panel .prc-panel-arrow'])).map(box);
        expect(pb.top).toBeGreaterThan(field.bottom);
        expect(pb.left).toBeGreaterThanOrEqual(8);
        expect(pb.right).toBeLessThanOrEqual(820 - 8);
        expect(pb.right - pb.left).toBeLessThanOrEqual(400);
        expect(Math.abs((arrow.left + arrow.right) / 2 - (t.left + t.right) / 2)).toBeLessThan(4);
    });

    test.describe('with touch', () => {
        test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

        test('a popover (not a sheet): not on this device, × and "More…" 44 px to touch', async ({ page }) => {
            await setupConflict(page);
            await openEdit(page);
            await tag(page).tap();
            const p = panel(page);
            await expect(p).toBeVisible();
            await expect(p).not.toHaveClass(/prc-panel--sheet/);
            await expect(p).toHaveAttribute('data-state', 'none');
            const [pb, close, more] = await partBoxes(p, [':scope', '.prc-panel-close', '.prc-panel-more']);
            expect(close.height).toBeGreaterThanOrEqual(44);
            expect(close.width).toBeGreaterThanOrEqual(44);
            expect(more.height).toBeGreaterThanOrEqual(44);
            // The close button's touch area stays inside the popover.
            expect(close.x + close.width).toBeLessThanOrEqual(pb.x + pb.width + 0.5);
            expect(close.y).toBeGreaterThanOrEqual(pb.y - 0.5);
        });
    });
});

/** The edit form's scrolling part scrolled by `by` px. */
async function scrollForm(page: Page, by: number): Promise<void> {
    await page.evaluate((by) => {
        let el: HTMLElement | null = document.getElementById('input-birthdate')!.parentElement;
        while (el && !(el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
        if (!el) throw new Error('the form does not scroll');
        el.scrollTop += by;
    }, by);
}

test.describe('the popover\'s place', () => {
    test.use({ locale: 'en-US' });

    test('no room under the field: it opens above it, its arrow pointing down at the tag, inside the window', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 640 });
        await setupConflict(page);
        await openEdit(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toBeVisible();
        // Under the field there is less room than the popover needs (and more above it).
        const [field0, p0] = (await pageBoxes(page, ['#input-birthdate', '#prc-panel'])).map(box);
        expect(640 - field0.bottom - 18).toBeLessThan(p0.bottom - p0.top);
        await expect(p).toHaveClass(/prc-panel--up/);
        const [pb, t, arrow] = (await pageBoxes(page, ['#prc-panel', '#person-modal .pm-conflict-tag[data-field="input-birthdate"]', '#prc-panel .prc-panel-arrow'])).map(box);
        expect(pb.bottom).toBeLessThanOrEqual(t.top);
        expect(pb.top).toBeGreaterThanOrEqual(8);
        // The arrow below the box, under it the tag.
        expect(arrow.top).toBeGreaterThan(pb.bottom - arrow.bottom + arrow.top - 1);
        expect(Math.abs((arrow.left + arrow.right) / 2 - (t.left + t.right) / 2)).toBeLessThan(4);
        // The choices reachable without scrolling the page.
        const [keep] = (await partBoxes(p, ['.prc-panel-row[data-side="research"] .prc-panel-choice'])).map(box);
        expect(keep.bottom).toBeLessThanOrEqual(pb.bottom);
        // The form scrolled so the field has room under it: the popover goes under it, still at the tag.
        await scrollForm(page, 250);
        await expect(p).not.toHaveClass(/prc-panel--up/);
        const [pb2, field2] = (await pageBoxes(page, ['#prc-panel', '#input-birthdate'])).map(box);
        expect(Math.round(pb2.top - field2.bottom)).toBe(10);
    });

    test('the form scrolled with the popover open: it stays at its field', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await setupConflict(page);
        await openEdit(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toBeVisible();
        await expect(p).not.toHaveClass(/prc-panel--up/);
        const gap = async () => {
            const [pb, field] = (await pageBoxes(page, ['#prc-panel', '#input-birthdate'])).map(box);
            return { gap: Math.round(pb.top - field.bottom), field: Math.round(field.bottom) };
        };
        const before = await gap();
        expect(before.gap).toBe(10);
        // The form scrolled by 60 px under the popover (the wheel over the form, the popover open).
        await scrollForm(page, 60);
        await expect.poll(async () => (await gap()).field).toBeLessThan(before.field - 30);
        await expect.poll(async () => (await gap()).gap).toBe(10);
        await expect(p).toBeVisible();
    });
});

const reply = (id: string, take: 'user' | 'research', then?: Reply['then']): Reply => ({ status: 200, body: { decided: id, take, head: NEW_HEAD }, ...(then ? { then } : {}) });

test.describe('the panel for the name, the sex and the titles', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('the name: "conflict ›" at the given name opens the panel; Keep decides it', async ({ page }) => {
        const name = conflictOf('X0011', 'NAME', 'Johann Wischek', 'Jan Víšek');
        const { decide } = await setupConflict(page, { opened: { noBirthConflict: true, janConflicts: name } });
        await editJosef(page);
        await openEdit(page);
        const t = tag(page, 'input-firstname');
        await expect(t).toHaveAttribute('aria-haspopup', 'dialog');
        await expect(t).toHaveAttribute('aria-label', 'Conflict · Name');
        await t.click();
        const p = panel(page);
        await expect(p.locator('.prc-panel-title')).toHaveText('Conflict · Name');
        await expect(p.locator('.prc-panel-row[data-side="user"] .prc-panel-value')).toHaveText('Jan Víšek');
        await expect(p.locator('.prc-panel-row[data-side="research"] .prc-panel-value')).toHaveText('Johann Wischek');
        decide.replies.push(reply('X0011', 'user', { head: NEW_HEAD, noBirthConflict: true, janConflicts: conflictOf('X0011', 'NAME', 'Johann Wischek', 'Jan Víšek', undefined, 'decided') }));
        await choice(page, 'user').click();
        await expect(p).toHaveCount(0);
        await expect(t).toHaveCount(0);
        expect(await activeId(page)).toBe('input-firstname');
        await expect(page.locator('#input-firstname')).toHaveValue('Jan');
        expect(decide.asks).toEqual([{ id: 'X0011', body: { do: 'decide', take: 'user' } }]);
    });

    test('the sex: "conflict ›" at the gender segment, the values by their machine value; Take loads the research\'s and the segment follows', async ({ page }) => {
        const sex = (state: 'open' | 'decided') => conflictOf('X0012', 'SEX', 'žena', 'muž', { research: 'F', user: 'M' }, state);
        const { decide } = await setupConflict(page, { opened: { noBirthConflict: true, janConflicts: sex('open') } });
        await openEdit(page);
        const t = tag(page, 'gender-segment');
        await expect(t).toHaveAttribute('aria-label', 'Conflict · Gender');
        await expect(page.locator('#gender-segment .segment-btn.active')).toHaveAttribute('data-gender', 'male');
        await t.click();
        const p = panel(page);
        await expect(p.locator('.prc-panel-row[data-side="user"] .prc-panel-value')).toHaveText('Male');
        await expect(p.locator('.prc-panel-row[data-side="research"] .prc-panel-value')).toHaveText('Female');
        decide.replies.push(reply('X0012', 'research', { head: NEW_HEAD, noBirthConflict: true, janSex: 'F', janConflicts: sex('decided') }));
        await choice(page, 'research').click();
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.gender)).toBe('female');
        await expect(p).toHaveCount(0);
        await expect(t).toHaveCount(0);
        await expect(page.locator('#gender-segment .segment-btn.active')).toHaveAttribute('data-gender', 'female');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
        expect(decide.asks).toEqual([{ id: 'X0012', body: { do: 'decide', take: 'research' } }]);
        await expect(page.locator('.toast')).toHaveText('Conflict decided: Female');
    });

    test('the titles: "conflict ›" at the title before and after the name, each its panel; folded away, the given name\'s', async ({ page }) => {
        const titles = [...conflictOf('X0013', 'NPFX', 'MUDr.', 'Ing.'), ...conflictOf('X0014', 'NSFX', 'CSc.', 'Ph.D.')];
        const { decide } = await setupConflict(page, { opened: { noBirthConflict: true, janTitles: { npfx: 'Ing.', nsfx: 'Ph.D.' }, janConflicts: titles } });
        await editJosef(page);
        await openEdit(page);
        await expect(page.locator('#input-title-before')).toBeVisible();
        const before = tag(page, 'input-title-before');
        const after = tag(page, 'input-title-after');
        await expect(before).toHaveAttribute('aria-label', 'Conflict · Title before name');
        await expect(after).toHaveAttribute('aria-label', 'Conflict · Title after name');
        await after.click();
        await expect(panel(page).locator('.prc-panel-row[data-side="user"] .prc-panel-value')).toHaveText('Ph.D.');
        await expect(panel(page).locator('.prc-panel-row[data-side="research"] .prc-panel-value')).toHaveText('CSc.');
        // The other tag: this panel closes, that one opens.
        await before.click();
        await expect(panel(page).locator('.prc-panel-title')).toHaveText('Conflict · Title before name');
        await expect(panel(page).locator('.prc-panel-row[data-side="research"] .prc-panel-value')).toHaveText('MUDr.');
        decide.replies.push(reply('X0013', 'user'));
        await choice(page, 'user').click();
        await expect(panel(page)).toHaveCount(0);
        await expect(before).toHaveCount(0);
        await expect(after).toHaveCount(1);
        expect(decide.asks).toEqual([{ id: 'X0013', body: { do: 'decide', take: 'user' } }]);
    });
});

test.describe('the bridge\'s answers from the panel', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('decided elsewhere for the research\'s value (409): the panel and the tag go, said with the decision, the field shows the value loaded', async ({ page }) => {
        const { decide } = await setupConflict(page, { clock: true });
        await openEdit(page);
        await tag(page).click();
        decide.replies.push({ status: 409, body: { error: 'decided', code: 'conflict.decided', resolution: '3 FEB 1865 (S0001)', take: 'research' },
            then: { head: NEW_HEAD, janBirth: '3 FEB 1865', janState: 'decided', janDecision: '3 FEB 1865 (S0001)' } });
        await choice(page, 'user').click();
        await expect(panel(page)).toHaveCount(0);
        await expect(tag(page)).toHaveCount(0);
        await expect(page.locator('.toast')).toHaveText('Already decided in the research: 3 FEB 1865 (S0001)');
        await expect.poll(() => janBirth(page)).toBe('1865-02-03');
        await expect(page.locator('#input-birthdate')).not.toHaveValue('1865');
        expect(await activeId(page)).toBe('input-birthdate');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
    });

    test('decided elsewhere for the app\'s value (409): the panel and the tag go, said, nothing loads', async ({ page }) => {
        const { decide, treeId } = await setupConflict(page, { clock: true });
        await editJosef(page);
        await openEdit(page);
        await tag(page).click();
        decide.replies.push({ status: 409, body: { error: 'decided', code: 'conflict.decided', resolution: '1865', take: 'user' }, then: { head: NEW_HEAD, janState: 'decided' } });
        await choice(page, 'research').click();
        await expect(panel(page)).toHaveCount(0);
        await expect(tag(page)).toHaveCount(0);
        await expect(page.locator('.toast')).toHaveText('Already decided in the research: 1865');
        await expect(page.locator('#input-birthdate')).toHaveValue('1865');
        expect(await janBirth(page)).toBe('1865');
        expect(await page.evaluate(id => window.Strom.TreeManager.getTreeMetadata(id)?.research?.head, treeId)).not.toBe(NEW_HEAD);
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
    });

    test('gone (404): the panel and the tag go, the field as it was, no notice', async ({ page }) => {
        const { decide } = await setupConflict(page, { clock: true });
        await openEdit(page);
        await tag(page).click();
        decide.replies.push({ status: 404, body: { error: 'none', code: 'conflict.none' } });
        await choice(page, 'user').click();
        await expect(panel(page)).toHaveCount(0);
        await expect(tag(page)).toHaveCount(0);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        await expect(page.locator('#input-birthdate')).toHaveValue('1865');
        expect(await activeId(page)).toBe('input-birthdate');
        await expect(page.locator('.toast').filter({ hasText: /decided/ })).toHaveCount(0);
    });

    test('Take with more in the research: the Load dialog; "Later" — the panel and the tag gone, the value here as it was, the research\'s version still offered', async ({ page }) => {
        const { decide } = await setupConflict(page, { clock: true, serving: { janBirth: '3 FEB 1865', janDeath: '1933' } });
        await openEdit(page);
        await tag(page).click();
        await expect(panel(page).locator('#prc-panel-note-research')).toHaveText("The value here changes to the research's. The research has 1 more change; they will be shown for loading.");
        decide.replies.push(TAKE_200({ janBirth: '3 FEB 1865', janDeath: '1933' }));
        await choice(page, 'research').click();
        const dialog = page.locator('#research-load-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.research-load-backup')).toHaveText('Later: 1865 stays here for now.');
        await dialog.locator('#research-load-cancel').click();
        await expect(dialog).toHaveCount(0);
        await expect(panel(page)).toHaveCount(0);
        await expect(tag(page)).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(page.locator('#input-birthdate')).toHaveValue('1865');
        expect(await janBirth(page)).toBe('1865');
        expect(await page.evaluate(() => window.Strom.UI.hasPersonModalChanges())).toBe(false);
        expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('newer');
        // The card in the dialog waits with its own "Load".
        await page.locator('#person-modal').getByRole('button', { name: 'Cancel' }).click();
        await openKnows(page);
        await expect(cardOf(page)).toHaveAttribute('data-state', 'takenPending');
    });

    test('sending first (the birth date edited and saved after the send): the panel says so with "Send", the choices off; "Send" sends, nothing is decided', async ({ page }) => {
        const { bridge, decide } = await setupConflict(page);
        await page.evaluate(() => window.Strom.UI.researchChangesReady());
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            dm.updatePerson(dm.getAllPersons().find(p => p.firstName === 'Jan')!.id, { birthDate: '1866' });
        });
        await openEdit(page);
        await tag(page).click();
        const p = panel(page);
        await expect(p).toHaveAttribute('data-state', 'sendFirst');
        await expect(p.locator('.prc-notice--warn .prc-notice-text')).toHaveText('The value here changed after it was sent. Sending comes first, then the decision.');
        await expect(p.locator('.prc-panel-row[data-side="user"] .prc-panel-value')).toHaveText('1866');
        await expect(choice(page, 'user')).toBeDisabled();
        await expect(choice(page, 'research')).toBeDisabled();
        await expect(p.locator('.prc-panel-note')).toHaveCount(0);
        const send = p.locator('.prc-notice-action');
        await expect(send).toHaveText('Send');
        // No choice on: the keyboard on ×, "Send" the next stop.
        await expect(p.locator('.prc-panel-close')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(send).toBeFocused();
        await page.keyboard.press('Enter');
        await expect.poll(() => bridge.posts.length).toBe(1);
        expect(bridge.posts[0]).toContain('1866');
        expect(decide.asks).toHaveLength(0);
        await expect(p).toBeVisible();
    });
});

test.describe('nothing new where nothing is decidable', () => {
    test.use({ locale: 'en-US', viewport: { width: 1280, height: 900 } });

    test('a tree without research: no tag in the edit form, no panel, no conflict card, no ≠', async ({ page }) => {
        await openApp(page);
        await setupPlain(page);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        await openEdit(page);
        await expect(page.locator('#person-modal .pm-conflict-tag')).toHaveCount(0);
        await expect(panel(page)).toHaveCount(0);
        expect(await page.evaluate(() => {
            const jan = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!;
            return window.Strom.UI.personOpenConflicts(jan.id).length;
        })).toBe(0);
    });

    test('a research tree whose conflicts cannot be decided here (the sources; the sides not said): today\'s rows, the tags open the dialog', async ({ page }) => {
        await setupConflict(page, { opened: { takeNoSides: true, sourcesDeath: true } });
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveText('≠');
        await openKnows(page);
        const dialog = page.locator('#person-research-modal');
        await expect(dialog.locator('[data-conflict-card], .prc-choice, .prc-side')).toHaveCount(0);
        await expect(dialog.locator('.person-research-conflict')).toHaveCount(2);
        await expect(dialog.locator('.person-research-sources-only')).toHaveText([
            'The sources disagree here; this is decided in the research.', 'The sources disagree here; this is decided in the research.',
        ]);
        await expect(dialog.locator('.person-research-conflict').first().locator('tbody td:first-child')).toHaveText([/1865/, '1865']);
        await page.locator('#person-research-close').click();
        await openEdit(page);
        for (const field of ['input-birthdate', 'input-deathdate']) {
            await expect(tag(page, field)).toBeVisible();
            await expect(tag(page, field)).not.toHaveAttribute('aria-haspopup', 'dialog');
        }
        await tag(page, 'input-birthdate').click();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(panel(page)).toHaveCount(0);
    });

    test('a decided conflict made by an edit: today\'s decided row, no card, no tag', async ({ page }) => {
        await setupConflict(page, { opened: { janState: 'decided', janDecision: '1865' } });
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        await openKnows(page);
        await expect(page.locator('#person-research-modal [data-conflict-card]')).toHaveCount(0);
        await expect(page.locator('#person-research-modal .person-research-decided[data-decided="X0007"]')).toBeVisible();
        await page.locator('#person-research-close').click();
        await openEdit(page);
        await expect(page.locator('#person-modal .pm-conflict-tag')).toHaveCount(0);
    });
});

/** A plain tree (a GEDCOM of another program): Jan and his parents, nothing of a research. */
async function setupPlain(page: Page): Promise<void> {
    await dropFile(page, 'family.ged', [
        '0 HEAD', '1 SOUR OTHER', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 FAMS @F1@',
        '0 @I3@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 FAMC @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '0 TRLR',
    ].join('\n'));
    await page.locator('.modal-overlay.active').getByText('Import as a new tree', { exact: true }).first().click();
    await page.locator('.modal-overlay.active button.primary', { hasText: 'Import' }).click();
    await expect(card(page, 'Jan')).toBeVisible();
}

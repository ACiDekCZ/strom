import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';
import { HEAD, NEW_HEAD, FakeBridge, poll } from './research-bridge.js';
import { Version, DecideRoute, conflictGed, setupConflict, openKnows, cardOf, side, janBirth, editJosef, token } from './research-conflict.js';

/**
 * What follows a decision of a conflict made in the app (DEV §4, §5, §7):
 * keeping the app's value loads the research's new version quietly when the
 * tree is what the research had; taking the research's value loads its
 * version — quietly when only the decided value changes, else through the
 * Load dialog ("Later" leaves the card waiting with its own "Load"); decided
 * elsewhere meanwhile loads like taking when the research's value won, and
 * nothing when the app's did. The conflict stops counting at once (the card's
 * ≠, a couple's conflict at both partners, the conflicts read from a version
 * not loaded read again), the notices say the value that holds, an error
 * with the dialog closed says so with "Show", and a decided card folds into
 * the decided row after 6 s. Invented data only.
 */

/** The research opened from its file (`opened`), its bridge serving `serving` (default: the same version). */
async function setup(page: Page, opened: Version = {}, serving?: Version): Promise<{ bridge: FakeBridge; decide: DecideRoute; treeId: string }> {
    return setupConflict(page, { opened, ...(serving ? { serving } : {}), clock: true });
}

/** The research's file in that version (for a bridge moving on). */
const ged = conflictGed;

const linkHead = (page: Page, treeId: string) => page.evaluate(id => window.Strom.TreeManager.getTreeMetadata(id)?.research?.head, treeId);
const toast = (page: Page) => page.locator('.toast');

test.describe('after deciding a conflict in the app', () => {
    test.use({ locale: 'en-US' });
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 900 }); });

    test('keep: kept, the ≠ gone at once, the research\'s new version loaded quietly (the tree is what it had), "Conflict decided"; after 6 s the decided row', async ({ page }) => {
        const { decide, treeId } = await setup(page);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveText('≠');
        await openKnows(page);
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user', head: NEW_HEAD, written: 'E0102', person: 'P0003' },
            then: { head: NEW_HEAD, janState: 'decided', janDecision: '1865' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'kept');
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        await expect(toast(page)).toHaveText('Conflict decided: 1865');
        // Its version taken in: the tree builds on it, the conflict there decided, the value the app's.
        await expect.poll(() => linkHead(page, treeId)).toBe(NEW_HEAD);
        expect(await janBirth(page)).toBe('1865');
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.research!.conflicts!.find(c => c.id === 'X0007')!.status)).toBe('decided');
        // The card stays a while, then folds into today's row.
        await page.clock.fastForward(5000);
        await expect(cardOf(page)).toHaveAttribute('data-state', 'kept');
        await page.clock.fastForward(1100);
        await expect(cardOf(page)).toHaveCount(0);
        await expect(page.locator('#person-research-modal .person-research-decided[data-decided="X0007"]')).toBeVisible();
        expect(decide.asks).toEqual([{ id: 'X0007', body: { do: 'decide', take: 'user' } }]);
    });

    test('keep with the tree changed since: nothing loads, the ≠ and the count gone all the same; the card goes after 6 s', async ({ page }) => {
        const { decide, treeId } = await setup(page);
        await editJosef(page);
        await openKnows(page);
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user', head: NEW_HEAD }, then: { head: NEW_HEAD, janState: 'decided' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'kept');
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        expect(await page.evaluate(id => window.Strom.UI.researchOpenConflictTotal(id), treeId)).toBe(0);
        expect(await linkHead(page, treeId)).toBe(HEAD);
        await page.clock.fastForward(6100);
        await expect(cardOf(page)).toHaveCount(0);
        await expect(page.locator('#person-research-modal .person-research-decided')).toHaveCount(0);
    });

    test('take, only this value differs: loaded quietly with a backup, "Conflict decided"; the card says the value it had; restoring brings it back', async ({ page }) => {
        const { decide, treeId } = await setup(page);
        await openKnows(page);
        await expect(page.locator('#prc-note-X0007-research')).toHaveText("The value here changes to the research's. A backup is saved first.");
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'research', head: NEW_HEAD },
            then: { head: NEW_HEAD, janBirth: '3 FEB 1865', janState: 'decided', janDecision: '3 FEB 1865 (S0001)' } });
        await side(page, 'research').locator('.prc-choice').click();
        await expect.poll(() => janBirth(page)).toBe('1865-02-03');
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        await expect(toast(page)).toHaveText(/^Conflict decided: (?!3 FEB).*1865$/);
        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'taken');
        await expect(c.locator('.prc-decided-line')).toHaveText('The value here changed from 1865. A backup was saved first (Research → Restore the state before loading).');
        expect(await linkHead(page, treeId)).toBe(NEW_HEAD);
        expect(await page.evaluate(id => window.Strom.UI.researchLoadBackup(id), treeId)).not.toBeNull();
        await page.evaluate(id => window.Strom.UI.researchRestoreBeforeLoad(id), treeId);
        await expect.poll(() => janBirth(page)).toBe('1865');
    });

    test('take, the research has more: the sentence says so first; then the Load dialog with the decision first; "Later" leaves the card waiting with its "Load"; no ≠', async ({ page }) => {
        // The research's version has Jan's death as 1933 besides its value of the conflict.
        const { decide, treeId } = await setup(page, {}, { janBirth: '3 FEB 1865', janDeath: '1933' });
        await openKnows(page);
        await expect(page.locator('#prc-note-X0007-research')).toHaveText("The value here changes to the research's. The research has 1 more change; they will be shown for loading.");
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'research', head: NEW_HEAD },
            then: { head: NEW_HEAD, janBirth: '3 FEB 1865', janDeath: '1933', janState: 'decided', janDecision: '3 FEB 1865 (S0001)' } });
        await side(page, 'research').locator('.prc-choice').click();
        const dialog = page.locator('#research-load-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.research-load-intro')).toHaveText(/^Conflict decided: (?!3 FEB).*1865\. The research's version has other changes too\. A backup is saved first\.$/);
        await expect(dialog.locator('tbody tr').first().locator('.research-load-decided')).toHaveText('decided');
        await expect(dialog.locator('.research-load-decided')).toHaveCount(1);
        await expect(dialog.locator('tbody tr')).toHaveCount(2);
        await expect(dialog.locator('.research-load-backup')).toHaveText('Later: 1865 stays here for now.');
        await expect(dialog.locator('#research-load-cancel')).toHaveText('Later');
        await expect(dialog.locator('#research-load-ok')).toHaveText('Load');
        await expect(dialog.locator('#research-load-copy')).toHaveCount(0);
        await dialog.locator('#research-load-cancel').click();
        await expect(dialog).toHaveCount(0);

        const c = cardOf(page);
        await expect(c).toHaveAttribute('data-state', 'takenPending');
        await expect(c.locator('.prc-notice--info .prc-notice-text')).toHaveText(/^Decided: (?!3 FEB).*1865\. The value here changes once the research's version is loaded\.$/);
        expect(await janBirth(page)).toBe('1865');
        expect(await linkHead(page, treeId)).toBe(HEAD);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        // The pill still offers the newer version.
        expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('newer');
        // Waiting after the dialog closed and opened again.
        await page.locator('#person-research-close').click();
        await openKnows(page);
        await expect(c).toHaveAttribute('data-state', 'takenPending');

        // Its "Load": the same dialog, then loaded.
        await c.locator('.prc-notice-action').click();
        await expect(dialog).toBeVisible();
        await dialog.locator('#research-load-ok').click();
        await expect.poll(() => janBirth(page)).toBe('1865-02-03');
        await expect(c).toHaveAttribute('data-state', 'taken');
        await expect(c.locator('.prc-decided-line')).toHaveText(/^The value here changed from 1865\./);
        expect(await linkHead(page, treeId)).toBe(NEW_HEAD);
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.deathDate)).toBe('1933');
        expect(decide.asks).toHaveLength(1);
    });

    test('decided elsewhere for the research\'s value (409): said with its decision, its version loaded like after Take', async ({ page }) => {
        const { decide, treeId } = await setup(page);
        await openKnows(page);
        decide.replies.push({ status: 409, body: { error: 'decided', code: 'conflict.decided', resolution: '3 FEB 1865 (S0001)', take: 'research' },
            then: { head: NEW_HEAD, janBirth: '3 FEB 1865', janState: 'decided', janDecision: '3 FEB 1865 (S0001)' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'elsewhere');
        await expect(toast(page)).toHaveText('Already decided in the research: 3 FEB 1865 (S0001)');
        await expect.poll(() => janBirth(page)).toBe('1865-02-03');
        expect(await linkHead(page, treeId)).toBe(NEW_HEAD);
        await expect(cardOf(page).locator('.prc-decided-line')).toHaveText(/^The value here changed from 1865\./);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
    });

    test('decided elsewhere for the app\'s value (409): said, nothing loads, the tree as it was', async ({ page }) => {
        const { decide, treeId } = await setup(page);
        await editJosef(page);
        await openKnows(page);
        const before = await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons));
        decide.replies.push({ status: 409, body: { error: 'decided', code: 'conflict.decided', resolution: '1865', take: 'user' },
            then: { head: NEW_HEAD, janState: 'decided' } });
        await side(page, 'research').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'elsewhere');
        await expect(toast(page)).toHaveText('Already decided in the research: 1865');
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        expect(await linkHead(page, treeId)).toBe(HEAD);
        expect(await page.evaluate(() => JSON.stringify(window.Strom.DataManager.getData().persons))).toBe(before);
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        // Closed and opened again (within 6 s): the decided card is done — the data say it (here: not open any more).
        await page.locator('#person-research-close').click();
        await openKnows(page);
        await expect(cardOf(page)).toHaveCount(0);
    });

    test('the write\'s "1 conflict to decide" ends at once: the Research state is no longer the written conflicts', async ({ page }) => {
        const { bridge, decide, treeId } = await setup(page);
        await editJosef(page);
        // The tree as sent and written, its write left this conflict; the research moved on since (its death date 1933).
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
        bridge.head = 'cccc2222dddd';
        bridge.treeGed = ged({ head: 'cccc2222dddd', janDeath: '1933' });
        await poll(page);
        expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('writtenConflicts');
        await openKnows(page);
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user', head: NEW_HEAD }, then: { head: NEW_HEAD, janState: 'decided', janDeath: '1933' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'kept');
        // Its version would overwrite the death date here: not loaded quietly; it is the newer version now.
        expect(await linkHead(page, treeId)).toBe(HEAD);
        await expect.poll(() => page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('newer');
    });

    test('a couple\'s conflict decided at one partner is gone at both', async ({ page }) => {
        const { decide } = await setup(page, { wedding: '1876', familyConflict: 'open' });
        await editJosef(page);
        await expect(card(page, 'Anna').locator('.card-signal')).toHaveText('≠');
        await expect(card(page, 'Josef').locator('.card-signal')).toHaveText('≠');
        await openKnows(page, 'Josef');
        decide.replies.push({ status: 200, body: { decided: 'X0009', take: 'user', head: NEW_HEAD, family: 'F0001' },
            then: { head: NEW_HEAD, wedding: '1876', familyConflict: 'decided' } });
        await side(page, 'user', 'X0009').locator('.prc-choice').click();
        await expect(cardOf(page, 'X0009')).toHaveAttribute('data-state', 'kept');
        await expect(card(page, 'Anna').locator('.card-signal')).toHaveCount(0);
        await expect(card(page, 'Josef').locator('.card-signal')).toHaveCount(0);
        await page.locator('#person-research-close').click();
        await openKnows(page, 'Anna');
        await expect(cardOf(page, 'X0009')).toHaveCount(0);
        expect(await page.evaluate(() => {
            const anna = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Anna')!;
            return window.Strom.UI.personOpenConflicts(anna.id).length;
        })).toBe(0);
    });

    test('the conflicts read from a version not loaded are read again after the decision', async ({ page }) => {
        const { decide, treeId } = await setup(page);
        await editJosef(page);
        // Held: the research's conflicts as a version not loaded had them (a write left them).
        await page.evaluate(({ id, head }) => {
            const jan = window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!;
            const st = JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}');
            st.held = { base: head, head: 'aaaa1111bbbb', persons: { [jan.id]: jan.research!.conflicts }, takeovers: [] };
            localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify(st));
        }, { id: treeId, head: HEAD });
        expect(await page.evaluate(id => window.Strom.UI.researchHeld(id)?.head, treeId)).toBe('aaaa1111bbbb');
        await openKnows(page);
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'user', head: NEW_HEAD }, then: { head: NEW_HEAD, janState: 'decided' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'kept');
        await expect.poll(() => page.evaluate(id => window.Strom.UI.researchHeld(id)?.head, treeId)).toBe(NEW_HEAD);
        await expect(card(page, 'Jan').locator('.card-signal')).toHaveCount(0);
        // Folded: the decided row, as the version read says it.
        await page.clock.fastForward(6100);
        await expect(page.locator('#person-research-modal .person-research-decided[data-decided="X0007"]')).toBeVisible();
    });

    test('an error with the dialog closed: "The conflict could not be decided" with "Show" — the dialog at the card in its error; with the dialog open only the card', async ({ page }) => {
        const { decide } = await setup(page);
        await openKnows(page);
        decide.replies.push({ status: 423, body: { code: 'locked' } });
        await side(page, 'user').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'error');
        await expect(toast(page).filter({ hasText: 'could not be decided' })).toHaveCount(0);

        let release!: () => void;
        decide.hold = new Promise<void>(r => { release = r; });
        decide.replies.push({ status: 409, body: { code: 'busy' } });
        await side(page, 'research').locator('.prc-choice').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'busy');
        await page.locator('#person-research-close').click();
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        release();
        await expect(toast(page)).toContainText('The conflict could not be decided');
        await toast(page).locator('.toast-action').click();
        await expect(cardOf(page)).toHaveAttribute('data-state', 'error');
        await expect(cardOf(page).locator('.prc-notice--error .prc-notice-text')).toHaveText('The research is writing a send right now; the decision did not go through.');
        expect(await page.evaluate(() => document.activeElement?.closest('[data-conflict-card]')?.getAttribute('data-conflict-card'))).toBe('X0007');
    });
});

test.describe('the Load dialog after a decision: narrow and dark', () => {
    test.use({ locale: 'en-US' });

    for (const vp of [{ name: 'phone', width: 360, height: 740 }, { name: 'phone held sideways', width: 844, height: 390 }, { name: 'tablet', width: 820, height: 1180 }]) {
        test(`${vp.name}: the decision first, what stays here said, Later and Load inside the window`, async ({ page }) => {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            const { decide } = await setup(page, {}, { janBirth: '3 FEB 1865', janDeath: '1933' });
            decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'research', head: NEW_HEAD },
                then: { head: NEW_HEAD, janBirth: '3 FEB 1865', janDeath: '1933', janState: 'decided' } });
            await openKnows(page);
            await side(page, 'research').locator('.prc-choice').click();
            const dialog = page.locator('#research-load-modal');
            await expect(dialog).toBeVisible();
            await expect(dialog.locator('.research-load-decided')).toBeVisible();
            const later = vp.width <= 640 ? dialog.locator('.research-load-backup-narrow') : dialog.locator('.research-load-backup');
            await expect(later).toHaveText('Later: 1865 stays here for now.');
            for (const id of ['#research-load-cancel', '#research-load-ok']) {
                const box = (await dialog.locator(id).boundingBox())!;
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
            }
        });
    }

    test('dark theme: the "decided" tag in the dark primary tokens', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const { decide } = await setup(page, {}, { janBirth: '3 FEB 1865', janDeath: '1933' });
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
        await openKnows(page);
        decide.replies.push({ status: 200, body: { decided: 'X0007', take: 'research', head: NEW_HEAD },
            then: { head: NEW_HEAD, janBirth: '3 FEB 1865', janDeath: '1933', janState: 'decided' } });
        await side(page, 'research').locator('.prc-choice').click();
        const tag = page.locator('#research-load-modal .research-load-decided');
        await expect(tag).toBeVisible();
        expect(await tag.evaluate(el => getComputedStyle(el).color)).toBe(await token(page, '--primary-dark', 'color'));
        expect(await tag.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--primary-soft'));
    });
});

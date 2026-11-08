import { test, expect, Page, Route } from '@playwright/test';
import { BRIDGE, NEW_HEAD, HEAD, FakeBridge, poll } from './research-bridge.js';
import { conflictGed, setupConflict, openEdit, openKnows, tag, panel, cardOf, Version } from './research-conflict.js';

/**
 * "Originally from the family tree:" under a fact the research changed, and
 * its Revert through the research's bridge (spec 066 §3): the row with the
 * family tree's value, the record and Revert; the confirmation; the row gone
 * after the research's new version with a notice; the refusals under the row
 * (another computer writes, the research busy with Try again, already
 * reverted, the fact gone); a bridge without `origin` shows nothing of it; a
 * phone says where reverting works. A conflict of the kind import shows its
 * proposal at the fact and its own words in the panel and the dialog.
 * Invented data only.
 */

const cors = { 'access-control-allow-origin': '*' };
const FEATURES = ['conflict.decide', 'origin'];

/** Jan's birth date corrected by the research from the family tree's 1865, by the register S0001. */
const CORRECTED: Version = {
    noBirthConflict: true,
    janBirth: '3 FEB 1865',
    janBirthExtra: ['2 SOUR @S0001@', '2 _STROM_ORIGIN research', '2 _STROM_WAS 1865', '3 _STROM_IMPORT R1', '3 _PART DATE', '3 _REF E0001'],
};
/** Jan's birth from the family tree (R1), a conflict of the kind import proposing the register's date. */
const KIND_IMPORT: Version = {
    janBirthKind: 'import',
    janBirthExtra: ['2 _STROM_ORIGIN import R1'],
    headExtra: ['1 _STROM_IMPORT R1', '2 SOUR Rodokmenar', '2 VERS 5.2', '2 DATE 12 MAR 2024', '2 _AT 2026-11-01', '2 FILE stary.ged'],
};
/** After the revert: the family tree's value again, entered by a person. */
const REVERTED: Version = { noBirthConflict: true, head: NEW_HEAD, janBirth: '1865', janBirthExtra: ['2 SOUR @S0001@', '2 _STROM_ORIGIN user'] };

interface RevertReply { status: number; body?: unknown; then?: Version }
interface RevertRoute { asks: unknown[]; replies: RevertReply[] }

async function revertRoute(page: Page, bridge: FakeBridge): Promise<RevertRoute> {
    const r: RevertRoute = { asks: [], replies: [] };
    await page.route(`${BRIDGE}/facts/revert**`, async (route: Route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': '*' } });
        r.asks.push(JSON.parse(req.postData() ?? 'null'));
        const reply = r.replies.shift() ?? { status: 500, body: { error: 'no reply queued' } };
        if (reply.then) {
            bridge.head = reply.then.head ?? NEW_HEAD;
            bridge.treeGed = conflictGed(reply.then);
        }
        return route.fulfill({ status: reply.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(reply.body ?? {}) });
    });
    return r;
}

const was = (page: Page) => page.locator('#person-modal .fact-was[data-fact="birth"]');
const note = (page: Page) => page.locator('#person-modal .fact-origin[data-origin-fact="birth"] .fact-was-note');
const revert = (page: Page) => was(page).locator('.fact-was-revert');

async function setup(page: Page, opts: { features?: string[]; opened?: Version } = {}) {
    const s = await setupConflict(page, { opened: opts.opened ?? CORRECTED, features: opts.features ?? FEATURES });
    const r = await revertRoute(page, s.bridge);
    await openEdit(page);
    return { ...s, revert: r };
}

async function confirmRevert(page: Page): Promise<void> {
    await revert(page).click();
    const dialog = page.locator('#confirmation-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#confirm-ok-btn').click();
}

test.describe('Originally from the family tree and Revert', () => {
    test('the row: the family tree\'s value, the record, Revert; the record opens', async ({ page }) => {
        await setup(page);
        await expect(was(page)).toBeVisible();
        await expect(was(page).locator('.fact-was-key')).toHaveText('Originally from the family tree:');
        await expect(was(page).locator('.fact-was-value')).toHaveText('1865');
        await expect(was(page).locator('.fact-was-source')).toHaveText('per Oddací matrika Čáslav');
        await expect(revert(page)).toHaveText('Revert');
        await expect(revert(page)).toBeEnabled();
        await expect(note(page)).toHaveCount(0);
        await was(page).locator('.fact-was-source').click();
        await expect(page.locator('#source-viewer-modal')).toBeVisible();
    });

    test('confirm, 200: the confirmation says what changes; the row goes with the new version, a notice says so', async ({ page }) => {
        const { revert: route } = await setup(page);
        route.replies.push({ status: 200, body: { ok: true, head: NEW_HEAD, parent: HEAD }, then: REVERTED });
        await revert(page).click();
        const dialog = page.locator('#confirmation-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('Revert to the family tree\'s value?');
        await expect(dialog).toContainText('Birth 3 Feb 1865, Chlumy (per Oddací matrika Čáslav) will be replaced by the family tree\'s value 1865, Chlumy.');
        await expect(dialog).toContainText('The reverted fact counts as entered by a person');
        await dialog.locator('#confirm-ok-btn').click();
        await expect(page.locator('.toast')).toContainText('Birth reverted to the family tree\'s value.');
        await expect(was(page)).toHaveCount(0);
        expect(route.asks).toEqual([{ person: 'P0003', ref: 'E0001', part: 'DATE' }]);
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.birthDate)).toBe('1865');
    });

    test('cancel: nothing is asked', async ({ page }) => {
        const { revert: route } = await setup(page);
        await revert(page).click();
        await page.locator('#confirmation-modal #confirm-cancel-btn').click();
        await expect(was(page)).toBeVisible();
        expect(route.asks).toEqual([]);
    });

    test('403: another computer writes — the sentence under the row, Revert stays', async ({ page }) => {
        const { revert: route } = await setup(page);
        route.replies.push({ status: 403, body: { error: 'write held', params: { computer: 'Pracovna' } } });
        await confirmRevert(page);
        await expect(note(page)).toHaveText('Reverting is not possible now: another computer (Pracovna) holds writing to the research.');
        await expect(revert(page)).toBeVisible();
        await expect(page.locator('#confirmation-modal')).toBeHidden();
    });

    test('503: the research is busy — the sentence and Try again, which asks again without a confirmation', async ({ page }) => {
        const { revert: route } = await setup(page);
        route.replies.push({ status: 503, body: { error: 'busy' } });
        await confirmRevert(page);
        await expect(note(page)).toContainText('The research is working right now; reverting will work in a moment.');
        await expect(revert(page)).toHaveCount(0);
        route.replies.push({ status: 200, body: { ok: true, head: NEW_HEAD, parent: HEAD }, then: REVERTED });
        await note(page).locator('.fact-was-retry').click();
        await expect(page.locator('#confirmation-modal')).toBeHidden();
        await expect(was(page)).toHaveCount(0);
        expect(route.asks).toHaveLength(2);
    });

    test('409: already reverted — a notice, the row goes with the new version', async ({ page }) => {
        const { revert: route } = await setup(page);
        route.replies.push({ status: 409, body: { error: 'nothing', code: 'revert.nothing' }, then: REVERTED });
        await confirmRevert(page);
        await expect(page.locator('.toast')).toContainText('The fact is already reverted.');
        await expect(was(page)).toHaveCount(0);
    });

    test('404: the fact is gone — the sentence, no Revert', async ({ page }) => {
        const { revert: route } = await setup(page);
        route.replies.push({ status: 404, body: { error: 'unknown', code: 'revert.unknown' } });
        await confirmRevert(page);
        await expect(note(page)).toHaveText('The fact is no longer in the research; this line disappears once the new version loads.');
        await expect(revert(page)).toHaveCount(0);
    });

    test('the bridge stops answering: Revert off with its sentence', async ({ page }) => {
        const { bridge } = await setup(page);
        await expect(revert(page)).toBeEnabled();
        bridge.down = true;
        await poll(page);
        await page.evaluate(() => window.Strom.UI.refreshPersonReliability());
        await expect(revert(page)).toBeDisabled();
        await expect(note(page)).toHaveText('Reverting works while the research runs on this computer.');
    });

    test('a bridge without origin: nothing of the row', async ({ page }) => {
        await setup(page, { features: ['conflict.decide'] });
        await expect(page.locator('#person-modal .fact-origin')).toHaveCount(0);
        await expect(page.locator('#person-modal .fact-was')).toHaveCount(0);
    });

    test('a conflict of the kind import: the proposal at the fact, "Conflict ›" opens its panel with its words', async ({ page }) => {
        await setup(page, { opened: KIND_IMPORT });
        const box = page.locator('#person-modal .fact-origin[data-origin-fact="birth"] .fact-proposal');
        await expect(box).toBeVisible();
        await expect(box.locator('.fact-proposal-lead')).toHaveText('The research proposes changing a fact from the family tree');
        await expect(box.locator('.fact-proposal-value')).toHaveText('3 Feb 1865');
        await expect(box.locator('.fact-proposal-source')).toHaveText('per Oddací matrika Čáslav');
        await expect(box.locator('.fact-proposal-open')).toHaveText('Conflict ›');
        await expect(box.locator('.research-open-mark, svg')).toHaveCount(0);
        await box.locator('.fact-proposal-open').click();
        await expect(panel(page)).toBeVisible();
        await expect(panel(page).locator('.prc-kind')).toHaveText('The research proposes changing a fact from the family tree.');
        await expect(panel(page).locator('.prc-panel-row[data-side="user"] .prc-side-label')).toHaveText('Now · from the family tree');
        await expect(panel(page).locator('.prc-panel-row[data-side="user"] .prc-panel-meta')).toHaveText('Rodokmenar 5.2, file 12 Mar 2024');
        await expect(panel(page).locator('.prc-panel-row[data-side="research"] .prc-side-label')).toHaveText('Research proposal');
        await expect(panel(page).locator('.prc-panel-row[data-side="user"] .prc-panel-choice')).toHaveText('Keep the family tree\'s');
        await expect(panel(page).locator('.prc-panel-row[data-side="research"] .prc-panel-choice')).toHaveText('Accept the proposal');
        await expect(panel(page).locator('.prc-panel-row[data-side="research"] .prc-panel-note')).toContainText('“Originally from the family tree: 1865” stays with Revert.');
        await expect(tag(page)).toBeVisible();
    });

    test('a conflict of the kind import in "What the research knows": its sentence, sides and one row of choices', async ({ page }) => {
        await setupConflict(page, { opened: KIND_IMPORT, features: FEATURES });
        await openKnows(page);
        const c = cardOf(page);
        await expect(c.locator('.prc-kind')).toHaveText('The research proposes changing a fact from the family tree.');
        await expect(c.locator('.prc-side[data-side="user"] .prc-side-label')).toHaveText('Now · from the family tree');
        await expect(c.locator('.prc-side[data-side="user"] .prc-meta')).toHaveText('Rodokmenar 5.2, file 12 Mar 2024');
        await expect(c.locator('.prc-side[data-side="research"] .prc-side-label')).toHaveText('Research proposal');
        await expect(c.locator('.prc-kind-choices .prc-choice')).toHaveText(['Keep the family tree\'s', 'Accept the proposal']);
        await expect(c.locator('.prc-kind-choices .prc-choice svg')).toHaveCount(0);
        await expect(c.locator('.prc-kind-note')).toContainText('Once accepted, the fact is confirmed by a person');
    });

    test('a conflict of an edit in the app keeps its words', async ({ page }) => {
        await setupConflict(page, { features: FEATURES });
        await openKnows(page);
        const c = cardOf(page);
        await expect(c.locator('.prc-kind')).toHaveCount(0);
        await expect(c.locator('.prc-kind-choices')).toHaveCount(0);
        await expect(c.locator('.prc-side[data-side="research"] .prc-choice')).toBeVisible();
    });
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the row without Revert: the sentence where reverting works', async ({ page }) => {
        await setup(page);
        await expect(was(page)).toBeVisible();
        await expect(revert(page)).toHaveCount(0);
        await expect(note(page)).toHaveText('Reverting works in the app on the computer with the research.');
    });
});

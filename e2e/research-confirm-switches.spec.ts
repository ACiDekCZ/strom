import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeMaterial, fakeRunConfirm, fakeSortConfirm, materialFile, openResearch, poll, MATERIAL_FEATURES, UUID, BRIDGE,
    FakeBridge, FakeRunConfirm, FakeSortConfirm,
} from './research-bridge.js';

/**
 * Switching "without asking" on from the app (spec 123 P2): with `sort.confirm.app` "Sort with the agent without
 * asking" is switched on in Research for this tree after the app's confirmation dialog (Cancel writes nothing); with
 * `run.confirm` a group "Starting the agent" under Materials holds "Start the agent without confirming", read from
 * `/status.work.confirm` and written through `POST /settings/run`; off goes at once, without a dialog. A refusal
 * from a device (403 `*.raise`, reason `device`) keeps the switch off with its sentence. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const BASE_FEATURES = [...MATERIAL_FEATURES, 'material.edit', 'material.sort', 'work.link'];

async function setup(page: Page, opts: { features: string[]; sortConfirm?: FakeSortConfirm; runConfirm?: FakeRunConfirm }): Promise<FakeBridge> {
    await page.clock.setFixedTime(new Date('2026-11-25T10:30:00Z'));
    const material = fakeMaterial({ files: [materialFile(1)], sortProposals: [] });
    const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features, material,
        ...(opts.sortConfirm ? { sortConfirm: opts.sortConfirm } : {}), ...(opts.runConfirm ? { runConfirm: opts.runConfirm } : {}) });
    await openResearch(page, { media: true });
    await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
    }, { uuid: UUID, base: BRIDGE, accepts: MEDIA_ACCEPTS });
    await poll(page);
    return b;
}

async function openTreeSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
    await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
}
const sortRow = (page: Page) => page.locator('#research-tree-settings-modal .research-sort-confirm-row');
const sortToggle = (page: Page) => page.locator('#research-sort-confirm');
const sortNote = (page: Page) => page.locator('#research-sort-confirm-note');
const runRow = (page: Page) => page.locator('#research-tree-settings-modal .research-run-confirm-row');
const runToggle = (page: Page) => page.locator('#research-run-confirm');
const runNote = (page: Page) => page.locator('#research-run-confirm-note');
const dialog = (page: Page) => page.locator('#confirmation-modal');

test.describe('Without asking, switched on from the app', () => {
    test.use({ viewport: DESKTOP });

    test('Sort with the agent without asking: with sort.confirm.app the dialog asks first; Cancel writes nothing, Switch on writes no', async ({ page }) => {
        const sort = fakeSortConfirm('ask');
        await setup(page, { features: [...BASE_FEATURES, 'sort.confirm', 'sort.confirm.app'], sortConfirm: sort });
        await openTreeSettings(page);
        await expect(sortRow(page).locator('.settings-desc')).toContainText('Applies to this tree.');
        await expect(sortRow(page).locator('.settings-desc')).not.toContainText('only in the research terminal');
        await expect(sortToggle(page)).toBeEnabled();
        await expect(sortToggle(page)).not.toBeChecked();

        await sortRow(page).click();
        await expect(dialog(page)).toBeVisible();
        await expect(page.locator('#confirm-title')).toHaveText('Sort with the agent without asking?');
        await expect(page.locator('#confirm-message')).toContainText('uses the subscription or credit of the AI agent without another question');
        await expect(page.locator('#confirm-message')).toContainText('Applies to this tree.');
        await expect(page.locator('#confirm-ok-btn')).toHaveText('Switch on');
        await page.locator('#confirm-cancel-btn').click();
        await expect(dialog(page)).toBeHidden();
        await expect(sortToggle(page)).not.toBeChecked();
        expect(sort.posts).toEqual([]);

        await sortRow(page).click();
        await page.locator('#confirm-ok-btn').click();
        await expect.poll(() => sort.posts).toEqual([{ confirm: 'no' }]);
        await expect(sortRow(page).locator('[data-pend]')).toHaveCount(0);
        await expect(sortToggle(page)).toBeChecked();
        await expect(sortNote(page)).toHaveCount(0);
        await poll(page);
        await expect(sortToggle(page)).toBeChecked();

        // Off at once, without a dialog.
        await sortRow(page).click();
        await expect.poll(() => sort.posts).toEqual([{ confirm: 'no' }, { confirm: 'ask' }]);
        await expect(dialog(page)).toBeHidden();
        await expect(sortToggle(page)).not.toBeChecked();
    });

    test('Sort with the agent without asking: without sort.confirm.app no dialog, the research refuses with the terminal command', async ({ page }) => {
        const sort = fakeSortConfirm('ask');
        await setup(page, { features: [...BASE_FEATURES, 'sort.confirm'], sortConfirm: sort });
        await openTreeSettings(page);
        await expect(sortRow(page).locator('.settings-desc')).toContainText('Applies to this tree. Switching it on is possible only in the research terminal.');
        await sortRow(page).click();
        await expect.poll(() => sort.posts).toEqual([{ confirm: 'no' }]);
        await expect(dialog(page)).toBeHidden();
        await expect(sortNote(page)).toContainText('Not switched on. The command for the research terminal:');
        await expect(sortNote(page).locator('code')).toHaveText('strom config set sort.confirm no --for-tree');
        await expect(sortToggle(page)).not.toBeChecked();
    });

    test('Sort with the agent without asking: refused from a device (reason device), the switch stays off with its sentence', async ({ page }) => {
        const sort = fakeSortConfirm('ask');
        sort.raiseReason = 'device';
        await setup(page, { features: [...BASE_FEATURES, 'sort.confirm', 'sort.confirm.app'], sortConfirm: sort });
        await openTreeSettings(page);
        await sortRow(page).click();
        await page.locator('#confirm-ok-btn').click();
        await expect.poll(() => sort.posts).toEqual([{ confirm: 'no' }]);
        await expect(sortNote(page)).toHaveText('Not switched on. Switching it on is possible only on the computer with the research.');
        await expect(sortNote(page).locator('code')).toHaveCount(0);
        await expect(sortToggle(page)).not.toBeChecked();
    });

    test('Start the agent without confirming: no switch without run.confirm, even when the status says work.confirm', async ({ page }) => {
        await setup(page, { features: [...BASE_FEATURES, 'sort.confirm'], sortConfirm: fakeSortConfirm('ask'), runConfirm: fakeRunConfirm('ask') });
        await openTreeSettings(page);
        await expect(sortToggle(page)).toBeVisible();
        await expect(runToggle(page)).toHaveCount(0);
        await expect(page.locator('#research-intake-host fieldset')).toHaveCount(1);
    });

    test('Start the agent without confirming: its own group under Materials; on after the dialog, off at once; no mark', async ({ page }) => {
        const run = fakeRunConfirm('ask');
        await setup(page, { features: [...BASE_FEATURES, 'sort.confirm', 'run.confirm'], sortConfirm: fakeSortConfirm('ask'), runConfirm: run });
        await openTreeSettings(page);
        const groups = page.locator('#research-intake-host fieldset');
        await expect(groups).toHaveCount(2);
        await expect(groups.nth(0).locator('legend')).toHaveText('Materials');
        await expect(groups.nth(1).locator('legend')).toHaveText('Starting the agent');
        await expect(runRow(page).locator('.settings-name')).toHaveText('Start the agent without confirming');
        await expect(runRow(page).locator('.settings-desc')).toContainText('Applies to all researches on this computer.');
        await expect(runToggle(page)).not.toBeChecked();
        await expect(groups.nth(1).locator('.research-ai-badge, .research-open-mark, svg, button, a')).toHaveCount(0);

        await runRow(page).click();
        await expect(page.locator('#confirm-title')).toHaveText('Start the agent without confirming?');
        await expect(page.locator('#confirm-message')).toContainText('Applies to all researches on this computer.');
        await page.locator('#confirm-cancel-btn').click();
        await expect(runToggle(page)).not.toBeChecked();
        expect(run.posts).toEqual([]);

        await runRow(page).click();
        await page.locator('#confirm-ok-btn').click();
        await expect.poll(() => run.posts).toEqual([{ confirm: 'no' }]);
        await expect(runRow(page).locator('[data-pend]')).toHaveCount(0);
        await expect(runToggle(page)).toBeChecked();
        await poll(page);
        await expect(runToggle(page)).toBeChecked();
        await expect(runNote(page)).toHaveCount(0);

        await runRow(page).click();
        await expect.poll(() => run.posts).toEqual([{ confirm: 'no' }, { confirm: 'ask' }]);
        await expect(dialog(page)).toBeHidden();
        await expect(runToggle(page)).not.toBeChecked();
        await poll(page);
        await expect(runToggle(page)).not.toBeChecked();
    });

    test('Start the agent without confirming: 403 run.raise from a device keeps it off with its sentence; from elsewhere the command', async ({ page }) => {
        const run = fakeRunConfirm('ask');
        run.raiseReason = 'device';
        run.replies.push({ status: 403, body: { error: 'Not here.', code: 'run.raise', command: 'strom config set run.confirm no', reason: 'browser' } });
        await setup(page, { features: [...BASE_FEATURES, 'run.confirm'], runConfirm: run });
        await openTreeSettings(page);
        // The group stands alone when the research says no other setting of Materials.
        await expect(page.locator('#research-intake-host fieldset')).toHaveCount(1);
        await expect(page.locator('#research-intake-host legend')).toHaveText('Starting the agent');

        await runRow(page).click();
        await page.locator('#confirm-ok-btn').click();
        await expect(runNote(page)).toContainText('Not switched on. The command for the research terminal:');
        await expect(runNote(page).locator('code')).toHaveText('strom config set run.confirm no');
        await expect(runToggle(page)).not.toBeChecked();

        await runRow(page).click();
        await page.locator('#confirm-ok-btn').click();
        await expect(runNote(page)).toHaveText('Not switched on. Switching it on is possible only on the computer with the research.');
        await expect(runToggle(page)).not.toBeChecked();
        expect(run.posts).toEqual([{ confirm: 'no' }, { confirm: 'no' }]);
        expect(run.confirm).toBe('ask');
    });
});

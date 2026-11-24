import { test, expect, Page } from '@playwright/test';
import {
    fakeBridge, fakeIntake, fakeMaterial, fakeSortConfirm, materialFile, openResearch, poll, MATERIAL_FEATURES, UUID, BRIDGE,
    FakeBridge, FakeSortConfirm,
} from './research-bridge.js';

/**
 * Sort with the agent without asking (spec 102 U8): with `sort.confirm` the research's group Materials in Research
 * for this tree has a switch that follows `/status.sort.confirm`. Off is written at once (`POST /settings/sort
 * {"confirm": "ask"}`); on is only the person's in the research's terminal (403 `sort.raise`): the switch stays off
 * and the sentence gives the command to copy, until the status says `no`. With `no` the dialog of Sort with the
 * agent does not say the cost; the sorting still goes only with its button. Invented data.
 */

const DESKTOP = { width: 1440, height: 900 };
const MEDIA_ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, tasks: 'open', batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } } };
const SORT_FEATURES = [...MATERIAL_FEATURES, 'material.edit', 'material.sort'];
const COMMAND = 'strom config set sort.confirm no --for-tree';

async function setup(page: Page, opts: { features: string[]; sortConfirm?: FakeSortConfirm; intake?: boolean }): Promise<FakeBridge> {
    await page.clock.setFixedTime(new Date('2026-11-24T10:30:00Z'));
    const material = fakeMaterial({ files: [materialFile(1), materialFile(2), materialFile(3)], sortProposals: [] });
    const b = await fakeBridge(page, { accepts: MEDIA_ACCEPTS, features: opts.features, material,
        ...(opts.sortConfirm ? { sortConfirm: opts.sortConfirm } : {}), ...(opts.intake ? { intake: fakeIntake(false) } : {}) });
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
const row = (page: Page) => page.locator('#research-tree-settings-modal .research-sort-confirm-row');
const toggle = (page: Page) => page.locator('#research-sort-confirm');
const note = (page: Page) => page.locator('#research-sort-confirm-note');

test.describe('Sort with the agent without asking', () => {
    test.use({ viewport: DESKTOP });

    test('Research for this tree: the switch follows /status.sort; off at once through POST /settings/sort {"confirm":"ask"}; no mark', async ({ page }) => {
        const sort = fakeSortConfirm('no');
        await setup(page, { features: [...SORT_FEATURES, 'sort.confirm'], sortConfirm: sort });
        await openTreeSettings(page);
        await expect(page.locator('#research-intake-host legend')).toHaveText('Materials');
        await expect(row(page).locator('.settings-name')).toHaveText('Sort with the agent without asking');
        await expect(row(page).locator('.settings-desc')).toContainText('Switching it on is possible only in the research terminal.');
        await expect(toggle(page)).toBeChecked();
        await expect(note(page)).toHaveCount(0);
        // Through the bridge, no terminal: no AI badge, no terminal mark, no link.
        await expect(page.locator('#research-intake-host').locator('.research-ai-badge, .research-open-mark, svg, button, a')).toHaveCount(0);

        await row(page).click();
        await expect.poll(() => sort.posts).toEqual([{ confirm: 'ask' }]);
        await expect(row(page).locator('[data-pend]')).toHaveCount(0);
        await expect(toggle(page)).not.toBeChecked();
        await poll(page);
        await expect(toggle(page)).not.toBeChecked();
        await expect(note(page)).toHaveCount(0);
    });

    test('Research for this tree: switching on is refused; the switch stays off, the sentence gives the command to copy; on once the status says no', async ({ page }) => {
        const sort = fakeSortConfirm('ask');
        await setup(page, { features: [...SORT_FEATURES, 'sort.confirm'], sortConfirm: sort });
        await openTreeSettings(page);
        await expect(toggle(page)).not.toBeChecked();

        await row(page).click();
        await expect.poll(() => sort.posts).toEqual([{ confirm: 'no' }]);
        await expect(note(page)).toContainText('Not switched on. The command for the research terminal:');
        await expect(note(page).locator('code')).toHaveText(COMMAND);
        await expect(note(page).locator('.research-live-copy')).toHaveText('Copy');
        await expect(toggle(page)).not.toBeChecked();
        await poll(page);
        await expect(toggle(page)).not.toBeChecked();
        expect(sort.sort).toEqual({ confirm: 'ask' });

        // The person runs the command in the research's terminal: the status says no, the command goes.
        sort.sort = { confirm: 'no' };
        await poll(page);
        await expect(toggle(page)).toBeChecked();
        await expect(note(page)).toHaveCount(0);
    });

    test('Research for this tree: busy (503) says so under the row and the switch stays; an archive\'s refusal takes the row away', async ({ page }) => {
        const sort = fakeSortConfirm('no');
        sort.replies.push({ status: 503, body: { error: 'Busy.', code: 'research.busy' } });
        sort.replies.push({ status: 409, body: { error: 'An archive does not sort.', code: 'sort.archive', reasonCode: 'archive' } });
        await setup(page, { features: [...SORT_FEATURES, 'sort.confirm'], sortConfirm: sort });
        await openTreeSettings(page);
        await row(page).click();
        await expect(note(page)).toHaveText('The research is busy. It will work again shortly.');
        await expect(toggle(page)).toBeChecked();
        await row(page).click();
        await expect(page.locator('#research-intake-host')).toBeEmpty();
        expect(sort.posts).toEqual([{ confirm: 'ask' }, { confirm: 'ask' }]);
    });

    test('Research for this tree: no switch without sort.confirm; the intake switch alone stays', async ({ page }) => {
        await setup(page, { features: [...SORT_FEATURES, 'intake.auto'], sortConfirm: fakeSortConfirm('no'), intake: true });
        await openTreeSettings(page);
        await expect(page.locator('#research-intake-auto')).toBeVisible();
        await expect(toggle(page)).toHaveCount(0);
    });

    test('Research for this tree: no switch when the status does not say the setting', async ({ page }) => {
        const sort = fakeSortConfirm('no');
        delete sort.sort;
        await setup(page, { features: [...SORT_FEATURES, 'sort.confirm'], sortConfirm: sort });
        await openTreeSettings(page);
        await expect(page.locator('#research-intake-host')).toBeEmpty();
    });

    async function openSortDialog(page: Page) {
        await page.evaluate(() => (window.Strom.UI as unknown as { openMaterials(o: unknown): void }).openMaterials({}));
        await expect(page.locator('#materials-modal .mw-canvas .mw-tile').first()).toBeVisible();
        await page.locator('#materials-modal .mw-sort--top [data-sort="sort"]').click();
        const d = page.locator('.mdlg--sort');
        await expect(d).toBeVisible();
        return d;
    }

    test('Sort with the agent: with no the cost is not said; the button with its AI badge and the count sends it', async ({ page }) => {
        const b = await setup(page, { features: [...SORT_FEATURES, 'sort.confirm'], sortConfirm: fakeSortConfirm('no') });
        const d = await openSortDialog(page);
        await expect(d.locator('.mdlg-title')).toHaveText('Sort with the agent · 3 files');
        await expect(d.locator('.mdlg-sort-plan')).toHaveText('3 files are sent in 1 batch.');
        await expect(d.locator('.mdlg-sort-cost')).toHaveText('');
        await expect(d.locator('.mdlg-sort-big')).toBeHidden();
        await expect(d).not.toContainText('subscription or credit');
        const go = d.locator('.mdlg-sort-go');
        await expect(go.locator('.research-ai-badge')).toHaveCount(1);
        expect(b.material!.sorts ?? []).toHaveLength(0);
        await go.click();
        await expect.poll(() => b.material!.sorts?.length).toBe(1);
    });

    test('Sort with the agent: with ask the cost is said as before', async ({ page }) => {
        await setup(page, { features: [...SORT_FEATURES, 'sort.confirm'], sortConfirm: fakeSortConfirm('ask') });
        const d = await openSortDialog(page);
        await expect(d.locator('.mdlg-sort-cost')).toHaveText('Uses the subscription or credit.');
    });
});

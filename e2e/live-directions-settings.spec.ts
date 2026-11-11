import { test, expect, Page } from '@playwright/test';
import {
    ago, CAPS, followManaged, GED, launchedLinks, ManagedBridge, MANAGED_DIRECTIONS, openOverview, overview, UUID,
} from './live-directions-bridge.js';

/**
 * Work outside the directions in Research for this tree (spec 038 §9.5,
 * K7): the tree's choice as four cards written at once to the bridge, the
 * research's share read only, the growing branches' question (not with
 * Never), the branches with their own choice and the tasks with a manual
 * place reset to default, a refusal under its card with the choice back,
 * a narrow window as a full-page sheet, an older research without the
 * group. And Resume of a paused direction from a person's research edge
 * through the bridge with no mark (an older research: its terminal).
 * Invented data only (the Fíškovi of Smrkov).
 */

const GED_OFFLINE = GED.replace('0 @F0001@ FAM', [
    '0 @P0031@ INDI', '1 NAME Alois /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1868', '1 REFN P0031',
    '0 @P0040@ INDI', '1 NAME Bohumil /Svoboda/', '1 SEX M', '1 BIRT', '2 DATE 1838', '1 REFN P0040',
    '0 @P0045@ INDI', '1 NAME Václav /Lhoták/', '1 SEX M', '1 BIRT', '2 DATE 1869', '1 REFN P0045',
    '0 @F0001@ FAM',
].join('\n'));

const OFF_CAPS = { ...CAPS, offLineBranches: true };
const FEATURES = ['directions.edit', 'directions.order', 'directions.found', 'directions.people', 'offLine.branches', 'queue.own'];

const BRANCHES = [
    { id: 'B-P0031', person: 'P0031', via: { person: 'P0012', rel: 'sibling' }, nearest: 'G0001', tasks: 14, persons: 6,
        samples: [{ id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894' }], mode: 'occasional', own: false },
    { id: 'B-P0040', person: 'P0040', via: { person: 'P0002', rel: 'sibling' }, nearest: 'G0004', tasks: 7, persons: 3,
        samples: [{ id: 'T0420', text: 'Úmrtí Bohumila Svobody' }], mode: 'normal', own: true },
    { id: 'B-P0045', person: 'P0045', via: { person: 'P0050', rel: 'partner' }, nearest: 'G0002', tasks: 3, persons: 1,
        samples: [], mode: 'never', own: true },
    { id: 'B-P0050', person: 'P0050', via: { person: 'P0012', rel: 'sibling' }, nearest: 'G0001', tasks: 5, persons: 2,
        samples: [], mode: 'line', line: 'G0001', own: true },
];
const OFF_LINE = { mode: 'occasional', own: false, share: 12, suggest: true, tasks: 24, queued: 21, ownTasks: 2, branches: BRANCHES };

const QUEUE = [
    { id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894', state: 'next', branch: 'B-P0031', own: 'next', why: { kind: 'own', do: 'next' } },
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001', why: { kind: 'line', research: 'G0001' } },
    { id: 'T0420', text: 'Úmrtí Bohumila Svobody', state: 'next', branch: 'B-P0040', own: 'last', why: { kind: 'own', do: 'last' } },
];

const follow = (page: Page, opts: { size?: { width: number; height: number }; caps?: Record<string, unknown> | null } = {}): Promise<ManagedBridge> =>
    followManaged(page, { caps: OFF_CAPS, features: FEATURES, offLine: OFF_LINE, queue: QUEUE, ged: GED_OFFLINE, ...opts });

const dialog = (page: Page) => page.locator('#research-tree-settings-modal');
const group = (page: Page) => dialog(page).locator('.research-offline-settings');
const card = (page: Page, mode: string) => group(page).locator(`.research-transcripts-card:has(input[value="${mode}"])`);
const radio = (page: Page, mode: string) => group(page).locator(`input[name="research-offline-mode"][value="${mode}"]`);
const suggest = (page: Page) => group(page).locator('#research-offline-suggest');
const offWrites = (b: ManagedBridge) => b.writes.filter(w => w.method === 'POST' && /^(offline|queue\/)/.test(w.path));

/** Research for this tree, from the tree's choice in the Overview ("now and then" beside Outside the directions). */
async function openSettings(page: Page): Promise<void> {
    await openOverview(page);
    await overview(page).locator('.research-offline__mode').click();
    await expect(dialog(page)).toBeVisible();
    await expect(group(page)).toBeVisible();
}

test.describe('work outside the directions in Research for this tree', () => {
    test('the group: four cards with the share read only, applies to, the question, own branches and manual tasks', async ({ page }) => {
        await follow(page);
        await openSettings(page);
        await expect(group(page).locator('legend')).toHaveText('Work outside the directions');
        await expect(group(page).locator('.research-offline-settings__intro')).toContainText('siblings of ancestors');
        // What "helps a direction" means (036 K1.8).
        await expect(group(page).locator('.research-offline-settings__intro')).toContainText('(a question of the direction, connecting people to someone in it or to their spouse, a reason the agent gives)');
        await expect(group(page).locator('.research-transcripts-title')).toHaveText(['Now and then (default)', 'At the end', 'As usual', 'Never']);
        await expect(card(page, 'occasional')).toContainText('About 1 task outside the directions per 12 tasks of the directions.');
        await expect(radio(page, 'occasional')).toBeChecked();
        // Opened from the Overview: at the chosen card.
        await expect(radio(page, 'occasional')).toBeFocused();
        // Only the branches that follow the tree's choice; how many have their own after it.
        await expect(group(page).locator('.research-offline-settings__affects'))
            .toHaveText('Applies to 14 tasks in 1 branch. 3 branches have their own choice.');
        await expect(suggest(page)).toBeChecked();
        await expect(suggest(page)).toBeEnabled();
        const rows = group(page).locator('.research-offline-settings__row-text');
        await expect(rows).toHaveText([
            'Bohumil Svoboda – as usual', 'Václav Lhoták – not researched', 'Marie Fíšková – near the direction Předci: Jan Fíšek', '2 tasks with a manual order',
        ]);
        await expect(group(page).locator('.research-offline-settings__row[data-branch="B-P0050"] [data-do="remove-branch"]')).toHaveText('Remove from the direction');
        // Nothing of it has any mark: all through the bridge.
        await expect(group(page).locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        // Below the other groups, above Done.
        const after = await dialog(page).locator('#research-offline-host').evaluate(e => !!e.compareDocumentPosition(document.querySelector('#research-tree-settings-done')!)
            && (e.compareDocumentPosition(document.querySelector('#research-tree-settings-done')!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
        expect(after).toBe(true);
    });

    test('a card and the question written at once; Never leaves the question unavailable; resets one branch and the manual tasks', async ({ page }) => {
        const bridge = await follow(page);
        await openSettings(page);
        await card(page, 'normal').click();
        await expect.poll(() => offWrites(bridge)).toEqual([{ method: 'POST', path: 'offline', body: { mode: 'normal' } }]);
        await expect(radio(page, 'normal')).toBeChecked();
        // The Overview follows (the tree's choice beside Outside the directions).
        await expect(overview(page).locator('.research-offline__mode')).toHaveText('as usual');

        await suggest(page).click();
        await expect.poll(() => offWrites(bridge).at(-1)).toEqual({ method: 'POST', path: 'offline', body: { suggest: false } });
        await expect(suggest(page)).not.toBeChecked();

        await suggest(page).click();
        await expect.poll(() => offWrites(bridge).length).toBe(3);
        await card(page, 'never').click();
        await expect.poll(() => offWrites(bridge).at(-1)).toEqual({ method: 'POST', path: 'offline', body: { mode: 'never' } });
        await expect(suggest(page)).toBeDisabled();
        await expect(group(page).locator('.research-offline-settings__suggest .settings-desc'))
            .toHaveText('With Never the research does not ask about growing branches.');

        // A branch with its own choice back to the default.
        await group(page).locator('.research-offline-settings__row[data-branch="B-P0040"] [data-do="reset-branch"]').click();
        await expect.poll(() => offWrites(bridge).at(-1)).toEqual({ method: 'POST', path: 'offline/B-P0040', body: { mode: 'default' } });
        await expect(group(page).locator('.research-offline-settings__row[data-branch="B-P0040"]')).toHaveCount(0);
        // A branch added to a direction: removed from it.
        await group(page).locator('.research-offline-settings__row[data-branch="B-P0050"] [data-do="remove-branch"]').click();
        await expect.poll(() => offWrites(bridge).at(-1)).toEqual({ method: 'POST', path: 'offline/B-P0050', body: { mode: 'default' } });
        await expect(group(page).locator('.research-offline-settings__row[data-branch="B-P0050"]')).toHaveCount(0);

        // The manual places: one write per task (the bridge has no reset of all).
        const n = offWrites(bridge).length;
        await group(page).locator('[data-do="reset-tasks"]').click();
        await expect.poll(() => offWrites(bridge).slice(n)).toEqual([
            { method: 'POST', path: 'queue/T0412', body: { do: 'default' } },
            { method: 'POST', path: 'queue/T0420', body: { do: 'default' } },
        ]);
        await expect(group(page).locator('.research-offline-settings__tasks')).toHaveCount(0);
    });

    test('a refusal under the chosen card with Try again, the choice back to what the research says', async ({ page }) => {
        const bridge = await follow(page);
        await openSettings(page);
        bridge.replies.push({ status: 500, body: { error: 'internal' } });
        await card(page, 'last').click();
        const problem = group(page).locator('.research-direction__problem');
        await expect(problem).toHaveCount(1);
        await expect(problem).toHaveAttribute('role', 'alert');
        // Right under the card picked.
        expect(await card(page, 'last').evaluate(c => c.nextElementSibling?.classList.contains('research-direction__problem'))).toBe(true);
        await expect(radio(page, 'occasional')).toBeChecked();
        await expect(radio(page, 'last')).not.toBeChecked();
        await problem.locator('[data-do="retry"]').click();
        await expect.poll(() => offWrites(bridge).map(w => w.body)).toEqual([{ mode: 'last' }, { mode: 'last' }]);
        await expect(radio(page, 'last')).toBeChecked();
        await expect(problem).toHaveCount(0);
    });

    test('a narrow window: the dialog as a full-page sheet, nothing wider than the screen', async ({ page }) => {
        await follow(page, { size: { width: 390, height: 844 } });
        await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
        await expect(group(page)).toBeVisible();
        const box = (await dialog(page).locator('.modal').boundingBox())!;
        expect(Math.round(box.width)).toBe(390);
        expect(Math.round(box.height)).toBe(844);
        const wide = await dialog(page).locator('.modal').evaluate(m => m.scrollWidth - m.clientWidth);
        expect(wide).toBeLessThanOrEqual(0);
        const reset = (await group(page).locator('[data-do="reset-tasks"]').boundingBox())!;
        expect(reset.height).toBeGreaterThanOrEqual(44);
    });

    test('from the overview as a sheet: the sheet goes, the dialog is on top', async ({ page }) => {
        await follow(page, { size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await overview(page).locator('.research-offline__mode').click();
        await expect(group(page)).toBeVisible();
        await expect(overview(page)).toHaveCount(0);
        const onTop = await page.evaluate(() => {
            const at = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            return !!at?.closest('#research-tree-settings-modal');
        });
        expect(onTop).toBe(true);
    });

    test('an older research and one without branches: no group', async ({ page }) => {
        await follow(page, { caps: CAPS });
        await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('.research-offline-settings')).toHaveCount(0);
    });
});

/** Anna's research edge: her direction paused. */
const GED_EDGE = GED.replace('1 REFN P0002', ['1 REFN P0002', '1 _STROM_EDGE parents', '2 _SCOPE paused', '2 _RESEARCH G0004', '2 _NEXT none'].join('\n'));

async function openAnnaEdge(page: Page): Promise<void> {
    const id = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons).find(p => p.refn === 'P0002')!.id);
    await page.evaluate((pid) => window.Strom.UI.showPersonResearchDialog(pid, { edge: true }), id);
    await expect(page.locator('#research-edge-section')).toBeVisible();
}

test.describe('resume a direction from the research edge', () => {
    test('through the bridge with no mark, the toast with Undo', async ({ page }) => {
        const bridge = await followManaged(page, { ged: GED_EDGE, researches: MANAGED_DIRECTIONS });
        await openAnnaEdge(page);
        const resume = page.locator('#research-edge-section .rep-action[data-do="resume"]');
        await expect(resume).toHaveText('Resume the direction');
        await expect(resume.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await resume.click();
        await expect.poll(() => bridge.writes.filter(w => w.method === 'POST'))
            .toEqual([{ method: 'POST', path: 'directions/G0004/state', body: { do: 'resume' } }]);
        await expect(page.locator('.toast[data-kind="direction"]')).toBeVisible();
        await expect(resume).toHaveCount(0);
        expect(await launchedLinks(page)).toEqual([]);
    });

    test('a refusal said under the actions, the button there again', async ({ page }) => {
        const bridge = await followManaged(page, { ged: GED_EDGE });
        await openAnnaEdge(page);
        bridge.replies.push({ status: 500, body: { error: 'internal' } });
        const resume = page.locator('#research-edge-section .rep-action[data-do="resume"]');
        await resume.click();
        await expect(page.locator('#research-edge-section .rep-problem')).toHaveAttribute('role', 'alert');
        await expect(resume).toBeEnabled();
    });

    test('an older research: in its terminal, with the terminal mark', async ({ page }) => {
        await followManaged(page, { ged: GED_EDGE, caps: null, researches: [
            { id: 'G0001', name: 'Předci: Jan Fíšek', state: 'active', since: ago(60) },
            { id: 'G0004', name: 'Předci: Anna Svobodová', state: 'paused', since: ago(60) },
        ] });
        await openAnnaEdge(page);
        const resume = page.locator('#research-edge-section .rep-action[data-do="resume"]');
        await expect(resume.locator('.research-open-mark')).toHaveCount(1);
        await resume.click();
        await expect.poll(() => launchedLinks(page)).toEqual([expect.stringMatching(new RegExp(`^strom-research://direction\\?tree=${UUID}.*G0004`))]);
    });
});

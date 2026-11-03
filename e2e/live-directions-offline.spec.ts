import { test, expect, Page } from '@playwright/test';
import {
    ago, BridgeReply, CAPS, directionRow, followManaged, GED, launchedLinks, ManagedBridge, MANAGED_DIRECTIONS, openOverview, overview,
} from './live-directions-bridge.js';

/**
 * Work outside the research's directions (spec 038 §9, K7) through its
 * bridge: the branches under the directions (folded, open with a growing
 * branch waiting), a branch's choices written with Undo (how it is taken,
 * add to a direction and shown there, do not research, create a direction
 * from it), a refusal said at the branch, the queue's reason of each task,
 * a task's own place, a branch's tasks behind a chip, the growing branch in
 * Awaiting action, a narrow window acting as a computer, and an older
 * research unchanged. Invented data only (the Fíškovi of Smrkov).
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
        samples: [{ id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894' }, { id: 'T0413', text: 'Křest Terezie Fíškové' }],
        mode: 'occasional', own: false, grows: true },
    { id: 'B-P0040', person: 'P0040', via: { person: 'P0002', rel: 'sibling' }, nearest: 'G0004', tasks: 7, persons: 3,
        samples: [{ id: 'T0420', text: 'Úmrtí Bohumila Svobody' }], mode: 'normal', own: true },
    { id: 'B-P0045', person: 'P0045', via: { person: 'P0050', rel: 'partner' }, nearest: 'G0002', tasks: 3, persons: 1,
        samples: [], mode: 'never', own: true },
];
const OFF_LINE = { mode: 'occasional', own: false, share: 10, suggest: true, tasks: 24, queued: 21, ownTasks: 0, branches: BRANCHES };

const QUEUE = [
    { id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001', why: { kind: 'line', research: 'G0001' } },
    { id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894', state: 'next', branch: 'B-P0031', why: { kind: 'off', mode: 'occasional', branch: 'B-P0031' } },
    { id: 'T0102', text: 'Kdo byl Josef Fíšek', state: 'next', research: 'G0002', why: { kind: 'helps', research: 'G0002', by: 'question' } },
    { id: 'T0413', text: 'Křest Terezie Fíškové', state: 'next', branch: 'B-P0031', why: { kind: 'off', mode: 'occasional', branch: 'B-P0031' } },
    { id: 'T0420', text: 'Úmrtí Bohumila Svobody', state: 'next', branch: 'B-P0040', why: { kind: 'off', mode: 'normal', branch: 'B-P0040' } },
];

const GROWING = {
    id: 'W-B-P0031', kind: 'branch', branch: 'B-P0031', person: 'P0031', research: 'G0001', tasks: 14, persons: 6,
    at: ago(30), what: 'Větev Alois Fíšek roste', on: 'user',
};

/** A growing branch near the paused direction G0004 (Předci: Anna Svobodová). */
const GROWING_PAUSED = {
    id: 'W-B-P0040', kind: 'branch', branch: 'B-P0040', person: 'P0040', research: 'G0004', tasks: 7, persons: 3,
    at: ago(30), what: 'Větev Bohumil Svoboda roste', on: 'user',
};

const follow = (page: Page, opts: {
    waiting?: Record<string, unknown>[]; size?: { width: number; height: number }; people?: Record<string, string[]>;
} = {}): Promise<ManagedBridge> =>
    followManaged(page, { caps: OFF_CAPS, features: FEATURES, offLine: OFF_LINE, queue: QUEUE, ged: GED_OFFLINE, ...opts });

const section = (page: Page) => overview(page).locator('.research-directions--managed');
const outToggle = (page: Page) => section(page).locator('.research-offline__toggle');
const branchRow = (page: Page, id: string) => section(page).locator(`.research-offline__branch[data-branch="${id}"]`);
const offWrites = (b: ManagedBridge) => b.writes.filter(w => w.method === 'POST' && /^(offline|queue\/|waiting\/)/.test(w.path));
const toast = (page: Page) => page.locator('.toast[data-kind="direction"]');

test.describe('work outside the directions through the bridge', () => {
    test('the branches: under the directions above the ended ones, folded, person, how taken, growing, nearest, samples', async ({ page }) => {
        await follow(page);
        await openOverview(page);
        const toggle = outToggle(page);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toHaveText('▸Outside the directions· 21 tasks in 2 branches');
        await expect(section(page).locator('.research-offline__mode')).toHaveText('now and then');
        // Below the order of work, above Ended.
        const order = await section(page).locator('.research-directions__list > *').evaluateAll(els => els.map(e =>
            e.classList.contains('research-offline__head') ? 'out' : (e as HTMLElement).dataset.ended ? 'ended' : (e as HTMLElement).dataset.direction ?? ''));
        expect(order).toEqual(['G0001', 'G0004', 'G0002', 'out', 'ended']);
        await expect(section(page).locator('.research-offline__branch')).toHaveCount(0);

        await toggle.click();
        await expect(outToggle(page)).toHaveAttribute('aria-expanded', 'true');
        const alois = branchRow(page, 'B-P0031');
        await expect(alois.locator('.research-offline__person')).toHaveText('Alois Fíšek');
        await expect(alois.locator('.research-offline__years')).toHaveText(/1868/);
        await expect(alois.locator('.research-offline__tag')).toHaveText('now and then');
        await expect(alois.locator('.research-offline__dot')).toHaveCount(0);
        await expect(alois.locator('.research-offline__grows')).toHaveText('growing · +6 people');
        await expect(alois.locator('.research-offline__meta')).toHaveText(/brother of Jan Fíšek.*near the direction Předci: Jan Fíšek.*14 tasks/);
        await expect(alois.locator('.research-offline__samples')).toHaveText('Sňatek Aloise Fíška, Vídeň 1894 · Křest Terezie Fíškové');
        // Its own choice: a dot and the word, said to a reader too.
        const bohumil = branchRow(page, 'B-P0040');
        await expect(bohumil.locator('.research-offline__tag')).toHaveText('as usual');
        await expect(bohumil.locator('.research-offline__dot')).toHaveCount(1);
        await expect(bohumil.locator('.research-offline__tag')).toHaveAttribute('aria-label', 'as usual, own choice');
        await expect(bohumil.locator('.research-offline__meta')).toHaveText(/brother of Anna Svobodová.*near the direction Předci: Anna Svobodová \(paused\)/);
        // Not researched: folded last, its row muted with Reset to default.
        const never = section(page).locator('.research-offline__never');
        await expect(never).toHaveText('▸Not researched · 1 branch');
        await never.click();
        await expect(branchRow(page, 'B-P0045')).toHaveClass(/is-never/);
        await expect(branchRow(page, 'B-P0045').locator('.research-offline__tag')).toHaveText('not researched');
        await expect(branchRow(page, 'B-P0045').locator('[data-do="default"]')).toHaveText('Reset to default');
        // No marks: everything here goes through the bridge.
        await expect(section(page).locator('.research-offline__branches .research-open-mark, .research-offline__branches .research-ai-badge')).toHaveCount(0);
    });

    test('how a branch is taken: the segment writes it, Undo puts the default back; the tree\'s choice says (default)', async ({ page }) => {
        const b = await follow(page);
        await openOverview(page);
        await outToggle(page).click();
        const alois = branchRow(page, 'B-P0031');
        await alois.locator('.research-offline__expand').click();
        const seg = alois.locator('.research-offline__seg');
        await expect(seg).toHaveText(['Now and then (default)', 'At the end', 'As usual']);
        await expect(alois.locator('.research-offline__seg[aria-checked="true"]')).toHaveText('Now and then (default)');
        await alois.locator('[data-mode="last"]').click();
        await expect.poll(() => offWrites(b).map(w => [w.path, w.body])).toEqual([['offline/B-P0031', { mode: 'last' }]]);
        await expect(branchRow(page, 'B-P0031').locator('.research-offline__tag')).toHaveText('at the end');
        await expect(branchRow(page, 'B-P0031').locator('.research-offline__dot')).toHaveCount(1);
        await expect(branchRow(page, 'B-P0031').locator('[data-mode="last"]')).toBeFocused();
        await expect(toast(page)).toContainText('Saved');
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => offWrites(b).length).toBe(2);
        expect(offWrites(b)[1]).toMatchObject({ path: 'offline/B-P0031', body: { mode: 'default' } });
        await expect(branchRow(page, 'B-P0031').locator('.research-offline__tag')).toHaveText('now and then');
        // Arrows move along the segment (a radio group) and write the choice.
        await branchRow(page, 'B-P0031').locator('.research-offline__seg[aria-checked="true"]').focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => offWrites(b).length).toBe(3);
        expect(offWrites(b)[2]).toMatchObject({ path: 'offline/B-P0031', body: { mode: 'last' } });
        expect(await launchedLinks(page)).toEqual([]);
    });

    test('add to a direction: the nearest first, the branch leaves the section and helps the direction (Remove = default)', async ({ page }) => {
        const b = await follow(page);
        await openOverview(page);
        await outToggle(page).click();
        const alois = branchRow(page, 'B-P0031');
        await alois.locator('.research-offline__expand').click();
        const add = alois.locator('[data-do="add"]');
        await expect(add).toHaveText('Add to the direction Předci: Jan Fíšek');
        await add.click();
        const pick = page.locator('#research-offline-pick');
        await expect(pick.locator('.research-offline-pick__item')).toHaveText(['Předci: Jan Fíšeknearest', 'Potomci: Josef Fíšek']);
        await expect(pick.locator('.research-offline-pick__item').first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(pick).toHaveCount(0);
        await expect(add).toBeFocused();
        await add.click();
        await pick.locator('[data-direction="G0001"]').click();
        await expect.poll(() => offWrites(b).map(w => [w.path, w.body])).toEqual([['offline/B-P0031', { mode: 'line', line: 'G0001' }]]);
        await expect(branchRow(page, 'B-P0031')).toHaveCount(0);
        await expect(toast(page)).toContainText('Added to the direction');
        await directionRow(page, 'G0001').locator('.research-direction__head').click();
        const helps = directionRow(page, 'G0001').locator('.research-offline__helps[data-branch="B-P0031"]');
        await expect(helps).toHaveText(/Branch Alois Fíšek helps too · 14 tasks.*Remove from the direction/);
        await helps.locator('[data-do="remove-branch"]').click();
        await expect.poll(() => offWrites(b).length).toBe(2);
        expect(offWrites(b)[1]).toMatchObject({ path: 'offline/B-P0031', body: { mode: 'default' } });
        await expect(directionRow(page, 'G0001').locator('.research-offline__helps')).toHaveCount(0);
        await expect(branchRow(page, 'B-P0031')).toHaveCount(1);
    });

    test('the branch ⋯: do not research (no question, Undo), create a direction from it (the form with its person)', async ({ page }) => {
        const b = await follow(page);
        await openOverview(page);
        await outToggle(page).click();
        const more = branchRow(page, 'B-P0040').locator('.research-offline__more');
        await more.click();
        const menu = page.locator('#research-offline-menu');
        await expect(menu.locator('.research-direction-menu__label')).toHaveText(['Create a direction from this branch', 'Do not research', 'Reset to default']);
        await expect(menu.locator('[data-do="never"] .research-direction-menu__hint')).toHaveText('Its tasks leave the queue, nothing is deleted');
        await menu.locator('[data-do="never"]').click();
        await expect.poll(() => offWrites(b).map(w => [w.path, w.body])).toEqual([['offline/B-P0040', { mode: 'never' }]]);
        await expect(toast(page)).toContainText('Branch not researched');
        await expect(section(page).locator('.research-offline__never')).toHaveText('▸Not researched · 2 branches');
        await expect(outToggle(page)).toHaveText(/in 1 branch/);
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => offWrites(b).length).toBe(2);
        // Back as it was: its own choice "as usual".
        expect(offWrites(b)[1]).toMatchObject({ path: 'offline/B-P0040', body: { mode: 'normal' } });

        // A sibling of an ancestor: Descendants, said to be from the relation.
        await branchRow(page, 'B-P0031').locator('.research-offline__more').click();
        await expect(page.locator('#research-offline-menu [data-do="default"]')).toHaveCount(0);
        await page.locator('#research-offline-menu [data-do="create"]').click();
        const f = page.locator('#direction-form-modal');
        await expect(f).toBeVisible();
        await expect(f.locator('.direction-form__who-name')).toHaveText('Alois Fíšek');
        await expect(f.locator('.direction-form__kind[aria-checked="true"]')).toHaveText('↓Descendants');
        await f.locator('#direction-form-submit').click();
        await expect.poll(() => b.writes.filter(w => w.path === 'directions').map(w => w.body))
            .toEqual([expect.objectContaining({ person: 'P0031', direction: 'descendants', branch: 'B-P0031' })]);
    });

    test('a refused choice is said at the branch, nothing changes', async ({ page }) => {
        const b = await follow(page);
        await openOverview(page);
        await outToggle(page).click();
        await branchRow(page, 'B-P0031').locator('.research-offline__expand').click();
        b.replies.push({ status: 404, body: { error: 'offline.none' } } satisfies BridgeReply);
        await branchRow(page, 'B-P0031').locator('[data-mode="normal"]').click();
        const box = branchRow(page, 'B-P0031').locator('.research-direction__problem');
        await expect(box).toHaveText('The branch is gone: its tasks are done or in a direction already.');
        await expect(box).toHaveAttribute('role', 'alert');
        await expect(branchRow(page, 'B-P0031').locator('.research-offline__tag')).toHaveText('now and then');
        await expect(toast(page)).toHaveCount(0);
    });

    test('a branch\'s relation by the person\'s sex (neutral without it), the related person\'s name as it is', async ({ page }) => {
        const branches = [
            { ...BRANCHES[0] },
            { id: 'B-P0050', person: 'P0050', via: { person: 'P0012', rel: 'sibling' }, nearest: 'G0001', tasks: 2, persons: 1, samples: [], mode: 'occasional', own: false },
            { id: 'B-P0099', person: 'P0099', via: { person: 'P0012', rel: 'child' }, nearest: 'G0001', tasks: 1, persons: 1, samples: [], mode: 'occasional', own: false },
            { id: 'B-P0045', person: 'P0045', via: { person: 'P0050', rel: 'partner' }, nearest: 'G0002', tasks: 3, persons: 1, samples: [], mode: 'occasional', own: false },
        ];
        await followManaged(page, { caps: OFF_CAPS, features: FEATURES, offLine: { ...OFF_LINE, branches }, queue: QUEUE, ged: GED_OFFLINE });
        await openOverview(page);
        await outToggle(page).click();
        const via = (id: string) => branchRow(page, id).locator('.research-offline__meta > span').first();
        await expect(via('B-P0031')).toHaveText('brother of Jan Fíšek');
        await expect(via('B-P0050')).toHaveText('sister of Jan Fíšek');
        await expect(via('B-P0099')).toHaveText('child of Jan Fíšek');
        await expect(via('B-P0045')).toHaveText('husband of Marie Fíšková');
        await page.evaluate(() => window.Strom.UI.setLanguage('cs' as never));
        await expect(via('B-P0031')).toHaveText('bratr: Jan Fíšek');
        await expect(via('B-P0050')).toHaveText('sestra: Jan Fíšek');
        await expect(via('B-P0099')).toHaveText('dítě: Jan Fíšek');
        await expect(via('B-P0045')).toHaveText('manžel: Marie Fíšková');
    });

    test('the queue: each task\'s reason in one line, its own place from ⋯, a branch\'s tasks behind a chip', async ({ page }) => {
        const b = await follow(page);
        await openOverview(page);
        const queue = overview(page).locator('.live-queue');
        const why = queue.locator('.live-queue-why');
        await expect(why).toHaveText([
            'in the direction Předci: Jan Fíšek',
            'outside the directions · now and then · branch Alois Fíšek',
            'helps the direction Potomci: Josef Fíšek · a question of the direction',
            'outside the directions · now and then · branch Alois Fíšek',
            'outside the directions · as usual · branch Bohumil Svoboda',
        ]);
        await expect(why.first()).toHaveAttribute('title', 'in the direction Předci: Jan Fíšek');
        expect(await why.first().evaluate(e => getComputedStyle(e).whiteSpace)).toBe('nowrap');

        // The overview's queue is folded at first.
        await overview(page).locator('.live-queue-toggle').click();
        // Do next: no mark, above the research's Park / Drop.
        await queue.locator('.live-queue-more[data-task="T0420"]').click();
        const menu = page.locator('#live-task-menu');
        await expect(menu.locator('[data-order]')).toHaveText(['Do nextComes up next', 'To the endAfter everything else in the queue']);
        await expect(menu.locator('[data-order] .research-open-mark')).toHaveCount(0);
        await expect(menu.locator('.context-menu-divider')).toHaveCount(1);
        await menu.locator('[data-order="next"]').click();
        await expect.poll(() => offWrites(b).map(w => [w.path, w.body])).toEqual([['queue/T0420', { do: 'next' }]]);
        await expect(toast(page)).toContainText('Saved');
        await expect(queue.locator('.live-queue-row', { hasText: 'Úmrtí Bohumila Svobody' }).locator('.live-queue-why')).toHaveText('set by hand: next');
        // Set by hand: Reset to default too.
        await queue.locator('.live-queue-more[data-task="T0420"]').click();
        await expect(menu.locator('[data-order]')).toHaveCount(3);
        await menu.locator('[data-order="default"]').click();
        await expect.poll(() => offWrites(b).length).toBe(2);
        expect(offWrites(b)[1]).toMatchObject({ path: 'queue/T0420', body: { do: 'default' } });

        // The agent at work on it: said at the task.
        b.replies.push({ status: 409, body: { error: 'queue.doing' } });
        await queue.locator('.live-queue-more[data-task="T0101"]').click();
        await menu.locator('[data-order="last"]').click();
        await expect(queue.locator('.live-queue-problem')).toHaveText('The agent is working on this task now; its place cannot change.');

        // Branch tasks ›: the queue narrowed to the branch, a chip; × shows all again.
        await outToggle(page).click();
        await branchRow(page, 'B-P0031').locator('.research-offline__expand').click();
        await branchRow(page, 'B-P0031').locator('[data-do="tasks"]').click();
        const chip = overview(page).locator('.research-offline__chip');
        await expect(chip).toHaveText('Branch Alois Fíšek 2 ×');
        await expect(chip).toBeFocused();
        await expect(queue.locator('.live-queue-text')).toHaveText([/^Sňatek Aloise Fíška/, /^Křest Terezie Fíškové/]);
        await chip.click();
        await expect(chip).toHaveCount(0);
        await expect(queue.locator('.live-queue-row:not(.live-queue-row--more)')).toHaveCount(5);
    });

    test('a growing branch in Awaiting action: the section open, its answers through the bridge, gone at once, Undo', async ({ page }) => {
        const b = await follow(page, { waiting: [GROWING] });
        await openOverview(page);
        // A growing branch waits: the section is open.
        await expect(outToggle(page)).toHaveAttribute('aria-expanded', 'true');
        const item = overview(page).locator('.research-overview__waiting-item[data-id="W-B-P0031"]');
        await expect(item).toHaveClass(/is-fresh/);
        await expect(item.locator('.live-kind--decide')).toHaveText('suggestion');
        await expect(item.locator('.research-overview__waiting-what'))
            .toHaveText('suggestionBranch Alois Fíšek: 14 tasks outside the directions (6 new people). Near the direction Předci: Jan Fíšek.');
        await item.locator('.research-overview__waiting-row').click();
        const acts = item.locator('.research-offline__wait-actions button');
        await expect(acts).toHaveText(['Add to the direction Předci: Jan Fíšek', 'Create direction', 'Leave as it is', 'Do not research']);
        await expect(acts.first()).toHaveClass(/is-primary/);
        await expect(item.locator('.research-offline__wait-hint')).toHaveText('Without an answer the branch is still taken now and then.');
        await expect(item.locator('.research-open-mark')).toHaveCount(0);
        await item.locator('[data-do="line"]').click();
        await expect.poll(() => offWrites(b).map(w => [w.path, w.body])).toEqual([['waiting/W-B-P0031', { do: 'line', line: 'G0001' }]]);
        await expect(item).toHaveCount(0);
        await expect(toast(page)).toContainText('Added to the direction');
        await expect(branchRow(page, 'B-P0031')).toHaveCount(0);
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => offWrites(b).length).toBe(2);
        expect(offWrites(b)[1]).toMatchObject({ path: 'offline/B-P0031', body: { mode: 'default' } });
    });

    test('a growing branch near a paused direction: the nearest running one its person is in, the sentence says paused', async ({ page }) => {
        // Anna Svobodová is in the paused G0004 and in the running G0001 (her son's ancestors).
        const b = await follow(page, { waiting: [GROWING_PAUSED], people: { P0002: ['G0001'] } });
        await openOverview(page);
        const item = overview(page).locator('.research-overview__waiting-item[data-id="W-B-P0040"]');
        await expect(item.locator('.research-overview__waiting-what'))
            .toHaveText('suggestionBranch Bohumil Svoboda: 7 tasks outside the directions (3 new people). Near the direction Předci: Anna Svobodová (paused).');
        await item.locator('.research-overview__waiting-row').click();
        const acts = item.locator('.research-offline__wait-actions button');
        await expect(acts.first()).toHaveText('Add to the direction Předci: Jan Fíšek');
        await expect(acts.first()).toHaveClass(/is-primary/);
        await item.locator('[data-do="line"]').click();
        await expect.poll(() => offWrites(b).map(w => [w.path, w.body])).toEqual([['waiting/W-B-P0040', { do: 'line', line: 'G0001' }]]);
    });

    test('a growing branch whose person is in no running direction: the paused one, said so', async ({ page }) => {
        const b = await follow(page, { waiting: [GROWING_PAUSED] });
        await openOverview(page);
        const item = overview(page).locator('.research-overview__waiting-item[data-id="W-B-P0040"]');
        await item.locator('.research-overview__waiting-row').click();
        const acts = item.locator('.research-offline__wait-actions button');
        await expect(acts).toHaveText(['Add to the direction Předci: Anna Svobodová (paused)', 'Create direction', 'Leave as it is', 'Do not research']);
        await acts.first().click();
        await expect.poll(() => offWrites(b).map(w => [w.path, w.body])).toEqual([['waiting/W-B-P0040', { do: 'line', line: 'G0004' }]]);
    });

    test('a narrow window with the bridge acts as a computer: 44 px, the segment across, no sideways scroll', async ({ page }) => {
        const b = await follow(page, { size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(overview(page)).toHaveClass(/research-overview--sheet/);
        await outToggle(page).click();
        const alois = branchRow(page, 'B-P0031');
        await alois.locator('.research-offline__expand').click();
        // Every status redraws the overview: measure what is there.
        const height = (sel: string) => expect.poll(async () => (await alois.locator(sel).first().boundingBox())?.height ?? 0);
        await height('.research-offline__seg').toBeGreaterThanOrEqual(44);
        await height('.research-offline__more').toBeGreaterThanOrEqual(44);
        await expect.poll(async () => {
            const row = await alois.boundingBox();
            const seg = await alois.locator('.research-offline__segment').boundingBox();
            return row && seg ? seg.width / row.width : 0;
        }).toBeGreaterThan(0.7);
        expect(await overview(page).evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await alois.locator('[data-mode="normal"]').click();
        await expect.poll(() => offWrites(b).map(w => [w.path, w.body])).toEqual([['offline/B-P0031', { mode: 'normal' }]]);
    });

    test('an older research (no branches): today\'s row outside the directions, today\'s note of a task, the research\'s ⋯', async ({ page }) => {
        await followManaged(page, {
            caps: CAPS, ged: GED_OFFLINE,
            researches: MANAGED_DIRECTIONS,
            working: [{ who: 'agent-mimo', since: ago(5), task: 'Sňatek Aloise Fíška, Vídeň 1894', person: 'P0031' }],
            queue: [{ id: 'T0412', text: 'Sňatek Aloise Fíška, Vídeň 1894', state: 'next', offLine: 'last' }],
            features: ['tasks.offLine'],
        });
        await openOverview(page);
        await expect(section(page).locator('.research-offline__head')).toHaveCount(0);
        await expect(section(page).locator('.research-direction--outside')).toHaveText(/Outside the directions.*Sňatek Aloise Fíška, Vídeň 1894/);
        const queue = overview(page).locator('.live-queue');
        await expect(queue.locator('.live-queue-why')).toHaveCount(0);
        await expect(queue.locator('.live-queue-note')).toHaveCount(1);
        await overview(page).locator('.live-queue-toggle').click();
        await queue.locator('.live-queue-more').first().click();
        await expect(page.locator('#live-task-menu [data-order]')).toHaveCount(0);
        await expect(page.locator('#live-task-menu [data-action]')).toHaveCount(2);
    });
});

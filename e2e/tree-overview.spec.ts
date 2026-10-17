/**
 * Tree overview (spec 005): header numbers, "Where to focus", Ancestors with
 * the four grandparent lines, Life and health, Family through time, Data
 * quality, Highlights, the person choice and its memory, the remembered
 * expansion, the highlight with "Back to overview", a tree that is not open,
 * the entry points (tree actions, the tree manager and back), Czech and
 * German texts, the phone sheet, an empty tree and the opening time of a
 * 5 000-person tree. Invented names only. The statistics on the sample tree
 * are in stats.spec.ts.
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers';
import { syntheticTree } from '../src/__tests__/helpers/synthetic-tree';

type P = Record<string, unknown>;

/**
 *        Fff
 *         |
 *   Ff ⚭ Fm        Mf
 *      |            |
 *      F     ⚭      M
 *            |
 *            R  (+ sister S)
 *
 * Fm died before she was born and before her son (two validation errors).
 * Every direct ancestor's birth is recorded, only Erik's (F) is cited.
 */
function family(): { persons: Record<string, P>; partnerships: Record<string, P>; defaultPersonId: string } {
    const persons: Record<string, P> = {};
    const add = (id: string, firstName: string, gender: 'male' | 'female', extra: P = {}): void => {
        persons[id] = {
            id, firstName, lastName: 'Lindqvist', gender, isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...extra,
        };
    };
    add('fff', 'Gustav', 'male', { birthDate: '1850' });
    add('ff', 'Oskar', 'male', { birthDate: '1880' });
    add('fm', 'Elin', 'female', { birthDate: '1885', deathDate: '1870' });
    add('mf', 'Nils', 'male', { birthDate: '1890' });
    add('f', 'Erik', 'male', { birthDate: '1920', birthSourceIds: ['s1'] });
    add('m', 'Karin', 'female', { birthDate: '1925' });
    add('r', 'Anders', 'male', { birthDate: '1955' });
    add('s', 'Greta', 'female', { birthDate: '1958' });
    const partnerships: Record<string, P> = {};
    const union = (uid: string, a: string, b: string | null, children: string[]): void => {
        if (b) {
            partnerships[uid] = { id: uid, person1Id: a, person2Id: b, childIds: children, status: 'married' };
            (persons[a].partnerships as string[]).push(uid);
            (persons[b].partnerships as string[]).push(uid);
        }
        for (const c of children) {
            for (const p of [a, b].filter((x): x is string => !!x)) {
                (persons[c].parentIds as string[]).push(p);
                (persons[p].childIds as string[]).push(c);
            }
        }
    };
    union('u1', 'fff', null, ['ff']);
    union('u2', 'ff', 'fm', ['f']);
    union('u3', 'mf', null, ['m']);
    union('u4', 'f', 'm', ['r', 's']);
    return { persons, partnerships, defaultPersonId: 'r' };
}

/** Import a tree (it becomes the open one) with a person in focus; returns its id. */
async function importTree(page: Page, data: { persons: Record<string, P>; partnerships: Record<string, P>; defaultPersonId?: string }, name: string, focus?: string): Promise<string> {
    return page.evaluate(async ({ data, name, focus }) => {
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree({ ...data, sources: { s1: { id: 's1', title: 'Parish register' } } }, name);
        S.UI.updateTreeSwitcher?.();
        if (focus) S.TreeRenderer.setFocus(focus);
        await S.TreeRenderer.renderAsync();
        return id as string;
    }, { data, name, focus });
}

async function openOverview(page: Page, treeId: string, opts?: Record<string, unknown>): Promise<Locator> {
    await page.evaluate(({ treeId, opts }) => window.Strom.UI.showTreeOverview(treeId, opts), { treeId, opts });
    const dialog = page.locator('#tree-overview-modal .modal.tov');
    await expect(dialog).toBeVisible();
    return dialog;
}

const section = (dialog: Locator, id: string): Locator => dialog.locator(`.tov-sec[data-section="${id}"]`);

async function setup(page: Page, width = 1440, height = 900): Promise<string> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    return importTree(page, family(), 'Lindqvist', 'r');
}

test.describe('tree overview', () => {
    test('header numbers, focus cards and the ancestors table @smoke', async ({ page }) => {
        const treeId = await setup(page);
        const dialog = await openOverview(page, treeId);
        await expect(dialog.locator('.tov-title')).toHaveText('Tree overview: Lindqvist');
        // 8 people, births 1850–1958, one of them (Erik) with a source.
        await expect(dialog.locator('.tov-nums')).toContainText('8 people');
        await expect(dialog.locator('.tov-nums')).toContainText('1850–1958');
        await expect(dialog.locator('.tov-nums')).toContainText('13% with a source');
        await expect(dialog.locator('.tov-root-btn')).toHaveText(/Anders Lindqvist/);

        // Where to focus: the error first, then the nearest short generation, then births without a source.
        const focus = section(dialog, 'focus');
        await expect(focus.locator('.tov-sec-head')).toHaveAttribute('aria-expanded', 'true');
        const cards = focus.locator('.tov-card');
        await expect(cards).toHaveCount(3);
        await expect(cards.nth(0)).toHaveClass(/tov-card--error/);
        await expect(cards.nth(0)).toContainText('2 errors in the data (e.g. death date is before birth date).');
        await expect(cards.nth(1)).toContainText('Great-grandparents: 1 of 8 known.');
        await expect(cards.nth(2)).toContainText('5 direct ancestors have no documented birth.');
        await expect(focus.locator('.tov-sum')).toHaveText('3 steps');

        // Ancestors: three generations, the counts and the lines.
        const anc = section(dialog, 'ancestors');
        await expect(anc.locator('.tov-sum')).toHaveText('6 ancestors · furthest generation 3');
        const rows = anc.locator('.tov-anc-row:not(.tov-anc-legend)');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText('parents');
        await expect(rows.nth(0).locator('.tov-anc-ratio')).toHaveText('2 / 2');
        await expect(rows.nth(0).locator('.tov-anc-pct')).toHaveText('100%');
        await expect(rows.nth(0).locator('.tov-anc-doc')).toContainText('1');
        await expect(rows.nth(1).locator('.tov-anc-ratio')).toHaveText('3 / 4');
        await expect(rows.nth(2).locator('.tov-anc-pct')).toHaveText('13%');
        await expect(anc.locator('.tov-line[data-slot="FF"]')).toContainText('3 generations');
        await expect(anc.locator('.tov-line[data-slot="FF"]')).toContainText('Gustav Lindqvist, b. 1850');
        await expect(anc.locator('.tov-line[data-slot="FF"]')).toContainText('via Oskar Lindqvist (* 1880)');
        await expect(anc.locator('.tov-line[data-slot="MM"]')).toContainText('unknown');
        await expect(anc.getByRole('button', { name: 'Line ends (3)' })).toBeVisible();
    });

    test('Fix opens the validation details and Escape comes back to the overview', async ({ page }) => {
        const treeId = await setup(page);
        const dialog = await openOverview(page, treeId);
        await section(dialog, 'focus').getByRole('button', { name: 'Fix' }).click();
        await expect(page.locator('#tree-validation-modal')).toBeVisible();
        await expect(dialog).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-validation-modal')).toBeHidden();
        await expect(dialog).toBeVisible();
    });

    test('line ends highlight with Next person and Back to overview at the same place', async ({ page }) => {
        const treeId = await setup(page, 1440, 600);
        const dialog = await openOverview(page, treeId);
        const scroller = dialog.locator('.tov-scroll');
        await scroller.evaluate(el => { el.scrollTop = 120; });
        const before = await scroller.evaluate(el => el.scrollTop);
        await section(dialog, 'ancestors').getByRole('button', { name: 'Line ends (3)' }).click();
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        const pill = page.locator('#evidence-pill');
        await expect(pill).toContainText('Line ends: 3 people');
        await expect(pill.locator('.evidence-pill-cite')).toHaveCount(0);
        await expect(page.locator('.person-card.evidence-hit')).toHaveCount(3);
        await pill.getByRole('button', { name: 'Next person ›' }).click();
        await expect(pill).toContainText('1 / 3');
        await pill.getByRole('button', { name: 'Back to overview' }).click();
        await expect(pill).toHaveCount(0);
        const again = page.locator('#tree-overview-modal .modal.tov');
        await expect(again).toBeVisible();
        await expect.poll(async () => Math.abs(await again.locator('.tov-scroll').evaluate(el => el.scrollTop) - before)).toBeLessThanOrEqual(1);
    });

    test('the gap card highlights where the missing ancestors would attach, births offer Cite', async ({ page }) => {
        const treeId = await setup(page);
        let dialog = await openOverview(page, treeId);
        await section(dialog, 'focus').locator('.tov-card[data-card="ancestorGap"]').getByRole('button', { name: 'Show in tree' }).click();
        const pill = page.locator('#evidence-pill');
        await expect(pill).toContainText('Great-grandparents: 7 missing');
        // Oskar (one parent), Elin and Nils (none).
        await expect(page.locator('.person-card.evidence-hit')).toHaveCount(3);
        await pill.locator('.evidence-pill-close').click();
        dialog = await openOverview(page, treeId);
        await section(dialog, 'focus').locator('.tov-card[data-card="birthNoSource"]').getByRole('button', { name: 'Show in tree' }).click();
        await expect(pill).toContainText('Births without a source: 5 people');
        await pill.getByRole('button', { name: 'Next person ›' }).click();
        await expect(pill.getByRole('button', { name: 'Cite' })).toBeVisible();
    });

    test('the chosen person is remembered per tree and offered in the popover', async ({ page }) => {
        const treeId = await setup(page);
        let dialog = await openOverview(page, treeId);
        await dialog.locator('.tov-root-btn').click();
        const pop = page.locator('.tov-pop');
        await expect(pop).toBeVisible();
        await expect(pop.locator('.tov-pop-row').first()).toContainText('Anders Lindqvist');
        await expect(pop.locator('.tov-pop-row').first()).toContainText('b. 1955'.replace('b. ', '* ') + ' · person in focus');
        await pop.locator('.tov-pop-search').fill('Erik');
        await pop.locator('.tov-pop-row', { hasText: 'Erik Lindqvist' }).click();
        await expect(pop).toHaveCount(0);
        await expect(dialog.locator('.tov-root-btn')).toHaveText(/Erik Lindqvist/);
        await expect(section(dialog, 'ancestors').locator('.tov-sum')).toHaveText('3 ancestors · furthest generation 2');
        // Escape closes the popover first, then the overview.
        await dialog.locator('.tov-root-btn').click();
        await expect(pop).toBeVisible();
        await expect(pop.locator('.tov-pop-row').nth(1)).toContainText('recently chosen');
        await page.keyboard.press('Escape');
        await expect(pop).toHaveCount(0);
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);

        dialog = await openOverview(page, treeId);
        await expect(dialog.locator('.tov-root-btn')).toHaveText(/Erik Lindqvist/);
        expect(await page.evaluate((id) => localStorage.getItem(`overview.root.${id}`), treeId)).toBe('f');
    });

    test('expanded sections are remembered on the device', async ({ page }) => {
        const treeId = await setup(page);
        let dialog = await openOverview(page, treeId);
        const head = section(dialog, 'ancestors').locator('.tov-sec-head');
        await head.click();
        await expect(head).toHaveAttribute('aria-expanded', 'false');
        await expect(section(dialog, 'ancestors').locator('.tov-sec-body')).toBeHidden();
        // The summary stays.
        await expect(section(dialog, 'ancestors').locator('.tov-sum')).toHaveText('6 ancestors · furthest generation 3');
        await dialog.locator('.tov-foot').getByRole('button', { name: 'Close' }).click();
        dialog = await openOverview(page, treeId);
        await expect(section(dialog, 'ancestors').locator('.tov-sec-head')).toHaveAttribute('aria-expanded', 'false');
        await expect(section(dialog, 'focus').locator('.tov-sec-head')).toHaveAttribute('aria-expanded', 'true');
        await section(dialog, 'ancestors').locator('.tov-sec-head').click();
        await expect(section(dialog, 'ancestors').locator('.tov-anc-row').first()).toBeVisible();
        expect(JSON.parse(await page.evaluate(() => localStorage.getItem('overview.open') ?? '[]')).sort()).toEqual(['ancestors', 'focus']);
    });

    test('Data quality: consistency, completeness, missing evidence, structure and quick actions', async ({ page }) => {
        const treeId = await setup(page);
        const dialog = await openOverview(page, treeId, { section: 'quality', scroll: true });
        const quality = section(dialog, 'quality');
        await expect(quality).toHaveAttribute('data-ready', 'true');
        await expect(quality.locator('.tov-mark')).toHaveCount(0);
        await expect(quality.locator('.tov-sum .tov-sum-err')).toHaveText('2 errors');
        // Consistency: the counts, the most serious findings first, names lead to the person.
        await expect(quality.locator('.tov-count-err')).toHaveText('2 errors');
        await expect(quality.locator('.tov-finding').first()).toHaveClass(/tov-finding--error/);
        await expect(quality.locator('.tov-finding').first().locator('.tov-link').first()).toHaveText('Elin Lindqvist');
        // Completeness: every birth date, no birthplace (low), one source of eight.
        await expect(quality.locator('.tov-comp-row[data-field="birthDate"] .tov-comp-pct')).toHaveText('100%');
        await expect(quality.locator('.tov-comp-row[data-field="birthPlace"] .tov-comp-fill')).toHaveClass(/is-low/);
        await expect(quality.locator('.tov-comp-row[data-field="source"] .tov-comp-pct')).toHaveText('13%');
        await expect(quality.locator('.tov-comp-row[data-field="deathDate"]')).toHaveAttribute('title', 'counted among the deceased');
        // Where evidence is missing, from the person in focus.
        const evidence = quality.locator('[data-block="evidence"]');
        await expect(evidence.locator('.tov-ev-row[data-evidence="noSource"] .tov-ev-count')).toHaveText('7 of 8');
        await expect(evidence.locator('.tov-ev-row[data-evidence="lineEnds"] .tov-ev-count')).toHaveText('3');
        // Structure: one family; the quick actions (nothing to clean up: disabled).
        await expect(quality.locator('[data-block="structure"] .tov-struct-line')).toHaveText('4 unions. All people are connected into one family.');
        await expect(quality.locator('[data-block="actions"] .tov-btn')).toHaveText(
            ['Validation details', 'Clean up orphaned places (0)', 'Split into families']);
        await expect(quality.getByRole('button', { name: 'Clean up orphaned places (0)' })).toBeDisabled();
        // People without a source: the highlight with Cite.
        await evidence.locator('[data-kind="noSource"]').click();
        const pill = page.locator('#evidence-pill');
        await expect(pill).toContainText('People without a source: 7 people');
        await pill.getByRole('button', { name: 'Next person ›' }).click();
        await expect(pill.getByRole('button', { name: 'Cite' })).toBeVisible();
        await pill.getByRole('button', { name: 'Back to overview' }).click();
        await expect(section(page.locator('#tree-overview-modal'), 'quality').locator('.tov-sec-head')).toHaveAttribute('aria-expanded', 'true');
    });

    test('Data quality: unconnected parts, Separate returns to the overview', async ({ page }) => {
        const data = family();
        data.persons.x = { id: 'x', firstName: 'Ida', lastName: 'Berg', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        const treeId = await importTree(page, data, 'Lindqvist', 'r');
        const dialog = await openOverview(page, treeId, { section: 'quality' });
        const quality = section(dialog, 'quality');
        await expect(quality.locator('.tov-sum')).toContainText('2 unconnected parts');
        const structure = quality.locator('[data-block="structure"]');
        await expect(structure.locator('.tov-struct-line')).toHaveText('4 unions · 2 unconnected parts:');
        await expect(structure.locator('.tov-parts li')).toHaveCount(2);
        await structure.getByRole('button', { name: 'Separate unconnected parts' }).click();
        await expect(page.locator('#split-modal')).toBeVisible();
        await expect(dialog).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
    });

    test('Life, Family through time and Highlights on a small tree: not enough data, the rest shown', async ({ page }) => {
        const treeId = await setup(page);
        const dialog = await openOverview(page, treeId);
        // Computed on idle callbacks while closed.
        for (const id of ['life', 'time', 'quality', 'highlights']) {
            await expect(section(dialog, id)).toHaveAttribute('data-ready', 'true');
        }
        await expect(section(dialog, 'life').locator('.tov-sum')).toHaveText('');
        await expect(section(dialog, 'time').locator('.tov-sum')).toHaveText('5 men, 3 women');
        await section(dialog, 'life').locator('.tov-sec-head').click();
        await expect(section(dialog, 'life').locator('.tov-muted')).toHaveText(/^Not enough data yet: age at death is known for \d+ (person|people)\.$/);
        await expect(section(dialog, 'life').locator('.tov-tile')).toHaveCount(0);

        const time = section(dialog, 'time');
        await time.locator('.tov-sec-head').click();
        await expect(time.locator('.tov-mark')).toHaveCount(1);
        await expect(time.locator('.tov-split[data-split="sex"] .tov-split-counts')).toHaveText('5 men · 3 women');
        await expect(time.locator('[data-chart="children"] .tov-muted')).toHaveText(/^Not enough data yet: the number of children is known for \d+ couples?\.$/);
        await expect(time.locator('[data-chart="months"] .tov-muted')).toHaveText('Not enough data yet: the birth month is known for 0 people.');

        const hl = section(dialog, 'highlights');
        await hl.locator('.tov-sec-head').click();
        await expect(hl.locator('.tov-tile[data-tile="children"] .tov-tile-value')).toHaveText('2 children');
        // Five children in four unions (single parents included).
        await expect(hl.locator('.tov-tile[data-tile="average"] .tov-tile-value')).toHaveText('1.3');
        await expect(hl.locator('[data-block="anniversaries"] .tov-muted')).toHaveText('No anniversaries in the next 30 days.');
        await expect(hl.locator('.tov-sum')).toHaveText('');
    });

    test('Family through time follows the chosen person; without one it asks for a person', async ({ page }) => {
        const treeId = await setup(page);
        await page.evaluate((id) => localStorage.setItem(`overview.root.${id}`, 'gone'), treeId);
        await page.evaluate(() => { (window.Strom.TreeRenderer as unknown as { focusPersonId: null }).focusPersonId = null; });
        const dialog = await openOverview(page, treeId, { section: 'time' });
        const time = section(dialog, 'time');
        await expect(time.locator('.tov-need')).toContainText('Generations are calculated from a selected person.');
        await time.getByRole('button', { name: 'Choose person' }).click();
        await page.locator('.tov-pop .tov-pop-search').fill('Erik');
        await page.locator('.tov-pop-row', { hasText: 'Erik' }).click();
        await expect(time.locator('.tov-need')).toHaveCount(0);
        await expect(time.locator('[data-chart="children"]')).toContainText('Not enough data yet');
    });

    test('entry points: the tree actions, the tree manager and back to it', async ({ page }) => {
        const treeId = await setup(page);
        // ⋯ → Tree: the Overview group is the overview and (when offered) the change history.
        await page.locator('.actions-menu-btn').click();
        await page.locator('#actions-tree-row').hover();
        const rows = page.locator('#actions-tree-overview-rows .tree-switcher-action');
        await expect(rows).toHaveText(['Tree overview']);
        await page.keyboard.press('Escape');

        // The tree manager's ⋯ → Tree overview: the manager steps aside and comes back on Escape.
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const manager = page.locator('#tree-manager-modal');
        const row = page.locator('.tree-manager-item.active');
        await row.locator('.tree-row-menu-btn').click();
        await row.locator('.tree-row-menu.open .tree-row-menu-item[data-action="overview"]').click();
        const dialog = page.locator('#tree-overview-modal .modal.tov');
        await expect(dialog).toBeVisible();
        await expect(manager).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        await expect(manager).toBeVisible();

        // Again with Close; a person link goes to the tree and not back to the manager.
        await row.locator('.tree-row-menu-btn').click();
        await row.locator('.tree-row-menu.open .tree-row-menu-item[data-action="overview"]').click();
        await dialog.locator('.tov-foot').getByRole('button', { name: 'Close' }).click();
        await expect(manager).toBeVisible();
        await row.locator('.tree-row-menu-btn').click();
        await row.locator('.tree-row-menu.open .tree-row-menu-item[data-action="overview"]').click();
        await section(dialog, 'ancestors').locator('.tov-line[data-slot="FF"] .tov-link').first().click();
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);
        await expect(manager).toBeHidden();
        expect(treeId).toBeTruthy();
    });

    test('Czech and German texts', async ({ page }) => {
        const treeId = await setup(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('cs' as never));
        let dialog = await openOverview(page, treeId);
        await expect(dialog.locator('.tov-title')).toHaveText('Přehled stromu: Lindqvist');
        await expect(dialog.locator('.tov-sec-title')).toHaveText(['Na co se zaměřit', 'Předci', 'Život a zdraví', 'Rod v čase', 'Kvalita dat', 'Zajímavosti']);
        await expect(section(dialog, 'quality').locator('.tov-sum .tov-sum-err')).toHaveText('2 chyby');
        await section(dialog, 'quality').locator('.tov-sec-head').click();
        await expect(section(dialog, 'quality').locator('[data-block="structure"] .tov-struct-line')).toHaveText('4 svazky. Všechny osoby jsou propojeny do jedné rodiny.');
        await page.keyboard.press('Escape');
        await expect(page.locator('#toolbar-focus-count:visible, #focus-person-count:visible').first()).toHaveAttribute('title', 'Zobrazit přehled stromu');

        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        dialog = await openOverview(page, treeId);
        await expect(dialog.locator('.tov-title')).toHaveText('Stammbaum-Überblick: Lindqvist');
        await expect(section(dialog, 'quality').locator('.tov-sum .tov-sum-err')).toHaveText('2 Fehler');
        await expect(section(dialog, 'quality').locator('[data-block="structure"] .tov-struct-line')).toHaveText('4 Verbindungen. Alle Personen sind zu einer Familie verbunden.');
        await expect(section(dialog, 'time').locator('.tov-split[data-split="sex"] .tov-split-label')).toHaveText('Männer / Frauen');
    });

    test('a tree that is not open is read only', async ({ page }) => {
        const treeId = await setup(page);
        // Another tree becomes the open one.
        await importTree(page, { persons: { x: { id: 'x', firstName: 'Ida', lastName: 'Berg', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } }, partnerships: {} }, 'Berg', 'x');
        const dialog = await openOverview(page, treeId);
        await expect(dialog.locator('.tov-inactive')).toContainText('This tree is not open – read only.');
        // The person that tree starts with.
        await expect(dialog.locator('.tov-root-btn')).toHaveText(/Anders Lindqvist/);
        const fix = section(dialog, 'focus').getByRole('button', { name: 'Fix' });
        await expect(fix).toHaveAttribute('aria-disabled', 'true');
        await expect(fix).toHaveAttribute('title', 'This tree is not open. Only an open tree can be changed.');
        // aria-disabled keeps it focusable and clickable: the click explains instead of acting.
        await fix.click({ force: true });
        await expect(page.locator('#tree-validation-modal')).toBeHidden();
        await expect(section(dialog, 'focus').locator('.tov-disabled-hint')).toBeVisible();
        await expect(section(dialog, 'focus').getByRole('button', { name: 'Open tree and show' })).toHaveCount(2);
        await expect(section(dialog, 'ancestors')).toContainText('Line ends: 3 people');
        // Open tree and show: the tree opens, the highlight starts.
        await section(dialog, 'ancestors').getByRole('button', { name: 'Open tree and show' }).click();
        await expect(page.locator('#evidence-pill')).toContainText('Line ends: 3 people');
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(treeId);
    });

    test('Open tree in the banner switches and keeps the overview', async ({ page }) => {
        const treeId = await setup(page);
        await importTree(page, { persons: { x: { id: 'x', firstName: 'Ida', lastName: 'Berg', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } }, partnerships: {} }, 'Berg', 'x');
        const dialog = await openOverview(page, treeId);
        await dialog.getByRole('button', { name: 'Open tree', exact: true }).click();
        const again = page.locator('#tree-overview-modal .modal.tov');
        await expect(again.locator('.tov-inactive')).toHaveCount(0);
        await expect(section(again, 'focus').getByRole('button', { name: 'Fix' })).not.toHaveAttribute('aria-disabled', 'true');
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).toBe(treeId);
    });

    test('a new small tree: good shape, no parents, choose another person', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        const treeId = await importTree(page, { persons: {
            a: { id: 'a', firstName: 'Ida', lastName: 'Berg', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] },
        }, partnerships: {} }, 'Berg', 'a');
        const dialog = await openOverview(page, treeId);
        await expect(section(dialog, 'focus').locator('.tov-good')).toHaveText('The tree is in good shape.');
        await expect(section(dialog, 'focus').locator('.tov-sum')).toHaveText('in good shape');
        await expect(section(dialog, 'ancestors')).toContainText('Ida Berg has no parents in the tree.');
        await expect(section(dialog, 'ancestors').locator('.tov-sum')).toHaveText('parents not in the tree');
        await section(dialog, 'ancestors').getByRole('button', { name: 'Choose another person' }).click();
        await expect(page.locator('.tov-pop')).toBeVisible();
    });

    test('without a chosen person the ancestors ask for one', async ({ page }) => {
        const treeId = await setup(page);
        await page.evaluate((id) => localStorage.setItem(`overview.root.${id}`, 'gone'), treeId);
        // A view without a person in focus (the renderer keeps it private).
        await page.evaluate(() => { (window.Strom.TreeRenderer as unknown as { focusPersonId: null }).focusPersonId = null; });
        const dialog = await openOverview(page, treeId);
        await expect(dialog.locator('.tov-root-btn')).toHaveText(/not selected/);
        await expect(section(dialog, 'ancestors')).toContainText('Ancestors are calculated from a selected person.');
        // Only the card that does not need a person.
        await expect(section(dialog, 'focus').locator('.tov-card')).toHaveCount(1);
        await section(dialog, 'ancestors').getByRole('button', { name: 'Choose person' }).click();
        await page.locator('.tov-pop .tov-pop-search').fill('Anders');
        await page.locator('.tov-pop-row', { hasText: 'Anders' }).click();
        await expect(section(dialog, 'focus').locator('.tov-card')).toHaveCount(3);
    });

    test('a tree without people shows one sentence', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        const treeId = await importTree(page, { persons: {}, partnerships: {} }, 'Prázdný');
        const dialog = await openOverview(page, treeId);
        await expect(dialog.locator('.tov-empty')).toHaveText('This tree has no people yet.');
        await expect(dialog.locator('.tov-nums')).toHaveCount(0);
        await expect(dialog.locator('.tov-sec')).toHaveCount(0);
    });

    test('phone: a full-screen sheet without horizontal scroll', async ({ page }) => {
        const treeId = await setup(page, 390, 844);
        const dialog = await openOverview(page, treeId);
        const box = await dialog.boundingBox();
        expect(box!.width).toBe(390);
        expect(box!.height).toBe(844);
        await expect(dialog.locator('.tov-foot')).toBeHidden();
        const scroller = dialog.locator('.tov-scroll');
        expect(await scroller.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        // The card button sits under the text, full width, 44px.
        const button = section(dialog, 'focus').locator('.tov-card').nth(1).locator('.tov-btn');
        const b = await button.boundingBox();
        expect(b!.height).toBeGreaterThanOrEqual(44);
        expect(b!.width).toBeGreaterThan(300);
        // Title and person choice stay; the numbers scroll away.
        await scroller.evaluate(el => { el.scrollTop = 400; });
        const title = await dialog.locator('.tov-titlebar').boundingBox();
        const root = await dialog.locator('.tov-root').boundingBox();
        expect(Math.round(title!.y)).toBe(0);
        expect(Math.round(root!.y)).toBe(52);
        expect((await dialog.locator('.tov-nums').boundingBox())!.y).toBeLessThan(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('phone landscape: one header row', async ({ page }) => {
        const treeId = await setup(page, 844, 390);
        const dialog = await openOverview(page, treeId);
        const title = await dialog.locator('.tov-title').boundingBox();
        const nums = await dialog.locator('.tov-nums').boundingBox();
        const root = await dialog.locator('.tov-root-btn').boundingBox();
        expect(Math.abs(title!.y + title!.height / 2 - (nums!.y + nums!.height / 2))).toBeLessThan(6);
        expect(Math.abs(root!.y + root!.height / 2 - (nums!.y + nums!.height / 2))).toBeLessThan(6);
        await expect(dialog.locator('.tov-gen-short')).toBeVisible();
        expect(await dialog.locator('.tov-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    });

    test('K1.5: a 5 000-person tree opens within 1 s (best of three)', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        const { data, rootId } = syntheticTree({ persons: 5000, seed: 7 });
        const treeId = await page.evaluate(async ({ data, rootId }) => {
            const S = window.Strom;
            const id = await S.DataManager.importAsNewTree(data, 'Syntetický');
            S.TreeRenderer.setFocus(rootId);
            await S.TreeRenderer.renderAsync();
            return id as string;
        }, { data, rootId });
        const times: number[] = [];
        for (let i = 0; i < 3; i++) {
            const ms = await page.evaluate(async (treeId) => {
                // A fresh revision: nothing cached from the run before.
                window.dispatchEvent(new CustomEvent('strom:data-changed'));
                const t0 = performance.now();
                await window.Strom.UI.showTreeOverview(treeId);
                await new Promise<void>((resolve) => {
                    // The eager sections: the others follow on idle callbacks.
                    const ready = (id: string): boolean =>
                        document.querySelector(`#tree-overview-modal .tov-sec[data-section="${id}"]`)?.getAttribute('data-ready') === 'true';
                    const done = (): boolean => ready('focus') && ready('ancestors');
                    const tick = (): void => { if (done()) resolve(); else requestAnimationFrame(tick); };
                    tick();
                });
                const ms = performance.now() - t0;
                window.Strom.UI.closeTreeOverview();
                return ms;
            }, treeId);
            times.push(ms);
        }
        const best = Math.min(...times);
        console.log(`[tree-overview K1.5] 5000 persons: open ${times.map(t => t.toFixed(0)).join(' / ')} ms, best ${best.toFixed(0)} ms`);
        expect(best).toBeLessThan(1000);
    });
});

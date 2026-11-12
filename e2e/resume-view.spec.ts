import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, card, openTreeActions } from './helpers.js';

/**
 * Which view and person a tree opens with (1101).
 * - A reload of the page keeps the tree, the view and the person, whatever
 *   the settings say.
 * - A start, opening or switching a tree follows the tree's "Default person
 *   and view" dialog: the family view (default) or the view last used with the
 *   tree on this device, always with the tree's default person.
 * - A link to a person opens that person either way.
 * Invented families only.
 */

async function twoTrees(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await seedTree(page, {
        lh_a: { firstName: 'Bořivoj', lastName: 'Lhoták' },
        lh_b: { firstName: 'Božetěch', lastName: 'Lhoták', parents: ['lh_a'] },
    }, 'Lhotákovi');
    await seedTree(page, {
        ho_c: { firstName: 'Zbyňka', lastName: 'Hollerbachová', parents: ['ho_b'], gender: 'female' },
        ho_b: { firstName: 'Kvido', lastName: 'Hollerbach', parents: ['ho_a'] },
        ho_a: { firstName: 'Radomil', lastName: 'Hollerbach' },
    }, 'Hollerbachovi', 'ho_c');
}

/** Fan view of the open tree, its centre re-set to `name` by a tap on the sector. */
async function fanOn(page: Page, name: string): Promise<void> {
    await page.locator('#view-mode-fan').click();
    const fan = page.locator('#fan-container');
    await expect(fan.locator('.fan-svg')).toBeVisible();
    await fan.locator('[data-fan-person]', { hasText: name }).first().click();
    await expect(fan.locator('.fan-focus')).toContainText(name);
}

/**
 * The start is over once the first render ran (html.app-booting gone): the
 * view and the person are chosen before it. .app-loading goes earlier (when
 * the tree is in memory), before the start reads more from the database.
 */
async function started(page: Page): Promise<void> {
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await expect(page.locator('html')).not.toHaveClass(/app-booting/);
}

/** A new start in the same tab (an address opened again, not a reload). */
async function reopen(page: Page, query = ''): Promise<void> {
    await page.goto(`/strom.html${query}`);
    await started(page);
}

async function reloadPage(page: Page): Promise<void> {
    await page.reload();
    await started(page);
}

const treeId = (page: Page, name: string) => page.evaluate(
    (n) => window.Strom.TreeManager.getTrees().find(t => t.name === n)!.id as string, name);

/** The open tree's name, view and focus person, as the renderer has them. */
const shown = (page: Page) => page.evaluate(() => {
    const id = window.Strom.DataManager.getCurrentTreeId();
    return {
        tree: id ? window.Strom.TreeManager.getTreeMetadata(id)?.name ?? null : null,
        view: window.Strom.TreeRenderer.getViewMode(),
        person: window.Strom.TreeRenderer.getFocusPersonId(),
    };
});

const focusedCard = (page: Page) => page.locator('#tree-canvas .person-card.focused .name-text');

/** The tree that opens at a start. */
async function makeStartTree(page: Page, name: string): Promise<void> {
    const id = await treeId(page, name);
    await page.evaluate((i) => window.Strom.TreeManager.setDefaultTree(i as never), id);
}

/** The tree's default person (first / last focused) and view (family / last used), through the API. */
async function setDefaults(page: Page, name: string, person: 'first' | 'last', view: 'family' | 'last'): Promise<void> {
    const id = await treeId(page, name);
    await page.evaluate(async ({ i, person, view }) => {
        const { TreeManager, DataManager } = window.Strom;
        const p = person === 'last' ? '__last_focused__' : undefined;
        const v = view === 'last' ? 'last' as const : undefined;
        await TreeManager.setDefaultPerson(i as never, p as never);
        await TreeManager.setDefaultView(i as never, v);
        if (DataManager.getCurrentTreeId() === i) {
            DataManager.setDefaultPerson(p as never);
            DataManager.setDefaultView(v);
        }
    }, { i: id, person, view });
}

/** The same, through the dialog the tree's menu opens. */
async function setDefaultsInDialog(page: Page, name: string, person: 'first' | 'last', view: 'family' | 'last'): Promise<void> {
    const id = await treeId(page, name);
    await page.evaluate((i) => window.Strom.UI.showDefaultPersonDialog(i), id);
    const modal = page.locator('#default-person-modal');
    await expect(modal).toHaveClass(/active/);
    await expect(modal.locator('h2')).toHaveText('Default person and view');
    await expect(modal).toContainText('When opening this tree, show:');
    // Nothing set yet: the family view.
    await expect(modal.locator('#default-view-family')).toBeChecked();
    await modal.locator(person === 'last' ? '#default-person-last' : '#default-person-first').check();
    await modal.locator(view === 'last' ? '#default-view-last' : '#default-view-family').check();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).not.toHaveClass(/active/);
}

test('a reload keeps the tree, the view and the person in every view, whatever the settings', async ({ page }) => {
    await twoTrees(page);
    // The second tree is open, not the one a start opens.
    expect((await shown(page)).tree).toBe('Hollerbachovi');

    // The family view with a person other than the tree's start person.
    await page.evaluate(() => window.Strom.TreeRenderer.setFocus('ho_b' as never));
    await expect(focusedCard(page)).toContainText('Kvido');
    await reloadPage(page);
    expect(await shown(page)).toEqual({ tree: 'Hollerbachovi', view: 'family', person: 'ho_b' });
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await expect(focusedCard(page)).toContainText('Kvido');

    // The descendants chart, the timeline and the map with that person.
    for (const view of ['descendants', 'timeline', 'map'] as const) {
        await page.locator(`#view-mode-${view}`).click();
        await expect(page.locator(`#view-mode-${view}`)).toHaveClass(/active/);
        await reloadPage(page);
        await expect(page.locator(`#view-mode-${view}`)).toHaveClass(/active/);
        expect(await shown(page)).toEqual({ tree: 'Hollerbachovi', view, person: 'ho_b' });
    }
    await expect(page.locator('#map-container')).toBeVisible();

    // The fan, centred on the grandfather.
    await fanOn(page, 'Radomil');
    await reloadPage(page);
    await expect(page.locator('#view-mode-fan')).toHaveClass(/active/);
    await expect(page.locator('#fan-container .fan-focus')).toContainText('Radomil');
    expect(await shown(page)).toEqual({ tree: 'Hollerbachovi', view: 'fan', person: 'ho_a' });

    // A new start in the same tab is no reload: the start tree, the family view.
    await reopen(page);
    expect(await shown(page)).toMatchObject({ tree: 'Lhotákovi', view: 'family' });
});

test('a start opens the family view with the start tree\'s start person, not the view left on screen', { tag: '@smoke' }, async ({ page }) => {
    await twoTrees(page);
    await fanOn(page, 'Kvido');
    await reopen(page);
    await expect(page.locator('#fan-container')).toBeHidden();
    // The tree a start opens, with its start person.
    await expect(card(page, 'Bořivoj')).toBeVisible();
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);

    for (const view of ['descendants', 'timeline', 'map']) {
        await page.locator(`#view-mode-${view}`).click();
        await expect(page.locator(`#view-mode-${view}`)).toHaveClass(/active/);
        await reopen(page);
        await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
        await expect(card(page, 'Bořivoj')).toBeVisible();
    }
    // The global option is gone from Settings.
    await expect(page.locator('#resume-last-view-toggle')).toHaveCount(0);
});

const MATRIX = [
    { view: 'family', person: 'last', expect: { view: 'family', person: 'ho_a', name: 'Radomil' } },
    { view: 'family', person: 'first', expect: { view: 'family', person: 'ho_c', name: 'Zbyňka' } },
    { view: 'last', person: 'last', expect: { view: 'fan', person: 'ho_a', name: 'Radomil' } },
    { view: 'last', person: 'first', expect: { view: 'fan', person: 'ho_c', name: 'Zbyňka' } },
] as const;

for (const [i, m] of MATRIX.entries()) {
    test(`a start: default view ${m.view === 'last' ? 'last used' : 'family'}, default person ${m.person === 'last' ? 'last focused' : 'first'}`, async ({ page }) => {
        await twoTrees(page);
        await makeStartTree(page, 'Hollerbachovi');
        // The real dialog for every second combination, the API for the rest.
        if (i % 2 === 0) await setDefaultsInDialog(page, 'Hollerbachovi', m.person, m.view);
        else await setDefaults(page, 'Hollerbachovi', m.person, m.view);

        // The work ends in the fan, centred on the grandfather.
        await page.evaluate(() => window.Strom.TreeRenderer.setFocus('ho_b' as never));
        await fanOn(page, 'Radomil');
        await reopen(page);
        expect(await shown(page)).toEqual({ tree: 'Hollerbachovi', view: m.expect.view, person: m.expect.person });
        await expect(page.locator(`#view-mode-${m.expect.view}`)).toHaveClass(/active/);
        if (m.expect.view === 'fan') await expect(page.locator('#fan-container .fan-focus')).toContainText(m.expect.name);
        else await expect(focusedCard(page)).toContainText(m.expect.name);

        // The tree's menu says how it opens.
        const value = (await openTreeActions(page)).locator('[data-action="defaultPerson"]');
        await expect(value.locator('.actions-tree-action-label')).toHaveText('Default person and view');
        if (m.view === 'last') await expect(value.locator('.actions-tree-value')).toContainText('Last used view');
        else await expect(value.locator('.actions-tree-value')).not.toContainText('Last used view');
    });
}

test('a tree switch: a tree set to its last used view comes back in it, one with the default in the family view', async ({ page }) => {
    await twoTrees(page);
    await setDefaults(page, 'Hollerbachovi', 'first', 'last');
    const switchTo = async (name: string) => {
        const id = await treeId(page, name);
        await page.evaluate(async (i) => {
            await window.Strom.DataManager.switchTree(i as never);
            window.Strom.TreeRenderer.restoreFromSession();
            await window.Strom.TreeRenderer.renderAsync();
        }, id);
    };
    await fanOn(page, 'Radomil');
    await switchTo('Lhotákovi');
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await page.locator('#view-mode-descendants').click();
    await expect(page.locator('#view-mode-descendants')).toHaveClass(/active/);

    // The fan again, with the tree's default person (the first person).
    await switchTo('Hollerbachovi');
    await expect(page.locator('#view-mode-fan')).toHaveClass(/active/);
    await expect(page.locator('#fan-container .fan-focus')).toContainText('Zbyňka');
    // The other tree keeps the default: the family view, not the descendants chart.
    await switchTo('Lhotákovi');
    await expect(page.locator('#fan-container')).toBeHidden();
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await expect(card(page, 'Bořivoj')).toBeVisible();
});

for (const view of ['family', 'last'] as const) {
    test(`a link to a person opens that person, default view ${view === 'last' ? 'last used' : 'family'}`, async ({ page }) => {
        await twoTrees(page);
        await setDefaults(page, 'Hollerbachovi', 'first', view);
        await fanOn(page, 'Radomil');
        const slug = await page.evaluate(() => window.Strom.TreeManager.getTreeSlug(window.Strom.DataManager.getCurrentTreeId()!));
        await reopen(page, `?tree=${encodeURIComponent(slug)}&person=ho_b`);
        const personPage = page.locator('#person-page-modal');
        await expect(personPage).toBeVisible();
        await expect(personPage).toContainText('Kvido');
        await page.keyboard.press('Escape');
        await expect(personPage).toBeHidden();
        expect(await shown(page)).toMatchObject({ tree: 'Hollerbachovi', person: 'ho_b' });
        if (view === 'last') {
            // The view last used, with the person of the link.
            await expect(page.locator('#view-mode-fan')).toHaveClass(/active/);
            await expect(page.locator('#fan-container .fan-focus')).toContainText('Kvido');
        } else {
            await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
            await expect(focusedCard(page)).toContainText('Kvido');
        }
        // The link is not opened again by a reload.
        await reloadPage(page);
        await expect(personPage).toBeHidden();
        expect(await shown(page)).toMatchObject({ tree: 'Hollerbachovi', person: 'ho_b' });
    });
}

test('fallbacks: a deleted person, an unknown stored view, a reload point whose person is gone', async ({ page }) => {
    await twoTrees(page);
    await makeStartTree(page, 'Hollerbachovi');
    await setDefaults(page, 'Hollerbachovi', 'last', 'last');
    await fanOn(page, 'Radomil');

    // The last focused person deleted: the last used view with the first person.
    await page.evaluate(() => window.Strom.DataManager.deletePerson('ho_a' as never));
    await reopen(page);
    await expect(page.locator('#view-mode-fan')).toHaveClass(/active/);
    expect(await shown(page)).toEqual({ tree: 'Hollerbachovi', view: 'fan', person: 'ho_c' });

    // A stored view the app does not know: the family view.
    const id = await treeId(page, 'Hollerbachovi');
    await page.evaluate((i) => localStorage.setItem('strom-last-views', JSON.stringify({ [i]: 'poster' })), id);
    await reopen(page);
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await expect(page.locator('#fan-container')).toBeHidden();

    // A reload point whose person is gone: the tree's normal start.
    await setDefaults(page, 'Hollerbachovi', 'first', 'family');
    await page.locator('#view-mode-timeline').click();
    await expect(page.locator('#view-mode-timeline')).toHaveClass(/active/);
    await page.evaluate(() => {
        const raw = JSON.parse(sessionStorage.getItem('strom-reload-point') ?? '{}');
        sessionStorage.setItem('strom-reload-point', JSON.stringify({ ...raw, person: 'p_gone' }));
    });
    await reloadPage(page);
    expect(await shown(page)).toEqual({ tree: 'Hollerbachovi', view: 'family', person: 'ho_c' });
    await expect(focusedCard(page)).toContainText('Zbyňka');
});

import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, card } from './helpers.js';

/**
 * Where a start opens (1101): the family view with the tree's start person,
 * never the view left on screen (descendants, timeline, fan, map), which used
 * to come back with the tree's start person instead of the person it was left
 * with. Settings → "Continue where work ended" on: the last tree, in the last
 * view, with the person the work ended with. A link to a person opens that
 * person either way. Invented families only.
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

async function reopen(page: Page, query = ''): Promise<void> {
    await page.goto(`/strom.html${query}`);
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
}

test('a start opens the family view, not the fan, the descendants chart, the timeline or the map left on screen', { tag: '@smoke' }, async ({ page }) => {
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
});

test('a tree switch opens the family view of a tree left in the fan or the descendants chart', async ({ page }) => {
    await twoTrees(page);
    const ids = await page.evaluate(() => window.Strom.TreeManager.getTrees().map(t => ({ id: t.id, name: t.name })));
    const idOf = (name: string) => ids.find(t => t.name === name)!.id;
    const switchTo = async (name: string) => {
        await page.evaluate(async (id) => {
            await window.Strom.DataManager.switchTree(id as never);
            window.Strom.TreeRenderer.restoreFromSession();
            await window.Strom.TreeRenderer.renderAsync();
        }, idOf(name));
    };
    await fanOn(page, 'Radomil');
    await switchTo('Lhotákovi');
    await page.locator('#view-mode-descendants').click();
    await switchTo('Hollerbachovi');
    await expect(page.locator('#fan-container')).toBeHidden();
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await switchTo('Lhotákovi');
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
});

const currentTree = (page: Page) => page.evaluate(() => {
    const id = window.Strom.DataManager.getCurrentTreeId();
    return id ? window.Strom.TreeManager.getTreeMetadata(id)?.name ?? null : null;
});

test('setting on: the next start opens the last tree in the fan with the person the work ended with', async ({ page }) => {
    await twoTrees(page);
    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const toggle = page.locator('#resume-last-view-toggle');
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#settings-modal')).toContainText('Continue where work ended');
    await toggle.check();
    await page.keyboard.press('Escape');

    // The work ends in the second tree, the fan centred on the grandfather;
    // a start opens the first tree otherwise.
    expect(await currentTree(page)).toBe('Hollerbachovi');
    await fanOn(page, 'Radomil');
    await reopen(page);
    expect(await currentTree(page)).toBe('Hollerbachovi');
    await expect(page.locator('#view-mode-fan')).toHaveClass(/active/);
    await expect(page.locator('#fan-container .fan-focus')).toContainText('Radomil');

    // The family view with its person comes back the same way.
    await page.locator('#view-mode-family').click();
    await expect(card(page, 'Radomil')).toBeVisible();
    await reopen(page);
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await expect(page.locator('#tree-canvas .person-card.focused .name-text')).toContainText('Radomil');

    // The descendants chart too, with its person.
    await page.locator('#view-mode-descendants').click();
    await expect(page.locator('#view-mode-descendants')).toHaveClass(/active/);
    await reopen(page);
    await expect(page.locator('#view-mode-descendants')).toHaveClass(/active/);
    await expect(page.locator('#tree-canvas .person-card.focused .name-text')).toContainText('Radomil');

    // The timeline and the map too.
    for (const view of ['timeline', 'map']) {
        await page.locator(`#view-mode-${view}`).click();
        await expect(page.locator(`#view-mode-${view}`)).toHaveClass(/active/);
        await reopen(page);
        await expect(page.locator(`#view-mode-${view}`)).toHaveClass(/active/);
    }

    // The person gone: the family view with the tree's start person, never the fan.
    await page.evaluate(() => window.Strom.TreeRenderer.setFocus('ho_c' as never));
    await fanOn(page, 'Kvido');
    await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('strom-resume-points') ?? '{}');
        for (const p of Object.values(raw.trees ?? {}) as { person: string }[]) p.person = 'p_gone';
        localStorage.setItem('strom-resume-points', JSON.stringify(raw));
    });
    await reopen(page);
    await expect(page.locator('#fan-container')).toBeHidden();
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await expect(card(page, 'Zbyňka')).toBeVisible();

    // Off again: the tree view at the next start.
    await fanOn(page, 'Kvido');
    await page.evaluate(() => window.Strom.UI.toggleResumeLastView(false));
    await reopen(page);
    await expect(page.locator('#fan-container')).toBeHidden();
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
});

for (const resume of [false, true]) {
    test(`a link to a person opens that person, setting ${resume ? 'on' : 'off'}`, async ({ page }) => {
        await twoTrees(page);
        if (resume) await page.evaluate(() => window.Strom.UI.toggleResumeLastView(true));
        await fanOn(page, 'Radomil');
        const slug = await page.evaluate(() => window.Strom.TreeManager.getTreeSlug(window.Strom.DataManager.getCurrentTreeId()!));
        await reopen(page, `?tree=${encodeURIComponent(slug)}&person=ho_b`);
        const personPage = page.locator('#person-page-modal');
        await expect(personPage).toBeVisible();
        await expect(personPage).toContainText('Kvido');
        await page.keyboard.press('Escape');
        await expect(personPage).toBeHidden();
        if (resume) {
            // The view the work ended in, with the person of the link.
            await expect(page.locator('#view-mode-fan')).toHaveClass(/active/);
            await expect(page.locator('#fan-container .fan-focus')).toContainText('Kvido');
        } else {
            await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
            await expect(page.locator('#tree-canvas .person-card.focused .name-text')).toContainText('Kvido');
        }
    });
}

/** The open tree's view and focus person, as the renderer has them. */
const shown = (page: Page) => page.evaluate(() => {
    const id = window.Strom.DataManager.getCurrentTreeId();
    return {
        tree: id ? window.Strom.TreeManager.getTreeMetadata(id)?.name ?? null : null,
        view: window.Strom.TreeRenderer.getViewMode(),
        person: window.Strom.TreeRenderer.getFocusPersonId(),
    };
});

async function reloadPage(page: Page): Promise<void> {
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
}

test('a reload keeps the tree, the view and the person in every view, whatever the settings', async ({ page }) => {
    await twoTrees(page);
    // The second tree is open, not the one a start opens.
    expect(await currentTree(page)).toBe('Hollerbachovi');

    // The family view with a person other than the tree's start person.
    await page.evaluate(() => window.Strom.TreeRenderer.setFocus('ho_b' as never));
    await expect(page.locator('#tree-canvas .person-card.focused .name-text')).toContainText('Kvido');
    await reloadPage(page);
    expect(await shown(page)).toEqual({ tree: 'Hollerbachovi', view: 'family', person: 'ho_b' });
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    await expect(page.locator('#tree-canvas .person-card.focused .name-text')).toContainText('Kvido');

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

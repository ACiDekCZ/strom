import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

test('empty state offers a demo tree that loads with a focus, a hint, the Register card and its drawn pictures', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#empty-state')).toBeVisible();

    await page.getByRole('button', { name: 'Try the small sample' }).click();

    // The sample (the Berg family) loads as a new tree.
    await expect(page.locator('#empty-state')).toBeHidden();
    await expect(page.locator('.tree-switcher-btn .tree-name')).toHaveText('Sample: the Berg family');
    // Focus person is shown and several cards are rendered.
    await expect(card(page, 'Johan')).toBeVisible();
    expect(await page.locator('.person-card').count()).toBeGreaterThan(3);
    // Hint toast appears.
    await expect(page.locator('.toast')).toBeVisible();

    // It opens on the Register card (each event with its place and full date) and its drawn pictures.
    await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('register');
    await expect(card(page, 'Johan').locator('.card-line--label')).not.toHaveCount(0);
    // Portraits, the register page and its crops are drawn on load, not shipped.
    // Read with the pooled images whole (the tree in memory holds references).
    const media = await page.evaluate(async () => {
        const d = await window.Strom.Images.expandedData(window.Strom.DataManager.getData());
        const persons = Object.values(d.persons);
        return {
            photos: persons.filter(p => p.photo?.startsWith('data:image/jpeg')).length,
            // Each portrait is a record of the tree's files at its person (data v25).
            portraitRecords: persons.filter(p => Object.values(d.media ?? {})
                .some(a => a.dataUrl === p.photo && a.places.some(pl => 'personId' in pl && pl.personId === p.id))).length,
            pages: Object.values(d.media ?? {}).filter(a => a.places.some(pl => 'personId' in pl)
                && !persons.some(p => p.photo === a.dataUrl)).length,
            crops: Object.values(d.sources ?? {}).flatMap(s => s.excerpts ?? []).length,
        };
    });
    expect(media).toEqual({ photos: 4, portraitRecords: 4, pages: 1, crops: 3 });
});

test('the sample keeps a card density the user already chose', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.dataset.cardDensity)).toBe('compact');
});

test('the sample opens on the Register card and leaves the Custom fields as they were (U03a)', async ({ page }) => {
    await openApp(page);
    // Custom fields saved earlier, no card type chosen yet.
    const mine = { on: ['marriage'], style: 'labels', widthCap: 400 };
    await page.evaluate((f) => {
        const raw = JSON.parse(localStorage.getItem('strom-settings') ?? '{}');
        localStorage.setItem('strom-settings', JSON.stringify({ ...raw, cardFields: f }));
    }, mine);
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').cardFields);
    await page.getByRole('button', { name: 'Try the small sample' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.Strom.SettingsManager.getCardDensity())).toBe('register');
    // The Register lines, not the saved Custom ones (marriage only).
    await expect(card(page, 'Johan').locator('.card-line--birth')).toHaveCount(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').cardFields)).toEqual(before);
});

test.describe('the "Sample" tag of a sample tree (spec 143 §1)', () => {
    test('the Berg sample carries it after its name in the toolbar, the switcher and Manage trees; renamed, it keeps it and only the name shortens', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.loadDemoTree());
        await expect(card(page, 'Johan')).toBeVisible();
        const tag = page.locator('.tree-switcher-btn #current-tree-tag .tree-sample-tag');
        await expect(tag).toHaveText('Sample');
        await expect(tag).toHaveAttribute('title', 'A made-up family for trying things out. Other trees stay unchanged; the sample can be deleted in Manage trees.');

        // The mark, not the name: a long new name is cut ("…"), the tag stays whole inside the pill.
        await page.evaluate(() => window.Strom.TreeManager.renameTree(window.Strom.TreeManager.getActiveTreeId()!, 'Sample – the Berg family of Voss, Norway'));
        await page.evaluate(() => window.Strom.UI.updateTreeSwitcher());
        await expect(page.locator('#current-tree-name')).toHaveText('Sample – the Berg family of Voss, Norway');
        await expect(tag).toBeVisible();
        const fit = await page.evaluate(() => {
            const pill = document.querySelector('.tree-switcher-btn')!.getBoundingClientRect();
            const name = document.getElementById('current-tree-name')!;
            const t = document.querySelector<HTMLElement>('#current-tree-tag .tree-sample-tag')!;
            const r = t.getBoundingClientRect();
            return { nameCut: name.scrollWidth > name.clientWidth, tagWhole: t.scrollWidth <= t.clientWidth + 0.5,
                inside: r.left >= pill.left && r.right <= pill.right + 0.5, afterName: r.left >= name.getBoundingClientRect().right - 0.5 };
        });
        expect(fit).toEqual({ nameCut: true, tagWhole: true, inside: true, afterName: true });

        // The switcher's list: the tag on the sample's row, the list wide enough for it.
        await page.locator('.tree-switcher-btn').click();
        const dropdown = page.locator('#tree-switcher-dropdown');
        await expect(dropdown.locator('.tree-switcher-item.active .tree-sample-tag')).toHaveText('Sample');
        await expect(dropdown).toHaveClass(/with-research/);
        await page.keyboard.press('Escape');

        // Manage trees: the tag among the row's chips; the origin line stays "no research".
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const row = page.locator('.tree-manager-item.active');
        await expect(row.locator('.tree-badge--sample')).toHaveText('Sample');
        await expect(row.locator('.tree-manager-item-origin')).toHaveAttribute('data-origin', 'none');
    });

    test('on a computer a long name keeps its own cap beside the tag: the toolbar does not take the tag for a squeeze', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.loadDemoTree());
        await expect(card(page, 'Johan')).toBeVisible();
        await page.evaluate(() => window.Strom.TreeManager.renameTree(window.Strom.TreeManager.getActiveTreeId()!, 'Sample – the Berg family of Voss, Norway'));
        await page.evaluate(() => window.Strom.UI.updateTreeSwitcher());
        await expect(page.locator('#current-tree-name')).toHaveText('Sample – the Berg family of Voss, Norway');
        // The pill holds the name at its 210 px cap, the tag, the gaps and the caret (a 300 px pill cut the
        // name under its cap, which the fit read as a squeeze and capped the name at 56 px at any width).
        await expect(page.locator('.toolbar')).not.toHaveClass(/toolbar-squeeze-name/);
        await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('current-tree-name')!.getBoundingClientRect().width))).toBeGreaterThanOrEqual(205);
    });

    test('a showcase (its mark from the file\'s header): the tag, its date in Manage trees and its view-only research line', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-11-20T10:00:00Z'));
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.loadDemoTree());
        await expect(card(page, 'Johan')).toBeVisible();
        // A tree of the user's made a showcase by the mark alone (the opening itself is not this test's).
        await page.evaluate(async () => {
            const S = window.Strom;
            const id = await S.TreeManager.createTree('Ukázka – rod Horáků');
            S.TreeManager.markSampleTree(id, { exportId: 'showcase-cs', lang: 'cs', sampleVersion: '3.33.0', asOf: '2026-11-01T09:00:00.000Z' });
            await S.UI.switchToTree(id);
        });
        await expect(page.locator('#current-tree-name')).toHaveText('Ukázka – rod Horáků');
        await expect(page.locator('#current-tree-tag .tree-sample-tag')).toHaveText('Sample');
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const row = page.locator('.tree-manager-item.active');
        await expect(row.locator('.tree-badge--sample')).toHaveText('Sample');
        await expect(row.locator('.tree-manager-item-stats-row')).toContainText('as of 1 Nov 2026');
        await expect(row.locator('.tree-manager-item-origin')).toHaveAttribute('data-origin', 'sample');
        await expect(row.locator('.tree-manager-item-origin')).toContainText('sample research · view only');
        // The other sample keeps its own tag, its line "no research".
        const bergs = page.locator('.tree-manager-item:not(.active)').filter({ hasText: 'Sample: the Berg family' });
        await expect(bergs.locator('.tree-badge--sample')).toHaveText('Sample');
        await expect(bergs.locator('.tree-manager-item-origin')).toHaveAttribute('data-origin', 'none');
    });

    test.describe('on a phone', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

        test('a tap on the tag says what a sample is and opens nothing else; the Trees sheet shows the tag too', async ({ page }) => {
            await openApp(page);
            await page.evaluate(() => window.Strom.UI.loadDemoTree());
            await expect(card(page, 'Johan')).toBeVisible();
            const tag = page.locator('#current-tree-tag .tree-sample-tag');
            await expect(tag).toHaveText('Sample');
            await tag.tap();
            const bubble = page.locator('.sample-why');
            await expect(bubble).toHaveText('A made-up family for trying things out. Other trees stay unchanged; the sample can be deleted in Manage trees.');
            await expect(page.locator('.bottom-sheet-overlay')).toHaveCount(0);
            // The phone's whole width less 16 px on each side.
            // (Its layout box: it fades in with a small scale.)
            const fit = await bubble.evaluate((b) => {
                const vw = document.documentElement.clientWidth;
                return { vw, left: Math.round(b.offsetLeft), right: Math.round(vw - b.offsetLeft - b.offsetWidth) };
            });
            expect(fit).toEqual({ vw: fit.vw, left: 16, right: 16 });
            // A tap elsewhere closes it.
            await page.locator('#tree-container').tap({ position: { x: 20, y: 300 } });
            await expect(bubble).toHaveCount(0);

            // The name opens the Trees sheet: the sample's row with its tag after its name.
            await page.locator('#current-tree-name').tap();
            const sheetRow = page.locator('.bottom-sheet-item[data-tree-id].active');
            await expect(sheetRow.locator('.bottom-sheet-label .tree-sample-tag')).toHaveText('Sample');
        });
    });
});

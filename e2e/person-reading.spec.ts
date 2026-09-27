import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card, cardAction, personModal } from './helpers.js';

/**
 * Person menu → "Show sources" / "Show story": a look at a person's sources
 * and narrative without opening the edit form.
 */

async function actionsOf(page: Page): Promise<string[]> {
    return page.locator('.context-menu [data-action], .bottom-sheet-person [data-action]').evaluateAll(
        (els) => els.map((el) => (el as HTMLElement).dataset.action || ''));
}

async function openMenu(page: Page, name: string): Promise<void> {
    await card(page, name).click();
    await expect(page.locator('.context-menu, .bottom-sheet-person')).toBeVisible();
}

async function closeMenu(page: Page): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(page.locator('.context-menu, .bottom-sheet-person')).toHaveCount(0);
}

/**
 * Jan cited three times: on himself (Baptism book), on his baptism (the same
 * book) and on his marriage (a different register) → 2 distinct sources.
 */
async function seedCitations(page: Page): Promise<string> {
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1865' });
    await addRelation(page, 'Jan', 'partner', 'Anna', 'Nova', 'female');
    return page.evaluate(() => {
        const DM = window.Strom.DataManager;
        const jan = DM.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Jan') as { id: string };
        const book = DM.addSource({ title: 'Krestni matrika Lipany', repository: 'SOA Trebon', reference: 'fol. 34', quality: 3 })!;
        const marriage = DM.addSource({ title: 'Oddaci matrika Lipany' })!;
        DM.citePerson(jan.id, book.id);
        const ev = DM.addLifeEvent(jan.id, { type: 'baptism', date: '1865' })!;
        DM.citeEvent(jan.id, ev.id, book.id);
        const union = Object.values(DM.getData().partnerships)[0] as { id: string };
        DM.updatePartnership(union.id, { startDate: '1890' });
        DM.citePartnership(union.id, marriage.id);
        return jan.id;
    });
}

test('menu: Focus first, Edit second; Show sources with its count, Show story only with a story', async ({ page }) => {
    await openApp(page);
    const janId = await seedCitations(page);

    await openMenu(page, 'Jan');
    const actions = await actionsOf(page);
    expect(actions.slice(0, 4)).toEqual(['focus', 'edit', 'sources', 'descendants']);
    const item = page.locator('.context-menu [data-action="sources"]');
    await expect(item.locator('.menu-item-meta')).toHaveText('2');
    await expect(item).toHaveAttribute('aria-label', 'Show sources, 2');
    await closeMenu(page);

    // No story → no story item; with a story it sits right under "Show sources".
    expect(actions).not.toContain('story');
    await page.evaluate((id) => window.Strom.DataManager.updatePerson(id, { story: { text: 'Kovar z Lipan.' } }), janId);
    await openMenu(page, 'Jan');
    expect((await actionsOf(page)).slice(0, 5)).toEqual(['focus', 'edit', 'sources', 'story', 'descendants']);
    await closeMenu(page);

    // Zero sources: the item is there (the quick way to cite), without a number.
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    await openMenu(page, 'Petr');
    await expect(page.locator('.context-menu [data-action="sources"]')).toBeVisible();
    await expect(page.locator('.context-menu [data-action="sources"] .menu-item-meta')).toHaveCount(0);
});

test('menu: a locked person and a read-only view show the sources item only when there are some', async ({ page }) => {
    await openApp(page);
    const janId = await seedCitations(page);
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    const petrId = await card(page, 'Petr').getAttribute('data-id');
    await page.evaluate(([a, b]) => {
        window.Strom.DataManager.updatePerson(a, { isLocked: true });
        window.Strom.DataManager.updatePerson(b, { isLocked: true });
    }, [janId, petrId!]);
    await page.evaluate(() => window.Strom.TreeRenderer.render());

    await openMenu(page, 'Jan');
    expect((await actionsOf(page)).slice(0, 3)).toEqual(['focus', 'view', 'sources']);
    await closeMenu(page);
    await openMenu(page, 'Petr');
    expect(await actionsOf(page)).not.toContain('sources');
    await closeMenu(page);

    // Read-only (a shared file's view mode).
    await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
    await openMenu(page, 'Petr');
    expect(await actionsOf(page)).not.toContain('sources');
    await closeMenu(page);
    await openMenu(page, 'Jan');
    expect((await actionsOf(page)).slice(0, 2)).toEqual(['focus', 'sources']);
    await page.locator('.context-menu [data-action="sources"]').click();
    const dialog = page.locator('#person-sources-modal');
    await expect(dialog).toBeVisible();
    // Nothing to cite from a read-only view.
    await expect(dialog.locator('#person-sources-cite')).toBeHidden();
    await expect(dialog.locator('.buttons [data-dismiss]')).toHaveText('Close');
});

test('sources dialog: one row per source with what it supports, by year; a row opens the viewer, Escape comes back', async ({ page }) => {
    await openApp(page);
    const janId = await seedCitations(page);
    // The marriage register also on the person; an undated source goes last.
    await page.evaluate((id) => {
        const DM = window.Strom.DataManager;
        const all = Object.values(DM.getData().sources) as Array<{ id: string; title: string }>;
        DM.citePerson(id, all.find(s => s.title === 'Oddaci matrika Lipany')!.id);
        DM.citePerson(id, DM.addSource({ title: 'Aaa bez roku' })!.id);
    }, janId);
    await cardAction(page, 'Jan', 'sources');
    const dialog = page.locator('#person-sources-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#person-sources-subtitle')).toHaveText('Jan Novak · 1865– · 3 sources');
    const rows = dialog.locator('.person-source-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.person-source-title')).toHaveText('Krestni matrika Lipany');
    await expect(rows.nth(0).locator('.person-source-meta')).toHaveText('Person · Baptism 1865 Original');
    await expect(rows.nth(1).locator('.person-source-meta')).toHaveText('Person · Marriage 1890');
    await expect(rows.nth(1).locator('[title]')).toHaveAttribute('title', 'Marriage: Jan Novak and Anna Nova');
    await expect(rows.nth(2).locator('.person-source-title')).toHaveText('Aaa bez roku');
    // The archive and shelfmark live in the viewer, not in the row.
    await expect(dialog).not.toContainText('SOA Trebon');

    await rows.nth(1).click();
    const viewer = page.locator('#source-viewer-modal');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('#source-viewer-title')).toHaveText('Oddaci matrika Lipany');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
});

test('sources dialog: Cite → pick → the row is under Person, the edit form has the chip, one undo removes it', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => { window.Strom.DataManager.addSource({ title: 'Scitani lidu 1921' }); });

    await cardAction(page, 'Jan', 'sources');
    const dialog = page.locator('#person-sources-modal');
    await expect(dialog.locator('.person-sources-empty')).toHaveText('No sources cited for this person yet.');
    await dialog.locator('#person-sources-cite').click();
    const picker = page.locator('#source-picker-modal');
    await expect(picker).toBeVisible();
    await picker.locator('.source-picker-item', { hasText: 'Scitani lidu 1921' }).click();
    await expect(picker).toBeHidden();
    await expect(dialog.locator('.person-source-row')).toHaveCount(1);
    await expect(dialog.locator('.person-source-row')).toContainText('Scitani lidu 1921');
    await expect(dialog.locator('.person-source-meta')).toHaveText('Person');
    await expect(dialog.locator('.person-source-row')).toHaveClass(/is-new/);

    await dialog.locator('[data-dismiss]').click();
    await expect(dialog).toHaveCount(0);
    await cardAction(page, 'Jan', 'edit');
    await expect(personModal(page).locator('#person-sources-chips')).toContainText('Scitani lidu 1921');
    await personModal(page).locator('[data-dismiss]').click();
    await expect(personModal(page)).toBeHidden();

    await page.evaluate(() => window.Strom.UI.performUndo());
    const cited = await page.evaluate(() => {
        const jan = window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Jan') as { sourceIds?: string[] };
        return jan.sourceIds ?? [];
    });
    expect(cited).toEqual([]);
});

test('sources dialog: Cite → New source → Save cites it on the person', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await cardAction(page, 'Jan', 'sources');
    const dialog = page.locator('#person-sources-modal');
    await dialog.locator('#person-sources-cite').click();
    const picker = page.locator('#source-picker-modal');
    await picker.getByRole('button', { name: 'New source…' }).click();
    const editor = page.locator('#source-editor-modal');
    await expect(editor).toBeVisible();
    await editor.locator('#input-source-title').fill('Pozemkova kniha');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();
    await expect(picker).toBeHidden();
    await expect(dialog.locator('.person-source-row')).toContainText('Pozemkova kniha');
    await expect(dialog.locator('#person-sources-subtitle')).toContainText('· 1 source');
});

test('story reader: paragraphs, bold, escaped HTML, Draft tag; Edit lands in the story field', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const janId = await card(page, 'Jan').getAttribute('data-id');
    await page.evaluate((id) => window.Strom.DataManager.updatePerson(id, {
        story: {
            title: 'Kovar z Lipan', status: 'draft',
            text: 'Jan byl **kovar**.\n\nPotom <script>window.__x = 1</script> odesel.',
            facts: ['krest 1865, Lipany'], note: 'Neni to pramen.',
        },
    }), janId!);

    await cardAction(page, 'Jan', 'story');
    const reader = page.locator('#person-story-modal');
    await expect(reader).toBeVisible();
    const text = reader.locator('.story-reader-text');
    await expect(text.locator('p')).toHaveCount(2);
    await expect(text.locator('strong')).toHaveText('kovar');
    await expect(text).toContainText('<script>window.__x = 1</script>');
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    await expect(reader.locator('.story-reader-title')).toHaveText('Kovar z Lipan');
    await expect(reader.locator('.story-draft-tag')).toHaveText('Draft');
    await expect(reader.locator('.story-reader-facts li')).toHaveText(['krest 1865, Lipany']);
    await expect(reader.locator('.story-reader-note')).toHaveText('Neni to pramen.');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('person-story-body');

    await reader.locator('#person-story-edit').click();
    await expect(reader).toHaveCount(0);
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.locator('#input-story')).toBeFocused();
    await expect(modal.locator('#pm-story-section')).toBeInViewport();
});

test('360px: both items in the bottom sheet, dialogs without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page);
    const janId = await seedCitations(page);
    await page.evaluate((id) => window.Strom.DataManager.updatePerson(id, { story: { text: 'Kovar z Lipan.' } }), janId);

    await openMenu(page, 'Jan');
    const sheet = page.locator('.bottom-sheet-person');
    await expect(sheet.locator('[data-action="sources"] .menu-item-meta')).toHaveText('2');
    await expect(sheet.locator('[data-action="story"]')).toBeVisible();
    await sheet.locator('[data-action="sources"]').click();
    const dialog = page.locator('#person-sources-modal');
    await expect(dialog).toBeVisible();
    const noScroll = () => page.evaluate(() => {
        const content = document.querySelector('.modal-overlay.active .modal-content') as HTMLElement;
        return document.documentElement.scrollWidth <= window.innerWidth && content.scrollWidth <= content.clientWidth;
    });
    expect(await noScroll()).toBe(true);
    // Primary on top of Close in the stacked footer.
    const order = await page.evaluate(() => {
        const cite = document.getElementById('person-sources-cite')!.getBoundingClientRect().top;
        const close = document.getElementById('person-sources-close')!.getBoundingClientRect().top;
        return cite < close;
    });
    expect(order).toBe(true);
    await dialog.locator('[data-dismiss]').click();

    await openMenu(page, 'Jan');
    await sheet.locator('[data-action="story"]').click();
    await expect(page.locator('#person-story-modal')).toBeVisible();
    expect(await noScroll()).toBe(true);
});

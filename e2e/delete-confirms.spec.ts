import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction } from './helpers.js';

/**
 * A confirmation has to say WHAT it is about to destroy. The app already does
 * this for a person and for a tree; events, attachments and backups asked
 * "Delete this event?" and left the user guessing which row they had hit.
 */
/** The confirm can open a tick late (some paths read storage first).
 *  Title and message together: the title names the object. */
async function confirmText(page: import('@playwright/test').Page): Promise<string> {
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    const title = await page.locator('#confirm-title').innerText();
    return `${title}\n${await page.locator('#confirm-message').innerText()}`;
}

test('deleting an event says which event', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const id = dm.getAllPersons()[0].id;
        dm.addLifeEvent(id, { type: 'baptism', date: '1880-05-20', place: 'Kolín' });
        dm.addLifeEvent(id, { type: 'occupation', note: 'kovář', date: '1910' });
    });
    await cardAction(page, 'Jan', 'edit');

    // The second one — a generic message would be identical for both.
    await page.locator('.event-row:not(.readonly)').nth(1).locator('.event-actions button').nth(1).click();
    const text = await confirmText(page);
    expect(text).toContain('Occupation');
    expect(text).toContain('1910');
    expect(text).not.toContain('Baptism');

    // And it really deletes that one — via a verb button, not "Yes".
    await page.getByRole('button', { name: 'Delete event' }).click();
    const left = await page.evaluate(() =>
        window.Strom.DataManager.getAllPersons()[0].events!.map(e => e.type));
    expect(left).toEqual(['baptism']);
});

test('deleting an attachment says which file', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');
    await page.locator('#input-attachment').setInputFiles('e2e/fixtures/avatar.png');
    await expect(page.locator('.attachment-row')).toHaveCount(1);

    await page.locator('.attachment-row button[title="Delete"], .attachment-delete').first().click();
    expect(await confirmText(page)).toContain('avatar.png');
});

test('deleting a backup says which backup', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(async () => { await window.Strom.DataManager.snapshotNow('manual'); });
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());

    await page.locator('.snapshot-delete').first().click();
    const text = await confirmText(page);
    expect(text).toContain('1 person');        // what is in it
    // …and WHEN it was taken, as a person says it: "today 14:36"
    // ("1 person" alone would satisfy any bare \d+ pattern).
    expect(text).toMatch(/today \d{1,2}:\d{2}/);
});

/**
 * Destructive confirmations (round 14, V1): the confirm button is painted in
 * --danger and says the verb; the title names the object; the message lists
 * the links that go too and says Undo helps — or that nothing does.
 */
async function okStyle(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const btn = document.getElementById('confirm-ok-btn') as HTMLElement;
        const probe = document.createElement('div');
        probe.style.background = 'var(--danger)';
        document.body.appendChild(probe);
        const danger = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { bg: getComputedStyle(btn).backgroundColor, danger, text: btn.textContent?.trim() };
    });
}

test('deleting a person: danger verb button, named title, links and undo', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        const a = dm.createPerson({ firstName: 'Otec', lastName: 'Novak', gender: 'male' });
        const b = dm.createPerson({ firstName: 'Matka', lastName: 'Novakova', gender: 'female' });
        const w = dm.createPerson({ firstName: 'Marie', lastName: 'Novakova', gender: 'female' });
        dm.addParentChild(a.id, jan.id);
        dm.addParentChild(b.id, jan.id);
        dm.createPartnership(jan.id, w.id);
    });
    await page.evaluate(() => {
        const jan = window.Strom.DataManager.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Jan');
        void window.Strom.UI.confirmDelete(jan.id);
    });
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    await expect(page.locator('#confirm-title')).toHaveText('Delete Jan Novak (*1880)?');
    const msg = page.locator('#confirm-message');
    await expect(msg).toContainText('2 parents and 1 partner');
    await expect(msg).toContainText('Undo');
    await expect(msg).not.toContainText('cannot be undone');

    const style = await okStyle(page);
    expect(style.text).toBe('Delete person');
    expect(style.bg).toBe(style.danger);

    await page.locator('#confirm-ok-btn').click();
    expect(await page.evaluate(() =>
        window.Strom.DataManager.getAllPersons().some((p: { firstName: string }) => p.firstName === 'Jan'))).toBe(false);
});

test('deleting a tree says it cannot be undone, in a danger dialog', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await page.evaluate(() => {
        const id = window.Strom.TreeManager.getActiveTreeId();
        void window.Strom.UI.confirmDeleteTree(id);
    });
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    await expect(page.locator('#confirm-title')).toContainText('Delete tree');
    await expect(page.locator('#confirm-message')).toContainText('1 person');
    await expect(page.locator('#confirm-message')).toContainText('cannot be undone');
    const style = await okStyle(page);
    expect(style.text).toBe('Delete tree');
    expect(style.bg).toBe(style.danger);
    await page.locator('#confirm-cancel-btn').click();
});

test('a list dialog reusing the confirm box does not inherit a danger button', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => {
        void window.Strom.UI.showConfirm('x', 'y', { confirmLabel: 'Delete person', variant: 'danger' });
    });
    await page.locator('#confirm-cancel-btn').click();
    await page.evaluate(() => {
        const all = window.Strom.DataManager.getAllPersons();
        window.Strom.UI.showSearchResultsModal([all[0], all[0]], 'Jan');
    });
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    await expect(page.locator('#confirm-ok-btn')).not.toHaveClass(/is-danger/);
    await expect(page.locator('#confirm-ok-btn')).not.toHaveText('Delete person');
});

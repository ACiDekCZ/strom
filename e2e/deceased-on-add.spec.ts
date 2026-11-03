import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson, card, cardAction, personModal, exportTreeJson } from './helpers.js';

/**
 * "Deceased" while adding a person, in every form that adds one: the person
 * form (first person, Add person) and the relative form (parent, child,
 * partner, sibling). A death date or place typed in ticks the box; a tick put
 * there that way goes when those fields are emptied again; a box ticked by
 * hand stays. A person added as deceased is no living person to the privacy
 * filter of an export. All names are invented.
 */

interface P { firstName: string; lastName: string; isDeceased?: boolean; deathDate?: string; deathPlace?: string }

const byName = async (page: Page, name: string): Promise<P> => {
    const all = await page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons) as P[]);
    const p = all.find(x => x.firstName === name);
    if (!p) throw new Error(`no person ${name}`);
    return p;
};

/** Open "add <relation>" from a card, type a name, show the death fields. */
async function openRelative(page: Page, from: string, action: 'parent' | 'partner' | 'child' | 'sibling', first: string, gender: 'male' | 'female') {
    await cardAction(page, from, action);
    const rel = page.locator('#relation-modal');
    await expect(rel).toBeVisible();
    await rel.locator('#rel-firstname').fill(first);
    await rel.locator('#rel-lastname').fill('Hrubec');
    await rel.locator('#rel-gender').selectOption(gender);
    await rel.locator('#rel-expand-btn').click();
    await expect(rel.locator('#rel-is-deceased')).toBeVisible();
    return rel;
}

test('a relative added with "Deceased" ticked is saved as deceased and is no living person to the export privacy', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Radim', 'Hrubec', { birthDate: '1990' });

    // Mother: ticked by hand, no death date or place.
    let rel = await openRelative(page, 'Radim', 'parent', 'Ludmila', 'female');
    await expect(rel.locator('#rel-is-deceased')).not.toBeChecked();
    await rel.locator('#rel-is-deceased').check();
    await rel.locator('#rel-submit-btn').click();
    await expect(rel).toBeHidden();
    expect((await byName(page, 'Ludmila')).isDeceased).toBe(true);
    await expect(card(page, 'Ludmila')).toContainText('†');

    // Father: left unticked — living, as before.
    rel = await openRelative(page, 'Radim', 'parent', 'Vilem', 'male');
    await rel.locator('#rel-submit-btn').click();
    await expect(rel).toBeHidden();
    expect((await byName(page, 'Vilem')).isDeceased).toBeUndefined();

    // The box starts unticked on the next opening (no carry-over).
    rel = await openRelative(page, 'Radim', 'sibling', 'Tomas', 'male');
    await expect(rel.locator('#rel-is-deceased')).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(rel).toBeHidden();

    // Export with initials for the living: the deceased mother keeps her name.
    const data = JSON.parse(readFileSync(await exportTreeJson(page, 'initials'), 'utf-8'));
    const names = (Object.values(data.persons) as P[]).map(p => p.firstName).sort();
    expect(names).toContain('Ludmila');
    expect(names).not.toContain('Vilem');
    expect(names).not.toContain('Radim');
});

test('a death date or place ticks "Deceased" in the relative form; emptied again, the tick goes; a hand tick stays', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Radim', 'Hrubec', { birthDate: '1990' });

    const rel = await openRelative(page, 'Radim', 'partner', 'Jarmila', 'female');
    const box = rel.locator('#rel-is-deceased');
    await rel.locator('#rel-deathplace').fill('Tabor');
    await expect(box).toBeChecked();
    await rel.locator('#rel-deathplace').fill('');
    await expect(box).not.toBeChecked();

    // Ticked by hand, then a place typed and removed: the hand tick stays.
    await box.check();
    await rel.locator('#rel-deathplace').fill('Tabor');
    await rel.locator('#rel-deathplace').fill('');
    await expect(box).toBeChecked();
    await box.uncheck();

    // A death date: ticked, saved with the date (the date says it by itself).
    await rel.locator('#rel-deathdate').fill('2001');
    await expect(box).toBeChecked();
    await rel.locator('#rel-submit-btn').click();
    await expect(rel).toBeHidden();
    const jarmila = await byName(page, 'Jarmila');
    expect(jarmila.deathDate).toBe('2001');
    expect(jarmila.isDeceased).toBeUndefined();
});

test('the person form ticks "Deceased" from a death place while adding and while editing', async ({ page }) => {
    await openApp(page);
    await page.locator('#empty-state button').first().click();
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    await modal.locator('#input-firstname').fill('Otakar');
    await modal.locator('#input-lastname').fill('Hrubec');
    await modal.locator('#expand-details').click();
    const box = modal.locator('#input-is-deceased');
    await expect(box).not.toBeChecked();
    await modal.locator('#input-deathplace').fill('Pisek');
    await expect(box).toBeChecked();
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    const otakar = await byName(page, 'Otakar');
    expect(otakar.deathPlace).toBe('Pisek');
    expect(otakar.isDeceased).toBe(true);
    const offerClose = page.locator('.family-offer-close');
    if (await offerClose.isVisible().catch(() => false)) await offerClose.click();

    // Editing a living person: a death place typed in ticks the box too.
    await createLivingAndEdit(page);
});

async function createLivingAndEdit(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.Strom.DataManager.createPerson({ firstName: 'Bedrich', lastName: 'Hrubec', gender: 'male', birthDate: '1985' });
        window.Strom.TreeRenderer.render();
    });
    const id = await page.evaluate(() =>
        (Object.values(window.Strom.DataManager.getData().persons) as Array<{ id: string; firstName: string }>)
            .find(p => p.firstName === 'Bedrich')!.id);
    await page.evaluate((pid) => window.Strom.UI.showEditPersonModal(pid as never), id);
    const modal = personModal(page);
    await expect(modal).toBeVisible();
    const box = modal.locator('#input-is-deceased');
    await expect(box).not.toBeChecked();
    await modal.locator('#input-deathplace').fill('Pisek');
    await expect(box).toBeChecked();
    await modal.locator('#input-deathplace').fill('');
    await expect(box).not.toBeChecked();
    await modal.locator('#input-deathplace').fill('Pisek');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();
    expect((await byName(page, 'Bedrich')).isDeceased).toBe(true);
}

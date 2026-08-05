import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal } from './helpers.js';

/**
 * Explanatory field texts run to three or four lines. Left open permanently,
 * a single explained field pushed the rest of the form off a phone screen —
 * and the text is read once, when someone first meets the field. The label
 * carries a "?" that opens it as a popup: unfolding it in place would grow the
 * form under the reader and move the field they were about to fill in.
 */
test('a long field explanation opens as a popup from the "?"', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');

    const modal = personModal(page);
    const group = modal.locator('#name-variants-group');
    const toggle = group.locator('.hint-toggle');

    await expect(group).toBeVisible();
    await expect(toggle).toBeVisible();
    // The text never takes room in the form itself.
    await expect(group.locator('.field-hint')).toBeHidden();

    await toggle.click();
    const popup = page.locator('#confirmation-modal');
    await expect(popup).toHaveClass(/active/);
    await expect(popup.locator('#confirm-message')).toContainText('Wischek');

    await popup.locator('#confirm-ok-btn').click();
    await expect(popup).not.toHaveClass(/active/);
    // Closing it leaves the form as it was — nothing unfolded into it.
    await expect(group.locator('.field-hint')).toBeHidden();
});

/**
 * A short hint is quicker to read than to open — the date formats stay put.
 */
test('a short hint keeps showing itself', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');

    const dateHint = personModal(page).locator('[data-i18n="personModal.dateHint"]');
    await expect(dateHint).toBeVisible();
    await expect(dateHint.locator('.hint-toggle')).toHaveCount(0);
});

/**
 * Godparents and witnesses belong to the acts a parish book records them for.
 * Offering the field on a change of address was a control nobody ever filled.
 */
test('godparents/witnesses are offered for a baptism, not for a residence', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');

    const modal = personModal(page);
    await modal.locator('#btn-add-event').click();
    const editor = page.locator('#event-editor-modal');
    await expect(editor).toBeVisible();

    const participants = editor.locator('#event-participants-section');
    await editor.locator('#input-event-type').selectOption('baptism');
    await expect(participants).toBeVisible();

    await editor.locator('#input-event-type').selectOption('residence');
    await expect(participants).toBeHidden();

    await editor.locator('#input-event-type').selectOption('occupation');
    await expect(participants).toBeHidden();

    // Back to an act that carries them.
    await editor.locator('#input-event-type').selectOption('burial');
    await expect(participants).toBeVisible();
});

/**
 * A dialog opened on top of another closes alone. The event editor was not on
 * the dialog stack, so Escape fell through to the "close everything" fallback
 * and took the person modal underneath with it.
 */
test('Escape in the event editor leaves the person form open', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');

    const modal = personModal(page);
    const editor = page.locator('#event-editor-modal');

    await modal.locator('#btn-add-event').click();
    await expect(editor).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(modal, 'the form it was opened from stays').toBeVisible();

    // And a second Escape closes the form, as it would have on its own.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
});

/**
 * A research note runs to paragraphs; the box follows it instead of scrolling
 * three lines at a time.
 */
test('the note field grows with its content', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');

    const notes = personModal(page).locator('#input-notes');
    const short = (await notes.boundingBox())!.height;

    await notes.fill(Array.from({ length: 12 }, (_, i) => `Radek ${i + 1} poznamky z matriky.`).join('\n'));
    const grown = (await notes.boundingBox())!.height;
    expect(grown).toBeGreaterThan(short);

    // The whole note is visible: no scrollbar left inside the box. Merely
    // "taller than before" was not enough to notice a CSS max-height quietly
    // pinning the field to three lines while the script asked for twelve.
    const fits = await notes.evaluate((el: HTMLTextAreaElement) =>
        el.scrollHeight <= el.clientHeight + 1);
    expect(fits, 'the note is shown whole, not scrolled').toBe(true);

    // …but not past its share of the window, so the rest of the form survives.
    const viewport = page.viewportSize()!.height;
    expect(grown).toBeLessThanOrEqual(Math.max(120, Math.round(viewport * 0.4)) + 2);
});

/**
 * An occupation keeps the trade in its note — that is what goes out as the
 * GEDCOM OCCU value — so a trade with no date or place left the row reading
 * "Occupation" and nothing else. Which trade it was is the point of the row.
 */
test('an occupation row says which trade it was', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Frantisek', 'Krepcik', { birthDate: '1863' });
    await cardAction(page, 'Frantisek', 'edit');

    const modal = personModal(page);
    await modal.locator('#btn-add-event').click();
    const editor = page.locator('#event-editor-modal');
    await editor.locator('#input-event-type').selectOption('occupation');
    await editor.locator('#input-event-note').fill('mistr obuvnicky');
    await editor.locator('button.primary').click();
    await expect(editor).toBeHidden();

    const row = modal.locator('.event-row', { hasText: 'mistr obuvnicky' });
    await expect(row).toBeVisible();
});

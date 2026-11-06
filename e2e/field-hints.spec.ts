import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal } from './helpers.js';

/**
 * A form field that needs explaining has a "?" right after its label, and the
 * "?" opens How Strom works at that field's rule (spec 061: name variants A4.7,
 * godparents and witnesses A5.5, stories A7.8). The old "?" that showed a
 * long hint text in a popup is gone in every language (K1.3).
 */
test('the "?" of a form field opens the help at its rule, no old hint popup is left', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');

    const modal = personModal(page);
    const noOldHints = async (): Promise<void> => {
        await expect(page.locator('.hint-toggle')).toHaveCount(0);
        await expect(page.locator('.field-hint.is-folded')).toHaveCount(0);
    };
    await noOldHints();

    // Name variants: the mark stands beside the label (the label keeps only its words) and ends the row.
    const variants = modal.locator('#name-variants-group .field-label-row');
    const mark = variants.locator('> .help-mark');
    await expect(variants.locator('> label')).toHaveText(/^\S/);
    await expect(variants.locator('> label .help-mark')).toHaveCount(0);
    await expect(mark).toHaveAttribute('title', 'How it works: Other spellings of the name (A4.7)');
    expect(await variants.evaluate(el => el.lastElementChild?.classList.contains('help-mark'))).toBe(true);
    await mark.click();
    await expect(page.locator('.help-rule[data-rule="A4.7"]')).toHaveClass(/is-target/);
    // No popup with the old text: the help opened over the form.
    await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.help-overlay')).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(mark).toBeFocused();

    // Stories.
    const story = modal.locator('label[for="input-story"]').locator('xpath=..').locator('> .help-mark');
    await expect(story).toHaveAttribute('title', 'How it works: Stories (A7.8)');
    await story.click();
    await expect(page.locator('.help-rule[data-rule="A7.8"]')).toHaveClass(/is-target/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.help-overlay')).toHaveCount(0);

    // Godparents and witnesses in the event editor.
    await modal.locator('#btn-add-event').click();
    const editor = page.locator('#event-editor-modal');
    await editor.locator('#input-event-type').selectOption('baptism');
    const people = editor.locator('#event-participants-section .field-label-row > .help-mark');
    await expect(people).toHaveCount(1);
    await expect(people).toHaveAttribute('title', 'How it works: Godparents and witnesses (A5.5)');
    await people.click();
    await expect(page.locator('.help-rule[data-rule="A5.5"]')).toHaveClass(/is-target/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.help-overlay')).toHaveCount(0);
    await expect(editor).toBeVisible();

    // The other languages: still no old "?", one mark per field, named in that language.
    for (const [lang, name] of [['cs', 'Další tvary jména'], ['de', 'Andere Schreibweisen des Namens'], ['pl', 'Inne formy imienia i nazwiska']] as const) {
        await page.evaluate(l => window.Strom.UI.setLanguage(l as never), lang);
        await noOldHints();
        await expect(page.locator('#name-variants-group .field-label-row > .help-mark')).toHaveCount(1);
        await expect(page.locator('#name-variants-group .field-label-row > .help-mark')).toHaveAttribute('aria-label', new RegExp(name));
        await expect(page.locator('label[data-help] .help-mark')).toHaveCount(0);
    }
});

// A short hint keeps showing itself (the date formats): advanced-fields.spec.ts,
// in the plain person form test.

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

// Escape in the event editor leaves the person form open (and a second one
// closes it): dialogs-keyboard.spec.ts, the event editor test.

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
    await createFirstPerson(page, 'Frantisek', 'Krevcik', { birthDate: '1863' });
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

import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card, seedSetting, cardBoxesMatchLayout } from './helpers.js';

/**
 * The surname after marriage on screen (spec 010, K1.3, K1.5): by default the
 * card shows the married surname with the birth one as a quiet row under the
 * name ("née Dvořáková"), Settings → "Surname display" picks the birth or the
 * married surname alone, search finds a person by either. Invented data.
 */

async function settle(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Set (or clear, with '') the married surname of the person with this first name. */
async function setMarried(page: Page, first: string, married: string): Promise<void> {
    await page.evaluate(([f, m]) => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === f);
        if (p) dm.updatePerson(p.id, { marriedSurname: m });
        window.Strom.TreeRenderer.render();
    }, [first, married] as const);
}

/** Jan Novák with his wife Marie (born Dvořáková) and their daughter Bohumila. */
async function family(page: Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novák', { birthDate: '1919' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Dvořáková', 'female');
    await addRelation(page, 'Jan', 'child', 'Bohumila', 'Vondráčková-Šťastná', 'female');
    await setMarried(page, 'Marie', 'Nováková');
    await setMarried(page, 'Bohumila', 'Zelenková-Hrubá');
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
}

async function birthRow(page: Page, first: string): Promise<{ text: string; shown: boolean; cut: boolean }> {
    return card(page, first).locator('.card-birth').evaluate((el) => ({
        text: el.textContent ?? '',
        shown: getComputedStyle(el).display !== 'none',
        cut: el.scrollWidth > el.clientWidth,
    }));
}

test('a normal card shows the married surname with the birth one under it, the card stays 188x64', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);

    const marie = card(page, 'Marie');
    await expect(marie.locator('.name-text')).toHaveAttribute('data-surname', 'Nováková');
    await expect(marie.locator('.name-text')).toHaveAttribute('title', 'Marie Nováková (née Dvořáková)');
    await expect(marie).toHaveAttribute('aria-label', /^Marie Nováková \(née Dvořáková\)/);
    expect(await birthRow(page, 'Marie')).toEqual({ text: 'née Dvořáková', shown: true, cut: false });
    // One name line: no split into given name / surname rows.
    await expect(marie.locator('.name-line')).toHaveCount(0);
    // The initials follow the shown surname.
    await expect(marie.locator('.avatar-initials')).toHaveText('MN');

    // A long double surname: the name on two lines, the birth row shortened with "…".
    const bohumila = card(page, 'Bohumila');
    await expect(bohumila.locator('.name-text')).toHaveAttribute('data-surname', 'Zelenková-Hrubá');
    const long = await birthRow(page, 'Bohumila');
    expect(long.text).toBe('née Vondráčková-Šťastná');
    expect(long.shown).toBe(true);
    expect(long.cut).toBe(true);

    for (const first of ['Marie', 'Bohumila', 'Jan']) {
        const size = await card(page, first).evaluate((n) => ({ w: (n as HTMLElement).offsetWidth, h: (n as HTMLElement).offsetHeight }));
        expect(size).toEqual({ w: 188, h: 64 });
        // Nothing inside the card spills out of it.
        expect(await card(page, first).evaluate((n) => {
            const box = n.getBoundingClientRect();
            return [...n.querySelectorAll<HTMLElement>('.name-text, .card-birth, .birth-date')]
                .filter(el => getComputedStyle(el).display !== 'none')
                .every(el => el.getBoundingClientRect().bottom <= box.bottom + 0.5);
        })).toBe(true);
    }
    // Without a married surname: no birth row at all.
    await expect(card(page, 'Jan').locator('.card-birth')).toHaveCount(0);
});

test('Settings → Surname display switches the cards at once, the compact card has no birth row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);

    await page.evaluate(() => window.Strom.UI.showSettingsDialog());
    const modal = page.locator('#settings-modal');
    await expect(modal.getByRole('radiogroup', { name: 'Surname display' })).toBeVisible();
    const radio = (v: string) => modal.locator(`input[name="surname-display"][value="${v}"]`);
    await expect(radio('both')).toBeChecked();
    await expect(modal.locator('#surname-display-sample')).toHaveText('Marie Nováková (née Dvořáková)');

    await radio('birth').check();
    await expect(card(page, 'Marie').locator('.name-text')).toHaveAttribute('data-surname', 'Dvořáková');
    await expect(card(page, 'Marie').locator('.card-birth')).toHaveCount(0);
    await expect(modal.locator('#surname-display-sample')).toHaveText('Marie Dvořáková');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-settings') ?? '{}').surnameDisplay)).toBe('birth');

    await radio('married').check();
    await expect(card(page, 'Marie').locator('.name-text')).toHaveAttribute('data-surname', 'Nováková');
    await expect(card(page, 'Marie').locator('.card-birth')).toHaveCount(0);
    await expect(card(page, 'Marie').locator('.name-text')).toHaveAttribute('title', 'Marie Nováková');

    // Arrow keys move between the options (a native radio group).
    await radio('married').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(radio('both')).toBeChecked();
    await expect(card(page, 'Marie').locator('.card-birth')).toHaveText('née Dvořáková');
});

test('the compact card never shows the birth row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedSetting(page, 'cardDensity', 'compact');
    await openApp(page);
    await family(page);
    await expect(card(page, 'Marie').locator('.name-text')).toHaveAttribute('data-surname', 'Nováková');
    await expect(card(page, 'Marie').locator('.card-birth')).toHaveCount(0);
});

test('a field card: the birth row under the name does not widen the card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedSetting(page, 'cardDensity', 'custom');
    await openApp(page);
    await family(page);
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    const width = () => page.evaluate(() =>
        (window.Strom.TreeRenderer as unknown as { config: { cardWidth: number } }).config.cardWidth);
    const display = (d: 'birth' | 'both' | 'married') => page.evaluate((v) => window.Strom.UI.setSurnameDisplay(v), d);

    // The row sits inside the card's text column.
    await expect(card(page, 'Marie').locator('.card-birth')).toHaveText('née Dvořáková');
    const box = await card(page, 'Marie').locator('.card-birth').evaluate((el) => {
        const body = el.parentElement as HTMLElement;
        return { row: el.getBoundingClientRect().width, body: body.getBoundingClientRect().width };
    });
    expect(box.row).toBeLessThanOrEqual(box.body + 0.5);

    // The married names alone, and with the birth row under them: one width.
    await display('married');
    await expect(card(page, 'Marie').locator('.card-birth')).toHaveCount(0);
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    const married = await width();
    await display('both');
    await expect(card(page, 'Marie').locator('.card-birth')).toHaveCount(1);
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    await expect.poll(width).toBe(married);

    // Birth surnames shown: the same width as the tree without married surnames.
    await display('birth');
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    const birth = await width();
    await setMarried(page, 'Marie', '');
    await setMarried(page, 'Bohumila', '');
    await display('both');
    await expect.poll(() => cardBoxesMatchLayout(page)).toBe(true);
    await expect.poll(width).toBe(birth);
});

test('search finds a person by either surname and says which one matched when it is not shown', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    const input = page.locator('#toolbar-search-picker .person-picker-input');
    const item = page.locator('#toolbar-search-picker .person-picker-item', { hasText: 'Marie' }).first();
    const match = item.locator('.person-picker-match');

    const expectations: Record<string, Record<string, string | null>> = {
        // display → query → the extra line (null: none)
        both: { novakova: null, dvorakova: null },
        birth: { novakova: 'married name Nováková', dvorakova: null },
        married: { novakova: null, dvorakova: 'née Dvořáková' },
    };
    for (const [display, queries] of Object.entries(expectations)) {
        await page.evaluate((d) => window.Strom.UI.setSurnameDisplay(d as 'birth' | 'both' | 'married'), display);
        for (const [query, extra] of Object.entries(queries)) {
            await input.fill('');
            await input.fill(query);
            await expect(item).toBeVisible();
            if (display === 'both') await expect(item).toContainText('Marie Nováková (née Dvořáková)');
            if (display === 'birth') await expect(item).toContainText('Marie Dvořáková');
            if (display === 'married') await expect(item).toContainText('Marie Nováková');
            if (extra) {
                await expect(match).toHaveText(extra);
                await expect(match.locator('mark')).toHaveCount(1);
            } else {
                await expect(item.locator('.person-picker-match', { hasText: /married name|née/ })).toHaveCount(0);
            }
        }
    }
});

test('Surname spellings: counts stay with birth surnames, a quiet link lists who carries one as a married surname', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await family(page);
    await page.evaluate(() => window.Strom.UI.showSurnamesDialog());
    const modal = page.locator('#surnames-modal');
    // Novák: Jan alone by birth; Marie carries it (its feminine form) as her married surname.
    await expect(modal.locator('.surname-chip[data-surname="Novák"] .surname-chip-count')).toHaveText('1 person');
    const toggle = modal.locator('.surname-married-toggle').first();
    await expect(toggle).toHaveText('also as a married surname: 1 ▾');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const marie = modal.locator('.surname-married-person');
    await expect(marie).toHaveText('Marie Nováková (née Dvořáková)');
    await marie.click();
    await expect(modal).toHaveCount(0);
    await expect(card(page, 'Marie')).toHaveClass(/focused/);
});

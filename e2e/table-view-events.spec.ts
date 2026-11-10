import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * The Table view's Events rows (spec 073 §14.1): the Rows switch gets Events
 * and keeps each type's state; one event of several people is one row; the
 * names of a tree's people are links that open the person; a participant's
 * name offers its filter, a chip "Godparent: {name} ×" that × removes; Edit
 * opens the person dialog on the event, the wedding the relationships panel;
 * a saved Events view. On a phone the type sheet and the participant's sheet.
 */

const godparent = (id: string, who: { personId?: string; name?: string }) => ({ id, role: 'godparent', ...who });

const FAMILY: Record<string, SeedPerson> = {
    a: {
        firstName: 'Radovan', lastName: 'Želvíř', birthDate: '1850-03-01', partners: ['b'],
        events: [{ id: 'ra', type: 'residence', date: '1890', place: 'Horní Lhotka' }],
    },
    b: {
        firstName: 'Ludmila', lastName: 'Krápalová', gender: 'female', birthDate: '1855-07-12', partners: ['a'],
        events: [{ id: 'rb', type: 'residence', date: '1890', place: 'Horní Lhotka' }],
    },
    c: {
        firstName: 'Kvido', lastName: 'Želvíř', birthDate: '1880-01-04', parents: ['a', 'b'],
        events: [{
            id: 'bc', type: 'baptism', date: '1880-01-06', place: 'Horní Lhotka',
            participants: [godparent('g1', { personId: 'g' }), godparent('g2', { name: 'Anežka Pohanková' })],
        }],
    },
    d: {
        firstName: 'Hedvika', lastName: 'Želvířová', gender: 'female', birthDate: '1882-05-08', parents: ['a', 'b'],
        events: [{
            id: 'bd', type: 'baptism', date: '1882-05-10', place: 'Horní Lhotka',
            participants: [godparent('g3', { personId: 'g' })],
        }],
    },
    g: { firstName: 'Bořivoj', lastName: 'Mlýnek', birthDate: '1845-11-20' },
};

/** Five births, the shared residence once, two baptisms, the wedding. */
const ALL = '9 of 9 events';

const row = (page: Page, key: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${key}"]`);
const status = (page: Page) => page.locator('#table-container .tv-status-count');
const col = (page: Page, key: string, i: number) => row(page, key).locator(`[aria-colindex="${i}"]`);
const partChip = (page: Page) => page.locator('#table-container .tv-chips .tv-chip--part');

async function openTable(page: Page, phone = false, family = FAMILY, people = '5 of 5 people', table = 'Table'): Promise<void> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    await seedTree(page, family, 'Želvíř', 'c');
    if (phone) {
        await page.locator('#bb-view-more').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: table }).tap();
    } else {
        await page.locator('#view-mode-table').click();
    }
    await expect(status(page)).toHaveText(people);
}

/** The page never scrolls sideways. */
async function noPageOverflow(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Events segment, one row for a shared event, each type keeps its state', async ({ page }) => {
        await openTable(page);
        const seg = page.locator('#table-container .tv-rowtype [data-rowtype="events"]');
        await expect(seg).toHaveAttribute('aria-label', 'Events, 9');
        await page.locator('#table-container .tv-search-q').fill('Kvido');
        await expect(status(page)).toHaveText('1 of 5 people');

        await seg.click();
        await expect(seg).toHaveAttribute('aria-checked', 'true');
        await expect(status(page)).toHaveText(ALL);
        // The same residence of the couple: one row with both of them, each a link.
        const shared = col(page, 'e:l:a:ra', 2);
        await expect(shared).toHaveClass(/tv-name/);
        await expect(shared.locator('.tv-nm--person')).toHaveText(['Radovan Želvíř', 'Ludmila Krápalová']);
        await expect(row(page, 'e:l:b:rb')).toHaveCount(0);
        // A godparent of the tree is a link; one only written is a plain name (still offering its filter).
        const gods = row(page, 'e:l:c:bc').locator('.tv-nm[aria-haspopup="menu"]');
        await expect(gods).toHaveText(['Bořivoj Mlýnek', 'Anežka Pohanková']);
        await expect(gods.first()).toHaveClass(/tv-nm--person/);
        await expect(gods.last()).not.toHaveClass(/tv-nm--person/);

        await page.locator('#table-container .tv-chips .tv-chip[data-chip="evBirth"]').click();
        await expect(status(page)).toHaveText('7 of 9 events');
        await page.locator('#table-container .tv-rowtype [data-rowtype="persons"]').click();
        await expect(status(page)).toHaveText('1 of 5 people');
        await seg.click();
        await expect(status(page)).toHaveText('7 of 9 events');
    });

    test('a godparent\'s name: filter chip, × removes it; by keyboard too', async ({ page }) => {
        await openTable(page);
        await page.locator('#table-container .tv-rowtype [data-rowtype="events"]').click();
        await expect(status(page)).toHaveText(ALL);

        await row(page, 'e:l:c:bc').locator('.tv-nm', { hasText: 'Bořivoj Mlýnek' }).click();
        const menu = page.locator('.tv-menu');
        await expect(menu.locator('.tv-menu-label')).toHaveText(['Filter: godparent Bořivoj Mlýnek', 'Open person']);
        await menu.locator('.tv-menu-item[data-id="participant"]').click();
        await expect(partChip(page)).toContainText('Godparent: Bořivoj Mlýnek');
        await expect(status(page)).toHaveText('2 of 9 events');
        await partChip(page).locator('.tv-chip-x').click();
        await expect(partChip(page)).toHaveCount(0);
        await expect(status(page)).toHaveText(ALL);

        // A written name: only its filter.
        await row(page, 'e:l:c:bc').locator('.tv-nm', { hasText: 'Anežka Pohanková' }).click();
        await expect(menu.locator('.tv-menu-label')).toHaveText(['Filter: godparent Anežka Pohanková']);
        await page.keyboard.press('Escape');

        // Keyboard: the godparents' cell, Tab into its first name, Enter opens the menu.
        await col(page, 'e:l:c:bc', 3).click();
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
        await expect(col(page, 'e:l:c:bc', 6)).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(col(page, 'e:l:c:bc', 6).locator('.tv-nm').first()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(menu.locator('.tv-menu-label').first()).toHaveText('Filter: godparent Bořivoj Mlýnek');
        await page.keyboard.press('Enter');
        await expect(status(page)).toHaveText('2 of 9 events');
    });

    test('a person\'s link opens the person; Edit opens the event, the wedding the relationships panel', async ({ page }) => {
        await openTable(page);
        await page.locator('#table-container .tv-rowtype [data-rowtype="events"]').click();
        await col(page, 'e:b:g', 2).locator('.tv-nm--person').click();
        await expect(page.locator('#person-page-modal')).toBeVisible();
        await expect(page.locator('#person-page-modal')).toContainText('Bořivoj Mlýnek');
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-page-modal')).toBeHidden();

        // A double click on a person's event: the person dialog, the event's editor on top.
        await col(page, 'e:l:c:bc', 3).dblclick();
        await expect(page.locator('#person-modal')).toBeVisible();
        const editor = page.locator('#event-editor-modal');
        await expect(editor).toHaveClass(/active/);
        await editor.locator('#input-event-place').fill('Dolní Lhotka');
        await editor.locator('.buttons .primary').click();
        await expect(editor).not.toHaveClass(/active/);
        await expect(col(page, 'e:l:c:bc', 4)).toHaveText('Dolní Lhotka');
        await expect(page.locator('.toast').last()).toContainText('Saved: Kvido Želvíř');
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-modal')).toBeHidden();

        // The wedding: the relationships panel (Edit in the row's menu).
        const wedding = page.locator('#table-container .tv-body .tv-row[data-key^="e:w:"]');
        await wedding.locator('[aria-colindex="3"]').click({ button: 'right' });
        await page.locator('.tv-menu .tv-menu-item[data-id="edit"]').click();
        await expect(page.locator('#relationships-modal')).toBeVisible();
    });

    test('an Events view saved as new opens on Events', async ({ page }) => {
        await openTable(page);
        await page.locator('#table-container .tv-rowtype [data-rowtype="events"]').click();
        await page.locator('#table-container .tv-chips .tv-chip[data-chip="evOther"]').click();
        await expect(status(page)).toHaveText('1 of 9 events');
        await page.locator('#table-container .tv-view-saveas').click();
        const input = page.locator('.tv-fpanel.tv-vpanel .tv-vname-input');
        await input.fill('Household');
        await input.press('Enter');
        await expect(page.locator('#table-container .tv-view-name')).toHaveText('Household');

        await page.locator('#table-container .tv-rowtype [data-rowtype="persons"]').click();
        await expect(status(page)).toHaveText('5 of 5 people');
        await page.locator('#table-container .tv-view-btn').click();
        const item = page.locator('.tv-menu .tv-menu-item', { hasText: 'Household' });
        await expect(item.locator('.tv-menu-hint')).toHaveText('events');
        await item.click();
        await expect(page.locator('#table-container .tv-rowtype [data-rowtype="events"]')).toHaveAttribute('aria-checked', 'true');
        await expect(status(page)).toHaveText('1 of 9 events');
    });
});

test.describe('desktop in German (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });

    test('four row types, a changed view with its buttons, search, Columns and Export stay in one row', async ({ page }) => {
        await openTable(page, false, FAMILY, '5 von 5 Personen');
        await page.locator('#table-container .tv-rowtype [data-rowtype="events"]').click();
        await page.locator('#table-container .tv-chips .tv-chip[data-chip="evOther"]').click();
        await expect(page.locator('#table-container .tv-view-saveas')).toBeVisible();
        await expect(page.locator('#table-container .tv-view-discard')).toBeVisible();
        const bar = (await page.locator('#table-container .tv-bar-row1').boundingBox())!;
        const exp = (await page.locator('#table-container .tv-export-btn').boundingBox())!;
        const seg = (await page.locator('#table-container .tv-rowtype').boundingBox())!;
        expect(Math.abs((exp.y + exp.height / 2) - (seg.y + seg.height / 2))).toBeLessThan(2);
        expect(bar.height).toBeLessThanOrEqual(53);
        // The search gave way, not below its 160 px.
        expect((await page.locator('#table-container .tv-search-q').boundingBox())!.width).toBeGreaterThanOrEqual(159);
        await noPageOverflow(page);
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('Events from the type sheet; a godparent\'s sheet sets the filter; nothing overflows', async ({ page }) => {
        await openTable(page, true);
        await page.locator('#table-container .tv-rowtype-btn').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await sheet.locator('.bottom-sheet-item', { hasText: 'Events' }).tap();
        await expect(page.locator('#table-container .tv-rowtype-btn')).toHaveText('Events · 9 ▾');
        await expect(status(page)).toHaveText(ALL);

        await row(page, 'e:l:c:bc').locator('.tv-nm', { hasText: 'Bořivoj Mlýnek' }).tap();
        await expect(sheet).toBeVisible();
        const items = sheet.locator('.bottom-sheet-item');
        await expect(items.locator('.bottom-sheet-label')).toHaveText(['Filter: godparent Bořivoj Mlýnek', 'Open person']);
        expect((await items.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await items.first().tap();
        await expect(status(page)).toHaveText('2 of 9 events');

        // The filter sheet lists it with its ×.
        await page.locator('#table-container .tv-filters-btn').tap();
        const part = page.locator('.tv-fs-part');
        await expect(part).toContainText('Godparent: Bořivoj Mlýnek');
        await part.locator('[data-xchip]').tap();
        await expect(status(page)).toHaveText(ALL);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});

test.describe('phone, a long name (390)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a name too long for its cell ends in "…" inside the cell', async ({ page }) => {
        const family = { ...FAMILY, x: { firstName: 'Bartoloměj Kvido Radovan', lastName: 'Želvíř-Krápal', birthDate: '1884-02-02', parents: ['a', 'b'] } };
        await openTable(page, true, family, '6 of 6 people');
        await page.locator('#table-container .tv-rowtype-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Events' }).tap();
        const cell = col(page, 'e:b:x', 2);
        const name = cell.locator('.tv-nm--person');
        await expect(name).toHaveText('Bartoloměj Kvido Radovan Želvíř-Krápal');
        const fit = await name.evaluate((el) => {
            const cellBox = el.closest('.tv-cell')!.getBoundingClientRect();
            return {
                cut: el.scrollWidth > el.clientWidth, ellipsis: getComputedStyle(el).textOverflow,
                inside: el.getBoundingClientRect().right <= cellBox.right + 0.5,
            };
        });
        expect(fit).toEqual({ cut: true, ellipsis: 'ellipsis', inside: true });
        await noPageOverflow(page);
    });
});

test.describe('phone held sideways (844 × 390)', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('Events in the one-row bar; the godparent\'s filter in the Filters sheet; nothing overflows', async ({ page }) => {
        await openTable(page, true);
        await page.locator('#table-container .tv-rowtype-btn').tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item', { hasText: 'Events' }).tap();
        const btn = page.locator('#table-container .tv-rowtype-btn');
        await expect(btn).toHaveText('Events · 9 ▾');
        const bar = (await page.locator('#table-container .tv-bar-row1').boundingBox())!;
        expect(Math.round(bar.height)).toBe(50);
        for (const sel of ['.tv-rowtype-btn', '.tv-view-btn', '.tv-search-q', '.tv-filters-btn', '.tv-more-menu-btn']) {
            const b = (await page.locator(`#table-container ${sel}`).boundingBox())!;
            expect(b.y + b.height, sel).toBeLessThanOrEqual(bar.y + bar.height);
        }

        await row(page, 'e:l:c:bc').locator('.tv-nm', { hasText: 'Bořivoj Mlýnek' }).tap();
        await page.locator('.bottom-sheet-menu .bottom-sheet-item').first().tap();
        await expect(status(page)).toHaveText('2 of 9 events');
        await page.locator('#table-container .tv-filters-btn').tap();
        const part = page.locator('.tv-fs-part');
        await part.scrollIntoViewIfNeeded();
        await expect(part).toContainText('Godparent: Bořivoj Mlýnek');
        const box = (await part.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(844);
        await noPageOverflow(page);
    });
});

import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, FakeBridge } from './research-bridge.js';

/**
 * "Research for this tree › Books" (spec 105 §4): the research's two settings
 * of its books from `/status.books.settings` (the light status's part `books`),
 * written through the bridge (`POST /books`), "(default)" and "Restore
 * default", a number checked before it goes, a change in the terminal shown in
 * the open dialog but never under the field being typed in, refusals and the
 * bridge down. Without `books` in the features: no group. A fake bridge.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const FEATURES = ['status.parts', 'books'];

function booksStatus(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        settings: { minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no', sameBookOwn: false, sameBookDefault: 'no', ...over },
        list: [], more: 0,
    };
}

async function setup(page: Page, opts: { features?: string[] } = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, {
        features: opts.features ?? FEATURES,
        links: ['send', 'open', 'live', 'app', 'setup', 'book'],
        books: { books: booksStatus(), posts: [] },
    });
    await openResearch(page);
    await poll(page);
    return b;
}

async function openSettings(page: Page, group?: 'books'): Promise<void> {
    await page.evaluate((g) => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!, g ? { group: g } : {}), group);
    await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
}

const group = (page: Page) => page.locator('#research-books-group');
const field = (page: Page) => page.locator('#research-books-min');
const note = (page: Page) => page.locator('#research-books-note');

test.describe('Research for this tree › Books', () => {
    test.use({ viewport: DESKTOP });

    test('without the feature: no group', async ({ page }) => {
        await setup(page, { features: ['status.parts'] });
        await openSettings(page);
        await expect(page.locator('#research-readtask-host')).toBeAttached();
        await expect(group(page)).toHaveCount(0);
    });

    test('the defaults from the light status; a number written on Enter, confirmed, and back to the default', async ({ page }) => {
        const b = await setup(page);
        await poll(page);
        expect(b.statusAsks).toContain('parts');
        expect(b.partReads).toContain('books');
        await openSettings(page);
        await expect(group(page)).not.toHaveAttribute('open', '');
        await expect(group(page).locator('.research-group-value-full')).toHaveText('from 5 tasks · no preference');
        await group(page).locator('summary').click();
        await expect(field(page)).toHaveValue('5');
        await expect(page.locator('#research-books .research-transcripts-default')).toHaveCount(2);
        await expect(page.locator('#research-books-min-reset')).toHaveCount(0);
        await field(page).fill('8');
        await field(page).press('Enter');
        await expect(note(page)).toHaveText(/The research confirmed\./);
        expect(b.books!.posts).toEqual([{ minTasks: 8 }]);
        await expect(field(page)).toHaveValue('8');
        await expect(page.locator('#research-books-min-reset')).toHaveText('Restore default (5)');
        await expect(page.locator('#research-books .research-transcripts-default')).toHaveCount(1);
        await page.locator('#research-books-min-reset').click();
        await expect(page.locator('#research-books-min-reset')).toHaveCount(0);
        expect(b.books!.posts).toEqual([{ minTasks: 8 }, { minTasks: 'default' }]);
        await expect(field(page)).toHaveValue('5');
        await expect(page.locator('#research-books .research-transcripts-default')).toHaveCount(2);
        // The downloaded book first: the switch, its own value and its reset.
        await page.locator('label.research-books-same').click();
        await expect(page.locator('#research-books-same-reset')).toHaveText('Restore default (no)');
        expect(b.books!.posts.at(-1)).toEqual({ sameBook: 'yes' });
        await poll(page);
        await group(page).locator('summary').click();
        await expect(group(page).locator('.research-group-value-full')).toHaveText('from 5 tasks · downloaded first');
    });

    test('a number outside 1–999 is said and not sent; an empty field takes the research\'s value back', async ({ page }) => {
        const b = await setup(page);
        await openSettings(page, 'books');
        await expect(group(page)).toHaveAttribute('open', '');
        await expect(field(page)).toBeFocused();
        await field(page).fill('0');
        await field(page).press('Enter');
        await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#research-books-invalid')).toHaveText('A whole number from 1 to 999.');
        await expect(field(page)).toBeFocused();
        await field(page).fill('1000');
        await field(page).press('Enter');
        await expect(page.locator('#research-books-invalid')).toBeVisible();
        await field(page).fill('');
        await field(page).blur();
        await expect(field(page)).toHaveValue('5');
        await expect(page.locator('#research-books-invalid')).toHaveCount(0);
        expect(b.books!.posts).toEqual([]);
    });

    test('a change in the terminal shows in the open dialog, not under the focused field until it is left', async ({ page }) => {
        const b = await setup(page);
        await openSettings(page, 'books');
        await expect(group(page)).toHaveClass(/is-flash/);
        await expect(group(page)).not.toHaveClass(/is-flash/);
        b.books!.books = booksStatus({ minTasks: 12, minTasksOwn: true });
        await expect(field(page)).toBeFocused();
        await poll(page);
        await expect(field(page)).toHaveValue('5');
        await page.locator('#research-books-group summary').focus();
        await expect(field(page)).toHaveValue('12');
        await expect(page.locator('#research-books-min-reset')).toHaveText('Restore default (5)');
        b.books!.books = booksStatus({ sameBook: 'yes', sameBookOwn: true });
        await poll(page);
        await expect(field(page)).toHaveValue('5');
        await expect(page.locator('#research-books-same')).toBeChecked();
        expect(b.books!.posts).toEqual([]);
    });

    test('busy: said with Try again; an archive: the group goes; the bridge down: dimmed', async ({ page }) => {
        const b = await setup(page);
        b.books!.reply = { status: 503, body: { code: 'research.busy', error: 'busy' } };
        await openSettings(page, 'books');
        await page.locator('label.research-books-same').click();
        await expect(note(page)).toContainText('The research is busy right now; nothing changed.');
        await expect(page.locator('#research-books-same')).not.toBeChecked();
        delete b.books!.reply;
        await page.locator('#research-books-retry').click();
        await expect(note(page)).toHaveText(/The research confirmed\./);
        await expect(page.locator('#research-books-same')).toBeChecked();
        expect(b.books!.posts).toEqual([{ sameBook: 'yes' }, { sameBook: 'yes' }]);
        b.books!.reply = { status: 423, body: { code: 'locked' } };
        await field(page).fill('7');
        await field(page).press('Enter');
        await expect(note(page)).toHaveText('Not recorded: another session holds the tree in the research.');
        await expect(field(page)).toHaveValue('5');
        b.books!.reply = { status: 409, body: { code: 'directions.archive', error: 'The tree is an archive.' } };
        await field(page).fill('9');
        await field(page).press('Enter');
        await expect(group(page)).toHaveCount(0);
        // The research not running: said when the dialog opens.
        delete b.books!.reply;
        b.down = true;
        await poll(page);
        await openSettings(page, 'books');
        await expect(page.locator('#research-books')).toHaveClass(/is-down/);
        await expect(note(page)).toHaveText("The research isn't running. This can be changed once it runs.");
        await expect(field(page)).toBeDisabled();
        await expect(page.locator('#research-books-same')).toBeDisabled();
    });
});

test.describe('Research for this tree › Books on a phone', () => {
    test.use({ viewport: PHONE });

    test('the short summary; the number under its text, nothing wider than the dialog', async ({ page }) => {
        await setup(page);
        await openSettings(page);
        await expect(group(page).locator('.research-group-value-short')).toHaveText('from 5');
        await expect(group(page).locator('.research-group-value-full')).toBeHidden();
        await group(page).locator('summary').click();
        const row = page.locator('.research-books-row');
        await expect(row).toHaveCSS('flex-direction', 'column');
        const box = (await field(page).boundingBox())!;
        const text = (await row.locator('.settings-text').boundingBox())!;
        expect(box.y).toBeGreaterThan(text.y + text.height - 1);
        const fits = await page.evaluate(() => {
            const m = document.querySelector('#research-tree-settings-modal .modal')!.getBoundingClientRect();
            return [...document.querySelectorAll('#research-books *')].every(el => el.getBoundingClientRect().right <= m.right + 0.5);
        });
        expect(fits).toBe(true);
    });
});

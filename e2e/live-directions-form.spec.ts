import { test, expect, Page } from '@playwright/test';
import {
    BridgeReply, CAPS, MANAGED_DIRECTIONS, directionRow, directionWrites, followManaged, launchedLinks, openOverview, overview, UUID,
} from './live-directions-bridge.js';
import { card, openPersonSubmenu } from './helpers.js';

/**
 * The direction form through the research's bridge (spec 038 §2, §3.1) and
 * the person's research items (§2.9, §5.1): create from "+ New direction"
 * (the person picked, the name filled in, limits, the write, the new
 * direction last and lit, the toast with "Work on this direction"), a
 * question needs its question, a direction there already (running: Show it;
 * paused: Restart; the research's 409), a busy research said in the form,
 * an edit (person and kind locked, only what changed written, Undo), the
 * person menu opening the form without a mark, and "In direction".
 */

const form = (page: Page) => page.locator('#direction-form-modal');
const BUSY: BridgeReply = { status: 503, body: { error: 'research.busy' }, headers: { 'Retry-After': '3' } };

async function openNew(page: Page): Promise<void> {
    await overview(page).locator('.research-directions__new').click();
    await expect(form(page)).toBeVisible();
}

async function pick(page: Page, query: string, name: string): Promise<void> {
    await form(page).locator('#direction-form-search').fill(query);
    await form(page).locator('.direction-form__pick', { hasText: name }).click();
}

test.describe('the direction form', () => {
    test('create: person picked, name filled in, limits, written once, last and lit, a toast to work on it', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        await openNew(page);
        const f = form(page);
        // The dialog's rules: a form of the md width, its ×, Cancel right before the one primary.
        await expect(f.locator('.modal')).toHaveClass(/modal--md/);
        await expect(f.locator('.modal')).toHaveAttribute('data-dialog-kind', 'form');
        await expect(f.locator('h2')).toHaveText('New direction');
        await expect(f.locator('.audit-log-subtitle')).toHaveText('Fíškovi');
        await expect(f.locator('#direction-form-search')).toBeFocused();
        await expect(f.locator('.direction-form__kind')).toHaveText(['↑Ancestors', '↓Descendants', '?Question']);
        await expect(f.locator('.direction-form__kind[aria-checked="true"]')).toHaveText('↑Ancestors');
        await expect(f.locator('#direction-form-submit')).toHaveAttribute('aria-disabled', 'true');
        // Nobody of that name: a sentence, not a group head.
        await f.locator('#direction-form-search').fill('Zzyzx');
        await expect(f.locator('.direction-form__pick-none')).toHaveText('No person of that name.');
        await expect(f.locator('.direction-form__pick-head')).toHaveCount(0);
        // Search ignores the diacritics.
        await pick(page, 'fiskova', 'Marie Fíšková');
        await expect(f.locator('.direction-form__who-name')).toHaveText('Marie Fíšková');
        await expect(f.locator('#direction-form-name')).toHaveValue('Ancestors: Marie Fíšková');
        await expect(f.locator('.direction-form__name-hint')).toHaveText('Filled in from the kind and person until changed.');
        await expect(f.locator('.direction-form__dup')).toBeHidden();
        // Limit…: folded, it says what is set.
        await f.locator('.direction-form__disclosure').click();
        await f.locator('#direction-form-generations').selectOption('6');
        await f.locator('#direction-form-before').fill('1800');
        await f.locator('#direction-form-known').fill('narozena ve Smrkově');
        await f.locator('.direction-form__disclosure').click();
        await expect(f.locator('.direction-form__limit-sum')).toHaveText('up to 6 generations · before 1800');
        await expect(f.locator('.direction-form__free')).toContainText('Creating it costs nothing.');
        // A backdrop click keeps the form.
        await page.mouse.click(5, 5);
        await expect(f).toBeVisible();
        await f.locator('#direction-form-submit').click();
        await expect.poll(() => directionWrites(b).map(w => [w.path, w.body])).toEqual([['directions', {
            person: 'P0050', direction: 'ancestors', name: 'Ancestors: Marie Fíšková',
            limits: { generations: 6, before: 1800 }, note: 'narozena ve Smrkově',
        }]]);
        await expect(f).toHaveCount(0);
        const row = directionRow(page, 'G0014');
        await expect(overview(page).locator('.research-direction--managed .research-direction__name').last()).toHaveText('Ancestors: Marie Fíšková');
        await expect(row).toHaveClass(/is-new/);
        await expect(row).not.toHaveClass(/is-new/, { timeout: 4000 });
        const toast = page.locator('.toast[data-kind="direction"]');
        await expect(toast).toContainText('Direction created · at the end of the order');
        // "Work on this direction": AI and the terminal's mark.
        await expect(toast.locator('.toast-action .research-ai-badge')).toHaveCount(1);
        await expect(toast.locator('.toast-action .research-open-mark')).toHaveCount(1);
        await toast.locator('.toast-action').click();
        expect(await launchedLinks(page)).toEqual([`strom-research://chat?tree=${UUID}&research=G0014`]);
    });

    test('a question: needs its question (said after a try), the name from its first six words', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        await openNew(page);
        const f = form(page);
        await pick(page, 'Marie', 'Marie Fíšková');
        await f.locator('.direction-form__kind[data-kind="question"]').click();
        await expect(f.locator('label[for="direction-form-question"]')).toHaveText('Question · required');
        await expect(f.locator('#direction-form-name')).toHaveValue('Question: Marie Fíšková');
        await expect(f.locator('#direction-form-question-error')).toBeHidden();
        // aria-disabled, not disabled: a try still says what is missing.
        await f.locator('#direction-form-submit').click({ force: true });
        await expect(f.locator('#direction-form-question-error')).toHaveText('A question direction needs a question.');
        await expect(f.locator('#direction-form-question')).toBeFocused();
        expect(directionWrites(b)).toEqual([]);
        await f.locator('#direction-form-question').fill('Kdo byl kmotr Marie při křtu ve Smrkově roku 1871?');
        await expect(f.locator('#direction-form-name')).toHaveValue('Kdo byl kmotr Marie při křtu…');
        // The year field stays for a question; descendants have none.
        await f.locator('.direction-form__disclosure').click();
        await expect(f.locator('#direction-form-before')).toBeVisible();
        await f.locator('.direction-form__kind[data-kind="descendants"]').click();
        await expect(f.locator('#direction-form-before')).toBeHidden();
        await f.locator('.direction-form__kind[data-kind="question"]').click();
        // A year it does not take: said at the field, nothing written.
        await f.locator('#direction-form-before').fill('180');
        await f.locator('#direction-form-submit').click();
        await expect(f.locator('#direction-form-before-error')).toHaveText('A year between 1000 and 2100.');
        expect(directionWrites(b)).toEqual([]);
        await f.locator('#direction-form-before').fill('');
        await f.locator('#direction-form-submit').click();
        await expect.poll(() => directionWrites(b).map(w => w.body)).toEqual([{
            person: 'P0050', direction: 'question', name: 'Kdo byl kmotr Marie při křtu…',
            question: 'Kdo byl kmotr Marie při křtu ve Smrkově roku 1871?',
        }]);
    });

    test('there already: running → Show it; paused → Restart through the bridge; the research\'s 409', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        await openNew(page);
        const f = form(page);
        await pick(page, 'Jan', 'Jan Fíšek');
        const dup = f.locator('.direction-form__dup');
        await expect(dup).toHaveText('The direction Předci: Jan Fíšek is already running.');
        await expect(dup).toHaveAttribute('role', 'status');
        await expect(f.locator('#direction-form-submit')).toHaveText('Show it');
        await f.locator('#direction-form-submit').click();
        await expect(f).toHaveCount(0);
        await expect(directionRow(page, 'G0001')).toHaveClass(/is-open/);
        expect(directionWrites(b)).toEqual([]);

        await openNew(page);
        await pick(page, 'Anna', 'Anna Svobodová');
        await expect(dup).toContainText('The direction Předci: Anna Svobodová is paused.');
        await expect(dup.locator('.direction-form__dup-sub')).toContainText('“matriky ještě nejsou online”');
        await expect(dup.locator('.direction-form__show')).toHaveText('Show it');
        await expect(f.locator('#direction-form-submit')).toHaveText('Restart');
        await f.locator('#direction-form-submit').click();
        await expect.poll(() => directionWrites(b).map(w => [w.path, w.body])).toEqual([['directions/G0004/state', { do: 'resume' }]]);
        await expect(page.locator('.toast[data-kind="direction"]')).toContainText('Restarted');
        expect(await launchedLinks(page)).toEqual([]);

        // The research knows of one the panel does not show yet.
        b.replies.push({ status: 409, body: { error: 'directions.exists', existing: { id: 'G0031', name: 'Potomci: Marie Fíšková', state: 'active' } } });
        await openNew(page);
        await pick(page, 'Marie', 'Marie Fíšková');
        await f.locator('.direction-form__kind[data-kind="descendants"]').click();
        await f.locator('#direction-form-submit').click();
        await expect(dup).toHaveText('The direction Potomci: Marie Fíšková is already running.');
        await expect(f.locator('#direction-form-submit')).toHaveText('Show it');
        await expect(f.locator('.direction-form__problem')).toBeHidden();
    });

    test('busy: tried once more after 3 s, then said in the form with Try again; a refusal in the research\'s words', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        await openNew(page);
        const f = form(page);
        await pick(page, 'Marie', 'Marie Fíšková');
        b.replies.push(BUSY, BUSY);
        await f.locator('#direction-form-submit').click();
        await expect(f.locator('#direction-form-submit')).toHaveText('Creating…');
        await expect(f.locator('.modal')).toHaveClass(/is-sending/);
        await expect.poll(() => directionWrites(b).length, { timeout: 8000 }).toBe(2);
        const box = f.locator('.direction-form__problem');
        await expect(box).toContainText('Not saved, the research is busy.');
        await expect(box).toHaveAttribute('role', 'alert');
        await expect(page.locator('.toast[data-kind="direction"]')).toHaveCount(0);
        b.replies.push({ status: 400, body: { error: 'directions.body', text: 'Osoba ve výzkumu chybí.' } });
        await box.locator('.direction-form__retry').click();
        await expect(box).toHaveText('The research did not create the direction: “Osoba ve výzkumu chybí.”');
        await expect(box.locator('.direction-form__retry')).toHaveCount(0);
        await expect(f).toBeVisible();
        await f.locator('#direction-form-submit').click();
        await expect(f).toHaveCount(0);
        await expect(directionRow(page, 'G0014')).toBeVisible();
    });

    test('edit: person and kind locked, only what changed written, Saved with Undo; Esc and focus back', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        const more = directionRow(page, 'G0002').locator('.research-direction__more');
        await more.click();
        await page.locator('#live-direction-menu [data-do="edit"]').click();
        const f = form(page);
        await expect(f.locator('h2')).toHaveText('Edit direction');
        await expect(f.locator('.audit-log-subtitle')).toHaveText('Potomci: Josef Fíšek');
        await expect(f.locator('.direction-form__chosen')).toHaveClass(/is-locked/);
        await expect(f.locator('.direction-form__who-locked')).toHaveText('cannot change');
        await expect(f.locator('.direction-form__kind[data-kind="ancestors"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(f.locator('.direction-form__kind-hint')).toHaveText('Kind and person cannot change. Another person means a new direction.');
        await expect(f.locator('#direction-form-name')).toBeFocused();
        await expect(f.locator('#direction-form-name')).toHaveValue('Potomci: Josef Fíšek');
        // A limit set: Limit… open; descendants have no year; nothing known is asked in an edit.
        await expect(f.locator('.direction-form__disclosure')).toHaveAttribute('aria-expanded', 'true');
        await expect(f.locator('#direction-form-before')).toBeHidden();
        await expect(f.locator('#direction-form-known')).toHaveCount(0);
        await expect(f.locator('#direction-form-submit')).toHaveText('Save');
        await f.locator('#direction-form-generations').selectOption('4');
        await f.locator('#direction-form-submit').click();
        await expect.poll(() => directionWrites(b).map(w => [w.path, w.body])).toEqual([['directions/G0002', { limits: { generations: 4 } }]]);
        await expect(f).toHaveCount(0);
        await expect(directionRow(page, 'G0002').locator('.research-direction__meta')).toContainText('up to 4 generations');
        const toast = page.locator('.toast[data-kind="direction"]');
        await expect(toast).toContainText('Saved');
        await toast.locator('.toast-action').click();
        await expect.poll(() => directionWrites(b).length).toBe(2);
        expect(directionWrites(b)[1]).toMatchObject({ path: 'directions/G0002', body: { limits: { generations: null } } });

        // The research's sentence about tasks moved stands instead of Saved.
        await more.click();
        await page.locator('#live-direction-menu [data-do="edit"]').click();
        await f.locator('#direction-form-name').fill('Potomci Josefa');
        b.replies.push({ status: 200, body: { direction: { id: 'G0002', name: 'Potomci Josefa', state: 'active', direction: 'descendants', focus: 'P0001' },
            effect: { said: '2 úkoly jsou teď mimo linii.', outside: 2 } } });
        await page.keyboard.press('Enter');
        await expect(toast).toContainText('2 úkoly jsou teď mimo linii.');

        // Its Undo refused: an alert toast (8 s, no action) with the research's sentence.
        b.replies.push({ status: 409, body: { error: 'directions.state', text: 'Linie má rozdělaný zápis.' } });
        await toast.locator('.toast-action').click();
        await expect(toast).toHaveText('Undo failed, the change stays. · “Linie má rozdělaný zápis.”');
        await expect(toast).toHaveAttribute('role', 'alert');
        await expect(toast.locator('.toast-action')).toHaveCount(0);

        // Esc closes and focus goes back to the control it came from.
        await more.click();
        await page.locator('#live-direction-menu [data-do="edit"]').click();
        await expect(f).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(f).toHaveCount(0);
        await expect(overview(page)).toBeVisible();
        await expect(more).toBeFocused();
    });

    test('a paused direction\'s edit asks its reason', async ({ page }) => {
        const b = await followManaged(page);
        await openOverview(page);
        await directionRow(page, 'G0004').locator('.research-direction__more').click();
        await page.locator('#live-direction-menu [data-do="edit"]').click();
        const f = form(page);
        await expect(f.locator('label[for="direction-form-reason"]')).toHaveText('Reason for the pause (optional)');
        await expect(f.locator('#direction-form-reason')).toHaveValue('matriky ještě nejsou online');
        await f.locator('#direction-form-reason').fill('čeká se na sken matrik');
        await f.locator('#direction-form-submit').click();
        await expect.poll(() => directionWrites(b).map(w => w.body)).toEqual([{ reason: 'čeká se na sken matrik' }]);
    });
});

test.describe('the person\'s research items with a research that manages its directions', () => {
    test('Find ancestors / descendants open the form without a mark; a paused one restarts through the bridge', async ({ page }) => {
        const b = await followManaged(page);
        await card(page, 'Josef').click();
        const sub = await openPersonSubmenu(page, 'research');
        const anc = sub.locator('[data-action="research-ancestors"]');
        await expect(anc.locator('.research-open-mark')).toHaveCount(0);
        await expect(anc.locator('.research-ai-badge')).toHaveCount(0);
        await anc.click();
        const f = form(page);
        await expect(f.locator('.direction-form__who-name')).toHaveText('Josef Fíšek');
        await expect(f.locator('.direction-form__kind[aria-checked="true"]')).toHaveText('↑Ancestors');
        await expect(f.locator('#direction-form-name')).toHaveValue('Ancestors: Josef Fíšek');
        await f.locator('[data-dismiss]').click();
        await expect(f).toHaveCount(0);

        await card(page, 'Anna').click();
        const sub2 = await openPersonSubmenu(page, 'research');
        const anna = sub2.locator('[data-action="research-ancestors"]');
        await expect(anna.locator('.menu-item-note')).toHaveText('Paused · restart');
        await expect(anna.locator('.research-open-mark')).toHaveCount(0);
        await anna.click();
        await expect.poll(() => directionWrites(b).map(w => [w.path, w.body])).toEqual([['directions/G0004/state', { do: 'resume' }]]);
        expect(await launchedLinks(page)).toEqual([]);
    });

    test('an older research: the items open the terminal with its mark, as before', async ({ page }) => {
        await followManaged(page, { caps: null });
        await card(page, 'Josef').click();
        const sub = await openPersonSubmenu(page, 'research');
        const anc = sub.locator('[data-action="research-ancestors"]');
        await expect(anc.locator('.research-open-mark')).toHaveCount(1);
        await anc.click();
        await expect(form(page)).toHaveCount(0);
        expect(await launchedLinks(page)).toEqual([`strom-research://research?tree=${UUID}&person=P0001&direction=ancestors`]);
    });

    test('In direction: on top of Research › and in the person detail, opening the overview on it', async ({ page }) => {
        const b = await followManaged(page, { features: ['directions.people'] });
        await expect.poll(() => b.writes.filter(w => w.method === 'GET').length).toBeGreaterThan(0);
        await card(page, 'Jan').click();
        const sub = await openPersonSubmenu(page, 'research');
        await expect(sub.locator('.menu-section-header').first()).toHaveText('In direction');
        const line = sub.locator('[data-action="research-in-line:G0001"]');
        await expect(line.locator('.menu-item-glyph')).toHaveText('↑');
        await expect(line.locator('.menu-item-line')).toHaveText('Předci: Jan Fíšek');
        await expect(line.locator('.menu-item-state')).toHaveText('in progress');
        await expect(line.locator('.research-open-mark')).toHaveCount(0);
        await line.click();
        await expect(directionRow(page, 'G0001')).toHaveClass(/is-open/);
        await page.keyboard.press('Escape');
    });

    test('In direction: more than two, two named and "and 1 more"', async ({ page }) => {
        const b = await followManaged(page, {
            features: ['directions.people'],
            researches: [
                ...MANAGED_DIRECTIONS,
                { id: 'G0021', name: 'Otázka: Jan Fíšek', state: 'active', direction: 'question', focus: 'P0012', question: 'Kdo byl kmotr?' },
                { id: 'G0022', name: 'Potomci: Jan Fíšek', state: 'paused', direction: 'descendants', focus: 'P0012' },
            ],
        });
        await expect.poll(() => b.writes.filter(w => w.method === 'GET').length).toBeGreaterThan(0);
        await card(page, 'Jan').click();
        const sub = await openPersonSubmenu(page, 'research');
        await expect(sub.locator('.menu-section-header').first()).toHaveText('In directions');
        await expect(sub.locator('[data-action^="research-in-line"] .menu-item-label'))
            .toHaveText(['Předci: Jan Fíšek', 'Otázka: Jan Fíšek', 'and 1 more']);
    });

    test('In direction in the person detail', async ({ page }) => {
        const b = await followManaged(page, { features: ['directions.people'], caps: { ...CAPS } });
        await expect.poll(() => b.writes.filter(w => w.method === 'GET').length).toBeGreaterThan(0);
        await card(page, 'Jan').click();
        await page.locator('.context-menu [data-action="edit"], .context-menu [data-action="view"]').first().click();
        const row = page.locator('#pm-in-line');
        await expect(row).toBeVisible();
        await expect(row.locator('.pm-in-line-label')).toHaveText('In direction');
        await expect(row.locator('.pm-in-line-link')).toHaveText('↑Předci: Jan Fíšek');
        await expect(row.locator('.pm-in-line-working')).toHaveText('in progress');
        await row.locator('.pm-in-line-link').click();
        await expect(directionRow(page, 'G0001')).toHaveClass(/is-open/);
    });
});

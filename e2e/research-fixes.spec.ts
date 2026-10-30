import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakeFixes, fakePhone, openResearch, openResearchMenu, poll, links, FakeBridge, FakeFixes, UUID } from './research-bridge.js';

/**
 * Tree fixes of the research: the bridge lists the bulk data fixes it can apply
 * (`GET /fixes`, feature `fixes.list`, link `fixes`); the Research menu's
 * "Other actions" carries "Tree fixes" with the count of the available ones,
 * its dialog lists them and each one opens in the research's terminal
 * (`strom-research://fixes?tree=…&id=…`, an undo with `&do=undo`). The app
 * runs nothing itself. Invented fixes.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup', 'fixes'];

const FIXES: Record<string, unknown>[] = [
    { id: 'places-normalize', title: { en: 'Place names in one form', cs: 'Názvy míst v jednom tvaru' },
        summary: { en: 'Writes each place the same way.' }, unit: 'place', count: 23, state: 'pending', undoable: false, paid: false },
    { id: 'sex-from-name', title: { en: 'Sex from the first name' }, summary: { en: 'Fills in the sex where the name says it.' },
        unit: 'person', count: 4, state: 'pending', undoable: false, paid: true },
    { id: 'participant-names', title: { en: 'Names of godparents' }, summary: { en: 'Splits names of godparents.' },
        unit: 'participant', count: 0, state: 'fixed', undoable: true, at: '2026-10-28T15:40:02.000Z', paid: false },
    { id: 'street-places', title: { en: 'Streets in places' }, summary: { en: 'Moves streets out of place names.' },
        unit: 'fact', count: 0, state: 'declined', undoable: false, at: '2026-10-20T09:12:44.000Z', paid: false },
    { id: 'nothing-here', title: { en: 'Nothing to do' }, summary: { en: '…' }, unit: 'item', count: 0, state: 'nothing', undoable: false, paid: false },
];

async function research(page: Page, init: { features?: string[]; links?: string[]; fixes?: Partial<FakeFixes>; more?: Partial<FakeBridge> } = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, {
        features: init.features ?? ['fixes.list'],
        links: init.links ?? LINKS,
        fixes: fakeFixes({ fixes: FIXES, ...init.fixes }),
        ...init.more,
    });
    await openResearch(page);
    await poll(page);
    return b;
}

const item = (page: Page): Locator => page.locator('#research-item-fixes');
const modal = (page: Page): Locator => page.locator('#research-fixes-modal');
const row = (page: Page, id: string): Locator => modal(page).locator(`.research-fix[data-fix="${id}"]`);

async function openFixes(page: Page): Promise<void> {
    await openResearchMenu(page, { expandMore: true });
    await item(page).click();
    await expect(modal(page)).toBeVisible();
}

test.describe('tree fixes of the research', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('no item without the link "fixes"', async ({ page }) => {
        const b = await research(page, { links: ['send', 'open', 'live', 'app', 'setup'] });
        await expect.poll(() => b.fixes!.asks).toBe(1);
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-menu')).toBeVisible();
        await expect(item(page)).toHaveCount(0);
    });

    test('no item without the feature "fixes.list"; the list is not asked', async ({ page }) => {
        const b = await research(page, { features: [] });
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-menu')).toBeVisible();
        await expect(item(page)).toHaveCount(0);
        expect(b.fixes!.asks).toBe(0);
    });

    test('the item counts the available fixes; the dialog lists them by state, nothing to do left out', async ({ page }) => {
        await research(page);
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page).locator('.research-item-label')).toHaveText('Tree fixes');
        await expect(item(page).locator('.research-count-badge')).toHaveText('2');
        await expect(item(page)).toHaveAttribute('aria-label', 'Tree fixes, available: 2');

        await item(page).click();
        await expect(modal(page)).toBeVisible();
        await expect(modal(page).locator('.research-fix')).toHaveCount(4);
        expect(await modal(page).locator('.research-fix').evaluateAll(els => els.map(e => e.getAttribute('data-fix'))))
            .toEqual(['places-normalize', 'sex-from-name', 'participant-names', 'street-places']);
        await expect(row(page, 'places-normalize').locator('.research-fix-count')).toHaveText('23 places');
        await expect(row(page, 'places-normalize').locator('.research-fix-state')).toHaveText('Available');
        await expect(row(page, 'places-normalize').getByRole('button', { name: 'Open in the research, opens in the research' })).toBeVisible();
        // Running it costs (the agent): the AI label before the mark.
        await expect(row(page, 'sex-from-name').locator('.research-ai-badge')).toHaveCount(1);
        await expect(row(page, 'participant-names').locator('.research-fix-state')).toHaveText(/^Applied /);
        await expect(row(page, 'participant-names').locator('.research-fix-action')).toHaveAttribute('data-fix-act', 'undo');
        await expect(row(page, 'street-places').locator('.research-fix-state')).toHaveText(/^Left unchanged /);
        await expect(row(page, 'nothing-here')).toHaveCount(0);
    });

    test('left unchanged and undone: faint, "Open in the research", sorted together, newest first; the summary whole', async ({ page }) => {
        const long = 'Moves streets, house numbers and parts of town out of the place names into the address, so that one place '
            + 'is written once and the street stays with the event it belongs to; nothing is removed from the tree.';
        await research(page, { fixes: { fixes: [
            { ...FIXES[3], summary: { en: long } },
            { id: 'surname-split', title: { en: 'Split surnames' }, summary: { en: 'Splits the birth name off.' }, unit: 'person', count: 2,
                state: 'declined', undone: true, undoable: false, at: '2026-10-29T10:00:00.000Z', paid: false },
            FIXES[0],
        ] } });
        await openFixes(page);
        expect(await modal(page).locator('.research-fix').evaluateAll(els => els.map(e => e.getAttribute('data-fix'))))
            .toEqual(['places-normalize', 'surname-split', 'street-places']);
        const faint = await page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--text-faint)';
            document.body.appendChild(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
        });
        for (const id of ['surname-split', 'street-places']) {
            const state = row(page, id).locator('.research-fix-state');
            expect(await state.evaluate(el => getComputedStyle(el).color)).toBe(faint);
            await expect(row(page, id).locator('.research-fix-action')).toHaveAttribute('data-fix-act', 'open');
            await expect(row(page, id).getByRole('button', { name: 'Open in the research, opens in the research' })).toBeVisible();
        }
        await expect(row(page, 'surname-split').locator('.research-fix-state')).toHaveText(/^Undone /);
        await expect(row(page, 'street-places').locator('.research-fix-state')).toHaveText(/^Left unchanged /);
        // The summary whole: no line clamp, every line shown.
        const summary = row(page, 'street-places').locator('.research-fix-summary');
        await expect(summary).toHaveText(long);
        expect(await summary.evaluate(el => {
            const cs = getComputedStyle(el);
            return { clamp: cs.webkitLineClamp, cut: el.scrollHeight > el.clientHeight + 1 };
        })).toEqual({ clamp: 'none', cut: false });
    });

    test('in "Other actions": an update of the research first, then the phone, Tree fixes, Research tools ›', async ({ page }) => {
        await research(page, {
            features: ['fixes.list', 'phone'],
            links: [...LINKS, 'update', 'doctor'],
            more: { phone: fakePhone(), statusExtra: { update: { version: '1.7.0' } } },
        });
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page)).toBeVisible();
        const ids = await page.locator('#research-menu-more > [id^="research-item-"]').evaluateAll(
            els => els.map(e => e.id).filter(id => !id.endsWith('-link')));
        const at = (id: string): number => ids.indexOf(id);
        expect(at('research-item-update'), ids.join(' ')).toBeGreaterThanOrEqual(0);
        expect(at('research-item-update')).toBeLessThan(at('research-item-phone'));
        expect(at('research-item-phone')).toBeLessThan(at('research-item-fixes'));
        expect(at('research-item-fixes')).toBe(at('research-item-tools') - 1);
        expect(at('research-item-tools')).toBe(ids.length - 1);
    });

    test('Open hands over the fix\'s link and the row waits for the research; Undo adds do=undo', async ({ page }) => {
        await research(page);
        await openFixes(page);
        await row(page, 'places-normalize').locator('.research-fix-action').click();
        expect(await links(page)).toEqual([`strom-research://fixes?tree=${UUID}&id=places-normalize`]);
        await expect(row(page, 'places-normalize')).toHaveAttribute('data-view', 'opened');
        await expect(row(page, 'places-normalize').locator('.research-fix-state')).toHaveText('Opened in the research · confirmed there');
        await expect(row(page, 'places-normalize').locator('.research-fix-action')).toHaveCount(0);

        await row(page, 'participant-names').locator('.research-fix-action').click();
        expect((await links(page))[1]).toBe(`strom-research://fixes?tree=${UUID}&id=participant-names&do=undo`);

        // The menu counts only what was not opened yet.
        await page.locator('#research-fixes-close').click();
        await expect(modal(page)).toHaveCount(0);
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page).locator('.research-count-badge')).toHaveText('1');
    });

    test('nothing available and nothing to undo: the dialog says so; the item without a count', async ({ page }) => {
        await research(page, { fixes: { fixes: FIXES.filter(f => f.state === 'declined' || f.state === 'nothing') } });
        await openResearchMenu(page, { expandMore: true });
        await expect(item(page).locator('.research-count-badge')).toHaveCount(0);
        await expect(item(page)).toHaveAttribute('aria-label', 'Tree fixes');
        await item(page).click();
        await expect(modal(page).locator('.research-fixes-empty')).toHaveText('No fixes are available.');
        await expect(modal(page).locator('.research-fix')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(modal(page)).toHaveCount(0);
    });

    test('an information dialog: small width, × and one Close last in the footer; Close and the backdrop close it', async ({ page }) => {
        await research(page);
        await openFixes(page);
        await expect(modal(page).locator('.modal')).toHaveClass(/\bmodal--sm\b/);
        await expect(modal(page).locator('.modal')).toHaveAttribute('data-dialog-kind', 'info');
        await expect(modal(page).locator('.modal-header .close-btn')).toHaveCount(1);
        await expect(modal(page).locator('.buttons [data-dismiss]')).toHaveCount(1);
        await expect(modal(page).locator('.buttons > :last-child')).toHaveAttribute('id', 'research-fixes-close');
        await modal(page).locator('[data-dismiss]').click();
        await expect(modal(page)).toHaveCount(0);
        await openFixes(page);
        await page.mouse.click(5, 5);
        await expect(modal(page)).toBeHidden();
    });

    test('phone: the rows stack, the button keeps a touch size', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await research(page);
        // The list is read after the status (asynchronously): the dialog opens once it is there.
        await expect(async () => {
            await page.evaluate(() => (window.Strom.UI as unknown as { showResearchFixesDialog(): void }).showResearchFixesDialog());
            await expect(modal(page)).toBeVisible({ timeout: 200 });
        }).toPass();
        const btn = row(page, 'places-normalize').locator('.research-fix-action');
        const box = await btn.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(40);
        const title = await row(page, 'places-normalize').locator('.research-fix-title').boundingBox();
        expect(box!.y).toBeGreaterThan(title!.y);
    });
});

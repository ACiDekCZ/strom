import { test, expect, type Page, type Locator, type Browser } from '@playwright/test';
import { openApp } from './helpers.js';
import {
    fakeBridge, fakeQuality, fakeDuplicates, openResearch, poll, acceptLoad, touchScreenNow, UUID, HEAD, NEW_HEAD,
    type FakeBridge, type FakeDuplicates,
} from './research-bridge.js';

/**
 * The tree validation as Problems and Leads (spec 021 K1.4, K1.5): one
 * summary sentence, the findings in groups by type, long groups by 20, the
 * Leads apart; a finding marked "not an error" (or a pair "two different
 * people") leaves the counts, comes back by Undo or Restore, and on a
 * research tree goes to the research when its bridge takes the marks.
 */

type P = Record<string, unknown>;

/**
 * The Lhoták family (invented): Václav died before he was born (an error),
 * Marie has a residence after her death (a warning), two Jan Lhoták born the
 * same year (a possible duplicate, a lead) and Čáslav written two ways (a lead).
 */
function lhotak(): { persons: Record<string, P>; partnerships: Record<string, P> } {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: P = {}): P => ({
        id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
    });
    return {
        persons: {
            vaclav: person('vaclav', 'Václav', 'Lhoták', 'male', { birthDate: '1850', deathDate: '1840', birthPlace: 'Čáslav' }),
            marie: person('marie', 'Marie', 'Lhotáková', 'female', {
                birthDate: '1825', deathDate: '1881', birthPlace: 'Caslav', events: [{ id: 'e_marie', type: 'residence', date: '1890' }],
            }),
            jan1: person('jan1', 'Jan', 'Lhoták', 'male', { birthDate: '1852', birthPlace: 'Čáslav' }),
            jan2: person('jan2', 'Jan', 'Lhoták', 'male', { birthDate: '1852' }),
        },
        partnerships: {},
    };
}

/** A tree of `n` people who each died before they were born (one long group). */
function manyErrors(n: number): { persons: Record<string, P>; partnerships: Record<string, P> } {
    const persons: Record<string, P> = {};
    for (let i = 0; i < n; i++) {
        const id = `p${i}`;
        persons[id] = {
            id, firstName: `Václav ${i + 1}`, lastName: 'Lhoták', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], birthDate: String(1800 + i), deathDate: String(1790 + i),
        };
    }
    return { persons, partnerships: {} };
}

async function importTree(page: Page, data: { persons: Record<string, P>; partnerships: Record<string, P> }, name = 'Lhoták'): Promise<string> {
    return page.evaluate(async ({ data, name }) => {
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree(data as never, name);
        S.UI.updateTreeSwitcher?.();
        await S.TreeRenderer.renderAsync();
        return id as string;
    }, { data, name });
}

async function openValidation(page: Page, treeId: string): Promise<Locator> {
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    const modal = page.locator('#tree-validation-modal');
    await expect(modal).toBeVisible();
    return modal;
}

const group = (modal: Locator, type: string): Locator => modal.locator(`.vq-group[data-type="${type}"]`);
const sectionHead = (modal: Locator, which: 'problem' | 'trace'): Locator =>
    modal.locator(`.vq-section[data-section="${which}"] > .vq-section-head`);
const marks = (page: Page) => page.evaluate(() => (window.Strom.DataManager.getData().qualityDismissed ?? []) as Array<Record<string, unknown>>);

test.describe('validation: Problems and Leads', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
    });

    test('one summary sentence, groups by type, the Problems open, the Leads with their count', async ({ page }) => {
        const treeId = await importTree(page, lhotak());
        const modal = await openValidation(page, treeId);

        await expect(modal.locator('.vq-summary-text')).toHaveText('1 error, 1 warning, 2 leads.');
        // Problems: errors and warnings; the error's group open, the warning's closed.
        await expect(sectionHead(modal, 'problem')).toHaveAttribute('aria-expanded', 'true');
        await expect(sectionHead(modal, 'problem').locator('.vq-section-count')).toHaveText('2');
        const problems = modal.locator('.vq-section[data-section="problem"] .vq-group');
        await expect(problems).toHaveCount(2);
        await expect(problems.nth(0)).toHaveAttribute('data-type', 'deathBeforeBirth');
        await expect(problems.nth(1)).toHaveAttribute('data-type', 'eventAfterDeath');
        const death = group(modal, 'deathBeforeBirth');
        await expect(death.locator('.vq-group-head')).toHaveAttribute('aria-expanded', 'true');
        await expect(death.locator('.vq-group-count')).toHaveText('1');
        // A row: the person with the years, the detail; no type name (the group has it).
        const row = death.locator('.vq-row');
        await expect(row.locator('.validation-person-link')).toHaveText('Václav Lhoták');
        await expect(row.locator('.vq-years')).toHaveText('(* 1850, † 1840)');
        await expect(row.locator('.validation-issue-detail')).toContainText('1840');
        const after = group(modal, 'eventAfterDeath');
        await expect(after.locator('.vq-group-head')).toHaveAttribute('aria-expanded', 'false');
        await expect(after.locator('.vq-row')).toHaveCount(0);
        await after.locator('.vq-group-head').click();
        await expect(after.locator('.vq-row')).toHaveCount(1);
        await expect(after.locator('.vq-group-head')).toHaveAttribute('aria-expanded', 'true');

        // Leads: open on a wide screen, every group closed, with the count.
        await expect(sectionHead(modal, 'trace')).toHaveAttribute('aria-expanded', 'true');
        await expect(sectionHead(modal, 'trace').locator('.vq-section-count')).toHaveText('2');
        await expect(modal.locator('.vq-leads-intro')).toBeVisible();
        const leads = modal.locator('.vq-section[data-section="trace"] .vq-group');
        await expect(leads).toHaveCount(2);
        await expect(modal.locator('.vq-section[data-section="trace"] .vq-row')).toHaveCount(0);
        await expect(group(modal, 'possibleDuplicate').locator('.vq-group-name')).toHaveText('Possible duplicate person');
        // The Leads close as a whole (the count stays in the head).
        await sectionHead(modal, 'trace').click();
        await expect(sectionHead(modal, 'trace')).toHaveAttribute('aria-expanded', 'false');
        await expect(modal.locator('.vq-section[data-section="trace"] .vq-group')).toHaveCount(0);
        await expect(sectionHead(modal, 'trace').locator('.vq-section-count')).toHaveText('2');
        // By keyboard as well.
        await sectionHead(modal, 'trace').focus();
        await page.keyboard.press('Enter');
        await expect(sectionHead(modal, 'trace')).toHaveAttribute('aria-expanded', 'true');
    });

    test('a group of 50 or more shows 20, then 20 more per click, the focus stays on the button', async ({ page }) => {
        const treeId = await importTree(page, manyErrors(55));
        const modal = await openValidation(page, treeId);
        const g = group(modal, 'deathBeforeBirth');
        await expect(g.locator('.vq-group-count')).toHaveText('55');
        await expect(g.locator('.vq-row')).toHaveCount(20);
        const more = g.locator('.vq-more');
        await expect(more).toHaveText('Show 20 more (35 left)');
        await more.click();
        await expect(g.locator('.vq-row')).toHaveCount(40);
        await expect(more).toHaveText('Show 15 more (15 left)');
        await expect(more).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(g.locator('.vq-row')).toHaveCount(55);
        await expect(g.locator('.vq-more')).toHaveCount(0);
    });

    test('"Not an error": the finding leaves the counts, goes to the marked list, Restore brings it back', async ({ page }) => {
        const treeId = await importTree(page, lhotak());
        const modal = await openValidation(page, treeId);
        const after = group(modal, 'eventAfterDeath');
        await after.locator('.vq-group-head').click();
        await after.locator('.vq-dismiss').click();

        // Gone, counted no more; the toast says so and the body makes room for it.
        await expect(group(modal, 'eventAfterDeath')).toHaveCount(0);
        await expect(modal.locator('.vq-summary-text')).toHaveText('1 error, 2 leads.');
        await expect(sectionHead(modal, 'problem').locator('.vq-section-count')).toHaveText('1');
        await expect(page.locator('.toast', { hasText: 'This finding will not be reported again.' })).toBeVisible();
        await expect(page.locator('#tree-validation-content')).toHaveClass(/vq-toast-room/);
        await expect(page.locator('#tree-validation-content')).toHaveCSS('padding-bottom', '84px');
        expect(await marks(page)).toEqual([expect.objectContaining({ kind: 'eventAfterDeath', persons: ['marie'], subject: '1890' })]);

        // The marked list: closed with its count, open with the finding, no send state (not a research tree).
        const head = modal.locator('.vq-dismissed-head');
        await expect(head).toHaveText(/Marked as not an error: 1/);
        await expect(head).toHaveAttribute('aria-expanded', 'false');
        await head.click();
        const row = modal.locator('.vq-dismissed-row');
        await expect(row).toHaveCount(1);
        await expect(row.locator('.vq-dismissed-what')).toHaveText('Marie Lhotáková (* 1825, † 1881) · 1890');
        await expect(row.locator('.vq-dismissed-meta')).toHaveText(/^marked on /);
        await expect(row.locator('.vq-sync')).toHaveCount(0);

        // Restore: back in its group, the list gone; undoable as an edit, so the mark is out of the data.
        await row.locator('.vq-restore').click();
        await expect(group(modal, 'eventAfterDeath').locator('.vq-group-count')).toHaveText('1');
        await expect(modal.locator('.vq-summary-text')).toHaveText('1 error, 1 warning, 2 leads.');
        await expect(modal.locator('.vq-dismissed')).toHaveCount(0);
        expect(await marks(page)).toEqual([]);
    });

    test('Undo in the toast brings the finding back', async ({ page }) => {
        const treeId = await importTree(page, lhotak());
        const modal = await openValidation(page, treeId);
        await group(modal, 'deathBeforeBirth').locator('.vq-dismiss').click();
        await expect(group(modal, 'deathBeforeBirth')).toHaveCount(0);
        await expect(modal.locator('.vq-summary-text')).toHaveText('No errors. 1 warning, 2 leads.');

        // The toast stands above the dialog's overlay: its Undo takes a click.
        const toast = page.locator('.toast', { hasText: 'This finding will not be reported again.' });
        await toast.locator('.toast-action', { hasText: 'Undo' }).click({ timeout: 5000 });
        await expect(group(modal, 'deathBeforeBirth').locator('.vq-row')).toHaveCount(1);
        await expect(modal.locator('.vq-summary-text')).toHaveText('1 error, 1 warning, 2 leads.');
        await expect(modal.locator('.vq-dismissed')).toHaveCount(0);
        expect(await marks(page)).toEqual([]);
    });

    test('"Two different people" on a possible duplicate: the pair is marked as a pair', async ({ page }) => {
        const treeId = await importTree(page, lhotak());
        const modal = await openValidation(page, treeId);
        const dup = group(modal, 'possibleDuplicate');
        await dup.locator('.vq-group-head').click();
        // The two people with "×" between them, the choice named for a pair.
        await expect(dup.locator('.vq-row .vq-sep')).toHaveText('×');
        const choice = dup.locator('.vq-dismiss');
        await expect(choice).toHaveText('Two different people');
        await choice.click();

        await expect(page.locator('.toast', { hasText: 'This pair will not be reported again.' })).toBeVisible();
        await expect(group(modal, 'possibleDuplicate')).toHaveCount(0);
        await expect(modal.locator('.vq-summary-text')).toHaveText('1 error, 1 warning, 1 lead.');
        expect(await marks(page)).toEqual([expect.objectContaining({ kind: 'possibleDuplicate', persons: ['jan1', 'jan2'] })]);
        await modal.locator('.vq-dismissed-head').click();
        const row = modal.locator('.vq-dismissed-row');
        await expect(row.locator('.vq-dismissed-type')).toHaveText('Possible duplicate person · Two different people');
        await expect(row.locator('.vq-dismissed-what')).toHaveText('Jan Lhoták (* 1852) × Jan Lhoták (* 1852)');
    });

    test('read-only: one sentence, no Fix, no "Not an error", the marked list without Restore', async ({ page }) => {
        const treeId = await importTree(page, lhotak());
        let modal = await openValidation(page, treeId);
        await expect(modal.locator('.validation-fix-all-btn')).toBeVisible();
        await group(modal, 'deathBeforeBirth').locator('.vq-dismiss').click();
        await expect(group(modal, 'deathBeforeBirth')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeTreeValidationDialog());

        await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
        modal = await openValidation(page, treeId);
        await expect(modal.locator('.vq-readonly')).toHaveText('The tree is read-only. Findings can be viewed but not fixed or marked.');
        await group(modal, 'eventAfterDeath').locator('.vq-group-head').click();
        await group(modal, 'placeSpelling').locator('.vq-group-head').click();
        await expect(modal.locator('.vq-row')).toHaveCount(2);
        await expect(modal.locator('.vq-dismiss')).toHaveCount(0);
        await expect(modal.locator('.validation-fix-btn')).toHaveCount(0);
        await expect(modal.locator('.validation-fix-all-btn')).toHaveCount(0);
        await modal.locator('.vq-dismissed-head').click();
        await expect(modal.locator('.vq-dismissed-row')).toHaveCount(1);
        await expect(modal.locator('.vq-restore')).toHaveCount(0);
    });

    test('Tree overview: the same sentence, the Problems only, the Leads as one line; a mark made from it counts there at once', async ({ page }) => {
        const treeId = await importTree(page, lhotak());
        await page.evaluate((id) => window.Strom.UI.showTreeOverview(id, { section: 'quality' }), treeId);
        const quality = page.locator('#tree-overview-modal .tov-sec[data-section="quality"]');
        await expect(quality).toHaveAttribute('data-ready', 'true');
        await expect(quality.locator('.tov-summary')).toHaveText('1 error, 1 warning, 2 leads.');
        await expect(quality.locator('.tov-finding')).toHaveCount(2);
        await expect(quality.locator('.tov-finding').first()).toHaveClass(/tov-finding--error/);
        await expect(quality.locator('.tov-leads')).toHaveText('2 leads ›');

        await quality.getByRole('button', { name: 'Validation details', exact: true }).click();
        const modal = page.locator('#tree-validation-modal');
        await expect(modal).toBeVisible();
        await group(modal, 'eventAfterDeath').locator('.vq-group-head').click();
        await group(modal, 'eventAfterDeath').locator('.vq-dismiss').click();
        await expect(group(modal, 'eventAfterDeath')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();

        await expect(quality.locator('.tov-summary')).toHaveText('1 error, 2 leads.');
        await expect(quality.locator('.tov-finding')).toHaveCount(1);
    });
});

// ---------------------------------------------------------------- the research

/** A research tree of the Lhoták family: Josef twice (a possible duplicate), Václav died before he was born. */
function researchLhotakGed(): string {
    const indi = (ref: string, name: string, sex: 'M' | 'F', birth: string, extra: string[] = []): string[] => [
        `0 @${ref}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, '1 BIRT', `2 DATE ${birth}`, ...extra,
        `1 REFN ${ref}`, '2 TYPE strom-research',
    ];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 27 SEP 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Lhotákovi',
        ...indi('P0001', 'Jan /Lhoták/', 'M', '1820', ['1 FAMS @F0001@']),
        ...indi('P0002', 'Marie /Lhotáková/', 'F', '1825', ['1 FAMS @F0001@']),
        ...indi('P0003', 'Josef /Lhoták/', 'M', '1852', ['1 FAMC @F0001@']),
        ...indi('P0004', 'Josef /Lhoták/', 'M', '1852', ['1 FAMC @F0001@']),
        ...indi('P0005', 'Václav /Lhoták/', 'M', '1860', ['1 DEAT', '2 DATE 1855', '1 FAMC @F0001@']),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@', '1 CHIL @P0004@', '1 CHIL @P0005@',
        '0 TRLR',
    ].join('\n');
}

async function openResearchValidation(page: Page): Promise<Locator> {
    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
    return openValidation(page, treeId);
}

test.describe('validation: the marks and the research', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('a bridge that takes the marks: the pair goes to the research, the list says "Sent to the research"', async ({ page }) => {
        const b = await fakeBridge(page, { features: ['quality.dismiss', 'quality.read'], quality: fakeQuality() });
        await openResearch(page, { ged: researchLhotakGed() });
        await poll(page);
        const modal = await openResearchValidation(page);
        const dup = group(modal, 'possibleDuplicate');
        await dup.locator('.vq-group-head').click();
        await dup.locator('.vq-dismiss').click();
        await expect(group(modal, 'possibleDuplicate')).toHaveCount(0);

        await expect.poll(() => b.quality!.posts).toEqual([{ kind: 'possibleDuplicate', persons: ['P0003', 'P0004'] }]);
        await modal.locator('.vq-dismissed-head').click();
        await expect(modal.locator('.vq-dismissed-row .vq-sync')).toHaveText('Sent to the research');
        await expect(modal.locator('.vq-dismissed-row .vq-sync')).toHaveClass(/vq-sync--sent/);
    });

    test('a bridge that does not take the marks: nothing is sent and no send state is shown', async ({ page }) => {
        const b = await fakeBridge(page, { features: [], quality: fakeQuality() });
        await openResearch(page, { ged: researchLhotakGed() });
        await poll(page);
        const modal = await openResearchValidation(page);
        await group(modal, 'deathBeforeBirth').locator('.vq-dismiss').click();
        await expect(group(modal, 'deathBeforeBirth')).toHaveCount(0);
        await modal.locator('.vq-dismissed-head').click();
        await expect(modal.locator('.vq-dismissed-row')).toHaveCount(1);
        await expect(modal.locator('.vq-dismissed-row .vq-sync')).toHaveCount(0);
        await poll(page);
        expect(b.quality!.posts).toEqual([]);
    });

    test('marked in the research: the finding leaves, the list says so, Restore takes it back there', async ({ page }) => {
        const b = await fakeBridge(page, {
            features: ['quality.dismiss', 'quality.read'],
            quality: fakeQuality({ rev: 'q7', dismissed: [{ kind: 'deathBeforeBirth', persons: ['P0005'], at: '2026-10-20T10:00:00Z', by: 'research' }] }),
        });
        await openResearch(page, { ged: researchLhotakGed() });
        const modal = await openResearchValidation(page);
        await expect(group(modal, 'deathBeforeBirth').locator('.vq-row')).toHaveCount(1);
        // The bridge says its marks moved: read, merged, the open dialog redrawn.
        await poll(page);
        await expect(group(modal, 'deathBeforeBirth')).toHaveCount(0);
        await modal.locator('.vq-dismissed-head').click();
        const row = modal.locator('.vq-dismissed-row');
        await expect(row).toHaveClass(/vq-dismissed-row--research/);
        await expect(row.locator('.vq-dismissed-meta')).toHaveText('Marked in the research');
        await expect(row.locator('.vq-dismissed-what')).toHaveText('Václav Lhoták (* 1860, † 1855)');
        await expect(row.locator('.vq-sync')).toHaveCount(0);

        await row.locator('.vq-restore').click();
        await expect(group(modal, 'deathBeforeBirth').locator('.vq-row')).toHaveCount(1);
        await expect.poll(() => b.quality!.posts).toEqual([{ kind: 'deathBeforeBirth', persons: ['P0005'], do: 'undo' }]);
    });
});

// ---------------------------------------------------------------- phones

async function phone(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await openApp(page);
    return { page, close: () => context.close() };
}

/** Nothing wider than the screen, nor than the dialog's scrolling body. */
async function expectNoOverflow(page: Page): Promise<void> {
    const widths = await page.evaluate(() => {
        const body = document.querySelector('#tree-validation-modal .modal-content') as HTMLElement;
        return { doc: document.documentElement.scrollWidth, win: window.innerWidth, body: body.scrollWidth, bodyClient: body.clientWidth };
    });
    expect(widths.doc).toBeLessThanOrEqual(widths.win);
    expect(widths.body).toBeLessThanOrEqual(widths.bodyClient);
}

test('phone (390 px): the Leads closed while there are Problems, the actions under the text, 44 px to tap, nothing too wide', async ({ browser }) => {
    const { page, close } = await phone(browser, 390, 844);
    const treeId = await importTree(page, lhotak(), 'Lhotákovi z Čáslavi a Kutné Hory');
    const modal = await openValidation(page, treeId);
    await expect(sectionHead(modal, 'trace')).toHaveAttribute('aria-expanded', 'false');
    await expect(sectionHead(modal, 'trace').locator('.vq-section-count')).toHaveText('2');
    const row = group(modal, 'deathBeforeBirth').locator('.vq-row');
    const text = await row.locator('.validation-issue-content').boundingBox();
    const dismiss = await row.locator('.vq-dismiss').boundingBox();
    expect(dismiss!.y).toBeGreaterThanOrEqual(text!.y + text!.height - 1);
    expect(dismiss!.height).toBeGreaterThanOrEqual(44);
    expect((await sectionHead(modal, 'trace').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await group(modal, 'deathBeforeBirth').locator('.vq-group-head').boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await sectionHead(modal, 'trace').click();
    await group(modal, 'possibleDuplicate').locator('.vq-group-head').click();
    await expectNoOverflow(page);
    await group(modal, 'possibleDuplicate').locator('.vq-dismiss').click();
    await modal.locator('.vq-dismissed-head').click();
    expect((await modal.locator('.vq-restore').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoOverflow(page);
    await close();
});

test('phone sideways: the heads 44 px or more, nothing too wide', async ({ browser }) => {
    const { page, close } = await phone(browser, 844, 390);
    const treeId = await importTree(page, lhotak(), 'Lhotákovi z Čáslavi a Kutné Hory');
    const modal = await openValidation(page, treeId);
    for (const type of ['deathBeforeBirth', 'eventAfterDeath']) {
        expect((await group(modal, type).locator('.vq-group-head').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await group(modal, 'eventAfterDeath').locator('.vq-group-head').click();
    await expectNoOverflow(page);
    await close();
});

// ---------------------------------------------------------------- the research's verdicts on possible duplicates

/**
 * A research tree of the Lhoták family (invented) with five possible
 * duplicates among the sons of Jan and Marie, in the app's order (by year):
 * Antonín 1850, Tomáš 1852, František 1854, Josef 1856, Karel 1858 — each
 * twice. `mergedKarel`: the research's newer version, Karel once.
 */
function researchDuplicatesGed(head = HEAD, mergedKarel = false): string {
    const indi = (ref: string, name: string, sex: 'M' | 'F', birth: string, extra: string[] = []): string[] => [
        `0 @${ref}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, '1 BIRT', `2 DATE ${birth}`, ...extra,
        `1 REFN ${ref}`, '2 TYPE strom-research',
    ];
    const sons: Array<[string, string, string]> = [
        ['P0003', 'Antonín', '1850'], ['P0004', 'Antonín', '1850'],
        ['P0005', 'Tomáš', '1852'], ['P0006', 'Tomáš', '1852'],
        ['P0007', 'František', '1854'], ['P0008', 'František', '1854'],
        ['P0009', 'Josef', '1856'], ['P0010', 'Josef', '1856'],
        ['P0011', 'Karel', '1858'], ...(mergedKarel ? [] : [['P0012', 'Karel', '1858'] as [string, string, string]]),
    ];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 27 SEP 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Lhotákovi',
        ...indi('P0001', 'Jan /Lhoták/', 'M', '1820', ['1 FAMS @F0001@']),
        ...indi('P0002', 'Marie /Lhotáková/', 'F', '1825', ['1 FAMS @F0001@']),
        ...sons.flatMap(([ref, first, year]) => indi(ref, `${first} /Lhoták/`, 'M', year, ['1 FAMC @F0001@'])),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', ...sons.map(([ref]) => `1 CHIL @${ref}@`),
        '0 TRLR',
    ].join('\n');
}

const JUDGE_FEATURES = ['duplicates.judge', 'quality.dismiss', 'quality.read'];

/** The research's verdicts on the five pairs; Tomáš has none (`unknown-person`). */
function lhotakVerdicts(init: Partial<FakeDuplicates> = {}): FakeDuplicates {
    return fakeDuplicates({
        verdicts: {
            'P0003|P0004': { verdict: 'unsure', reason: 'names-differ' },
            'P0007|P0008': { verdict: 'different', reason: 'siblings' },
            'P0009|P0010': { verdict: 'same', reason: 'same-parents', years: [1856, 1856] },
            'P0011|P0012': { verdict: 'same', reason: 'merged', into: 'P0011' },
        },
        ...init,
    });
}

const dupRows = (modal: Locator): Locator => group(modal, 'possibleDuplicate').locator('.vq-row');
/** The first given name of each row of possible duplicates, in the order shown. */
const dupOrder = (modal: Locator): Promise<string[]> => dupRows(modal).evaluateAll(rows =>
    rows.map(r => (r.querySelector('.vq-person a')?.textContent ?? '').split(' ')[0]));

async function openGroup(modal: Locator, type: string): Promise<void> {
    const head = group(modal, type).locator('.vq-group-head');
    if (await head.getAttribute('aria-expanded') !== 'true') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
}

async function researchWithVerdicts(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, { features: JUDGE_FEATURES, quality: fakeQuality(), duplicates: lhotakVerdicts(), ...init });
    await openResearch(page, { ged: researchDuplicatesGed() });
    await poll(page);
    return b;
}

test.describe('validation: the research\'s verdicts on possible duplicates', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('verdicts: probably the same and merged first, then uncertain, then none; two people set aside and not counted; reasons in words', async ({ page }) => {
        const b = await researchWithVerdicts(page);
        const modal = await openResearchValidation(page);
        const dup = group(modal, 'possibleDuplicate');
        await expect(dup.locator('.vq-group-note')).toHaveText('Assessed by the research');
        // One request with the five pairs, each by the research's REFN.
        expect(b.duplicates!.asks.length).toBe(1);
        expect(b.duplicates!.asks[0].map(p => [...p].sort().join('|')).sort())
            .toEqual(['P0003|P0004', 'P0005|P0006', 'P0007|P0008', 'P0009|P0010', 'P0011|P0012']);

        await openGroup(modal, 'possibleDuplicate');
        expect(await dupOrder(modal)).toEqual(['Josef', 'Karel', 'Antonín', 'Tomáš']);
        await expect(dup.locator('.vq-group-count')).toHaveText('4');
        await expect(sectionHead(modal, 'trace').locator('.vq-section-count')).not.toHaveText('5');

        const rows = dupRows(modal);
        await expect(rows.nth(0).locator('.vq-verdict-tag')).toHaveText('Probably the same person');
        await expect(rows.nth(0).locator('.vq-verdict-tag')).toHaveClass(/vq-verdict-tag--same/);
        await expect(rows.nth(0).locator('.vq-verdict-reason')).toHaveText('same parents, born 1856 and born 1856');
        await expect(rows.nth(0).locator('.vq-verdict-action')).toHaveText('Merge…');
        await expect(rows.nth(1).locator('.vq-verdict-tag')).toHaveText('Merged in the research');
        await expect(rows.nth(1).locator('.vq-verdict-reason')).toHaveText('already one person in the research; the tree in the app is an older version');
        await expect(rows.nth(1).locator('.vq-verdict-action')).toHaveText('Load the new version');
        await expect(rows.nth(2).locator('.vq-verdict-tag')).toHaveText('Uncertain');
        await expect(rows.nth(2).locator('.vq-verdict-reason')).toHaveText('the names differ in the research');
        await expect(rows.nth(2).locator('.vq-verdict-action')).toHaveCount(0);
        // No verdict: the app's own row, its detail kept.
        await expect(rows.nth(3).locator('.vq-verdict')).toHaveCount(0);
        await expect(rows.nth(3).locator('.validation-issue-detail')).toHaveText('* 1852');
        // A verdict hides the app's monospace detail.
        await expect(rows.nth(0).locator('.validation-issue-detail')).toHaveCount(0);

        // Told apart: a closed row at the group's end, open its rows without actions.
        const aside = dup.locator('.vq-aside-head');
        await expect(aside).toHaveText(/Told apart by the research: 1/);
        await expect(aside).toHaveAttribute('aria-expanded', 'false');
        await expect(dup.locator('.vq-aside-row')).toHaveCount(0);
        await aside.click();
        const told = dup.locator('.vq-aside-row');
        await expect(told).toHaveCount(1);
        await expect(told.locator('.vq-verdict-tag')).toHaveText('Two people');
        await expect(told.locator('.vq-verdict-reason')).toHaveText('siblings – the second child was given the name of the one who died');
        await expect(told.locator('.vq-person a').first()).toHaveText('František Lhoták');
        await expect(told.locator('button:not(.vq-aside-head)')).toHaveCount(0);

        // Kept between openings for the same head: not asked again.
        await page.evaluate(() => window.Strom.UI.closeTreeValidationDialog());
        const again = await openResearchValidation(page);
        await expect(group(again, 'possibleDuplicate').locator('.vq-group-note')).toHaveText('Assessed by the research');
        expect(b.duplicates!.asks.length).toBe(1);
    });

    test('an answer while the group is open adds only the labels; the order follows at the next toggle', async ({ page }) => {
        let release!: () => void;
        const hold = new Promise<void>(r => { release = r; });
        await researchWithVerdicts(page, { duplicates: lhotakVerdicts({ hold }) });
        const modal = await openResearchValidation(page);
        const dup = group(modal, 'possibleDuplicate');
        await expect(dup.locator('.vq-group-note')).toHaveText('The research is assessing…');
        await openGroup(modal, 'possibleDuplicate');
        const before = ['Antonín', 'Tomáš', 'František', 'Josef', 'Karel'];
        expect(await dupOrder(modal)).toEqual(before);

        release();
        await expect(dup.locator('.vq-group-note')).toHaveText('Assessed by the research');
        await expect(dupRows(modal).nth(0).locator('.vq-verdict-tag')).toHaveText('Uncertain');
        expect(await dupOrder(modal)).toEqual(before);
        await expect(dupRows(modal).nth(2).locator('.vq-verdict-tag')).toHaveText('Two people');
        await expect(dup.locator('.vq-aside')).toHaveCount(0);

        await dup.locator('.vq-group-head').click();
        await openGroup(modal, 'possibleDuplicate');
        expect(await dupOrder(modal)).toEqual(['Josef', 'Karel', 'Antonín', 'Tomáš']);
        await expect(dup.locator('.vq-aside-head')).toHaveText(/Told apart by the research: 1/);
    });

    test('Merge… opens the person merge with both chosen; Cancel comes back to the check', async ({ page }) => {
        await researchWithVerdicts(page);
        const modal = await openResearchValidation(page);
        await openGroup(modal, 'possibleDuplicate');
        await dupRows(modal).nth(0).locator('.vq-verdict-action').click();
        const merge = page.locator('#person-merge-modal');
        await expect(merge).toHaveClass(/active/);
        await expect(modal).not.toHaveClass(/active/);
        await expect(merge.locator('#person-merge-keep')).toContainText('Josef');
        await expect(merge.locator('#person-merge-preview')).toBeVisible();
        await expect(merge.locator('#person-merge-other')).toContainText('Josef');
        await expect(merge.locator('#person-merge-btn')).toBeEnabled();

        await merge.locator('button[data-dismiss]').click();
        await expect(merge).not.toHaveClass(/active/);
        await expect(modal).toHaveClass(/active/);
        await expect(dupRows(modal)).toHaveCount(4);

        // Merged: back in the check, the pair is one person now.
        await dupRows(modal).nth(0).locator('.vq-verdict-action').click();
        await expect(merge).toHaveClass(/active/);
        await merge.locator('#person-merge-btn').click();
        await expect(modal).toHaveClass(/active/);
        await expect.poll(() => dupOrder(modal)).not.toContain('Josef');
        expect(await page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons)
            .filter(p => p.firstName === 'Josef').length)).toBe(1);
    });

    test('"Load the new version": the research\'s version loaded, Karel once', async ({ page }) => {
        const b = await researchWithVerdicts(page);
        b.treeGed = researchDuplicatesGed(NEW_HEAD, true);
        b.head = NEW_HEAD;
        const modal = await openResearchValidation(page);
        await openGroup(modal, 'possibleDuplicate');
        await dupRows(modal).nth(1).locator('.vq-verdict-action').click();
        await expect(modal).not.toHaveClass(/active/);
        await acceptLoad(page);
        await expect.poll(() => page.evaluate(() => Object.values(window.Strom.DataManager.getData().persons)
            .filter(p => p.firstName === 'Karel').length)).toBe(1);
    });

    test('read-only: the verdicts shown, no Merge… nor Load', async ({ page }) => {
        await researchWithVerdicts(page);
        await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
        const modal = await openResearchValidation(page);
        await expect(group(modal, 'possibleDuplicate').locator('.vq-group-note')).toHaveText('Assessed by the research');
        await openGroup(modal, 'possibleDuplicate');
        await expect(dupRows(modal).nth(0).locator('.vq-verdict-tag')).toHaveText('Probably the same person');
        await expect(modal.locator('.vq-verdict-action')).toHaveCount(0);
        await expect(modal.locator('.vq-dismiss')).toHaveCount(0);
    });

    test('a bridge that does not judge: nothing asked, nothing said', async ({ page }) => {
        const b = await researchWithVerdicts(page, { features: ['quality.dismiss', 'quality.read'] });
        const modal = await openResearchValidation(page);
        await openGroup(modal, 'possibleDuplicate');
        expect(await dupOrder(modal)).toEqual(['Antonín', 'Tomáš', 'František', 'Josef', 'Karel']);
        await expect(group(modal, 'possibleDuplicate').locator('.vq-group-note')).toHaveCount(0);
        await expect(modal.locator('.vq-verdict, .vq-aside')).toHaveCount(0);
        await expect(dupRows(modal).nth(0).locator('.validation-issue-detail')).toHaveText('* 1850');
        await poll(page);
        expect(b.duplicates!.asks).toEqual([]);
    });

    test('the research not running: one quiet sentence, no verdicts; a refused request says the same', async ({ page }) => {
        const b = await researchWithVerdicts(page);
        b.down = true;
        await poll(page);
        const modal = await openResearchValidation(page);
        const note = group(modal, 'possibleDuplicate').locator('.vq-group-note');
        await expect(note).toHaveText('Not assessed by the research – the research is not running.');
        await openGroup(modal, 'possibleDuplicate');
        await expect(modal.locator('.vq-verdict, .vq-aside')).toHaveCount(0);
        expect(b.duplicates!.asks).toEqual([]);
        await page.evaluate(() => window.Strom.UI.closeTreeValidationDialog());

        // Running again, but the research turns the request down (busy): the same sentence, asked once.
        b.down = false;
        b.duplicates!.reply = { status: 503, body: { error: 'busy', code: 'research.busy' } };
        await poll(page);
        const again = await openResearchValidation(page);
        await expect(group(again, 'possibleDuplicate').locator('.vq-group-note')).toHaveText('Not assessed by the research – the research is not running.');
        await expect(again.locator('.vq-verdict')).toHaveCount(0);
        expect(b.duplicates!.asks.length).toBe(1);
    });

    test('phone (390 px): the verdicts fit, Merge… 44 px to tap, the told-apart row 44 px or more', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await researchWithVerdicts(page);
        const modal = await openResearchValidation(page);
        await expect(group(modal, 'possibleDuplicate').locator('.vq-group-note')).toHaveText('Assessed by the research');
        await touchScreenNow(page);
        await openGroup(modal, 'possibleDuplicate');
        await group(modal, 'possibleDuplicate').locator('.vq-aside-head').click();
        await expect(group(modal, 'possibleDuplicate').locator('.vq-aside-row')).toHaveCount(1);
        expect((await dupRows(modal).nth(0).locator('.vq-verdict-action').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await group(modal, 'possibleDuplicate').locator('.vq-aside-head').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expectNoOverflow(page);
    });
});

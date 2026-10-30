import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * A new version of an approved story (Strom Research _STORY > _DRAFT): the
 * banner in the reader, the person dialog and the family book, the comparison
 * dialog and its decision footer, "Awaiting action" and the card's badge.
 * Handing a strom-research:// link to the system is recorded instead.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const ALL = ['send', 'open', 'task', 'review', 'conflict', 'story'];

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 2 OCT 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d',
        '1 _STROM_ASOF 2026-10-02', '1 CHAR UTF-8', '1 NOTE Vlkovi',
        '0 @P0001@ INDI', '1 NAME Jan /Vlk/', '1 SEX M', '1 BIRT', '2 DATE 1818', '1 DEAT', '2 DATE 1874',
        '1 REFN P0001', '1 FAMS @F0001@',
        '1 _STORY', '2 TYPE vypraveni', '2 STAT hotovo', '2 TEXT Jan byl mlynář.',
        '2 _DRAFT', '3 TITL Mlynář z Horní Lhoty', '3 TEXT Jan byl mlynář ve Lhotě, jako jeho otec.', '4 CONT', '4 CONT Mlýn vyhořel roku 1856.',
        '3 DATA OCCU mlynář [S0001]', '3 DATA EVEN požár 1856 [S0007]', '3 NOTE Požár je z kroniky obce.', '3 _AT 2026-10-02',
        '0 @P0002@ INDI', '1 NAME Marie /Vlková/', '1 SEX F', '1 BIRT', '2 DATE 1822', '1 DEAT', '2 DATE 1880',
        '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Josef /Vlk/', '1 SEX M', '1 BIRT', '2 DATE 1850', '1 DEAT', '2 DATE 1910',
        '1 REFN P0003', '1 FAMC @F0001@',
        '1 _STORY', '2 STAT hotovo', '2 TEXT Josef převzal mlýn.',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '1 _STORY', '2 STAT hotovo', '2 TEXT Svatba byla v únoru.', '2 _DRAFT', '3 TEXT Svatba byla v únoru 1845 v Chlumech.',
        '0 TRLR',
    ].join('\n');
}

async function dropFile(page: Page, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'tree-strom.ged', { type: 'text/plain' }));
        return dt;
    }, content);
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
}

/** Links the research announced on this computer, and what waits (before the app starts). */
async function seed(page: Page, links: string[], waiting: Record<string, unknown>[] = []): Promise<void> {
    await page.addInitScript(([links, waiting, uuid]) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        if ((links as string[]).length) localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({ items: waiting, at: new Date(Date.now() - 600_000).toISOString() }));
    }, [links, waiting, UUID] as const);
}

const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

async function setup(page: Page, links: string[] = ALL, waiting: Record<string, unknown>[] = []): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, links, waiting);
    await openApp(page);
    await dropFile(page, researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    await page.evaluate(() => {
        const list: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = list;
        window.Strom.UI.handOverResearchLink = (url: string) => { list.push(url); };
    });
}

const personId = (page: Page, refn: string) => page.evaluate((refn) =>
    window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === refn)!.id, refn);

const STORY_ITEM = { id: 'P0001', kind: 'story', what: 'New version of the story', person: 'P0001', at: new Date().toISOString() };
const COUPLE_ITEM = { id: 'F0001', kind: 'story', what: 'New version of the story', person: 'P0001', partner: 'P0002', at: new Date().toISOString() };

test.describe('a story\'s new version', () => {
    test('the reader: badge and banner; Compare pushes the comparison, Escape goes back', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), jan);
        const reader = page.locator('#person-story-modal');
        // Jan's own story (his couple's follows under it, see below): the tag at its heading.
        const own = reader.locator('#person-story-ch-own');
        await expect(own.locator('.story-reader-title')).toHaveText('Jan Vlk New version waiting');
        await expect(reader.locator('.story-draft-tag')).toHaveCount(0);
        await expect(own.locator(':scope > .story-nv-banner')).toContainText('Research wrote a new text on 2 Oct 2026. This one stays approved until a decision is made.');
        // The book's text is still the approved one.
        await expect(own.locator(':scope > .story-reader-text')).toHaveText('Jan byl mlynář.');
        await reader.locator('#person-story-compare').click();
        const cmp = page.locator('#story-compare-modal');
        await expect(cmp).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(cmp).toHaveCount(0);
        await expect(reader).toBeVisible();
    });

    test('the comparison: changes, the switch, then the decision handed to the research', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.showStoryCompare({ personId: id }), jan);
        const cmp = page.locator('#story-compare-modal');
        await expect(cmp.locator('.audit-log-subtitle')).toHaveText('Jan Vlk · written by research 2 Oct 2026');
        await expect(cmp.locator('.sc-value--text ins').first()).toHaveText('ve Lhotě, jako jeho otec');
        await expect(cmp.locator('.sc-para--add')).toContainText('Mlýn vyhořel roku 1856.');
        await expect(cmp.locator('.sc-value--title')).toHaveText('no title→Mlynář z Horní Lhoty');
        await expect(cmp.locator('.sc-line--add .sc-mark')).toHaveCount(3);
        await expect(cmp.locator('.sc-legend')).toBeVisible();
        await cmp.getByRole('tab', { name: 'New version' }).click();
        await expect(cmp.locator('.sc-panel--new .sc-title')).toHaveText('Mlynář z Horní Lhoty');
        await expect(cmp.locator('.sc-panel--changes')).toBeHidden();
        await expect(cmp.locator('.sc-legend')).toBeHidden();
        await cmp.getByRole('tab', { name: 'Approved' }).click();
        await expect(cmp.locator('.sc-panel--old')).toContainText('This text is in the book now.');

        const foot = cmp.locator('#story-compare-foot');
        await expect(foot.locator('button')).toHaveText(['Close', 'Keep approved, opens in the research', 'Use new version, opens in the research']);
        await foot.getByRole('button', { name: 'Use new version, opens in the research' }).click();
        expect(await launched(page)).toEqual([`strom-research://story?tree=${UUID}&person=P0001&do=final`]);
        await expect(foot).toContainText('Choice sent to research: use the new version');
        await expect(foot).toContainText('Confirm it in the terminal.');
        // No general "Opening in the research…" toast for this one.
        await expect(page.locator('.toast', { hasText: 'Opening' })).toHaveCount(0);
        await foot.getByRole('button', { name: 'Close' }).click();
        await expect(cmp).toHaveCount(0);

        // Opened again in the same session: what was sent, and the way to send it again.
        await page.evaluate((id) => window.Strom.UI.showStoryCompare({ personId: id }), jan);
        await expect(foot).toContainText('Sent to research: use the new version.');
        await foot.getByRole('button', { name: 'Open again, opens in the research' }).click();
        expect(await launched(page)).toHaveLength(2);

        // The next load from the research without the new version: no banner, no comparison.
        await page.evaluate(() => {
            const data = structuredClone(window.Strom.DataManager.getData());
            for (const p of Object.values(data.persons) as { story?: { draft?: unknown } }[]) delete p.story?.draft;
            window.Strom.DataManager.replaceWithSourceData(data);
        });
        await page.keyboard.press('Escape');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), jan);
        await expect(page.locator('#person-story-ch-own > .story-nv-banner')).toHaveCount(0);
        // The couple's new version still waits (only the person's went).
        await expect(page.locator('#person-story-modal .story-reader-couple .story-nv-banner')).toHaveCount(1);
    });

    test('the reader tells the couple\'s story under the person\'s own; its new version is compared there', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), jan);
        const couple = page.locator('#person-story-modal .story-reader-couple');
        await expect(couple).toHaveCount(1);
        await expect(couple.locator('.story-reader-couple-title')).toHaveText('Jan Vlk and Marie Vlková New version waiting');
        await expect(couple.locator('.story-reader-text')).toHaveText('Svatba byla v únoru.');
        await couple.locator('.story-nv-compare').click();
        const cmp = page.locator('#story-compare-modal');
        await expect(cmp).toBeVisible();
        await expect(cmp).toContainText('Svatba byla v únoru 1845 v Chlumech.');
    });

    test('two chapters: chips under the title, the couple\'s chapter tinted, the actions at each chapter; the menu counts them (spec 027)', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0001');
        const item = await page.evaluate((id) => window.Strom.UI.getPersonMenuActions(id).find((a: { action: string }) => a.action === 'story'), jan);
        expect(item).toMatchObject({ label: 'Story', meta: '2', ariaLabel: 'Story, 2 chapters' });
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), jan);
        const reader = page.locator('#person-story-modal');
        const chips = reader.locator('.story-chips .story-chip');
        await expect(chips).toHaveText(['Jan Vlk', 'Jan and Marie']);
        await expect(chips.first()).toHaveAttribute('aria-current', 'true');
        const couple = reader.locator('.story-reader-couple');
        await expect(couple).toHaveClass(/story-reader-ch--tint/);
        // No wedding date: "until" the first death, no dangling dash.
        await expect(couple.locator('.story-ch-kicker')).toHaveText('Story of the marriage · until 1874');
        await expect(couple.locator('.story-ch-mono > span')).toHaveText(['JV', 'MV']);
        // Compare at each chapter; the footer has Close only.
        await expect(reader.locator('#person-story-ch-own #person-story-compare')).toHaveCount(1);
        await expect(couple.locator('.story-nv-compare')).toHaveCount(1);
        await expect(reader.locator('.buttons button')).toHaveText(['Close']);
        await chips.nth(1).click();
        await expect(chips.nth(1)).toHaveAttribute('aria-current', 'true');
        await expect(chips.first()).not.toHaveAttribute('aria-current', 'true');
        await expect(couple).toBeInViewport();
    });

    test('phone: the reader is the whole screen, the chips one row', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        await setup(page);
        await page.setViewportSize({ width: 360, height: 740 });
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), jan);
        const box = await page.locator('#person-story-modal .modal').boundingBox();
        expect(box).toMatchObject({ x: 0, y: 0, width: 360, height: 740 });
        const tops = await page.locator('#person-story-modal .story-chip').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(tops).size).toBe(1);
        const h = await page.locator('#person-story-modal .story-chip').first().evaluate(e => e.getBoundingClientRect().height);
        expect(h).toBeGreaterThanOrEqual(44);
        // Close sits beside the title, never over the scrolling chips.
        const close = (await page.locator('#person-story-close-x').boundingBox())!;
        const row = (await page.locator('#person-story-modal .story-chips').boundingBox())!;
        expect(close.y + close.height).toBeLessThanOrEqual(row.y + 1);
        await context.close();
    });

    test('the person page: the own story leads on to the couple\'s chapter, folded to its first paragraph; the link unfolds it', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => {
            const p = window.Strom.DataManager.getPerson(id)!;
            const u = window.Strom.DataManager.getPartnership(p.partnerships[0])!;
            u.story!.text = 'Svatba byla v únoru.\n\nPak přišel mlýn.';
        }, jan);
        await page.evaluate((id) => window.Strom.UI.showPersonPage(id), jan);
        const w = page.locator('#person-page-modal');
        const jump = w.locator('.pp-story-cont .pp-story-jump');
        await expect(jump).toHaveText('Jan and Marie ↓');
        const chapter = w.locator('.pp-couple-story');
        await expect(chapter.locator('.pp-ch-rest')).toBeHidden();
        await expect(chapter.locator('.pp-ch-more .pp-st-closed')).toHaveText('Read all ▾');
        await expect(chapter.locator('.pp-ch-more .pp-st-open')).toBeHidden();
        await jump.click();
        await expect(chapter.locator('.pp-ch-rest')).toBeVisible();
        await expect(chapter.locator('.pp-ch-more .pp-st-open')).toHaveText('Collapse ▴');
        await expect(chapter.locator('.pp-ch-more .pp-st-closed')).toBeHidden();
        await expect(chapter).toBeFocused();
        await chapter.locator('.pp-ch-more').click();
        await expect(chapter.locator('.pp-ch-rest')).toBeHidden();
    });

    test('a partner with only the couple\'s story: the fold on the card, Story in the menu, the reader with that story alone', async ({ page }) => {
        await setup(page);
        const marie = await personId(page, 'P0002');
        // Approved with a new version waiting beside it (the couple's).
        await expect(card(page, 'Marie').locator(':scope > .card-story')).toBeVisible();
        await expect(card(page, 'Marie').locator(':scope > .card-story')).not.toHaveClass(/draft/);
        // A couple's story alone: the hollow corner, and the words say whose story it is.
        await expect(card(page, 'Marie').locator(':scope > .card-story')).toHaveClass(/couple/);
        await expect(card(page, 'Jan').locator(':scope > .card-story')).not.toHaveClass(/couple/);
        expect(await card(page, 'Marie').getAttribute('aria-label')).toContain('Story of the marriage · new version waiting');
        const actions = await page.evaluate((id) => window.Strom.UI.getPersonMenuActions(id).map((a: { action: string }) => a.action), marie);
        expect(actions).toContain('story');
        // The menu item is named after it, without a count (one chapter).
        const item = await page.evaluate((id) => window.Strom.UI.getPersonMenuActions(id).find((a: { action: string }) => a.action === 'story'), marie);
        expect(item).toMatchObject({ label: 'Story of the marriage' });
        expect(item.meta).toBeUndefined();
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), marie);
        const reader = page.locator('#person-story-modal');
        // The window is titled after it: no chips, no tinted surface, nothing to edit here.
        await expect(reader.locator('#person-story-heading')).toHaveText('Story of the marriage');
        await expect(reader.locator('.story-chips, .story-reader-ch--tint, .story-ch-mono')).toHaveCount(0);
        // The kicker stays on a chapter alone.
        await expect(reader.locator('.story-ch-kicker')).toHaveText('Story of the marriage · until 1874');
        await expect(reader.locator('.story-ch-note')).toHaveText('Edited in research.');
        await expect(reader.locator('.story-reader-couple-title')).toHaveText('Marie Vlková and Jan Vlk New version waiting');
        await expect(reader.locator('.story-reader-text')).toHaveText('Svatba byla v únoru.');
        // Her own story: none — no subtitle tag, nothing to edit or approve here.
        await expect(reader.locator('.audit-log-subtitle .story-nv-tag, .audit-log-subtitle .story-draft-tag')).toHaveCount(0);
        await expect(reader.locator('#person-story-edit, #person-story-approve')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // The couple's story as a draft: a pale fold, the reader marks it.
        await page.evaluate(() => {
            const data = structuredClone(window.Strom.DataManager.getData());
            for (const u of Object.values(data.partnerships) as { story?: { status?: string; draft?: unknown } }[]) {
                if (u.story) { u.story.status = 'draft'; delete u.story.draft; }
            }
            window.Strom.DataManager.replaceWithSourceData(data);
        });
        await expect(card(page, 'Marie').locator(':scope > .card-story')).toHaveClass(/draft/);
        expect(await card(page, 'Marie').getAttribute('aria-label')).toContain('Story of the marriage (draft)');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), marie);
        await expect(reader.locator('.story-reader-couple-title .story-draft-tag')).toHaveText('Draft');
        // A couple's draft is approved in the research at its chapter: the family by both partners.
        const approve = reader.locator('.story-reader-couple [data-approve-partnership]');
        await expect(approve).toHaveText('Approve in the research, opens in the research');
        await approve.click();
        expect(await launched(page)).toEqual([`strom-research://story?tree=${UUID}&person=P0001&partner=P0002&do=final`]);
    });

    test('a tree without the research: the couple\'s chapter does not say it is edited in the research', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        // The same family, exported as a plain GEDCOM (no research tree behind it).
        const plain = researchGed().split('\n').filter(l => !/^1 (SOUR STROM_RESEARCH|_STROM_)/.test(l)).join('\n');
        await dropFile(page, plain);
        await page.getByRole('button', { name: /Import as a new tree/ }).click();
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(card(page, 'Marie')).toBeVisible();
        expect(await page.evaluate(() => window.Strom.UI.activeResearchId())).toBeNull();
        const marie = await personId(page, 'P0002');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'story'), marie);
        const reader = page.locator('#person-story-modal');
        await expect(reader.locator('.story-reader-text')).toHaveText('Svatba byla v únoru.');
        await expect(reader.locator('.story-ch-kicker')).toHaveText('Story of the marriage · until 1874');
        await expect(reader.locator('.story-ch-note')).toHaveCount(0);
        await expect(reader.locator('[data-approve-partnership]')).toHaveCount(0);
    });

    test('keep the approved one', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.showStoryCompare({ personId: id }), jan);
        await page.locator('#story-compare-foot').getByRole('button', { name: 'Keep approved, opens in the research' }).click();
        expect(await launched(page)).toEqual([`strom-research://story?tree=${UUID}&person=P0001&do=keep`]);
        await expect(page.locator('#story-compare-foot')).toContainText('Choice sent to research: keep the approved one');
    });

    test('without the research\'s links: read-only, the way to decide said', async ({ page }) => {
        await setup(page, ['send', 'open']);
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.showStoryCompare({ personId: id }), jan);
        const foot = page.locator('#story-compare-foot');
        await expect(foot).toContainText('Decide in research on a computer.');
        await expect(foot.locator('button')).toHaveText(['Close']);
    });

    test('the person dialog: the summary, the banner, and Compare against the text in the field', async ({ page }) => {
        await setup(page);
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'edit'), jan);
        await expect(page.locator('#pm-sum-story')).toHaveText('— 3 words · New version waiting');
        await expect(page.locator('#pm-sum-story .story-nv-sum')).toHaveText('New version waiting');
        const banner = page.locator('#story-nv-edit');
        await expect(banner).toContainText('Research has a new version. Editing here won\'t discard it');
        await page.locator('#input-story').fill('Jan byl mlynář v Dolní Lhotě.');
        await page.locator('#story-nv-edit-compare').click();
        const cmp = page.locator('#story-compare-modal');
        await expect(cmp.locator('.sc-value--text del').first()).toContainText('Dolní');
        await page.keyboard.press('Escape');
        await expect(cmp).toHaveCount(0);
        await expect(page.locator('#person-modal')).toBeVisible();
        await expect(banner).toBeVisible();
    });

    test('"Awaiting action": a story item has its label and Compare; a couple names both', async ({ page }) => {
        await setup(page, ALL, [STORY_ITEM, COUPLE_ITEM]);
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        const rows = page.locator('.live-waiting-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.first().locator('.live-kind-story')).toHaveText('Story');
        await expect(rows.first().locator('.live-waiting-what')).toHaveText('StoryNew version of the story');
        await expect(rows.nth(1).locator('.live-waiting-who')).toHaveText('Jan Vlk and Marie Vlková');
        await expect(rows.nth(1).locator('.live-person-link')).toHaveCount(2);
        await rows.nth(1).getByRole('button', { name: 'Compare' }).click();
        const cmp = page.locator('#story-compare-modal');
        await expect(cmp.locator('.audit-log-subtitle')).toHaveText('Jan Vlk and Marie Vlková');
        await expect(cmp.locator('.sc-value--text ins').first()).toHaveText('1845 v Chlumech');
        await cmp.locator('#story-compare-foot').getByRole('button', { name: 'Use new version, opens in the research' }).click();
        expect(await launched(page)).toEqual([`strom-research://story?tree=${UUID}&person=P0001&partner=P0002&do=final`]);
    });

    test('the card: tooltip, aria-label, and the badge opens the comparison', async ({ page }) => {
        await setup(page, ALL, [STORY_ITEM]);
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-story')).toHaveText('Story · new version waiting');
        await expect(card(page, 'Jan').locator('.card-tooltip .tt-action')).toHaveText(['Awaiting action: New version of the story']);
        await expect(card(page, 'Jan')).toHaveAttribute('aria-label', /Story · new version waiting, waiting for an answer/);
        await card(page, 'Jan').locator('.card-signal').click();
        await expect(page.locator('#story-compare-modal')).toBeVisible();
        await expect(page.locator('.context-menu')).toHaveCount(0);
    });

    test('the family book: banners for the person and the couple, the comparison in the book\'s window, nothing printed', async ({ page, context }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showBookDialog());
        await page.locator('#book-privacy-mode').selectOption('full');
        const [book] = await Promise.all([
            context.waitForEvent('page'),
            page.locator('#book-modal').getByRole('button', { name: 'Open book' }).click(),
        ]);
        await book.waitForLoadState('domcontentloaded');
        await expect(book.locator('.book-nv')).toHaveCount(2);
        await expect(book.locator('.book-nv').first()).toContainText('New version waiting. Research wrote a new text on 2 Oct 2026.');
        await book.locator('.book-nv-compare').first().click();
        const dialog = book.locator('dialog.book-compare[open]');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.sc-value--text ins').first()).toHaveText('ve Lhotě, jako jeho otec');
        await dialog.getByRole('tab', { name: 'Approved' }).click();
        await expect(dialog.locator('.sc-panel--old')).toBeVisible();
        await expect(dialog.locator('a[data-compare-do="final"]')).toHaveAttribute('href', `strom-research://story?tree=${UUID}&person=P0001&do=final`);
        await dialog.locator('.bc-foot [data-compare-close]').click();
        await expect(dialog).toHaveCount(0);
        await book.emulateMedia({ media: 'print' });
        await expect(book.locator('.book-nv').first()).toBeHidden();
    });

    test('phone (360 px): the comparison without sideways scroll, the switch full width', async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        await seed(page, ALL);
        await openApp(page);
        await dropFile(page, researchGed());
        await expect(card(page, 'Jan')).toBeVisible();
        const jan = await personId(page, 'P0001');
        await page.evaluate((id) => window.Strom.UI.showStoryCompare({ personId: id }), jan);
        const cmp = page.locator('#story-compare-modal .modal');
        await expect(cmp).toBeVisible();
        const m = await cmp.evaluate((el) => {
            const content = el.querySelector<HTMLElement>('.modal-content')!;
            const tabs = el.querySelector<HTMLElement>('.sc-tabs')!.getBoundingClientRect();
            const body = content.getBoundingClientRect();
            return { overflow: content.scrollWidth - content.clientWidth, tabsWide: tabs.width >= body.width - 40 };
        });
        expect(m).toEqual({ overflow: 0, tabsWide: true });
        // On a phone the research's links are not offered.
        await expect(page.locator('#story-compare-foot')).toContainText('Decide in research on a computer.');
        await context.close();
    });
});

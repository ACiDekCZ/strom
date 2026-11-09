import { test, expect, Page, TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { openApp, createFirstPerson, waitForPersist, cardAction, personModal, card } from './helpers.js';
import { BRIDGE, HEAD, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * One mark of reliability per fact (spec 066 §2): after a GEDCOM from another
 * program the person card says where the facts came from, with one pill while
 * they all share the step and a pill at each fact once they differ; a tree
 * without an import shows no marks; the tree card's one status mark (spec 066
 * P4 §1) shows the weakest step after an import and the citations in a tree
 * of the app's own; on a phone a tap opens and closes the mark's text; a
 * research tree with origin shows a person's confirmation and proven facts.
 * The status tip names the sources cited at the fact: one, three of five and
 * the rest behind a link, none (spec 065 round 2). Invented data.
 */

function writeGedcom(testInfo: TestInfo, cited = false): string {
    const lines = [
        '0 HEAD', '1 SOUR FTM', '2 NAME Family Tree Maker', '2 VERS 24.0', '1 DATE 12 MAR 2024',
        '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Bonifác /Kvapilík/', '1 SEX M', '1 BIRT', '2 DATE 3 FEB 1850',
        ...(cited ? ['2 SOUR @S1@'] : []), '1 DEAT', '2 DATE 1912', '1 FAMS @F1@',
        '0 @I2@ INDI', '1 NAME Zdeslava /Kvapilíková/', '1 SEX F', '1 BIRT', '2 DATE 1852', '1 FAMS @F1@',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1874',
        ...(cited ? ['0 @S1@ SOUR', '1 TITL Matrika N Bramborov 1840–1870'] : []),
        '0 TRLR', '',
    ];
    const p = testInfo.outputPath('kvapilik.ged');
    writeFileSync(p, lines.join('\n'));
    return p;
}

async function importTree(page: Page, testInfo: TestInfo, cited = false): Promise<void> {
    await page.locator('#gedcom-input').setInputFiles(writeGedcom(testInfo, cited));
    await page.locator('#gedcom-result-modal #gedcom-new-tree-btn').click();
    const importDialog = page.locator('#import-tree-modal');
    await importDialog.locator('#import-tree-name').fill('Kvapilík');
    await importDialog.getByRole('button', { name: 'Import' }).click();
    const next = page.locator('#import-next-card');
    await expect(next).toBeVisible();
    await next.locator('.import-next-close').click();
    await expect(next).toHaveCount(0);
    await expect(card(page, 'Bonifác')).toBeVisible();
}

test.describe('reliability marks', () => {
    test('after an import: one pill in the origin row; after an edit, a pill at each fact', async ({ page }, testInfo) => {
        await openApp(page);
        await importTree(page, testInfo);
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        const origin = modal.locator('#pm-origin');
        await expect(origin).toBeVisible();
        await expect(origin).toContainText('All of this person\'s facts come from Family Tree Maker');
        await expect(origin.locator('.fact-status')).toHaveCount(1);
        await expect(origin.locator('.fact-status')).toHaveClass(/fact-status-import/);
        await expect(origin.locator('.fact-status')).toHaveText('From family tree');
        await expect(modal.locator('#events-list .fact-status')).toHaveCount(0);
        await expect(modal.locator('.form-group > label > .fact-status')).toHaveCount(0);

        await modal.locator('#input-birthdate').fill('4.2.1850');
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(modal).toBeHidden();
        await waitForPersist(page, '1850-02-04');

        await cardAction(page, 'Bonifác', 'edit');
        await expect(origin).toContainText('Facts marked “from family tree” come from Family Tree Maker');
        await expect(origin.locator('.fact-status')).toHaveCount(0);
        const rows = modal.locator('#events-list .event-row');
        await expect(rows.filter({ hasText: 'Death' }).locator('.fact-status-import')).toHaveCount(1);
        await expect(rows.filter({ hasText: 'Birth' }).locator('.fact-status')).toHaveCount(0);
        await expect(modal.locator('label[for="input-firstname"] .fact-status-import')).toBeVisible();
        await expect(modal.locator('#lastname-label .fact-status-import')).toBeVisible();

        // Setting off: no marks on the person card at all.
        await page.evaluate(() => window.Strom.UI.toggleReliabilityCard(false));
        await expect(origin).toBeHidden();
        await expect(modal.locator('.fact-status')).toHaveCount(0);
    });

    test('a tree without an import shows no marks', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Bonifác', 'Kvapilík');
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        await expect(modal).toBeVisible();
        await expect(modal.locator('#pm-origin')).toBeHidden();
        await expect(modal.locator('.fact-status')).toHaveCount(0);
        // No sources and no origin: the tree cards say nothing either.
        await expect(page.locator('.card-status-mark')).toHaveCount(0);
    });

    test('after an import with sources: the tree card\'s one mark is the import\'s, no stripes', async ({ page }, testInfo) => {
        await openApp(page);
        await importTree(page, testInfo, true);
        // On by default (spec 066 P4 §4), the import wins over the citation.
        const mark = card(page, 'Bonifác').locator(':scope > .card-status-mark');
        await expect(mark).toHaveCount(1);
        await expect(mark).toHaveClass(/\bcs-import\b/);
        await expect(mark.locator('.fs-dots i')).toHaveCount(2);
        await expect(mark.locator('.fs-dots i.on')).toHaveCount(0);
        await expect(card(page, 'Zdeslava').locator(':scope > .card-status-mark')).toHaveClass(/\bcs-import\b/);
        await expect(page.locator('.ev-stripe, .card-state, .card-rel-mark')).toHaveCount(0);
        // No native title: the words are the tooltip's.
        await expect(mark).not.toHaveAttribute('title', /.*/);
        // In the card's own pixels (the tree may be zoomed): a 12px pill inside the card.
        const size = await mark.evaluate((el: HTMLElement) => ({ h: el.offsetHeight, w: el.offsetWidth }));
        expect(size.h).toBe(12);
        expect(size.w).toBeGreaterThanOrEqual(18);
        const box = (await mark.boundingBox())!;
        const cardBox = (await card(page, 'Bonifác').boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
        expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
        // In words (spec 066 P4 §5): the import's short title, the cited source under it.
        const ttStatus = card(page, 'Bonifác').locator('.card-tooltip .tt-status');
        await expect(ttStatus).toContainText('From the family tree (unverified)');
        await expect(ttStatus.locator('.tt-status-sub')).toContainText('cited in the family tree, not verified in Strom');

        await page.evaluate(() => { window.Strom.SettingsManager.setCardSignal('status', false); window.Strom.TreeRenderer.render(); });
        // Off: gone from the cards (the tooltip keeps its words).
        await expect(page.locator('.person-card > .card-status-mark')).toHaveCount(0);
    });

    test('a tree of the app\'s own with sources: ●● backed, ●○ partly, a dotted frame for none', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(async () => {
            const p = (id: string, firstName: string, extra: Record<string, unknown>) => ({
                id, firstName, lastName: 'Kvapilík', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
            });
            await window.Strom.DataManager.importAsNewTree({
                persons: {
                    a: p('a', 'Bonifác', { birthDate: '1850', birthSourceIds: ['s1'], childIds: ['b', 'c'] }),
                    b: p('b', 'Radovan', { birthDate: '1872', deathDate: '1920', birthSourceIds: ['s1'], parentIds: ['a'] }),
                    c: p('c', 'Vavřinec', { birthDate: '1875', parentIds: ['a'] }),
                },
                partnerships: {},
                sources: { s1: { id: 's1', title: 'Matrika N Bramborov 1840–1870' } },
            } as never, 'Kvapilík');
        });
        const mark = (name: string) => card(page, name).locator(':scope > .card-status-mark');
        await expect(mark('Bonifác')).toHaveClass(/\bcs-p2\b/);
        await expect(mark('Radovan')).toHaveClass(/\bcs-p1\b/);
        await expect(mark('Vavřinec')).toHaveClass(/\bcs-none\b/);
        await expect(mark('Vavřinec').locator('.fs-dots')).toHaveCount(0);
        // Neutral: the dots take the light text colour, the dotted frame the line colour.
        const look = await mark('Bonifác').evaluate((el) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--text-light)';
            el.parentElement!.appendChild(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return { color: getComputedStyle(el).color, want };
        });
        expect(look.color).toBe(look.want);
    });

    test('a research tree with origin: a person\'s confirmation and proven facts', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Bonifác', 'Kvapilík');
        await page.evaluate(() => {
            const S = window.Strom;
            const p = S.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Bonifác')!;
            p.birthDate = '1850-02-03';
            p.birthStatus = 'proven';
            // The person's own changes of the family tree's values (the earlier value kept): theirs, ✓.
            const was = { value: 'Bonifácius' };
            p.researchOrigins = { name: { kind: 'user', was }, sex: { kind: 'user', was: { value: 'F' } }, birth: { kind: 'research' } };
            // The research's bridge names `origin`: the tree is the research's.
            S.UI.researchShowsOriginNow = () => true;
            S.UI.activeResearchId = () => 'r-kvapilik';
            S.SettingsManager.setBranchLegend(true);
            S.TreeRenderer.render();
        });
        // One meter (K5.1): proven by one reader is ●● on the card, the legend says what it means.
        const mark = card(page, 'Bonifác').locator(':scope > .card-status-mark');
        await expect(mark).toHaveClass(/\bcs-p2\b/);
        await expect(card(page, 'Bonifác')).toHaveAttribute('aria-label', /documented: birth/);
        await expect(page.locator('#legend-marks .legend-mark-row')).toContainText(['documented']);
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        await expect(modal).toBeVisible();
        await expect(modal.locator('#pm-origin')).toBeHidden();
        await expect(modal.locator('label[for="input-firstname"] .fact-status-human')).toHaveText('✓Confirmed');
        const birth = modal.locator('#events-list .event-row').filter({ hasText: 'Birth' }).locator('.fact-status');
        await expect(birth).toHaveClass(/fact-status-proven/);
        await expect(birth).toHaveText('Proven');
        await expect(birth.locator('.fs-dots i.on')).toHaveCount(1);
    });

    test('a research tree with origin stored: the card\'s mark is the same before its bridge answers and with it (1109)', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Bonifác', 'Kvapilík');
        const markOf = async (live: boolean) => {
            await page.evaluate((bridgeLive) => {
                const S = window.Strom;
                const data = S.DataManager.getData() as unknown as { sources?: Record<string, unknown> };
                data.sources = { s1: { id: 's1', title: 'Křty Bramborov 1850', quality: 3 } };
                const p = S.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Bonifác')!;
                p.birthDate = '1850-02-03';
                p.birthStatus = 'lead';
                p.birthSourceIds = ['s1'];
                p.sourceIds = ['s1'];
                p.researchOrigins = { name: { kind: 'research' }, birth: { kind: 'research' } };
                // The tree is the research's; its bridge answers with `origin`, or not yet / not at all.
                S.UI.researchShowsOriginNow = () => bridgeLive;
                S.UI.activeResearchId = () => 'r-kvapilik';
                S.TreeRenderer.render();
            }, live);
            const mark = card(page, 'Bonifác').locator(':scope > .card-status-mark');
            await expect(mark).toBeVisible();
            return mark.getAttribute('class');
        };
        const before = await markOf(false);
        expect(before).toMatch(/\bcs-res\b/);
        expect(await markOf(true)).toBe(before);
    });
});

test.describe('the mark on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a tap opens the mark\'s text and a second tap or a tap elsewhere closes it', async ({ page }, testInfo) => {
        await openApp(page);
        await importTree(page, testInfo);
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        const pill = modal.locator('#pm-origin .fact-status');
        await expect(pill).toBeVisible();
        const box = (await pill.boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(20);

        await pill.tap();
        const tip = page.locator('#status-tip');
        await expect(tip).toBeVisible();
        await expect(tip.locator('.st-head')).toContainText('From the family tree (unverified)');
        await expect(tip.locator('.st-help')).toHaveText('What the marks mean');
        await expect(pill).toHaveAttribute('aria-expanded', 'true');
        const tipBox = (await tip.boundingBox())!;
        expect(tipBox.x).toBeGreaterThanOrEqual(16);
        expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(390 - 16);
        expect((await tip.locator('.st-help').boundingBox())!.height).toBeGreaterThanOrEqual(44);

        await pill.tap();
        await expect(tip).toHaveCount(0);
        await expect(pill).toHaveAttribute('aria-expanded', 'false');

        await pill.tap();
        await expect(tip).toBeVisible();
        await modal.locator('.pm-header').tap({ position: { x: 10, y: 10 } });
        await expect(tip).toHaveCount(0);
        await expect(modal).toBeVisible();
    });
});

/** A research tree: the birth cited in five records, the death in one of them, the burial in none. */
function citedGed(): string {
    const src = (n: number) => [`0 @S${n}@ SOUR`, `1 TITL Matrika Dolní Bramborov ${1840 + n}`, `1 REFN S00${n}`];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        ...[1, 2, 3, 4, 5].flatMap(src),
        '0 @I1@ INDI', '1 NAME Bonifác /Kvapilík/', '1 SEX M', '1 REFN P0001',
        '1 BIRT', '2 DATE 3 FEB 1850', '2 _STROM_STATUS probable', ...[1, 2, 3, 4, 5].map(n => `2 SOUR @S${n}@`),
        '1 DEAT', '2 DATE 1912', '2 _STROM_STATUS probable', '2 SOUR @S1@',
        '1 BURI', '2 DATE 1912', '2 _STROM_STATUS possible',
        '0 TRLR',
    ].join('\n');
}

async function dropCited(page: Page, size = { width: 1440, height: 900 }): Promise<void> {
    await page.setViewportSize(size);
    await openApp(page);
    const dataTransfer = await page.evaluateHandle((content) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], 'kvapilik.ged', { type: 'text/plain' }));
        return dt;
    }, citedGed());
    for (const type of ['dragenter', 'dragover', 'drop']) await page.dispatchEvent('#tree-container', type, { dataTransfer });
    await expect(card(page, 'Bonifác')).toBeVisible();
}

test.describe('the status tip names the sources (spec 065 round 2)', () => {
    test('one source: its link; five: three and "and 2 more ›"; none: "No source"', async ({ page }) => {
        await dropCited(page);
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        const rows = modal.locator('#events-list .event-row');
        const tip = page.locator('#status-tip');
        const pillOf = (what: string) => rows.filter({ hasText: what }).locator('.fact-status').first();

        await pillOf('Death').click();
        await expect(tip).toBeVisible();
        await expect(tip.locator('.st-src-head')).toHaveText('Source');
        await expect(tip.locator('.st-src .st-src-title')).toHaveText(['Matrika Dolní Bramborov 1841']);
        await expect(tip.locator('.st-more')).toHaveCount(0);
        // No native title on the pill: the words are the tip's.
        await expect(pillOf('Death')).not.toHaveAttribute('title', /.*/);
        await pillOf('Death').click();
        await expect(tip).toHaveCount(0);

        await pillOf('Birth').click();
        await expect(tip.locator('.st-src-head')).toHaveText('Sources (5)');
        await expect(tip.locator('.st-src')).toHaveCount(3);
        await expect(tip.locator('.st-more')).toHaveText('and 2 more ›');
        await pillOf('Birth').click();
        await expect(tip).toHaveCount(0);

        await pillOf('Burial').click();
        await expect(tip.locator('.st-src')).toHaveCount(0);
        await expect(tip.locator('.st-src-none')).toHaveText('No source');
        // Esc closes the tip and gives the focus back to its pill.
        await page.keyboard.press('Escape');
        await expect(tip).toHaveCount(0);
        await expect(pillOf('Burial')).toBeFocused();
        await expect(modal).toBeVisible();
    });

    test('a source\'s link opens it in the source viewer; "and 2 more ›" the person\'s sources at those records', async ({ page }) => {
        await dropCited(page);
        await cardAction(page, 'Bonifác', 'edit');
        const modal = personModal(page);
        const birth = modal.locator('#events-list .event-row').filter({ hasText: 'Birth' }).locator('.fact-status').first();
        const tip = page.locator('#status-tip');
        await birth.click();
        await tip.locator('.st-src').first().click();
        await expect(tip).toHaveCount(0);
        await expect(page.locator('#source-viewer-modal')).toHaveClass(/active/);
        await expect(page.locator('#source-viewer-modal')).toContainText('Matrika Dolní Bramborov');
        await page.keyboard.press('Escape');
        await expect(page.locator('#source-viewer-modal')).not.toHaveClass(/active/);

        await birth.click();
        await tip.locator('.st-more').click();
        const sources = page.locator('#person-sources-modal');
        await expect(sources).toBeVisible();
        await expect(sources.locator('.person-source-row.is-focus')).toHaveCount(5);
    });

    test('the tree card\'s mark: its sources, and "Person\'s sources (n) ›" opens them with the cited ones marked', async ({ page }) => {
        await dropCited(page);
        const mark = card(page, 'Bonifác').locator(':scope > .card-status-mark');
        await expect(mark).toHaveAttribute('data-mark', 'status');
        await mark.click();
        const tip = page.locator('#status-tip');
        await expect(tip).toBeVisible();
        // A click on the mark is the tip's, not the card menu's.
        await expect(page.locator('.context-menu')).toHaveCount(0);
        await expect(tip.locator('.st-src')).toHaveCount(3);
        const more = tip.locator('.st-more');
        await expect(more).toHaveText("Person's sources (5) ›");
        await more.click();
        const sources = page.locator('#person-sources-modal');
        await expect(sources).toBeVisible();
        expect(await sources.locator('.person-source-row.is-focus').count()).toBeGreaterThanOrEqual(3);
        await expect(sources.locator('.person-source-row.is-focus').first()).toHaveAttribute('aria-current', 'true');
    });

    test('an import with a citation: the origin pill\'s tip says it was cited in the family tree', async ({ page }, testInfo) => {
        await openApp(page);
        await importTree(page, testInfo, true);
        await cardAction(page, 'Bonifác', 'edit');
        const pill = personModal(page).locator('#pm-origin .fact-status');
        await pill.click();
        const tip = page.locator('#status-tip');
        await expect(tip.locator('.st-src-head')).toHaveText('Cited in the family tree, not verified in Strom');
        await expect(tip.locator('.st-src .st-src-title')).toHaveText(['Matrika N Bramborov 1840–1870']);
    });
});

// ==================== Verify facts at one fact (spec 065 round 3, table 10z) ====================

/** Jan's birth probable and cited (E0001), his death proven (E0002); `extra`: lines under the birth. */
function verifyGed(extra: string[] = []): string {
    return researchGed(HEAD, [
        '1 BIRT', '2 DATE 3 FEB 1862', '2 PLAC Čapkov', '2 _STROM_STATUS probable', '2 _STROM_EID E0001', '2 SOUR @S0001@', ...extra,
        '1 DEAT', '2 DATE 1919', '2 _STROM_STATUS proven', '2 _STROM_EID E0002', '2 SOUR @S0001@',
    ]);
}

interface VerifyAsks {
    verify: { fact: string; dry?: boolean }[];
    confirm: { fact: string; confirm: boolean }[];
}

/** `/verify` and `/facts/confirm` of the research's bridge (the reply's place in the queue: `position`). */
async function verifyRoutes(page: Page, opts: { position?: number } = {}): Promise<VerifyAsks> {
    const asks: VerifyAsks = { verify: [], confirm: [] };
    const cors = { 'access-control-allow-origin': '*' };
    const json = (body: unknown) => ({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await page.route(url => url.href.startsWith(`${BRIDGE}/`) && url.pathname.endsWith('/verify'), (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
        const body = JSON.parse(route.request().postData() ?? '{}') as { fact: string; dry?: boolean };
        asks.verify.push(body);
        return route.fulfill(json({
            ok: true, ...(body.dry ? {} : { task: 'T0101', ...(opts.position ? { position: opts.position } : {}) }),
            facts: [{ fact: body.fact, kind: 'BIRT', how: 'read', record: { source: 'S0001', title: 'Oddací matrika Čapkov', page: 'fol. 41' } }],
            estimate: { sessions: 1, usd: 0.4 }, head: HEAD, parent: HEAD,
        }));
    });
    await page.route(url => url.href.startsWith(`${BRIDGE}/`) && url.pathname.endsWith('/facts/confirm'), (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
        const body = JSON.parse(route.request().postData() ?? '{}') as { fact: string; confirm: boolean };
        asks.confirm.push(body);
        return route.fulfill(json({ ok: true, fact: body.fact, owner: 'P0003', ...(body.confirm ? { confirmed: '2026-11-09' } : {}), head: HEAD, parent: HEAD }));
    });
    return asks;
}

/** The research's tree with its bridge saying `features`; Jan's person editor open. */
async function openVerifyTree(page: Page, opts: { features?: string[]; extra?: string[]; position?: number } = {}): Promise<VerifyAsks> {
    const ged = verifyGed(opts.extra);
    await fakeBridge(page, { features: opts.features ?? ['verify', 'facts.confirm'], treeGed: ged });
    const asks = await verifyRoutes(page, { position: opts.position });
    await openResearch(page, { ged });
    await poll(page);
    await cardAction(page, 'Jan', 'edit');
    await expect(personModal(page)).toBeVisible();
    return asks;
}

const factPill = (page: Page, what: string) =>
    personModal(page).locator('#events-list .event-row').filter({ hasText: what }).locator('.fact-status').first();
const vAct = (page: Page, act: string) => page.locator(`#status-tip [data-v-act="${act}"]`);

test.describe('verify facts at one fact (spec 065 round 3)', () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); });

    test('probable: Verify with the AI badge and the scan; the preview, Start, the pill waits with its place in the queue', async ({ page }) => {
        const asks = await openVerifyTree(page, { position: 2 });
        const pill = factPill(page, 'Birth');
        await expect(pill).toHaveClass(/fact-status-probable/);
        await pill.click();
        const tip = page.locator('#status-tip');
        await expect(tip).toBeVisible();
        await expect(vAct(page, 'verify')).toContainText('Verify');
        await expect(vAct(page, 'verify').locator('.research-ai-badge')).toHaveCount(1);
        await expect(vAct(page, 'scan')).toContainText('Confirm against the scan');
        await expect(vAct(page, 'scan')).not.toContainText('✓');
        await expect(vAct(page, 'scan').locator('.research-ai-badge')).toHaveCount(0);

        await vAct(page, 'verify').click();
        const preview = tip.locator('.st-preview');
        await expect(preview.locator('.st-preview-head')).toHaveText('Verify birth');
        await expect(preview.locator('.st-preview-label')).toHaveText(['What', 'How', 'Estimate']);
        await expect(preview).toContainText('AI reads the record Oddací matrika Čapkov, fol. 41');
        await expect(preview).toContainText('low · one known record');
        await expect(preview).toContainText('about 1 agent session');
        expect(asks.verify).toEqual([{ fact: 'E0001', dry: true }]);
        // The sources give way to the preview; Back and Start under it.
        await expect(tip).toHaveClass(/st-previewing/);
        await expect(vAct(page, 'back')).toBeVisible();
        await expect(vAct(page, 'start').locator('.research-ai-badge')).toHaveCount(1);
        await expect(vAct(page, 'start')).toBeEnabled();

        await vAct(page, 'back').click();
        await expect(tip.locator('.st-preview')).toHaveCount(0);
        await expect(vAct(page, 'verify')).toBeVisible();
        await vAct(page, 'verify').click();
        await vAct(page, 'start').click();
        await expect.poll(() => asks.verify.filter(a => !a.dry)).toEqual([{ fact: 'E0001' }]);
        await expect(pill).toHaveClass(/\bis-pending\b/);
        await expect(pill.locator('.fs-clock')).toHaveCount(1);
        await expect(pill).toHaveAttribute('aria-label', /waiting to be verified/);
        // The tip stays, now with the waiting row and no "Verify".
        await expect(tip.locator('.st-v-state')).toHaveText("Waiting to be verified · 2nd in the research's queue");
        await expect(vAct(page, 'verify')).toHaveCount(0);
        await expect(vAct(page, 'scan')).toBeVisible();

        // Confirmed from the scan while waiting: the research drops it from its task, the clock goes.
        await vAct(page, 'scan').click();
        await expect(pill).toHaveClass(/fact-status-human/);
        await expect(pill).not.toHaveClass(/\bis-pending\b/);
        await expect(pill.locator('.fs-clock')).toHaveCount(0);
        await expect(tip.locator('.st-v-state')).toHaveCount(0);
    });

    test('a fact waiting by the research\'s file: the clock and its place, no Verify', async ({ page }) => {
        await openVerifyTree(page, { extra: ['2 _STROM_VERIFY wait', '3 _POS 3'] });
        const pill = factPill(page, 'Birth');
        await expect(pill).toHaveClass(/\bis-pending\b/);
        await pill.click();
        await expect(page.locator('#status-tip .st-v-state')).toHaveText("Waiting to be verified · 3rd in the research's queue");
        await expect(vAct(page, 'verify')).toHaveCount(0);
    });

    test('proven: no Verify, the scan only', async ({ page }) => {
        await openVerifyTree(page);
        await factPill(page, 'Death').click();
        await expect(page.locator('#status-tip')).toBeVisible();
        await expect(vAct(page, 'scan')).toBeVisible();
        await expect(vAct(page, 'verify')).toHaveCount(0);
        await expect(page.locator('#status-tip .research-ai-badge')).toHaveCount(0);
    });

    test('kept by the research: the tip says why it stays and from which record', async ({ page }) => {
        await openVerifyTree(page, { extra: ['2 _STROM_CHECKED kept', '3 DATE 2026-11-02', '3 _WHY The page of the register is torn at the date.'] });
        await factPill(page, 'Birth').click();
        const reason = page.locator('#status-tip .st-v-reason');
        await expect(reason.locator('.st-v-head')).toContainText('Stays probable · verified by the research on');
        await expect(reason.locator('.st-v-why')).toHaveText('The page of the register is torn at the date.');
        await expect(reason.locator('.st-v-src')).toHaveText('Oddací matrika Čapkov');
        await expect(vAct(page, 'verify')).toBeVisible();
    });

    test('the scan confirms through the bridge; Undo takes it back with Redo in a toast', async ({ page }) => {
        const asks = await openVerifyTree(page);
        const pill = factPill(page, 'Birth');
        await pill.click();
        const tip = page.locator('#status-tip');
        await vAct(page, 'scan').click();
        await expect.poll(() => asks.confirm).toEqual([{ fact: 'E0001', confirm: true }]);
        await expect(pill).toHaveClass(/fact-status-human/);
        await expect(pill).toContainText('✓');
        await expect(tip).toBeVisible();
        await expect(tip.locator('.st-sentence')).toContainText('✓ Confirmed against the scan on');
        await expect(vAct(page, 'scan')).toHaveCount(0);
        await expect(vAct(page, 'verify')).toHaveCount(0);

        await vAct(page, 'undo').click();
        await expect.poll(() => asks.confirm.length).toBe(2);
        expect(asks.confirm[1]).toEqual({ fact: 'E0001', confirm: false });
        await expect(pill).toHaveClass(/fact-status-probable/);
        const toast = page.locator('.toast', { hasText: 'Confirmation undone' });
        await expect(toast).toBeVisible();
        await expect(toast.locator('.toast-action')).toHaveText('Redo');
        await toast.locator('.toast-action').click();
        await expect.poll(() => asks.confirm.length).toBe(3);
        expect(asks.confirm[2]).toEqual({ fact: 'E0001', confirm: true });
        await expect(pill).toHaveClass(/fact-status-human/);
    });

    test('the research\'s confirmation ends when the value changes here: no ✓, the scan again, none in the file for the research', async ({ page }) => {
        const asks = await openVerifyTree(page, { extra: ['2 _STROM_CONFIRMED 2026-10-01'] });
        const modal = personModal(page);
        await expect(factPill(page, 'Birth')).toHaveClass(/fact-status-human/);
        await modal.locator('#input-birthdate').fill('3.2.1863');
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(modal).toBeHidden();
        await waitForPersist(page, '1863-02-03');

        await cardAction(page, 'Jan', 'edit');
        const pill = factPill(page, 'Birth');
        await expect(pill).toHaveClass(/fact-status-probable/);
        await expect(pill).not.toHaveClass(/fact-status-human/);
        await pill.click();
        await expect(vAct(page, 'scan')).toBeVisible();
        await expect(vAct(page, 'undo')).toHaveCount(0);
        // The edit is a change, never a confirmation sent to the research.
        expect(asks.confirm).toEqual([]);

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.evaluate(() => window.Strom.UI.downloadResearchGedcom(window.Strom.DataManager.getCurrentTreeId()!)),
        ]);
        const ged = readFileSync((await download.path())!, 'utf8');
        const birth = ged.split(/\r?\n(?=1 )/).find(b => b.startsWith('1 BIRT') && b.includes('E0001'))!;
        expect(birth).toMatch(/^2 DATE 3 FEB 1863$/m);
        expect(birth).not.toMatch(/_STROM_CONFIRMED/);

        // The same after a reload.
        await page.reload();
        await expect(card(page, 'Jan')).toBeVisible();
        await cardAction(page, 'Jan', 'edit');
        await expect(factPill(page, 'Birth')).toHaveClass(/fact-status-probable/);
    });

    test('a research without verify: no action of the AI', async ({ page }) => {
        await openVerifyTree(page, { features: ['facts.confirm'] });
        await factPill(page, 'Birth').click();
        const tip = page.locator('#status-tip');
        await expect(tip).toBeVisible();
        await expect(vAct(page, 'scan')).toBeVisible();
        await expect(vAct(page, 'verify')).toHaveCount(0);
        await expect(tip.locator('.research-ai-badge')).toHaveCount(0);
        await expect(tip.locator('.st-v-aside')).toHaveCount(0);
    });

    test('without a research: the scan and the sentence with the way to it, no AI badge', async ({ page }) => {
        await dropCited(page);
        await cardAction(page, 'Bonifác', 'edit');
        await factPill(page, 'Birth').click();
        const tip = page.locator('#status-tip');
        await expect(tip).toBeVisible();
        await expect(vAct(page, 'scan')).toContainText('Confirm against the scan');
        await expect(vAct(page, 'scan')).not.toContainText('✓');
        await expect(vAct(page, 'verify')).toHaveCount(0);
        await expect(tip.locator('.st-v-aside')).toContainText('With the ancestor research an AI agent verifies the fact in the registers itself.');
        await expect(tip.locator('.research-ai-badge')).toHaveCount(0);
        // The app's own confirmation: Undo, then Redo.
        await vAct(page, 'scan').click();
        await expect(factPill(page, 'Birth')).toHaveClass(/fact-status-human/);
        await vAct(page, 'undo').click();
        await expect(factPill(page, 'Birth')).toHaveClass(/fact-status-probable/);
        await expect(page.locator('.toast', { hasText: 'Confirmation undone' }).locator('.toast-action')).toHaveText('Redo');
    });
});

test.describe('verify facts at one fact in German', () => {
    test.use({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });

    test('the preview\'s labels stand in one column, "Schätzung" unbroken', async ({ page }) => {
        await openVerifyTree(page);
        await personModal(page).locator('#events-list .event-row .fact-status').first().click();
        await vAct(page, 'verify').click();
        const labels = page.locator('#status-tip .st-preview-label');
        await expect(labels).toHaveText(['Was', 'Wie', 'Schätzung']);
        const boxes = await labels.evaluateAll(els => els.map(el => {
            const r = el.getBoundingClientRect();
            const value = el.nextElementSibling!.getBoundingClientRect();
            const text = document.createRange();
            text.selectNodeContents(el);
            const lines = new Set(Array.from(text.getClientRects()).map(q => Math.round(q.top))).size;
            return { x: r.left, w: r.width, scroll: el.scrollWidth, valueX: value.left, lines };
        }));
        for (const b of boxes) {
            expect(b.lines).toBe(1);
            expect(b.x).toBeCloseTo(boxes[0].x, 0);
            expect(b.valueX).toBeCloseTo(boxes[0].valueX, 0);
            expect(b.scroll).toBeLessThanOrEqual(Math.ceil(b.w));
        }
    });
});

test.describe('verify facts at one fact on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    /** The tip's buttons `acts`: 44 px high at least, each across the row of actions, one under another, the tip on the screen. */
    async function stacked(page: Page, acts: string[]): Promise<void> {
        const tip = page.locator('#status-tip');
        const row = (await tip.locator('.st-acts').boundingBox())!;
        let below = -1;
        for (const act of acts) {
            const box = (await vAct(page, act).boundingBox())!;
            expect(box.height, act).toBeGreaterThanOrEqual(44);
            expect(box.width, act).toBeGreaterThanOrEqual(row.width - 1);
            expect(box.y, act).toBeGreaterThanOrEqual(below);
            below = box.y + box.height;
        }
        const tipBox = (await tip.boundingBox())!;
        expect(tipBox.x).toBeGreaterThanOrEqual(0);
        expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(390);
    }

    test('without a research: the scan 44 px across the tip, the way to the research 44 px; Undo the same', async ({ page }) => {
        await dropCited(page, { width: 390, height: 844 });
        await cardAction(page, 'Bonifác', 'edit');
        await factPill(page, 'Birth').tap();
        await expect(vAct(page, 'scan')).toBeVisible();
        await stacked(page, ['scan']);
        expect((await page.locator('#status-tip .st-v-promo').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await vAct(page, 'scan').tap();
        await expect(vAct(page, 'undo')).toBeVisible();
        await stacked(page, ['undo']);
    });

    test('Verify and the scan, Back and Start: 44 px, one under another across the tip', async ({ page }) => {
        const ged = verifyGed();
        await fakeBridge(page, { features: ['verify', 'facts.confirm'], treeGed: ged });
        await verifyRoutes(page);
        await openResearch(page, { ged });
        // A touch screen does not ask the bridge by itself (onComputer): its word is given here, for the layout.
        await page.evaluate(() => {
            (window.Strom.UI as unknown as { researchStatusOf: () => unknown }).researchStatusOf = () => ({ features: ['verify', 'facts.confirm'] });
        });
        await cardAction(page, 'Jan', 'edit');
        await factPill(page, 'Birth').tap();
        await expect(vAct(page, 'verify')).toBeVisible();
        await stacked(page, ['verify', 'scan']);
        await vAct(page, 'verify').tap();
        await expect(vAct(page, 'start')).toBeEnabled();
        await stacked(page, ['back', 'start']);
    });
});

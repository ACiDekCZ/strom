import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';
import {
    fakeBridge, fakeSurnames, openResearch, poll, touchScreenNow, FakeBridge, FakeSurnames, UUID, HEAD, NEW_HEAD,
} from './research-bridge.js';

/**
 * Surname spellings suggested by the research (spec 021 §4, K2.1–K2.6): the
 * Surname spellings dialog of a research tree asks the research's bridge
 * (`GET /surnames`, feature `surnames.suggest`) which spellings belong
 * together, documented by its records or by the spelling rules; each one is
 * accepted (a group of the tree, Undo in the toast) or rejected (kept in the
 * tree, listed, taken back). Invented data: the Lhoták family of Lhota.
 */

const SUGGEST = ['surnames.suggest', 'surnames.read'];

/** The research's Lhoták family: Lhoták = Lhotak linked already, other spellings not yet. */
function lhotakGed(opts: { head?: string; groups?: string[]; rejections?: string[]; name?: string } = {}): string {
    const indi = (ref: string, name: string, sex: 'M' | 'F', birth: string, extra: string[] = []): string[] => [
        `0 @${ref}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, '1 BIRT', `2 DATE ${birth}`, ...extra,
        `1 REFN ${ref}`, '2 TYPE strom-research',
    ];
    const note = (marker: string, groups: string[] | undefined): string[] =>
        groups ? [`1 NOTE ${marker}`, ...groups.map(g => `2 CONT ${g}`)] : [];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 27 SEP 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${opts.head ?? HEAD}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8',
        `1 NOTE ${opts.name ?? 'Lhotákovi'}`,
        ...note('Strom surname-variant groups', opts.groups ?? ['Lhoták | Lhotak']),
        ...note('Strom surname-variant rejections', opts.rejections ?? []),
        ...indi('P0001', 'Jan /Lhoták/', 'M', '1820', ['1 FAMS @F0001@']),
        ...indi('P0002', 'Marie /Lhotáková/', 'F', '1825', ['1 FAMS @F0001@']),
        ...indi('P0003', 'Josef /Lhottak/', 'M', '1852', ['1 FAMC @F0001@']),
        ...indi('P0004', 'Václav /Lhotak/', 'M', '1855', ['1 FAMC @F0001@']),
        ...indi('P0005', 'Karel /Vondráček/', 'M', '1850'),
        ...indi('P0006', 'Tomáš /Wondraczek/', 'M', '1848'),
        ...indi('P0007', 'Petr /Fiala/', 'M', '1840'),
        ...indi('P0008', 'Pavel /Fialla/', 'M', '1842'),
        ...indi('P0009', 'Jiří /Dvořák/', 'M', '1830'),
        ...indi('P0010', 'Jakub /Dvorak/', 'M', '1832'),
        ...indi('P0011', 'Martin /Novák/', 'M', '1835'),
        ...indi('P0012', 'Matěj /Novak/', 'M', '1836'),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@', '1 CHIL @P0004@',
        '0 @S0001@ SOUR', '1 TITL Matrika narozených Lhota 1850–1860', '1 PAGE s. 12', '1 REFN S0001', '1 TEXT Josephus Lhottak',
        '0 TRLR',
    ].join('\n');
}

/** The research's suggestions for the Lhoták family: two documented, three by the rules (two of them diacritics only). */
const LHOTTAK = {
    id: 'lhotak|lhotak|lhottak', forms: ['Lhoták', 'Lhottak'], level: 'documented', extends: ['Lhoták', 'Lhotak'],
    rule: 'same-person', persons: 41, places: ['Lhota'], from: 1780, to: 1881,
    evidence: [
        { person: 'P0003', name: 'Josef Lhoták', form: 'Lhottak', citation: 'Matrika narozených Lhota 1850–1860, s. 12', source: 'S0001', quote: 'Josephus Lhottak' },
        { person: 'P0004', name: 'Václav Lhoták', form: 'Lhottak', citation: 'Matrika zemřelých Lhota 1870–1890, s. 3' },
    ],
    evidenceMore: 3,
};
const FIALA = {
    id: 'fiala|fialla', forms: ['Fiala', 'Fialla'], level: 'documented', rule: 'same-person', persons: 9, places: ['Lhotka'], from: 1840, to: 1870,
    evidence: [{ person: 'P0008', name: 'Pavel Fiala', form: 'Fialla', citation: 'Matrika narozených Lhotka 1840–1850, s. 7' }],
};
const VONDRACEK = {
    id: 'vondracek|wondraczek', forms: ['Vondráček', 'Wondraczek'], level: 'rules', rule: 'phonetic', keys: ['w-v', 'cz-c'],
    persons: 18, places: ['Lhotka'], from: 1790, to: 1860,
};
const DVORAK = { id: 'dvorak|dvorak', forms: ['Dvořák', 'Dvorak'], level: 'rules', rule: 'spelling', keys: ['diacritics'], persons: 4, places: ['Lhota'] };
const NOVAK = { id: 'novak|novak', forms: ['Novák', 'Novak'], level: 'rules', rule: 'spelling', keys: ['diacritics'], persons: 3, places: ['Lhota'] };
const ALL = [LHOTTAK, FIALA, VONDRACEK, DVORAK, NOVAK];

const modal = (page: Page): Locator => page.locator('#surnames-modal');
const section = (page: Page): Locator => page.locator('#surnames-suggest');
const level = (page: Page, which: 'documented' | 'rules'): Locator => section(page).locator(`.ss-level[data-level="${which}"]`);
const suggestion = (page: Page, id: string): Locator => section(page).locator(`.ss-card[data-id="${id}"]`);
/** The tree's groups, each one's forms in alphabetical order (the order inside a group means nothing). */
const groups = (page: Page): Promise<string[][]> =>
    page.evaluate(() => (window.Strom.DataManager.getData().surnameVariants ?? []).map(g => [...g].sort((a, b) => a.localeCompare(b))));
const rejections = (page: Page): Promise<{ forms: string[]; id?: string }[]> =>
    page.evaluate(() => (window.Strom.DataManager.getData().surnameRejections ?? []).map(r => ({ forms: r.forms, ...(r.id ? { id: r.id } : {}) })));

async function research(page: Page, init: { features?: string[]; surnames?: Partial<FakeSurnames>; ged?: string } = {}): Promise<FakeBridge> {
    const b = await fakeBridge(page, {
        features: init.features ?? SUGGEST,
        surnames: fakeSurnames({ suggestions: ALL, ...init.surnames }),
        treeGed: init.ged ?? lhotakGed(),
    });
    await openResearch(page, { ged: init.ged ?? lhotakGed() });
    await poll(page);
    return b;
}

async function openDialog(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showSurnamesDialog());
    await expect(modal(page)).toBeVisible();
}

/** The dialog open, the suggestions asked and shown. */
async function suggestions(page: Page): Promise<void> {
    await openDialog(page);
    await section(page).getByRole('button', { name: 'Suggest from the research', exact: true }).click();
    await expect(section(page).locator('.ss-card').first()).toBeVisible();
}

test.describe('surname spellings: suggestions from the research', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('a tree without a research, and a research that does not suggest: no section, the dialog as before', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Lhoták');
        await openDialog(page);
        await expect(section(page)).toBeHidden();
        await expect(modal(page).locator('.surnames-modal')).toHaveClass(/modal--md/);
        await expect(modal(page).locator('#surnames-manual-toggle')).toBeHidden();
        await page.evaluate(() => window.Strom.UI.closeSurnamesDialog());

        const b = await research(page, { features: [] });
        await openDialog(page);
        await expect(section(page)).toBeHidden();
        await expect(modal(page).locator('.surnames-modal')).not.toHaveClass(/is-suggest/);
        await expect(modal(page).locator('.surnames-add-title')).toBeVisible();
        expect(b.surnames!.asks).toBe(0);
    });

    test('a research that turns out not to know /surnames (404): the section goes, nothing else changes', async ({ page }) => {
        const b = await research(page, { surnames: { replies: [{ status: 404, body: { error: 'Not found.', code: 'route.unknown' } }] } });
        await openDialog(page);
        await expect(modal(page).locator('.surnames-modal')).toHaveClass(/modal--lg/);
        await section(page).getByRole('button', { name: 'Suggest from the research', exact: true }).click();
        await expect(section(page)).toBeHidden();
        await expect(modal(page).locator('.surnames-modal')).toHaveClass(/modal--md/);
        await expect(modal(page).locator('.surnames-add')).toBeVisible();
        expect(b.surnames!.asks).toBe(1);
    });

    test('both levels: the forms with their people, the reason, the evidence, the people newly linked; manual linking folded', async ({ page }) => {
        const b = await research(page);
        await openDialog(page);
        // First opening: the button and its hint, nothing asked yet; manual linking open.
        await expect(section(page).locator('.ss-note')).toHaveText(/compares the entries in its records/);
        await expect(modal(page).locator('.surnames-add')).toBeVisible();
        expect(b.surnames!.asks).toBe(0);

        await section(page).getByRole('button', { name: 'Suggest from the research', exact: true }).click();
        await expect(section(page).locator('.ss-counts')).toHaveText('2 documented, 3 by rules');
        expect(b.surnames!.asks).toBe(1);
        await expect(level(page, 'documented').locator('h4')).toHaveText('Documented 2');
        await expect(level(page, 'rules').locator('h4')).toHaveText('By rules 3');

        // Documented, extending the one group the tree has: its forms first, the new one marked.
        const lhottak = suggestion(page, LHOTTAK.id);
        await expect(lhottak.locator('.ss-extends')).toHaveText('Extends the group Lhoták = Lhotak');
        await expect(lhottak.locator('.ss-form-name')).toHaveText(['Lhoták', 'Lhotak', '+ Lhottak']);
        await expect(lhottak.locator('.ss-form.is-new .ss-form-count')).toHaveText('1 in the tree');
        await expect(lhottak.locator('.ss-tag')).toHaveText('Documented');
        await expect(lhottak.locator('.ss-reason-text')).toHaveText('the same person written differently in the records');
        await expect(lhottak.locator('.ss-evidence li')).toHaveText(['Josef Lhoták – written “Lhottak” · Matrika narozených Lhota 1850–1860, s. 12']);
        await expect(lhottak.locator('.ss-meta')).toHaveText('Links 1 person with 3 people named Lhoták · Lhota · 1780–1881');
        // The links of the evidence are text links: no button padding shifting them in from the edge.
        const edges = await lhottak.locator('.ss-evidence').evaluate(ev => {
            const left = ev.querySelector('ul')!.getBoundingClientRect().left;
            const textLeft = (el: Element): number => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().left; };
            return { toggle: textLeft(ev.querySelector('.ss-evidence-toggle')!) - left, source: getComputedStyle(ev.querySelector('.ss-source')!).paddingLeft };
        });
        expect(Math.abs(edges.toggle)).toBeLessThanOrEqual(1);
        expect(edges.source).toBe('0px');
        // The evidence unfolds; the citation of a source the tree has opens it.
        await lhottak.locator('.ss-evidence-toggle').click();
        await expect(lhottak.locator('.ss-evidence li')).toHaveCount(2);
        await expect(lhottak.locator('.ss-evidence-more')).toHaveText('and 3 more records');
        await lhottak.locator('.ss-source').click();
        await expect(page.locator('#source-viewer-modal')).toBeVisible();
        await expect(page.locator('#source-viewer-modal')).toContainText('Matrika narozených Lhota 1850–1860');
        await page.evaluate(() => window.Strom.UI.closeSourceViewer());

        // By the rules: the spelling keys and where, no evidence.
        const vondracek = suggestion(page, VONDRACEK.id);
        await expect(vondracek.locator('.ss-tag')).toHaveText('Candidate by rules');
        await expect(vondracek.locator('.ss-reason-text')).toHaveText('w ↔ v, cz ↔ č · Lhotka 1790–1860');
        await expect(vondracek.locator('.ss-evidence')).toHaveCount(0);
        await expect(vondracek.locator('.ss-meta')).toHaveText('Links 1 person with 1 person named Vondráček · Lhotka · 1790–1860');
        await expect(suggestion(page, DVORAK.id).locator('.ss-reason-text')).toHaveText('only the diacritics differ');
        await expect(level(page, 'rules').locator('.ss-agent-hint')).toBeVisible();

        // With suggestions there, manual linking is a folded row.
        const manual = modal(page).locator('#surnames-manual-toggle');
        await expect(manual).toHaveAttribute('aria-expanded', 'false');
        await expect(modal(page).locator('.surnames-add')).toBeHidden();
        await expect(modal(page).locator('#surnames-link')).toBeHidden();
        await manual.click();
        await expect(modal(page).locator('.surnames-add')).toBeVisible();

        // Opened again: the last suggestions at once, without asking.
        await page.evaluate(() => window.Strom.UI.closeSurnamesDialog());
        await openDialog(page);
        await expect(section(page).locator('.ss-card')).toHaveCount(5);
        expect(b.surnames!.asks).toBe(1);
        await section(page).getByRole('button', { name: 'Load again', exact: true }).click();
        await expect.poll(() => b.surnames!.asks).toBe(2);
    });

    test('accepting extends the one group (not a second one); Undo in the toast takes it back', async ({ page }) => {
        await research(page);
        await suggestions(page);
        await suggestion(page, LHOTTAK.id).getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(suggestion(page, LHOTTAK.id)).toHaveCount(0);
        expect(await groups(page)).toEqual([['Lhotak', 'Lhoták', 'Lhottak']]);
        const group = modal(page).locator('.surname-group');
        await expect(group).toHaveCount(1);
        await expect(group).toHaveClass(/is-new/);
        await expect(group.locator('.surname-group-names')).toHaveText(/^(Lhotak|Lhoták|Lhottak)( {2}= {2}(Lhotak|Lhoták|Lhottak)){2}$/);
        await expect(group.locator('.ss-badge')).toHaveText('new');
        // Search finds them together now.
        expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Lhottak').length)).toBe(4);

        const toast = page.locator('.toast', { hasText: 'Linked: Lhoták = Lhottak.' });
        await toast.locator('.toast-action', { hasText: 'Undo' }).click({ timeout: 5000 });
        expect(await groups(page)).toEqual([['Lhotak', 'Lhoták']]);
        await expect(suggestion(page, LHOTTAK.id)).toHaveCount(1);
        await expect(modal(page).locator('.surname-group')).not.toHaveClass(/is-new/);
    });

    test('rejecting: kept in the tree, listed with its date, never offered again (also on Load again); taken back from the list', async ({ page }) => {
        const b = await research(page);
        await suggestions(page);
        await suggestion(page, VONDRACEK.id).getByRole('button', { name: 'Reject', exact: true }).click();
        await expect(suggestion(page, VONDRACEK.id)).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'This suggestion will not be offered again.' })).toBeVisible();
        expect(await rejections(page)).toEqual([{ forms: ['Vondráček', 'Wondraczek'], id: VONDRACEK.id }]);
        expect(await groups(page)).toEqual([['Lhotak', 'Lhoták']]);

        const fold = modal(page).locator('#surnames-rejected-toggle');
        await expect(fold).toHaveText(/Rejected suggestions: 1/);
        await fold.click();
        const row = modal(page).locator('.ss-rejected-row');
        await expect(row.locator('.ss-rejected-forms')).toHaveText('Vondráček = Wondraczek');
        await expect(row.locator('.ss-quiet').first()).toHaveText(/^rejected on /);

        // Asked again: still not offered.
        await section(page).getByRole('button', { name: 'Load again', exact: true }).click();
        await expect.poll(() => b.surnames!.asks).toBe(2);
        await expect(section(page).locator('.ss-card')).toHaveCount(4);
        await expect(suggestion(page, VONDRACEK.id)).toHaveCount(0);

        // Taken back: offered again, the list gone.
        await row.getByRole('button', { name: 'Undo', exact: true }).click();
        expect(await rejections(page)).toEqual([]);
        await expect(suggestion(page, VONDRACEK.id)).toHaveCount(1);
        await expect(modal(page).locator('#surnames-rejected')).toBeHidden();
    });

    test('Undo in the toast of a rejection offers it again', async ({ page }) => {
        await research(page);
        await suggestions(page);
        await suggestion(page, FIALA.id).getByRole('button', { name: 'Reject', exact: true }).click();
        await page.locator('.toast', { hasText: 'This suggestion will not be offered again.' })
            .locator('.toast-action', { hasText: 'Undo' }).click({ timeout: 5000 });
        expect(await rejections(page)).toEqual([]);
        await expect(suggestion(page, FIALA.id)).toHaveCount(1);
    });

    test('at once: all documented, and all that differ only in diacritics, each one Undo', async ({ page }) => {
        await research(page);
        await suggestions(page);
        const diacritics = level(page, 'rules').locator('.ss-accept-all');
        await expect(diacritics).toHaveText('Accept all that differ only in diacritics (2)');
        await diacritics.click();
        await expect(level(page, 'rules').locator('.ss-card')).toHaveCount(1);
        expect(await groups(page)).toEqual([['Lhotak', 'Lhoták'], ['Dvorak', 'Dvořák'], ['Novak', 'Novák']]);
        const toast = page.locator('.toast', { hasText: '2 spelling groups linked.' });
        await toast.locator('.toast-action', { hasText: 'Undo' }).click({ timeout: 5000 });
        expect(await groups(page)).toEqual([['Lhotak', 'Lhoták']]);
        await expect(level(page, 'rules').locator('.ss-card')).toHaveCount(3);

        await level(page, 'documented').getByRole('button', { name: 'Accept all documented (2)', exact: true }).click();
        await expect(level(page, 'documented').locator('.ss-card')).toHaveCount(0);
        await expect(level(page, 'documented').locator('.ss-note')).toHaveText('No documented suggestion.');
        expect(await groups(page)).toEqual([['Lhotak', 'Lhoták', 'Lhottak'], ['Fiala', 'Fialla']]);
    });

    test('an empty level is one sentence; nothing new at all is one sentence too', async ({ page }) => {
        const b = await research(page, { surnames: { suggestions: [LHOTTAK, FIALA] } });
        await suggestions(page);
        await expect(level(page, 'rules').locator('.ss-note')).toHaveText('No suggestion by rules.');
        await expect(level(page, 'rules').locator('.ss-card, .ss-accept-all, .ss-agent-hint')).toHaveCount(0);

        b.surnames!.suggestions = [];
        await section(page).getByRole('button', { name: 'Load again', exact: true }).click();
        await expect(section(page).locator('.ss-nothing')).toHaveText('The research found no further spellings that belong together.');
        await expect(section(page).locator('.ss-level')).toHaveCount(0);
        await expect(section(page).locator('.ss-counts')).toHaveText('0 documented, 0 by rules');
    });

    test('decided in the research: a quiet label on the group and on the rejection; the quiet send state otherwise', async ({ page }) => {
        await research(page, {
            ged: lhotakGed({ groups: ['Lhoták | Lhotak', 'Dvořák | Dvorak'], rejections: ['Fiala | Fialla'] }),
            surnames: {
                groups: [{ forms: ['Lhoták', 'Lhotak'], by: 'research' }, { forms: ['Dvořák', 'Dvorak'], by: 'app' }],
                rejected: [{ forms: ['Fiala', 'Fialla'], by: 'research' }],
            },
        });
        await suggestions(page);
        // The research's rejection and the groups the tree has are not offered.
        await expect(section(page).locator('.ss-card')).toHaveCount(3);
        await expect(suggestion(page, FIALA.id)).toHaveCount(0);
        await expect(suggestion(page, DVORAK.id)).toHaveCount(0);

        const lhotak = modal(page).locator('.surname-group', { hasText: 'Lhotak' });
        await expect(lhotak.locator('.ss-quiet')).toHaveText(['decided in the research']);
        const dvorak = modal(page).locator('.surname-group', { hasText: 'Dvorak' });
        await expect(dvorak.locator('.ss-quiet')).toHaveText(['in the research']);
        await modal(page).locator('#surnames-rejected-toggle').click();
        await expect(modal(page).locator('.ss-rejected-row .ss-quiet')).toHaveText(['decided in the research']);
    });

    test('the quiet send state: new ones go with the next sending of changes, then they are in the research', async ({ page }) => {
        const b = await research(page);
        b.syncReply = { status: 200, body: { ok: true, inbox: false, changes: 1, applied: 1, input: 'I0050' } };
        b.onWrite = () => ({ head: NEW_HEAD, ged: lhotakGed({ head: NEW_HEAD, groups: ['Lhoták | Lhotak', 'Fiala | Fialla'], rejections: ['Vondráček | Wondraczek'] }) });
        await suggestions(page);
        await expect(modal(page).locator('.surname-group .ss-quiet')).toHaveText(['in the research']);

        await suggestion(page, FIALA.id).getByRole('button', { name: 'Accept', exact: true }).click();
        await suggestion(page, VONDRACEK.id).getByRole('button', { name: 'Reject', exact: true }).click();
        const fiala = modal(page).locator('.surname-group', { hasText: 'Fialla' });
        await expect(fiala.locator('.ss-pending')).toHaveText('goes to the research with the next sending of changes');
        await modal(page).locator('#surnames-rejected-toggle').click();
        const row = modal(page).locator('.ss-rejected-row');
        await expect(row.locator('.ss-pending')).toHaveText('goes to the research with the next sending of changes');

        // Sent and written: both in the research now, no longer waiting.
        await page.evaluate(() => window.Strom.UI.researchSendNow({ previewed: true }));
        await expect.poll(() => b.posts.length).toBe(1);
        expect(b.posts[0]).toContain('2 CONT Fiala | Fialla');
        expect(b.posts[0]).toContain('1 NOTE Strom surname-variant rejections\n2 CONT Vondráček | Wondraczek');
        await expect(fiala.locator('.ss-in-research')).toHaveText('in the research');
        await expect(fiala.locator('.ss-pending')).toHaveCount(0);
        await expect(row.locator('.ss-in-research')).toHaveText('in the research');
        await expect(row.locator('.ss-pending')).toHaveCount(0);
    });

    test('without surnames.read: no send state at all (the research does not read the groups)', async ({ page }) => {
        await research(page, { features: ['surnames.suggest'] });
        await suggestions(page);
        await suggestion(page, FIALA.id).getByRole('button', { name: 'Accept', exact: true }).click();
        await expect(modal(page).locator('.surname-group')).toHaveCount(2);
        await expect(modal(page).locator('.surname-group .ss-pending, .surname-group .ss-in-research')).toHaveCount(0);
    });

    test('read-only: the suggestions can be looked at, nothing to accept, reject or unlink; one sentence says so', async ({ page }) => {
        await research(page);
        await suggestions(page);
        await suggestion(page, VONDRACEK.id).getByRole('button', { name: 'Reject', exact: true }).click();
        await page.evaluate(() => window.Strom.UI.closeSurnamesDialog());
        const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId()!);
        await page.evaluate((id) => window.Strom.UI.toggleTreeLock(id), treeId);
        await openDialog(page);
        await expect(section(page).locator('.ss-readonly')).toHaveText('The tree is read-only. Suggestions can be viewed but not accepted or rejected.');
        await expect(section(page).locator('.ss-card')).toHaveCount(4);
        await expect(section(page).locator('.ss-accept, .ss-reject, .ss-accept-all')).toHaveCount(0);
        await expect(modal(page).locator('.surname-unlink')).toHaveCount(0);
        await modal(page).locator('#surnames-rejected-toggle').click();
        await expect(modal(page).locator('.ss-rejected-row')).toHaveCount(1);
        await expect(modal(page).locator('.ss-unreject')).toHaveCount(0);
        await expect(modal(page).locator('#surnames-link')).toBeHidden();
    });

    test('the research not running: no button, one quiet sentence; the last suggestions stay and can be decided', async ({ page }) => {
        const b = await research(page);
        b.down = true;
        await poll(page);
        await openDialog(page);
        await expect(section(page).locator('.ss-suggest')).toHaveCount(0);
        await expect(section(page).locator('.ss-note')).toHaveText('Suggestions are available while the research is running.');
        expect(b.surnames!.asks).toBe(0);
        await page.evaluate(() => window.Strom.UI.closeSurnamesDialog());

        // Running: asked; stopped again: the last ones from the device, still to decide.
        b.down = false;
        await poll(page);
        await suggestions(page);
        await page.evaluate(() => window.Strom.UI.closeSurnamesDialog());
        b.down = true;
        await poll(page);
        await openDialog(page);
        await expect(section(page).locator('.ss-note').first()).toHaveText('Last loaded suggestions. Suggestions are available while the research is running.');
        await expect(section(page).locator('.ss-reload, .ss-suggest')).toHaveCount(0);
        await expect(section(page).locator('.ss-card')).toHaveCount(5);
        await suggestion(page, FIALA.id).getByRole('button', { name: 'Accept', exact: true }).click();
        expect(await groups(page)).toEqual([['Lhotak', 'Lhoták'], ['Fiala', 'Fialla']]);
        expect(b.surnames!.asks).toBe(1);
    });

    test('a busy research is asked once more after its Retry-After; still busy: the error and Try again', async ({ page }) => {
        const busy = { status: 503, body: { error: 'busy', code: 'research.busy', text: 'The research is starting up.' }, retryAfter: '1' };
        const b = await research(page, { surnames: { replies: [busy] } });
        await suggestions(page);
        expect(b.surnames!.asks).toBe(2);

        b.surnames!.replies = [busy, busy];
        await section(page).getByRole('button', { name: 'Load again', exact: true }).click();
        // The research's own sentence (not its short code).
        await expect(section(page).locator('.ss-error')).toHaveText('The research is starting up.');
        expect(b.surnames!.asks).toBe(4);
        await section(page).getByRole('button', { name: 'Try again', exact: true }).click();
        await expect(section(page).locator('.ss-card')).toHaveCount(5);
    });
});

// ---------------------------------------------------------------- phones

/** Nothing wider than the screen, nor than the dialog's own width. */
async function expectNoOverflow(page: Page): Promise<void> {
    const widths = await page.evaluate(() => {
        const dialog = document.querySelector('#surnames-modal .surnames-modal') as HTMLElement;
        const wide = [...dialog.querySelectorAll<HTMLElement>('*')]
            .filter(el => el.getBoundingClientRect().right > dialog.getBoundingClientRect().right + 1)
            .map(el => el.className || el.tagName);
        return { doc: document.documentElement.scrollWidth, win: window.innerWidth, body: dialog.scrollWidth, bodyClient: dialog.clientWidth, wide };
    });
    expect(widths.doc).toBeLessThanOrEqual(widths.win);
    expect(widths.body).toBeLessThanOrEqual(widths.bodyClient);
    expect(widths.wide).toEqual([]);
}

async function height(l: Locator): Promise<number> {
    return (await l.boundingBox())!.height;
}

test('phone (390 px): Reject / Accept two halves 44 px, the bulk button full width, nothing too wide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await research(page, { ged: lhotakGed({ name: 'Lhotákovi z Lhoty a Kutné Hory' }) });
    await suggestions(page);
    await touchScreenNow(page);
    const card = suggestion(page, LHOTTAK.id);
    const reject = card.getByRole('button', { name: 'Reject', exact: true });
    const accept = card.getByRole('button', { name: 'Accept', exact: true });
    expect(await height(reject)).toBeGreaterThanOrEqual(44);
    expect(await height(accept)).toBeGreaterThanOrEqual(44);
    const r = (await reject.boundingBox())!;
    const a = (await accept.boundingBox())!;
    expect(Math.abs(r.width - a.width)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.y - a.y)).toBeLessThanOrEqual(1);
    const bulk = level(page, 'documented').locator('.ss-accept-all');
    const cardBox = (await card.boundingBox())!;
    expect(await height(bulk)).toBeGreaterThanOrEqual(44);
    expect((await bulk.boundingBox())!.width).toBeGreaterThanOrEqual(cardBox.width - 1);
    expect(await height(modal(page).locator('#surnames-manual-toggle'))).toBeGreaterThanOrEqual(44);
    await card.locator('.ss-evidence-toggle').click();
    await expectNoOverflow(page);
    await suggestion(page, VONDRACEK.id).getByRole('button', { name: 'Reject', exact: true }).click();
    await modal(page).locator('#surnames-rejected-toggle').click();
    expect(await height(modal(page).locator('.ss-unreject'))).toBeGreaterThanOrEqual(44);
    await expectNoOverflow(page);
});

test('phone sideways: 44 px to tap, the footer stays put, nothing too wide', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await research(page);
    await suggestions(page);
    await touchScreenNow(page);
    for (const button of [
        suggestion(page, FIALA.id).getByRole('button', { name: 'Accept', exact: true }),
        suggestion(page, FIALA.id).getByRole('button', { name: 'Reject', exact: true }),
        level(page, 'rules').locator('.ss-accept-all'),
        modal(page).locator('#surnames-manual-toggle'),
    ]) {
        expect(await height(button)).toBeGreaterThanOrEqual(44);
    }
    expect(await height(modal(page).locator('.modal-header'))).toBeGreaterThanOrEqual(44);
    await expect(modal(page).locator('.surnames-modal .buttons')).toHaveCSS('position', 'sticky');
    await expectNoOverflow(page);
});

import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { dropFile, fakeBridge, openResearch, poll, links, touchScreenNow, FakeBridge } from './research-bridge.js';

/**
 * Who decided a hypothesis (spec 060) in "What the research knows": the
 * agent's decision marked "decided by the agent", with its reason and day; a
 * person's decision with its reason and no mark; the way into the research —
 * "Decide in the research" (open) or "Change in the research" (decided) —
 * with the terminal mark, only where the research announced `hypothesis`.
 * Research for this tree → "Who decides hypotheses": only with
 * `hypotheses.decide` and a value in `/status`; the person written at once
 * (`POST /hypotheses`), the agent confirmed in the research's terminal (403
 * `hypotheses.link`: the sentence and its link under the row).
 * Invented people only; handing a link to the system is recorded instead.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const LONG_REASON = 'Křestní zápis 1865 (fol. 41) jmenuje otce Jakuba Brhlíka, domkáře v Brhlově čp. 7, a matku Marii rozenou Datlovou; '
    + 'oddací zápis 1862 dává stejné jméno otce i místo. U Josefa Brhlíka chybí jakýkoli doklad o dítěti z let 1860–1870, '
    + 'sčítání lidu 1869 ho vede bezdětného a čp. 7 tehdy obývá jen rodina Jakubova.';

function ged(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 6 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD 3f2a9c1e5b7d', '1 CHAR UTF-8', '1 NOTE Brhlíkovi',
        '0 @P0001@ INDI', '1 NAME Jakub /Brhlík/', '1 SEX M', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Marie /Datlová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0012@ INDI', '1 NAME Václav /Brhlík/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 REFN P0012', '1 FAMC @F0001@',
        '1 _STROM_HYPO H0022', '2 TITL Otec Václava: Jakub, nebo Josef Brhlík?', '2 STAT decided', '2 _CHOSEN B',
        '2 _BY agent', `2 DECI ${LONG_REASON}`, '2 _AT 2026-11-06',
        '2 NOTE A: syn Josefa Brhlíka', '3 CONT B: syn Jakuba a Marie',
        '1 _STROM_HYPO H0023', '2 TITL Kmotr: strýc Antonín?', '2 STAT decided', '2 _CHOSEN A',
        '2 DECI Kmotr podepsán jako bratr otce.', '2 _AT 2026-10-02',
        '2 NOTE A: strýc Antonín', '3 CONT B: soused Antonín',
        '1 _STROM_HYPO H0024', '2 TITL Sestra Václava: Anna z Brhlova?', '2 STAT open',
        '2 NOTE A: sestra', '3 CONT B: sestřenice',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@',
        '0 TRLR',
    ].join('\n');
}

async function setup(page: Page, links: string[]): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        if (links.length) localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, links);
    await openApp(page);
    await dropFile(page, 'tree-strom.ged', ged());
    await expect(card(page, 'Václav')).toBeVisible();
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
}

const launched = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

async function openKnows(page: Page): Promise<void> {
    const id = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0012')!.id);
    await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), id);
    await expect(page.locator('#person-research-modal')).toBeVisible();
}

const hypo = (page: Page, id: string) => page.locator(`#person-research-modal .person-research-hypo[data-hypo="${id}"]`);

test.describe('Who decided a hypothesis: What the research knows', () => {
    test('the agent\'s decision marked with its day and reason; a person\'s without the mark; the links by state', async ({ page }) => {
        await setup(page, ['send', 'open', 'conflict', 'hypothesis']);
        await openKnows(page);
        const agent = hypo(page, 'H0022');
        await expect(agent.locator('.person-research-hypo-meta')).toHaveText('H0022 · decided for B · decided by the agent · 6 Nov 2026');
        await expect(agent.locator('.person-research-hypo-by')).toHaveText('decided by the agent');
        const person = hypo(page, 'H0023');
        await expect(person.locator('.person-research-hypo-meta')).toHaveText('H0023 · decided for A · 2 Oct 2026');
        await expect(person.locator('.person-research-hypo-by')).toHaveCount(0);
        // Folded open: the reason; a long one shows its first lines and unfolds on a click.
        await agent.locator('summary').click();
        const reason = agent.locator('.person-research-hypo-reason');
        await expect(reason).toContainText(`Reason: ${LONG_REASON}`);
        const more = reason.locator('.prh-reason--more');
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        const folded = (await more.boundingBox())!.height;
        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        expect((await more.boundingBox())!.height).toBeGreaterThan(folded);
        await person.locator('summary').click();
        await expect(person.locator('.person-research-hypo-reason')).toHaveText('Reason: Kmotr podepsán jako bratr otce.');
        await expect(person.locator('.prh-reason--more')).toHaveCount(0);

        // The way into the research, with the terminal mark: change a decided one, decide an open one.
        const change = agent.locator('.person-research-hypo-link');
        await expect(change).toContainText('Change in the research');
        await expect(change.locator('.research-open-mark')).toHaveCount(1);
        await expect(change.locator('.research-ai-badge')).toHaveCount(0);
        const open = hypo(page, 'H0024');
        await expect(open.locator('.person-research-hypo-meta')).toHaveText('H0024 · open');
        await expect(open.locator('.person-research-hypo-reason')).toHaveCount(0);
        const decide = open.locator('.person-research-hypo-link');
        await expect(decide).toContainText('Decide in the research');
        await change.click();
        await decide.click();
        expect(await launched(page)).toEqual([
            `strom-research://hypothesis?tree=${UUID}&id=H0022&do=decide`,
            `strom-research://hypothesis?tree=${UUID}&id=H0024&do=decide`,
        ]);
    });

    test('without the hypothesis link announced: the decision shown, no way into the research', async ({ page }) => {
        await setup(page, ['send', 'open', 'conflict']);
        await openKnows(page);
        await expect(hypo(page, 'H0022').locator('.person-research-hypo-by')).toHaveText('decided by the agent');
        await expect(page.locator('#person-research-modal .person-research-hypo-link')).toHaveCount(0);
        await expect(page.locator('#person-research-modal .person-research-hypo-actions:visible')).toHaveCount(0);
    });

    test.describe('Czech', () => {
        test.use({ locale: 'cs-CZ' });
        test('rozhodl agent, Změnit / Rozhodnout ve výzkumu', async ({ page }) => {
            await setup(page, ['send', 'open', 'hypothesis']);
            await openKnows(page);
            await expect(hypo(page, 'H0022').locator('.person-research-hypo-meta')).toHaveText('H0022 · rozhodnutá pro B · rozhodl agent · 6. 11. 2026');
            await expect(hypo(page, 'H0022').locator('.person-research-hypo-link')).toContainText('Změnit ve výzkumu');
            await expect(hypo(page, 'H0024').locator('.person-research-hypo-link')).toContainText('Rozhodnout ve výzkumu');
        });
    });
});

const SETTINGS_LINKS = ['send', 'open', 'live', 'app', 'setup', 'hypotheses'];

async function settingsSetup(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    const bridge = await fakeBridge(page, { features: ['hypotheses.decide'], hypotheses: { decide: 'person', writes: [] }, links: SETTINGS_LINKS, ...init });
    await openResearch(page);
    await poll(page);
    return bridge;
}

async function openTreeSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
    await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
}

const row = (page: Page) => page.locator('#research-tree-settings-modal .research-hypos');
const choice = (page: Page, v: 'person' | 'agent') => page.locator(`input[name="research-hypos-decide"][value="${v}"]`);
const hyposNote = (page: Page) => page.locator('#research-hypos-note');
const option = (page: Page, v: 'person' | 'agent') => row(page).locator('label').filter({ has: choice(page, v) });

test.describe('Who decides hypotheses: Research for this tree', () => {
    test('as the research says; AI decides: the research confirms it in its terminal, the choice stays', async ({ page }) => {
        const bridge = await settingsSetup(page);
        await openTreeSettings(page);
        await expect(row(page).locator('legend')).toHaveText('Who decides hypotheses');
        await expect(option(page, 'person')).toHaveText('I decide');
        await expect(option(page, 'agent')).toContainText('AI decides');
        await expect(row(page)).toContainText('Switching does not change hypotheses already decided.');
        await expect(option(page, 'agent').locator('.research-ai-badge')).toHaveCount(1);
        await expect(option(page, 'person').locator('.research-ai-badge')).toHaveCount(0);
        await expect(choice(page, 'person')).toBeChecked();
        await option(page, 'agent').click();
        await expect.poll(() => bridge.hypotheses!.writes).toEqual([{ decide: 'agent' }]);
        await expect(hyposNote(page)).toContainText('The research confirms this choice in its terminal.');
        const confirm = page.locator('#research-hypos-note-link');
        await expect(confirm).toContainText('Confirm in the research');
        await expect(confirm.locator('.research-open-mark')).toHaveCount(1);
        await expect(choice(page, 'person')).toBeChecked();
        await confirm.click();
        expect(await links(page)).toContain(`strom-research://hypotheses?tree=${UUID}&decide=agent`);
        // Confirmed in the terminal: the next status says it.
        bridge.hypotheses!.decide = 'agent';
        await poll(page);
        await expect(choice(page, 'agent')).toBeChecked();
    });

    test('a link not the research\'s own is not used: the app builds it', async ({ page }) => {
        await settingsSetup(page, { hypotheses: { decide: 'person', writes: [], link: 'https://example.org/hypotheses?tree=x' } });
        await openTreeSettings(page);
        await option(page, 'agent').click();
        await page.locator('#research-hypos-note-link').click();
        expect(await links(page)).toContain(`strom-research://hypotheses?tree=${UUID}&decide=agent`);
        expect((await links(page)).some(u => u.startsWith('https:'))).toBe(false);
    });

    test('I decide: written at once', async ({ page }) => {
        const bridge = await settingsSetup(page, { hypotheses: { decide: 'agent', writes: [] } });
        await openTreeSettings(page);
        await expect(choice(page, 'agent')).toBeChecked();
        await option(page, 'person').click();
        await expect.poll(() => bridge.hypotheses!.writes).toEqual([{ decide: 'person' }]);
        await expect(choice(page, 'person')).toBeChecked();
        await expect(hyposNote(page)).toHaveCount(0);
        await poll(page);
        await expect(choice(page, 'person')).toBeChecked();
        await expect(choice(page, 'person')).toBeEnabled();
    });

    test('busy: the sentence under the row, the choice as it was', async ({ page }) => {
        const bridge = await settingsSetup(page, { hypotheses: { decide: 'agent', writes: [], reply: { status: 503, body: { error: 'Busy.', code: 'research.busy', text: 'Busy.' } } } });
        await openTreeSettings(page);
        await option(page, 'person').click();
        await expect(hyposNote(page)).toHaveText('The research is busy. It will work again shortly.');
        await expect(choice(page, 'agent')).toBeChecked();
        expect(bridge.hypotheses!.writes).toEqual([{ decide: 'person' }]);
    });

    test('without the bridge the choice rests with the sentence', async ({ page }) => {
        const bridge = await settingsSetup(page, { hypotheses: { decide: 'agent', writes: [] } });
        bridge.down = true;
        await poll(page);
        await openTreeSettings(page);
        await expect(choice(page, 'agent')).toBeChecked();
        await expect(choice(page, 'agent')).toBeDisabled();
        await expect(choice(page, 'person')).toBeDisabled();
        await expect(hyposNote(page)).toHaveText("The research isn't running. This can be changed once it runs.");
    });

    test('an unknown value reads as I decide, nothing written', async ({ page }) => {
        const bridge = await settingsSetup(page, { hypotheses: { decide: 'committee', writes: [] } });
        await openTreeSettings(page);
        await expect(choice(page, 'person')).toBeChecked();
        await poll(page);
        expect(bridge.hypotheses!.writes).toEqual([]);
    });

    test('no row: an older research, a research not saying it, an archive', async ({ page }) => {
        const bridge = await settingsSetup(page, { features: [] });
        await openTreeSettings(page);
        await expect(page.locator('#research-tree-settings-modal .research-tree-settings')).toBeVisible();
        await expect(row(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
        bridge.features = ['hypotheses.decide'];
        delete bridge.hypotheses!.decide;
        await poll(page);
        await openTreeSettings(page);
        await expect(row(page)).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());
        bridge.hypotheses!.decide = 'person';
        bridge.accepts = { ...(bridge.accepts as object), mode: 'archive', sync: { auto: 'mirror' } };
        await poll(page);
        await openTreeSettings(page);
        await expect(page.locator('#research-tree-settings-modal .research-tree-settings')).toBeVisible();
        await expect(row(page)).toHaveCount(0);
    });

    test.describe('German', () => {
        test.use({ locale: 'de-DE' });
        test('phone with a touch screen: the row fits', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await settingsSetup(page);
            await touchScreenNow(page);
            await openTreeSettings(page);
            await expect(row(page).locator('legend')).toHaveText('Wer über Hypothesen entscheidet');
            await row(page).scrollIntoViewIfNeeded();
            expect(await row(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        });
    });
});

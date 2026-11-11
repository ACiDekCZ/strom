import { test, expect, Page, Route } from '@playwright/test';
import { fakeBridge, openResearch, poll, links, UUID, HEAD, NEW_HEAD, BRIDGE, FakeBridge } from './research-bridge.js';

/**
 * A hypothesis whose versions link nobody into the tree, decided from the app
 * (spec 074 K1.6): its card and its row in What waits say the tree stays and
 * only the decision is recorded, the wait says so too; once the research
 * confirms it, the version loads quietly (or through the Load dialog with the
 * decision as its only hypothesis row), the notice has "Show" for the card,
 * the tree keeps its people and links, and what another hypothesis of the
 * same person shows in the view stays shown. Invented people only.
 */

const FEATURES = ['waiting.groups', 'hypothesis.decide.link', 'hypothesis.links'];
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'hypothesis'];
const T0 = new Date('2026-11-11T09:30:00Z');
const ORIGIN = 'Odkud přišel Jan Ořechovský do Lhoty?';
const KEEPS = 'The tree does not change; only the decision is recorded.';

/**
 * The research's tree: Jan without parents, his "?" edge named by H0051 (A:
 * Hostivít and Vavřena, B: Bořivoj), and H0060 about where he came from (A:
 * Horní Lhota, B: Hrádek), versions that link nobody.
 */
function ged(opts: { head?: string; decided?: string; birth?: string } = {}): string {
    const origin = opts.decided
        ? ['2 STAT decided', '2 _PICK Y', `2 _CHOSEN ${opts.decided}`, '2 _BY app', '2 DECI rozhodnuto v aplikaci Strom', '2 _AT 2026-11-11']
        : ['2 STAT open', '2 _PICK Y'];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 11 NOV 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${opts.head ?? HEAD}`, `1 _STROM_LINKS ${LINKS.join(' ')}`, '1 CHAR UTF-8', '1 NOTE Ořechovští',
        '0 @P0003@ INDI', '1 NAME Jan /Ořechovský/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research',
        ...(opts.birth ? ['1 BIRT', `2 DATE ${opts.birth}`] : []),
        '1 _STROM_EDGE parents', '2 _SCOPE in', '2 _END named', '2 _NEXT decide',
        '2 _HYPO H0051', '3 _JOIN P0001', '3 _JOIN P0002', '3 _JOIN P0004', '3 _VAR A', '3 _VAR B',
        '1 _STROM_HYPO H0051', '2 TITL Rodiče Jana Ořechovského: Hostivít a Vavřena, nebo Bořivoj Zálesák?', '2 STAT open', '2 _PICK Y',
        '2 _VAR A', '3 TITL Syn Hostivíta a Vavřeny', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0001@', '4 _PAR @P0002@',
        '2 _VAR B', '3 TITL Syn Bořivoje Zálesáka', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0004@',
        '1 _STROM_HYPO H0060', `2 TITL ${ORIGIN}`, ...origin,
        '2 _VAR A', '3 TITL Přišel z Horní Lhoty',
        '2 _VAR B', '3 TITL Přišel z Hrádku',
        '0 @P0001@ INDI', '1 NAME Hostivít /Ořechovský/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Vavřena /Cvrkalová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0004@ INDI', '1 NAME Bořivoj /Zálesák/', '1 SEX M', '1 REFN P0004', '2 TYPE strom-research',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@',
        '0 TRLR',
    ].join('\n');
}

/** The research's item of H0060 in What waits (under Decide, its own place). */
const WAITING = [{
    id: 'H0060', what: ORIGIN, on: 'user', at: '2026-11-10T08:00:00Z', kind: 'hypothesis', section: 'decide',
    group: { key: 'hypotheses', name: 'Hypotheses', kind: 'other' }, person: 'P0003', actions: [], pick: true,
}];

async function seed(page: Page, width = 1440): Promise<void> {
    await page.clock.install({ time: T0 });
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((announced) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
    }, LINKS);
}

async function setup(page: Page): Promise<FakeBridge> {
    await seed(page);
    const b = await fakeBridge(page, { features: FEATURES, treeGed: ged(), links: LINKS });
    await openResearch(page, { ged: ged() });
    await poll(page);
    await page.evaluate(() => {
        const S = window.Strom;
        S.TreeRenderer.setFocus(S.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0003')!.id);
    });
    return b;
}

async function openCard(page: Page): Promise<void> {
    const id = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0003')!.id);
    await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), id);
    await expect(page.locator('#person-research-modal')).toBeVisible();
}

const card = (page: Page) => page.locator('#person-research-modal .person-research-hypo[data-hypo="H0060"]');
const row = (page: Page, v: string) => card(page).locator(`.person-research-variant[data-variant="${v}"]`);
const toast = (page: Page) => page.locator('.toast');
const opened = async (page: Page): Promise<string[]> => (await links(page)).filter(u => u.startsWith('strom-research://hypothesis'));
const stub = (page: Page) => page.locator('.person-card .research-edge.edge-named');

/** What the tree holds of the family links, and Jan's parents. */
const familyState = (page: Page) => page.evaluate(() => {
    const S = window.Strom;
    const jan = S.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0003')!;
    return {
        parents: (jan.parentIds ?? []).map((id: string) => S.DataManager.getPerson(id as never)?.refn).sort(),
        persons: S.DataManager.getAllPersons().filter((p: { isPlaceholder?: boolean }) => !p.isPlaceholder).length,
        partnerships: Object.keys(S.DataManager.getData().partnerships ?? {}).length,
    };
});

/** The view's shown links (hypothesis, version, on). */
const viewLinks = (page: Page) => page.evaluate(() => {
    const treeId = window.Strom.DataManager.getCurrentTreeId()!;
    const raw = JSON.parse(localStorage.getItem(`strom-view-links:${treeId}`) ?? '[]') as Array<{ hypo: string; variant: string; on: boolean }>;
    return raw.map(r => ({ hypo: r.hypo, variant: r.variant, on: r.on }));
});

/** The research writes a version (its head moves) and the app asks its bridge (`dialog`: not awaited, a dialog will hold it). */
async function write(page: Page, b: FakeBridge, head: string, text: string, dialog = false): Promise<void> {
    b.head = head;
    b.treeGed = text;
    if (dialog) await page.evaluate(() => { void window.Strom.UI.pollResearchBridge(); });
    else await poll(page);
}

test.describe('A hypothesis without a link, decided from the app (K1.6)', () => {
    test.use({ locale: 'en-US' });

    test('the card says the tree stays; decided: a quiet load, Show, no link written, the other hypothesis stays shown', async ({ page }) => {
        const b = await setup(page);
        // Version B of H0051 (Jan's "?" edge) shown in the view.
        await stub(page).first().click();
        const bubble = page.locator('#research-edge-bubble.is-pinned');
        await bubble.locator('.reb-variant[data-variant="B"] .reb-show').click();
        await expect.poll(() => viewLinks(page)).toEqual([{ hypo: 'H0051', variant: 'B', on: true }]);
        await page.keyboard.press('Escape');
        const before = await familyState(page);
        expect(before.parents).toEqual([]);
        const stubs = await stub(page).count();

        await openCard(page);
        // Each version: Choose, with the sentence that nothing is linked.
        await expect(card(page).locator('.prv-pick:not([disabled])')).toHaveCount(2);
        for (const v of ['A', 'B']) {
            await expect(row(page, v).locator('.prv-kindnote')).toHaveText('Nothing is linked in the tree; the research only records the decision.');
        }
        await row(page, 'B').locator('.prv-pick').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0060&do=decide&variant=B`]);
        await expect(row(page, 'B').locator('.prv-wait-text')).toHaveText(
            `To be confirmed in the research terminal (Enter = yes): decide H0060 for version B. ${KEEPS} Then the terminal optionally asks for a reason. Nothing changes here until confirmed.`);

        // Decided for B in the research: only the decision changes, loaded quietly.
        await write(page, b, NEW_HEAD, ged({ head: NEW_HEAD, decided: 'B' }));
        await expect(toast(page)).toContainText('Hypothesis H0060 decided: B');
        await expect(page.locator('#research-load-modal')).toHaveCount(0);
        await expect(card(page).locator('.prv-wait')).toHaveCount(0);
        await expect(row(page, 'B').locator('.prv-tag')).toBeVisible();
        // The tree as it was: no parents, nobody added, no family; H0051's "?" edge and its shown version stay.
        expect(await familyState(page)).toEqual(before);
        await expect(stub(page)).toHaveCount(stubs);
        expect(await viewLinks(page)).toEqual([{ hypo: 'H0051', variant: 'B', on: true }]);
        // "Show" opens the hypothesis's card.
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        await toast(page).getByRole('button', { name: 'Show' }).click();
        await expect(card(page)).toBeVisible();
    });

    test('a version with more changes: the Load dialog has the decision as its only hypothesis row and no family row', async ({ page }) => {
        const b = await setup(page);
        await openCard(page);
        await row(page, 'A').locator('.prv-pick').click();
        const before = await familyState(page);
        await write(page, b, NEW_HEAD, ged({ head: NEW_HEAD, decided: 'A', birth: '3 MAR 1862' }), true);
        const dialog = page.locator('#research-load-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.research-load-intro')).toHaveText('Hypothesis H0060 decided: A. The research\'s version has other changes too. A backup is saved first.');
        await expect(dialog.locator('tbody tr.research-load-hypo')).toHaveCount(1);
        await expect(dialog.locator('tbody tr.research-load-hypo .research-load-field')).toContainText('H0060 decided for A');
        await expect(dialog.locator('tbody tr.research-load-hypo .research-load-inapp')).toHaveText('in the app');
        // The decision is the dialog's only row: nothing that links people.
        await expect(dialog.locator('tbody tr')).toHaveCount(1);
        await dialog.locator('#research-load-ok').click();
        await expect(dialog).toHaveCount(0);
        await expect(toast(page)).toContainText('Hypothesis H0060 decided: A');
        expect(await familyState(page)).toEqual(before);
    });
});

test.describe('A hypothesis without a link in What waits (K1.6)', () => {
    test.use({ locale: 'en-US' });

    test('its row says the tree stays; Choose waits with the same words', async ({ page }) => {
        await seed(page);
        const text = ged();
        await fakeBridge(page, { features: FEATURES, treeGed: text, links: LINKS, waiting: WAITING });
        await openResearch(page, { ged: text });
        await poll(page);
        await page.route(`${BRIDGE}/events*`, (_route: Route) => new Promise<void>(() => { /* never answers */ }));
        await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
        await expect(page.locator('#live-panel')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.openResearchOverview());
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        const head = ov.locator('.live-section__head').filter({ has: page.locator('.live-section__title', { hasText: 'Awaiting action' }) });
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const item = ov.locator('.hwr-item[data-id="H0060"]');
        await expect(item.locator('.hwr-version')).toHaveCount(2);
        await expect(item.locator('.hwr-keeps')).toHaveText(KEEPS);
        await expect(item.locator('.hwr-version-note')).toHaveCount(0);
        await item.locator('.hwr-version[data-variant="A"] .hwr-pick').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0060&do=decide&variant=A`]);
        await expect(item.locator('.prv-wait-text')).toContainText(`decide H0060 for version A. ${KEEPS}`);
        expect(await ov.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });
});

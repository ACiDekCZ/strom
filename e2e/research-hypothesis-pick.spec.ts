import { test, expect, Page } from '@playwright/test';
import { fakeBridge, openResearch, poll, links, UUID, HEAD } from './research-bridge.js';

/**
 * Deciding a hypothesis in the app (spec 074, DEV §1–§7) in "What the
 * research knows": a research with `hypothesis.decide.link` gets a card with
 * "Choose" at each version, the agent's proposal, the sources for and
 * against, "No version holds" and "Leave open"; a decided one "Change" and
 * "Reopen" (or why it cannot be reopened). Each choice opens the research's
 * terminal (the link recorded) and waits here for its confirmation; "Stop
 * waiting" forgets it. Away from the research it is only read; merging is
 * decided in the research; an older research keeps today's card.
 * Invented people only; handing a link to the system is recorded instead.
 */

const FEATURES = ['hypothesis.decide.link'];
const QUESTION = 'Otec Jana: Josef Fíšek, nebo Bolemír Zábrodský z Čapkova?';

function ged(extra: string[] = []): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 10 NOV 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${HEAD}`, '1 _STROM_LINKS send open live app setup hypothesis', '1 CHAR UTF-8', '1 NOTE Fíškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0004@ INDI', '1 NAME Bolemír /Zábrodský/', '1 SEX M', '1 REFN P0004', '2 TYPE strom-research',
        '0 @P0003@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
        '1 _STROM_HYPO H0031', `2 TITL ${QUESTION}`, '2 STAT open', '2 _PICK Y',
        '2 _PROP B', '3 DECI Zápis 1858 jmenuje Bolemíra.', '3 _AT 2026-11-09',
        '2 _VAR A', '3 TITL Syn Josefa a Anny', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0001@', '4 _PAR @P0002@', '3 SOUR @S0001@',
        '2 _VAR B', '3 TITL Syn Bolemíra a Anny', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0004@', '4 _PAR @P0002@',
        '3 _AGAINST Oddací zápis uvádí jiného ženicha.', '4 SOUR @S0001@',
        '2 _VAR C', '3 TITL Otec neznámý',
        '1 _STROM_HYPO H0032', '2 TITL Kmotr Jana: Bolemír?', '2 STAT decided', '2 _CHOSEN B', '2 _BY app', '2 _PICK Y',
        '2 DECI Kmotr podepsán jako soused.', '2 _AT 2026-11-05',
        '2 _PREV A', '3 _BY agent', '3 DECI Starší čtení zápisu.', '3 _AT 2026-10-20',
        '2 _VAR A', '3 TITL Kmotr Josef', '3 _LINK partners', '4 _PERS @P0001@', '4 _PERS @P0002@',
        '2 _VAR B', '3 TITL Kmotr Bolemír', '3 _LINK partners', '4 _PERS @P0004@', '4 _PERS @P0002@',
        '1 _STROM_HYPO H0033', '2 TITL Sňatek Anny: s Josefem?', '2 STAT decided', '2 _CHOSEN A', '2 _PICK Y',
        '2 DECI Oddací zápis.', '2 _AT 2026-10-02',
        '2 _REOPEN no', '3 TYPE tree', '3 _COUNT 3',
        '2 _VAR A', '3 TITL Josef a Anna', '3 _LINK partners', '4 _PERS @P0001@', '4 _PERS @P0002@',
        '2 _VAR B', '3 TITL Bolemír a Anna', '3 _LINK partners', '4 _PERS @P0004@', '4 _PERS @P0002@',
        '1 _STROM_HYPO H0034', '2 TITL Je Jan týž jako Jan z Lipnice?', '2 STAT open',
        '2 _VAR A', '3 TITL Týž člověk', '3 _LINK same', '4 _PERS @P0003@', '4 _PERS @P0001@',
        '2 _VAR B', '3 TITL Dva lidé',
        ...extra,
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 @S0001@ SOUR', '1 TITL Oddací matrika Čapkov', '1 PAGE fol. 41', '1 REFN S0001', '1 TEXT Josef Fíšek a Anna', '1 _STROM_READ research',
        '0 TRLR',
    ].join('\n');
}

async function setup(page: Page, opts: { features?: string[]; links?: string[]; width?: number } = {}): Promise<void> {
    await page.setViewportSize({ width: opts.width ?? 1440, height: 900 });
    const announced = opts.links ?? ['send', 'open', 'live', 'app', 'setup', 'hypothesis'];
    await page.addInitScript((announced) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
    }, announced);
    await fakeBridge(page, { features: opts.features ?? FEATURES, treeGed: ged(), links: announced });
    await openResearch(page, { ged: ged() });
    await poll(page);
    const id = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0003')!.id);
    await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), id);
    await expect(page.locator('#person-research-modal')).toBeVisible();
}

const hypo = (page: Page, id: string) => page.locator(`#person-research-modal .person-research-hypo[data-hypo="${id}"]`);
const row = (page: Page, id: string, v: string) => hypo(page, id).locator(`.person-research-variant[data-variant="${v}"]`);
const opened = async (page: Page): Promise<string[]> => (await links(page)).filter(u => u.startsWith('strom-research://hypothesis'));

test.describe('Deciding a hypothesis in the app: What the research knows', () => {
    test('an open one: Choose at each version with the proposal and the sources; a choice opens the terminal and waits', async ({ page }) => {
        await setup(page);
        const card = hypo(page, 'H0031');
        await expect(card).toHaveAttribute('data-pick', 'pick');
        await expect(card.locator('.person-research-hypo-title')).toHaveText(QUESTION);
        // The agent's proposal at B, the sources for A and against B.
        await expect(row(page, 'H0031', 'B').locator('.prv-proposal')).toContainText('Zápis 1858 jmenuje Bolemíra.');
        await expect(row(page, 'H0031', 'A').locator('.prv-proposal')).toHaveCount(0);
        await expect(row(page, 'H0031', 'A').locator('.prv-src-label--for')).toBeVisible();
        await expect(row(page, 'H0031', 'A').locator('.prv-source')).toHaveText('Oddací matrika Čapkov');
        await expect(row(page, 'H0031', 'B').locator('.prv-src-label--against')).toBeVisible();
        await expect(row(page, 'H0031', 'B').locator('.prv-src-item')).toContainText('Oddací zápis uvádí jiného ženicha.');
        // A version that links nobody says so.
        await expect(row(page, 'H0031', 'C').locator('.prv-kindnote')).toBeVisible();
        // Choose at every version, the choices under the box, the research quiet below a line.
        await expect(card.locator('.prv-pick')).toHaveCount(3);
        await expect(row(page, 'H0031', 'B').locator('.prv-pick')).toHaveAttribute('aria-label', /B/);
        await expect(card.locator('[data-hypo-act="abandon"]')).toBeVisible();
        await expect(card.locator('[data-hypo-act="keep-open"]')).toBeVisible();
        await expect(card.locator('.prh-more .person-research-hypo-link')).toBeVisible();

        await row(page, 'H0031', 'B').locator('.prv-pick').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0031&do=decide&variant=B`]);
        // The wait at B; every choice switched off; no way into the research meanwhile.
        const wait = row(page, 'H0031', 'B').locator('.prv-wait');
        await expect(wait).toBeVisible();
        await expect(wait).toHaveAttribute('data-wait-phase', 'waiting');
        await expect(card.locator('.prv-pick:not([disabled])')).toHaveCount(0);
        await expect(card.locator('[data-hypo-act="abandon"]')).toBeDisabled();
        await expect(card.locator('.prh-more')).toHaveCount(0);
        await expect(wait.locator('.prv-wait-again')).toBeFocused();
        // Open again: the same link once more.
        await wait.locator('.prv-wait-again').click();
        expect((await opened(page)).length).toBe(2);
        // Stop waiting: the choices back.
        await wait.locator('.prv-wait-stop').click();
        await expect(card.locator('.prv-wait')).toHaveCount(0);
        await expect(card.locator('.prv-pick:not([disabled])')).toHaveCount(3);
    });

    test('No version holds and Leave open wait under the box', async ({ page }) => {
        await setup(page);
        const card = hypo(page, 'H0031');
        await card.locator('[data-hypo-act="keep-open"]').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0031&do=keep-open`]);
        await expect(card.locator(':scope > .prv-wait')).toBeVisible();
        await expect(card.locator('.person-research-variant .prv-wait')).toHaveCount(0);
        await card.locator('.prv-wait-stop').click();
        await card.locator('[data-hypo-act="abandon"]').click();
        expect((await opened(page)).at(-1)).toBe(`strom-research://hypothesis?tree=${UUID}&id=H0031&do=abandon`);
        // The wait stays when the dialog is opened again.
        await page.keyboard.press('Escape');
        await expect(page.locator('#person-research-modal')).toHaveCount(0);
        const id = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0003')!.id);
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), id);
        await expect(hypo(page, 'H0031').locator(':scope > .prv-wait')).toBeVisible();
    });

    test('a decided one: Change offers the other versions, Cancel goes back, Reopen asks the research', async ({ page }) => {
        await setup(page);
        const card = hypo(page, 'H0032');
        await card.locator('summary').click();
        await expect(row(page, 'H0032', 'B').locator('.prv-tag')).toBeVisible();
        await expect(row(page, 'H0032', 'A')).toHaveClass(/is-dim/);
        await expect(card.locator('.prh-prev')).toContainText('A');
        await expect(card.locator('.prv-pick')).toHaveCount(0);
        await expect(card.locator('[data-hypo-act="reopen"]')).toBeVisible();

        await card.locator('[data-hypo-act="change"]').click();
        await expect(card.locator('.prh-holds')).toContainText('B');
        await expect(row(page, 'H0032', 'B').locator('.prv-pick')).toBeDisabled();
        await expect(row(page, 'H0032', 'A').locator('.prv-pick')).toBeEnabled();
        await expect(row(page, 'H0032', 'A').locator('.prv-pick')).toBeFocused();
        await expect(card.locator('.prh-more')).toHaveCount(0);
        await card.locator('[data-hypo-act="change-cancel"]').click();
        await expect(card.locator('.prv-pick')).toHaveCount(0);
        await expect(card.locator('[data-hypo-act="change"]')).toBeFocused();

        await card.locator('[data-hypo-act="change"]').click();
        await row(page, 'H0032', 'A').locator('.prv-pick').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0032&do=decide&variant=A`]);
        await expect(row(page, 'H0032', 'A').locator('.prv-wait')).toBeVisible();
        await row(page, 'H0032', 'A').locator('.prv-wait-stop').click();
        await card.locator('[data-hypo-act="reopen"]').click();
        expect((await opened(page)).at(-1)).toBe(`strom-research://hypothesis?tree=${UUID}&id=H0032&do=reopen`);
        await expect(card.locator(':scope > .prv-wait')).toBeVisible();
    });

    test('one that cannot be reopened says why; merging is decided in the research', async ({ page }) => {
        await setup(page);
        const card = hypo(page, 'H0033');
        await card.locator('summary').click();
        await expect(card.locator('[data-hypo-act="reopen"]')).toHaveCount(0);
        await expect(card.locator('[data-hypo-act="change"]')).toBeVisible();
        await expect(card.locator('.prh-note')).toContainText('3');

        const merge = hypo(page, 'H0034');
        await expect(merge).toHaveAttribute('data-pick', 'merge');
        await expect(merge.locator('.prv-pick')).toHaveCount(0);
        await expect(merge.locator('.prh-info')).toBeVisible();
        await merge.locator('[data-hypo-do="decide"]').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0034&do=decide`]);
    });

    test('away from the research: read with its marks, no choice', async ({ page }) => {
        await setup(page, { links: ['send', 'open', 'live', 'app', 'setup'] });
        const card = hypo(page, 'H0031');
        await expect(card).toHaveAttribute('data-pick', 'remote');
        await expect(row(page, 'H0031', 'B').locator('.prv-proposal')).toBeVisible();
        await expect(card.locator('.prv-pick, [data-hypo-act], .prh-more')).toHaveCount(0);
        await expect(card.locator('.prh-info')).toBeVisible();
    });

    test('an older research keeps today\'s card', async ({ page }) => {
        await setup(page, { features: [] });
        const card = hypo(page, 'H0031');
        await expect(card).not.toHaveAttribute('data-pick', /.*/);
        await expect(card.locator('.prv-pick, .prv-proposal, .prv-sources, [data-hypo-act]')).toHaveCount(0);
        await expect(card.locator('.person-research-hypo-actions .person-research-hypo-link')).toBeVisible();
    });

    test('a phone-wide window: sources folded, Choose the row\'s width, nothing wider than the dialog', async ({ page }) => {
        await setup(page, { width: 390 });
        const card = hypo(page, 'H0031');
        const a = row(page, 'H0031', 'A');
        await expect(a.locator('.prv-sources')).toBeHidden();
        await a.locator('.prv-sources-toggle').click();
        await expect(a.locator('.prv-sources')).toBeVisible();
        await expect(a.locator('.prv-sources-toggle')).toHaveAttribute('aria-expanded', 'true');
        // Kept open when the cards are drawn again (a wait asked and stopped).
        await row(page, 'H0031', 'C').locator('.prv-pick').click();
        await row(page, 'H0031', 'C').locator('.prv-wait-stop').click();
        await expect(a.locator('.prv-sources')).toBeVisible();
        const box = await a.locator('.prv-pick').boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        const over = await page.evaluate(() => {
            const m = document.querySelector('#person-research-modal .modal-content, #person-research-modal [role="dialog"]') as HTMLElement | null;
            return m ? m.scrollWidth - m.clientWidth : -1;
        });
        expect(over).toBeLessThanOrEqual(0);
        await expect(card.locator('[data-hypo-act="abandon"]')).toBeVisible();
    });
});

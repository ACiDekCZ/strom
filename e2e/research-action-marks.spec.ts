import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakePlaces, openResearch, poll, researchGed, links, HEAD, UUID, FakeBridge } from './research-bridge.js';

/**
 * The marks of the research's actions in the Places window (Milan, 2 Nov 2026):
 * the bridge's steps (Look up, Look up again, Check, the ⋯ menu) carry no mark
 * at all, no ◆; Run now opens the research's terminal where the agent works:
 * the AI badge and the terminal mark, no ↗ — in the context line and in the
 * toast of a refused step. Invented places and people (the Brindak family).
 */

const RUN = `strom-research://places?tree=${UUID}&do=run`;

const GED = researchGed(HEAD, [
    '0 @P0004@ INDI', '1 NAME Zorbin /Brindak/', '1 SEX M', '1 REFN P0004', '2 TYPE strom-research',
    '1 BIRT', '2 DATE 1860', '2 PLAC Lhota', '1 DEAT', '2 DATE 1878', '2 PLAC Horní Lhota',
    '0 @P0005@ INDI', '1 NAME Quilla /Brindak/', '1 SEX F', '1 REFN P0005', '2 TYPE strom-research',
    '1 BIRT', '2 DATE 1865', '2 PLAC H. Lhota',
]);

async function research(page: Page, refuse = false): Promise<FakeBridge> {
    const places = fakePlaces({
        reply: {
            rev: 'p1',
            places: {
                L0001: { name: 'Lhota', country: 'CZ', coords: { lat: 49.6, lon: 15.4 }, state: 'identified', by: 'research', forms: ['Lhota'] },
            },
            forms: { 'H. Lhota': { state: 'queued' } },
            queue: { queued: 1, running: 0 },
            counts: { offMap: 2, placed: 1, proposed: 0, unlocated: 0 },
        },
    });
    if (refuse) {
        places.identifyReply = () => ({ status: 403, body: { code: 'places.link', error: 'The research asks in its terminal.', link: RUN } });
    }
    const b = await fakeBridge(page, { features: ['places.identify'], treeGed: GED, places, links: ['send', 'open', 'live', 'app', 'setup', 'places'] });
    await openResearch(page, { ged: GED });
    await poll(page);
    await page.evaluate(() => {
        window.Strom.DataManager.getData().places = { lhota: { lat: 49.6, lon: 15.4, label: 'Lhota' } };
        window.Strom.UI.dismissUndoToast();
        document.querySelectorAll('.toast').forEach(t => t.remove());
    });
    return b;
}

const modal = (page: Page): Locator => page.locator('#places-modal');
const row = (page: Page, key: string): Locator => modal(page).locator(`.place-row[data-key="${key}"]`);

async function openPlaces(page: Page, b: FakeBridge): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
    await expect(modal(page)).toBeVisible();
    await expect.poll(() => b.places!.reads).toBeGreaterThan(0);
    await expect(row(page, 'h lhota')).toHaveAttribute('data-state', 'queued');
}

test.describe('marks of the research actions in Places', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the bridge\'s steps carry no mark; Run now carries AI and the terminal mark and opens the places link', async ({ page }) => {
        const b = await research(page);
        await openPlaces(page, b);

        // Look up on a row and in the ⋯ menu: through the bridge, no ◆ and no mark.
        const look = row(page, 'horni lhota').locator('.place-look');
        await expect(look).toHaveText('Look up in the research');
        await expect(look.locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        await modal(page).locator('.places-more-btn').click();
        const titles = await modal(page).locator('.places-more-title').allTextContents();
        expect(titles.length).toBeGreaterThan(1);
        for (const t of titles) expect(t).not.toMatch(/◆|↗/);
        await page.keyboard.press('Escape');

        // Run now: the agent's session in the research's terminal.
        const ctx = modal(page).locator('.places-context');
        await expect(ctx).toHaveAttribute('data-context', 'queue');
        const run = ctx.locator('.places-context-act');
        await expect(run.locator('.research-ai-badge')).toHaveText('AI');
        await expect(run.locator('.research-open-mark')).toHaveCount(1);
        await expect(run).not.toContainText('↗');
        await expect(run).toHaveAccessibleName('Run now, AI, opens in the research');
        // No action of the window carries ◆ or ↗ (◆ stays only as the badge of a place the research identified).
        for (const t of await modal(page).locator('button').allTextContents()) expect(t).not.toMatch(/◆|↗/);
        await run.click();
        expect(await links(page)).toEqual([RUN]);
    });

    test('a step the bridge leaves to the terminal: the toast\'s Run now with AI and the terminal mark', async ({ page }) => {
        const b = await research(page, true);
        await openPlaces(page, b);
        await row(page, 'horni lhota').locator('.place-look').click();
        const act = page.locator('.toast .toast-action');
        await expect(act).toBeVisible();
        await expect(act.locator('.research-ai-badge')).toHaveText('AI');
        await expect(act.locator('.research-open-mark')).toHaveCount(1);
        await expect(act).not.toContainText('↗');
        await act.click();
        expect(await links(page)).toEqual([RUN]);
    });
});

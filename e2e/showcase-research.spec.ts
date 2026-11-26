import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, card, openPersonSubmenu, seedSetting } from './helpers.js';
import { fakeBridge, openResearch, openResearchMenu, poll } from './research-bridge.js';

/**
 * The showcase with research (spec 143 K4): a reduced copy of the Czech
 * showcase — five people, a source with its transcript and scan, a conflict of
 * the sources and one made by an edit, a hypothesis, waiting tasks, lines, the
 * queue and the history. Everything of the research reads from the snapshot
 * in the page; every action that would write is greyed and says why.
 */
const RAW = readFileSync(new URL('./fixtures/showcase/strom-ukazka-research-cs.json', import.meta.url), 'utf-8');
const RESEARCH = '943fce29-c1c6-5433-8031-96ce4bbbcd8d';
/** Off midnight UTC: the dates of the snapshot say the same day in any zone. */
const NOW = new Date('2026-11-20T10:00:00Z');

/** The snapshot as a research that takes changes would say it (the sync bar's Send drawn). */
function withAccepts(): string {
    const d = JSON.parse(RAW);
    d.research.status.accepts = { sync: { auto: 'off' }, sources: true, verified: true, media: null };
    return JSON.stringify(d);
}

/** The showcase opened from its link (the app's own start first, its seeds kept). */
async function openShowcase(page: Page, opts: { accepts?: boolean } = {}): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    const body = opts.accepts ? withAccepts() : RAW;
    await page.route('**/demo/cs/strom-ukazka-cs.json', r => r.fulfill({ status: 200, contentType: 'application/json', body }));
    await page.goto('/strom.html?demo=cs');
    await expect(page.locator('html')).not.toHaveClass(/app-loading/);
    await expect(page.locator('.toast', { hasText: 'The sample is open.' })).toBeVisible();
    // Links handed to the system are recorded (none may go).
    await page.evaluate(() => {
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
    });
}

const launched = (page: Page) => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links);
const why = (page: Page) => page.locator('#sample-why');
const personId = (page: Page, first: string) => page.evaluate(
    (f) => window.Strom.DataManager.getAllPersons().find(p => p.firstName === f)!.id, first);

/** Every request that is not a read: none may leave the page in the showcase. */
function writesOut(page: Page): string[] {
    const out: string[] = [];
    page.on('request', (r) => {
        if (!['GET', 'HEAD'].includes(r.method())) out.push(`${r.method()} ${r.url()}`);
        else if (r.url().includes('/__showcase/')) out.push(`${r.method()} ${r.url()}`);
    });
    return out;
}

/** A greyed action: its mark and label, said disabled and described by the bubble. */
async function expectOff(page: Page, el: ReturnType<Page['locator']>, mark: string, label: string): Promise<void> {
    await expect(el).toHaveAttribute('data-showcase-off', mark);
    await expect(el).toHaveAttribute('data-showcase-label', label);
    await expect(el).toHaveAttribute('aria-disabled', 'true');
    await expect(el).toHaveAttribute('aria-describedby', 'sample-why');
}

/** A click on a greyed action: the bubble says why, nothing runs. */
async function clickSaysWhy(page: Page, el: ReturnType<Page['locator']>, what: string): Promise<void> {
    // aria-disabled: an action Playwright would wait for; a person can still click it.
    await el.click({ force: true });
    await expect(why(page)).toBeVisible();
    await expect(why(page).locator('.what')).toHaveText(what);
    await expect(why(page).locator('code')).toHaveText('strom demo');
    expect(await launched(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(why(page)).toBeHidden();
}

test.describe('the showcase with research', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('the sync bar\'s Send to research is greyed, a click says why and sends nothing', async ({ page }) => {
        const writes = writesOut(page);
        await openShowcase(page, { accepts: true });
        const anna = await personId(page, 'Anna');
        await page.evaluate((id) => {
            const tm = window.Strom.TreeManager;
            tm.patchResearchLink(tm.getActiveTreeId()!, { sendMode: 'manual' });
            window.Strom.DataManager.updatePerson(id, { birthPlace: 'Praha' });
        }, anna);
        const send = page.locator('#research-sync-send');
        await expect(send).toBeVisible();
        await expectOff(page, send, 'none', 'Send to research');
        await clickSaysWhy(page, send, 'In full research: Send to research');
        expect(writes).toEqual([]);
    });

});

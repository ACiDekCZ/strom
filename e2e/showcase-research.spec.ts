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

test.describe('the showcase on a phone', () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test('the bottom sheet: Research › greyed, a tap says why, Escape closes', async ({ page }) => {
        await openShowcase(page);
        await card(page, 'Josef').tap();
        const sub = await openPersonSubmenu(page, 'research');
        const ask = sub.locator('[data-showcase-label="Ask the agent"]');
        await expectOff(page, ask, 'agent', 'Ask the agent');
        await expectOff(page, sub.locator('[data-showcase-label="Send to research"]'), 'terminal', 'Send to research');
        await ask.tap({ force: true });
        await expect(why(page)).toBeVisible();
        await expect(why(page).locator('.what')).toHaveText('In full research: Ask the agent · AI + terminal');
        expect(await launched(page)).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(why(page)).toBeHidden();
    });
});

test.describe('a research made by strom demo (tree.demo)', () => {
    const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'task', 'research'];

    /** A research tree whose bridge answers; its status says `tree.demo` or not. */
    async function demoResearch(page: Page, demo: boolean): Promise<void> {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.addInitScript((links) => {
            if (sessionStorage.getItem('links-seeded')) return;
            sessionStorage.setItem('links-seeded', '1');
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        }, LINKS);
        await openResearch(page);
        await fakeBridge(page, {
            accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null },
            links: LINKS,
            statusExtra: { tree: { id: '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77', name: 'Fíškovi', ...(demo ? { demo: true } : {}), state: 'research' } },
        });
        await poll(page);
    }

    /** The person menu's research actions of Jan ([] when it has no Research row). */
    async function personResearchActions(page: Page): Promise<string[]> {
        await card(page, 'Jan').click();
        await expect(page.locator('.context-menu').first()).toBeVisible();
        if (await page.locator('.context-menu [data-menu="research"]').count() === 0) return [];
        const sub = await openPersonSubmenu(page, 'research');
        return sub.locator('[data-action]').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.action ?? ''));
    }

    test('without tree.demo: the agent offered (the control)', async ({ page }) => {
        await demoResearch(page, false);
        await expect(page.locator('.tree-switcher-btn .tree-sample-tag')).toHaveCount(0);
        await openResearchMenu(page);
        await expect(page.locator('#research-item-chat')).toBeVisible();
        await page.keyboard.press('Escape');
        expect(await personResearchActions(page)).toContain('research-ask');
    });

    test('tree.demo: no Continue with the agent, no Ask the agent, no AI tool; the tree is tagged Sample', async ({ page }) => {
        await demoResearch(page, true);
        // The tag comes with the status that says so (no reload, no switch of trees).
        await expect(page.locator('.tree-switcher-btn .tree-sample-tag')).toHaveText('Sample');
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-menu')).toBeVisible();
        await expect(page.locator('#research-item-chat')).toHaveCount(0);
        await expect(page.locator('#research-menu .research-ai-badge')).toHaveCount(0);
        await page.keyboard.press('Escape');
        expect(await personResearchActions(page)).not.toContain('research-ask');
        await expect(page.locator('.context-menu .research-ai-badge')).toHaveCount(0);
    });
});

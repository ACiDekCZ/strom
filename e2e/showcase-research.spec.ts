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

/** A greyed row dimmed once: the opacity alone, its words in the colour of an action that runs. */
async function expectDimmedOnce(off: ReturnType<Page['locator']>, on: ReturnType<Page['locator']>): Promise<void> {
    const colour = (el: ReturnType<Page['locator']>) => el.evaluate((e) => {
        const label = e.querySelector('.research-item-label, .menu-item-label, .bottom-sheet-label') ?? e;
        return getComputedStyle(label).color;
    });
    await expect(off).toHaveCSS('opacity', '0.55');
    expect(await colour(off)).toBe(await colour(on));
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

    test('no write leaves the page; a write to the snapshot is refused (403)', async ({ page }) => {
        const writes = writesOut(page);
        await openShowcase(page);
        // An answer to a waiting task: greyed in the task's row.
        await page.evaluate(() => window.Strom.UI.openResearchOverview({ showWaiting: true }));
        const overview = page.locator('#research-overview');
        await overview.getByText('Oddavky Václava Horáka a Kateřiny Vlkové').first().click();
        const answer = overview.locator('.research-overview__waiting-action', { hasText: 'Answer' });
        await expectOff(page, answer, 'none', 'Answer');
        await clickSaysWhy(page, answer, 'In full research: Answer');
        // Straight at the snapshot: every write refused, a read answered.
        const answers = await page.evaluate(async (id) => {
            const base = `${location.origin}/__showcase/${id}`;
            const ask = async (path: string, method: string) => {
                const res = await fetch(`${base}${path}`, { method, ...(method === 'GET' ? {} : { body: '{}' }) });
                const body = await res.json().catch(() => null) as { error?: string } | null;
                return `${method} ${path} ${res.status}${body?.error ? ` ${body.error}` : ''}`;
            };
            return [
                await ask('/sync', 'POST'),
                await ask('/waiting/T0006', 'POST'),
                await ask('/queue/order', 'PUT'),
                await ask('/material/M0001', 'DELETE'),
                await ask('/status', 'GET'),
            ];
        }, RESEARCH);
        expect(answers).toEqual([
            'POST /sync 403 showcase.read-only',
            'POST /waiting/T0006 403 showcase.read-only',
            'PUT /queue/order 403 showcase.read-only',
            'DELETE /material/M0001 403 showcase.read-only',
            'GET /status 200',
        ]);
        expect(writes).toEqual([]);
    });

    test('the overview shows the lines, the queue and the history of the snapshot; its actions greyed', async ({ page }) => {
        await openShowcase(page);
        await page.evaluate(() => window.Strom.UI.openResearchOverview({}));
        const overview = page.locator('#research-overview');
        await expect(overview).toBeVisible();
        // The lines of the research.
        await expect(overview).toContainText('Předci Anny Horákové');
        await expect(overview).toContainText('Odkud pocházela Kateřina Vlková?');
        // The queue and the history.
        await expect(overview).toContainText('Sčítání lidu 1880 v Dolní Lhotě');
        await expect(overview).toContainText('T0031 Křest Kateřiny Vlkové kolem 1870 · Předci Anny Horákové');
        // The row of the showcase: view only, strom demo, as of the snapshot.
        const note = overview.locator('.sample-note');
        await expect(note).toContainText('View only in the sample – full research:');
        await expect(note.locator('code')).toHaveText('strom demo');
        await expect(note.locator('.sample-howto')).toHaveAttribute('href', 'https://stromapp.info/research/#demo');
        await expect(overview).toContainText('Sample as of 11/1/2026');
        await expectOff(page, overview.locator('.research-overview__work'), 'agent', 'Continue the research');
        await expectOff(page, overview.locator('.research-directions__new'), 'terminal', 'New direction');
        await expectOff(page, overview.locator('.research-overview__queue-order'), 'none', 'Change the queue\'s order');
        await expectOff(page, overview.locator('.research-overview__queue-now'), 'agent', 'Process now');
        await clickSaysWhy(page, overview.locator('.research-overview__work'), 'In full research: Continue the research · AI + terminal');
        await clickSaysWhy(page, overview.locator('.research-directions__new'), 'In full research: New direction · terminal');
    });

    test('What the research knows: the conflict and the hypothesis greyed, a source with its transcript and scan', async ({ page }) => {
        await openShowcase(page);
        const josef = await personId(page, 'Josef');
        await page.evaluate((id) => window.Strom.UI.showPersonResearchDialog(id), josef);
        const dialog = page.locator('.person-research-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.person-research-body > .sample-note').first()).toContainText('strom demo');
        // Its Copy as small as in the overview, not a dialog's button (10px 18px, 14px).
        const copy = dialog.locator('.sample-note .sample-copy');
        await expect(copy).toHaveCSS('font-size', '11.5px');
        expect((await copy.boundingBox())!.height).toBeLessThan(24);
        const conflict = dialog.locator('.person-research-conflict');
        await expect(conflict).toContainText('Rok narození Josefa Horáka');
        await expectOff(page, conflict.locator('[data-do="decide"]'), 'terminal', 'Decide in the research');
        await expectOff(page, dialog.locator('.person-research-agent'), 'agent', 'Leave it to the agent');
        await expectOff(page, dialog.locator('.person-research-hypo-link'), 'terminal', 'Decide in the research');
        await clickSaysWhy(page, dialog.locator('.person-research-agent'), 'In full research: Leave it to the agent · AI + terminal');
        // A source of the conflict: its transcript and its scan, read from the tree.
        await dialog.locator('.person-research-source', { hasText: 'Křest Josefa Horáka 1898' }).click();
        const source = page.locator('#source-viewer-modal');
        await expect(source).toBeVisible();
        await expect(source).toContainText('Josephus, natus 3. Martii 1898');
        await expect(source).toContainText('Transcription read by the research');
        await expect(source.getByRole('img', { name: 'Excerpt: Křest Josefa Horáka 1898' })).toBeVisible();
    });

    test('the conflict panel of an edit: both choices greyed, a click says why', async ({ page }) => {
        await openShowcase(page);
        const marie = await personId(page, 'Marie');
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'edit'), marie);
        await page.locator('#person-modal .pm-conflict-tag[data-field="input-birthdate"]').click();
        const panel = page.locator('#prc-panel');
        await expect(panel).toBeVisible();
        for (const side of ['user', 'research']) {
            const choice = panel.locator(`.prc-panel-row[data-side="${side}"] .prc-panel-choice`);
            await expect(choice).toHaveAttribute('data-showcase-off', 'terminal');
            await expect(choice).toHaveAttribute('aria-disabled', 'true');
        }
        const take = panel.locator('.prc-panel-row[data-side="research"] .prc-panel-choice');
        await take.click({ force: true });
        await expect(why(page)).toBeVisible();
        await expect(why(page).locator('.what')).toContainText('· terminal');
        expect(await launched(page)).toEqual([]);
    });

    test('the Research menu and the person menu: the agent and sending greyed', async ({ page }) => {
        await openShowcase(page);
        await openResearchMenu(page);
        await expectOff(page, page.locator('#research-item-chat'), 'agent', 'Continue with the agent');
        // Dimmed once (the design's opacity), its words and AI badge in their own colours.
        await expectDimmedOnce(page.locator('#research-item-chat'), page.locator('#research-item-overview'));
        const badge = await page.evaluate(() => {
            const b = document.body.appendChild(Object.assign(document.createElement('span'), { className: 'research-ai-badge' }));
            const bg = getComputedStyle(b).backgroundColor;
            b.remove();
            return bg;
        });
        await expect(page.locator('#research-item-chat .research-ai-badge')).toHaveCSS('background-color', badge);
        await clickSaysWhy(page, page.locator('#research-item-chat'), 'In full research: Continue with the agent · AI + terminal');
        await page.keyboard.press('Escape');
        await card(page, 'Josef').click();
        const sub = await openPersonSubmenu(page, 'research');
        await expect(sub.locator('[data-action="research-knows"]')).toBeVisible();
        const send = sub.locator('[data-showcase-label="Send to research"]');
        const ask = sub.locator('[data-showcase-label="Ask the agent"]');
        await expectOff(page, send, 'terminal', 'Send to research');
        await expectOff(page, ask, 'agent', 'Ask the agent');
        await expectDimmedOnce(send, sub.locator('[data-action="research-knows"]'));
        await ask.click({ force: true });
        await expect(why(page)).toBeVisible();
        await expect(why(page).locator('.what')).toHaveText('In full research: Ask the agent · AI + terminal');
        expect(await launched(page)).toEqual([]);
    });

    test('the bubble: hover shows it, the keyboard\'s Enter shows it and runs nothing, Escape closes', async ({ page }) => {
        await openShowcase(page);
        await page.evaluate(() => window.Strom.UI.openResearchOverview({}));
        const work = page.locator('#research-overview .research-overview__work');
        await work.hover();
        await expect(why(page)).toBeVisible();
        await expect(why(page).locator('.what')).toHaveText('In full research: Continue the research · AI + terminal');
        await page.mouse.move(5, 5);
        await expect(why(page)).toBeHidden();
        // The keyboard: the focus on it says why, Enter runs nothing.
        await page.keyboard.press('Tab');
        await work.focus();
        await expect(why(page)).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(why(page)).toBeVisible();
        expect(await launched(page)).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(why(page)).toBeHidden();
        await expect(page.locator('#research-overview')).toBeVisible();
    });

    test('the regular ask of the snapshot redraws nothing: the bubble and the focus stay', async ({ page }) => {
        await openShowcase(page);
        await page.evaluate(() => window.Strom.UI.openResearchOverview({}));
        const work = page.locator('#research-overview .research-overview__work');
        await page.keyboard.press('Tab');
        await work.focus();
        await expect(why(page)).toBeVisible();
        const before = await work.elementHandle();
        await poll(page);
        await poll(page);
        await expect(why(page)).toBeVisible();
        expect(await before!.evaluate(e => e.isConnected && e === document.activeElement)).toBe(true);
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

test.describe('New tree: the showcase\'s download size', () => {
    test('English: 0.3 MB', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        await page.locator('#tree-manager-modal .tree-manager-new-btn').click();
        await expect(page.locator('#new-tree-menu-modal #new-tree-showcase-desc')).toHaveText('A made-up family with view-only research · 0.3 MB download');
    });

    test('Czech: 0,3 MB', async ({ page }) => {
        await seedSetting(page, 'language', 'cs');
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        await page.locator('#tree-manager-modal .tree-manager-new-btn').click();
        await expect(page.locator('#new-tree-menu-modal #new-tree-showcase-desc')).toHaveText('Vymyšlená rodina s výzkumem jen k prohlížení · stáhne se 0,3 MB');
    });
});

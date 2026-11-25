import { test, expect, type Page } from '@playwright/test';
import { seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, fakeGlance, type FakeGateway, type TunnelReply } from './device-gateway.js';

/**
 * The agent's work started from a device (spec 094 K3.15, D13–D14) through
 * the fake gateway: the link goes to POST device/agent without a yes first;
 * an `ask` shows the sheet from below (a dialog on a tablet) with the app's
 * texts and the research's lines, its Start sends the yes, Back sends nothing;
 * `started` (run.confirm no), `computer` and `said` show no sheet; 503
 * agent.noterminal says the app's own sentence, never the bridge's; a yes that
 * expired (410) is asked again, a new sheet; Automatically / Only N asks with
 * the new link. The flow is started by the device mode's test hook, then by
 * the Research screen's own buttons (Now's row of a start by its state).
 * Invented data only (the Pýchavkovi of Mlýnky, the computer Pracovna).
 */

const PYCH = '6a1d2c3e-4b5f-4a6b-8c7d-9e0f1a2b3c4d';
const NAME = 'Pýchavkovi z Mlýnků';
const LOOP = `strom-research://work?tree=${PYCH}&do=loop`;
const TASKS = `strom-research://work?tree=${PYCH}&do=tasks&n=3`;
const NOTE = 'Odhad: asi 40 minut, čerpá předplatné (odhad 6 % denního přídělu).';

function ged(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 25 NOV 2026', `1 _STROM_TREE ${PYCH}`, '1 _STROM_HEAD 3c7a9e1f05b2',
        '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Jan /Pýchavka/', '1 SEX M', '1 BIRT', '2 DATE 1851', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Marie /Bedlová/', '1 SEX F', '1 BIRT', '2 DATE 1855', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@',
        '0 TRLR',
    ].join('\n');
}

/** One research tree with the Research screen's data and the agent's start from the device. */
function research(gw: FakeGateway): void {
    gw.trees = [{ id: PYCH, name: NAME, archive: false }];
    gw.computer = { name: '127.0.0.1', label: 'Pracovna' };
    gw.glance = fakeGlance({ id: PYCH, name: NAME });
    gw.agent = { start: true };
    gw.onTunnel = (req): TunnelReply | undefined => req.p === 'tree.ged'
        ? { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: ged() } : undefined;
}

async function seeds(page: Page): Promise<void> {
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await page.addInitScript(() => {
        try {
            localStorage.setItem('strom-tour-offered', '1');
            localStorage.setItem('strom-device-home-line', 'hidden');
        } catch { /* none */ }
    });
}

/** Paired: the start screen gone, the device mode's hooks in place. */
async function paired(page: Page, gw: FakeGateway): Promise<void> {
    await page.goto(gw.pairCode().url);
    await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 20000 });
    await page.waitForFunction(() => !!(globalThis as { __stromDeviceAgent?: unknown }).__stromDeviceAgent);
}

/** The flow started as a button of the device would start it (not awaited: the sheet waits for the person). */
async function start(page: Page, link: string, o: { only?: string } = {}): Promise<void> {
    await page.evaluate(([l, only]) => {
        type Hook = { start(link: string, ctx?: unknown): Promise<string> };
        const h = (globalThis as unknown as { __stromDeviceAgent: Hook }).__stromDeviceAgent;
        const sheet = only ? { kind: 'queue', tasks: 12, first: 'Ask the district archive (T0418)', mode: { n: 3, on: 'loop' },
            linkFor: (m: string) => m === 'tasks' ? only : l } : { kind: 'queue', tasks: 12 };
        (globalThis as { __agentFlow?: Promise<string> }).__agentFlow = h.start(l, { sheet });
    }, [link, o.only ?? ''] as const);
}

/** How the flow ended. */
const ended = (page: Page) => page.evaluate(() => (globalThis as { __agentFlow?: Promise<string> }).__agentFlow);

const sheet = (page: Page) => page.locator('#device-agent-sheet');
const toast = (page: Page) => page.locator('.toast[data-kind="device-agent"]');

let gw: FakeGateway;
test.beforeEach(async () => {
    gw = await startDeviceGateway();
});
test.afterEach(async () => {
    await gw.close();
});

test.describe('a phone (en)', () => {
    test.use({ locale: 'en-US' });
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        research(gw);
        await paired(page, gw);
    });

    test('ask: the sheet from below with the app\'s texts and the research\'s line; Start sends the yes', async ({ page }) => {
        await start(page, LOOP);
        const s = sheet(page);
        await expect(s.locator('.bottom-sheet.device-agent--sheet')).toBeVisible();
        await expect(s.locator('#device-agent-title')).toHaveText('Work on the queue');
        await expect(s.locator('#device-agent-sub')).toContainText(NAME);
        await expect(s.locator('.device-agent__row--terminal')).toContainText('opens on Pracovna');
        await expect(s.locator('.device-agent__row--note')).toHaveText(NOTE);
        const go = s.locator('#device-agent-go');
        await expect(go).toContainText('Start on Pracovna');
        await expect(go.locator('.research-ai-badge')).toHaveCount(1);
        const box = await go.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(gw.agentRequests).toHaveLength(1);
        expect(gw.agentRequests[0].yes).toBeUndefined();
        expect(gw.agentRequests[0].link).toBe(LOOP);
        await go.click();
        await expect(s).toHaveCount(0);
        expect(await ended(page)).toBe('started');
        expect(gw.agentRequests).toHaveLength(2);
        expect(gw.agentRequests[1]).toMatchObject({ link: LOOP, tree: PYCH });
        expect(gw.agentRequests[1].yes).toBeTruthy();
        await expect(toast(page)).toContainText('new terminal window on Pracovna');
    });

    test('Back sends nothing', async ({ page }) => {
        await start(page, LOOP);
        await expect(sheet(page).locator('#device-agent-back')).toBeVisible();
        await sheet(page).locator('#device-agent-back').click();
        await expect(sheet(page)).toHaveCount(0);
        expect(await ended(page)).toBe('cancelled');
        expect(gw.agentRequests).toHaveLength(1);
        expect(gw.agentRequests[0].yes).toBeUndefined();
        await expect(toast(page)).toHaveCount(0);
    });

    test('started without a yes (run.confirm no): no sheet, the quiet sentence', async ({ page }) => {
        gw.agentScenario = 'started';
        await start(page, LOOP);
        expect(await ended(page)).toBe('started');
        await expect(sheet(page)).toHaveCount(0);
        expect(gw.agentRequests).toHaveLength(1);
        expect(gw.agentRequests[0].yes).toBeUndefined();
        await expect(toast(page)).toContainText('Without confirmation (a setting of Pracovna)');
    });

    test('computer: no sheet, waiting on the computer', async ({ page }) => {
        gw.agentScenario = 'computer';
        await start(page, LOOP);
        expect(await ended(page)).toBe('waitPc');
        await expect(sheet(page)).toHaveCount(0);
        await expect(toast(page)).toContainText('Waiting on Pracovna');
    });

    test('said: the research\'s sentence, nothing started', async ({ page }) => {
        gw.agentScenario = 'said';
        await start(page, LOOP);
        expect(await ended(page)).toBe('notStarted');
        await expect(sheet(page)).toHaveCount(0);
        await expect(toast(page)).toContainText('Fronta je prázdná');
    });

    test('503 agent.noterminal: the app\'s own sentence, never the bridge\'s', async ({ page }) => {
        gw.agentScenario = 'noterminal';
        await start(page, LOOP);
        expect(await ended(page)).toBe('notStarted');
        await expect(toast(page)).toContainText('A terminal cannot be opened on Pracovna. Nothing was started.');
        await expect(toast(page)).not.toContainText('Spustit na počítači');
    });

    test('410 agent.yes-expired: asked again, a new sheet with a new yes', async ({ page }) => {
        gw.agentScenario = 'expired';
        await start(page, LOOP);
        await expect(sheet(page).locator('#device-agent-go')).toBeVisible();
        await sheet(page).locator('#device-agent-go').click();
        // The yes held no more: the question again without it, the sheet stays with the new one.
        await expect.poll(() => gw.agentRequests.length).toBe(3);
        expect(gw.agentRequests.map(r => !!r.yes)).toEqual([false, true, false]);
        await expect(sheet(page).locator('#device-agent-go')).not.toHaveAttribute('aria-disabled', 'true');
        gw.agentScenario = 'ask';
        await sheet(page).locator('#device-agent-go').click();
        await expect(sheet(page)).toHaveCount(0);
        expect(await ended(page)).toBe('started');
        expect(gw.agentRequests).toHaveLength(4);
        expect(gw.agentRequests[3].yes).toBeTruthy();
        expect(gw.agentRequests[3].yes).not.toBe(gw.agentRequests[1].yes);
    });

    test('Only N: the new link asked without a yes, Start sends the yes of that link', async ({ page }) => {
        await start(page, LOOP, { only: TASKS });
        const s = sheet(page);
        const opts = s.locator('.device-agent__seg-opt');
        await expect(opts).toHaveText(['Automatically', /Only 3/]);
        await expect(s.locator('.device-agent__first')).toContainText('(T0418)');
        for (const o of await opts.all()) expect((await o.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await opts.nth(1).click();
        await expect.poll(() => gw.agentRequests.length).toBe(2);
        expect(gw.agentRequests[1]).toMatchObject({ link: TASKS });
        expect(gw.agentRequests[1].yes).toBeUndefined();
        await expect(opts.nth(1)).toHaveAttribute('aria-checked', 'true');
        await expect(s.locator('#device-agent-go')).not.toHaveAttribute('aria-disabled', 'true');
        await s.locator('#device-agent-go').click();
        await expect(s).toHaveCount(0);
        expect(gw.agentRequests).toHaveLength(3);
        expect(gw.agentRequests[2]).toMatchObject({ link: TASKS });
        expect(gw.agentRequests[2].yes).toBeTruthy();
    });
});

test.describe('a phone (de, 360 px)', () => {
    test.use({ locale: 'de-DE' });

    test('the primary "Auf Pracovna starten" stays on one line', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        await seeds(page);
        research(gw);
        await paired(page, gw);
        await start(page, LOOP, { only: TASKS });
        const go = sheet(page).locator('#device-agent-go');
        await expect(go).toContainText('Auf Pracovna starten');
        const fit = await go.evaluate((b) => {
            const line = parseFloat(getComputedStyle(b).lineHeight) || 20;
            return { one: b.getBoundingClientRect().height < 44 + line, inside: b.scrollWidth <= b.clientWidth + 1,
                inSheet: b.getBoundingClientRect().right <= (b.closest('.device-agent') as HTMLElement).getBoundingClientRect().right };
        });
        expect(fit).toEqual({ one: true, inside: true, inSheet: true });
        await sheet(page).locator('#device-agent-back').click();
        expect(gw.agentRequests).toHaveLength(1);
    });
});

test.describe('a tablet (en)', () => {
    test.use({ locale: 'en-US', hasTouch: true });

    test('the same question in a dialog; Start sends the yes', async ({ page }) => {
        await page.setViewportSize({ width: 820, height: 1180 });
        await seeds(page);
        research(gw);
        await paired(page, gw);
        await start(page, LOOP);
        const s = sheet(page);
        await expect(s.locator('.modal.device-agent--dialog')).toBeVisible();
        await expect(s.locator('.bottom-sheet')).toHaveCount(0);
        await expect(s.locator('.device-agent__row--note')).toHaveText(NOTE);
        await s.locator('#device-agent-go').click();
        await expect(s).toHaveCount(0);
        expect(await ended(page)).toBe('started');
        expect(gw.agentRequests.map(r => !!r.yes)).toEqual([false, true]);
    });
});

/**
 * The Research screen's buttons of the agent (spec 094 K3.15 part C1, 10.2–10.13): Work on the queue… under Now,
 * a line's run in Line actions, Discuss with the agent and Leave it to the agent in Waiting; Now's row of a start
 * by its state; grey without the connection; the quiet sentences without `agent.start`.
 */
test.describe('the Research screen\'s buttons (a phone, en)', () => {
    test.use({ locale: 'en-US' });
    /** The page's and the gateway's clock, away from midnight UTC. */
    const T = Date.parse('2026-11-25T14:40:00Z');
    const scr = (page: Page) => page.locator('#phone-research');
    const nowSec = (page: Page) => scr(page).locator('.phone-sec[data-sec="now"]');
    const startRow = (page: Page) => nowSec(page).locator('.phone-start');
    const queueWork = (page: Page) => nowSec(page).locator('.phone-now-work');
    const menu = (page: Page) => page.locator('.bottom-sheet-overlay');
    const waitingSec = (page: Page) => scr(page).locator('.phone-sec[data-sec="waiting"]');

    async function onScreen(page: Page, o: { clock?: boolean } = {}): Promise<void> {
        await page.setViewportSize({ width: 390, height: 844 });
        await seeds(page);
        if (o.clock) {
            await page.clock.install({ time: T });
            gw.clockOffsetMs = T - Date.now();
        }
        await paired(page, gw);
        await expect(scr(page)).toBeVisible();
    }

    test.beforeEach(() => {
        research(gw);
    });

    test('Work on the queue…: the sheet, Start, starting, then the run of the queue in Now with Stop run', async ({ page }) => {
        let started = false;
        const at = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
        gw.glance = () => fakeGlance({ id: PYCH, name: NAME }, started ? {
            now: [{ since: at(0), way: 'other', task: { id: 'T0003', text: 'Křest Jana Pýchavky 1851' }, run: 'run-q1' }],
            runs: [{ id: 'run-q1', line: null, way: 'other', since: at(0), state: 'working', task: 'T0003' }],
        } : {});
        await onScreen(page);
        const b = queueWork(page);
        await expect(b).toContainText('Work on the queue…');
        await expect(b.locator('.research-ai-badge')).toHaveCount(1);
        await expect(b.locator('.research-open-mark')).toHaveCount(1);
        expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await b.click();
        await expect(sheet(page).locator('#device-agent-title')).toHaveText('Work on the queue');
        expect(gw.agentRequests[0].link).toBe(LOOP);
        await sheet(page).locator('#device-agent-go').click();
        await expect(sheet(page)).toHaveCount(0);
        await expect(startRow(page)).toHaveClass(/is-starting/);
        await expect(startRow(page)).toContainText('Starting work on the queue…');
        await expect(startRow(page)).toContainText('The agent comes up in a new terminal window on Pracovna.');
        await expect(queueWork(page)).toHaveCount(0);
        // No toast on the screen: Now says it.
        await expect(toast(page)).toHaveCount(0);
        // The research's glance with the run: Now's own row of the queue.
        started = true;
        gw.sendEvent({ event: 'change', data: { head: '5e9c1a7b3d20', what: ['run run-q1'] } });
        await expect(startRow(page)).toHaveCount(0, { timeout: 10000 });
        const row = nowSec(page).locator('.phone-line').first();
        await expect(row).toContainText('Queue · agent');
        await row.locator('.phone-line__more').click();
        await expect(menu(page).locator('#phone-now-stop')).toBeVisible();
    });

    test('Line actions: Put an agent on this direction (AI + terminal, where) and Work on this direction', async ({ page }) => {
        await onScreen(page);
        await scr(page).locator('.phone-sec[data-sec="lines"] .phone-line').first().locator('.phone-line__more').click();
        const run = menu(page).locator('#phone-line-run');
        await expect(run).toContainText('Put an agent on this direction');
        await expect(run).toContainText('in a new terminal window on Pracovna');
        await expect(run.locator('.research-ai-badge')).toHaveCount(1);
        await expect(menu(page).locator('#phone-line-work')).toContainText('Work on this direction');
        await expect(menu(page).locator('.bottom-sheet-quiet')).toHaveCount(0);
        await run.click();
        await expect(sheet(page).locator('#device-agent-go')).toBeVisible();
        expect(gw.agentRequests[0].link).toMatch(/^strom-research[a-z-]*:\/\/work\?/);
        expect(gw.agentRequests[0].link).toContain('research=G0001');
        expect(gw.agentRequests[0].link).toContain('do=loop');
    });

    test('Waiting: Discuss with the agent opens on Pracovna; Now shows the conversation at the computer', async ({ page }) => {
        await onScreen(page);
        const discuss = waitingSec(page).locator('button[data-act="waiting-agent"][data-do="discuss"]');
        await expect(discuss).toContainText('Discuss with the agent');
        await expect(discuss.locator('.research-ai-badge')).toHaveCount(1);
        await discuss.click();
        const go = sheet(page).locator('#device-agent-go');
        await expect(go).toContainText('Open on Pracovna');
        expect(gw.agentRequests[0].link).toMatch(/:\/\/task\?/);
        expect(gw.agentRequests[0].link).toContain('task=T0007');
        expect(gw.agentRequests[0].link).toContain('do=chat');
        await go.click();
        await expect(startRow(page)).toContainText('Conversation with the agent · on Pracovna');
        await startRow(page).locator('[data-act="agent-close"]').click();
        await expect(startRow(page)).toHaveCount(0);
    });

    test('Waiting: a conflict left to the agent', async ({ page }) => {
        const at = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
        gw.glance = fakeGlance({ id: PYCH, name: NAME }, {
            waiting: { n: 1, items: [{ id: 'X0001', kind: 'conflict', section: 'conflict', phase: 'todo', what: 'Birth of Jan Pýchavka',
                on: 'between two devices', at: at(100), group: { key: 'conflict', name: 'Conflicts', kind: 'conflict' }, person: 'P0001', do: ['keep'] }] },
        });
        await onScreen(page);
        const leave = waitingSec(page).locator('button[data-act="waiting-agent"][data-do="leave"]');
        await expect(leave).toContainText('Leave it to the agent');
        await leave.click();
        await expect(sheet(page).locator('#device-agent-go')).toBeVisible();
        expect(gw.agentRequests[0].link).toMatch(/:\/\/conflict\?/);
        expect(gw.agentRequests[0].link).toContain('id=X0001');
        expect(gw.agentRequests[0].link).toContain('do=agent');
    });

    test('started without a yes (run.confirm no): the quiet sentence in Now; 30 s without a proof: "Did the queue work not start?"', async ({ page }) => {
        gw.agentScenario = 'started';
        await onScreen(page, { clock: true });
        await queueWork(page).click();
        await expect(startRow(page)).toContainText('Without confirmation (a setting of Pracovna) · uses the AI subscription.');
        await expect(sheet(page)).toHaveCount(0);
        await page.clock.runFor(31_000);
        await expect(startRow(page)).toContainText('Did the queue work not start?');
        const retry = startRow(page).locator('[data-act="agent-retry"]');
        await expect(retry).toHaveText('Try again');
        await retry.click();
        await expect.poll(() => gw.agentRequests.length).toBe(2);
        expect(gw.agentRequests[1].link).toBe(LOOP);
        await expect(startRow(page)).toHaveClass(/is-starting/);
    });

    test('computer: waiting on the computer in Now', async ({ page }) => {
        gw.agentScenario = 'computer';
        await onScreen(page);
        await queueWork(page).click();
        await expect(startRow(page)).toHaveClass(/is-waitPc/);
        await expect(startRow(page)).toContainText('Waiting on Pracovna: the terminal asks for a confirmation.');
        await expect(startRow(page)).toContainText('A cost estimate or a consent is confirmed at the computer');
    });

    test('noterminal: not started, why and Try again — never silent', async ({ page }) => {
        gw.agentScenario = 'noterminal';
        await onScreen(page);
        await queueWork(page).click();
        await expect(startRow(page)).toHaveClass(/is-notStarted/);
        await expect(startRow(page)).toContainText('The work on the queue did not start');
        await expect(startRow(page).locator('.phone-start__why')).toHaveText('A terminal cannot be opened on Pracovna. Nothing was started.');
        await expect(startRow(page).locator('[data-act="agent-retry"]')).toBeVisible();
    });

    test('without the connection the agent\'s buttons are grey and nothing is asked', async ({ page }) => {
        await onScreen(page);
        await expect(queueWork(page)).toBeEnabled();
        gw.unreachable = true;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(queueWork(page)).toBeDisabled({ timeout: 15000 });
        await expect(waitingSec(page).locator('button[data-act="waiting-agent"]')).toBeDisabled();
        expect(gw.agentRequests).toHaveLength(0);
    });

    test('without agent.start the quiet sentences stay, no agent\'s button', async ({ page }) => {
        gw.agent = {};
        await onScreen(page);
        await expect(waitingSec(page).locator('.phone-wait__btn').first()).toBeVisible();
        await expect(queueWork(page)).toHaveCount(0);
        await expect(scr(page).locator('[data-act="waiting-agent"]')).toHaveCount(0);
        await scr(page).locator('.phone-sec[data-sec="lines"] .phone-line').first().locator('.phone-line__more').click();
        await expect(menu(page).locator('.bottom-sheet-quiet')).toContainText('Pracovna');
        await expect(menu(page).locator('#phone-line-run, #phone-line-work')).toHaveCount(0);
    });
});

/**
 * Paid tree fixes from a device (spec 094 K3.15 part C2): the research's Tree fixes on a second computer of the
 * home network; a fix its agent reads again starts through POST device/agent (the research: `fixes&id=` only when
 * paid), a fix that is not paid stays the computer's (no button, its quiet sentence), nothing handed to the system.
 */
test.describe('tree fixes on a device (a second computer, en)', () => {
    test.use({ locale: 'en-US' });
    const FIXES = {
        rev: 'r1',
        fixes: [
            { id: 'dates', state: 'pending', count: 4, unit: 'fact', paid: true,
                title: { en: 'Dates read again from the images' }, summary: { en: 'The agent reads the dates of four facts again.' } },
            { id: 'street-places', state: 'pending', count: 2, unit: 'place', paid: false,
                title: { en: 'Streets and house numbers in fact places' }, summary: { en: 'Town and house split.' } },
        ],
    };

    async function withFixes(page: Page, o: { start: boolean }): Promise<void> {
        gw.trees = [{ id: PYCH, name: NAME, archive: false }];
        gw.computer = { name: '127.0.0.1', label: 'Pracovna' };
        gw.agent = o.start ? { start: true } : {};
        gw.features = ['fixes.list'];
        gw.onTunnel = (req): TunnelReply | undefined => req.p === 'tree.ged'
            ? { s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: ged() }
            : req.p === 'fixes' && req.m === 'GET' ? { s: 200, body: FIXES } : undefined;
        await page.setViewportSize({ width: 1440, height: 900 });
        await seeds(page);
        await page.goto(gw.pairCode().url);
        await expect(page.locator('#device-boot')).toHaveCount(0, { timeout: 20000 });
        await expect(page.locator('#research-menu-btn')).toBeVisible({ timeout: 15000 });
        await page.evaluate(() => {
            // Opening links in the system is never done here: record any (none is expected).
            const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
            ui.__links = [];
            ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
        });
        await page.evaluate(() => window.Strom.UI.pollResearchBridge());
    }

    test('a paid fix starts through the gateway; a fix that is not paid is the computer\'s', async ({ page }) => {
        await withFixes(page, { start: true });
        await expect.poll(() => gw.tunnelled.some(r => r.p === 'fixes')).toBe(true);
        await page.evaluate(() => window.Strom.UI.showResearchFixesDialog());
        const dlg = page.locator('#research-fixes-modal');
        const paid = dlg.locator('.research-fix[data-fix="dates"]');
        const free = dlg.locator('.research-fix[data-fix="street-places"]');
        await expect(paid.locator('.research-fix-action .research-ai-badge')).toHaveCount(1);
        await expect(free.locator('.research-fix-action')).toHaveCount(0);
        await expect(free.locator('.research-fix-only')).toHaveText('Only on the computer with the research.');
        await paid.locator('.research-fix-action').click();
        await expect(sheet(page)).toBeVisible();
        await sheet(page).locator('#device-agent-go').click();
        await expect(sheet(page)).toHaveCount(0);
        expect(gw.agentRequests.map(r => [r.link, !!r.yes])).toEqual([
            [`strom-research://fixes?tree=${PYCH}&id=dates`, false], [`strom-research://fixes?tree=${PYCH}&id=dates`, true]]);
        // Opened in the research: the row waits for its answer, no button.
        await expect(paid.locator('.research-fix-action')).toHaveCount(0);
        expect(await page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links)).toEqual([]);
    });

    test('without agent.start: no Tree fixes on the device', async ({ page }) => {
        await withFixes(page, { start: false });
        await page.evaluate(() => window.Strom.UI.showResearchFixesDialog());
        await expect(page.locator('#research-fixes-modal')).toHaveCount(0);
        expect(gw.agentRequests).toHaveLength(0);
    });
});

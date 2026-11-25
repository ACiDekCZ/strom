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
 * the new link. The Research screen's buttons come later (part C): the flow is
 * started by the device mode's test hook. Invented data only (the Pýchavkovi
 * of Mlýnky, the computer Pracovna).
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

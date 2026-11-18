import { test, expect, Page } from '@playwright/test';
import { openApp, closeHandedOver } from './helpers.js';

/**
 * Handing a tree to the research watched in its dialog (waiting buttons, A175, screens 2a–2c): the dialog
 * stays and lists its steps; asked twice it posts once; a failure says the tree stayed unchanged with Try
 * again and Export GEDCOM; "Continue in the background" folds it into a progress toast with Show, and edits
 * wait meanwhile. "Start research" (A173, A94) hands its link over once, then waits for the research at
 * most 30 s with "Stop waiting". The research's bridge is answered by page.route. Invented data.
 */

const UUID = '7c1e2d30-4b5a-4c72-9f3c-0d1e2f3a4b5c';
const BRIDGE = 'http://127.0.0.1:5996/fedcba9876543210fedcba9876543210';
const cors = { 'access-control-allow-origin': '*' };
const TOKEN_RE = /^strom-research:\/\/new\?app=([A-Za-z0-9_-]{43})&browser=[a-z]+$/;

/** The research's version of what it took (loads at the first try). */
function researchVersion(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 3 OCT 2026', `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD abc1234', '1 CHAR UTF-8', '1 NOTE Horákovi z Lipové',
        '0 @P0001@ INDI', '1 NAME Bohumil /Horák/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Vlasta /Horáková/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@',
        '0 TRLR',
    ].join('\n');
}

interface Bridge {
    posts: number;
    /** The answers of the next hand-overs (the last repeats). */
    replies: { status: number; body: unknown }[];
    /** Held until released: the research takes its time. */
    hold: Promise<void> | null;
}

async function routeBridge(page: Page, token: string, init: Partial<Bridge> = {}): Promise<Bridge> {
    const b: Bridge = { posts: 0, replies: [{ status: 200, body: { tree: UUID, head: 'abc1234' } }], hold: null, ...init };
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
        if (path.endsWith('/adopt') && req.method() === 'GET') return json(200, { token, name: 'Horákovi z Lipové' });
        if (path.endsWith('/adopt') && req.method() === 'POST') {
            b.posts++;
            if (b.hold) await b.hold;
            const reply = b.replies.length > 1 ? b.replies.shift()! : b.replies[0];
            return json(reply.status, reply.body);
        }
        if (path.endsWith('/status')) {
            return json(200, { tree: { id: UUID, name: 'Horákovi z Lipové' }, head: 'abc1234', links: ['send', 'open', 'new'],
                accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null }, inbox: { trees: [], material: 0 }, sends: [] });
        }
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: researchVersion() });
        if (path.endsWith('/cancel')) return json(200, {});
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return b;
}

/** A new tree of two, its hand-over started (the link caught, not opened); the research's bridge routed. */
async function treeToHand(page: Page, init: Partial<Bridge> = {}): Promise<{ bridge: Bridge; launched: () => Promise<string[]> }> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: ['new', 'send', 'open'], at: new Date().toISOString() }));
    });
    await openApp(page);
    await page.evaluate(async () => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
        const p = (id: string, firstName: string, lastName: string, gender: string, extra: Record<string, unknown> = {}) => ({
            id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra,
        });
        await window.Strom.DataManager.importAsNewTree({
            persons: {
                a: p('a', 'Bohumil', 'Horák', 'male', { partnerships: ['u'] }),
                b: p('b', 'Vlasta', 'Horáková', 'female', { partnerships: ['u'] }),
            },
            partnerships: { u: { id: 'u', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married' } },
        }, 'Horákovi z Lipové');
        window.Strom.UI.updateTreeSwitcher();
    });
    const launched = () => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);
    await page.evaluate(() => window.Strom.UI.startResearchAdopt(window.Strom.DataManager.getCurrentTreeId()));
    const [url] = await launched();
    const bridge = await routeBridge(page, url.match(TOKEN_RE)![1], init);
    return { bridge, launched };
}

/** The research came back for the tree: its dialog. */
async function comeBack(page: Page): Promise<void> {
    await page.evaluate((base) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: base })), BRIDGE);
    await expect(page.locator('#research-adopt-confirm')).toBeVisible();
}

const dialog = (page: Page) => page.locator('#research-adopt-modal');
const steps = (page: Page) => dialog(page).locator('ul.steps > li');

test.describe('Hand over: the dialog shows its steps', () => {
    test('the research\'s status asked before the dialog: a progress toast says it until the dialog comes', async ({ page }) => {
        await treeToHand(page);
        let release!: () => void;
        const held = new Promise<void>(r => { release = r; });
        let asked = 0;
        await page.route(url => url.pathname.endsWith('/status'), async route => {
            asked++;
            await held;
            await route.fallback();
        });
        void page.evaluate((base) => window.Strom.UI.openExternalRequest(new URLSearchParams({ adopt: base })), BRIDGE);
        await expect.poll(() => asked).toBeGreaterThan(0);
        const toast = page.locator('.toast', { hasText: 'Connecting to the research…' });
        await expect(toast).toBeVisible();
        await page.waitForTimeout(300);
        await expect(toast).toBeVisible();
        await expect(page.locator('#research-adopt-confirm')).toHaveCount(0);
        release();
        await expect(page.locator('#research-adopt-confirm')).toBeVisible();
        await expect(toast).toHaveCount(0);
    });

    test('asked twice it posts once; the steps end with ✓, then Close · Open the research', async ({ page }) => {
        const { bridge } = await treeToHand(page);
        await comeBack(page);
        // Two activations in one go (a double click): one hand-over.
        await page.evaluate(() => {
            const b = document.querySelector<HTMLButtonElement>('#research-adopt-confirm')!;
            b.click();
            b.click();
        });
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).locator('h2')).toHaveText('Hand the tree to the research');
        await expect(dialog(page).locator('ul.steps')).toHaveAttribute('aria-live', 'polite');
        await expect(steps(page)).toHaveCount(4);
        await expect(steps(page).nth(1)).toContainText('2 people');
        await expect(dialog(page).locator('#research-adopt-open')).toContainText('Open research');
        await closeHandedOver(page);
        expect(bridge.posts).toBe(1);
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.id)).toBe(UUID);
    });

    test('refused: the sentence with Try again, Close · Export GEDCOM; Try again hands it over', async ({ page }) => {
        const { bridge } = await treeToHand(page, { replies: [{ status: 500, body: {} }, { status: 200, body: { tree: UUID, head: 'abc1234' } }] });
        await comeBack(page);
        await page.locator('#research-adopt-confirm').click();
        const end = dialog(page).locator('.research-adopt-end');
        await expect(end).toHaveAttribute('role', 'alert');
        await expect(end).toContainText('The research did not take the tree. The tree in the app stayed unchanged; the backup is saved.');
        await expect(steps(page).nth(2)).toHaveClass('fail');
        await expect(steps(page).nth(2).locator('.g')).toHaveText('!');
        await expect(steps(page).nth(3)).toHaveClass('todo');
        await expect(dialog(page).locator('#research-adopt-export')).toHaveText('Export GEDCOM');
        const download = page.waitForEvent('download');
        await dialog(page).locator('#research-adopt-export').click();
        expect((await download).suggestedFilename()).toMatch(/\.ged$/);
        await end.getByRole('button', { name: 'Try again' }).click();
        await closeHandedOver(page);
        expect(bridge.posts).toBe(2);
    });

    test('Continue in the background: a progress toast with Show; edits wait until it ends', async ({ page }) => {
        let release!: () => void;
        const { bridge } = await treeToHand(page, { hold: new Promise<void>(r => { release = r; }) });
        await comeBack(page);
        await page.locator('#research-adopt-confirm').click();
        await expect(steps(page).nth(2)).toHaveClass('run');
        await expect(dialog(page).locator('.research-adopt-wait-note')).toHaveText('Edits to the tree wait until the handover ends.');
        await dialog(page).locator('#research-adopt-background').click();
        await expect(dialog(page)).toHaveCount(0);
        const toast = page.locator('.toast--progress').filter({ hasText: 'Handing the tree to the research…' });
        await expect(toast).toContainText('The research takes over the tree · 3 of 4');
        // An edit meanwhile makes no change, a toast says why.
        await page.evaluate(() => {
            const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === 'Vlasta')!;
            window.Strom.UI.runPersonMenuAction(p.id, 'edit');
        });
        const modal = page.locator('#person-modal');
        await modal.locator('#input-firstname').fill('Věra');
        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('.toast[data-kind="edit-lock"]')).toHaveText('The tree is being handed to the research – edits are possible afterwards.');
        expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().some(p => p.firstName === 'Věra'))).toBe(false);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Discard changes' }).click();
        await expect(modal).toBeHidden();
        // Show brings the dialog back with its steps.
        await toast.getByRole('button', { name: 'Show' }).click();
        await expect(dialog(page)).toBeVisible();
        await expect(toast).toHaveCount(0);
        await expect(steps(page).nth(2)).toHaveClass('run');
        // Esc folds it away again; it ends in the toast.
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        release();
        await expect(page.locator('.toast--progress')).toContainText('Horákovi z Lipové is now linked to the research.', { timeout: 9_000 });
        expect(bridge.posts).toBe(1);
    });
});

test.describe('Start research: one hand-over, a limited wait', () => {
    test('started twice it hands one link over; waits at most 30 s with Stop waiting, then a neutral end', async ({ page }) => {
        await page.clock.install();
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.addInitScript(() => {
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: ['new', 'send', 'open'], at: new Date().toISOString() }));
        });
        await openApp(page);
        await page.evaluate(async () => {
            const launched: string[] = [];
            (window as unknown as { __launched: string[] }).__launched = launched;
            window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
            await window.Strom.DataManager.importAsNewTree({
                persons: { a: { id: 'a', firstName: 'Bohumil', lastName: 'Horák', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } },
                partnerships: {},
            }, 'Horákovi z Lipové');
            const id = window.Strom.DataManager.getCurrentTreeId();
            window.Strom.UI.startResearchAdopt(id);
            window.Strom.UI.startResearchAdopt(id);
        });
        const launched = await page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);
        expect(launched).toHaveLength(1);
        await expect(page.locator('.toast--progress')).toContainText('Opening the research…');
        await page.clock.fastForward(11_000);
        const wait = page.locator('.toast--progress');
        await expect(wait).toHaveCount(1);
        await expect(wait).toContainText('Waiting for the research…');
        await expect(wait).toContainText('The setting up finishes in the terminal.');
        await expect(wait.getByRole('button', { name: 'Stop waiting' })).toBeVisible();
        await expect(wait.getByRole('button', { name: 'Not installed? Install…' })).toBeVisible();
        await page.clock.fastForward(20_000);
        await expect(wait).toContainText('Did the terminal not open?');
        await expect(wait).toContainText('The research takes the tree over once it is set up in the terminal.');
        await expect(wait).toHaveAttribute('role', 'status');
        const token = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchAdoptToken?.token);
        expect(launched[0]).toContain(token!);
        // Try again hands the same link over again.
        await wait.getByRole('button', { name: 'Try again' }).click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched)).toEqual([launched[0], launched[0]]);
        await page.clock.fastForward(11_000);
        await page.locator('.toast--progress').getByRole('button', { name: 'Stop waiting' }).click();
        await expect(page.locator('.toast--progress')).toHaveCount(0);
        // The token stays: the research can still come back.
        expect(await page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.researchAdoptToken?.token)).toBe(token);
    });
});

import { test, expect, Page, Route } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { dropFile } from './research-bridge.js';

/**
 * Links into the app beyond the tree (the macOS widget, spec 019 U4):
 * `?tree=<slug>&research=<uuid>&person=<P-id>` opens the tree, focuses and
 * centres the person and opens the person page; `&show=waiting` opens
 * "Awaiting action" of the tree's research (the overview there when an agent
 * works and the research is followed). Another tree, an unknown person, a
 * tree without a research: the tree opens with a short notice. `person` and
 * `show` leave the address; plain `?tree=` / `?research=` links do nothing
 * more than before. Invented families only.
 */

const UUID = '5c8e2a41-9d3b-4f6e-a1c7-2b9d0e4f6a13';
const OTHER = '0e7d3c2b-1a49-4f58-b6c7-d8e9f0a1b2c3';
const BRIDGE = 'http://127.0.0.1:5993/33333333333333333333333333333333';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function researchGed(): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 1 NOV 2026',
        `1 _STROM_TREE ${UUID}`, '1 _STROM_HEAD h1', '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Lhotákovi ze Lhoty',
        '0 @P0001@ INDI', '1 NAME Bořivoj /Lhoták/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Dobromila /Lhotáková/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0012@ INDI', '1 NAME Božetěch /Lhoták/', '1 SEX M', '1 BIRT', '2 DATE 1868', '1 REFN P0012', '2 TYPE strom-research', '1 FAMC @F0001@',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@',
        '0 TRLR',
    ].join('\n');
}

interface Bridge { working: unknown[]; waiting: unknown[] }

function statusOf(b: Bridge) {
    return {
        tree: { id: UUID, name: 'Lhotákovi ze Lhoty' }, head: 'h1', persons: 3, working: b.working, waiting: b.waiting, queue: [], links: LINKS,
        accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null }, inbox: { trees: [], material: 0 }, sends: [], lastIntake: null,
    };
}

async function serve(page: Page, b: Bridge): Promise<void> {
    await page.route(`${BRIDGE}/**`, async (route: Route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, PUT, POST', 'access-control-allow-headers': '*' } });
        }
        const path = new URL(req.url()).pathname;
        if (path.endsWith('/status')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(statusOf(b)) });
        }
        if (path.endsWith('/tree.ged')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: researchGed() });
        }
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(statusOf(b))}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
}

/** The research tree in the app; `bridge`: its bridge's address kept on this computer. Returns the tree's slug. */
async function researchTree(page: Page, opts: { bridge?: boolean; waiting?: unknown[] } = {}): Promise<string> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await dropFile(page, 'lhotakovi.ged', researchGed());
    await expect(card(page, 'Božetěch')).toBeVisible();
    return page.evaluate(({ uuid, bridge, waiting }) => {
        const { TreeManager } = window.Strom;
        const tree = TreeManager.getActiveTreeId()!;
        if (bridge) localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base: bridge, accepts: { sync: { auto: 'off' } } }));
        if (waiting) localStorage.setItem(`strom-research-waiting:${uuid}`, JSON.stringify({ items: waiting, at: new Date().toISOString() }));
        // Not the focus at the start: the link has something to do.
        return TreeManager.getTreeSlug(tree)!;
    }, { uuid: UUID, bridge: opts.bridge ? BRIDGE : null, waiting: opts.waiting ?? null });
}

const params = (page: Page) => [...new URL(page.url()).searchParams.keys()];
const focusName = (page: Page) => page.evaluate(() => {
    const { TreeRenderer, DataManager } = window.Strom;
    const id = TreeRenderer.getFocusPersonId();
    return id ? DataManager.getPerson(id)?.firstName ?? null : null;
});
const personPage = (page: Page) => page.locator('#person-page-modal');
const notice = (page: Page, text: string) => page.locator('.toast', { hasText: text });

test.describe('a link to a person', () => {
    test('the research id opens the tree, focuses the person and opens the person page; the parameters leave', { tag: '@smoke' }, async ({ page }) => {
        const slug = await researchTree(page);
        await page.goto(`/strom.html?tree=${slug}&research=${UUID}&person=P0012`);
        await expect(personPage(page)).toBeVisible();
        await expect(personPage(page).locator('.pp-sub')).toContainText('Božetěch Lhoták');
        expect(await focusName(page)).toBe('Božetěch');
        await expect.poll(() => params(page)).toEqual(['tree']);
        // The person page closes onto the tree, the card in view.
        await page.keyboard.press('Escape');
        await expect(personPage(page)).toHaveCount(0);
        await expect(card(page, 'Božetěch')).toBeInViewport();
    });

    test('the app\'s own id in a tree without a research', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        const { slug, id } = await page.evaluate(async () => {
            const { TreeManager, DataManager, UI } = window.Strom;
            const tree = TreeManager.createTree('Kopeckých rod');
            await UI.switchToTree(tree);
            const a = DataManager.createPerson({ firstName: 'Radomil', lastName: 'Kopecký', gender: 'male' });
            DataManager.createPerson({ firstName: 'Vlastimila', lastName: 'Kopecká', gender: 'female' });
            await TreeManager.flush();
            return { slug: TreeManager.getTreeSlug(tree)!, id: a.id as string };
        });
        await page.goto(`/strom.html?tree=${slug}&person=${encodeURIComponent(id)}`);
        await expect(personPage(page)).toBeVisible();
        await expect(personPage(page).locator('.pp-sub')).toContainText('Radomil Kopecký');
        await expect.poll(() => params(page)).toEqual(['tree']);
    });

    test('an unknown person: the tree opens with a notice, nothing else', async ({ page }) => {
        const slug = await researchTree(page);
        await page.goto(`/strom.html?tree=${slug}&research=${UUID}&person=P0999`);
        await expect(notice(page, 'The linked person is not in this tree.')).toBeVisible();
        await expect(card(page, 'Božetěch')).toBeVisible();
        await expect(personPage(page)).toHaveCount(0);
        await expect.poll(() => params(page)).toEqual(['tree']);
    });

    test('a research that is not here: never a person of another tree', async ({ page }) => {
        await researchTree(page);
        await page.goto(`/strom.html?research=${OTHER}&person=P0012`);
        await expect(notice(page, 'The linked tree is not in this browser.')).toBeVisible();
        await expect(personPage(page)).toHaveCount(0);
    });
});

test.describe('a link to "Awaiting action"', () => {
    test('a tree without a research: a notice', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        const slug = await page.evaluate(async () => {
            const { TreeManager, DataManager, UI } = window.Strom;
            const tree = TreeManager.createTree('Kopeckých rod');
            await UI.switchToTree(tree);
            DataManager.createPerson({ firstName: 'Radomil', lastName: 'Kopecký', gender: 'male' });
            await TreeManager.flush();
            return TreeManager.getTreeSlug(tree)!;
        });
        await page.goto(`/strom.html?tree=${slug}&show=waiting`);
        await expect(notice(page, 'The tree is not linked to a research.')).toBeVisible();
        await expect(page.locator('#live-panel')).toHaveCount(0);
        await expect.poll(() => params(page)).toEqual(['tree']);
    });

    test('the research not running: its last known state, at the section', async ({ page }) => {
        const slug = await researchTree(page, { waiting: [{ id: 'T0001', what: 'Confirm the father of Božetěch', at: ago(60_000) }] });
        await page.goto(`/strom.html?tree=${slug}&research=${UUID}&show=waiting`);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        await expect(panel).toHaveClass(/idle/);
        await expect(panel.locator('.live-panel-heading-waiting')).toHaveText('Awaiting action · 1');
        await expect(panel.locator('.live-waiting')).toContainText('Confirm the father of Božetěch');
        await expect.poll(() => params(page)).toEqual(['tree']);
    });

    test('an agent at work: followed, the overview open at "Awaiting action"', async ({ page }) => {
        await page.addInitScript(() => {
            (globalThis as { __OTHER_RESEARCH_MS?: unknown }).__OTHER_RESEARCH_MS = { first: 50, every: 800, fresh: 0, timeout: 600 };
            localStorage.setItem('strom-research-auto-intro-seen', '1');
        });
        await serve(page, {
            working: [{ who: 'agent-matriky', since: ago(9 * 60_000), task: 'Křest Božetěcha 1868', research: 'G0001' }],
            waiting: [{ id: 'T0001', what: 'Confirm the father of Božetěch', on: 'user', at: ago(60_000) },
                { id: 'T0002', what: 'Pick a register', on: 'user', at: ago(120_000) }],
        });
        const slug = await researchTree(page, { bridge: true });
        await page.goto(`/strom.html?tree=${slug}&research=${UUID}&show=waiting`);
        const overview = page.locator('#research-overview');
        await expect(overview).toBeVisible({ timeout: 15_000 });
        await expect(overview.locator('.live-panel-heading-waiting')).toContainText('Awaiting action · 2');
        await expect(overview.locator('#ov-sec-waiting')).toBeVisible();
        expect(await page.evaluate(() => window.Strom.DataManager.isLiveFollowing())).toBe(true);
        await expect.poll(() => params(page)).toEqual(['tree']);
    });
});

test('plain ?tree= and ?research= links: the tree, nothing opened over it', async ({ page }) => {
    const slug = await researchTree(page);
    await page.goto(`/strom.html?tree=${slug}&research=${UUID}`);
    await expect(card(page, 'Božetěch')).toBeVisible();
    await expect.poll(() => params(page)).toEqual(['tree']);
    await expect(personPage(page)).toHaveCount(0);
    await expect(page.locator('#research-overview')).toHaveCount(0);
    await expect(page.locator('.toast', { hasText: /linked/ })).toHaveCount(0);
});

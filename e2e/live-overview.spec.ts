import { test, expect, Page } from '@playwright/test';
import { card } from './helpers.js';

/**
 * Following a research live: every section of the small panel folds on its
 * own (remembered, folded by itself when short of room, "Waiting for you"
 * never, and a new task unfolds it), the panel lists the last five changes;
 * the Research overview (⤢) beside the tree: the tree narrows, a summary,
 * Waiting cards with the person, Progress with filters, hover and "Show
 * changed in tree", Escape back to the panel. Tablet: over the tree; phone:
 * a strip that opens a sheet. Invented data only.
 */

const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const BRIDGE = 'http://127.0.0.1:5996/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const ALL = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research',
    'new', 'update', 'sessions', 'conflict', 'story', 'sync-undo', 'setup', 'live'];

function ged(extra: boolean): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 27 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @S12@ SOUR', '1 TITL Křestní matrika Chlumy 1865', '1 REFN S0012',
        ...(extra ? ['0 @S31@ SOUR', '1 TITL Sčítání lidu 1880', '1 REFN S0031'] : []),
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
        '0 @P0012@ INDI', '1 NAME Jan /Víšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '2 SOUR @S12@', '1 REFN P0012', '1 FAMC @F0001@',
        '1 _STROM_CONFLICT X0007', '2 TYPE BIRT', '2 STAT open', '2 VAL 3 FEB 1865', '2 VAL 1866',
        ...(extra ? [
            '0 @P0004@ INDI', '1 NAME Ludmila /Víšková/', '1 SEX F', '1 REFN P0004', '1 FAMC @F0001@',
            '0 @P0005@ INDI', '1 NAME Marie /Víšková/', '1 SEX F', '1 REFN P0005', '1 FAMC @F0001@',
            '0 @P0006@ INDI', '1 NAME Karel /Víšek/', '1 SEX M', '1 REFN P0006', '1 FAMC @F0001@',
        ] : []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@',
        ...(extra ? ['1 CHIL @P0004@', '1 CHIL @P0005@', '1 CHIL @P0006@'] : []),
        '0 TRLR',
    ].join('\n');
}

const CHANGE = [
    '+P0004 Ludmila /Víšková/ · E0006 BIRT 1868 [lead]',
    '+P0005 Marie /Víšková/',
    '+P0006 Karel /Víšek/',
    '+S0031 Sčítání lidu 1880',
    'P0012 _STORY navrh',
    'F0001 +child P0006',
];

interface Bridge { waiting: Record<string, unknown>[]; gedCalls: number; log: Record<string, unknown> | null; events: boolean; paused: Record<string, unknown> | null; workPerson: string }

/** A bridge that sends one change of six lines, then keeps quiet. */
async function follow(page: Page, size: { width: number; height: number } = { width: 1440, height: 900 },
    setup: (b: Bridge) => void = () => {}): Promise<Bridge> {
    await page.setViewportSize(size);
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, ALL);
    const bridge: Bridge = {
        waiting: [
            { id: 'T0004', what: 'Uložte snímek oddací matriky', person: 'P0012', at: new Date().toISOString() },
            { id: 'T0005', what: 'Potvrďte otce Jana', at: new Date().toISOString() },
        ],
        gedCalls: 0,
        log: null,
        events: true,
        paused: null,
        workPerson: 'P0012',
    };
    setup(bridge);
    const status = () => ({
        tree: { id: UUID, name: 'Víškovi' }, head: bridge.gedCalls > 1 ? 'h2' : 'h1', persons: 3,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 16 * 60_000).toISOString(), ...(bridge.paused ? { paused: bridge.paused } : { task: 'Sčítání 1921', person: bridge.workPerson }) }],
        waiting: bridge.waiting, links: ALL,
        queue: [{ id: 'T0101', text: 'Matriky Chlumy', state: 'next', person: 'P0001' }, { id: 'T0102', text: 'Pozemková kniha', state: 'next' }],
        queueMore: 3,
        spend: { month: '2026-09', sessions: 4, amount: 3.2, currency: 'USD' },
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        }
        if (path.endsWith('/tree.ged')) {
            bridge.gedCalls++;
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: ged(bridge.gedCalls > 1) });
        }
        if (path.endsWith('/log') && bridge.log) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(bridge.log) });
        }
        if (path.endsWith('/events')) {
            if (!bridge.events) return new Promise(() => {});
            const body = `event: hello\ndata: ${JSON.stringify(status())}\n\n`
                + `event: change\ndata: ${JSON.stringify({ head: 'h2', what: CHANGE, at: new Date().toISOString() })}\n\n`;
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    return bridge;
}

const head = (page: Page, root: string, title: string) =>
    page.locator(`${root} .live-section__head`).filter({ has: page.locator('.live-section__title', { hasText: title }) });

test.describe('small live panel', () => {
    test('each section folds, the choice survives a reload; five changes and a way to all', async ({ page }) => {
        await follow(page);
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-changes li')).toHaveCount(5);
        // Newest first; the people in a change are links.
        await expect(panel.locator('.live-change-text .live-person-link').first()).toHaveText('Karel Víšek');
        await expect(panel.locator('.live-section__title')).toHaveText(['At work', 'Waiting for you · 2', 'Latest changes', 'Up next']);
        await expect(head(page, '#live-panel', 'At work').locator('.live-section__sum')).toHaveText(/agent-matriky · 1[67] min/);
        await expect(panel.locator('.live-working .live-time')).toHaveText(/^since \d{1,2}:\d{2}.* · 1[67] min$/);
        await expect(head(page, '#live-panel', 'Up next').locator('.live-section__sum')).toHaveText('5 tasks');

        // Folded for lack of room or not, Changes unfolds on a click; all changes are in the overview.
        const changes = head(page, '#live-panel', 'Latest changes');
        if (await changes.getAttribute('aria-expanded') === 'false') await changes.click();
        await expect(changes).toHaveAttribute('aria-expanded', 'true');
        await panel.locator('.live-all-changes').click();
        await expect(page.locator('#research-overview')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel).toBeVisible();

        // A click flips a section (folded by the panel itself or not) and is remembered.
        const work = head(page, '#live-panel', 'At work');
        const was = await work.getAttribute('aria-expanded');
        const now = was === 'true' ? 'false' : 'true';
        await work.click();
        await expect(work).toHaveAttribute('aria-expanded', now);
        await expect(page.locator(`#${await work.getAttribute('aria-controls')}`)).toBeVisible({ visible: now === 'true' });
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-live-sections') ?? '{}'))).toMatchObject({ working: now === 'false', changes: false });
        await page.reload();
        await expect(head(page, '#live-panel', 'At work')).toHaveAttribute('aria-expanded', now);
        await expect(head(page, '#live-panel', 'Waiting for you · 2')).toHaveAttribute('aria-expanded', 'true');
    });

    test('short of room: Up next, then Changes fold by themselves, Waiting never; a new task unfolds Waiting', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 520 });
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-changes li').first()).toBeAttached();
        await expect(head(page, '#live-panel', 'Up next')).toHaveAttribute('aria-expanded', 'false');
        await expect(head(page, '#live-panel', 'Waiting for you · 2')).toHaveAttribute('aria-expanded', 'true');
        // Folding by itself is not remembered.
        expect(await page.evaluate(() => localStorage.getItem('strom-live-sections'))).toBeNull();

        await head(page, '#live-panel', 'Waiting for you · 2').click();
        await expect(head(page, '#live-panel', 'Waiting for you · 2')).toHaveAttribute('aria-expanded', 'false');
        bridge.waiting = [...bridge.waiting, { id: 'T0009', what: 'Nový úkol', at: new Date().toISOString() }];
        await expect(head(page, '#live-panel', 'Waiting for you · 3')).toHaveAttribute('aria-expanded', 'true', { timeout: 15000 });
    });
});

test.describe('the research history (/log)', () => {
    test('opening the app shows what really happened, not only what came while watching', async ({ page }) => {
        const hour = 3600_000;
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.log = { entries: [
                { head: 'h2', at: new Date(Date.now() - 4 * 60_000).toISOString(), what: ['N0007 closed: T0134: hotovo'], task: '' },
                { head: 'h1', at: new Date(Date.now() - 5 * 60_000).toISOString(), what: ['+S0031 Sčítání lidu 1880', 'P0012 _STORY navrh'], task: 'T0134 Úmrtí Václava' },
                { head: 'h0', at: new Date(Date.now() - 30 * hour).toISOString(), what: ['+P0099 Starý /Záznam/'], task: '' },
            ] };
        });
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-changes li')).toHaveCount(4);
        // Newest first; within one version its last line first (as the changes that come live).
        await expect(panel.locator('.live-changes li')).toContainText(['N0007 closed', 'Jan Víšek', 'Sčítání lidu 1880', 'Starý Záznam']);
        // The history is not news: no "N new".
        await expect(panel.locator('.live-section__sum--new')).toHaveCount(0);
        await panel.locator('.live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__cell-label').nth(1)).toHaveText('Last 24 h');
        await expect(ov.locator('.research-overview__cell-value').nth(1)).toHaveText('+0 people');
        await expect(ov.locator('.research-overview__cell-sub').nth(1)).toHaveText('+1 source');
        await expect(ov.locator('.research-overview__cell-sub').first()).toHaveText(/^last change 4 min/);
        await expect(ov.locator('.research-overview__group-title').first()).toHaveText('T0134 Úmrtí Václava');
        // A preview of the last 24 hours: the older change is left to the research.
        // The session's closing line (no task of its own) joins the task it names.
        await expect(ov.locator('.research-overview__group-head')).toHaveCount(1);
        // A task nobody works on now is done: folded; a click opens it.
        await expect(ov.locator('.research-overview__group-head')).toHaveAttribute('aria-expanded', 'false');
        await expect(ov.locator('.research-overview__row')).toHaveCount(0);
        await ov.locator('.research-overview__group-head').click();
        await expect(ov.locator('.research-overview__row')).toHaveCount(3);
        await ov.locator('.research-overview__group-head').click();
        // A filter opens the groups: what it found is to be seen.
        await ov.locator('.research-overview__filter[data-filter="stories"]').click();
        await expect(ov.locator('.research-overview__row')).toHaveCount(1);
        await ov.locator('.research-overview__filter[data-filter="all"]').click();
        await expect(ov.locator('.research-overview__row')).toHaveCount(0);
        await expect(ov.locator('.research-overview__older')).toContainText('Older changes are in the research');
        // From the research's history the highlight says its window, not "while watching".
        await ov.locator('.research-overview__show-changed').click();
        await expect(page.locator('#evidence-pill')).toContainText('Changed in the last 24 h · 1');
    });

    test('the overview previews at most 20 steps, the rest is in the research', async ({ page }) => {
        const min = 60_000;
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.events = false;
            b.log = { entries: Array.from({ length: 25 }, (_, i) => ({
                head: `h${i}`, at: new Date(Date.now() - (i + 1) * 20 * min).toISOString(), what: [`+S${String(100 + i).padStart(4, '0')} Zdroj ${i}`], task: `T${1000 + i} Úkol ${i}`,
            })) };
        });
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__group-head')).toHaveCount(20);
        await expect(ov.locator('.research-overview__older')).toHaveCount(1);
    });
});

test.describe('the agent badge', () => {
    test('marks whom the agent works on now, not the people of its queue', async ({ page }) => {
        // Anna (no conflict of her own, which would come first) is worked on; Josef is only queued.
        await follow(page, { width: 1440, height: 900 }, (b) => { b.waiting = []; b.workPerson = 'P0002'; });
        await expect(card(page, 'Anna').locator('.card-signal.signal-agent')).toHaveCount(1);
        await expect(card(page, 'Josef').locator('.card-signal')).toHaveCount(0);
    });
});

test.describe('a run waiting for its gate', () => {
    test('is paused, not working: when it goes on, and no agent badge (a queued person gets none either)', async ({ page }) => {
        const until = new Date(Date.now() + 90 * 60_000);
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.waiting = [];
            b.paused = { until: until.toISOString(), reason: 'Claude usage 92 %' };
        });
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-paused')).toContainText('Paused · Claude usage 92 % · resumes at');
        await panel.locator('.live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov.locator('.research-overview__cell').first()).toHaveClass(/is-paused/);
        await expect(ov.locator('.research-overview__cell-value').first()).toHaveText('Paused');
        await expect(ov.locator('.research-overview__cell-sub').first()).toHaveText(/^resumes at /);
        await expect(page.locator('.person-card .card-signal.signal-agent')).toHaveCount(0);
    });
});

test.describe('Research overview', () => {
    test('desktop: beside a narrower tree; summary, waiting, progress, filters, hover, changed, Escape', async ({ page }) => {
        await follow(page);
        const panel = page.locator('#live-panel');
        await expect(panel.locator('.live-changes li')).toHaveCount(5);
        const before = await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width);
        const midBefore = await page.evaluate(() => {
            const { width, height } = window.Strom.ZoomPan.getViewportSize();
            const t = window.Strom.ZoomPan.getTransform();
            return [(width / 2 - t.tx) / t.scale, (height / 2 - t.ty) / t.scale];
        });

        await panel.locator('.live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toBeVisible();
        await expect(ov).toHaveAttribute('role', 'complementary');
        await expect(panel).toBeHidden();
        const after = await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width);
        expect(after).toBeLessThan(before - 400);
        // The point in the middle of the view stays in the middle.
        const midAfter = await page.evaluate(() => {
            const { width, height } = window.Strom.ZoomPan.getViewportSize();
            const t = window.Strom.ZoomPan.getTransform();
            return [(width / 2 - t.tx) / t.scale, (height / 2 - t.ty) / t.scale];
        });
        expect(Math.abs(midAfter[0] - midBefore[0])).toBeLessThan(2);
        expect(Math.abs(midAfter[1] - midBefore[1])).toBeLessThan(2);

        await expect(ov.locator('.research-overview__cell-value')).toHaveText(['Working', '+3 people', '$3.20']);
        // The state says when the research last changed; its version only on hover.
        const stateSub = ov.locator('.research-overview__cell-sub').first();
        await expect(stateSub).toHaveText(/^last change (just now|\d+ min)/);
        await expect(stateSub).toHaveAttribute('title', /· Research version h2$/);
        await expect(ov.locator('.research-overview__cell-sub').nth(1)).toHaveText(/^\+1 source · since \d{1,2}:\d{2}/);
        const cards = ov.locator('.research-overview__waiting-card');
        await expect(cards).toHaveCount(2);
        await expect(cards.nth(0).locator('.live-person-link')).toHaveText('Jan Víšek');
        await expect(cards.nth(1)).toContainText('whole research');
        await expect(ov.locator('.research-overview__now-row')).toContainText('agent-matriky — Sčítání 1921');
        await expect(ov.locator('.research-overview__now-row .link-button')).toHaveText('Show in tree');

        // Progress: one group (the task), every change; the filters count and filter.
        await expect(ov.locator('.research-overview__group-head')).toHaveCount(1);
        await expect(ov.locator('.research-overview__group-title')).toHaveText('Sčítání 1921');
        // The task the agent works on now stays open.
        await expect(ov.locator('.research-overview__group-head')).toHaveAttribute('aria-expanded', 'true');
        await expect(ov.locator('.research-overview__row')).toHaveCount(6);
        await expect(ov.locator('.research-overview__filter')).toHaveText(['All 6', 'People 4', 'Sources 1', 'Stories 1']);
        await ov.locator('.research-overview__filter[data-filter="sources"]').click();
        await expect(ov.locator('.research-overview__row')).toHaveCount(1);
        await expect(ov.locator('.research-overview__filter[data-filter="sources"]')).toHaveAttribute('aria-checked', 'true');
        await ov.locator('.research-overview__filter[data-filter="all"]').click();

        // Hovering a row lights its card up.
        await ov.locator('.research-overview__row.has-person', { hasText: 'Ludmila' }).hover();
        await expect(card(page, 'Ludmila')).toHaveClass(/overview-hover/);
        await ov.locator('.research-overview__head').hover();
        await expect(page.locator('.person-card.overview-hover')).toHaveCount(0);

        // Queue and What the research knows start folded.
        await expect(head(page, '#research-overview', 'Queue')).toHaveAttribute('aria-expanded', 'false');
        await expect(head(page, '#research-overview', 'What the research knows').locator('.live-section__sum')).toHaveText('1 conflict');

        await ov.locator('.research-overview__show-changed').click();
        await expect(page.locator('#evidence-pill')).toContainText('Changed while watching · 4');
        await expect(card(page, 'Ludmila')).toHaveClass(/evidence-hit/);
        await expect(card(page, 'Josef')).toHaveClass(/evidence-dim/);
        // A filter narrows the people shown in the tree (Stories: whose story changed).
        await ov.locator('.research-overview__filter[data-filter="stories"]').click();
        await expect(page.locator('#evidence-pill')).toContainText('Changed while watching · Stories · 1');
        await expect(card(page, 'Ludmila')).toHaveClass(/evidence-dim/);
        await ov.locator('.research-overview__filter[data-filter="all"]').click();
        await expect(page.locator('#evidence-pill')).toContainText('Changed while watching · 4');
        await expect(ov).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#evidence-pill')).toHaveCount(0);
        await expect(ov).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(ov).toHaveCount(0);
        await expect(panel).toBeVisible();
        await expect(panel).not.toHaveClass(/ended/);
        expect(await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(before, 0);
    });

    test('the overview opens again with the next following; Actions → Research has it', async ({ page }) => {
        await follow(page);
        await page.locator('#live-panel .live-panel-expand').click();
        await expect(page.locator('#research-overview')).toBeVisible();
        await page.reload();
        await expect(page.locator('#research-overview')).toBeVisible();
        await page.locator('#research-overview .research-overview__close').click();
        await expect(page.locator('#research-overview')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.toggleActionsMenu?.());
        await page.evaluate(() => window.Strom.UI.refreshResearchMenu());
        await page.evaluate(() => window.Strom.UI.researchActionOverview());
        await expect(page.locator('#research-overview')).toBeVisible();
        await expect(page.locator('#research-item-overview')).toHaveCount(1);
        // Already following: no "Follow live".
        await expect(page.locator('#research-item-live')).toHaveCount(0);
    });

    test('switching the language redraws the panel and the overview', async ({ page }) => {
        await follow(page);
        await expect(page.locator('#live-panel .live-changes li')).toHaveCount(5);
        await page.evaluate(() => window.Strom.UI.setLanguage('cs'));
        await expect(page.locator('#live-panel .live-section__title').first()).toHaveText('Pracuje se');
        await page.locator('#live-panel .live-panel-expand').click();
        await expect(page.locator('#research-overview .research-overview__title')).toHaveText('Přehled výzkumu');
        await page.evaluate(() => window.Strom.UI.setLanguage('de'));
        await expect(page.locator('#research-overview .research-overview__title')).toHaveText('Forschungsübersicht');
        await expect(page.locator('#research-overview .research-overview__filter').first()).toHaveText('Alle 6');
    });

    test('tablet: over the tree, the tree keeps its width', async ({ page }) => {
        await follow(page, { width: 1024, height: 768 });
        const before = await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width);
        await page.locator('#live-panel .live-panel-expand').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--overlay/);
        expect(await page.locator('#tree-container').evaluate(el => el.getBoundingClientRect().width)).toBe(before);
        expect((await ov.boundingBox())!.width).toBe(400);
    });

    test('phone: a strip; a tap opens the sheet; a person closes it', async ({ page }) => {
        await follow(page, { width: 360, height: 780 });
        const panel = page.locator('#live-panel');
        await expect(panel).toHaveClass(/phone-strip/);
        await expect(panel.locator('.live-panel-summary')).toContainText('Working');
        await expect(panel.locator('.live-panel-summary')).toContainText('Waiting for you 2');
        await expect(panel.locator('.live-panel-expand')).toHaveCount(0);
        await panel.locator('.live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        await expect(ov).toHaveAttribute('aria-modal', 'true');
        await expect(ov.locator('.live-waiting-answer')).toHaveCount(0);
        await expect(ov.locator('.research-overview__waiting-card').first()).toContainText('answered in the research on your computer');
        await ov.locator('.research-overview__row .live-person-link', { hasText: 'Karel Víšek' }).first().click();
        await expect(ov).toHaveCount(0);
        await expect(card(page, 'Karel')).toBeVisible();
    });
});

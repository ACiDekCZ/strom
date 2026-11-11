import { test, expect, Page, Route } from '@playwright/test';
import { fakeBridge, openResearch, poll, links, UUID, HEAD, NEW_HEAD, BRIDGE, FakeBridge } from './research-bridge.js';

/**
 * Research hypotheses in "What waits" and in the overview (spec 074, DEV §9,
 * §10): a hypothesis item under Decide with the agent's proposal ("Accept
 * proposal B", "Leave open", "More ›"), two versions with "Choose", or the
 * sentence that merging is decided in the research; the wait in the row.
 * "What the research knows" tags the proposal and a large link; with a
 * research that accepts proposals at once: a box before each hypothesis with
 * a proposal, "Select all with a proposal", "2 selected." with the large
 * link, "Accept proposals (2)" into the research's terminal, the list's wait,
 * then "2 of 2 proposals accepted." and the rows decided. At most 50 at once.
 * Without the research's features nothing of it shows. After "Later" in the
 * Load dialog the card's choices stay switched off until the version loads.
 * Invented people only.
 */

const ALL_FEATURES = ['waiting.groups', 'hypothesis.decide.link', 'hypothesis.links', 'hypotheses.accept.link'];
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'hypothesis', 'hypotheses'];
const T0 = new Date('2026-11-11T09:30:00Z');

interface Hypo { id: string; on: string; title: string; lines: string[] }

/** The research's hypotheses (open unless `decided` names their version). */
function hypotheses(decided: Record<string, string> = {}, many = 0): Hypo[] {
    const state = (id: string, open: string[]): string[] => decided[id]
        ? ['2 STAT decided', '2 _PICK Y', `2 _CHOSEN ${decided[id]}`, '2 _BY app', '2 DECI rozhodnuto v aplikaci Strom', '2 _AT 2026-11-11']
        : ['2 STAT open', ...open];
    const out: Hypo[] = [
        {
            id: 'H0022', on: 'P0003', title: 'Čí syn je Jan Brdlík?', lines: [
                ...state('H0022', ['2 _PICK Y', '2 _PROP B', '3 DECI Oddací záznam jmenuje oba rodiče.', '3 _AT 2026-11-09']),
                '2 _VAR A', '3 TITL Syn Vítězslava Brdlíka', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0001@',
                '2 _VAR B', '3 TITL Syn Zbyhněva Brdlíka', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0004@',
            ],
        },
        {
            id: 'H0031', on: 'P0004', title: 'Byli Zbyhněv Brdlík a Žofína Stružná manželé?', lines: [
                ...state('H0031', ['2 _PICK Y']),
                '2 _VAR A', '3 TITL Ano, manželé', '3 _LINK partners', '4 _PERS @P0004@', '4 _PERS @P0005@',
                '2 _VAR B', '3 TITL Ne, nebyli',
            ],
        },
        {
            id: 'H0040', on: 'P0006', title: 'Je Jan Brdlík a Jan Brdlik jedna osoba?', lines: [
                ...state('H0040', ['2 _PROP A', '3 DECI Stejný den narození.']),
                '2 _VAR A', '3 TITL Jedna osoba', '3 _LINK same', '4 _PERS @P0003@', '4 _PERS @P0006@',
                '2 _VAR B', '3 TITL Dvě osoby',
            ],
        },
        {
            id: 'H0052', on: 'P0001', title: 'Odkud přišla větev Brdlíků z Kvítkovic?', lines: [
                ...state('H0052', ['2 _PICK Y', '2 _PROP A', '3 DECI Děti Zbyhněva Brdlíka.']),
                '2 _VAR A', '3 TITL Od Zbyhněva Brdlíka', '3 _LINK child', '4 _PERS @P0001@', '4 _PAR @P0004@', '3 _PEOPLE 214',
                '2 _VAR B', '3 TITL Od Žofíny Stružné', '3 _LINK child', '4 _PERS @P0001@', '4 _PAR @P0005@',
            ],
        },
    ];
    for (let i = 0; i < many; i++) {
        const id = `H${String(100 + i).padStart(4, '0')}`;
        out.push({
            id, on: 'P0003', title: `Otázka ${i + 1} o Janovi?`, lines: [
                '2 STAT open', '2 _PICK Y', '2 _PROP A',
                '2 _VAR A', '3 TITL Syn Vítězslava', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0001@',
                '2 _VAR B', '3 TITL Syn Zbyhněva', '3 _LINK child', '4 _PERS @P0003@', '4 _PAR @P0004@',
            ],
        });
    }
    return out;
}

function ged(opts: { head?: string; decided?: Record<string, string>; many?: number; birth?: string } = {}): string {
    const hyps = hypotheses(opts.decided, opts.many);
    const on = (refn: string): string[] => hyps.filter(h => h.on === refn).flatMap(h => [`1 _STROM_HYPO ${h.id}`, `2 TITL ${h.title}`, ...h.lines]);
    const person = (refn: string, name: string, sex: string, extra: string[] = []): string[] =>
        [`0 @${refn}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, `1 REFN ${refn}`, '2 TYPE strom-research', ...extra, ...on(refn)];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 11 NOV 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${opts.head ?? HEAD}`, `1 _STROM_LINKS ${LINKS.join(' ')}`, '1 CHAR UTF-8', '1 NOTE Brdlíkovi',
        ...person('P0003', 'Jan /Brdlík/', 'M', opts.birth ? ['1 BIRT', `2 DATE ${opts.birth}`] : []),
        ...person('P0001', 'Vítězslav /Brdlík/', 'M'),
        ...person('P0004', 'Zbyhněv /Brdlík/', 'M'),
        ...person('P0005', 'Žofína /Stružná/', 'F'),
        ...person('P0006', 'Jan /Brdlik/', 'M'),
        '0 TRLR',
    ].join('\n');
}

/** The research's items for the hypotheses (V13): under Decide, their own place. */
function waitingOf(decided: Record<string, string> = {}): unknown[] {
    const item = (id: string, person: string, what: string, extra: Record<string, unknown>) => ({
        id, what, on: 'user', at: '2026-11-10T08:00:00Z', kind: 'hypothesis', section: 'decide',
        group: { key: 'hypotheses', name: 'Hypotheses', kind: 'other' }, person, actions: [], ...extra,
    });
    return [
        item('H0022', 'P0003', 'Čí syn je Jan Brdlík?', { proposal: 'B', pick: true }),
        item('H0031', 'P0004', 'Byli Zbyhněv Brdlík a Žofína Stružná manželé?', { pick: true, priority: -1 }),
        item('H0040', 'P0006', 'Je Jan Brdlík a Jan Brdlik jedna osoba?', { proposal: 'A' }),
        item('H0052', 'P0001', 'Odkud přišla větev Brdlíků z Kvítkovic?', { proposal: 'A', pick: true }),
    ].filter(w => !decided[(w as { id: string }).id]);
}

interface Setup { bridge: FakeBridge; push: () => Promise<void> }

/**
 * The research tree opened and followed live (the research's events quiet
 * until `push`: the stream drops, the app asks the status and loads a new
 * version), the overview open.
 */
async function follow(page: Page, opts: { width?: number; features?: string[]; many?: number } = {}): Promise<Setup> {
    await page.clock.install({ time: T0 });
    await page.setViewportSize({ width: opts.width ?? 1440, height: 900 });
    await page.addInitScript((announced) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
    }, LINKS);
    const text = ged({ many: opts.many });
    const bridge = await fakeBridge(page, { features: opts.features ?? ALL_FEATURES, treeGed: text, links: LINKS, waiting: waitingOf() });
    await openResearch(page, { ged: text });
    await poll(page);
    let pending: Route | null = null;
    await page.route(`${BRIDGE}/events*`, (route) => { pending = route; return new Promise<void>(() => { /* never answers */ }); });
    await page.evaluate(base => window.Strom.UI.startLiveFollow(base, { follow: true }), BRIDGE);
    await expect(page.locator('#live-panel')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(page.locator('#research-overview')).toBeVisible();
    return {
        bridge,
        push: async () => {
            await expect.poll(() => pending !== null).toBe(true);
            const r = pending!;
            pending = null;
            await r.abort();
        },
    };
}

const ov = (page: Page) => page.locator('#research-overview');
const item = (page: Page, id: string) => ov(page).locator(`.hwr-item[data-id="${id}"]`);
const knowsRow = (page: Page, id: string) => ov(page).locator('.research-overview__knows li.rok-item').filter({ has: page.locator(`.hp2-box[data-hypo="${id}"]`) });
const toast = (page: Page) => page.locator('.toast');
const opened = async (page: Page, prefix = 'strom-research://hypothes'): Promise<string[]> => (await links(page)).filter(u => u.startsWith(prefix));

async function unfold(page: Page, title: string): Promise<void> {
    const head = ov(page).locator('.live-section__head').filter({ has: page.locator('.live-section__title', { hasText: title }) });
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
}

/** "Awaiting action" and its place of the hypotheses unfolded (a place of several items starts folded). */
async function unfoldWaiting(page: Page): Promise<void> {
    await unfold(page, 'Awaiting action');
    const group = ov(page).locator('.research-overview__waiting-group[data-group="hypotheses"]').first();
    if (await group.getAttribute('aria-expanded') === 'false') await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
}

async function noOverflow(page: Page): Promise<void> {
    expect(await ov(page).evaluate(el => {
        const body = el.querySelector('.research-overview__body') as HTMLElement | null;
        const all = [el, ...(body ? [body] : []), ...el.querySelectorAll<HTMLElement>('.hwr-item, .hp2-foot, .research-overview__knows li')];
        return all.filter(x => x.scrollWidth > x.clientWidth + 1).map(x => x.className);
    })).toEqual([]);
}

test.describe('Research hypotheses in What waits and the overview', () => {
    test.use({ locale: 'en-US' });

    test('What waits: the proposal with Accept and Leave open, two versions with Choose, merging said; the wait in the row', async ({ page }) => {
        await follow(page);
        await unfoldWaiting(page);
        const h22 = item(page, 'H0022');
        await expect(h22.locator('.hwr-what')).toHaveText('H0022 · Čí syn je Jan Brdlík?');
        await expect(h22.locator('.hwr-proposal')).toHaveText('proposed by the agent: B · Oddací záznam jmenuje oba rodiče.');
        await expect(h22.locator('.hwr-accept')).toContainText('Accept proposal B');
        await expect(h22.locator('.hwr-leave')).toContainText('Leave open');
        await expect(h22.locator('.hwr-more')).toHaveText('More ›');
        // The large link's pill beside the proposal.
        await expect(item(page, 'H0052').locator('.prv-big')).toHaveText('links 214 people');
        // No proposal, two versions: each with Choose.
        const h31 = item(page, 'H0031');
        await expect(h31.locator('.hwr-version')).toHaveCount(2);
        await expect(h31.locator('.hwr-version[data-variant="B"] .hwr-version-title')).toHaveText('Ne, nebyli');
        // B links nobody (K1.6): it alone says the tree stays.
        await expect(h31.locator('.hwr-version[data-variant="B"] .hwr-version-note')).toHaveText('The tree does not change; only the decision is recorded.');
        await expect(h31.locator('.hwr-version[data-variant="A"] .hwr-version-note')).toHaveCount(0);
        await expect(h31.locator('.hwr-keeps')).toHaveCount(0);
        await expect(h31.locator('.hwr-accept')).toHaveCount(0);
        // Merging: only the research decides it.
        const h40 = item(page, 'H0040');
        await expect(h40.locator('.hwr-sentence')).toHaveText('Merging people is decided in the research.');
        await expect(h40.locator('button.secondary')).toHaveCount(0);

        // Accept: the research's terminal, the wait in the row, the buttons off.
        await h22.locator('.hwr-accept').click();
        expect(await opened(page)).toEqual([`strom-research://hypothesis?tree=${UUID}&id=H0022&do=decide&variant=B`]);
        await expect(h22.locator('.prv-wait')).toBeVisible();
        await expect(h22.locator('.prv-wait-title')).toHaveText('Waiting for confirmation in the research');
        await expect(h22.locator('.hwr-accept')).toBeDisabled();
        await expect(h22.locator('.hwr-leave')).toBeDisabled();
        await h22.locator('.prv-wait-again').click();
        expect((await opened(page)).length).toBe(2);
        await h22.locator('.prv-wait-stop').click();
        await expect(h22.locator('.prv-wait')).toHaveCount(0);
        await expect(h22.locator('.hwr-accept')).toBeEnabled();

        // Choose at a version: the wait at it.
        await h31.locator('.hwr-version[data-variant="A"] .hwr-pick').click();
        expect((await opened(page)).at(-1)).toBe(`strom-research://hypothesis?tree=${UUID}&id=H0031&do=decide&variant=A`);
        await expect(h31.locator('.hwr-version[data-variant="A"] .prv-wait')).toBeVisible();
        await expect(h31.locator('.hwr-pick:not([disabled])')).toHaveCount(0);
        // Leave open of another one.
        await item(page, 'H0052').locator('.hwr-leave').click();
        expect((await opened(page)).at(-1)).toBe(`strom-research://hypothesis?tree=${UUID}&id=H0052&do=keep-open`);

        // More: the hypothesis's card at its person.
        await h22.locator('.hwr-more').click();
        await expect(page.locator('#person-research-modal .person-research-hypo[data-hypo="H0022"]')).toBeVisible();
    });

    test('the overview accepts proposals at once: select all, the large link, the list\'s wait, then how many were accepted', async ({ page }) => {
        const { bridge, push } = await follow(page);
        await unfold(page, 'What the research knows');
        // A box for each hypothesis with a proposal decided here; merging only in the research; none without a proposal.
        await expect(knowsRow(page, 'H0022').locator('.rok-tag')).toHaveText('proposed by the agent: B');
        await expect(knowsRow(page, 'H0052').locator('.prv-big')).toHaveText('links 214 people');
        await expect(ov(page).locator('.hp2-box[data-hypo="H0040"]')).toBeDisabled();
        await expect(knowsRow(page, 'H0040').locator('.hp2-note')).toHaveText('Only the research decides this one.');
        await expect(ov(page).locator('.hp2-box[data-hypo="H0031"]')).toHaveCount(0);
        await expect(ov(page).locator('.research-overview__knows li.rok-item').filter({ hasText: 'Byli Zbyhněv' }).locator('.hp2-note')).toHaveText('no proposal');
        await expect(ov(page).locator('.hp2-foot')).toHaveCount(0);

        // One by hand, then all with a proposal.
        await ov(page).locator('.hp2-box[data-hypo="H0022"]').first().check();
        await expect(ov(page).locator('.hp2-box[data-hypo="H0022"]').first()).toBeFocused();
        await expect(ov(page).locator('.research-overview__knows ~ .hp2-foot .hp2-sum')).toHaveText('1 selected.');
        await ov(page).locator('.hp2-all').first().click();
        const foot = ov(page).locator('.research-overview__knows ~ .hp2-foot');
        await expect(foot.locator('.hp2-sum')).toHaveText('2 selected. Large link: H0052 → A links 214 people.');
        await expect(foot.locator('.hp2-accept')).toContainText('Accept proposals (2)');
        await expect(foot.locator('.hp2-accept')).toBeFocused();
        // A redraw of the overview (a status of the research followed live) keeps that focus.
        await page.evaluate(() => window.Strom.UI.renderResearchOverview());
        await expect(foot.locator('.hp2-accept')).toBeFocused();
        // The same choice in What waits.
        await unfoldWaiting(page);
        await expect(item(page, 'H0052').locator('.hp2-box')).toBeChecked();
        // Merging: its box switched off, the row's one sentence says where it is decided.
        await expect(item(page, 'H0040').locator('.hp2-box')).toBeDisabled();
        await expect(item(page, 'H0040').locator('.hwr-sentence')).toHaveText('Merging people is decided in the research.');
        await expect(item(page, 'H0040').locator('.hp2-note')).toHaveCount(0);
        await noOverflow(page);

        await foot.locator('.hp2-accept').click();
        expect(await opened(page, 'strom-research://hypotheses')).toEqual([`strom-research://hypotheses?tree=${UUID}&do=accept&ids=H0022,H0052`]);
        const wait = ov(page).locator('.hp2-wait').first();
        await expect(wait.locator('.prv-wait-title')).toHaveText('Waiting for confirmation in the research · 2 hypotheses');
        await expect(ov(page).locator('.hp2-box[data-hypo="H0022"]').first()).toBeDisabled();
        await expect(ov(page).locator('.hp2-foot')).toHaveCount(0);
        await expect(item(page, 'H0022').locator('.prv-wait')).toBeVisible();

        // The research confirms both in its terminal: one version with both decisions.
        bridge.head = NEW_HEAD;
        bridge.treeGed = ged({ head: NEW_HEAD, decided: { H0022: 'B', H0052: 'A' } });
        bridge.waiting = waitingOf({ H0022: 'B', H0052: 'A' });
        await push();
        await expect(toast(page).filter({ hasText: '2 of 2 proposals accepted.' })).toBeVisible();
        await expect(toast(page).filter({ hasText: 'Hypothesis H0022 decided' })).toHaveCount(0);
        await expect(ov(page).locator('.hp2-wait')).toHaveCount(0);
        await expect(knowsRow(page, 'H0022')).toHaveCount(0);
        const decided = ov(page).locator('.research-overview__knows li').filter({ hasText: 'Čí syn je Jan' });
        await expect(decided.locator('.rok-tag--done')).toHaveText('decided: B');
        await expect(item(page, 'H0022')).toHaveCount(0);
    });

    test('at most 50 at once: select all stops at 50, the rest switched off, said in the foot', async ({ page }) => {
        await follow(page, { many: 52 });
        await unfold(page, 'What the research knows');
        await ov(page).locator('.hp2-all').first().click();
        const knows = ov(page).locator('.research-overview__knows');
        await expect(knows.locator('.hp2-box:checked')).toHaveCount(50);
        await expect(ov(page).locator('.research-overview__knows ~ .hp2-foot .hp2-sum')).toContainText('50 selected.');
        await expect(ov(page).locator('.research-overview__knows ~ .hp2-foot .hp2-sum')).toContainText('At most 50 at once.');
        const free = knows.locator('.hp2-box:not(:checked):not(.hp2-box--only)');
        expect(await free.count()).toBeGreaterThan(0);
        await expect(free.first()).toBeDisabled();
        await expect(free.first()).toHaveAttribute('title', 'At most 50 at once.');
        await expect(ov(page).locator('.hp2-all')).toHaveCount(0);
        // One dropped: the others can be picked again.
        await knows.locator('.hp2-box[data-hypo="H0022"]').uncheck();
        await expect(free.first()).toBeEnabled();
    });

    test('without accepting at once: no boxes; without deciding in the app: the overview\'s rows as today', async ({ page }) => {
        await follow(page, { features: ['waiting.groups', 'hypothesis.decide.link', 'hypothesis.links'] });
        await unfold(page, 'What the research knows');
        await expect(ov(page).locator('.hp2-box, .hp2-all, .hp2-foot')).toHaveCount(0);
        await unfoldWaiting(page);
        await expect(item(page, 'H0022').locator('.hwr-accept')).toBeVisible();
    });

    test('a research that does not decide in the app: the rows of What the research knows stay as they were', async ({ page }) => {
        await follow(page, { features: ['waiting.groups'] });
        await unfold(page, 'What the research knows');
        await expect(ov(page).locator('.hp2-box, .rok-tags, .rok-tag')).toHaveCount(0);
        await expect(ov(page).locator('.research-overview__knows-row').filter({ hasText: 'Čí syn je Jan' }))
            .toHaveText('Jan Brdlík · Hypothesis: Čí syn je Jan Brdlík? ›');
    });

    test('a phone-wide window: the rows fit, the actions take the row\'s width', async ({ page }) => {
        await follow(page, { width: 390 });
        await unfoldWaiting(page);
        const h22 = item(page, 'H0022');
        await expect(h22.locator('.hwr-accept')).toBeVisible();
        const [a, row] = [await h22.locator('.hwr-accept').boundingBox(), await h22.boundingBox()];
        expect(a && row).toBeTruthy();
        expect(a!.width).toBeGreaterThan(row!.width / 3);
        await noOverflow(page);
        await unfold(page, 'What the research knows');
        await noOverflow(page);
    });

    test('the small panel: a hypothesis with its id and More, which opens its card', async ({ page }) => {
        await follow(page);
        await page.evaluate(() => window.Strom.UI.closeResearchOverview());
        const row = page.locator('#live-panel .live-waiting-row').filter({ hasText: 'H0022' });
        await expect(row.locator('.hwr-id')).toHaveText('H0022');
        await expect(row.locator('.live-waiting-answer')).toHaveCount(0);
        await row.locator('.hwr-more').click();
        await expect(page.locator('#person-research-modal .person-research-hypo[data-hypo="H0022"]')).toBeVisible();
    });
});

test.describe('A decision of the research not loaded yet', () => {
    test.use({ locale: 'en-US' });

    test('after Later in the Load dialog the card\'s Choose and choices stay switched off until the version loads', async ({ page }) => {
        await page.clock.install({ time: T0 });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.addInitScript((announced) => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            localStorage.setItem('strom-research-links', JSON.stringify({ actions: announced, at: new Date().toISOString() }));
        }, LINKS);
        const b = await fakeBridge(page, { features: ['hypothesis.decide.link', 'hypothesis.links'], treeGed: ged(), links: LINKS });
        await openResearch(page, { ged: ged() });
        await poll(page);
        const id = await page.evaluate(() => window.Strom.DataManager.getAllPersons().find((p: { refn?: string }) => p.refn === 'P0004')!.id);
        await page.evaluate((id) => window.Strom.UI.runPersonMenuAction(id, 'research-knows'), id);
        const card = page.locator('#person-research-modal .person-research-hypo[data-hypo="H0031"]');
        await expect(card).toBeVisible();
        await card.locator('.person-research-variant[data-variant="A"] .prv-pick').click();
        // Decided in the research with another change: the Load dialog; Later.
        b.head = NEW_HEAD;
        b.treeGed = ged({ head: NEW_HEAD, decided: { H0031: 'A' }, birth: '3 MAR 1862' });
        await page.evaluate(() => { void window.Strom.UI.pollResearchBridge(); });
        const dialog = page.locator('#research-load-modal');
        await expect(dialog).toBeVisible();
        await dialog.locator('#research-load-cancel').click();
        await expect(dialog).toHaveCount(0);
        await expect(card.locator('.prh-decided-note')).toContainText('Already decided in the research: A (decided in the app)');
        await expect(card.locator('.prv-wait')).toHaveCount(0);
        await expect(card.locator('.prv-pick')).toHaveCount(2);
        await expect(card.locator('.prv-pick:not([disabled])')).toHaveCount(0);
        await expect(card.locator('.prh-act:not([disabled])')).toHaveCount(0);
        await expect(card.locator('.prh-more-link')).toHaveCount(0);
        // Load: the decision comes, the line goes.
        await card.locator('.prh-decided-load').click();
        await expect(page.locator('#research-load-modal')).toBeVisible();
    });
});

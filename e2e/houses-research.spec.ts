import { createHash } from 'node:crypto';
import { test, expect, Page, Route } from '@playwright/test';
import { fakeBridge, fakeMaterial, links, materialFile, openResearch, poll, BRIDGE, FakeBridge, FakeMaterial, MATERIAL_FEATURES } from './research-bridge.js';

/**
 * The research's houses in the Houses window (spec 030 §2 K7.5, §7): the state of a house the research lists in
 * its row, in the open row's detail and summed up at its town in Places; refreshed when `/status.houses.rev`
 * changes; a waiting question's "Answer" opens it as an item of "Awaiting action". Without `house` in
 * `/status.features` nothing of the research is drawn. A fake bridge with invented data: the Fíšek family of
 * Bělokamen čp. 16.
 */

const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const HOUSE = ['house', 'house.material', 'house.import'];
const KEY = 'belokamen|16';

interface FakeHouses {
    rev: string;
    rows: Record<string, unknown>[];
    lists: number;
    reads: string[];
    posts: unknown[];
    materials?: Record<string, unknown>[];
    /** Overrides of the house's research (`GET /houses/<key>`), e.g. its timeline and sensitive events. */
    research?: Record<string, unknown>;
    materialReply?: { status: number; contentType: string; body: string };
}

const fakeHouses = (rows: Record<string, unknown>[] = [row()], init: Partial<FakeHouses> = {}): FakeHouses =>
    ({ rev: 'r1', rows, lists: 0, reads: [], posts: [], ...init });

const BATCH_ACCEPTS = {
    sync: { auto: 'off' }, sources: true, verified: true,
    media: { max: 500 * 1024 * 1024, region: true, batch: { files: 5000, bytes: 20 * 1024 * 1024 * 1024, zip: true } },
};

function row(init: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'A0001', key: KEY, place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16',
        persons: 2, years: { from: 1820, to: 1850 }, state: 'running', task: 'T0040', work: 'house',
        summary: { events: 0, holders: 0, residents: 0, unknown: 0, materials: 0, passed: 0 }, ...init,
    };
}

async function setup(page: Page, opts: { features?: string[]; houses?: FakeHouses; media?: boolean; material?: FakeMaterial } = {}): Promise<{ bridge: FakeBridge; houses: FakeHouses }> {
    await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
    const houses = opts.houses ?? fakeHouses();
    const bridge = await fakeBridge(page, {
        features: opts.features ?? HOUSE, links: LINKS,
        statusExtra: { houses: { on: true, rev: houses.rev, counts: { done: 0, running: 1, queued: 0, waiting: 0, held: 0 } } },
        waiting: [{ id: 'T0042', what: 'Which house is čp. 16 after the renumbering?', on: 'user', at: '2027-03-19T09:00:00Z' }],
        ...(opts.media ? { accepts: BATCH_ACCEPTS } : {}), ...(opts.material ? { material: opts.material } : {}),
    });
    await page.route(u => `${u.origin}${u.pathname}` === `${BRIDGE}/houses`, async (route: Route) => {
        houses.lists++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: houses.rev, houses: houses.rows }) });
    });
    await page.route(u => `${u.origin}${u.pathname}`.startsWith(`${BRIDGE}/houses/`), async (route: Route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/houses\//, ''));
        if (route.request().method() === 'POST' && path === 'material') {
            houses.posts.push(JSON.parse(route.request().postData() ?? 'null'));
            await route.fulfill(houses.materialReply ?? { status: 200, contentType: 'application/json',
                body: JSON.stringify({ house: null, materials: [{ id: 'I0009' }], head: 'a1b2c3d4e5f6', parent: '9b8c7d6e5f40' }) });
            return;
        }
        houses.reads.push(path);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...row(), ...houses.rows[0], numbers: [], timeline: [], holders: [],
            residents: [], maps: [], passed: [], manual: [], unknown: [], archiveOnly: [], sensitive: [], same: [], persons: [], materials: houses.materials ?? [],
            ...houses.research }) });
    });
    await openResearch(page, { media: !!opts.media });
    // Josef and his son Jan born in Bělokamen čp. 16: a house of two generations.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        for (const p of Object.values(dm.getData().persons) as { id: string; firstName: string }[]) {
            if (p.firstName === 'Josef') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820' } as never);
            if (p.firstName === 'Jan') dm.updatePerson(p.id as never, { birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850' } as never);
        }
    });
    await poll(page);
    return { bridge, houses };
}

/** A new state of the research's houses: a new rev in `/status.houses`, then a poll. */
async function changeHouses(page: Page, bridge: FakeBridge, houses: FakeHouses, rows: Record<string, unknown>[], rev: string): Promise<void> {
    houses.rows = rows;
    houses.rev = rev;
    (bridge.statusExtra!.houses as { rev: string }).rev = rev;
    await poll(page);
}

async function openHouses(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showHousesWindow());
    await expect(page.locator('#houses-modal')).toBeVisible();
}

const houseRow = (page: Page) => page.locator(`#houses-modal .house-row[data-house="${KEY}"]`);
const side = (page: Page) => houseRow(page).locator('.house-side');

test.describe('Houses: the research\'s state', () => {
    test('the row shows the state; a new rev redraws it; waiting → "Answer" opens the question in the overview', { tag: '@smoke' }, async ({ page }) => {
        const { bridge, houses } = await setup(page);
        await openHouses(page);
        await expect(side(page).locator('.hs[data-state="running"]')).toHaveText('being researched');
        await expect(side(page).locator('.hs-pulse')).toHaveCount(1);
        // The same rev again: the list is not read again.
        const lists = houses.lists;
        await poll(page);
        expect(houses.lists).toBe(lists);

        await changeHouses(page, bridge, houses, [row({ state: 'done', at: '2027-03-12' })], 'r2');
        // Researched: a tag with ✓ (aria-hidden) and its day (Milan 27 Nov 2026).
        await expect(side(page).locator('.hs.is-done[data-state="done"]')).toHaveText('✓done 12 Mar 2027');

        await changeHouses(page, bridge, houses, [row({ state: 'queued', work: 'takeover' })], 'r3');
        await expect(side(page).locator('.hs[data-state="takeover"]')).toHaveText('own research waiting to be taken over');
        await expect(side(page).locator('.hs-note')).toHaveText('the agent takes it over in its next session');

        await changeHouses(page, bridge, houses, [row({ state: 'waiting', question: { id: 'T0042', text: 'Which house is čp. 16 after the renumbering?' } })], 'r4');
        await expect(side(page).locator('.hs.is-wait')).toHaveText('waiting for an answer');
        const answer = side(page).locator('button.house-answer');
        await expect(answer).toHaveText('Answer');
        // Through the app, no terminal: no mark.
        await expect(side(page).locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        // The open row's detail says the same.
        await houseRow(page).locator('.house-chev').click();
        await expect(page.locator('#houses-modal .house-detail .house-research .hs.is-wait')).toHaveText('waiting for an answer');
        await answer.click();
        await expect(page.locator('#houses-modal')).toHaveCount(0);
        await expect(page.locator('#research-overview')).toBeVisible();
        await expect(page.locator('#research-overview .research-overview__waiting-item[data-id="T0042"]')).toBeVisible();
    });

    test('a narrow window: a long state wraps in its badge; the number stays on one line and ⋯ at the row\'s right', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await setup(page, { houses: fakeHouses([row({ state: 'queued', work: 'takeover' })]) });
        await openHouses(page);
        await expect(side(page).locator('.hs[data-state="takeover"]')).toBeVisible();
        const no = (await houseRow(page).locator('.house-no b').boundingBox())!;
        expect(no.height).toBeLessThan(26);
        const more = (await houseRow(page).locator('.house-more-btn').boundingBox())!;
        const r = (await houseRow(page).boundingBox())!;
        expect(Math.abs(more.x + more.width - (r.x + r.width))).toBeLessThan(2);
    });

    test('a house the research does not list shows nothing; "none" shows "not researched"', async ({ page }) => {
        const { bridge, houses } = await setup(page, { houses: fakeHouses([]) });
        await openHouses(page);
        await expect(houseRow(page)).toBeVisible();
        await expect(houseRow(page).locator('.house-side')).toHaveCount(0);
        // A material only, not researched yet.
        await changeHouses(page, bridge, houses, [row({ state: 'none', task: undefined, work: undefined })], 'r2');
        await expect(side(page).locator('.hs.is-text[data-state="none"]')).toHaveText('not researched');
    });

    test('Places: the town\'s houses per state beside "Houses in this town ›"', async ({ page }) => {
        const { bridge, houses } = await setup(page);
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        const line = page.locator('#places-modal .place-town-house-states[data-town="belokamen"]');
        await expect(line).toHaveText('1 being researched');
        await changeHouses(page, bridge, houses, [row({ state: 'done', at: '2027-03-12' })], 'r2');
        await expect(line).toHaveText('1 done');
    });

    test('without the feature house: no state, no column, no request for the list', async ({ page }) => {
        const { houses } = await setup(page, { features: ['census'] });
        await openHouses(page);
        await expect(houseRow(page)).toBeVisible();
        await expect(page.locator('#houses-modal .house-side, #houses-modal .hs')).toHaveCount(0);
        await houseRow(page).locator('.house-chev').click();
        await expect(page.locator('#houses-modal .house-research')).toHaveCount(0);
        expect(houses.lists).toBe(0);
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        await expect(page.locator('#places-modal .place-town-houses[data-town="Bělokamen"]')).toBeVisible();
        await expect(page.locator('#places-modal .place-town-house-states')).toHaveCount(0);
    });
});

const material = (page: Page) => page.locator('#house-material-modal');

async function openAttach(page: Page): Promise<void> {
    await houseRow(page).locator('.house-more-btn').click();
    await page.getByRole('menuitem', { name: 'Attach material…' }).click();
    await expect(material(page).locator('h2')).toHaveText('Attach material to the house');
}

test.describe('Houses: material of a house', () => {
    test('⋯ "Attach material…": a memory without the witness\'s consent goes as family memory, no mark; then with it', async ({ page }) => {
        const { houses } = await setup(page);
        await openHouses(page);
        await openAttach(page);
        await expect(material(page).locator('.house-sub-sub')).toHaveText('Bělokamen čp. 16');
        // The consent: its hint stands beside the box, under its label (not under the box).
        const box = (await material(page).locator('.house-witness-consent').boundingBox())!;
        const hint = (await material(page).locator('.house-consent .sub').boundingBox())!;
        expect(hint.x).toBeGreaterThan(box.x + box.width);
        await expect(material(page).locator('.research-open-mark, .research-ai-badge')).toHaveCount(0);
        const go = material(page).getByRole('button', { name: 'Attach', exact: true });
        await expect(go).toBeDisabled();
        await material(page).locator('.house-memory').fill('U Prouzalů se říkalo podle starého hospodáře.');
        await material(page).locator('.house-witness').fill('Libuše Kvitelková');
        await expect(material(page).locator('.house-consent')).toContainText('unticked, the source is “family memory” without a name');
        await go.click();
        await expect(material(page)).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: 'Attached to the house.' })).toBeVisible();
        expect(houses.posts).toEqual([{ house: KEY, memory: { text: 'U Prouzalů se říkalo podle starého hospodáře.', witnessConsent: false } }]);

        await openAttach(page);
        await material(page).locator('.house-memory').fill('Studna za stodolou.');
        await material(page).locator('.house-witness').fill('Libuše Kvitelková');
        await material(page).locator('.house-witness-consent').check();
        await material(page).locator('.house-farm-name').fill('U Prouzalů');
        await material(page).getByRole('button', { name: 'Attach', exact: true }).click();
        await expect(material(page)).toHaveCount(0);
        expect(houses.posts[1]).toEqual({ house: KEY, memory: { text: 'Studna za stodolou.', witness: 'Libuše Kvitelková', witnessConsent: true }, name: 'U Prouzalů' });
    });

    test('a town without a place in the research: the sentence in the dialog, which stays open', async ({ page }) => {
        const houses = fakeHouses([row()], { materialReply: { status: 400, contentType: 'application/json',
            body: JSON.stringify({ error: 'the town has no place', code: 'house.body', reasonCode: 'house.town' }) } });
        await setup(page, { houses });
        await openHouses(page);
        await openAttach(page);
        await material(page).locator('.house-memory').fill('Podle hospodáře.');
        await material(page).getByRole('button', { name: 'Attach', exact: true }).click();
        await expect(material(page).locator('.house-material-err')).toHaveText('The research has no record of this town yet; material can be attached once the town is among its places.');
        await expect(material(page).getByRole('button', { name: 'Attach', exact: true })).toBeEnabled();
    });

    test('the open row: its materials, "Attach material…" and "Take over research from a file…" with the terminal mark (do=import)', async ({ page }) => {
        const houses = fakeHouses([row({ state: 'done', at: '2027-03-12', summary: { events: 2, holders: 1, residents: 0, unknown: 0, materials: 2, passed: 0 } })], {
            materials: [
                { id: 'I0003', kind: 'own-research', title: 'reserse-cp16.md', at: '2027-03-01', file: 'reserse-cp16.md' },
                { id: 'I0004', kind: 'memory', title: 'U Prouzalů se říkalo podle hospodáře', at: '2027-03-02' },
            ],
        });
        await setup(page, { houses });
        await openHouses(page);
        await houseRow(page).locator('.house-chev').click();
        const detail = page.locator('#houses-modal .house-detail .house-research');
        await expect(detail.locator('.house-mat')).toHaveCount(2);
        expect(houses.reads).toEqual([KEY]);
        await expect(detail.locator('.house-mat').nth(0)).toContainText('Own research · 1 Mar 2027');
        await expect(detail.locator('.house-mat').nth(1)).toContainText('family memory · witness not named');
        const imp = detail.locator('button.house-import');
        await expect(imp).toContainText('Take over research from a file…');
        await expect(imp.locator('.research-open-mark')).toHaveCount(1);
        await expect(detail.locator('.house-research-note')).toHaveText('The text is saved unchanged as house material, and the agent turns it into the house history without a new search.');
        await expect(detail.locator('button.house-attach .research-open-mark')).toHaveCount(0);
        await imp.click();
        await expect.poll(() => links(page)).toContainEqual(expect.stringMatching(/[?&]do=import\b/));
        await detail.locator('button.house-attach').click();
        await expect(material(page)).toBeVisible();
    });

    test('without house.material and house.import: no attach, no take-over', async ({ page }) => {
        await setup(page, { features: ['house'] });
        await openHouses(page);
        await houseRow(page).locator('.house-chev').click();
        await expect(page.locator('#houses-modal .house-attach, #houses-modal .house-import')).toHaveCount(0);
        await houseRow(page).locator('.house-more-btn').click();
        await expect(page.getByRole('menuitem', { name: 'Attach material…' })).toHaveCount(0);
    });

    test('files go the usual way: a batch of the house (batch/<id>/done with house)', async ({ page }) => {
        const { bridge } = await setup(page, { media: true });
        await openHouses(page);
        await openAttach(page);
        await material(page).locator('.house-files-input').setInputFiles([
            { name: 'dum-1930.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('obrazek domu') },
        ]);
        await expect(material(page).locator('.house-file')).toHaveCount(1);
        await expect(material(page).locator('.house-file .n')).toHaveText('dum-1930.jpg');
        await expect(material(page).locator('.house-files-note')).toHaveText('1 file goes to the research as a house batch.');
        // With files the button says it goes on (the batch's wizard); without them again "Attach" (question 10).
        await expect(material(page).getByRole('button', { name: 'Attach', exact: true })).toHaveCount(0);
        await material(page).locator('.house-file-x').click();
        await expect(material(page).getByRole('button', { name: 'Attach', exact: true })).toBeVisible();
        await material(page).locator('.house-files-input').setInputFiles([
            { name: 'dum-1930.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('obrazek domu') },
        ]);
        await material(page).getByRole('button', { name: 'Attach and continue…', exact: true }).click();
        const dialog = page.locator('#batch-modal');
        await expect(dialog.locator('.batch-step.is-active')).toHaveText('Review');
        await dialog.locator('[data-act="next"]').click();
        await dialog.getByRole('button', { name: /^Send/ }).click();
        await expect.poll(() => bridge.batchDone?.length ?? 0).toBe(1);
        expect(bridge.batchDone![0].body).toMatchObject({ house: KEY });
    });

    test('a file the research has already: attached to the house on its own, the end names it and opens Materials on it (1128)', async ({ page }) => {
        const buffer = Buffer.from('obrazek domu');
        const sha = createHash('sha256').update(buffer).digest('hex');
        const archive = fakeMaterial({ files: [materialFile(126, { title: 'Stavení v roce 1930' }), materialFile(1, { title: 'Jiný snímek' })], batches: [], people: {} });
        const { bridge, houses } = await setup(page, { media: true, material: archive, features: [...HOUSE, 'media.known', ...MATERIAL_FEATURES] });
        bridge.mediaKnown.set(sha, 'I0126');
        await openHouses(page);
        await openAttach(page);
        await material(page).locator('.house-files-input').setInputFiles([{ name: 'dum-1930.jpg', mimeType: 'image/jpeg', buffer }]);
        await material(page).getByRole('button', { name: 'Attach and continue…', exact: true }).click();
        const dialog = page.locator('#batch-modal');
        await dialog.locator('[data-act="next"]').click();
        await dialog.getByRole('button', { name: /^Send/ }).click();
        // Never part of the batch, so the house gets it on its own.
        await expect.poll(() => houses.posts).toEqual([{ house: KEY, files: ['I0126'] }]);
        await expect(dialog.locator('.batch-confirm-title')).toHaveText('✓ Already in Materials');
        await expect(dialog.locator('.batch-had-one')).toHaveText('This file is in Materials already: “Stavení v roce 1930”.');
        await expect(dialog.locator('p.batch-had-house')).toHaveText('Attached to the house Bělokamen čp. 16.');
        await expect(dialog).not.toContainText('Received');
        await dialog.getByRole('button', { name: 'Open in Materials', exact: true }).click();
        const win = page.locator('#materials-modal');
        await expect(win).toBeVisible();
        await expect(win.locator('.mw-tile', { hasText: 'Stavení v roce 1930' })).toBeVisible();
        await expect(win.locator('.mw-tile', { hasText: 'Jiný snímek' })).toHaveCount(0);
        await expect(win.locator('.mw-chip.is-active', { hasText: 'Files: 1' })).toBeVisible();
    });
});

test.describe('Houses: protection in outputs', () => {
    test('a sensitive event of the research: hidden in outputs, Show / Hide in outputs, undo reverts', async ({ page }) => {
        const houses = fakeHouses([row({ state: 'done', at: '2027-03-12', summary: { events: 2, holders: 0, residents: 0, unknown: 0, materials: 0, passed: 0 } })], {
            research: {
                timeline: [
                    { id: 'e1', kind: 'built', date: '1830', text: 'Stavení postaveno', sources: [] },
                    { id: 'e9', kind: 'other', date: '1948', text: 'Konfiskace statku', sources: [] },
                ],
                sensitive: ['e9'],
            },
        });
        await setup(page, { houses });
        await openHouses(page);
        await houseRow(page).locator('.house-chev').click();
        const sens = page.locator('#houses-modal .house-detail .house-sensitive');
        const ev = sens.locator('.house-sens[data-event="e9"]');
        await expect(sens.locator('.house-sens')).toHaveCount(1);
        await expect(ev.locator('.t')).toHaveText('1948 · Konfiskace statkuhidden in outputs');
        await expect(sens.locator('.house-hidden-summary')).toContainText('In outputs (HTML, book)');
        await ev.getByRole('button', { name: 'Show in outputs' }).click();
        await expect(ev.locator('.s')).toHaveCount(0);
        await expect(ev.getByRole('button', { name: 'Hide in outputs' })).toBeFocused();
        expect(await page.evaluate(k => window.Strom.DataManager.getData().houses?.[k]?.revealInOutputs, KEY)).toEqual(['e9']);
        await page.evaluate(() => window.Strom.UI.performUndo());
        await expect(ev.getByRole('button', { name: 'Show in outputs' })).toBeVisible();
        expect(await page.evaluate(k => window.Strom.DataManager.getData().houses?.[k]?.revealInOutputs ?? null, KEY)).toBeNull();
        await ev.getByRole('button', { name: 'Show in outputs' }).click();
        await ev.getByRole('button', { name: 'Hide in outputs' }).click();
        await expect(ev.locator('.s')).toHaveText('hidden in outputs');
    });

    test('without sensitive events from the research: nothing about outputs', async ({ page }) => {
        const houses = fakeHouses([row({ state: 'done', summary: { events: 1, holders: 0, residents: 0, unknown: 0, materials: 0, passed: 0 } })], {
            research: { timeline: [{ id: 'e1', kind: 'built', date: '1830', text: 'Stavení postaveno', sources: [] }] },
        });
        await setup(page, { houses });
        await openHouses(page);
        await houseRow(page).locator('.house-chev').click();
        await expect.poll(() => houses.reads).toEqual([KEY]);
        await expect(page.locator('#houses-modal .house-sensitive, #houses-modal .house-reveal')).toHaveCount(0);
    });
});

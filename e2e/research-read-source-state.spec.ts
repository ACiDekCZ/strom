import { test, expect, Page } from '@playwright/test';
import { fakeBridge, fakeRead, readAccepts, openResearch, poll, researchGed, FakeBridge, READ_ID } from './research-bridge.js';

/**
 * A source's state after a newer reading (spec 059 §2), the agent's proposal
 * for a confirmed transcript (§3) and the research's setting "Task from a new
 * reading" (§4). The research says them in `/status.readAgain` and
 * `accepts.read.sourceTask` with `read.sourceTask` in `features`; without it
 * the viewer and the settings stay as before. A fake bridge; invented sources.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const FEATURES = ['read.now', 'read.source', 'read.sourceTask'];

const file = (): string => researchGed().replace('1 _STROM_READ research', '1 _STROM_READ research\n1 _STROM_ORIG Y');

async function setup(page: Page, opts: { features?: string[]; readAgain?: Record<string, unknown>; sourceTask?: string } = {}): Promise<FakeBridge> {
    const ged = file();
    const b = await fakeBridge(page, {
        treeGed: ged,
        accepts: {
            sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true },
            read: readAccepts(opts.sourceTask ? { sourceTask: opts.sourceTask } : {}),
        },
        features: opts.features ?? FEATURES,
        links: ['send', 'open', 'live', 'app', 'setup', 'task'],
        read: fakeRead(),
        ...(opts.readAgain ? { statusExtra: { readAgain: opts.readAgain } } : {}),
    });
    await openResearch(page, { ged, media: true });
    await poll(page);
    return b;
}

async function view(page: Page): Promise<void> {
    await page.evaluate(() => {
        const id = (Object.values(window.Strom.DataManager.getData().sources).find((s: any) => s.refn === 'S0001') as any).id;
        window.Strom.UI.showSourceViewer(id, null);
    });
    await expect(page.locator('#source-viewer-modal')).toBeVisible();
}

/** A finished reading of S0001 again: one sure change against the transcript. */
function result(): Record<string, unknown> {
    return {
        id: READ_ID, state: 'done', lang: 'en',
        doc: { kind: 'register.marriage', language: ['cs'], script: 'latin', date: '1888', legible: 'yes', why: null },
        readers: { asked: 1, ran: 1, agree: 'same', who: [] },
        pages: [{ n: 1, file: 'M0001', name: 'S0001', page: 1, w: 600, h: 800, image: `read/${READ_ID}/page/1.jpg` }],
        entries: [{ id: 'e1', page: 1, transcript: 'Josef Fíšek a Anně', variants: [], persons: [], events: [], relations: [] }],
        context: '', version: 1,
        source: { id: 'S0001', agree: 'differ', task: '', taskSetting: 'ask', taskOffer: true, variants: [{ at: 'Anna', other: 'Anně', sure: true }] },
    };
}

const row = (page: Page) => page.locator('#source-viewer-read-state');
const links = (page: Page) => page.evaluate(() => (window.Strom.UI as unknown as { __links?: string[] }).__links ?? []);

async function openTreeSettings(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
    await expect(page.locator('#research-tree-settings-modal')).toBeVisible();
}

test.describe('A source after a newer reading', () => {
    test.use({ viewport: DESKTOP });

    test('without read.sourceTask the research\'s word is not read: the viewer and the settings as before', async ({ page }) => {
        await setup(page, { features: ['read.now', 'read.source'], readAgain: { S0001: { read: READ_ID, state: 'unchecked' } } });
        await view(page);
        await expect(page.locator('#source-viewer-read-again')).toBeVisible();
        await expect(row(page)).toHaveCount(0);
        await expect(page.locator('#source-viewer-proposal')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeSourceViewer());
        await openTreeSettings(page);
        await expect(page.locator('#research-readtask-group')).toHaveCount(0);
    });

    test('unchecked: the sentence with its count, "Decide" offers the three choices with their marks; queued, then the task opens', async ({ page }) => {
        const b = await setup(page, { readAgain: { S0001: { read: READ_ID, state: 'unchecked' } } });
        b.read!.results.set(READ_ID, result());
        await view(page);
        await expect(row(page)).toHaveAttribute('data-state', 'unchecked');
        await expect(row(page).locator('.viewer-read-state-text')).toHaveText('Newer reading of 19 Oct differs (1 substantive change), not checked.');
        await expect(row(page).locator('[data-read-again-open]')).toBeVisible();
        const toggle = row(page).locator('[data-read-state="toggle"]');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        const opts = page.locator('#source-viewer-read-state-opts');
        await expect(opts.locator('[data-read-how]')).toHaveCount(3);
        const now = opts.locator('[data-read-how="now"]');
        const queue = opts.locator('[data-read-how="queue"]');
        const save = opts.locator('[data-read-how="save"]');
        await expect(now.locator('.research-ai-badge')).toHaveCount(1);
        await expect(now.locator('.research-open-mark')).toHaveCount(1);
        await expect(queue.locator('.research-ai-badge')).toHaveCount(1);
        await expect(queue.locator('.research-open-mark')).toHaveCount(0);
        await expect(save.locator('.research-ai-badge, .research-open-mark')).toHaveCount(0);
        await queue.click();
        await expect(row(page)).toHaveAttribute('data-state', 'queued');
        await expect(row(page).locator('.viewer-read-state-text')).toHaveText('Newer reading of 19 Oct: task T0043 for the agent (queued).');
        expect(b.read!.taskPosts!.map(p => [p.source, p.read, p.body])).toEqual([['S0001', READ_ID, { how: 'queue' }]]);
        expect(await links(page)).toEqual([]);
        const open = row(page).locator('[data-read-state="task"]');
        await expect(open.locator('.research-open-mark')).toHaveCount(1);
        await open.click();
        await expect.poll(() => links(page)).toEqual([expect.stringContaining('task=T0043')]);
    });

    test('unchecked: "Check now" creates the task and opens the conversation in the terminal; a failure is said', async ({ page }) => {
        const b = await setup(page, { readAgain: { S0001: { read: READ_ID, state: 'unchecked' } } });
        await view(page);
        // The counts unknown (no result): the sentence without them.
        await expect(row(page).locator('.viewer-read-state-text')).toHaveText('Newer reading of 19 Oct differs, not checked.');
        await row(page).locator('[data-read-state="toggle"]').click();
        b.read!.taskReply = { status: 500, body: { code: 'oops' } };
        await page.locator('[data-read-how="now"]').click();
        await expect(page.locator('.viewer-read-state-fail')).toBeVisible();
        b.read!.taskReply = undefined;
        await page.locator('[data-read-how="now"]').click();
        await expect(row(page)).toHaveAttribute('data-state', 'chat');
        await expect.poll(() => links(page)).toEqual([expect.stringMatching(/task=T0043.*do=chat|do=chat.*task=T0043/)]);
    });

    test('saved: "Give to the agent…" offers now and queue; the research\'s word follows', async ({ page }) => {
        const b = await setup(page, { readAgain: { S0001: { read: READ_ID, state: 'saved' } } });
        await view(page);
        await expect(row(page).locator('.viewer-read-state-text')).toHaveText('Newer reading of 19 Oct saved, no task created.');
        await row(page).locator('[data-read-state="toggle"]').click();
        await expect(page.locator('#source-viewer-read-state-opts [data-read-how]')).toHaveCount(2);
        await expect(page.locator('#source-viewer-read-state-opts [data-read-how="save"]')).toHaveCount(0);
        // The research says the task done: the row follows it.
        b.statusExtra = { readAgain: { S0001: { read: READ_ID, state: 'task', task: 'T0050', taskFor: 'agent', taskOpen: false } } };
        await poll(page);
        await expect(row(page)).toHaveAttribute('data-state', 'done');
        await expect(row(page).locator('.viewer-read-state-text')).toHaveText('Newer reading of 19 Oct: assessed in task T0050.');
    });

    test('the agent\'s proposal: accepted through the bridge, the transcript shown changed, undone again', async ({ page }) => {
        const proposal = { text: 'Josef Fíšek a Anně', by: 'agent · m-1', task: 'T0042', at: '2026-11-06T10:00:00Z' };
        const b = await setup(page, {
            features: [...FEATURES, 'sources.proposal', 'sources.proposal.undo'],
            readAgain: { S0001: { read: READ_ID, state: 'task', task: 'T0042', taskFor: 'agent', taskOpen: false, proposal } },
        });
        await view(page);
        const p = page.locator('#source-viewer-proposal');
        await expect(p).toBeVisible();
        await expect(p.locator('.viewer-proposal-row')).toHaveCount(1);
        await expect(p.locator('.viewer-proposal-row')).toContainText('Anna');
        await expect(p.locator('.viewer-proposal-row')).toContainText('Anně');
        await p.locator('[data-proposal-act="whole"]').click();
        await expect(p.locator('.viewer-proposal-cols')).toBeVisible();
        await p.locator('[data-proposal-take="proposal"]').click();
        await expect(p).toHaveClass(/is-done/);
        await expect(p).toContainText('Proposal accepted, transcript changed.');
        expect(b.read!.proposalPosts).toEqual([{ source: 'S0001', task: 'T0042', take: 'proposal' }]);
        await expect(page.locator('#source-viewer-transcript-changed')).toContainText('Changed by the proposal from task T0042');
        await page.locator('#source-viewer-proposal [data-proposal-take="undo"]').click();
        await expect(page.locator('#source-viewer-proposal [data-proposal-take="proposal"]')).toBeVisible();
        await expect(page.locator('#source-viewer-transcript-changed')).toHaveCount(0);
        expect(b.read!.proposalPosts!.map(x => x.take)).toEqual(['proposal', 'undo']);
    });

    test('the bridge down: the state stays, nothing to choose', async ({ page }) => {
        const b = await setup(page, { readAgain: { S0001: { read: READ_ID, state: 'unchecked' } } });
        await view(page);
        await expect(row(page).locator('[data-read-state="toggle"]')).toBeVisible();
        b.statusCode = 503;
        await poll(page);
        await expect(row(page).locator('[data-read-state="toggle"]')).toHaveCount(0);
        await expect(row(page).locator('.viewer-read-state-text')).toContainText('Newer reading of 19 Oct differs');
    });
});

test.describe('A source after a newer reading in a narrow window', () => {
    // A phone-wide window on the computer reaches the bridge: the choices are there, one under another.
    // (A touch phone reaches no bridge and knows no state of the research: the row's phone sentence is covered by the view's test.)
    test.use({ viewport: PHONE });

    test('the choices one under another, wide enough for a finger, nothing wider than the viewer', async ({ page }) => {
        await setup(page, { readAgain: { S0001: { read: READ_ID, state: 'unchecked' } } });
        await view(page);
        await row(page).locator('[data-read-state="toggle"]').click();
        const choices = await page.locator('#source-viewer-read-state-opts [data-read-how]').all();
        expect(choices).toHaveLength(3);
        const boxes = await Promise.all(choices.map(c => c.boundingBox()));
        for (const b of boxes) expect(b!.height).toBeGreaterThanOrEqual(44);
        expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
        expect(await row(page).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });
});

test.describe('The setting "Task from a new reading"', () => {
    test.use({ viewport: DESKTOP });

    test('the research\'s value, a choice written through the bridge and confirmed', async ({ page }) => {
        const b = await setup(page);
        await openTreeSettings(page);
        const group = page.locator('#research-readtask-group');
        await expect(group).toBeVisible();
        await expect(group).not.toHaveAttribute('open', '');
        await expect(group.locator('.research-group-value-full')).toHaveText('Task from a new reading: Ask');
        await group.locator('summary').click();
        await expect(page.locator('input[name="research-read-task"][value="ask"]')).toBeChecked();
        await page.locator('input[name="research-read-task"][value="always"]').check();
        await expect(page.locator('#research-readtask-note')).toHaveText(/The research confirmed\./);
        expect(b.read!.settingPosts).toEqual([{ sourceTask: 'always' }]);
        await poll(page);
        await expect(group.locator('.research-group-value-full')).toHaveText('Task from a new reading: Always create');
        await expect(page.locator('input[name="research-read-task"][value="always"]')).toBeChecked();
        await expect(group).toHaveAttribute('open', '');
    });

    test('a refusal leaves the research\'s value; the bridge down dims the choices', async ({ page }) => {
        const b = await setup(page, { sourceTask: 'never' });
        b.read!.settingReply = { status: 409, body: { code: 'sourceTask.archive', reason: 'The archive does not create tasks.' } };
        await openTreeSettings(page);
        const group = page.locator('#research-readtask-group');
        await group.locator('summary').click();
        await expect(page.locator('input[name="research-read-task"][value="never"]')).toBeChecked();
        await page.locator('input[name="research-read-task"][value="ask"]').click();
        await expect(page.locator('#research-readtask-note')).toBeVisible();
        await expect(page.locator('input[name="research-read-task"][value="never"]')).toBeChecked();
        // The research not running (as the hypotheses' row: said when the dialog opens).
        b.down = true;
        await poll(page);
        await openTreeSettings(page);
        await page.locator('#research-readtask-group summary').click();
        await expect(page.locator('#research-readtask')).toHaveClass(/is-down/);
        await expect(page.locator('#research-readtask-note')).toHaveText("The research isn't running. This can be changed once it runs.");
        await expect(page.locator('input[name="research-read-task"][value="ask"]')).toBeDisabled();
    });
});

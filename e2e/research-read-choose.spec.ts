import { test, expect, Page, Locator } from '@playwright/test';
import { fakeBridge, fakeRead, readAccepts, openResearch, openResearchMenu, poll, FakeBridge, FakeReading, READ_ID } from './research-bridge.js';

/**
 * "Read a document" with the readers' agent, model and effort (spec 059):
 * who reads, "Adjust reading", `with` sent only when a reader differs from
 * the default, an agent that cannot read now, the research turning a choice
 * down (400 read.with, 409 read.agent), who read in the progress, the result,
 * the research panel's strip, the Research menu and the list of readings,
 * and a reading from before (no `who`): nothing of it shown.
 * All against a fake bridge; invented documents and names.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

/** The research's offer: its own agent first, another one, one signed out. */
function choices(): Record<string, unknown> {
    return {
        agents: [
            {
                id: 'claude', name: 'Claude Code', ready: true, why: '', resets: '',
                models: [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }, { id: '', name: '' }],
                efforts: ['high', 'medium', ''], default: { model: 'opus', effort: 'high' },
            },
            {
                id: 'codex', name: 'Codex', ready: true, why: '', resets: '',
                models: [{ id: 'gpt-5', name: 'GPT-5' }, { id: '', name: '' }], efforts: [], default: { model: 'gpt-5', effort: '' },
            },
            {
                id: 'gemini', name: 'Gemini CLI', ready: false, why: 'auth', resets: '',
                models: [{ id: '', name: '' }], efforts: [], default: { model: '', effort: '' },
            },
        ],
        default: [{ agent: 'claude', model: 'opus', effort: 'high' }, { agent: 'claude', model: 'opus', effort: 'high' }],
    };
}

/**
 * The offer of a research that says what an alias runs on now (`read.choices.now`: Opus and the agent's own model
 * of Claude Code) and whose Codex list comes from a newer Codex than the installed one (one model `unsure`).
 */
function choicesNow(): Record<string, unknown> {
    const c = choices() as { agents: Record<string, unknown>[] };
    c.agents[0].models = [
        { id: 'opus', name: 'Opus', now: 'claude-opus-5-5', nowName: 'Opus 5.5' },
        { id: 'sonnet', name: 'Sonnet' },
        { id: '', name: '', now: 'claude-opus-5-5', nowName: 'Opus 5.5' },
    ];
    c.agents[1].models = [{ id: 'gpt-5', name: 'GPT-5' }, { id: 'gpt-6-astra', name: 'GPT-6-Astra', unsure: true }, { id: '', name: '' }];
    c.agents[1].catalogNewer = { catalog: '0.60.0', installed: '0.57.1' };
    return c;
}

async function setup(page: Page, opts: { choose?: boolean; history?: (FakeReading & { inSource?: boolean })[]; readers?: 1 | 2; stored?: unknown; offer?: Record<string, unknown>; features?: string[] } = {}): Promise<FakeBridge> {
    const choose = opts.choose !== false;
    const b = await fakeBridge(page, {
        accepts: {
            sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true },
            read: readAccepts(choose ? { choices: opts.offer ?? choices() } : {}),
        },
        features: [...(choose ? ['read.now', 'read.choose'] : ['read.now']), ...(opts.features ?? [])],
        read: fakeRead(opts.history ? { history: opts.history } : {}),
    });
    await openResearch(page, { media: true });
    await page.evaluate(({ readers, stored }) => {
        localStorage.setItem('read.readers', String(readers));
        if (stored) localStorage.setItem('read.with', JSON.stringify(stored));
    }, { readers: opts.readers ?? 2, stored: opts.stored ?? null });
    await poll(page);
    return b;
}

const dialog = (page: Page) => page.locator('#read-document-modal');

async function openWithPage(page: Page): Promise<Locator> {
    await openResearchMenu(page, { expandMore: true });
    await page.locator('#research-item-read').click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await page.setInputFiles('#read-input', [{ name: 'zapis.jpg', mimeType: 'image/jpeg', buffer: JPEG }]);
    await expect(d.locator('.read-page')).toHaveCount(1);
    return d;
}

const select = (d: Locator, at: number, field: string) => d.locator(`select.read-refine-select[data-at="${at}"][data-field="${field}"]`);

function now(): string { return new Date().toISOString(); }

function reading(id: string, state: string, extra: Partial<FakeReading> = {}): FakeReading & { inSource?: boolean } {
    return { id, state, version: 1, at: now(), since: now(), files: 1, pages: 1, readers: 2, done: 0, entries: 0, name: 'zapis.jpg', person: '', from: 'app', ...extra };
}

const WHO_MIXED = [
    { agent: 'claude', name: 'Claude Code', model: 'opus', effort: 'high' },
    { agent: 'codex', name: 'Codex', model: 'gpt-5', effort: '' },
];

/** A finished reading of two readers that differ in one place; `who` absent: a reading from before spec 059. */
function result(who?: Record<string, unknown>[]): Record<string, unknown> {
    return {
        id: READ_ID, state: 'done', lang: 'en',
        doc: { kind: 'register.baptism', language: ['la'], script: 'kurrent', date: '3. 4. 1846', legible: 'yes', why: null },
        readers: { asked: 2, ran: 2, agree: 'differ', ...(who ? { who: who.map(w => ({ ...w, ...(w.model === 'opus' ? { modelName: 'Opus 4' } : {}) })) } : {}) },
        pages: [{ n: 1, file: 'I0101', name: 'matrika-lhota-1846.jpg', page: 1, w: 600, h: 800, image: `read/${READ_ID}/page/1.jpg` }],
        entries: [{
            id: 'e1', page: 1, transcript: 'Joannes filius legitimus\nAntonii Novák, Lhota', variants: [{ at: 'Novák', other: 'Nowak' }],
            persons: [], events: [], relations: [],
        }],
        context: '', version: 1,
    };
}

test.describe('Read a document: the readers\' agent, model and effort', () => {
    test.use({ viewport: DESKTOP });

    test('who reads as by default: one line, "as set in the research"; Read with the AI badge sends no `with`', { tag: '@smoke' }, async ({ page }) => {
        const b = await setup(page);
        const d = await openWithPage(page);
        await expect(d.locator('.read-readers legend .read-readers-gloss')).toHaveText('two read separately, the transcripts are compared and where they differ is shown');
        const who = d.locator('.read-who');
        await expect(who.locator('.read-who-line')).toHaveText(['Both readers: Claude Code · Opus · high']);
        await expect(who.locator('.read-who-from')).toHaveText('as set in the research');
        await expect(who.locator('.read-reset')).toHaveCount(0);
        const toggle = d.locator('[data-act="refine"]');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(d.locator('#read-refine-panel')).toHaveCount(0);
        // Read goes through the bridge to an agent, no terminal: the AI badge alone.
        await expect(d.locator('[data-act="read"] .research-ai-badge')).toHaveCount(1);
        await expect(toggle.locator('.research-ai-badge')).toHaveCount(0);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        expect('with' in b.read!.posts[0]).toBe(false);
        expect(b.read!.posts[0].readers).toBe(2);
    });

    test('Adjust reading: agent, model and effort per reader; `with` only for the changed one; Default sets them back', async ({ page }) => {
        const b = await setup(page);
        const d = await openWithPage(page);
        await d.locator('[data-act="refine"]').click();
        await expect(d.locator('[data-act="refine"]')).toHaveAttribute('aria-expanded', 'true');
        const panel = d.locator('#read-refine-panel');
        await expect(panel).toBeVisible();
        await expect(panel.locator('.read-refine-label')).toHaveText(['Reader 1', 'Reader 2 (independent)']);
        await expect(select(d, 0, 'agent')).toHaveAttribute('aria-label', 'Reader 1 – Agent');
        // The agent that cannot read now is offered greyed, with why.
        const gemini = select(d, 0, 'agent').locator('option[value="gemini"]');
        await expect(gemini).toHaveText('Gemini CLI – sign-in expired');
        await expect(gemini).toBeDisabled();
        // A model or effort `""`: as the agent itself is set.
        await expect(select(d, 0, 'model').locator('option[value=""]')).toHaveText('as the agent is set');
        await expect(select(d, 0, 'effort').locator('option[value=""]')).toHaveText('as the agent is set');

        // Reader 2 with another agent: its own default model; it has no effort; the note says what it draws on.
        await select(d, 1, 'agent').focus();
        await select(d, 1, 'agent').selectOption('codex');
        await expect(select(d, 1, 'model')).toHaveValue('gpt-5');
        await expect(select(d, 1, 'effort')).toHaveCount(0);
        await expect(d.locator('.read-refine-row[data-at="1"] .read-refine-noeffort')).toHaveText('no effort');
        await expect(d.locator('.read-refine-row[data-at="1"] .read-refine-note')).toHaveText('uses the Codex subscription or credit');
        await expect(d.locator('.read-refine-row[data-at="0"] .read-refine-note')).toHaveCount(0);
        await expect(d.locator('.read-who-tag')).toHaveText('kept for the next readings');
        // The focus stays on the select just changed.
        await expect(select(d, 1, 'agent')).toBeFocused();

        // Default: back as by default, the panel stays open.
        await d.locator('[data-act="reset-with"]').click();
        await expect(panel).toBeVisible();
        await expect(select(d, 1, 'agent')).toHaveValue('claude');
        await expect(d.locator('.read-who-from')).toHaveText('as set in the research');

        await select(d, 1, 'agent').selectOption('codex');
        await select(d, 0, 'effort').selectOption('');
        // Closed: each reader on its own line.
        await d.locator('[data-act="refine"]').click();
        await expect(d.locator('.read-who-line')).toHaveText(['Reader 1: Claude Code · Opus', 'Reader 2: Codex · GPT-5']);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        expect(b.read!.posts[0].with).toEqual([{ agent: 'claude', model: 'opus', effort: '' }, { agent: 'codex', model: 'gpt-5', effort: '' }]);

        // Only reader 2 changed: reader 1 goes as `{}`.
        await d.locator('.read-footer [data-act="close"]').last().click();
        await page.evaluate(() => localStorage.removeItem('read.with'));
        b.read!.reads = [];
        await poll(page);
        const d2 = await openWithPage(page);
        await d2.locator('[data-act="refine"]').click();
        await select(d2, 1, 'model').selectOption('sonnet');
        await d2.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(2);
        expect(b.read!.posts[1].with).toEqual([{}, { agent: 'claude', model: 'sonnet', effort: 'high' }]);
    });

    test('Default forgets the kept choice at once, even when the dialog closes without reading', async ({ page }) => {
        await setup(page, { stored: [{ agent: 'claude', model: 'opus', effort: 'high' }, { agent: 'codex', model: 'gpt-5', effort: '' }] });
        const d = await openWithPage(page);
        await expect(d.locator('.read-who-line')).toHaveText(['Reader 1: Claude Code · Opus · high', 'Reader 2: Codex · GPT-5']);
        await expect(d.locator('.read-who-tag')).toHaveText('kept for the next readings');
        await d.locator('[data-act="reset-with"]').click();
        await expect(d.locator('.read-who-from')).toHaveText('as set in the research');
        expect(await page.evaluate(() => localStorage.getItem('read.with'))).toBeNull();
        await d.locator('.read-footer [data-act="close"]').last().click();
        await expect(d).toHaveCount(0);
        const d2 = await openWithPage(page);
        await expect(d2.locator('.read-who-line')).toHaveText(['Both readers: Claude Code · Opus · high']);
        await expect(d2.locator('.read-who-from')).toHaveText('as set in the research');
    });

    test('the time said is the slowest reader\'s; none for a reader never timed here; past it, the reading waits for the other reader', async ({ page }) => {
        await page.clock.install();
        const b = await setup(page, { stored: [{ agent: 'claude', model: 'opus', effort: 'high' }, { agent: 'codex', model: 'gpt-5', effort: '' }] });
        const d = await openWithPage(page);
        // Codex never read in this research: no time said rather than the research's own agent's.
        await expect(d.locator('#read-foot-note strong')).toHaveText('1 page will be read · 2 readers');
        await expect(d.locator('#read-foot-note')).not.toContainText('usually');
        await d.locator('.read-footer [data-act="close"]').last().click();
        await expect(d).toHaveCount(0);
        // A reading of both ended here in 5 min 31 s: Codex's time comes from it.
        const at = new Date(Date.now() - 3_600_000);
        b.read!.reads = [reading('D20261106173422-86d4', 'done', {
            from: 'research', at: at.toISOString(), since: new Date(at.getTime() + 331_000).toISOString(), done: 2, entries: 1, who: WHO_MIXED,
        })];
        await poll(page);
        const d2 = await openWithPage(page);
        await expect(d2.locator('#read-foot-note')).toContainText('usually within 6 minutes');
        await d2.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        const r = b.read!.reads[0];
        r.who = WHO_MIXED;
        r.state = 'reading';
        r.since = new Date(await page.evaluate(() => Date.now())).toISOString();
        await poll(page);
        await expect(d2.locator('#read-progress-time')).toContainText('Usually within 6 minutes · running');
        await expect(d2.locator('#read-progress-time')).not.toContainText('waiting');
        // Past the time said, one reader done: it says the reading waits for the other one.
        r.done = 1;
        await page.clock.fastForward(6 * 60_000 + 5_000);
        await expect(d2.locator('#read-progress-time')).toContainText('· waiting for the other reader');
        await expect(d2.locator('#read-progress-slow')).toBeHidden();
    });

    test('one reader: "Read by"; switching to two keeps reader 1 and starts reader 2 as by default', async ({ page }) => {
        const b = await setup(page, { readers: 1 });
        const d = await openWithPage(page);
        await expect(d.locator('.read-who-line')).toHaveText(['Read by Claude Code · Opus · high']);
        await d.locator('[data-act="refine"]').click();
        await expect(d.locator('.read-refine-label')).toHaveText(['Reader']);
        await select(d, 0, 'model').selectOption('sonnet');
        await d.locator('.read-reader input[value="2"]').check();
        await expect(d.locator('.read-refine-label')).toHaveText(['Reader 1', 'Reader 2 (independent)']);
        await expect(select(d, 0, 'model')).toHaveValue('sonnet');
        await expect(select(d, 1, 'model')).toHaveValue('opus');
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        expect(b.read!.posts[0].with).toEqual([{ agent: 'claude', model: 'sonnet', effort: 'high' }]);
    });

    test('an agent chosen last that cannot read now: said at the reader, Read stays off, nothing switched quietly', async ({ page }) => {
        const b = await setup(page, { stored: [{ agent: 'claude', model: 'opus', effort: 'high' }, { agent: 'gemini', model: '', effort: '' }] });
        const d = await openWithPage(page);
        await expect(d.locator('.read-who-line').nth(1)).toHaveText('Reader 2: Gemini CLI · as the agent is set · sign-in expired');
        await expect(d.locator('.read-who-down')).toHaveText(' · sign-in expired');
        await expect(d.locator('[data-act="read"]')).toBeDisabled();
        await expect(d.locator('.read-foot-down')).toHaveText('A reader with an unavailable agent cannot start.');
        await d.locator('[data-act="refine"]').click();
        await expect(select(d, 1, 'agent')).toHaveValue('gemini');
        await expect(d.locator('.read-refine-row[data-at="1"] .read-refine-note')).toHaveText('Gemini CLI is not available now: sign-in expired. Sign in in the research, or pick another agent.');
        await expect(d.locator('.read-refine-row[data-at="1"] .read-refine-note')).toHaveClass(/is-down/);
        await select(d, 1, 'agent').selectOption('codex');
        await expect(d.locator('[data-act="read"]')).toBeEnabled();
        await expect(d.locator('.read-foot-down')).toHaveCount(0);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        expect(b.read!.posts[0].with).toEqual([{}, { agent: 'codex', model: 'gpt-5', effort: '' }]);
    });

    test('409 read.agent: back to the choice, the reason at the reader; another agent reads', async ({ page }) => {
        const b = await setup(page);
        const resets = new Date(Date.now() + 3 * 3600_000).toISOString();
        b.read!.startReply = { status: 409, body: { error: 'Agent cannot read.', code: 'read.agent', text: 'Agent cannot read.', params: { at: 0, agent: 'claude', why: 'limit', resets } } };
        const d = await openWithPage(page);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await expect(d.locator('#read-refine-panel')).toBeVisible();
        await expect(d.locator('.read-page')).toHaveCount(1);
        const note = d.locator('.read-refine-row[data-at="0"] .read-refine-note');
        await expect(note).toContainText('Claude Code is not available now: limit reached (until ');
        await expect(note).toContainText('Another agent can be picked.');
        await expect(d.locator('[data-act="read"]')).toBeDisabled();
        b.read!.startReply = undefined;
        await select(d, 0, 'agent').selectOption('codex');
        await select(d, 1, 'agent').selectOption('codex');
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(2);
        expect(b.read!.posts[1].with).toEqual([{ agent: 'codex', model: 'gpt-5', effort: '' }, { agent: 'codex', model: 'gpt-5', effort: '' }]);
        await expect(d.locator('#read-title')).toHaveText('Reading a document');
    });

    test('400 read.with: the reader set back to the default and said so', async ({ page }) => {
        const b = await setup(page);
        b.read!.startReply = { status: 400, body: { error: 'Not offered.', code: 'read.with', text: 'Not offered.', params: { at: 1, field: 'model' } } };
        const d = await openWithPage(page);
        await d.locator('[data-act="refine"]').click();
        await select(d, 1, 'model').selectOption('sonnet');
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await expect(d.locator('.read-notice')).toHaveText('The research no longer offers what reader 2 was to read with; the default is set.');
        await expect(select(d, 1, 'model')).toHaveValue('opus');
        await expect(d.locator('.read-who-from')).toHaveText('as set in the research');
    });

    test('who read: in the progress (only when not as by default), the result, the strip, the menu and the list', async ({ page }) => {
        const b = await setup(page);
        const d = await openWithPage(page);
        await d.locator('[data-act="refine"]').click();
        await select(d, 1, 'agent').selectOption('codex');
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        const r = b.read!.reads[0];
        r.who = WHO_MIXED;
        r.state = 'reading';
        r.done = 1;
        await poll(page);
        await expect(d.locator('.read-progress-who li')).toHaveText(['Reader 1: Claude Code · Opus · high · done', 'Reader 2: Codex · GPT-5 · reading…']);

        // The Research menu and the panel's strip add the other agent.
        await d.locator('.read-footer [data-act="close"]').last().click();
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-read')).toContainText('1 of 2 readers done · Claude Code and Codex · Show');
        await page.evaluate(() => (window.Strom.UI as any).closeResearchMenu());
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        await expect(page.locator('#live-panel #read-strip .read-strip__name')).toHaveText('1 of 2 readers · zapis.jpg · Claude Code and Codex');

        // Done: the result says who read; each version of a difference carries its reader's mark.
        r.state = 'done';
        r.done = 2;
        b.read!.results.set(r.id, result(WHO_MIXED));
        await poll(page);
        await page.evaluate((id) => (window.Strom.UI as any).showReadDocumentDialog({ readId: id }), READ_ID);
        await expect(d.locator('#read-result')).toBeVisible();
        await expect(d.locator('.read-result-who-line')).toHaveText(['Reader 1: Claude Code · Opus 4 · high', 'Reader 2: Codex · GPT-5']);
        const variant = d.locator('.read-transcript .read-variant');
        await expect(variant).toHaveText('Novák/Nowak');
        await expect(variant.locator('.read-variant-mk')).toHaveCount(2);
        expect(await variant.locator('.read-variant-mk').nth(1).evaluate(el => getComputedStyle(el, '::after').content)).toBe('"2"');
        await expect(variant).toHaveAttribute('title', 'Reader 1 · Claude Code · Opus 4: “Novák”\nReader 2 · Codex · GPT-5: “Nowak”');
        // The legend says the count and the readers once, then one row per place with its words around it.
        const differ = d.locator('.read-legend-differ');
        await expect(differ).toContainText('The readers differ in 1 place: ');
        await expect(differ).toContainText('Claude Code · Opus 4');
        await expect(differ).toContainText('Codex · GPT-5');
        await expect(differ.locator('.read-variant-mk')).toHaveCount(2);
        const place = d.locator('.read-legend-place');
        await expect(place).toHaveCount(1);
        await expect(place).toContainText('Antonii');
        await expect(place).toContainText('Lhota');
        await expect(place.locator('.read-variant')).toHaveAttribute('title', 'Reader 1 · Claude Code · Opus 4: “Novák”\nReader 2 · Codex · GPT-5: “Nowak”');
        await expect(place.locator('.read-variant-mk')).toHaveCount(2);
    });

    test('as by default: no readers in the progress; one line for both readers in the result', async ({ page }) => {
        const b = await setup(page);
        const d = await openWithPage(page);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        const same = [{ agent: 'claude', name: 'Claude Code', model: 'opus', effort: 'high' }, { agent: 'claude', name: 'Claude Code', model: 'opus', effort: 'high' }];
        const r = b.read!.reads[0];
        r.who = same;
        r.state = 'reading';
        await poll(page);
        await expect(d.locator('.read-step.is-now')).toContainText('Reading');
        await expect(d.locator('.read-progress-who')).toHaveCount(0);
        r.state = 'done';
        r.done = 2;
        b.read!.results.set(r.id, result(same));
        await poll(page);
        await expect(d.locator('#read-result')).toBeVisible();
        await expect(d.locator('.read-result-who-line')).toHaveText(['Both readers: Claude Code · Opus 4 · high']);
    });

    test('a reading from before (no `who`): nothing of who read; the list names another agent only where one read', async ({ page }) => {
        const older = reading('D20261001080000-0a0b', 'done', { at: '2026-10-01T08:00:00Z', entries: 1, name: 'starsi-zapis.jpg' });
        const other = reading(READ_ID, 'done', { at: '2026-10-19T15:30:12Z', entries: 1, name: 'matrika-lhota-1846.jpg', who: WHO_MIXED });
        const own = reading('D20261010090000-0c0d', 'done', { at: '2026-10-10T09:00:00Z', entries: 1, name: 'oddaci-zapis.jpg',
            who: [{ agent: 'claude', name: 'Claude Code', model: 'opus', effort: 'high' }] });
        const b = await setup(page, { history: [other, own, older] });
        await page.evaluate(() => window.Strom.UI.showResearchTreeSettings(window.Strom.TreeManager.getActiveTreeId()!));
        await page.locator('#research-read-history').click();
        const rows = page.locator('#read-history-modal .read-history-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0).locator('.read-history-meta')).toContainText('Claude Code and Codex');
        await expect(rows.nth(1).locator('.read-history-meta')).not.toContainText('Claude Code');
        await expect(rows.nth(2).locator('.read-history-meta')).not.toContainText('Claude Code');
        await page.keyboard.press('Escape');

        b.read!.reads = [{ ...older, id: READ_ID }];
        b.read!.results.set(READ_ID, result());
        await poll(page);
        await page.evaluate((id) => (window.Strom.UI as any).showReadDocumentDialog({ readId: id }), READ_ID);
        const d = dialog(page);
        await expect(d.locator('#read-result')).toBeVisible();
        await expect(d.locator('.read-result-who')).toHaveCount(0);
        await expect(d.locator('.read-variant-mk')).toHaveCount(0);
        await expect(d.locator('.read-legend-who')).toHaveCount(0);
        await expect(d.locator('.read-legend-differ')).toHaveText('/The readers differ in 1 place');
        await expect(d.locator('.read-legend-place .read-variant')).toHaveAttribute('title', /readers differ: the first reads “Novák”, the second “Nowak”/);
    });

    test('a research without the choice (no read.choose): no who reads, nothing sent as `with`', async ({ page }) => {
        const b = await setup(page, { choose: false });
        const d = await openWithPage(page);
        await expect(d.locator('.read-readers')).toBeVisible();
        await expect(d.locator('.read-who')).toHaveCount(0);
        await expect(d.locator('[data-act="refine"]')).toHaveCount(0);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        expect('with' in b.read!.posts[0]).toBe(false);
    });

    test('what an alias runs on now (read.choices.now): said after the model, the alias is what is sent', async ({ page }) => {
        const b = await setup(page, { offer: choicesNow(), features: ['read.choices.now'] });
        const d = await openWithPage(page);
        await expect(d.locator('.read-who-line')).toHaveText(['Both readers: Claude Code · Opus (now Opus 5.5) · high']);
        await d.locator('[data-act="refine"]').click();
        const model = select(d, 0, 'model');
        await expect(model).toHaveValue('opus');
        await expect(model.locator('option')).toHaveText(['Opus (now Opus 5.5)', 'Sonnet', 'as the agent is set (now Opus 5.5)']);
        await model.selectOption('');
        await select(d, 1, 'model').selectOption('opus');
        await select(d, 1, 'effort').selectOption('medium');
        await d.locator('[data-act="refine"]').click();
        await expect(d.locator('.read-who-line')).toHaveText(['Reader 1: Claude Code · as the agent is set (now Opus 5.5) · high', 'Reader 2: Claude Code · Opus (now Opus 5.5) · medium']);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        // The alias goes out, never what it runs on now: a newer Opus is taken by itself.
        expect(b.read!.posts[0].with).toEqual([{ agent: 'claude', model: '', effort: 'high' }, { agent: 'claude', model: 'opus', effort: 'medium' }]);
        expect(JSON.stringify(b.read!.posts[0])).not.toContain('claude-opus-5-5');

        // Read again keeps saying it and sends the alias as well.
        await d.locator('.read-cancel').click();
        await d.locator('[data-act="again"]').click();
        await expect(d.locator('#read-title')).toHaveText('Read again');
        await expect(d.locator('.read-who-line')).toHaveText(['Reader 1: Claude Code · as the agent is set (now Opus 5.5) · high', 'Reader 2: Claude Code · Opus (now Opus 5.5) · medium']);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.agains.length).toBe(1);
        expect(b.read!.agains[0].body.with).toEqual([{ agent: 'claude', model: '', effort: 'high' }, { agent: 'claude', model: 'opus', effort: 'medium' }]);
    });

    test('without read.choices.now: the models as before, even when the offer carries what they run on', async ({ page }) => {
        await setup(page, { offer: choicesNow() });
        const d = await openWithPage(page);
        await expect(d.locator('.read-who-line')).toHaveText(['Both readers: Claude Code · Opus · high']);
        await d.locator('[data-act="refine"]').click();
        await expect(select(d, 0, 'model').locator('option')).toHaveText(['Opus', 'Sonnet', 'as the agent is set']);
    });

    test('a Codex model from a newer Codex\'s list: a note under the reader; none for the other models', async ({ page }) => {
        await setup(page, { offer: choicesNow(), features: ['read.choices.now'] });
        const d = await openWithPage(page);
        await d.locator('[data-act="refine"]').click();
        await select(d, 1, 'agent').selectOption('codex');
        const row = d.locator('.read-refine-row[data-at="1"]');
        await expect(row.locator('[data-note="catalog-newer"]')).toHaveCount(0);
        await select(d, 1, 'model').selectOption('gpt-6-astra');
        await expect(row.locator('[data-note="catalog-newer"]')).toHaveText(
            'The model list comes from Codex 0.60.0; the installed Codex 0.57.1 may not know this model. A newer Codex: npm install -g @openai/codex@latest');
        await expect(row.locator('.read-refine-note')).toHaveCount(2);
        await select(d, 1, 'model').selectOption('gpt-5');
        await expect(row.locator('[data-note="catalog-newer"]')).toHaveCount(0);
    });

    test('a reading whose reader\'s agent refused the model: the research\'s own sentence', async ({ page }) => {
        const b = await setup(page);
        const d = await openWithPage(page);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        const said = 'The model gpt-6-astra is not available in the installed version of the Codex CLI – update Codex (npm install -g @openai/codex@latest), or choose another model.';
        b.read!.results.set(READ_ID, { ...result(), state: 'failed', entries: [], failure: { code: 'model', text: said, params: { agent: 'codex', model: 'gpt-6-astra' } } });
        b.read!.reads[0].state = 'failed';
        await poll(page);
        await expect(d.locator('.read-error')).toHaveAttribute('data-error', 'failed');
        await expect(d.locator('.read-error-text')).toHaveText(said);
    });

    test('Read again after cancelling: the readers chosen first, `with` only when changed', async ({ page }) => {
        const b = await setup(page);
        const d = await openWithPage(page);
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.posts.length).toBe(1);
        await d.locator('.read-cancel').click();
        await expect(d.locator('.read-error[data-error="cancelled"]')).toBeVisible();
        const again = d.locator('[data-act="again"]');
        await expect(again.locator('.research-ai-badge')).toHaveCount(1);
        await again.click();
        await expect(d.locator('#read-title')).toHaveText('Read again');
        await expect(d.locator('.read-who')).toBeVisible();
        await expect(d.locator('#read-drop, .read-page, #read-note')).toHaveCount(0);
        await d.locator('[data-act="refine"]').click();
        await select(d, 0, 'agent').selectOption('codex');
        await d.locator('[data-act="read"]').click();
        await expect.poll(() => b.read!.agains.length).toBe(1);
        expect(b.read!.agains[0].body.with).toEqual([{ agent: 'codex', model: 'gpt-5', effort: '' }]);
        await expect(d.locator('#read-title')).toHaveText('Reading a document');
    });
});

test.describe('Read a document: the readers on a phone', () => {
    test.use({ viewport: PHONE });

    test('who reads and the open panel stay within the dialog', async ({ page }) => {
        await setup(page);
        const d = await openWithPage(page);
        await expect(d.locator('.read-who')).toBeVisible();
        await d.locator('[data-act="refine"]').click();
        await expect(d.locator('#read-refine-panel')).toBeVisible();
        await expect(d.locator('.read-refine-cols')).toBeHidden();
        const content = d.locator('.read-content');
        expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const box = (await content.boundingBox())!;
        for (const el of await d.locator('select.read-refine-select').all()) {
            const r = (await el.boundingBox())!;
            expect(r.x).toBeGreaterThanOrEqual(box.x - 1);
            expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 1);
        }
        // Each choice a full-width field of 44 px with its name inside, on the left; the fields under each other.
        await select(d, 1, 'agent').selectOption('codex');
        const row = d.locator('.read-refine-row[data-at="1"]');
        const fields = row.locator('.read-refine-field');
        await expect(fields.locator('.read-refine-field-key')).toHaveText(['Agent', 'Model', 'Effort']);
        const rowBox = (await row.boundingBox())!;
        let lastBottom = 0;
        for (const f of await fields.all()) {
            const r = (await f.boundingBox())!;
            expect(Math.round(r.height)).toBeGreaterThanOrEqual(44);
            expect(r.width).toBeGreaterThan(rowBox.width - 30);
            expect(r.y).toBeGreaterThanOrEqual(lastBottom);
            lastBottom = r.y + r.height;
            const key = (await f.locator('.read-refine-field-key').boundingBox())!;
            expect(key.x).toBeLessThan(r.x + 20);
        }
        // An agent without effort keeps the third field, so the height does not jump.
        await expect(fields.nth(2).locator('.read-refine-noeffort')).toHaveText('no effort');
        // The links have a target of 44 px.
        expect(Math.round((await d.locator('[data-act="refine"]').boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        expect(Math.round((await d.locator('[data-act="reset-with"]').boundingBox())!.height)).toBeGreaterThanOrEqual(44);
        expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });

    test('who read in the result: one line per reader, within the width', async ({ page }) => {
        const b = await setup(page);
        b.read!.reads = [reading(READ_ID, 'done', { who: WHO_MIXED, done: 2, entries: 1 })];
        b.read!.results.set(READ_ID, result(WHO_MIXED));
        await poll(page);
        await page.evaluate((id) => (window.Strom.UI as any).showReadDocumentDialog({ readId: id }), READ_ID);
        const d = dialog(page);
        await expect(d.locator('#read-result')).toBeVisible();
        const lines = d.locator('.read-result-who-line');
        await expect(lines).toHaveText(['Reader 1: Claude Code · Opus 4 · high', 'Reader 2: Codex · GPT-5']);
        const [a, c] = [(await lines.nth(0).boundingBox())!, (await lines.nth(1).boundingBox())!];
        expect(c.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
        expect(await d.locator('.read-dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    });
});

test.describe('Read a document: the readers on a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 } });

    test('the computer\'s rows of readers, nothing sideways', async ({ page }) => {
        await setup(page);
        const d = await openWithPage(page);
        await d.locator('[data-act="refine"]').click();
        await expect(d.locator('.read-refine-cols')).toBeVisible();
        await expect(d.locator('.read-refine-field-key').first()).toBeHidden();
        const row = (await d.locator('.read-refine-row[data-at="0"]').boundingBox())!;
        const agent = (await select(d, 0, 'agent').boundingBox())!;
        const model = (await select(d, 0, 'model').boundingBox())!;
        // Agent, model and effort side by side in one row.
        expect(Math.abs(agent.y - model.y)).toBeLessThan(2);
        expect(model.x).toBeGreaterThan(agent.x + agent.width - 1);
        expect(model.x + model.width).toBeLessThanOrEqual(row.x + row.width + 1);
        expect(await d.locator('.read-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });
});

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

async function setup(page: Page, opts: { choose?: boolean; history?: (FakeReading & { inSource?: boolean })[]; readers?: 1 | 2; stored?: unknown } = {}): Promise<FakeBridge> {
    const choose = opts.choose !== false;
    const b = await fakeBridge(page, {
        accepts: {
            sync: { auto: 'off' }, sources: true, verified: true, media: { max: 500 * 1024 * 1024, region: true },
            read: readAccepts(choose ? { choices: choices() } : {}),
        },
        features: choose ? ['read.now', 'read.choose'] : ['read.now'],
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
        await expect(d.locator('.read-who-tag')).toHaveText('for this reading only');
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
        await expect(d.locator('.read-legend-differ')).toHaveText('/The readers differ here:');
        await expect(d.locator('.read-legend-who-line')).toHaveText(['Reader 1 · Claude Code · Opus 4: “Novák”', 'Reader 2 · Codex · GPT-5: “Nowak”']);
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
        await expect(d.locator('.read-legend')).toContainText('readers differ: the first reads “Novák”, the second “Nowak”');
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
    });
});

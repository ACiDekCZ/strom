import { test, expect, Page, Route } from '@playwright/test';
import { BRIDGE, FakeBridge, fakeBridge, openResearch, poll, researchGed } from './research-bridge.js';

/**
 * Fix at a task's finding (spec 109 K1.5): Fix reads the research's preview
 * (`GET <base>/waiting/<T…>/fix`), its loading in the finding's row; the
 * preview opens in the item ("What changes", "What remains" with Discuss with
 * the agent, a note, Cancel and Fix), on a phone as a bottom sheet. Fix
 * writes `{do: 'fix', expect}` with the preview's stamp, the list is read
 * again, a toast says it with Undo (`{do: 'unfix'}`). Refusals stay in the
 * preview, quiet: changed meanwhile (Reload, Fix off), busy (Fix on), locked
 * and a full disk (Fix off); a finding gone: a toast, the item plain.
 * Invented tasks and books; a fake bridge; a fixed clock.
 */

test.use({ timezoneId: 'Europe/Prague' });

const NOW = new Date('2026-11-13T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat', 'task', 'book'];
const FEATURES = ['waiting.groups', 'books', 'tasks.audit'];
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

const smyslenka = { key: 'repo:R0003', name: 'Archiv ve Smyšlence', kind: 'archive', url: 'https://archiv-smyslenka.example/' };
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const STAMP_412 = 'T0412@2026-11-12T09:14:03Z';
const STAMP_377 = 'T0377@2026-11-11T08:00:00Z';
const BOOK = 'Smyšlenka 3, N 1784–1820';
const OTHER = 'Vymyšlov 9, O 1801–1850';
const FOLDER = 'Smyšlenka 3 N 1784-1820';

function waiting(): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [
        {
            id: 'T0412', what: 'Křest dítěte z čp. 12 ve Smyšlence, 1806 – ověřit rodiče', kind: 'web', section: 'web', group: smyslenka, at: minAgo(60),
            on: `Snímky 57–58 z knihy ${BOOK} a snímek 14 z knihy ${OTHER} k ručnímu uložení`,
            url: 'https://archiv-smyslenka.example/vymyslov/9', actions: ['answer', 'chat'],
            audit: { kinds: ['images-as-text', 'several-books', 'book-unknown'], fix: 'part', stamp: STAMP_412 },
        },
        {
            id: 'T0377', what: 'Zápis sňatku rodičů ve Smyšlence, 1798', kind: 'web', section: 'web', group: smyslenka, at: minAgo(120),
            on: `Snímky 31–32 z knihy ${BOOK}`, actions: ['answer', 'chat'],
            audit: { kinds: ['images-as-text'], fix: 'whole', stamp: STAMP_377 },
        },
    ];
    return items.map((w, i) => ({ order: i, ...w }));
}

function booksPart(): Record<string, unknown> {
    return {
        settings: { minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no', sameBookOwn: false, sameBookDefault: 'no' },
        list: [{
            id: 'B0003', title: 'Smyšlenka 3, N', years: '1784-1820', folder: FOLDER,
            archive: { id: 'R0003', name: smyslenka.name, url: smyslenka.url }, access: 'online-free',
            tasks: 4, waiting: 1, open: 3, parked: 0, onDisk: 0, download: 'none',
        }],
        more: 0,
    };
}

/** The research's preview of each task's fix (U2). */
function previewOf(id: string, stamp: string, book = BOOK): Record<string, unknown> {
    if (id === 'T0412') {
        return {
            task: 'T0412', at: NOW.toISOString(),
            findings: [{ kind: 'images-as-text' }, { kind: 'several-books', books: ['B0003'] }, { kind: 'book-unknown', unknown: [OTHER] }],
            fix: {
                can: 'part', stamp,
                changes: [
                    { op: 'wait-images', task: 'T0412', book: 'B0003', title: book, images: '57–58', folder: FOLDER },
                    { op: 'split', task: null, from: 'T0412', title: OTHER, images: '14', waits: 'text' },
                ],
                left: ['book-unknown'],
            },
            kept: null, fixed: null,
        };
    }
    return {
        task: id, at: NOW.toISOString(), findings: [{ kind: 'images-as-text' }],
        fix: { can: 'whole', stamp, changes: [{ op: 'wait-images', task: id, book: 'B0003', title: book, images: '31-32', folder: FOLDER }], left: [] },
        kept: null, fixed: null,
    };
}

type Next = 'ok' | 'woke' | 'changed' | 'busy' | 'locked' | 'disk';
interface FixBridge {
    bridge: FakeBridge;
    writes: [string, unknown][];
    reads: string[];
    /** The next fix's answer. */
    next: { fix: Next; preview: 'ok' | 'gone' | 'busy'; unfix: 'ok' | 'changed'; hold: Promise<void> | null; book: string };
}

async function researchTree(page: Page, opts: { width?: number; height?: number } = {}): Promise<FixBridge> {
    const width = opts.width ?? 1440;
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width, height: opts.height ?? (width > 640 ? 900 : 844) });
    await openResearch(page);
    const bridge = await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, waiting: waiting(), features: FEATURES, treeGed: researchGed(),
        books: { books: booksPart(), posts: [] },
    });
    const out: FixBridge = { bridge, writes: [], reads: [], next: { fix: 'ok', preview: 'ok', unfix: 'ok', hold: null, book: BOOK } };
    const fixedAside = new Map<string, Record<string, unknown>>();
    const find = (id: string) => (bridge.waiting ?? []).find(x => (x as { id: string }).id === id) as Record<string, unknown> | undefined;
    const reply = (route: Route, status: number, body: unknown) => route.fulfill({ status, headers: cors, body: JSON.stringify(body) });
    await page.route(`${BRIDGE}/waiting/*/fix*`, async (route: Route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
        out.reads.push(id);
        if (out.next.hold) await out.next.hold;
        const w = find(id);
        const audit = w?.audit as { stamp: string } | undefined;
        if (!w) return reply(route, 404, { error: 'not waiting', code: 'waiting.none' });
        if (out.next.preview === 'busy') return reply(route, 503, { error: 'busy', code: 'research.busy' });
        if (!audit || out.next.preview === 'gone') {
            delete w.audit;
            return reply(route, 409, { error: 'no finding', code: 'audit.none' });
        }
        return reply(route, 200, previewOf(id, audit.stamp, out.next.book));
    });
    await page.route(`${BRIDGE}/waiting/*`, async (route: Route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const id = new URL(req.url()).pathname.split('/').pop()!;
        const body = JSON.parse(req.postData() ?? '{}') as { do: string; expect?: string };
        out.writes.push([id, body]);
        const w = find(id);
        if (!w) return reply(route, 404, { error: 'not waiting', code: 'waiting.none' });
        if (body.do === 'fix') {
            const audit = w.audit as { stamp: string } | undefined;
            if (!audit) return reply(route, 409, { error: 'no finding', code: 'audit.none' });
            const next = out.next.fix;
            if (next === 'changed' || body.expect !== audit.stamp) return reply(route, 409, { error: 'changed', code: 'waiting.changed', id, at: '' });
            if (next === 'busy') return route.fulfill({ status: 503, headers: { ...cors, 'retry-after': '2' }, body: JSON.stringify({ error: 'busy', code: 'research.busy' }) });
            if (next === 'locked') return reply(route, 423, { error: 'locked', code: 'locked' });
            if (next === 'disk') return reply(route, 507, { error: 'disk full', code: 'disk.full' });
            fixedAside.set(id, { ...w });
            delete w.audit;
            Object.assign(w, { kind: 'images', section: 'images', book: 'B0003', actions: ['chat', 'folder'] });
            return reply(route, 200, { task: id, tasks: [id], woke: next === 'woke' ? [id] : [], head: '', parent: '' });
        }
        if (body.do === 'unfix') {
            if (out.next.unfix === 'changed') return reply(route, 409, { error: 'changed since', code: 'audit.changed', changed: [id] });
            const before = fixedAside.get(id);
            if (before) {
                for (const k of Object.keys(w)) delete w[k];
                Object.assign(w, before);
            }
            fixedAside.delete(id);
            return reply(route, 200, { task: id, tasks: [id], woke: [], head: '', parent: '' });
        }
        return reply(route, 400, { error: 'bad body', code: 'waiting.bad-body' });
    });
    await poll(page);
    return out;
}

const ov = (page: Page) => page.locator('#research-overview');
const sec = (page: Page) => ov(page).locator('#ov-sec-waiting');
const item = (page: Page, id: string) => sec(page).locator(`.research-overview__waiting-item[data-id="${id}"]`);
const detail = (page: Page, id: string) => item(page, id).locator('.research-overview__waiting-detail');
const finding = (page: Page, id: string) => item(page, id).locator('.waiting-audit');
const preview = (page: Page, id: string) => item(page, id).locator('.waiting-audit__preview');
const fixBtn = (page: Page, id: string) => finding(page, id).locator('[data-action="audit-fix"]');
const toast = (page: Page, kind: string) => page.locator(`.toast[data-kind="${kind}"]`);
const fixes = (b: FixBridge) => b.writes.filter(([, body]) => (body as { do: string }).do === 'fix');

async function openOverview(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.openResearchOverview());
    await expect(ov(page)).toBeVisible();
    await expect(sec(page)).toBeVisible();
}

async function openItem(page: Page, id: string): Promise<void> {
    const folded = sec(page).locator('.research-overview__waiting-group[aria-expanded="false"]');
    while (await folded.count() > 0) await folded.first().click();
    await expect(item(page, id)).toBeVisible();
    if (await detail(page, id).count() === 0) await item(page, id).locator('.research-overview__waiting-row').click();
    await expect(detail(page, id)).toBeVisible();
}

const CHANGE_412 = [
    `This task will wait for images 57–58 of the book ${BOOK}Folder ${FOLDER}`,
    `New task for image 14 of the book ${OTHER}the book is not in the research, the new task keeps waiting as text`,
];
const NOTE = 'The fix changes only what the task waits for and can be undone.';

test.describe('Fix at a task\'s finding', () => {
    test('the preview: loading in the row, then what changes and what remains; Escape and Cancel close it; one at a time', async ({ page }) => {
        const b = await researchTree(page);
        await openOverview(page);
        await openItem(page, 'T0412');
        let release!: () => void;
        b.next.hold = new Promise<void>(r => { release = r; });
        await fixBtn(page, 'T0412').click();
        const loading = finding(page, 'T0412').locator('.waiting-audit__loading');
        await expect(loading).toHaveAttribute('role', 'status');
        await expect(loading).toHaveText('Loading preview…');
        await expect(loading.locator('.waiting-audit__spin')).toHaveCount(1);
        await expect(preview(page, 'T0412')).toHaveCount(0);
        release();
        b.next.hold = null;

        const p = preview(page, 'T0412');
        await expect(p).toBeVisible();
        await expect(finding(page, 'T0412').locator('.waiting-audit__actions')).toHaveCount(0);
        const title = p.locator('.waiting-audit__preview-title');
        await expect(title).toHaveText('What changes');
        await expect(title).toBeFocused();
        await expect(p).toHaveAttribute('aria-labelledby', (await title.getAttribute('id'))!);
        await expect(p.locator('.waiting-audit__chg-list').first().locator('.waiting-audit__chg-body')).toHaveText(CHANGE_412);
        await expect(p.locator('.waiting-audit__glyph')).toHaveText(['→', '+', '–']);
        await expect(p.locator('.waiting-audit__tag')).toHaveText('New task');
        await expect(p.locator('.waiting-audit__remains-title')).toHaveText('What remains');
        await expect(p.locator('.waiting-audit__remains .waiting-audit__chg-text').first()).toHaveText(`The book ${OTHER} is missing from the research – the agent adds it.`);
        const chat = p.locator('.waiting-audit__remains [data-action="chat"]');
        await expect(chat).toHaveCount(1);
        await expect(chat.locator('.research-ai-badge')).toHaveCount(1);
        await expect(chat.locator('.research-open-mark')).toHaveCount(1);
        await expect(p.locator('.waiting-audit__note')).toHaveText(NOTE);
        await expect(p.locator('.waiting-audit__foot button')).toHaveText(['Cancel', 'Fix']);
        // The only green: Fix.
        const greens = await p.evaluate(sec => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = 'var(--primary)';
            document.body.appendChild(probe);
            const green = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return [...sec.querySelectorAll<HTMLElement>('*')].filter(e => getComputedStyle(e).backgroundColor === green).map(e => e.dataset.action ?? e.className);
        });
        expect(greens).toEqual(['audit-confirm']);

        // A click elsewhere leaves it open; Escape is Cancel (the overview stays), the focus back on Fix.
        await item(page, 'T0412').locator('.research-overview__waiting-on-box').click();
        await expect(p).toBeVisible();
        await title.focus();
        await page.keyboard.press('Escape');
        await expect(p).toHaveCount(0);
        await expect(ov(page)).toBeVisible();
        await expect(fixBtn(page, 'T0412')).toBeFocused();

        // Again, then T0377's: one preview at a time; T0377's has only what changes.
        await fixBtn(page, 'T0412').click();
        await expect(p).toBeVisible();
        await openItem(page, 'T0377');
        await fixBtn(page, 'T0377').click();
        const p377 = preview(page, 'T0377');
        await expect(p377).toBeVisible();
        await expect(preview(page, 'T0412')).toHaveCount(0);
        await expect(p377.locator('.waiting-audit__chg-body')).toHaveText([`This task will wait for images 31–32 of the book ${BOOK}Folder ${FOLDER}`]);
        await expect(p377.locator('.waiting-audit__remains-title')).toHaveCount(0);
        await p377.getByRole('button', { name: 'Cancel' }).click();
        await expect(p377).toHaveCount(0);
        await expect(fixBtn(page, 'T0377')).toBeFocused();
        expect(b.reads).toEqual(['T0412', 'T0412', 'T0377']);
    });

    test('Fix writes once with the preview\'s stamp; the list read again, a toast with Undo; Undo writes unfix', async ({ page }) => {
        const b = await researchTree(page);
        await openOverview(page);
        await openItem(page, 'T0377');
        await fixBtn(page, 'T0377').click();
        const confirm = preview(page, 'T0377').locator('[data-action="audit-confirm"]');
        await expect(confirm).toBeEnabled();
        await confirm.dblclick();
        await expect.poll(() => fixes(b)).toEqual([['T0377', { do: 'fix', expect: STAMP_377 }]]);
        const t = toast(page, 'waiting-audit-fixed');
        await expect(t).toContainText('Fixed');
        await expect(t.locator('.toast-action')).toHaveText('Undo');
        // The research moved it; the item where it stands now, no finding, its title focused.
        await expect(finding(page, 'T0377')).toHaveCount(0);
        await expect(item(page, 'T0377').locator('.research-overview__waiting-what .waiting-audit-mark')).toHaveCount(0);
        await expect(item(page, 'T0377').locator('.research-overview__waiting-row')).toBeFocused();
        expect(fixes(b)).toHaveLength(1);

        await t.locator('.toast-action').click();
        await expect.poll(() => b.writes.at(-1)).toEqual(['T0377', { do: 'unfix' }]);
        await expect(toast(page, 'waiting-audit-undone')).toContainText('Undone – the task waits as before.');
        await expect(item(page, 'T0377').locator('.research-overview__waiting-what .waiting-audit-mark')).toHaveCount(1);
    });

    test('rows that just moved take no click a moment (109 U4): Leave as is of another task right after a Fix or its Undo writes nothing', async ({ page }) => {
        const b = await researchTree(page);
        await openOverview(page);
        await openItem(page, 'T0377');
        await fixBtn(page, 'T0377').click();
        const confirm = preview(page, 'T0377').locator('[data-action="audit-confirm"]');
        await expect(confirm).toBeEnabled();
        await confirm.click();
        // The moment the fixed row moves, a click meant for it lands on the other task's Leave as is.
        const strayClick = () => page.evaluate(async () => {
            const q = (sel: string) => document.querySelector<HTMLElement>(sel);
            const at = performance.now();
            while (performance.now() - at < 5000) {
                const keep = q('#research-overview .research-overview__waiting-item[data-id="T0412"] [data-action="audit-keep"]');
                if (keep) { keep.click(); return true; }
                q('#research-overview .research-overview__waiting-item[data-id="T0412"] .research-overview__waiting-row')?.click();
                await new Promise(r => requestAnimationFrame(r));
            }
            return false;
        });
        await expect(toast(page, 'waiting-audit-fixed')).toBeVisible();
        expect(await strayClick()).toBe(true);
        await page.waitForTimeout(600);
        expect(b.writes.filter(([, body]) => (body as { do: string }).do === 'keep')).toEqual([]);
        // The Undo moves the rows again: held once more.
        await toast(page, 'waiting-audit-fixed').locator('.toast-action').click();
        await expect.poll(() => b.writes.at(-1)).toEqual(['T0377', { do: 'unfix' }]);
        await expect(toast(page, 'waiting-audit-undone')).toBeVisible();
        expect(await strayClick()).toBe(true);
        await page.waitForTimeout(600);
        expect(b.writes.filter(([, body]) => (body as { do: string }).do === 'keep')).toEqual([]);
        // Once the rows stand still, Leave as is writes.
        await openItem(page, 'T0412');
        await finding(page, 'T0412').locator('[data-action="audit-keep"]').click();
        await expect.poll(() => b.writes.filter(([, body]) => (body as { do: string }).do === 'keep').map(([id]) => id)).toEqual(['T0412']);
    });

    test('a fix that woke the task says so; an Undo after a change cannot undo', async ({ page }) => {
        const b = await researchTree(page);
        await openOverview(page);
        await openItem(page, 'T0412');
        b.next.fix = 'woke';
        b.next.unfix = 'changed';
        await fixBtn(page, 'T0412').click();
        await preview(page, 'T0412').locator('[data-action="audit-confirm"]').click();
        const t = toast(page, 'waiting-audit-fixed');
        await expect(t).toContainText('Fixed – the images are already saved, the task continues.');
        await t.locator('.toast-action').click();
        await expect(page.locator('.toast').filter({ hasText: 'Undo is no longer possible' })).toHaveCount(1);
    });

    test('refused: changed meanwhile (Reload), busy (Fix stays), locked and a full disk (Fix off); quiet, no alarm colour', async ({ page }) => {
        const b = await researchTree(page);
        await openOverview(page);
        await openItem(page, 'T0377');
        await fixBtn(page, 'T0377').click();
        const p = preview(page, 'T0377');
        const confirm = p.locator('[data-action="audit-confirm"]');

        b.next.fix = 'changed';
        await confirm.click();
        const top = p.locator('.waiting-audit__err--top');
        await expect(top).toHaveAttribute('role', 'alert');
        await expect(top).toContainText('The task has changed meanwhile. The preview does not match the current state.');
        await expect(confirm).toBeDisabled();
        const reload = top.getByRole('button', { name: 'Reload' });
        await expect(reload).toBeFocused();
        // Reload: the preview read again, as it is now.
        b.next.fix = 'busy';
        b.next.book = 'Smyšlenka 3, N 1784–1820 (opravený název)';
        await reload.click();
        await expect(top).toHaveCount(0);
        await expect(p.locator('.waiting-audit__chg-body')).toContainText(['(opravený název)']);
        await expect(confirm).toBeEnabled();
        expect(b.reads).toEqual(['T0377', 'T0377']);

        await confirm.click();
        const err = p.locator('.waiting-audit__foot .waiting-audit__err');
        await expect(err).toHaveText('The research is writing right now – another attempt is possible shortly.');
        await expect(err).toHaveAttribute('role', 'alert');
        await expect(p.locator('.waiting-audit__note')).toHaveCount(0);
        await expect(confirm).toBeEnabled();
        const look = await err.evaluate(el => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = 'var(--surface-2)';
            probe.style.color = 'var(--danger)';
            document.body.appendChild(probe);
            const want = getComputedStyle(probe);
            const r = { bg: getComputedStyle(el).backgroundColor === want.backgroundColor, danger: getComputedStyle(el).color === want.color };
            probe.remove();
            return r;
        });
        expect(look).toEqual({ bg: true, danger: false });

        b.next.fix = 'locked';
        await confirm.click();
        await expect(err).toHaveText('The research is locked – the fix cannot be written now.');
        await expect(confirm).toBeDisabled();
        await expect(p.getByRole('button', { name: 'Cancel' })).toBeFocused();

        // A full disk: Cancel, Fix again.
        await p.getByRole('button', { name: 'Cancel' }).click();
        b.next.fix = 'disk';
        await fixBtn(page, 'T0377').click();
        await p.locator('[data-action="audit-confirm"]').click();
        await expect(p.locator('.waiting-audit__foot .waiting-audit__err')).toHaveText('No space left on the research disk – the fix was not written.');
        await expect(p.locator('[data-action="audit-confirm"]')).toBeDisabled();
        expect(await page.locator('.toast').filter({ hasText: /locked|disk|writing/ }).count()).toBe(0);
    });

    test('a finding gone: a toast, the item plain; a preview the research is too busy to give: said under the row', async ({ page }) => {
        const b = await researchTree(page);
        await openOverview(page);
        await openItem(page, 'T0377');
        b.next.preview = 'busy';
        await fixBtn(page, 'T0377').click();
        const msg = finding(page, 'T0377').locator('.waiting-audit__msg--err');
        await expect(msg).toHaveText('The research is writing right now – another attempt is possible shortly.');
        await expect(msg).toHaveAttribute('role', 'alert');
        await expect(fixBtn(page, 'T0377')).toBeFocused();

        b.next.preview = 'gone';
        await fixBtn(page, 'T0377').click();
        await expect(toast(page, 'waiting-audit-gone')).toContainText('The finding no longer applies – the task is recorded correctly.');
        await expect(finding(page, 'T0377')).toHaveCount(0);
        await expect(item(page, 'T0377').locator('.research-overview__waiting-what .waiting-audit-mark')).toHaveCount(0);
        await expect(detail(page, 'T0377').locator('[data-action="chat"]')).toHaveCount(1);
    });

    for (const size of [{ width: 390, height: 844, name: 'a phone' }, { width: 844, height: 390, name: 'a phone held sideways' }]) {
        test(`${size.name}: the preview as a bottom sheet, Cancel and Fix 44 px, nothing wider than the screen`, async ({ page }) => {
            const b = await researchTree(page, size);
            // The sheet measured where it stays, not while it slides in.
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await openOverview(page);
            await openItem(page, 'T0412');
            await fixBtn(page, 'T0412').click();
            const sheet = page.locator('#waiting-audit-sheet .waiting-audit-sheet');
            await expect(sheet).toBeVisible();
            await expect(page.locator('#waiting-audit-sheet')).toHaveClass(/active/);
            await expect(sheet).toHaveAttribute('role', 'dialog');
            await expect(preview(page, 'T0412')).toHaveCount(0);
            await expect(sheet.locator('.waiting-audit__preview-title')).toBeFocused();
            await expect(sheet.locator('.waiting-audit-sheet__task')).toHaveText('Křest dítěte z čp. 12 ve Smyšlence, 1806 – ověřit rodiče');
            await expect(sheet.locator('.waiting-audit__chg-list').first().locator('.waiting-audit__chg-body')).toHaveText(CHANGE_412);
            // No Discuss in the sheet (as the row there).
            await expect(sheet.locator('[data-action="chat"]')).toHaveCount(0);
            const buttons = sheet.locator('.waiting-audit-sheet__foot button');
            await expect(buttons).toHaveText(['Cancel', 'Fix']);
            for (const btn of await buttons.all()) expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            const box = (await sheet.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
            if (size.width > 640) expect(box.width).toBeLessThanOrEqual(561);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
            const over = await sheet.evaluate(s => [...s.querySelectorAll<HTMLElement>('*')]
                .filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'auto')
                .map(e => e.className || e.tagName));
            expect(over).toEqual([]);

            // The backdrop tapped: Cancel; then Fix in the sheet writes.
            await page.mouse.click(size.width / 2, 4);
            await expect(sheet).toHaveCount(0);
            await fixBtn(page, 'T0412').click();
            await expect(sheet).toBeVisible();
            await sheet.getByRole('button', { name: 'Fix' }).click();
            await expect.poll(() => fixes(b)).toEqual([['T0412', { do: 'fix', expect: STAMP_412 }]]);
            await expect(sheet).toHaveCount(0);
            await expect(toast(page, 'waiting-audit-fixed')).toBeVisible();
        });
    }
});

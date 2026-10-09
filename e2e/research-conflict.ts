import { expect, Locator, Page, Route } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { BRIDGE, UUID, HEAD, NEW_HEAD, FakeBridge, fakeBridge, dropFile, poll } from './research-bridge.js';

/**
 * A research tree whose conflicts the app can decide by a side, and its
 * bridge answering POST /conflict/<X…> by page.route — shared by the
 * research-conflict-* specs. Josef and Anna, their son Jan with a conflict of
 * his edit about his birth date (X0007); optionally a couple's conflict about
 * the wedding (X0009), a conflict of the sources about his death (X0010) and
 * conflicts about the name, its titles or the sex. Invented data only.
 */

const cors = { 'access-control-allow-origin': '*' };
export const LINKS = ['send', 'open', 'live', 'app', 'setup', 'conflict'];

export interface Version {
    head?: string;
    /** Jan's birth date in that version, and how his conflict about it stands. */
    janBirth?: string;
    janState?: 'open' | 'decided';
    janDecision?: string;
    /** Jan's death date (another value of that version). */
    janDeath?: string;
    /** Jan's name in that version (GEDCOM), his titles and his sex. */
    janName?: string;
    janTitles?: { npfx?: string; nsfx?: string };
    janSex?: 'M' | 'F' | 'U';
    /** Jan's birth conflict as one of the sources (no side said): never decided here. */
    sources?: boolean;
    /** Jan's birth conflict marked decidable but without the sides said: shown as today. */
    takeNoSides?: boolean;
    /** No birth conflict at all. */
    noBirthConflict?: boolean;
    /** A conflict of two sources about Jan's death (X0010), besides. */
    sourcesDeath?: boolean;
    /** More conflict records of Jan (e.g. conflictOf('NAME', …)). */
    janConflicts?: string[];
    /** The couple's wedding date, and its conflict (shown at both partners) — none without it. */
    wedding?: string;
    familyConflict?: 'open' | 'decided';
    /** The links the research announces (default: with `conflict`). */
    links?: string[];
    /** The research is an archive (its file says so). */
    archive?: boolean;
}

/**
 * A conflict of Jan's edit decidable by a side: the research's value (from its register) and the app's,
 * each with its side; `raw`: the sex's machine values. An empty value (deleted on that side) is a bare `2 VAL`.
 */
export function conflictOf(id: string, fact: string, research: string, user: string, raw?: { research: string; user: string }, state: 'open' | 'decided' = 'open'): string[] {
    const val = (v: string) => v ? `2 VAL ${v}` : '2 VAL';
    return [
        `1 _STROM_CONFLICT ${id}`, `2 TYPE ${fact}`, `2 STAT ${state}`, '2 _STROM_TAKE Y',
        val(research), '3 SOUR @S0001@', '3 _STROM_SIDE research', ...(raw ? [`3 _STROM_RAW ${raw.research}`] : []),
        val(user), '3 _STROM_SIDE user', ...(raw ? [`3 _STROM_RAW ${raw.user}`] : []),
    ];
}

/** The research's file in that version. */
export function conflictGed(v: Version = {}): string {
    const state = v.janState ?? 'open';
    const birth = v.noBirthConflict ? []
        : v.sources ? ['1 _STROM_CONFLICT X0007', '2 TYPE BIRT', `2 STAT ${state}`, '2 VAL 3 FEB 1865', '3 SOUR @S0001@', '2 VAL 1865']
        : v.takeNoSides ? ['1 _STROM_CONFLICT X0007', '2 TYPE BIRT', `2 STAT ${state}`, '2 _STROM_TAKE Y', '2 VAL 3 FEB 1865', '3 SOUR @S0001@', '2 VAL 1865']
        : [...conflictOf('X0007', 'BIRT', '3 FEB 1865', '1865', undefined, state),
            ...(state === 'decided' ? [`2 DECI ${v.janDecision ?? '1865'}`] : [])];
    const family = v.familyConflict ? [
        ...conflictOf('X0009', 'MARR', '3 FEB 1875', '1876', undefined, v.familyConflict),
        ...(v.familyConflict === 'decided' ? ['2 DECI 1876'] : []),
    ] : [];
    const titles = v.janTitles ? [...(v.janTitles.npfx ? [`2 NPFX ${v.janTitles.npfx}`] : []), ...(v.janTitles.nsfx ? [`2 NSFX ${v.janTitles.nsfx}`] : [])] : [];
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 9 OCT 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${v.head ?? HEAD}`, `1 _STROM_LINKS ${(v.links ?? LINKS).join(' ')}`,
        ...(v.archive ? ['1 _STROM_MODE archive'] : []), '1 CHAR UTF-8', '1 NOTE Víškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Víšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@', ...family,
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@', ...family,
        '0 @P0003@ INDI', `1 NAME ${v.janName ?? 'Jan /Víšek/'}`, ...titles, `1 SEX ${v.janSex ?? 'M'}`, '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
        '1 BIRT', `2 DATE ${v.janBirth ?? '1865'}`, '2 PLAC Chlumy',
        '1 DEAT', `2 DATE ${v.janDeath ?? '1932'}`,
        ...birth,
        ...(v.sourcesDeath ? ['1 _STROM_CONFLICT X0010', '2 TYPE DEAT', '2 STAT open', '2 VAL 1931', '3 SOUR @S0001@', '2 VAL 1932'] : []),
        ...(v.janConflicts ?? []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        ...(v.wedding ? ['1 MARR', `2 DATE ${v.wedding}`] : []),
        '0 @S0001@ SOUR', '1 TITL Oddací matrika Čáslav', '1 PAGE fol. 41', '1 REFN S0001', '1 TEXT Josef Víšek a Anna', '1 _STROM_READ research',
        '0 TRLR',
    ].join('\n');
}

/**
 * The bridge's answers to POST /conflict/<X…>: queued per test (none queued: a 500); `then` makes the
 * research's new version as it answers; `abort`: no answer; `hold` keeps the next answer until released.
 */
export interface Reply { status: number; body?: unknown; then?: Version; abort?: boolean }
export interface DecideRoute { asks: { id: string; body: unknown }[]; replies: Reply[]; hold: Promise<void> | null }

export async function decideRoute(page: Page, bridge: FakeBridge | null): Promise<DecideRoute> {
    const d: DecideRoute = { asks: [], replies: [], hold: null };
    await page.route(`${BRIDGE}/conflict/**`, async (route: Route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': '*' } });
        d.asks.push({ id: decodeURIComponent(new URL(req.url()).pathname.split('/').pop() ?? ''), body: JSON.parse(req.postData() ?? 'null') });
        if (d.hold) await d.hold;
        const reply = d.replies.shift() ?? { status: 500, body: { error: 'no reply queued' } };
        if (reply.abort) return route.abort('connectionrefused');
        if (reply.then && bridge) {
            bridge.head = reply.then.head ?? NEW_HEAD;
            bridge.treeGed = conflictGed(reply.then);
        }
        return route.fulfill({ status: reply.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(reply.body ?? {}) });
    });
    return d;
}

export interface SetupOpts {
    /** The research's file opened (default: Jan's birth conflict). */
    opened?: Version;
    /** What its bridge serves (default: the same version). */
    serving?: Version;
    /** What its bridge says it can do (default: conflict.decide; none: decided by a link into the research). */
    features?: string[];
    /** false: the bridge does not answer here (with no `conflict` link announced: not on this device). */
    bridge?: boolean;
    /** Its `accepts` (default: a research with an agent; `{ mode: 'archive', … }`: an archive). */
    accepts?: Record<string, unknown>;
    /** The page's clock installed (the decided card's 6 s, the light's 1.5 s). */
    clock?: boolean;
}

export const ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true };
export const ARCHIVE_ACCEPTS = { mode: 'archive', sync: { auto: 'mirror' }, sources: true, verified: true };

/**
 * The research opened from its file, its bridge remembered and asked once; sending by hand without the
 * one-time questions; opening links in the system recorded (UI.__links).
 */
export async function setupConflict(page: Page, opts: SetupOpts = {}): Promise<{ bridge: FakeBridge; decide: DecideRoute; treeId: string }> {
    const opened = opts.opened ?? {};
    if (opts.clock) await page.clock.install();
    await openApp(page);
    await page.evaluate(() => {
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
    });
    await dropFile(page, 'tree-strom.ged', conflictGed(opened));
    await expect(card(page, 'Jan')).toBeVisible();
    const accepts = opts.accepts ?? ACCEPTS;
    const treeId = await page.evaluate(({ uuid, base, accepts }) => {
        localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, accepts }));
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { sendMode: 'manual' });
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify({ ...JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}'), modeAsked: true, skipPreview: true }));
        return id;
    }, { uuid: UUID, base: BRIDGE, accepts });
    if (opts.bridge === false) return { bridge: null as unknown as FakeBridge, decide: await decideRoute(page, null), treeId };
    const serving = opts.serving ?? opened;
    const bridge = await fakeBridge(page, {
        treeGed: conflictGed({ ...serving, links: serving.links ?? opened.links, archive: serving.archive ?? opened.archive }),
        head: serving.head ?? opened.head ?? HEAD, links: opened.links ?? LINKS, features: opts.features ?? ['conflict.decide'],
        ...(opts.accepts ? { accepts: opts.accepts } : {}),
    });
    await poll(page);
    const decide = await decideRoute(page, bridge);
    return { bridge, decide, treeId };
}

export const KEEP_200: Reply = { status: 200, body: { decided: 'X0007', take: 'user', head: NEW_HEAD }, then: { head: NEW_HEAD, janState: 'decided' } };
export const TAKE_200 = (then: Version): Reply => ({ status: 200, body: { decided: 'X0007', take: 'research', head: NEW_HEAD }, then: { head: NEW_HEAD, janState: 'decided', ...then } });

/** "What the research knows" of a person, open. */
export async function openKnows(page: Page, firstName = 'Jan'): Promise<void> {
    await page.evaluate((name) => {
        const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === name)!;
        window.Strom.UI.runPersonMenuAction(p.id, 'research-knows');
    }, firstName);
    await expect(page.locator('#person-research-modal')).toBeVisible();
}

/** The edit form of a person, open. */
export async function openEdit(page: Page, firstName = 'Jan'): Promise<void> {
    await page.evaluate((name) => {
        const p = window.Strom.DataManager.getAllPersons().find(x => x.firstName === name)!;
        window.Strom.UI.runPersonMenuAction(p.id, 'edit');
    }, firstName);
    await expect(page.locator('#person-modal')).toBeVisible();
}

/** An edit of another person: the tree is no longer what the research had (nothing loads quietly after Keep). */
export const editJosef = (page: Page) => page.evaluate(() => {
    const dm = window.Strom.DataManager;
    dm.updatePerson(dm.getAllPersons().find(p => p.firstName === 'Josef')!.id, { birthPlace: 'Praha' });
});

export const janBirth = (page: Page) => page.evaluate(() => window.Strom.DataManager.getAllPersons().find(p => p.firstName === 'Jan')!.birthDate);

export const cardOf = (page: Page, id = 'X0007') => page.locator(`#person-research-modal [data-conflict-card="${id}"]`);
export const side = (page: Page, which: 'user' | 'research', id = 'X0007') => cardOf(page, id).locator(`.prc-side[data-side="${which}"]`);
/** The edit form's "conflict ›" at a field's label (`field`: the label's input; the sex: gender-segment). */
export const tag = (page: Page, field = 'input-birthdate') => page.locator(`#person-modal .pm-conflict-tag[data-field="${field}"]`);
export const panel = (page: Page) => page.locator('#prc-panel');
export const choice = (page: Page, which: 'user' | 'research') => panel(page).locator(`.prc-panel-row[data-side="${which}"] .prc-panel-choice`);
export const activeId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');

/** The tree as sent and written, its write left this conflict (X0007); the research moved on since. */
export async function writtenWithConflict(page: Page, bridge: FakeBridge, treeId: string, v: Version = {}): Promise<void> {
    await editJosef(page);
    await page.evaluate(id => {
        const tm = window.Strom.TreeManager;
        const link = tm.getTreeMetadata(id)!.research!;
        const fp = window.Strom.UI.researchSyncFingerprints(id, link).current;
        const at = new Date().toISOString();
        tm.patchResearchLink(id, { sent: { fingerprint: fp, at, closedAt: at, changes: 1, head: link.head ?? '', state: 'written', conflicts: 1, intake: 'R1' } });
        const st = JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}');
        st.lastWritten = { at, changes: 1, conflicts: 1, conflictIds: ['X0007'], fingerprint: fp, intake: 'R1' };
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify(st));
    }, treeId);
    bridge.head = 'cccc2222dddd';
    bridge.treeGed = conflictGed({ ...v, head: 'cccc2222dddd', janDeath: '1933' });
    await poll(page);
    expect(await page.evaluate(() => window.Strom.UI.currentResearchSyncState().kind)).toBe('writtenConflicts');
}

/**
 * The text under `root` that is harder to read than WCAG AA allows (4.5:1 for
 * its size here), each with its contrast: every element with text of its own,
 * against the background it shows on (the layers under it composed). A
 * disabled control is exempt, as in WCAG.
 */
export function lowContrast(locator: Locator, min = 4.5): Promise<string[]> {
    return locator.evaluate((root, min) => {
        const parse = (s: string) => {
            const n = (s.match(/[\d.]+/g) ?? []).map(Number);
            return n.length === 3 ? [...n, 1] : n;
        };
        const lum = (c: number[]) => {
            const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
        };
        const under = (el: Element | null): number[] => {
            const layers: number[][] = [];
            for (; el; el = el.parentElement) {
                const c = parse(getComputedStyle(el).backgroundColor);
                if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
            }
            let base = [255, 255, 255];
            for (const l of layers.reverse()) base = base.map((b, i) => b * (1 - l[3]) + l[i] * l[3]);
            return base;
        };
        const out: string[] = [];
        for (const el of [root, ...root.querySelectorAll('*')]) {
            if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim())) continue;
            if ((el as HTMLButtonElement).disabled || el.closest('[aria-hidden="true"]')) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const fg = parse(cs.color);
            const bg = under(el);
            const ink = fg[3] < 1 ? bg.map((b, i) => b * (1 - fg[3]) + fg[i] * fg[3]) : fg;
            const a = lum(ink), b = lum(bg);
            const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            if (ratio < min) out.push(`${ratio.toFixed(2)} ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
        }
        return out;
    }, min);
}

/** A CSS custom property as the browser resolves it now (as a background or a text colour). */
export function token(page: Page, name: string, as: 'background' | 'color' = 'background'): Promise<string> {
    return page.evaluate(({ n, as }) => {
        const probe = document.createElement('span');
        if (as === 'background') probe.style.background = `var(${n})`;
        else probe.style.color = `var(${n})`;
        document.body.appendChild(probe);
        const cs = getComputedStyle(probe);
        const v = as === 'background' ? cs.backgroundColor : cs.color;
        probe.remove();
        return v;
    }, { n: name, as });
}

/**
 * The boxes of every element a locator matches, read in one go: a card drawn
 * again between two separate reads (a version read meanwhile, the status
 * poll) can neither detach one of them nor mix two layouts.
 */
export function boxes(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }[]> {
    return locator.evaluateAll(els => els.map(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }));
}

/** The boxes of the first element of each selector under `root` (`:scope`: the root), read in one go (as boxes). */
export function partBoxes(root: Locator, selectors: string[]): Promise<{ x: number; y: number; width: number; height: number }[]> {
    return root.evaluate((el, sels) => sels.map(sel => {
        const target = sel === ':scope' ? el : el.querySelector(sel);
        if (!target) throw new Error(`no ${sel}`);
        const r = target.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }), selectors);
}

/** The boxes of the first element of each selector in the page, read in one go (as boxes). */
export function pageBoxes(page: Page, selectors: string[]): Promise<{ x: number; y: number; width: number; height: number }[]> {
    return page.evaluate(sels => sels.map(sel => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`no ${sel}`);
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    }), selectors);
}

/**
 * What does not fit under `root` (none: everything fits): text reaching past
 * the root's sides or the window's, or cut off by a box that clips it (a word
 * too long for its button), and a control reaching past the root's sides.
 * Intended overhangs (a close button's negative margin into the padding, a
 * touch area drawn by ::after) are not text and stay inside the root.
 */
export function overflowing(locator: Locator): Promise<string[]> {
    return locator.evaluate(root => {
        const box = root.getBoundingClientRect();
        const left = Math.max(box.left, 0) - 0.5;
        const right = Math.min(box.right, window.innerWidth) + 0.5;
        const out: string[] = [];
        const name = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
        if (box.left < -0.5 || box.right > window.innerWidth + 0.5) out.push(`root ${name(root)} ${box.left}–${box.right} of ${window.innerWidth}`);
        const shown = (el: Element) => {
            const cs = getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
        };
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const el = node.parentElement!;
            if (!node.textContent!.trim() || !shown(el)) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const r of range.getClientRects()) {
                if (r.width === 0) continue;
                if (r.left < left || r.right > right) out.push(`text past the edge ${name(el)} ${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(left)}–${Math.round(right)}`);
                // Cut by a box that clips (overflow other than visible) between the text and the root.
                for (let clip: Element | null = el; clip && clip !== root.parentElement; clip = clip.parentElement) {
                    if (getComputedStyle(clip).overflowX === 'visible') continue;
                    const c = clip.getBoundingClientRect();
                    if (r.left < c.left - 0.5 || r.right > c.right + 0.5) out.push(`text cut ${name(el)} by ${name(clip)}`);
                }
            }
        }
        for (const el of root.querySelectorAll('button, a, input, select, [role="button"]')) {
            if (!shown(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.left < left || r.right > right) out.push(`control past the edge ${name(el)} ${Math.round(r.left)}–${Math.round(r.right)}`);
        }
        return out;
    });
}

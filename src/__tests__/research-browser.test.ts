import { describe, it, expect, afterEach } from 'vitest';
import { sanitizeBrowser, sanitizeLiveStatus, BROWSER_STATE_FEATURE, type BrowserInfo, type LiveWaiting } from '../research-link.js';
import { browserRow, browserNote, browserGroupNote, browserArchiveName, browserArchiveOf, shortAgentName } from '../research-browser.js';
import { strings, setLanguage } from '../strings.js';

/** The agent's browser (spec 048 §11): what the bridge says, the Browser row and the note at images waiting. */

const FEATURES = [BROWSER_STATE_FEATURE, 'tree.state', 'waiting.groups'];
const STORE = 'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn';

function status(browser: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { tree: { id: 'x', name: 'Novákovi', state: 'research' }, features: FEATURES, browser, ...extra };
}

describe('sanitizeBrowser', () => {
    it('reads the state, the store page and the archives', () => {
        const b = sanitizeBrowser(status({ state: 'no-extension', url: STORE, archives: [{ host: 'Digi.Example.cz', title: 'Zemský archiv (Digitální archiv)', permitted: false }] }));
        expect(b).toEqual({ state: 'no-extension', url: STORE, archives: [{ host: 'digi.example.cz', title: 'Zemský archiv (Digitální archiv)', permitted: false }] });
    });

    it('is null without the feature, for an archive, for an unknown state or without a browser', () => {
        expect(sanitizeBrowser({ ...status({ state: 'ready', archives: [] }), features: ['tree.state'] })).toBeNull();
        expect(sanitizeBrowser(status({ state: 'ready', archives: [] }, { tree: { id: 'x', state: 'archive' } }))).toBeNull();
        expect(sanitizeBrowser(status({ state: 'connected', archives: [] }))).toBeNull();
        expect(sanitizeBrowser(status(undefined))).toBeNull();
        expect(sanitizeBrowser(null)).toBeNull();
        expect(sanitizeBrowser('ready')).toBeNull();
    });

    it('keeps the url only as an https page of chromewebstore.google.com', () => {
        for (const url of ['http://chromewebstore.google.com/detail/x', 'https://evil.example/detail/x', 'https://chromewebstore.google.com.evil.example/x',
            'javascript:alert(1)', 'https://user@chromewebstore.google.com/x', 42]) {
            expect(sanitizeBrowser(status({ state: 'no-extension', url, archives: [] }))?.url).toBeUndefined();
        }
        expect(sanitizeBrowser(status({ state: 'no-extension', url: STORE, archives: [] }))?.url).toBe(STORE);
    });

    it('keeps at most 20 archives, drops a bad host, caps a title at 120 characters, permitted only when true', () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ host: `a${i}.example.org`, title: 'x', permitted: true }));
        expect(sanitizeBrowser(status({ state: 'ready', archives: many }))!.archives).toHaveLength(20);
        const b = sanitizeBrowser(status({ state: 'ready', archives: [
            { host: 'https://bad.example/x', title: 'bad', permitted: true },
            { host: 'bad host', permitted: true },
            { host: 'ok.example.org', title: 'T'.repeat(300), permitted: 'yes' },
            'ok2.example.org',
        ] }))!;
        expect(b.archives).toHaveLength(1);
        expect(b.archives[0].host).toBe('ok.example.org');
        expect(b.archives[0].title!.length).toBe(120);
        expect(b.archives[0].permitted).toBe(false);
    });

    it('goes into the live status with the agent name; an old bridge has neither browser', () => {
        const st = sanitizeLiveStatus(status({ state: 'ready', archives: [] }, { agent: { id: 'claude', name: 'Claude Code' } }))!;
        expect(st.browser).toEqual({ state: 'ready', archives: [] });
        expect(st.agentName).toBe('Claude Code');
        const old = sanitizeLiveStatus({ tree: { id: 'x' }, features: ['tree.state'], browser: { state: 'ready', archives: [] }, agent: 'Codex' })!;
        expect(old.browser).toBeUndefined();
        expect(old.agentName).toBe('Codex');
        expect('browser' in sanitizeLiveStatus({ tree: { id: 'x' } })!).toBe(false);
    });
});

const ARCH = (host: string, permitted: boolean, title?: string) => ({ host, permitted, ...(title ? { title } : {}) });
const desk = { phone: false, links: true };

describe('browserRow', () => {
    afterEach(() => setLanguage('en'));
    const b = () => strings.research.browser;

    it('says nothing without a browser, or while the research waits for its agent', () => {
        expect(browserRow(null, desk)).toBeNull();
        expect(browserRow(undefined, desk)).toBeNull();
        expect(browserRow({ state: 'ready', archives: [] }, { ...desk, agentAway: true })).toBeNull();
        expect(browserRow({ state: 'agent-without-browser', archives: [ARCH('a.cz', false)] }, { ...desk, agentAway: true, agent: 'Codex' })).toBeNull();
    });

    it('ready: all permitted, empty, some without permission', () => {
        expect(browserRow({ state: 'ready', archives: [ARCH('a.cz', true)] }, desk)).toMatchObject({ kind: 'ready', text: b().ready, on: true, unpermitted: [] });
        expect(browserRow({ state: 'ready', archives: [] }, desk)).toMatchObject({ kind: 'readyShort', text: b().readyShort, on: true });
        const row = browserRow({ state: 'ready', archives: [ARCH('a.cz', true), ARCH('b.cz', false, 'Archiv B')] }, desk)!;
        expect(row).toMatchObject({ kind: 'readyPermit', text: b().readyPermit, permitLinks: true, phoneHint: false, more: [] });
        expect(row.unpermitted).toEqual([{ host: 'b.cz', name: 'Archiv B', full: 'Archiv B · b.cz' }]);
    });

    it('more than three without permission: three by name, the rest counted', () => {
        const archives = ['a', 'b', 'c', 'd', 'e'].map(x => ARCH(`${x}.cz`, false, `Archiv ${x}`));
        const row = browserRow({ state: 'ready', archives }, desk)!;
        expect(row.unpermitted.map(a => a.host)).toEqual(['a.cz', 'b.cz', 'c.cz']);
        expect(row.more).toEqual(['Archiv d', 'Archiv e']);
        expect(b().more(row.more.length)).toBe('and 2 more');
    });

    it('no permission links without the research\'s links; on a phone none and the hint', () => {
        const info: BrowserInfo = { state: 'ready', archives: [ARCH('b.cz', false)] };
        expect(browserRow(info, { phone: false, links: false })!.permitLinks).toBe(false);
        expect(browserRow(info, { phone: true, links: false })).toMatchObject({ permitLinks: false, phoneHint: true });
    });

    it('no-extension: the store link on a computer, the hint on a phone; empty archives: no row', () => {
        const info: BrowserInfo = { state: 'no-extension', url: STORE, archives: [ARCH('a.cz', false)] };
        expect(browserRow(info, desk)).toMatchObject({ kind: 'noExt', text: b().noExt, on: false, extUrl: STORE, phoneHint: false });
        const phone = browserRow(info, { phone: true, links: false })!;
        expect(phone.extUrl).toBeUndefined();
        expect(phone.phoneHint).toBe(true);
        expect(browserRow({ state: 'no-extension', archives: [ARCH('a.cz', false)] }, { phone: true, links: false })!.phoneHint).toBe(false);
        expect(browserRow({ state: 'no-extension', url: STORE, archives: [] }, desk)).toBeNull();
    });

    it('agent-without-browser: the agent named (shortened at 40), empty archives or no name: no row', () => {
        const info: BrowserInfo = { state: 'agent-without-browser', archives: [ARCH('a.cz', false)] };
        expect(browserRow(info, { ...desk, agent: 'Codex' })).toMatchObject({ kind: 'otherAgent', text: b().otherAgent('Codex'), on: false });
        const long = 'OpenCode (qwen2.5-coder-32b, local, on the second computer)';
        const text = browserRow(info, { ...desk, agent: long })!.text;
        expect(text.startsWith(`${shortAgentName(long)} –`)).toBe(true);
        expect(shortAgentName(long).length).toBeLessThanOrEqual(40);
        expect(shortAgentName(long).endsWith('…')).toBe(true);
        expect(browserRow(info, desk)).toBeNull();
        expect(browserRow({ state: 'agent-without-browser', archives: [] }, { ...desk, agent: 'Codex' })).toBeNull();
    });

    it('speaks the language of the app', () => {
        setLanguage('de');
        expect(browserRow({ state: 'ready', archives: [] }, desk)!.text).toBe('Claude in Chrome verbunden.');
        setLanguage('cs');
        expect(strings.research.browser.changed(browserRow({ state: 'ready', archives: [] }, desk)!.text)).toBe('Prohlížeč: Claude in Chrome připojen.');
    });
});

const GROUP = { key: 'repo:R0077', kind: 'archive' as const, name: 'Zemský archiv ve Smyšlenově' };
function item(id: string, extra: Partial<LiveWaiting> = {}): LiveWaiting {
    return { id, what: `Snímky ${id}`, on: 'user', at: '', kind: 'images', group: GROUP, ...extra };
}

describe('browserNote', () => {
    afterEach(() => setLanguage('en'));
    const b = () => strings.research.browser;
    const a = item('T0001', { url: 'https://digi.example.cz/kniha/1' });

    it('matches by the item\'s host, the group\'s host, or another item of its group', () => {
        const info: BrowserInfo = { state: 'ready', archives: [ARCH('digi.example.cz', false)] };
        expect(browserArchiveOf(info, a)?.host).toBe('digi.example.cz');
        expect(browserArchiveOf(info, item('T0002', { group: { ...GROUP, url: 'https://www.digi.example.cz/' } }))?.host).toBe('digi.example.cz');
        const sibling = item('T0003', { url: 'https://digi2.example.cz/x' });
        expect(browserArchiveOf(info, sibling)).toBeNull();
        expect(browserArchiveOf(info, sibling, [a, sibling])?.host).toBe('digi.example.cz');
        expect(browserArchiveOf(info, item('T0004', { url: 'https://other.example.org/', group: { ...GROUP, key: 'repo:R1' } }), [a])).toBeNull();
    });

    it('the archive\'s name: its title without the part in parentheses, else the group\'s name, else the host', () => {
        expect(browserArchiveName(ARCH('a.cz', false, 'Zemský archiv v Opavě (Digitální archiv)'), a)).toBe('Zemský archiv v Opavě');
        expect(browserArchiveName(ARCH('a.cz', false, '(Digitální archiv)'), a)).toBe(GROUP.name);
        expect(browserArchiveName(ARCH('a.cz', false), a)).toBe(GROUP.name);
        expect(browserArchiveName(ARCH('a.cz', false), item('T9', { group: undefined }))).toBe('a.cz');
    });

    it('each state: agent, missing extension, permission; permitted says nothing', () => {
        expect(browserNote({ state: 'agent-without-browser', archives: [ARCH('digi.example.cz', false)] }, a, [a], desk))
            .toMatchObject({ kind: 'agent', text: b().waitAgent });
        expect(browserNote({ state: 'no-extension', url: STORE, archives: [ARCH('digi.example.cz', false)] }, a, [a], desk))
            .toMatchObject({ kind: 'noExt', text: b().waitNoExt, extUrl: STORE });
        const permit = browserNote({ state: 'ready', archives: [ARCH('digi.example.cz', false, 'Zemský archiv (Digi)')] }, a, [a], desk)!;
        expect(permit).toMatchObject({ kind: 'permit', text: b().waitPermit('Zemský archiv'), permitHost: 'digi.example.cz' });
        expect(browserNote({ state: 'ready', archives: [ARCH('digi.example.cz', true)] }, a, [a], desk)).toBeNull();
    });

    it('nothing from an old bridge, outside the archives, for an item not waiting for images, while the agent is away', () => {
        const info: BrowserInfo = { state: 'agent-without-browser', archives: [ARCH('digi.example.cz', false)] };
        expect(browserNote(undefined, a, [a], desk)).toBeNull();
        expect(browserNote({ state: 'ready', archives: [ARCH('other.cz', false)] }, a, [a], desk)).toBeNull();
        expect(browserNote(info, { ...a, kind: 'letter' }, [a], desk)).toBeNull();
        expect(browserNote(info, { ...a, kind: 'web' }, [a], desk)).toBeNull();
        expect(browserNote(info, { ...a, kind: 'web', inbox: { have: 0, want: 2, dir: '' } }, [a], desk)).not.toBeNull();
        expect(browserNote(info, a, [a], { ...desk, agentAway: true })).toBeNull();
    });

    it('a phone: the computer variants, no links', () => {
        const phone = { phone: true, links: false };
        const noExt = browserNote({ state: 'no-extension', url: STORE, archives: [ARCH('digi.example.cz', false)] }, a, [a], phone)!;
        expect(noExt).toMatchObject({ text: b().waitNoExtPhone });
        expect(noExt.extUrl).toBeUndefined();
        const permit = browserNote({ state: 'ready', archives: [ARCH('digi.example.cz', false)] }, a, [a], phone)!;
        expect(permit.text).toBe(b().waitPermitPhone(GROUP.name));
        expect(permit.permitHost).toBeUndefined();
        expect(browserNote({ state: 'agent-without-browser', archives: [ARCH('digi.example.cz', false)] }, a, [a], phone)!.text).toBe(b().waitAgent);
        // Links not announced on a computer: the sentence without its link.
        expect(browserNote({ state: 'ready', archives: [ARCH('digi.example.cz', false)] }, a, [a], { phone: false, links: false })!.permitHost).toBeUndefined();
    });

    it('a group\'s heading says it once with two items of one archive; one item: in its detail', () => {
        const info: BrowserInfo = { state: 'ready', archives: [ARCH('digi.example.cz', false)] };
        const b2 = item('T0002', { url: 'https://digi.example.cz/kniha/2' });
        const web = item('T0003', { kind: 'web', url: 'https://digi.example.cz/' });
        expect(browserGroupNote(info, [a, b2, web], [a, b2, web], desk)?.host).toBe('digi.example.cz');
        expect(browserGroupNote(info, [a, web], [a, web], desk)).toBeNull();
        expect(browserGroupNote(undefined, [a, b2], [a, b2], desk)).toBeNull();
    });

    it('waitPermit in every language names the archive', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            expect(strings.research.browser.waitPermit('Archiv X')).toContain('Archiv X');
            expect(strings.research.browser.waitPermitPhone('Archiv X')).toContain('Archiv X');
        }
    });
});

/**
 * Sorting of a closed batch only when switched on (spec 130 U2): `/status.intake`
 * read only from a research with `intake.auto`, `POST /intake {auto}` and every
 * reply of the contract, the end of a batch's sending (sorted by the research
 * itself, waiting in Materials, or an older research as before) and the texts
 * in four languages, none addressing the reader. Invented data.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    INTAKE_AUTO_FEATURE, DISK_FULL_FEATURE, NOT_DOWNLOADED_FEATURE, SEAL_FOREIGN_FEATURE, sanitizeIntakeSetting, sanitizeLiveStatus,
} from '../research-link.js';
import { intakeReply, postBridgeIntake } from '../history-bridge.js';
import { batchSorting } from '../batch.js';
import { getStringsForLang } from '../strings.js';

const BASE = 'http://127.0.0.1:7777/abc123';
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const PARENT = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('/status.intake', () => {
    const status = (features: string[], intake?: unknown) =>
        sanitizeLiveStatus({ tree: { id: 'R1' }, features, ...(intake !== undefined ? { intake } : {}) })!;

    it('is read with the feature', () => {
        expect(status([INTAKE_AUTO_FEATURE], { auto: false }).intake).toEqual({ auto: false });
        expect(status([INTAKE_AUTO_FEATURE], { auto: true }).intake).toEqual({ auto: true });
    });

    it('is never read without the feature; missing or broken it is not said (no switch)', () => {
        expect('intake' in status([], { auto: true })).toBe(false);
        expect('intake' in status([INTAKE_AUTO_FEATURE])).toBe(false);
        expect('intake' in status([INTAKE_AUTO_FEATURE], { auto: 'on' })).toBe(false);
        expect('intake' in status([INTAKE_AUTO_FEATURE], true)).toBe(false);
        expect(sanitizeIntakeSetting(null)).toBeNull();
    });
});

describe('POST /intake', () => {
    const all = [INTAKE_AUTO_FEATURE, SEAL_FOREIGN_FEATURE, NOT_DOWNLOADED_FEATURE, DISK_FULL_FEATURE];

    it('200: the setting kept now and its commit', () => {
        expect(intakeReply(200, { intake: { auto: true }, head: HEAD, parent: PARENT }, all))
            .toEqual({ ok: true, intake: { auto: true }, head: HEAD, parent: PARENT });
        expect(intakeReply(200, { intake: { auto: false }, head: HEAD, parent: HEAD }, all))
            .toEqual({ ok: true, intake: { auto: false }, head: HEAD, parent: HEAD });
        expect(intakeReply(200, null, all)).toEqual({ ok: true, intake: null, head: '', parent: '' });
    });

    it('every refusal of the contract', () => {
        const r = (status: number, code: string, extra: object = {}) =>
            intakeReply(status, { error: 'Said by the research.', code, params: {}, ...extra }, all);
        expect(r(400, 'intake.body')).toMatchObject({ ok: false, code: 'invalid', status: 400 });
        expect(r(409, 'intake.archive', { reasonCode: 'archive' })).toMatchObject({ ok: false, code: 'archive' });
        expect(r(409, 'seal.foreign')).toMatchObject({ ok: false, code: 'held', held: { kind: 'seal' } });
        expect(r(409, 'tree.not-downloaded', { params: { n: 2 } })).toMatchObject({ ok: false, code: 'held', held: { kind: 'cloud', n: 2 } });
        expect(r(423, 'locked')).toMatchObject({ ok: false, code: 'locked' });
        expect(r(503, 'research.busy')).toMatchObject({ ok: false, code: 'busy' });
        expect(intakeReply(507, { code: 'disk.full' }, [INTAKE_AUTO_FEATURE])).toMatchObject({ ok: false, code: 'full' });
        expect(r(500, 'intake.failed')).toMatchObject({ ok: false, code: 'unknown', reason: 'Said by the research.', bridgeCode: 'intake.failed' });
    });

    it('the write: its path and exactly {"auto": bool}; no answer is the network', async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ intake: { auto: true }, head: HEAD, parent: PARENT }), { status: 200 }));
        vi.stubGlobal('fetch', f);
        expect(await postBridgeIntake(BASE, true, all)).toEqual({ ok: true, intake: { auto: true }, head: HEAD, parent: PARENT });
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
        expect(url.split('?')[0]).toBe(`${BASE}/intake`);
        expect(init.method).toBe('POST');
        expect(String(init.body)).toBe('{"auto":true}');
        await postBridgeIntake(BASE, false, all);
        expect(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).toBe('{"auto":false}');
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await postBridgeIntake(BASE, true, all)).toEqual({ ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' });
    });
});

describe('the end of a batch: who sorts it', () => {
    it('an older research (no intake.auto) sorts by itself as before, whatever is said', () => {
        expect(batchSorting(false, undefined, null)).toBe('older');
        expect(batchSorting(false, false, { sort: false, auto: false })).toBe('older');
    });

    it('off (the default): the files wait in Materials', () => {
        expect(batchSorting(true, false, null)).toBe('manual');
        expect(batchSorting(true, undefined, null)).toBe('manual');
        expect(batchSorting(true, undefined, {})).toBe('manual');
        expect(batchSorting(true, true, { sort: false, auto: false })).toBe('manual');
    });

    it('on: the research sorts the batch itself', () => {
        expect(batchSorting(true, true, null)).toBe('auto');
        expect(batchSorting(true, false, { auto: true })).toBe('auto');
        expect(batchSorting(true, false, { sort: true, auto: false })).toBe('auto');
    });

    it('the batch\'s own reply decides first: sort, then auto, then the status', () => {
        expect(batchSorting(true, true, { auto: false })).toBe('manual');
        expect(batchSorting(true, false, { sort: true })).toBe('auto');
    });
});

describe('the texts', () => {
    const langs = ['en', 'cs', 'de', 'pl'] as const;
    const reader = /\b(you|your|Sie|Ihr|Ihre|du|dein|vy|ty|váš|vaše|tvůj|twój|Pan|Pani)\b/;

    it('are in every language and never address the reader', () => {
        for (const lang of langs) {
            const s = getStringsForLang(lang);
            const texts = [s.batch.doneTextAuto, s.batch.doneTextUnsorted, s.batch.doneTextUnsortedLater,
                s.history.intakeSection, s.history.intakeTitle, s.history.intakeDesc];
            for (const t of texts) {
                expect(t, lang).toBeTruthy();
                expect(t, `${lang}: ${t}`).not.toMatch(reader);
            }
            // Off says no agent sorts by itself; the older text stays the one of today.
            expect(s.batch.doneTextUnsorted).not.toBe(s.batch.doneText);
        }
        expect(getStringsForLang('en').batch.doneText).toBe('The agent will sort the files. Sources and excerpts that belong to people arrive with the next tree version.');
        expect(getStringsForLang('cs').history.intakeTitle).toBe('Soubory poslané do výzkumu projde agent sám');
    });
});

/**
 * "Delete source?" of a followed tree (spec 117 §2, §3): how the dialog says
 * the bridge's refusals and what stays possible, and how the toast's Undo says
 * the research's answer. Pure logic; the dialog itself in e2e/source-retract.spec.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { retractDialogError, restoreToastEnd } from '../ui/source-retract-ui.js';
import type { RestoreDone, RetractError, RetractResult } from '../source-retract.js';

let R: typeof import('../strings.js').strings.sources.retract;

beforeAll(async () => {
    const { setLanguage, strings } = await import('../strings.js');
    setLanguage('en');
    R = strings.sources.retract;
});

const err = (kind: RetractError['kind'], extra: Partial<RetractError> = {}): RetractError => ({ kind, status: 409, ...extra });
const restored = (skipped: RestoreDone['skipped']): RetractResult<RestoreDone> => ({
    ok: true, value: { restored: ['S0042'], citations: 3, skipped, head: 'a'.repeat(40), parent: '' },
});

describe('retractDialogError (§2 states, §9)', () => {
    it('a source gone or already retracted: its sentence and Load again, the danger button gone', () => {
        expect(retractDialogError(err('gone', { status: 404 }))).toEqual({ text: R.gone, end: 'reload' });
        expect(retractDialogError(err('already'))).toEqual({ text: R.already, end: 'reload' });
    });

    it('a read-only research and a bridge without the route stop the dialog without an action', () => {
        expect(retractDialogError(err('readonly', { status: 403 }))).toEqual({ text: R.readonly, end: 'stop' });
        expect(retractDialogError(err('missing', { status: 404 }))).toEqual({ text: R.unknownAction, end: 'stop' });
    });

    it('a failed write, a busy research and no answer can be tried again', () => {
        expect(retractDialogError(err('failed', { status: 500 }))).toEqual({ text: R.failed, end: 'retry' });
        expect(retractDialogError(err('down', { status: 0 }))).toEqual({ text: R.down, end: 'retry' });
        expect(retractDialogError(err('busy'))).toEqual({ text: R.busyWait, end: 'retry' });
        expect(retractDialogError(err('unknown', { status: 418 }))).toEqual({ text: R.failed, end: 'retry' });
    });

    it('held by the research: its own sentence', () => {
        const held = { said: 'Sealed on another computer.' } as RetractError['held'];
        expect(retractDialogError(err('held', { held }))).toEqual({ text: 'Sealed on another computer.', end: 'stop' });
    });
});

describe('restoreToastEnd (§3)', () => {
    it('back with all its citations: the title said', () => {
        expect(restoreToastEnd(restored([]), 'Parish register')).toEqual({ ok: true, text: R.restored('Parish register') });
    });

    it('only citations whose fact is gone are counted (already cited, another main: no loss)', () => {
        const end = restoreToastEnd(restored([
            { owner: 'P0001', fact: 'BIRT', why: 'gone' },
            { owner: 'P0002', fact: 'DEAT', why: 'gone' },
            { owner: 'P0003', fact: 'NAME', why: 'already' },
            { owner: 'P0003', fact: 'BIRT', why: 'main' },
        ]), 'Parish register');
        expect(end).toEqual({ ok: true, text: R.restoredPart(2) });
        expect(R.restoredPart(2)).toContain('2 citations');
    });

    it('no bridge or no answer: the research can restore it later, no Try again', () => {
        expect(restoreToastEnd(null, 'X')).toEqual({ ok: false, text: R.restoreDown, whole: true, retry: false });
        expect(restoreToastEnd({ ok: false, error: err('down', { status: 0 }) }, 'X'))
            .toEqual({ ok: false, text: R.restoreDown, whole: true, retry: false });
    });

    it('not restorable: said without an action; not retracted any more: only the tree loaded again', () => {
        expect(restoreToastEnd({ ok: false, error: err('notRestorable', { why: 'merged' }) }, 'X'))
            .toEqual({ ok: false, text: R.notRestorable, whole: true, retry: false });
        expect(restoreToastEnd({ ok: false, error: err('notRetracted') }, 'X')).toBe('reload');
    });

    it('a failed write can be tried again', () => {
        expect(restoreToastEnd({ ok: false, error: err('failed', { status: 500 }) }, 'X')).toEqual({ ok: false, text: R.failed, whole: true });
    });
});

describe('texts (§11)', () => {
    it('counts and plurals in each language', async () => {
        const S = await import('../strings.js');
        const setLanguage = S.setLanguage;
        setLanguage('cs');
        expect(S.strings.sources.retract.counts(34, 16)).toBe('Cituje ho 34 citací u údajů a 16 vyprávění.');
        expect(S.strings.sources.retract.counts(4, 0)).toBe('Cituje ho 4 citace u údajů.');
        expect(S.strings.sources.retract.bare(9)).toBe('9 údajů tím zůstane bez pramene. Údaje zůstanou, jen bez citace.');
        expect(S.strings.sources.retract.lowered(3)).toBe('3 údaje budou méně jisté');
        expect(S.strings.sources.retract.more(5)).toBe('a 5 dalších');
        setLanguage('de');
        expect(S.strings.sources.retract.counts(34, 16)).toBe('Die Quelle wird 34-mal bei Angaben und in 16 Erzählungen zitiert.');
        expect(S.strings.sources.retract.counts(4, 0)).toBe('Die Quelle wird 4-mal bei Angaben zitiert.');
        expect(S.strings.sources.retract.counts(0, 2)).toBe('Die Quelle wird in 2 Erzählungen zitiert.');
        setLanguage('pl');
        expect(S.strings.sources.retract.bare(9)).toBe('9 danych zostanie bez źródła. Dane pozostaną, tylko bez cytowania.');
        expect(S.strings.sources.retract.lowered(3)).toBe('3 dane staną się mniej pewne');
        setLanguage('en');
        expect(S.strings.sources.retract.counts(34, 16)).toBe('It is cited 34 times on facts and in 16 stories.');
        expect(S.strings.sources.retract.counts(2, 0)).toBe('It is cited 2 times on facts.');
        expect(S.strings.sources.retract.counts(0, 1)).toBe('It is cited in 1 story.');
        expect(S.strings.sources.retract.bare(9)).toBe('9 facts are left without a source. The facts stay, only without a citation.');
    });

    it('the same keys in all four languages', async () => {
        const S = await import('../strings.js');
        const keys = (l: 'cs' | 'en' | 'de' | 'pl') => { S.setLanguage(l); return Object.keys(S.strings.sources.retract).sort(); };
        const en = keys('en');
        expect(keys('cs')).toEqual(en);
        expect(keys('de')).toEqual(en);
        expect(keys('pl')).toEqual(en);
        S.setLanguage('en');
    });
});

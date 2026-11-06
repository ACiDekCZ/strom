/**
 * Confirming the research's transcript of a source (spec 022, K2.1, K2.3–K2.5):
 * `2 _CONF` / `2 _TXT` under `1 _STROM_READ` read and written as they came,
 * what a source and the bridge allow, the request and the bridge's answers.
 * Also: a foreign GEDCOM gives no reader, no certainty and no verified
 * transcript (K2b.5 a), whatever its QUAY or notes say.
 */

import { describe, it, expect } from 'vitest';
import { Source, StromData, STROM_DATA_VERSION } from '../types.js';
import { exportToGedcom } from '../ged-exporter.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import {
    SOURCES_CONFIRM_FEATURE, isConfirmDay, isTranscriptMark, sourceConfirmAction, sourceConfirmOffer, sourceConfirmReply,
    sourceConfirmRequestBody, sourceReadState,
} from '../source-confirm.js';

const MARK = '0123456789abcdef';

function ged(lines: string[]): string {
    return ['0 HEAD', '1 SOUR STROM_RESEARCH', '1 CHAR UTF-8', '0 @S1@ SOUR', '1 TITL Oddací matrika Brhlov', '1 REFN S0042',
        '1 TEXT Jakub Brhlík a Marie', ...lines, '0 TRLR'].join('\n');
}

function back(text: string): Source {
    return Object.values(convertToStrom(parseGedcom(text)).data.sources ?? {})[0];
}

function data(extra: Partial<Source>): StromData {
    return {
        version: STROM_DATA_VERSION, persons: {}, partnerships: {},
        sources: { s1: { id: 's1', title: 'Oddací matrika Brhlov', refn: 'S0042', transcript: 'Jakub Brhlík a Marie', ...extra } },
    } as unknown as StromData;
}

describe('GEDCOM: the confirmation under _STROM_READ', () => {
    it('reads the day and the mark of the wording', () => {
        const src = back(ged(['1 _STROM_READ both', '2 _CONF 2026-11-06', `2 _TXT ${MARK}`]));
        expect(src.readBy).toBe('both');
        expect(src.readConfirmed).toBe('2026-11-06');
        expect(src.readMark).toBe(MARK);
    });

    it('the mark alone on a source the research read', () => {
        const src = back(ged(['1 _STROM_READ research', `2 _TXT ${MARK}`]));
        expect(src.readBy).toBe('research');
        expect(src.readConfirmed).toBeUndefined();
        expect(src.readMark).toBe(MARK);
    });

    it('nothing outside _STROM_READ, under an unknown reader, or of a wrong shape', () => {
        expect(back(ged(['1 _STROM_VERIFIED Y', '2 _CONF 2026-11-06', `2 _TXT ${MARK}`])).readMark).toBeUndefined();
        const unknown = back(ged(['1 _STROM_READ somebody', '2 _CONF 2026-11-06', `2 _TXT ${MARK}`]));
        expect(unknown.readBy).toBeUndefined();
        expect(unknown.readConfirmed).toBeUndefined();
        expect(unknown.readMark).toBeUndefined();
        const bad = back(ged(['1 _STROM_READ both', '2 _CONF 6 NOV 2026', '2 _TXT ../etc/passwd']));
        expect(bad.readBy).toBe('both');
        expect(bad.readConfirmed).toBeUndefined();
        expect(bad.readMark).toBeUndefined();
        expect(back(ged(['1 _STROM_READ both', '2 _CONF 2026-02-30'])).readConfirmed).toBeUndefined();
    });

    it('goes out as it came: _STROM_READ, then _CONF, then _TXT — and comes back', () => {
        const out = exportToGedcom(data({ readBy: 'both', readConfirmed: '2026-11-06', readMark: MARK }), 'T').content;
        expect(out).toMatch(new RegExp(`1 _STROM_READ both\\r?\\n2 _CONF 2026-11-06\\r?\\n2 _TXT ${MARK}\\r?\\n`));
        const src = back(out);
        expect([src.readBy, src.readConfirmed, src.readMark]).toEqual(['both', '2026-11-06', MARK]);
        const plain = exportToGedcom(data({ readBy: 'research' }), 'T').content;
        expect(plain).toMatch(/1 _STROM_READ research\r?\n(?!2 _)/);
        expect(exportToGedcom(data({}), 'T').content).not.toContain('_STROM_READ');
        // The marks never without the reader.
        const orphan = exportToGedcom(data({ readConfirmed: '2026-11-06', readMark: MARK }), 'T').content;
        expect(orphan).not.toMatch(/_CONF|_TXT|_STROM_READ/);
    });
});

describe('a foreign GEDCOM gives no reader, certainty nor verified transcript (K2b.5 a)', () => {
    it('QUAY 3 and "verified" in a note stay the source\'s reliability and its note', () => {
        const foreign = ['0 HEAD', '1 SOUR FAMILYTREEBUILDER', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Václav /Brhlík/', '1 SEX M', '1 BIRT', '2 DATE 1865', '2 SOUR @S1@', '3 QUAY 3', '3 NOTE ověřeno ze skenu',
            '0 @S1@ SOUR', '1 TITL Křestní matrika Brhlov', '1 TEXT Wenceslaus filius Jacobi', '1 NOTE Verified by me', '0 TRLR'].join('\n');
        const result = convertToStrom(parseGedcom(foreign)).data;
        const src = Object.values(result.sources ?? {})[0];
        expect(src.quality).toBe(3);
        expect(src.readBy).toBeUndefined();
        expect(src.transcriptVerified).toBeUndefined();
        expect(src.readConfirmed).toBeUndefined();
        const person = Object.values(result.persons)[0];
        expect(JSON.stringify(person)).not.toContain('"status"');
        const out = exportToGedcom(result, 'T').content;
        expect(out).not.toMatch(/_STROM_READ|_STROM_VERIFIED|_STROM_STATUS|_CONF|_TXT/);
    });
});

describe('what a source allows', () => {
    const src = (extra: Partial<Source>): Source => ({ id: 's1', title: 'X', refn: 'S0042', transcript: 'znění', ...extra });
    const action = (extra: Partial<Source>) => { const s = src(extra); return sourceConfirmAction(s, sourceReadState(s)); };

    it('confirm a transcript only the research read; undo a confirmation', () => {
        expect(action({ readBy: 'research', readMark: MARK })).toBe('confirm');
        expect(action({ readBy: 'both', readConfirmed: '2026-11-06', readMark: MARK })).toBe('unconfirm');
    });

    it('nothing: read by the user, both without _CONF, no mark, no transcript, not the research\'s source', () => {
        expect(action({ readBy: 'user', readMark: MARK })).toBeNull();
        expect(action({ readBy: 'both', readMark: MARK })).toBeNull();
        expect(action({ readBy: 'research' })).toBeNull();
        expect(action({ readBy: 'research', readMark: MARK, transcript: '  ' })).toBeNull();
        expect(action({ readBy: 'research', readMark: MARK, refn: undefined })).toBeNull();
        expect(action({ readBy: 'research', readMark: MARK, refn: 'P0001' })).toBeNull();
        expect(action({ readMark: MARK })).toBeNull();
    });

    it('the state read only from a known reader', () => {
        expect(sourceReadState({ readConfirmed: '2026-11-06', readMark: MARK })).toEqual({ read: undefined, conf: '', txt: '' });
        expect(sourceReadState({ readBy: 'both', readConfirmed: 'x', readMark: MARK })).toEqual({ read: 'both', conf: '', txt: MARK });
    });
});

describe('what the viewer offers', () => {
    const env = { features: [SOURCES_CONFIRM_FEATURE], bridgeUp: true, agentless: false, readOnly: false };

    it('the action while the bridge runs and says the feature', () => {
        expect(sourceConfirmOffer('confirm', env)).toEqual({ kind: 'ready', action: 'confirm' });
        expect(sourceConfirmOffer('unconfirm', env)).toEqual({ kind: 'ready', action: 'unconfirm' });
    });

    it('at rest when the bridge said it before and does not run now', () => {
        expect(sourceConfirmOffer('confirm', { ...env, bridgeUp: false })).toEqual({ kind: 'rest', action: 'confirm' });
    });

    it('nothing: an older research, an archive or one waiting for its agent, a read-only tree, nothing to do', () => {
        expect(sourceConfirmOffer('confirm', { ...env, features: ['hypotheses.decide'] })).toEqual({ kind: 'none' });
        expect(sourceConfirmOffer('confirm', { ...env, features: null })).toEqual({ kind: 'none' });
        expect(sourceConfirmOffer('confirm', { ...env, features: null, bridgeUp: false })).toEqual({ kind: 'none' });
        expect(sourceConfirmOffer('confirm', { ...env, agentless: true })).toEqual({ kind: 'none' });
        expect(sourceConfirmOffer('confirm', { ...env, readOnly: true })).toEqual({ kind: 'none' });
        expect(sourceConfirmOffer(null, env)).toEqual({ kind: 'none' });
    });
});

describe('the request and its answer', () => {
    const sent = { source: 'S0042', txt: MARK, confirm: true };

    it('the body is exactly the three keys, or nothing goes', () => {
        expect(sourceConfirmRequestBody(sent)).toEqual(sent);
        expect(Object.keys(sourceConfirmRequestBody({ ...sent, extra: 1 } as never)!)).toEqual(['source', 'txt', 'confirm']);
        expect(sourceConfirmRequestBody({ ...sent, source: 'P0001' })).toBeNull();
        expect(sourceConfirmRequestBody({ ...sent, txt: 'a b' })).toBeNull();
        expect(sourceConfirmRequestBody({ ...sent, confirm: 'yes' as never })).toBeNull();
        expect(isTranscriptMark('x'.repeat(65))).toBe(false);
        expect(isConfirmDay('2026-11-06')).toBe(true);
        expect(isConfirmDay('2026-13-01')).toBe(false);
    });

    it('200: the state as the research says it', () => {
        expect(sourceConfirmReply(sent, 200, { ok: true, source: 'S0042', read: 'both', conf: '2026-11-06', txt: MARK, head: 'abc1234', parent: '9f8e7d6' }, []))
            .toEqual({ ok: true, source: 'S0042', read: 'both', conf: '2026-11-06', txt: MARK, head: 'abc1234', parent: '9f8e7d6' });
        const undo = { ...sent, confirm: false };
        expect(sourceConfirmReply(undo, 200, { ok: true, source: 'S0042', read: 'research', txt: MARK, head: 'abc1234', parent: 'abc1234' }, []))
            .toMatchObject({ ok: true, read: 'research', conf: '' });
    });

    it('200 that does not say what was asked: unknown', () => {
        expect(sourceConfirmReply(sent, 200, { ok: true, source: 'S0043', read: 'both', conf: '2026-11-06', txt: MARK }, [])).toMatchObject({ ok: false, code: 'unknown' });
        expect(sourceConfirmReply(sent, 200, { ok: true, source: 'S0042', read: 'research', txt: MARK }, [])).toMatchObject({ ok: false, code: 'unknown' });
        expect(sourceConfirmReply(sent, 200, { ok: true, source: 'S0042', read: 'both', conf: 'today', txt: MARK }, [])).toMatchObject({ ok: false, code: 'unknown' });
        expect(sourceConfirmReply({ ...sent, confirm: false }, 200, { ok: true, source: 'S0042', read: 'both', conf: '2026-11-06', txt: MARK }, []))
            .toMatchObject({ ok: false, code: 'unknown' });
        expect(sourceConfirmReply(sent, 200, null, [])).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('the refusals by their codes', () => {
        const no = (status: number, body: Record<string, unknown>, features: string[] = []) => sourceConfirmReply(sent, status, body, features);
        expect(no(409, { code: 'confirm.changed', txt: 'fedcba9876543210' })).toMatchObject({ code: 'changed', txt: 'fedcba9876543210' });
        expect(no(409, { code: 'confirm.changed', params: { txt: 'fedcba9876543210' } })).toMatchObject({ code: 'changed', txt: 'fedcba9876543210' });
        expect(no(409, { code: 'confirm.merged', into: 'S0007' })).toMatchObject({ code: 'merged', into: 'S0007' });
        expect(no(409, { code: 'confirm.retracted' })).toMatchObject({ code: 'retracted' });
        expect(no(409, { code: 'confirm.reader' })).toMatchObject({ code: 'reader' });
        expect(no(409, { code: 'confirm.archive' })).toMatchObject({ code: 'archive' });
        expect(no(404, { code: 'confirm.none' })).toMatchObject({ code: 'none' });
        expect(no(404, { code: 'route.unknown' })).toMatchObject({ code: 'unknown' });
        expect(no(400, { code: 'confirm.invalid' })).toMatchObject({ code: 'invalid' });
        expect(no(503, { code: 'research.busy' })).toMatchObject({ code: 'busy' });
        expect(no(423, { code: 'locked' })).toMatchObject({ code: 'locked' });
        expect(no(500, { code: 'confirm.failed' })).toMatchObject({ code: 'failed' });
        expect(no(507, { code: 'disk.full', error: 'The disk is full.' }, ['disk.full'])).toMatchObject({ code: 'held', held: { kind: 'disk' } });
        expect(no(403, { code: 'app.only' })).toMatchObject({ code: 'unknown' });
    });
});

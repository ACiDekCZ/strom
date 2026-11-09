/**
 * "Confirm against the scan" tied to the value shown (research 1.30.0+,
 * feature `facts.confirm.value`): the research's mark of what a fact says
 * (`3 _TXT` under `2 _STROM_EID`) is kept with the fact and sent back as
 * `txt`; a fact that says something else now is refused (409 confirm.changed)
 * and nothing is confirmed. Refusals read in the app's language (1109).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { convertToStrom, parseGedcom } from '../ged-parser.js';
import { factConfirmMark, sanitizeResearchVerify } from '../verify.js';
import { factConfirmReply, factConfirmRequestBody, postFactConfirm } from '../research-verify.js';
import { confirmRefusalText, verifyRefusalText } from '../verify-refusal.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import type { Person, StromData } from '../types.js';

const MARK = '440dc563414cfcee';
const ged = (txt = `3 _TXT ${MARK}\n`) => `0 HEAD
1 SOUR STROM_RESEARCH
2 VERS 1.30.0
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @P0001@ INDI
1 NAME Zbyhněv /Lučinov/
2 _STROM_ORIGIN tree
1 SEX M
1 REFN P0001
2 TYPE strom-research
1 BIRT
2 _STROM_EID E0001
${txt}2 DATE 12 MAR 1931
2 PLAC Horní Brodek
2 _STROM_STATUS lead
2 _STROM_ORIGIN tree
1 DEAT
2 _STROM_EID E0002
2 DATE 1990
0 TRLR
`;

const personOf = (data: StromData): Person => Object.values(data.persons)[0] as Person;
const load = (text: string): Person => personOf(convertToStrom(parseGedcom(text), {}).data);

const BASE = 'http://127.0.0.1:4711/abc123';
const WITH_VALUE = ['verify', 'facts.confirm', 'facts.confirm.value'];
const OLDER = ['verify', 'facts.confirm'];

function stubFetch(status: number, body: unknown): { body: unknown }[] {
    const calls: { body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ body: JSON.parse(init.body as string) });
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }));
    return calls;
}

afterEach(() => {
    vi.unstubAllGlobals();
    setLanguage('en');
});

describe('the research\'s mark of a fact (`3 _TXT`)', () => {
    it('is kept with the fact\'s id and the value it stands for', () => {
        const p = load(ged());
        expect(p.researchVerify?.birth).toMatchObject({ eid: 'E0001', txt: MARK });
        expect(p.researchVerify?.birth?.txtValue).toBeTruthy();
        expect(factConfirmMark(p, 'birth')).toBe(MARK);
        // A fact the file gave no mark: an older research, nothing to send.
        expect(p.researchVerify?.death?.txt).toBeUndefined();
        expect(factConfirmMark(p, 'death')).toBeNull();
    });

    it('a mark that is not 16 hex digits is not kept; upper case reads as lower case', () => {
        expect(load(ged('3 _TXT 12345\n')).researchVerify?.birth?.txt).toBeUndefined();
        expect(load(ged(`3 _TXT ${MARK.toUpperCase()}\n`)).researchVerify?.birth?.txt).toBe(MARK);
    });

    it('stands only for the value it came with: a value changed here is `changed`, changed back it holds again', () => {
        const p = load(ged());
        const date = p.birthDate;
        p.birthDate = '1932-03-12';
        expect(factConfirmMark(p, 'birth')).toBe('changed');
        p.birthDate = date;
        expect(factConfirmMark(p, 'birth')).toBe(MARK);
    });

    it('survives the stored tree (sanitized), and is dropped without the fact\'s id', () => {
        const v = load(ged()).researchVerify!.birth!;
        expect(sanitizeResearchVerify(JSON.parse(JSON.stringify(v)))).toEqual(v);
        expect(sanitizeResearchVerify({ txt: MARK, txtValue: 'x', checked: { result: 'kept' } })).toEqual({ checked: { result: 'kept' } });
        expect(sanitizeResearchVerify({ eid: 'E1', txt: 'nope' })).toEqual({ eid: 'E1' });
    });
});

describe('POST /facts/confirm with `txt`', () => {
    it('the body carries the mark (lower case), or none', () => {
        expect(factConfirmRequestBody('E7', true, MARK)).toEqual({ fact: 'E7', txt: MARK, confirm: true });
        expect(factConfirmRequestBody('E7', false, MARK.toUpperCase())).toEqual({ fact: 'E7', txt: MARK, confirm: false });
        expect(factConfirmRequestBody('E7', true)).toEqual({ fact: 'E7', confirm: true });
        expect(factConfirmRequestBody('E7', true, 'abc')).toBeNull();
    });

    it('a bridge with `facts.confirm.value` gets the mark of the value shown, for a confirmation and its undo', async () => {
        const calls = stubFetch(200, { ok: true, fact: 'E1', owner: 'P1', confirmed: '2026-11-09' });
        expect(await postFactConfirm(BASE, 'E1', true, { features: WITH_VALUE, txt: MARK })).toMatchObject({ ok: true });
        await postFactConfirm(BASE, 'E1', false, { features: WITH_VALUE, txt: MARK });
        expect(calls.map(c => c.body)).toEqual([{ fact: 'E1', txt: MARK, confirm: true }, { fact: 'E1', txt: MARK, confirm: false }]);
    });

    it('an older bridge gets no mark (it would refuse it); without a mark nothing changes either', async () => {
        const calls = stubFetch(200, { ok: true, fact: 'E1', owner: 'P1' });
        await postFactConfirm(BASE, 'E1', true, { features: OLDER, txt: MARK });
        await postFactConfirm(BASE, 'E1', true, { features: OLDER, txt: 'changed' });
        await postFactConfirm(BASE, 'E1', true, { features: WITH_VALUE, txt: null });
        expect(calls.map(c => c.body)).toEqual([{ fact: 'E1', confirm: true }, { fact: 'E1', confirm: true }, { fact: 'E1', confirm: true }]);
    });

    it('a value changed here is not sent at all: `confirm.changed`', async () => {
        const calls = stubFetch(200, { ok: true, fact: 'E1', owner: 'P1' });
        expect(await postFactConfirm(BASE, 'E1', true, { features: WITH_VALUE, txt: 'changed' }))
            .toEqual({ ok: false, code: 'confirm.changed', status: 0, reason: '' });
        expect(calls).toHaveLength(0);
    });

    it('409 confirm.changed: refused, nothing confirmed', async () => {
        const body = {
            error: 'E0001 changed since the app showed it: confirm what it says now', code: 'confirm.changed',
            params: { fact: 'E0001', txt: 'aaaaaaaaaaaaaaaa', date: '1851' }, txt: 'aaaaaaaaaaaaaaaa', now: { date: '1851' },
        };
        expect(factConfirmReply('E0001', 409, body)).toMatchObject({ ok: false, code: 'confirm.changed', status: 409 });
        stubFetch(409, body);
        expect(await postFactConfirm(BASE, 'E0001', true, { features: WITH_VALUE, txt: MARK })).toMatchObject({ ok: false, code: 'confirm.changed' });
    });
});

describe('a refusal in the app\'s words (1109)', () => {
    const LANGS = ['cs', 'en', 'de', 'pl'] as const;
    const VERIFY_CODES = ['verify.archive', 'verify.retracted', 'verify.unknown', 'unsupported', 'verify.invalid', 'busy', 'locked', 'network', 'verify.nothing'];
    const CONFIRM_CODES = ['confirm.changed', 'factconfirm.retracted', 'factconfirm.unknown', 'factconfirm.merged', 'unsupported', 'factconfirm.invalid', 'busy', 'locked', 'network'];

    it('each reason has its own sentence, in every language', () => {
        for (const lang of LANGS) {
            setLanguage(lang);
            const v = getStringsForLang(lang).verify;
            expect(verifyRefusalText('verify.archive')).toBe(v.whyArchive);
            expect(verifyRefusalText('verify.retracted')).toBe(v.whyRetracted);
            expect(verifyRefusalText('verify.unknown')).toBe(v.whyGone);
            expect(verifyRefusalText('unsupported')).toBe(v.whyOld);
            expect(verifyRefusalText('verify.invalid')).toBe(v.whyRefused);
            expect(verifyRefusalText('network')).toBe(v.failed);
            expect(confirmRefusalText('confirm.changed')).toBe(v.confirmChanged);
            expect(confirmRefusalText('factconfirm.merged')).toBe(v.whyMerged);
            expect(confirmRefusalText('busy')).toBe(v.confirmBusy);
            expect(confirmRefusalText('locked')).toBe(v.confirmLocked);
            expect(confirmRefusalText('network')).toBe(v.confirmFailed);
            const said = [...VERIFY_CODES.map(verifyRefusalText), ...CONFIRM_CODES.map(confirmRefusalText)];
            expect(said.every(t => t.trim().length > 0)).toBe(true);
            // Distinct reasons, never the bridge's English sentence.
            expect(new Set(VERIFY_CODES.map(verifyRefusalText)).size).toBe(VERIFY_CODES.length);
            expect(new Set(CONFIRM_CODES.map(confirmRefusalText)).size).toBe(CONFIRM_CODES.length);
            // An unnamed refusal is still the research's refusal, not "failed".
            expect(verifyRefusalText('unknown')).toBe(v.whyRefused);
        }
    });

    it('"The fact has changed meanwhile" in every language, impersonal', () => {
        expect(getStringsForLang('cs').verify.confirmChanged).toMatch(/^Údaj se mezitím změnil/);
        expect(getStringsForLang('en').verify.confirmChanged).toMatch(/^The fact has changed meanwhile/);
        for (const lang of LANGS) {
            const v = getStringsForLang(lang).verify;
            const texts = [v.confirmChanged, v.confirmBusy, v.confirmLocked, v.whyArchive, v.whyRetracted, v.whyGone, v.whyMerged, v.whyOld, v.whyRefused];
            const all = texts.join(' ');
            // German "sie" (it, the research) is fine; the polite "Sie"/"Ihr" is not.
            expect(all).not.toMatch(/\b(Sie|Ihr|Ihre)\b/);
            expect(all.toLowerCase()).not.toMatch(/(^|[^\p{L}])(you|your|du|dein|vy|váš|vaše|ty|twój|pan|pani)(?![\p{L}])/u);
        }
    });
});

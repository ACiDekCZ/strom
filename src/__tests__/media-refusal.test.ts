/**
 * A file the research refused (L3): its code and params said in the app's
 * language when the research gives codes (`media.codes`); an unknown code,
 * a param missing or an older research: its own sentence, as before.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mediaCodesOn, mediaRefusalText, parseMediaRefusal, MEDIA_CODES_FEATURE } from '../media-refusal.js';
import { setLanguage } from '../strings.js';

const CODES = [
    'app.only', 'media.bad-sha', 'media.bad-header', 'media.bad-region', 'media.no-person', 'media.no-source',
    'media.no-shared', 'media.large', 'media.full', 'media.failed', 'media.sha-differs', 'media.type', 'media.cut-short',
    'media.too-small', 'media.gone', 'research.busy', 'batch.bad-id', 'batch.zip-alone', 'batch.zip-unreadable',
    'batch.closed', 'batch.full-files', 'batch.full-bytes', 'batch.none', 'batch.bad-body',
];
const PARAMS = {
    header: 'X-Strom-Person', region: '0.1,0.2,2,0.4', person: 'P0042', source: 'S0007', mb: '500', kind: 'JPEG',
    bytes: '3', files: '5000', gb: '20', batch: 'b-123456789', name: 'dopis.jpg', sha: 'ab'.repeat(32), known: 'I0007',
};
const ENGLISH = 'the research said so in English';

afterEach(() => setLanguage('en'));

describe('the feature', () => {
    it('is on only when the research says media.codes', () => {
        expect(MEDIA_CODES_FEATURE).toBe('media.codes');
        expect(mediaCodesOn(['adopt.transfer', 'media.codes'])).toBe(true);
        expect(mediaCodesOn(['adopt.transfer'])).toBe(false);
        expect(mediaCodesOn(null)).toBe(false);
        expect(mediaCodesOn(undefined)).toBe(false);
    });
});

describe('a refusal in the app\'s language', () => {
    it('says a person the research does not have, with its id, in English, Czech and German', () => {
        const body = { error: 'no person P0042 in this research', code: 'media.no-person', text: 'no person P0042 in this research', params: { person: 'P0042' } };
        expect(mediaRefusalText(body, true, 'x')).toBe('the research has no person P0042');
        setLanguage('cs');
        expect(mediaRefusalText(body, true, 'x')).toBe('výzkum nemá osobu P0042');
        setLanguage('de');
        expect(mediaRefusalText(body, true, 'x')).toBe('die Forschung hat keine Person P0042');
    });

    it('counts with the plural of each language', () => {
        const small = (n: string) => ({ error: `${n} bytes — too small`, code: 'media.too-small', params: { name: 'a.jpg', bytes: n } });
        expect(mediaRefusalText(small('1'), true, '')).toBe('the file is too small to be complete (1 byte)');
        expect(mediaRefusalText(small('3'), true, '')).toBe('the file is too small to be complete (3 bytes)');
        setLanguage('cs');
        expect(mediaRefusalText(small('3'), true, '')).toBe('soubor je příliš malý, aby byl celý (3 bajty)');
        expect(mediaRefusalText(small('7'), true, '')).toBe('soubor je příliš malý, aby byl celý (7 bajtů)');
        const full = { error: 'the batch has 2 files already', code: 'batch.full-files', params: { batch: 'b-1', files: '2' } };
        expect(mediaRefusalText(full, true, '')).toBe('dávka už má 2 soubory, víc nebere');
        setLanguage('de');
        expect(mediaRefusalText(full, true, '')).toBe('der Stapel hat bereits 2 Dateien, mehr nimmt er nicht an');
    });

    it('every code of the research has a text in every language, never its English sentence', () => {
        for (const lang of ['en', 'cs', 'de'] as const) {
            setLanguage(lang);
            for (const code of CODES) {
                const text = mediaRefusalText({ error: ENGLISH, code, text: ENGLISH, params: PARAMS }, true, 'fallback');
                expect(text, `${lang} ${code}`).not.toBe(ENGLISH);
                expect(text, `${lang} ${code}`).not.toBe('fallback');
                expect(text.length, `${lang} ${code}`).toBeGreaterThan(5);
            }
        }
    });
});

describe('the research\'s own sentence, as before', () => {
    const coded = { error: 'žádná osoba P0042', code: 'media.no-person', params: { person: 'P0042' } };

    it('a research without media.codes: its error, even with a code', () => {
        expect(mediaRefusalText(coded, false, 'HTTP 404')).toBe('žádná osoba P0042');
    });

    it('an unknown code, media.refused (its reason is the sentence) or a param missing: its error', () => {
        expect(mediaRefusalText({ error: ENGLISH, code: 'media.something-new' }, true, 'x')).toBe(ENGLISH);
        expect(mediaRefusalText({ error: ENGLISH, code: 'media.refused' }, true, 'x')).toBe(ENGLISH);
        expect(mediaRefusalText({ error: ENGLISH, code: 'media.no-person' }, true, 'x')).toBe(ENGLISH);
        expect(mediaRefusalText({ error: ENGLISH, code: 'media.too-small', params: { bytes: 'many' } }, true, 'x')).toBe(ENGLISH);
    });

    it('no code: its error; nothing at all: the fallback', () => {
        expect(mediaRefusalText({ error: 'no' }, true, 'HTTP 404')).toBe('no');
        expect(mediaRefusalText(null, true, 'HTTP 404')).toBe('HTTP 404');
        expect(mediaRefusalText({}, true, 'HTTP 500')).toBe('HTTP 500');
        expect(mediaRefusalText({ code: 'media.something-new' }, true, 'HTTP 400')).toBe('HTTP 400');
    });

    it('a ZIP\'s refused file: its why', () => {
        expect(mediaRefusalText({ path: 'a/b.exe', why: 'a program' }, true, '')).toBe('a program');
    });
});

describe('the reply is untrusted', () => {
    it('keeps only well-formed codes and short string or number params', () => {
        expect(parseMediaRefusal({ error: 'x', code: 'Media.NoPerson<script>', params: { person: { a: 1 }, n: 3, s: 'y'.repeat(500) } }))
            .toEqual({ error: 'x', code: '', params: { n: '3', s: 'y'.repeat(80) } });
        expect(parseMediaRefusal([1, 2])).toBeNull();
        expect(parseMediaRefusal('error')).toBeNull();
    });
});

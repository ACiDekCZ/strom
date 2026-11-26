/**
 * Material of a house (spec 030 §7): the body of `POST /houses/material` from the dialog's fields (the witness's
 * name only with consent, else "family memory" without a name; the name after the farm only when changed), the
 * sentences of a refused write and the rows of the house's materials.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { houseMaterialError, houseMaterialRequest, houseMaterialRowHtml } from '../ui/house-material-ui.js';
import { sendHouseMaterial } from '../house-bridge.js';
import { setLanguage } from '../strings.js';

afterEach(() => { setLanguage('cs'); vi.unstubAllGlobals(); });

const KEY = 'belokamen|16';
const fields = (f: Partial<Parameters<typeof houseMaterialRequest>[1]> = {}) =>
    ({ memory: '', witness: '', consent: false, name: '', nameWas: '', ...f });
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('houseMaterialRequest', () => {
    it('a memory without consent: no witness, witnessConsent false', () => {
        expect(houseMaterialRequest(KEY, fields({ memory: ' Podle starého hospodáře ', witness: 'Libuše Kvitelková' })))
            .toEqual({ house: KEY, memory: { text: 'Podle starého hospodáře', witnessConsent: false } });
    });

    it('a memory with consent carries the witness', () => {
        expect(houseMaterialRequest(KEY, fields({ memory: 'U Prouzalů', witness: 'Libuše Kvitelková', consent: true })))
            .toEqual({ house: KEY, memory: { text: 'U Prouzalů', witness: 'Libuše Kvitelková', witnessConsent: true } });
        // Consent without a name says nothing more.
        expect(houseMaterialRequest(KEY, fields({ memory: 'U Prouzalů', consent: true })))
            .toEqual({ house: KEY, memory: { text: 'U Prouzalů', witnessConsent: false } });
    });

    it('the name after the farm only when changed; nothing to send: null', () => {
        expect(houseMaterialRequest(KEY, fields({ name: 'U Prouzalů', nameWas: 'U Prouzalů' }))).toBeNull();
        expect(houseMaterialRequest(KEY, fields({ name: 'U Kvitelků', nameWas: 'U Prouzalů' }))).toEqual({ house: KEY, name: 'U Kvitelků' });
        expect(houseMaterialRequest(KEY, fields({ witness: 'Libuše', consent: true }))).toBeNull();
    });

    it('goes to POST /houses/material as it is', async () => {
        const calls: { url: string; body: unknown }[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, body: JSON.parse(String(init.body)) });
            return new Response(JSON.stringify({ house: null, materials: [{ id: 'I0007' }], head: 'a'.repeat(12), parent: 'b'.repeat(12) }), { status: 200 });
        }));
        const body = houseMaterialRequest(KEY, fields({ memory: 'U Prouzalů', witness: 'Libuše Kvitelková' }))!;
        const r = await sendHouseMaterial('http://127.0.0.1:5998/tok', body, ['house', 'house.material']);
        expect(r.ok).toBe(true);
        expect(calls[0].url).toMatch(/^http:\/\/127\.0\.0\.1:5998\/tok\/houses\/material/);
        expect(calls[0].body).toEqual({ house: KEY, memory: { text: 'U Prouzalů', witnessConsent: false } });
    });
});

describe('houseMaterialError', () => {
    const refusal = (code: string, reason = '') => ({ ok: false as const, code: code as never, status: 400, reason, bridgeCode: '' });

    it('the town without a place in the research, an archive, the usual ones', () => {
        setLanguage('en');
        expect(houseMaterialError(refusal('town'), () => '')).toBe('The research has no record of this town yet; material can be attached once the town is among its places.');
        expect(houseMaterialError(refusal('archive'), () => '')).toBe('An archive does not take material.');
        expect(houseMaterialError(refusal('locked'), () => '')).toBe('Not recorded: another session holds the tree in the research.');
        expect(houseMaterialError(refusal('busy'), () => '')).toBe('The research is busy right now; not recorded. It works again in a moment.');
        expect(houseMaterialError(refusal('held'), () => 'held')).toBe('held');
        expect(houseMaterialError(refusal('unknown', 'why'), () => '')).toBe('why');
    });

    it('impersonal in every language', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            setLanguage(lang);
            for (const c of ['town', 'archive']) expect(houseMaterialError(refusal(c), () => '')).not.toMatch(/\b(you|your|vy|váš|vaše|Sie|Ihr|du|ty)\b/i);
        }
    });
});

describe('houseMaterialRowHtml', () => {
    it('a memory: family memory with the witness or without a name; a photo; own research', () => {
        setLanguage('cs');
        expect(text(houseMaterialRowHtml({ id: 'I1', kind: 'memory', title: 'Podle hospodáře', at: '2026-11-26' }, 'cs')))
            .toBe('✎ Vzpomínka: Podle hospodáře · 26. 11. 2026 rodinná paměť · pamětník neuveden text');
        expect(text(houseMaterialRowHtml({ id: 'I2', kind: 'memory', witness: 'Libuše Kvitelková' }, 'cs')))
            .toBe('✎ Vzpomínka rodinná paměť · vyprávění: Libuše Kvitelková text');
        expect(text(houseMaterialRowHtml({ id: 'I3', kind: 'file', title: 'Dům kolem 1930', file: 'dum-1930.jpg', at: '2026-11-20' }, 'cs')))
            .toBe('▣ Dům kolem 1930 · 20. 11. 2026 dum-1930.jpg foto');
        expect(text(houseMaterialRowHtml({ id: 'I4', kind: 'own-research', file: 'reserse-cp16.md' }, 'cs')))
            .toBe('▤ Vlastní rešerše reserse-cp16.md soubor');
    });
});

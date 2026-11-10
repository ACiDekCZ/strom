/**
 * GitHub #13: on plain http at a network address (not localhost) the browser
 * has no `crypto.subtle`, and every password used to be reported as
 * "Incorrect password". Only an AES-GCM authentication failure is a wrong
 * password now; missing Web Crypto says encryption needs https or localhost,
 * and any other failure gets the generic message.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    encrypt, decrypt, CryptoSession, classifyCryptoError, isCryptoAvailable,
    CryptoUnavailableError, WrongPasswordError, EncryptedData
} from '../crypto.js';
import { cryptoErrorText, cryptoFailureText, resetPasswordError, requireCrypto } from '../crypto-errors.js';
import { setLanguage, Language } from '../strings.js';

/** Make the context insecure the way a browser does: no `crypto.subtle`. */
const realCrypto = globalThis.crypto;
function dropSubtle(): void {
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
}

/** A dialog error line stand-in (no DOM needed). */
function errorLine(): HTMLElement {
    return { textContent: '', style: { display: 'none' } } as unknown as HTMLElement;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    CryptoSession.lock();
    setLanguage('en');
});

describe('a wrong password is an AES-GCM refusal only', () => {
    it('decrypt with another password throws WrongPasswordError', async () => {
        const enc = await encrypt('data', 'right-password');
        const err = await decrypt(enc, 'wrong-password').catch(e => e);
        expect(err).toBeInstanceOf(WrongPasswordError);
        expect(classifyCryptoError(err)).toBe('wrong-password');
        expect(cryptoErrorText(err)).toBe('Incorrect password');
    });

    it('the session key against data of another key is a wrong password too', async () => {
        const enc = await encrypt('data', 'other-password');
        await CryptoSession.unlock('session-password');
        const err = await CryptoSession.decrypt(enc).catch(e => e);
        expect(classifyCryptoError(err)).toBe('wrong-password');
    });

    it('a non-OperationError from the decrypt step is not a wrong password', async () => {
        const enc = await encrypt('data', 'right-password');
        vi.spyOn(crypto.subtle, 'decrypt').mockRejectedValue(new TypeError('boom'));
        const err = await decrypt(enc, 'right-password').catch(e => e);
        expect(err).toBeInstanceOf(TypeError);
        expect(classifyCryptoError(err)).toBe('error');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(cryptoErrorText(err)).toBe('Failed to decrypt data');
        expect(cryptoErrorText(err, 'encrypt')).toBe('Failed to encrypt data');
    });

    it('corrupt data (not base64, not JSON) is an error, not a wrong password', async () => {
        const broken: EncryptedData = { encrypted: true, version: 1, salt: '!!', iv: '!!', data: '!!' };
        expect(classifyCryptoError(await decrypt(broken, 'x').catch(e => e))).toBe('error');
        expect(classifyCryptoError(new SyntaxError('Unexpected token'))).toBe('error');
        expect(classifyCryptoError(new Error('Session is locked - unlock first'))).toBe('error');
    });
});

describe('no Web Crypto outside a secure context', () => {
    it('is detected from a missing crypto.subtle and from isSecureContext=false', () => {
        expect(isCryptoAvailable()).toBe(true);
        dropSubtle();
        expect(isCryptoAvailable()).toBe(false);
        vi.unstubAllGlobals();
        vi.stubGlobal('isSecureContext', false);
        expect(isCryptoAvailable()).toBe(false);
    });

    it('encrypt, decrypt and unlock throw CryptoUnavailableError, never a wrong password', async () => {
        const enc = await encrypt('data', 'right-password');
        dropSubtle();
        for (const run of [
            () => decrypt(enc, 'right-password'),
            () => encrypt('data', 'right-password'),
            () => CryptoSession.unlock('right-password'),
        ]) {
            const err = await run().catch(e => e);
            expect(err).toBeInstanceOf(CryptoUnavailableError);
            expect(classifyCryptoError(err)).toBe('unavailable');
            expect(cryptoErrorText(err)).not.toBe('Incorrect password');
        }
    });

    it('even a raw TypeError from the missing API reads as unavailable', () => {
        dropSubtle();
        expect(classifyCryptoError(new TypeError("Cannot read properties of undefined (reading 'importKey')"))).toBe('unavailable');
    });

    it('the notice says https or localhost in all four languages', () => {
        const expected: Record<Language, string> = {
            en: 'Encryption works only over https or on this computer (localhost). This address is not secure.',
            cs: 'Šifrování funguje jen přes https nebo na tomto počítači (localhost). Tato adresa není zabezpečená.',
            de: 'Verschlüsselung funktioniert nur über https oder auf diesem Computer (localhost). Diese Adresse ist nicht sicher.',
            pl: 'Szyfrowanie działa tylko przez https lub na tym komputerze (localhost). Ten adres nie jest bezpieczny.',
        };
        for (const lang of Object.keys(expected) as Language[]) {
            setLanguage(lang);
            expect(cryptoFailureText('unavailable')).toBe(expected[lang]);
            expect(cryptoFailureText('unavailable')).not.toBe(cryptoFailureText('wrong-password'));
            expect(cryptoFailureText('error')).not.toBe(cryptoFailureText('wrong-password'));
            expect(cryptoFailureText('error', 'encrypt')).not.toBe(cryptoFailureText('wrong-password'));
        }
    });

    it('a password dialog shows the notice as it opens, and refuses a submit', () => {
        const line = errorLine();
        expect(resetPasswordError(line)).toBe(true);
        expect(line.style.display).toBe('none');
        dropSubtle();
        expect(resetPasswordError(line)).toBe(false);
        expect(line.style.display).toBe('block');
        expect(line.textContent).toContain('localhost');
        const submit = errorLine();
        expect(requireCrypto(submit)).toBe(false);
        expect(submit.textContent).toContain('https');
    });
});

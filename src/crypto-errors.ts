/**
 * Texts for failed encryption steps. Only an AES-GCM authentication failure
 * is an incorrect password; missing Web Crypto (an insecure address, e.g.
 * plain http on a network IP) and any other error say what really happened.
 */

import { strings } from './strings.js';
import { classifyCryptoError, isCryptoAvailable, CryptoFailure } from './crypto.js';

/** The message for a failure; `op` picks the generic text for other errors. */
export function cryptoFailureText(failure: CryptoFailure, op: 'decrypt' | 'encrypt' = 'decrypt'): string {
    const e = strings.encryption;
    if (failure === 'wrong-password') return e.wrongPassword;
    if (failure === 'unavailable') return e.insecureContext;
    return op === 'encrypt' ? e.encryptionFailed : e.decryptionFailed;
}

/** The message for a thrown error (see `classifyCryptoError`). */
export function cryptoErrorText(err: unknown, op: 'decrypt' | 'encrypt' = 'decrypt'): string {
    if (classifyCryptoError(err) === 'error') console.error('Encryption step failed', err);
    return cryptoFailureText(classifyCryptoError(err), op);
}

/**
 * Prepare a password dialog's error line when it opens: outside a secure
 * context it says right away that encryption cannot work at this address,
 * otherwise it is emptied and hidden. True when encryption is available.
 */
export function resetPasswordError(error: HTMLElement | null): boolean {
    const available = isCryptoAvailable();
    if (error) {
        error.textContent = available ? '' : strings.encryption.insecureContext;
        error.style.display = available ? 'none' : 'block';
    }
    return available;
}

/** Show the insecure-address notice in a dialog's error line. False when encryption is unavailable. */
export function requireCrypto(error: HTMLElement | null): boolean {
    if (isCryptoAvailable()) return true;
    if (error) {
        error.textContent = strings.encryption.insecureContext;
        error.style.display = 'block';
    }
    return false;
}

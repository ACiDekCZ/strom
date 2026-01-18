/**
 * Crypto Module Tests
 *
 * Tests for encryption/decryption functionality:
 * - Encrypt/decrypt roundtrip
 * - Wrong password handling
 * - isEncrypted type guard
 * - Edge cases
 */

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, isEncrypted, EncryptedData } from '../crypto.js';

describe('encrypt and decrypt', () => {
    it('roundtrip works with simple text', async () => {
        const original = 'Hello, World!';
        const password = 'test-password-123';

        const encrypted = await encrypt(original, password);
        const decrypted = await decrypt(encrypted, password);

        expect(decrypted).toBe(original);
    });

    it('roundtrip works with JSON data', async () => {
        const original = JSON.stringify({
            persons: { p1: { id: 'p1', firstName: 'Jan', lastName: 'Novák' } },
            partnerships: {}
        });
        const password = 'secure-password';

        const encrypted = await encrypt(original, password);
        const decrypted = await decrypt(encrypted, password);

        expect(decrypted).toBe(original);
        expect(JSON.parse(decrypted)).toEqual(JSON.parse(original));
    });

    it('roundtrip works with Czech characters', async () => {
        const original = 'Příliš žluťoučký kůň úpěl ďábelské ódy';
        const password = 'heslo123';

        const encrypted = await encrypt(original, password);
        const decrypted = await decrypt(encrypted, password);

        expect(decrypted).toBe(original);
    });

    it('roundtrip works with empty string', async () => {
        const original = '';
        const password = 'password';

        const encrypted = await encrypt(original, password);
        const decrypted = await decrypt(encrypted, password);

        expect(decrypted).toBe(original);
    });

    it('roundtrip works with very long text', async () => {
        const original = 'A'.repeat(100000);
        const password = 'password';

        const encrypted = await encrypt(original, password);
        const decrypted = await decrypt(encrypted, password);

        expect(decrypted).toBe(original);
    });

    it('throws error with wrong password', async () => {
        const original = 'Secret data';
        const password = 'correct-password';
        const wrongPassword = 'wrong-password';

        const encrypted = await encrypt(original, password);

        await expect(decrypt(encrypted, wrongPassword)).rejects.toThrow('Decryption failed');
    });

    it('throws error with empty password for decrypt', async () => {
        const original = 'Secret data';
        const password = 'correct-password';

        const encrypted = await encrypt(original, password);

        await expect(decrypt(encrypted, '')).rejects.toThrow();
    });

    it('each encryption produces different output (random IV)', async () => {
        const original = 'Same text';
        const password = 'same-password';

        const encrypted1 = await encrypt(original, password);
        const encrypted2 = await encrypt(original, password);

        // Different IV means different encrypted data
        expect(encrypted1.iv).not.toBe(encrypted2.iv);
        expect(encrypted1.data).not.toBe(encrypted2.data);

        // But both decrypt to same result
        expect(await decrypt(encrypted1, password)).toBe(original);
        expect(await decrypt(encrypted2, password)).toBe(original);
    });

    it('each encryption produces different salt', async () => {
        const original = 'Same text';
        const password = 'same-password';

        const encrypted1 = await encrypt(original, password);
        const encrypted2 = await encrypt(original, password);

        expect(encrypted1.salt).not.toBe(encrypted2.salt);
    });
});

describe('isEncrypted', () => {
    it('returns true for valid encrypted data', async () => {
        const encrypted = await encrypt('test', 'password');
        expect(isEncrypted(encrypted)).toBe(true);
    });

    it('returns true for manually constructed valid object', () => {
        const obj: EncryptedData = {
            encrypted: true,
            version: 1,
            salt: 'YWJjZGVmZ2hpamtsbW5vcA==',
            iv: 'YWJjZGVmZ2hpamts',
            data: 'c29tZWVuY3J5cHRlZGRhdGE='
        };
        expect(isEncrypted(obj)).toBe(true);
    });

    it('returns false for null', () => {
        expect(isEncrypted(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isEncrypted(undefined)).toBe(false);
    });

    it('returns false for plain object without encrypted flag', () => {
        expect(isEncrypted({ data: 'test' })).toBe(false);
    });

    it('returns false for object with encrypted=false', () => {
        expect(isEncrypted({
            encrypted: false,
            version: 1,
            salt: 'test',
            iv: 'test',
            data: 'test'
        })).toBe(false);
    });

    it('returns false for object missing version', () => {
        expect(isEncrypted({
            encrypted: true,
            salt: 'test',
            iv: 'test',
            data: 'test'
        })).toBe(false);
    });

    it('returns false for object missing salt', () => {
        expect(isEncrypted({
            encrypted: true,
            version: 1,
            iv: 'test',
            data: 'test'
        })).toBe(false);
    });

    it('returns false for object missing iv', () => {
        expect(isEncrypted({
            encrypted: true,
            version: 1,
            salt: 'test',
            data: 'test'
        })).toBe(false);
    });

    it('returns false for object missing data', () => {
        expect(isEncrypted({
            encrypted: true,
            version: 1,
            salt: 'test',
            iv: 'test'
        })).toBe(false);
    });

    it('returns false for plain StromData (not encrypted)', () => {
        const strom = {
            version: 1,
            persons: {},
            partnerships: {}
        };
        expect(isEncrypted(strom)).toBe(false);
    });

    it('returns false for primitive values', () => {
        expect(isEncrypted('string')).toBe(false);
        expect(isEncrypted(123)).toBe(false);
        expect(isEncrypted(true)).toBe(false);
    });
});

describe('encrypted data structure', () => {
    it('has correct structure', async () => {
        const encrypted = await encrypt('test', 'password');

        expect(encrypted.encrypted).toBe(true);
        expect(typeof encrypted.version).toBe('number');
        expect(encrypted.version).toBe(1);
        expect(typeof encrypted.salt).toBe('string');
        expect(typeof encrypted.iv).toBe('string');
        expect(typeof encrypted.data).toBe('string');
    });

    it('salt and iv are base64 encoded', async () => {
        const encrypted = await encrypt('test', 'password');

        // Base64 pattern (should not throw when decoded)
        expect(() => atob(encrypted.salt)).not.toThrow();
        expect(() => atob(encrypted.iv)).not.toThrow();
        expect(() => atob(encrypted.data)).not.toThrow();
    });

    it('salt has appropriate length (16 bytes = ~24 base64 chars)', async () => {
        const encrypted = await encrypt('test', 'password');
        const saltBytes = atob(encrypted.salt);
        expect(saltBytes.length).toBe(16);
    });

    it('iv has appropriate length (12 bytes = 16 base64 chars)', async () => {
        const encrypted = await encrypt('test', 'password');
        const ivBytes = atob(encrypted.iv);
        expect(ivBytes.length).toBe(12);
    });
});

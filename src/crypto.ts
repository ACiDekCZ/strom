/**
 * Crypto - Web Crypto API utilities for data encryption
 * Uses AES-256-GCM for authenticated encryption with PBKDF2 key derivation
 * Zero dependencies - uses native Web Crypto API
 */

// ==================== TYPES ====================

export interface EncryptedData {
    encrypted: true;
    version: number;
    salt: string;    // base64
    iv: string;      // base64
    data: string;    // base64
}

// ==================== CONSTANTS ====================

const ENCRYPTION_VERSION = 1;
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;  // 128 bits
const IV_LENGTH = 12;    // 96 bits for GCM
const KEY_LENGTH = 256;  // AES-256

// ==================== HELPERS ====================

/**
 * Convert ArrayBuffer to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Generate random bytes
 */
function generateRandomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    // Import password as key material
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    // Derive AES key
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        passwordKey,
        {
            name: 'AES-GCM',
            length: KEY_LENGTH
        },
        false,
        ['encrypt', 'decrypt']
    );
}

// ==================== TYPE GUARDS ====================

/**
 * Check if an object is encrypted data
 */
export function isEncrypted(obj: unknown): obj is EncryptedData {
    if (!obj || typeof obj !== 'object') return false;
    const data = obj as Record<string, unknown>;
    return data.encrypted === true &&
           typeof data.version === 'number' &&
           typeof data.salt === 'string' &&
           typeof data.iv === 'string' &&
           typeof data.data === 'string';
}

// ==================== ENCRYPTION/DECRYPTION ====================

/**
 * Encrypt data with password
 * @param data Plain text data to encrypt
 * @param password User password
 * @returns Encrypted data object
 */
export async function encrypt(data: string, password: string): Promise<EncryptedData> {
    // Generate random salt and IV
    const salt = generateRandomBytes(SALT_LENGTH);
    const iv = generateRandomBytes(IV_LENGTH);

    // Derive key from password
    const key = await deriveKey(password, salt);

    // Encrypt data
    const encryptedBuffer = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv as BufferSource
        },
        key,
        new TextEncoder().encode(data)
    );

    return {
        encrypted: true,
        version: ENCRYPTION_VERSION,
        salt: bufferToBase64(salt.buffer as ArrayBuffer),
        iv: bufferToBase64(iv.buffer as ArrayBuffer),
        data: bufferToBase64(encryptedBuffer)
    };
}

/**
 * Decrypt data with password
 * @param encrypted Encrypted data object
 * @param password User password
 * @returns Decrypted plain text data
 * @throws Error if decryption fails (wrong password)
 */
export async function decrypt(encrypted: EncryptedData, password: string): Promise<string> {
    // Decode base64 values
    const salt = new Uint8Array(base64ToBuffer(encrypted.salt));
    const iv = new Uint8Array(base64ToBuffer(encrypted.iv));
    const data = base64ToBuffer(encrypted.data);

    // Derive key from password
    const key = await deriveKey(password, salt);

    // Decrypt data
    try {
        const decryptedBuffer = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv
            },
            key,
            data
        );

        return new TextDecoder().decode(decryptedBuffer);
    } catch {
        throw new Error('Decryption failed - incorrect password');
    }
}

// ==================== SESSION MANAGEMENT ====================

/**
 * CryptoSession - Manages encryption key in memory for session
 * Key is derived once and kept in memory until lock() is called
 * On page refresh, password prompt appears again (secure)
 */
class CryptoSessionClass {
    private derivedKey: CryptoKey | null = null;
    private currentSalt: Uint8Array | null = null;

    /**
     * Check if session is unlocked
     */
    isUnlocked(): boolean {
        return this.derivedKey !== null;
    }

    /**
     * Unlock session with password
     * Derives and stores key for future encrypt/decrypt operations
     * @param password User password
     * @param salt Optional existing salt (for decrypting existing data)
     */
    async unlock(password: string, salt?: Uint8Array): Promise<void> {
        // Use provided salt or generate new one
        this.currentSalt = salt || generateRandomBytes(SALT_LENGTH);
        this.derivedKey = await deriveKey(password, this.currentSalt);
    }

    /**
     * Lock session - clear key from memory
     */
    lock(): void {
        this.derivedKey = null;
        this.currentSalt = null;
    }

    /**
     * Encrypt data using session key
     * @param data Plain text data to encrypt
     * @returns Encrypted data object
     * @throws Error if session is locked
     */
    async encrypt(data: string): Promise<EncryptedData> {
        if (!this.derivedKey || !this.currentSalt) {
            throw new Error('Session is locked - unlock first');
        }

        const iv = generateRandomBytes(IV_LENGTH);

        const encryptedBuffer = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv as BufferSource
            },
            this.derivedKey,
            new TextEncoder().encode(data)
        );

        return {
            encrypted: true,
            version: ENCRYPTION_VERSION,
            salt: bufferToBase64(this.currentSalt.buffer as ArrayBuffer),
            iv: bufferToBase64(iv.buffer as ArrayBuffer),
            data: bufferToBase64(encryptedBuffer)
        };
    }

    /**
     * Decrypt data using session key
     * @param encrypted Encrypted data object
     * @returns Decrypted plain text data
     * @throws Error if session is locked or decryption fails
     */
    async decrypt(encrypted: EncryptedData): Promise<string> {
        if (!this.derivedKey) {
            throw new Error('Session is locked - unlock first');
        }

        const iv = new Uint8Array(base64ToBuffer(encrypted.iv));
        const data = base64ToBuffer(encrypted.data);

        try {
            const decryptedBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv
                },
                this.derivedKey,
                data
            );

            return new TextDecoder().decode(decryptedBuffer);
        } catch {
            throw new Error('Decryption failed - incorrect password');
        }
    }

    /**
     * Try to decrypt with provided password
     * Returns true if successful, false otherwise
     * Used for password validation
     */
    async tryDecrypt(encrypted: EncryptedData, password: string): Promise<boolean> {
        try {
            await decrypt(encrypted, password);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get current salt (for consistent encryption across all trees)
     */
    getSalt(): Uint8Array | null {
        return this.currentSalt;
    }
}

// Export singleton instance
export const CryptoSession = new CryptoSessionClass();

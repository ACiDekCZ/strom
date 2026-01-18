/**
 * EmbeddedDataEnvelope Unit Tests
 *
 * Tests for:
 * - Type guard functions (isEmbeddedEnvelope)
 * - Export ID generation (generateExportId)
 * - Version compatibility checking
 */

import { describe, it, expect } from 'vitest';
import {
    isEmbeddedEnvelope,
    generateExportId,
    EmbeddedDataEnvelope,
    StromData,
    PersonId,
    PartnershipId,
    STROM_DATA_VERSION
} from '../types.js';

describe('generateExportId', () => {
    it('generates unique IDs', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
            ids.add(generateExportId());
        }
        // All 100 IDs should be unique
        expect(ids.size).toBe(100);
    });

    it('generates IDs with correct prefix', () => {
        const id = generateExportId();
        expect(id.startsWith('exp_')).toBe(true);
    });

    it('generates IDs with timestamp component', () => {
        const before = Date.now();
        const id = generateExportId();
        const after = Date.now();

        // Extract timestamp from ID (format: exp_TIMESTAMP_RANDOM)
        const parts = id.split('_');
        expect(parts.length).toBe(3);

        const timestamp = parseInt(parts[1], 10);
        expect(timestamp).toBeGreaterThanOrEqual(before);
        expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('generates IDs with random suffix', () => {
        const id = generateExportId();
        const parts = id.split('_');
        const randomPart = parts[2];

        // Random part should be 5 characters (from .slice(2, 7))
        expect(randomPart.length).toBe(5);
        // Should be alphanumeric
        expect(/^[a-z0-9]+$/.test(randomPart)).toBe(true);
    });
});

describe('isEmbeddedEnvelope', () => {
    const createValidEnvelope = (): EmbeddedDataEnvelope => ({
        exportId: 'exp_123_abc',
        exportedAt: '2024-01-27T15:00:00.000Z',
        appVersion: '1.0-dev',
        treeName: 'Test Tree',
        data: {
            version: 1,
            persons: {} as Record<PersonId, never>,
            partnerships: {} as Record<PartnershipId, never>
        }
    });

    it('returns true for valid envelope', () => {
        const envelope = createValidEnvelope();
        expect(isEmbeddedEnvelope(envelope)).toBe(true);
    });

    it('returns true for envelope with encrypted data', () => {
        const envelope: EmbeddedDataEnvelope = {
            exportId: 'exp_123_abc',
            exportedAt: '2024-01-27T15:00:00.000Z',
            appVersion: '1.0-dev',
            treeName: 'Test Tree',
            data: {
                encrypted: true,
                salt: 'abc123',
                iv: 'def456',
                data: 'encryptedstring'
            }
        };
        expect(isEmbeddedEnvelope(envelope)).toBe(true);
    });

    it('returns false for null', () => {
        expect(isEmbeddedEnvelope(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isEmbeddedEnvelope(undefined)).toBe(false);
    });

    it('returns false for primitive values', () => {
        expect(isEmbeddedEnvelope('string')).toBe(false);
        expect(isEmbeddedEnvelope(123)).toBe(false);
        expect(isEmbeddedEnvelope(true)).toBe(false);
    });

    it('returns false for empty object', () => {
        expect(isEmbeddedEnvelope({})).toBe(false);
    });

    it('returns false for object missing exportId', () => {
        const envelope = createValidEnvelope();
        const { exportId: _, ...withoutExportId } = envelope;
        expect(isEmbeddedEnvelope(withoutExportId)).toBe(false);
    });

    it('returns false for object missing data', () => {
        const envelope = createValidEnvelope();
        const { data: _, ...withoutData } = envelope;
        expect(isEmbeddedEnvelope(withoutData)).toBe(false);
    });

    it('returns false for object missing appVersion', () => {
        const envelope = createValidEnvelope();
        const { appVersion: _, ...withoutAppVersion } = envelope;
        expect(isEmbeddedEnvelope(withoutAppVersion)).toBe(false);
    });

    it('returns false for legacy format (raw StromData without envelope)', () => {
        const legacyData: StromData = {
            version: 1,
            persons: {} as Record<PersonId, never>,
            partnerships: {} as Record<PartnershipId, never>
        };
        // Legacy data has 'version' but not 'exportId', 'appVersion', etc.
        expect(isEmbeddedEnvelope(legacyData)).toBe(false);
    });

    it('returns true even with extra properties (extensible)', () => {
        const envelope = {
            ...createValidEnvelope(),
            extraProperty: 'should be ignored'
        };
        expect(isEmbeddedEnvelope(envelope)).toBe(true);
    });
});

describe('STROM_DATA_VERSION', () => {
    it('is defined and is a number', () => {
        expect(typeof STROM_DATA_VERSION).toBe('number');
    });

    it('is a positive integer', () => {
        expect(STROM_DATA_VERSION).toBeGreaterThan(0);
        expect(Number.isInteger(STROM_DATA_VERSION)).toBe(true);
    });

    it('current version is 1', () => {
        // This test documents the current version - update when version changes
        expect(STROM_DATA_VERSION).toBe(1);
    });
});

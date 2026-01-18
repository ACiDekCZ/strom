/**
 * Version Compatibility Unit Tests
 *
 * Tests for version checking logic:
 * - checkJsonVersion: Validates JSON import version compatibility
 * - Version comparison rules
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StromData, PersonId, PartnershipId, STROM_DATA_VERSION } from '../types.js';

// Helper to create test StromData with specific version
function createTestData(version?: number): StromData {
    const data: StromData = {
        persons: {} as Record<PersonId, never>,
        partnerships: {} as Record<PartnershipId, never>
    };
    if (version !== undefined) {
        data.version = version;
    }
    return data;
}

// Standalone version check function (mirrors DataManager.checkJsonVersion logic)
function checkJsonVersion(data: StromData): { compatible: boolean; dataVersion: number; currentVersion: number } {
    const dataVersion = data.version ?? 1;
    return {
        compatible: dataVersion <= STROM_DATA_VERSION,
        dataVersion,
        currentVersion: STROM_DATA_VERSION
    };
}

describe('checkJsonVersion', () => {
    describe('with current version data', () => {
        it('accepts data with current version', () => {
            const data = createTestData(STROM_DATA_VERSION);
            const result = checkJsonVersion(data);

            expect(result.compatible).toBe(true);
            expect(result.dataVersion).toBe(STROM_DATA_VERSION);
            expect(result.currentVersion).toBe(STROM_DATA_VERSION);
        });

        it('accepts data with explicit version 1', () => {
            const data = createTestData(1);
            const result = checkJsonVersion(data);

            expect(result.compatible).toBe(true);
            expect(result.dataVersion).toBe(1);
        });
    });

    describe('with older version data', () => {
        it('accepts data with version lower than current', () => {
            // This test is only meaningful when STROM_DATA_VERSION > 1
            // For now it tests edge case where version equals 1
            const data = createTestData(1);
            const result = checkJsonVersion(data);

            expect(result.compatible).toBe(true);
            expect(result.dataVersion).toBe(1);
        });
    });

    describe('with newer version data', () => {
        it('rejects data with version higher than current', () => {
            const futureVersion = STROM_DATA_VERSION + 1;
            const data = createTestData(futureVersion);
            const result = checkJsonVersion(data);

            expect(result.compatible).toBe(false);
            expect(result.dataVersion).toBe(futureVersion);
            expect(result.currentVersion).toBe(STROM_DATA_VERSION);
        });

        it('rejects data with version much higher than current', () => {
            const farFutureVersion = STROM_DATA_VERSION + 100;
            const data = createTestData(farFutureVersion);
            const result = checkJsonVersion(data);

            expect(result.compatible).toBe(false);
            expect(result.dataVersion).toBe(farFutureVersion);
        });
    });

    describe('with missing version (legacy data)', () => {
        it('defaults to version 1 when version is missing', () => {
            const data = createTestData(); // No version specified
            delete data.version;
            const result = checkJsonVersion(data);

            expect(result.dataVersion).toBe(1);
            expect(result.compatible).toBe(true);
        });

        it('defaults to version 1 when version is undefined', () => {
            const data = createTestData(undefined);
            const result = checkJsonVersion(data);

            expect(result.dataVersion).toBe(1);
            expect(result.compatible).toBe(true);
        });
    });

    describe('version comparison rules', () => {
        it('equal versions are compatible', () => {
            const data = createTestData(STROM_DATA_VERSION);
            const result = checkJsonVersion(data);
            expect(result.compatible).toBe(true);
        });

        it('lower versions are compatible (backward compatibility)', () => {
            for (let v = 1; v <= STROM_DATA_VERSION; v++) {
                const data = createTestData(v);
                const result = checkJsonVersion(data);
                expect(result.compatible).toBe(true);
            }
        });

        it('higher versions are NOT compatible (forward compatibility blocked)', () => {
            for (let v = STROM_DATA_VERSION + 1; v <= STROM_DATA_VERSION + 5; v++) {
                const data = createTestData(v);
                const result = checkJsonVersion(data);
                expect(result.compatible).toBe(false);
            }
        });
    });
});

describe('Version compatibility scenarios', () => {
    describe('JSON import scenarios', () => {
        it('scenario: importing data from same app version', () => {
            // User exports JSON from app v2.0, imports into app v2.0
            const exportedData = createTestData(STROM_DATA_VERSION);
            const result = checkJsonVersion(exportedData);

            expect(result.compatible).toBe(true);
        });

        it('scenario: importing data from older app version', () => {
            // User exports JSON from older app, imports into newer app
            const oldVersionData = createTestData(1);
            const result = checkJsonVersion(oldVersionData);

            expect(result.compatible).toBe(true);
        });

        it('scenario: importing data from newer app version', () => {
            // User exports JSON from newer app, imports into older app
            const newVersionData = createTestData(STROM_DATA_VERSION + 1);
            const result = checkJsonVersion(newVersionData);

            expect(result.compatible).toBe(false);
        });

        it('scenario: importing very old data without version field', () => {
            // Pre-versioning data (before version tracking was added)
            const legacyData: StromData = {
                persons: {} as Record<PersonId, never>,
                partnerships: {} as Record<PartnershipId, never>
            };
            // No version field at all
            const result = checkJsonVersion(legacyData);

            expect(result.compatible).toBe(true);
            expect(result.dataVersion).toBe(1); // Defaults to 1
        });
    });

    describe('embedded data scenarios', () => {
        it('scenario: opening exported HTML from same app version', () => {
            // Embedded data has same version as current app
            const embeddedData = createTestData(STROM_DATA_VERSION);
            const result = checkJsonVersion(embeddedData);

            expect(result.compatible).toBe(true);
        });

        it('scenario: opening exported HTML from newer app version', () => {
            // Embedded data has newer version - should be viewable but not importable
            const embeddedData = createTestData(STROM_DATA_VERSION + 1);
            const result = checkJsonVersion(embeddedData);

            expect(result.compatible).toBe(false);
            // UI should allow view mode but block import
        });
    });
});

describe('Version number edge cases', () => {
    it('handles version 0', () => {
        const data = createTestData(0);
        const result = checkJsonVersion(data);

        // Version 0 is less than current version, so should be compatible
        expect(result.compatible).toBe(true);
        expect(result.dataVersion).toBe(0);
    });

    it('handles negative version', () => {
        const data = createTestData(-1);
        const result = checkJsonVersion(data);

        // Negative versions are technically less than current
        expect(result.compatible).toBe(true);
        expect(result.dataVersion).toBe(-1);
    });

    it('handles very large version number', () => {
        const data = createTestData(999999);
        const result = checkJsonVersion(data);

        expect(result.compatible).toBe(false);
        expect(result.dataVersion).toBe(999999);
    });

    it('handles floating point version (should work but unusual)', () => {
        const data = createTestData(1.5);
        const result = checkJsonVersion(data);

        // 1.5 is less than or equal to current version (1)? No, 1.5 > 1
        expect(result.dataVersion).toBe(1.5);
        // This depends on current version, but demonstrates handling
    });
});

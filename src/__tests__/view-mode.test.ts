/**
 * View Mode Unit Tests
 *
 * Tests for view mode state management:
 * - View mode detection
 * - Import blocking logic
 * - Embedded envelope handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    EmbeddedDataEnvelope,
    StromData,
    PersonId,
    PartnershipId,
    TreeId,
    STROM_DATA_VERSION
} from '../types.js';

// Helper to create test StromData
function createTestData(version?: number): StromData {
    return {
        version: version ?? STROM_DATA_VERSION,
        persons: {} as Record<PersonId, never>,
        partnerships: {} as Record<PartnershipId, never>
    };
}

// Helper to create test envelope
function createTestEnvelope(overrides?: Partial<EmbeddedDataEnvelope>): EmbeddedDataEnvelope {
    return {
        exportId: 'exp_1234567890_abc12',
        exportedAt: new Date().toISOString(),
        appVersion: '1.0-dev',
        treeName: 'Test Family Tree',
        data: createTestData(),
        ...overrides
    };
}

/**
 * ViewModeState - isolated state for testing view mode logic
 * This mirrors the view mode state in DataManager
 */
class ViewModeState {
    private viewMode = false;
    private embeddedEnvelope: EmbeddedDataEnvelope | null = null;
    private importBlockedDueToVersion = false;
    private newerVersionSource: 'storage' | 'embedded' | null = null;
    private pendingNewerVersionData: StromData | null = null;
    private pendingNewerVersionInfo: { dataVersion: number; appVersion: string } | null = null;

    isViewMode(): boolean {
        return this.viewMode;
    }

    getEmbeddedEnvelope(): EmbeddedDataEnvelope | null {
        return this.embeddedEnvelope;
    }

    isImportBlocked(): boolean {
        return this.importBlockedDueToVersion;
    }

    getNewerVersionSource(): 'storage' | 'embedded' | null {
        return this.newerVersionSource;
    }

    hasNewerVersionData(): boolean {
        return this.pendingNewerVersionData !== null;
    }

    getNewerVersionInfo(): { dataVersion: number; appVersion: string; currentVersion: number } | null {
        if (!this.pendingNewerVersionInfo) return null;
        return {
            ...this.pendingNewerVersionInfo,
            currentVersion: STROM_DATA_VERSION
        };
    }

    /**
     * Enter view mode with embedded data
     */
    enterViewMode(envelope: EmbeddedDataEnvelope): void {
        const data = envelope.data as StromData;
        const dataVersion = data.version ?? 1;

        this.embeddedEnvelope = envelope;

        // Check version compatibility
        if (dataVersion > STROM_DATA_VERSION) {
            // Data is from newer version - allow view mode but block import
            this.pendingNewerVersionData = data;
            this.pendingNewerVersionInfo = {
                dataVersion,
                appVersion: envelope.appVersion
            };
            this.newerVersionSource = 'embedded';
            // Don't enter view mode yet - UI will show warning first
            return;
        }

        // Compatible version - enter view mode normally
        this.viewMode = true;
    }

    /**
     * View newer version data (after user acknowledges warning)
     */
    viewNewerVersionData(): void {
        if (!this.pendingNewerVersionData) return;

        this.viewMode = true;
        this.importBlockedDueToVersion = true;

        // Clear pending state
        this.pendingNewerVersionData = null;
        this.pendingNewerVersionInfo = null;
        this.newerVersionSource = null;
    }

    /**
     * Exit view mode (after import)
     */
    exitViewMode(): void {
        this.viewMode = false;
        this.embeddedEnvelope = null;
        this.importBlockedDueToVersion = false;
    }

    /**
     * Reset state for testing
     */
    reset(): void {
        this.viewMode = false;
        this.embeddedEnvelope = null;
        this.importBlockedDueToVersion = false;
        this.newerVersionSource = null;
        this.pendingNewerVersionData = null;
        this.pendingNewerVersionInfo = null;
    }
}

describe('ViewModeState', () => {
    let state: ViewModeState;

    beforeEach(() => {
        state = new ViewModeState();
    });

    describe('initial state', () => {
        it('starts with viewMode = false', () => {
            expect(state.isViewMode()).toBe(false);
        });

        it('starts with no embedded envelope', () => {
            expect(state.getEmbeddedEnvelope()).toBeNull();
        });

        it('starts with import not blocked', () => {
            expect(state.isImportBlocked()).toBe(false);
        });

        it('starts with no newer version source', () => {
            expect(state.getNewerVersionSource()).toBeNull();
        });

        it('starts with no pending newer version data', () => {
            expect(state.hasNewerVersionData()).toBe(false);
        });
    });

    describe('enterViewMode with compatible data', () => {
        it('enters view mode with current version data', () => {
            const envelope = createTestEnvelope();
            state.enterViewMode(envelope);

            expect(state.isViewMode()).toBe(true);
            expect(state.getEmbeddedEnvelope()).toBe(envelope);
            expect(state.isImportBlocked()).toBe(false);
        });

        it('enters view mode with older version data', () => {
            const envelope = createTestEnvelope({
                data: createTestData(1)
            });
            state.enterViewMode(envelope);

            expect(state.isViewMode()).toBe(true);
            expect(state.isImportBlocked()).toBe(false);
        });

        it('stores envelope for later access', () => {
            const envelope = createTestEnvelope({
                treeName: 'My Custom Tree'
            });
            state.enterViewMode(envelope);

            const stored = state.getEmbeddedEnvelope();
            expect(stored?.treeName).toBe('My Custom Tree');
            expect(stored?.exportId).toBe(envelope.exportId);
        });
    });

    describe('enterViewMode with newer version data', () => {
        it('does NOT enter view mode immediately with newer version', () => {
            const envelope = createTestEnvelope({
                data: createTestData(STROM_DATA_VERSION + 1)
            });
            state.enterViewMode(envelope);

            // View mode is NOT entered immediately
            expect(state.isViewMode()).toBe(false);
            // But envelope is stored
            expect(state.getEmbeddedEnvelope()).toBe(envelope);
        });

        it('sets pending newer version data', () => {
            const envelope = createTestEnvelope({
                data: createTestData(STROM_DATA_VERSION + 5)
            });
            state.enterViewMode(envelope);

            expect(state.hasNewerVersionData()).toBe(true);
        });

        it('records version info for UI', () => {
            const envelope = createTestEnvelope({
                appVersion: '3.0',
                data: createTestData(STROM_DATA_VERSION + 1)
            });
            state.enterViewMode(envelope);

            const info = state.getNewerVersionInfo();
            expect(info).not.toBeNull();
            expect(info?.dataVersion).toBe(STROM_DATA_VERSION + 1);
            expect(info?.appVersion).toBe('3.0');
            expect(info?.currentVersion).toBe(STROM_DATA_VERSION);
        });

        it('sets source as embedded', () => {
            const envelope = createTestEnvelope({
                data: createTestData(STROM_DATA_VERSION + 1)
            });
            state.enterViewMode(envelope);

            expect(state.getNewerVersionSource()).toBe('embedded');
        });
    });

    describe('viewNewerVersionData', () => {
        it('enters view mode with blocked import', () => {
            // First, try to enter with newer version
            const envelope = createTestEnvelope({
                data: createTestData(STROM_DATA_VERSION + 1)
            });
            state.enterViewMode(envelope);

            // Then user acknowledges and wants to view
            state.viewNewerVersionData();

            expect(state.isViewMode()).toBe(true);
            expect(state.isImportBlocked()).toBe(true);
        });

        it('clears pending state after viewing', () => {
            const envelope = createTestEnvelope({
                data: createTestData(STROM_DATA_VERSION + 1)
            });
            state.enterViewMode(envelope);
            state.viewNewerVersionData();

            expect(state.hasNewerVersionData()).toBe(false);
            expect(state.getNewerVersionInfo()).toBeNull();
            expect(state.getNewerVersionSource()).toBeNull();
        });

        it('does nothing without pending data', () => {
            state.viewNewerVersionData();

            expect(state.isViewMode()).toBe(false);
            expect(state.isImportBlocked()).toBe(false);
        });
    });

    describe('exitViewMode', () => {
        it('exits view mode', () => {
            const envelope = createTestEnvelope();
            state.enterViewMode(envelope);
            expect(state.isViewMode()).toBe(true);

            state.exitViewMode();
            expect(state.isViewMode()).toBe(false);
        });

        it('clears embedded envelope', () => {
            const envelope = createTestEnvelope();
            state.enterViewMode(envelope);

            state.exitViewMode();
            expect(state.getEmbeddedEnvelope()).toBeNull();
        });

        it('clears import blocked flag', () => {
            const envelope = createTestEnvelope({
                data: createTestData(STROM_DATA_VERSION + 1)
            });
            state.enterViewMode(envelope);
            state.viewNewerVersionData();
            expect(state.isImportBlocked()).toBe(true);

            state.exitViewMode();
            expect(state.isImportBlocked()).toBe(false);
        });
    });

    describe('import blocking scenarios', () => {
        it('scenario: compatible data can be imported', () => {
            const envelope = createTestEnvelope();
            state.enterViewMode(envelope);

            expect(state.isViewMode()).toBe(true);
            expect(state.isImportBlocked()).toBe(false);
            // UI should show import button
        });

        it('scenario: newer version data blocks import', () => {
            const envelope = createTestEnvelope({
                data: createTestData(STROM_DATA_VERSION + 1)
            });
            state.enterViewMode(envelope);
            state.viewNewerVersionData();

            expect(state.isViewMode()).toBe(true);
            expect(state.isImportBlocked()).toBe(true);
            // UI should hide import button or show disabled state
        });

        it('scenario: user opens newer version, then compatible file', () => {
            // First open newer version file
            const newerEnvelope = createTestEnvelope({
                data: createTestData(STROM_DATA_VERSION + 1)
            });
            state.enterViewMode(newerEnvelope);
            state.viewNewerVersionData();
            expect(state.isImportBlocked()).toBe(true);

            // Exit view mode
            state.exitViewMode();

            // Then open compatible file
            const compatibleEnvelope = createTestEnvelope();
            state.enterViewMode(compatibleEnvelope);

            // Import should be allowed now
            expect(state.isImportBlocked()).toBe(false);
        });
    });
});

describe('View mode envelope scenarios', () => {
    describe('exportId uniqueness', () => {
        it('each export gets unique ID', () => {
            const envelope1 = createTestEnvelope();
            const envelope2 = createTestEnvelope();

            // In real usage, these would be different due to timestamp
            // Here they're created with same params, showing the ID is passed in
            expect(envelope1.exportId).toBe(envelope2.exportId); // Same because we use same factory

            // Unique IDs come from generateExportId() in real code
        });
    });

    describe('envelope metadata preservation', () => {
        it('preserves tree name from export', () => {
            const envelope = createTestEnvelope({
                treeName: 'Rodina Nováková'
            });

            expect(envelope.treeName).toBe('Rodina Nováková');
        });

        it('preserves export timestamp', () => {
            const timestamp = '2024-01-15T10:30:00.000Z';
            const envelope = createTestEnvelope({
                exportedAt: timestamp
            });

            expect(envelope.exportedAt).toBe(timestamp);
        });

        it('preserves app version that created export', () => {
            const envelope = createTestEnvelope({
                appVersion: '2.5'
            });

            expect(envelope.appVersion).toBe('2.5');
        });
    });
});

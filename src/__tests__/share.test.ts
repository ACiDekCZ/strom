/**
 * Collaboration classification: which surface an opened embedded file gets.
 */

import { describe, it, expect } from 'vitest';
import { classifyShareFile } from '../share.js';
import { EmbeddedDataEnvelope, TreeMetadata, StromData } from '../types.js';

const emptyData: StromData = { persons: {}, partnerships: {} } as StromData;
function envelope(extra: Partial<EmbeddedDataEnvelope> = {}): EmbeddedDataEnvelope {
    return { exportId: 'exp_1', exportedAt: '', appVersion: '1.5.0', treeName: 'T', data: emptyData, ...extra };
}
const someTree = { id: 'tree_1', name: 'Mine' } as TreeMetadata;

describe('classifyShareFile', () => {
    it('plain export stays plain (backwards compatible)', () => {
        expect(classifyShareFile(envelope(), () => null).kind).toBe('plain');
        expect(classifyShareFile(null, () => someTree).kind).toBe('plain');
    });

    it('a sender name or message makes it a welcome file', () => {
        expect(classifyShareFile(envelope({ senderName: 'Milan' }), () => null).kind).toBe('welcome');
        expect(classifyShareFile(envelope({ senderMessage: 'ahoj' }), () => null).kind).toBe('welcome');
    });

    it('a reply to MY tree wins over the welcome screen', () => {
        const result = classifyShareFile(
            envelope({ senderName: 'Strejda', replyToExportId: 'exp_0' }),
            (id) => (id === 'exp_0' ? someTree : null));
        expect(result.kind).toBe('reply');
        if (result.kind === 'reply') expect(result.tree.id).toBe('tree_1');
    });

    it('a reply whose original tree is gone falls back to welcome', () => {
        const result = classifyShareFile(
            envelope({ senderName: 'Strejda', replyToExportId: 'exp_gone' }), () => null);
        expect(result.kind).toBe('welcome');
    });
});

/**
 * TreeManager.formatBytes writes the decimal sign of the UI language: the
 * size in "Memory may not be enough" and the export's estimated size read
 * "46,3 MB" in Czech, German and Polish, "46.3 MB" in English.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TreeManager } from '../tree-manager.js';
import { setLanguage } from '../strings.js';

const MB = 1024 * 1024;

describe('formatBytes decimal sign', () => {
    afterEach(() => setLanguage('en'));

    it('English keeps the point', () => {
        setLanguage('en');
        expect(TreeManager.formatBytes(46.3 * MB)).toBe('46.3 MB');
        expect(TreeManager.formatBytes(1536)).toBe('1.5 KB');
        expect(TreeManager.formatBytes(512)).toBe('512 B');
    });

    it('Czech, German and Polish write a comma', () => {
        for (const lang of ['cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            expect(TreeManager.formatBytes(46.3 * MB)).toBe('46,3 MB');
            expect(TreeManager.formatBytes(40.1 * MB)).toBe('40,1 MB');
            expect(TreeManager.formatBytes(1536)).toBe('1,5 KB');
        }
    });
});

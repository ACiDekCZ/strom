/**
 * The research on this computer names its own link scheme (a second install,
 * e.g. the beta beside production): remembered with the links it announced,
 * forgotten by a later contact that does not name it. Invented data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { noteResearchLinks, announcedResearchLinks, announcedResearchScheme } from '../research-device.js';

function memoryStorage(): Storage {
    const store = new Map<string, string>();
    return {
        get length() { return store.size; },
        clear: () => store.clear(),
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => { store.delete(k); },
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
    };
}

describe('the announced link scheme', () => {
    beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
    afterEach(() => vi.unstubAllGlobals());

    it('none known: strom-research', () => {
        expect(announcedResearchScheme()).toBe('strom-research');
        noteResearchLinks(['open', 'chat']);
        expect(announcedResearchScheme()).toBe('strom-research');
    });

    it('named with the links: kept; a later contact without it, or without links, forgets it', () => {
        noteResearchLinks(['open', 'chat'], 'strom-research-beta');
        expect(announcedResearchLinks()).toEqual(['open', 'chat']);
        expect(announcedResearchScheme()).toBe('strom-research-beta');
        noteResearchLinks(['open']);
        expect(announcedResearchScheme()).toBe('strom-research');
        noteResearchLinks(['open'], 'strom-research-beta');
        noteResearchLinks([], 'strom-research-beta');
        expect(announcedResearchScheme()).toBe('strom-research');
    });

    it('a bad scheme is never kept, nor believed when stored by hand', () => {
        noteResearchLinks(['open'], 'javascript');
        expect(announcedResearchScheme()).toBe('strom-research');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: ['open'], scheme: 'https' }));
        expect(announcedResearchScheme()).toBe('strom-research');
        localStorage.setItem('strom-research-links', '{broken');
        expect(announcedResearchScheme()).toBe('strom-research');
    });
});

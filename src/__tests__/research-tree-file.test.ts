/**
 * The research's tree from a bridge with `ged.stale` (Strom Research 1.30.0):
 * `tree.ged?stale=1` asked only with the feature, and the state the loaded tree
 * holds is the file's head (its headers, else its `_STROM_HEAD`), never the
 * research's head now. Invented data.
 */

import { describe, it, expect } from 'vitest';
import {
    GED_STALE_FEATURE, TREE_GED_TIMEOUT_MS, bridgeGivesStale, staleTreeUrl, treeReplyHeads, treeFileState,
} from '../research-tree-file.js';

const OLD = '3f2a9c1e5b7d';
const NOW = '9b8c7d6e5f40';
const GED = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef/tree.ged';

const headers = (h: Record<string, string>) => (name: string): string | null => {
    const hit = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
    return hit ? h[hit] : null;
};

describe('the feature and the address', () => {
    it('asks for the last built tree only with ged.stale', () => {
        expect(bridgeGivesStale([GED_STALE_FEATURE])).toBe(true);
        expect(bridgeGivesStale(['verify', 'ged.stale'])).toBe(true);
        expect(bridgeGivesStale(['verify'])).toBe(false);
        expect(bridgeGivesStale([])).toBe(false);
        expect(bridgeGivesStale(null)).toBe(false);
        expect(bridgeGivesStale(undefined)).toBe(false);
    });

    it('adds stale=1 and keeps the rest of the address', () => {
        expect(staleTreeUrl(GED)).toBe(`${GED}?stale=1`);
        expect(staleTreeUrl(`${GED}?app=3.26.0`)).toBe(`${GED}?app=3.26.0&stale=1`);
        // Not an address on this computer: left as it is (fetching refuses it anyway).
        expect(staleTreeUrl('https://example.org/tree.ged')).toBe('https://example.org/tree.ged');
    });

    it('waits two minutes for a tree (the first build of a large research)', () => {
        expect(TREE_GED_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
    });
});

describe('the heads of the answer', () => {
    it('reads X-Strom-Head, X-Strom-Stale and X-Strom-Head-Now', () => {
        expect(treeReplyHeads(headers({ 'X-Strom-Head': OLD, 'X-Strom-Stale': '1', 'X-Strom-Head-Now': NOW })))
            .toEqual({ head: OLD, stale: true, headNow: NOW });
    });

    it('nothing said, or not readable (a cross-origin answer without exposed headers)', () => {
        expect(treeReplyHeads(headers({}))).toEqual({ head: null, stale: false, headNow: null });
        expect(treeReplyHeads(() => { throw new Error('no'); })).toEqual({ head: null, stale: false, headNow: null });
    });

    it('a head that is not a commit is not taken', () => {
        expect(treeReplyHeads(headers({ 'X-Strom-Head': 'not a head', 'X-Strom-Stale': 'yes' }))).toEqual({ head: null, stale: false, headNow: null });
    });
});

describe('the state the loaded tree holds', () => {
    it('an older file said by the bridge: its head, a newer one being built', () => {
        const reply = { head: OLD, stale: true, headNow: NOW };
        expect(treeFileState(reply, OLD, NOW)).toEqual({ head: OLD, preparing: true, headNow: NOW });
    });

    it('the file of the head now: its head, nothing being built', () => {
        expect(treeFileState({ head: NOW, stale: false, headNow: null }, NOW, NOW)).toEqual({ head: NOW, preparing: false, headNow: '' });
        // The bridge says it is the newest though the status (asked before) is older: the bridge decides.
        expect(treeFileState({ head: NOW, stale: false, headNow: null }, NOW, OLD)).toEqual({ head: NOW, preparing: false, headNow: '' });
    });

    it('headers not readable: the file\'s _STROM_HEAD, older when it is not the status\'s head', () => {
        const none = { head: null, stale: false, headNow: null };
        expect(treeFileState(none, OLD, NOW)).toEqual({ head: OLD, preparing: true, headNow: NOW });
        expect(treeFileState(none, NOW, NOW)).toEqual({ head: NOW, preparing: false, headNow: '' });
        expect(treeFileState(none, NOW, NOW.toUpperCase())).toEqual({ head: NOW, preparing: false, headNow: '' });
    });

    it('never the status\'s head when the file says its own', () => {
        expect(treeFileState({ head: null, stale: false, headNow: null }, OLD, NOW).head).toBe(OLD);
        expect(treeFileState({ head: OLD, stale: true, headNow: null }, null, NOW)).toEqual({ head: OLD, preparing: true, headNow: NOW });
    });

    it('a file without a head: the status\'s, as before', () => {
        expect(treeFileState({ head: null, stale: false, headNow: null }, null, NOW)).toEqual({ head: NOW, preparing: false, headNow: '' });
    });
});

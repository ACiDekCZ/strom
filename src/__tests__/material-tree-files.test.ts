/**
 * Family tree files in Materials (spec 117 §5–§7): the research's
 * `kind: "tree"` files behind the gate `material.trees`, kept out of sorting,
 * of the bulk actions and of "without a person"; their deletion with the
 * source made from them (`retractSources`, `sourceImpacts`, `blockedBy`,
 * 409 `material.source-live`). Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setLanguage } from '../strings.js';
import {
    parseMaterialFile, materialFileItem, materialCaps, materialActions, deleteMaterialDry, deleteMaterial,
    type MaterialEnv, type MaterialItem,
} from '../materials.js';
import { selectionDeletable, treeFileSource, withoutTreeFiles, deleteBlockedBy, deleteStart, deleteListed, deleteTicked, deleteBothCanGo, deleteChanged } from '../material-delete.js';
import { sortable, sortNeedy } from '../material-sort.js';
import { itemKindFilter, overviewItems } from '../materials-overview.js';

const BASE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
const sha = (n: number) => n.toString(16).padStart(64, '0');

function fakeFetch(answers: [number, unknown][]) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
        const next = answers.shift();
        if (!next) throw new TypeError('connection refused');
        return new Response(JSON.stringify(next[1]), { status: next[0] });
    };
    return { impl, calls };
}

function item(id: string, over: Partial<MaterialItem> = {}): MaterialItem {
    const file = parseMaterialFile({ id, sha: sha(Number(id.slice(1))), name: `${id}.jpg` })!;
    return { ...materialFileItem(file, { batches: [] }), ...over };
}

beforeEach(() => setLanguage('en'));

describe('a family tree file', () => {
    it('is read from kind "tree" and stays outside the kinds', () => {
        const file = parseMaterialFile({ id: 'I0007', sha: sha(7), name: 'strom-ostrovid.ged', kind: 'tree', bytes: 48_000 })!;
        expect(file.tree).toBe(true);
        const it = materialFileItem(file, { batches: [] });
        expect(it.tree).toBe(true);
        expect(it.kind).toBeUndefined();
        expect(itemKindFilter(it)).toBe('tree');
        expect(itemKindFilter(item('I0001'))).toBe('none');
        expect(materialActions(it, {} as never).map(a => a.id)).toEqual(['open']);
    });

    it('needs the gate material.trees beside deleting', () => {
        const env: MaterialEnv = {
            linked: true, onComputer: true, bridgeUp: true,
            features: ['material.list', 'material.assign', 'material.delete', 'source.retract', 'material.trees'],
        } as MaterialEnv;
        expect(materialCaps(env).trees).toBe(true);
        expect(materialCaps({ ...env, features: ['material.list', 'material.trees'] }).trees).toBe(false);
    });

    it('is never sorted, nor bulk-edited beside other files', () => {
        const tree = item('I0007', { tree: true, titled: false });
        const photo = item('I0001', { titled: false });
        expect(sortable(tree)).toBe(false);
        expect(sortNeedy([tree, photo]).map(i => i.key)).toEqual([photo.key]);
        expect(withoutTreeFiles([tree, photo])).toEqual([photo]);
        // Deleting a mixed selection leaves the tree files out; tree files alone are deleted as such.
        expect(selectionDeletable([tree, photo])).toEqual([photo]);
        expect(selectionDeletable([tree])).toEqual([tree]);
    });

    it('with a live source made from it: one at a time (§7), several only those without one', () => {
        const live = { source: 'S0042', via: 'input' as const, title: 'Rodokmen Ostrovid', cited: [], citedCount: 0, inTree: true };
        const withSource = item('I0007', { tree: true });
        withSource.file = { ...withSource.file!, uses: { excerpts: 0, sources: ['S0042'], tasks: 0, of: [live] } };
        const bare = item('I0008', { tree: true });
        expect(treeFileSource(withSource)).toEqual(live);
        expect(treeFileSource(bare)).toBeNull();
        expect(selectionDeletable([withSource])).toEqual([withSource]);
        expect(selectionDeletable([withSource, bare])).toEqual([bare]);
    });
});

describe('a family tree file in the Materials window (§5)', () => {
    it('is never a place in the tree, though its source is: "Used: nowhere", its source on the item', () => {
        const live = { source: 'S0042', via: 'input', title: 'Rodokmen Ostrovid', cited: [], citedCount: 0, inTree: true };
        const tree = parseMaterialFile({ id: 'I0007', sha: sha(7), name: 'strom-ostrovid.ged', kind: 'tree', bytes: 48_000, uses: { excerpts: 0, sources: ['S0042'], tasks: 0, of: [live] } })!;
        const scan = parseMaterialFile({ id: 'I0001', sha: sha(1), name: 'scan.jpg', uses: { excerpts: 0, sources: ['S0042'], tasks: 0, of: [{ ...live, via: 'media' }] } })!;
        const items = overviewItems({ files: [tree, scan], batches: [], people: {}, fetchedAt: 0 }, [], { sourceOf: true });
        const [treeItem, scanItem] = items;
        expect(treeItem.tree).toBe(true);
        expect(treeItem.sourceOf?.map(o => o.source)).toEqual(['S0042']);
        expect(treeItem.uses ?? 0).toBe(0);
        // The file of a source counts the source's place in the tree.
        expect(scanItem.uses).toBe(1);
    });
});

describe('deleting the file and its source (§7)', () => {
    it('the dry run says which sources hold the file; both go with retractSources', async () => {
        const f = fakeFetch([
            [200, { files: ['I0007'], dryRun: true, impacts: [{ id: 'I0007', name: 'strom-ostrovid.ged', blockedBy: ['S0042'] }], confirm: 'signed-1' }],
            [200, {
                files: ['I0007'], retractSources: ['S0042'], dryRun: true, confirm: 'signed-2',
                impacts: [{ id: 'I0007', name: 'strom-ostrovid.ged', blockedBy: ['S0042'] }],
                sourceImpacts: [{ id: 'S0042', title: 'Rodokmen Ostrovid', citations: 3 }],
            }],
            [200, { files: ['I0007'], deleted: ['I0007'], retracted: ['S0042'], impacts: [], head: 'c0ffee000003' }],
        ]);
        const first = await deleteMaterialDry(BASE, ['I0007'], { fetchImpl: f.impl });
        expect(first.ok && deleteBlockedBy(first.value.impacts)).toEqual(['S0042']);
        const dry = await deleteMaterialDry(BASE, ['I0007'], { fetchImpl: f.impl, retractSources: ['S0042'] });
        expect(dry.ok && dry.value.retractSources).toEqual(['S0042']);
        expect(dry.ok && Array.isArray(dry.value.sourceImpacts)).toBe(true);
        const done = await deleteMaterial(BASE, ['I0007'], 'signed-2', { fetchImpl: f.impl, retractSources: ['S0042'] });
        expect(done.ok && done.value.retracted).toEqual(['S0042']);
        expect(f.calls.map(c => c.body)).toEqual([
            { files: ['I0007'], dryRun: true },
            { files: ['I0007'], retractSources: ['S0042'], dryRun: true },
            { files: ['I0007'], retractSources: ['S0042'], confirm: 'signed-2' },
        ]);
    });

    it('409 material.source-live names the sources (a "S1,S2" string or the array)', async () => {
        const f = fakeFetch([
            [409, { error: 'live', code: 'material.source-live', text: 'live', params: { sources: 'S0042,S0043' } }],
            [409, { error: 'live', code: 'material.source-live', text: 'live', sources: ['S0044'] }],
        ]);
        const a = await deleteMaterial(BASE, ['I0007'], 'signed-1', { fetchImpl: f.impl });
        const b = await deleteMaterial(BASE, ['I0007'], 'signed-1', { fetchImpl: f.impl });
        expect(!a.ok && a.live).toEqual(['S0042', 'S0043']);
        expect(!b.ok && b.live).toEqual(['S0044']);
    });

    it('the button needs the source\'s list too; a changed list keeps the last one shown', () => {
        const file = { id: 'I0007', name: 'strom-ostrovid.ged', sha: '', sources: [], excerpts: 0, people: [], links: 0, tasks: [], bytes: 'deleted' as const, sameAs: [] };
        let s = deleteListed(deleteStart(), [file], 'signed-2', [{ id: 'S0042' } as never]);
        s = deleteTicked(s, true);
        expect(deleteBothCanGo(s)).toBe(true);
        expect(deleteBothCanGo(deleteTicked(deleteListed(deleteStart(), [file], 'signed-2'), true))).toBe(false);
        const changed = deleteChanged(s, 'changed', [], []);
        expect(changed.sourceImpacts).toEqual([{ id: 'S0042' }]);
        expect(deleteBothCanGo(changed)).toBe(false);
    });
});

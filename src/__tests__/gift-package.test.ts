/**
 * "Give a family tree" (spec 093 §5, §8, D3, D4, K6.4): the gift package.
 * Its archive (one folder, the files named in the letter's language, a
 * couple's names joined by the language's "and", no character a file system
 * refuses), the living protected once with every output getting the same
 * data (no hidden detail of a living person in any of them, the deceased's
 * sources and photos kept, the recipient's household in full), the steps and
 * their progress (parts left out are missing), the cancel, many packages in
 * one archive with one failing, and the size estimate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDemoTree } from '../demo-tree.js';
import type { PersonId, StromData } from '../types.js';
import { defaultGiftParts, defaultGiftPrivacy, type GiftLang, type GiftParts, type GiftSettings } from '../gift-tree.js';
import {
    buildGiftBatch, buildGiftPackage, estimateGiftSize, giftFileNames, giftStepsFor, GiftOutOfMemory, isOutOfMemory,
    type GiftCoverInfo, type GiftPackageEnv, type GiftProgress,
} from '../gift-package.js';
import { blobBytes, hasUnzip, readZipEntries, unzipTest, zipFiles } from './helpers/zip-read.js';

const P = (key: string) => `demo_${key}` as PersonId;
const NOW = new Date(2026, 11, 20, 14, 0, 0);
const EMAIL = 'eva.test@example.invalid';
const PNG_EVA_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_EVA = `data:image/png;base64,${PNG_EVA_B64}`;
const PNG = `data:image/png;base64,${PNG_B64}`;
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

/** The demo tree (Berg family) with invented sensitive details of the living. */
function sensitiveTree(): StromData {
    const d = getDemoTree();
    const eva = d.persons[P('eva')];
    eva.emails = [EMAIL];
    eva.notes = `Visits every summer.\nE-mail: ${EMAIL}`;
    eva.birthAddress = 'Elm Street 12';
    eva.photo = PNG_EVA;
    const daniel = d.persons[P('daniel')];
    daniel.emails = [EMAIL];
    daniel.birthAddress = 'Harbour Road 7';
    daniel.photo = PNG;
    d.persons[P('thomas')].photo = PNG;
    return d;
}

function settingsFor(recipients: string[], lang: GiftLang = 'en', parts: Partial<GiftParts> = {}, photos = true): GiftSettings {
    return {
        cut: { recipients: recipients.map(P), depth: 2, branches: {} },
        privacy: defaultGiftPrivacy(),
        parts: { ...defaultGiftParts(), ...parts },
        photos,
        letter: { lang, motif: 'xmas', salutation: 'Dear Daniel', message: '[oslovení], merry Christmas.', signature: 'Grandma', date: '2026-12-20' },
    };
}

interface Captured { app: StromData[]; cover: { data: StromData; info: GiftCoverInfo }[]; appOpts: unknown[] }

function testEnv(captured: Captured, extra: Partial<GiftPackageEnv> = {}): GiftPackageEnv {
    return {
        now: NOW,
        app: async (data, opts) => {
            captured.app.push(data);
            captured.appOpts.push(opts);
            return new Blob([`<html><script type="application/json">${JSON.stringify(data)}</script></html>`]);
        },
        png: async () => new Blob([bytesOf(PNG_B64)]),
        cover: (data, info) => {
            captured.cover.push({ data, info });
            return `<html><body>${info.files.map(f => f.path).join('|')}</body></html>`;
        },
        ...extra,
    };
}

const fresh = (): Captured => ({ app: [], cover: [], appOpts: [] });
const dec = new TextDecoder();

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

describe('file names (§5)', () => {
    const one = [{ id: P('daniel'), name: 'Daniel Berg' }];
    const two = [{ id: P('eva'), name: 'Eva Berg' }, { id: P('jonas'), name: 'Jonas Holm' }];

    it('in four languages, a couple joined by the language', () => {
        const cs = giftFileNames('cs', one, 2026);
        expect([cs.zip, cs.folder, cs.start, cs.app, cs.pages, cs.book, cs.fans[0].stem, cs.gedcom]).toEqual([
            'Rodokmen – Daniel Berg – 2026.zip', 'Rodokmen – Daniel Berg', 'Začít zde.html', 'Rodokmen (aplikace).html',
            'Stránky rodiny', 'Kniha rodu.html', 'Vějíř předků', 'Pro jiné programy/Rodokmen.ged',
        ]);
        expect(giftFileNames('en', one, 2026).folder).toBe('Family tree – Daniel Berg');
        expect(giftFileNames('de', one, 2026).start).toBe('Hier beginnen.html');
        expect(giftFileNames('pl', one, 2026).book).toBe('Księga rodu.html');
        expect(giftFileNames('cs', two, 2026).zip).toBe('Rodokmen – Eva Berg a Jonas Holm – 2026.zip');
        expect(giftFileNames('en', two, 2026).folder).toBe('Family tree – Eva Berg and Jonas Holm');
        expect(giftFileNames('de', two, 2026).folder).toBe('Stammbaum – Eva Berg und Jonas Holm');
        expect(giftFileNames('pl', two, 2026).folder).toBe('Drzewo – Eva Berg i Jonas Holm');
        expect(giftFileNames('cs', two, 2026).fans.map(f => f.stem)).toEqual(['Vějíř předků – Eva Berg', 'Vějíř předků – Jonas Holm']);
    });

    it('no character a file system refuses, the typed name keeps .zip', () => {
        const odd = [{ id: P('daniel'), name: 'Da/ni\\el: "B*e?r<g>|' }];
        const n = giftFileNames('en', odd, 2026, ' My/gift: "2026"?.zip ');
        for (const name of [n.zip, n.folder, ...n.fans.map(f => f.stem)]) expect(name).not.toMatch(/[/\\:*?"<>|]/);
        expect(n.zip).toMatch(/\.zip$/);
        expect(n.zip.startsWith('My-gift- -2026')).toBe(true);
        expect(giftFileNames('en', odd, 2026).folder).not.toMatch(/[/\\:*?"<>|]/);
    });
});

describe('one package', () => {
    it('one folder with every part, named in each language; readable by unzip', async () => {
        const expected: Record<GiftLang, string[]> = {
            en: ['Family tree (app).html', 'Family pages/index.html', 'Family book.html', 'Ancestor fan.svg', 'Ancestor fan.png', 'For other programs/Family tree.ged', 'Start here.html'],
            cs: ['Rodokmen (aplikace).html', 'Stránky rodiny/index.html', 'Kniha rodu.html', 'Vějíř předků.svg', 'Vějíř předků.png', 'Pro jiné programy/Rodokmen.ged', 'Začít zde.html'],
            de: ['Stammbaum (App).html', 'Familienseiten/index.html', 'Familienbuch.html', 'Ahnenfächer.svg', 'Ahnenfächer.png', 'Für andere Programme/Stammbaum.ged', 'Hier beginnen.html'],
            pl: ['Drzewo (aplikacja).html', 'Strony rodziny/index.html', 'Księga rodu.html', 'Wachlarz przodków.svg', 'Wachlarz przodków.png', 'Dla innych programów/Drzewo.ged', 'Zacznij tutaj.html'],
        };
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            const r = await buildGiftPackage({ data: sensitiveTree(), settings: settingsFor(['daniel'], lang), treeName: 'Berg', env: testEnv(fresh()) });
            const zip = await blobBytes(r.blob);
            const paths = readZipEntries(zip).map(e => e.path);
            const folder = r.folder;
            expect(paths.every(p => p.startsWith(`${folder}/`))).toBe(true);
            for (const f of expected[lang]) expect(paths).toContain(`${folder}/${f}`);
            // The cover page is the last entry.
            expect(paths[paths.length - 1]).toBe(`${folder}/${expected[lang][6]}`);
            expect(r.fileName).toBe(giftFileNames(lang, [{ id: P('daniel'), name: 'Daniel Berg' }], 2026).zip);
            if (lang === 'cs' && hasUnzip()) expect(unzipTest(zip)).toMatch(/No errors detected/);
        }
    });

    it('a couple: their names in the folder, a fan for each', async () => {
        const r = await buildGiftPackage({ data: sensitiveTree(), settings: settingsFor(['eva', 'jonas'], 'cs'), treeName: 'Berg', env: testEnv(fresh()) });
        expect(r.folder).toBe('Rodokmen – Eva Berg a Jonas Holm');
        expect(r.fileName).toBe('Rodokmen – Eva Berg a Jonas Holm – 2026.zip');
        const paths = [...zipFiles(await blobBytes(r.blob)).keys()];
        expect(paths).toContain(`${r.folder}/Vějíř předků – Eva Berg.svg`);
        expect(paths).toContain(`${r.folder}/Vějíř předků – Jonas Holm.svg`);
    });

    it('the app gets the sender and the message with the salutation in place', async () => {
        const c = fresh();
        await buildGiftPackage({ data: sensitiveTree(), settings: settingsFor(['daniel'], 'en', { pages: false, book: false }), treeName: 'Berg', env: testEnv(c) });
        expect(c.appOpts[0]).toEqual({ treeName: 'Berg', senderName: 'Grandma', senderMessage: 'Dear Daniel, merry Christmas.' });
    });

    it('K6.4: no hidden detail of a living person in any output; the deceased keep sources and photos; the household in full', async () => {
        const c = fresh();
        const r = await buildGiftPackage({ data: sensitiveTree(), settings: settingsFor(['daniel']), treeName: 'Berg', env: testEnv(c) });
        const files = zipFiles(await blobBytes(r.blob));
        const evaPng = bytesOf(PNG_EVA_B64);
        const deadPng = bytesOf(PNG_B64);
        const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
        const HIDDEN = [EMAIL, 'Elm Street', 'Visits every summer', '1946-12-01', '1 DEC 1946', 'December 1946', PNG_EVA_B64];
        const text = (path: string) => dec.decode(files.get(`${r.folder}/${path}`)!);

        // D4: the app and the cover page got the very same protected data.
        expect(c.app).toHaveLength(1);
        expect(c.cover).toHaveLength(1);
        expect(c.cover[0].data).toBe(c.app[0]);
        const outputs: Record<string, string> = {
            app: JSON.stringify(c.app[0]),
            cover: JSON.stringify(c.cover[0].data),
            book: text('Family book.html'),
            fan: text('Ancestor fan.svg'),
            gedcom: text('For other programs/Family tree.ged'),
        };
        const pagePaths = [...files.keys()].filter(p => p.startsWith(`${r.folder}/Family pages/`));
        expect(pagePaths.length).toBeGreaterThan(5);
        outputs.pages = pagePaths.filter(p => /\.(html|js|css|json)$/.test(p)).map(p => dec.decode(files.get(p)!)).join('\n');
        for (const [name, out] of Object.entries(outputs)) {
            for (const h of HIDDEN) expect(out.includes(h), `${h} in ${name}`).toBe(false);
        }
        for (const [path, bytes] of files) expect(same(bytes, evaPng), `the living's photo as ${path}`).toBe(false);

        // The deceased keep their sources and photos.
        for (const name of ['app', 'cover', 'gedcom', 'book']) expect(outputs[name], `sources in ${name}`).toContain('Statsarkivet i Bergen');
        for (const name of ['app', 'cover', 'book']) expect(outputs[name], `photo in ${name}`).toContain(PNG_B64);
        expect(pagePaths.some(p => same(files.get(p)!, deadPng))).toBe(true);
        expect(c.app[0].persons[P('thomas')].photo).toBe(PNG);

        // The recipient's household in full.
        const daniel = c.app[0].persons[P('daniel')];
        expect([daniel.firstName, daniel.lastName, daniel.birthDate, daniel.birthAddress]).toEqual(['Daniel', 'Berg', '1972-05-30', 'Harbour Road 7']);
        expect(outputs.gedcom).toContain('30 MAY 1972');
        expect(outputs.gedcom).toContain('Harbour Road 7');
        for (const name of ['pages', 'book', 'fan']) expect(outputs[name], `Daniel in ${name}`).toContain('Daniel');
    });

    it('without photos no image in any part', async () => {
        const c = fresh();
        const r = await buildGiftPackage({ data: sensitiveTree(), settings: settingsFor(['daniel'], 'en', {}, false), treeName: 'Berg', env: testEnv(c, { png: undefined }) });
        const files = zipFiles(await blobBytes(r.blob));
        expect(Object.values(c.app[0].persons).some(p => p.photo)).toBe(false);
        for (const [path, bytes] of files) {
            expect(/\.(png|jpe?g|webp|gif)$/i.test(path), path).toBe(false);
            if (/\.(html|svg|ged|js)$/.test(path)) expect(dec.decode(bytes).includes(PNG_B64), path).toBe(false);
        }
    });

    it('parts left out are missing from the archive and from the progress', async () => {
        const seen: GiftProgress[] = [];
        const parts = { fan: false, gedcom: false, app: false };
        const r = await buildGiftPackage({
            data: sensitiveTree(), settings: settingsFor(['daniel'], 'en', parts), treeName: 'Berg', env: testEnv(fresh()),
            onProgress: p => seen.push(p),
        });
        const steps = [...new Set(seen.map(p => p.step))];
        expect(steps).toEqual(['cut', 'pages', 'book', 'zip']);
        expect(giftStepsFor({ ...defaultGiftParts(), ...parts })).toEqual(steps);
        expect(seen.every(p => p.stepCount === 4)).toBe(true);
        expect(seen.find(p => p.step === 'book')!.stepIndex).toBe(3);
        // Inside the pages and the book: done of total; each step ends with its size.
        expect(seen.some(p => p.step === 'pages' && p.total! > 0 && p.done === p.total)).toBe(true);
        expect(seen.some(p => p.step === 'book' && p.done! > 0)).toBe(true);
        expect(seen.filter(p => p.size !== undefined).map(p => p.step)).toEqual(steps);
        const paths = [...zipFiles(await blobBytes(r.blob)).keys()].map(p => p.slice(r.folder.length + 1));
        // (The family pages carry images of their own.)
        const top = paths.filter(p => !p.startsWith('Family pages/'));
        expect(top.sort()).toEqual(['Family book.html', 'Start here.html']);
    });

    it('a cancel in the middle ends with an AbortError and nothing else', async () => {
        const ctrl = new AbortController();
        const seen: string[] = [];
        const run = buildGiftPackage({
            data: sensitiveTree(), settings: settingsFor(['daniel']), treeName: 'Berg', signal: ctrl.signal, env: testEnv(fresh()),
            onProgress: p => {
                seen.push(p.step);
                if (p.step === 'pages' && (p.done ?? 0) > 0) ctrl.abort();
            },
        });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
        expect(seen).not.toContain('book');
        expect(seen).not.toContain('zip');
    });

    it('out of memory is a GiftOutOfMemory naming the part', async () => {
        const run = buildGiftPackage({
            data: sensitiveTree(), settings: settingsFor(['daniel']), treeName: 'Berg',
            env: testEnv(fresh(), { app: async () => { throw new RangeError('Invalid array length'); } }),
        });
        await expect(run).rejects.toBeInstanceOf(GiftOutOfMemory);
        await expect(run).rejects.toMatchObject({ part: 'app' });
        expect(isOutOfMemory(new Error('Array buffer allocation failed'))).toBe(true);
        expect(isOutOfMemory(new Error('Not found'))).toBe(false);
    });
});

describe('many packages (D3)', () => {
    const LIGHT = { pages: false, book: false };
    const items = () => ['daniel', 'eva', 'jonas'].map(k => ({ settings: settingsFor([k], 'cs', LIGHT) }));

    it('three people: one archive holding three readable archives; progress person by person', async () => {
        const seen: { person: number; persons: number; name: string }[] = [];
        const r = await buildGiftBatch({
            data: sensitiveTree(), items: items(), treeName: 'Berg', lang: 'cs', env: testEnv(fresh()),
            onProgress: p => seen.push({ person: p.person, persons: p.persons, name: p.name }),
        });
        expect(r.fileName).toBe('Rodokmeny 2026.zip');
        expect(r.rows.map(x => [x.name, x.ok])).toEqual([['Daniel Berg', true], ['Eva Berg', true], ['Jonas Holm', true]]);
        const outer = readZipEntries(await blobBytes(r.blob!));
        expect(outer.map(e => [e.path, e.method])).toEqual([
            ['Rodokmen – Daniel Berg – 2026.zip', 0], ['Rodokmen – Eva Berg – 2026.zip', 0], ['Rodokmen – Jonas Holm – 2026.zip', 0],
        ]);
        for (const [i, e] of outer.entries()) {
            const inner = readZipEntries(e.data).map(x => x.path);
            expect(inner).toContain(`${e.path.replace(/ – 2026\.zip$/, '')}/Začít zde.html`);
            expect(r.rows[i].bytes).toBe(e.size);
        }
        expect([...new Set(seen.map(s => s.person))]).toEqual([1, 2, 3]);
        expect(seen.every(s => s.persons === 3)).toBe(true);
    });

    it('one failing person is noted and the others are made', async () => {
        let calls = 0;
        const env = testEnv(fresh(), {
            app: async (data) => {
                if (++calls === 2) throw new RangeError('Invalid string length');
                return new Blob([JSON.stringify(data)]);
            },
        });
        const r = await buildGiftBatch({ data: sensitiveTree(), items: items(), treeName: 'Berg', lang: 'cs', env });
        expect(r.rows.map(x => x.ok)).toEqual([true, false, true]);
        expect(r.rows[1]).toMatchObject({ name: 'Eva Berg', error: 'memory', part: 'app' });
        const outer = readZipEntries(await blobBytes(r.blob!));
        expect(outer.map(e => e.path)).toEqual(['Rodokmen – Daniel Berg – 2026.zip', 'Rodokmen – Jonas Holm – 2026.zip']);
        for (const e of outer) expect(readZipEntries(e.data).length).toBeGreaterThan(2);
    });

    it('to a folder: each package handed over, no outer archive; the same name twice gets a number', async () => {
        const got: [string, number][] = [];
        const twice = [{ settings: settingsFor(['daniel'], 'en', LIGHT) }, { settings: settingsFor(['daniel'], 'en', LIGHT) }];
        const r = await buildGiftBatch({
            data: sensitiveTree(), items: twice, treeName: 'Berg', lang: 'en', env: testEnv(fresh()),
            onPersonZip: (name, blob) => { got.push([name, blob.size]); },
        });
        expect(r.blob).toBeNull();
        expect(got.map(g => g[0])).toEqual(['Family tree – Daniel Berg – 2026.zip', 'Family tree – Daniel Berg – 2026 (2).zip']);
        expect(got.every(g => g[1] > 0)).toBe(true);
    });

    it('a cancel ends the batch with an AbortError', async () => {
        const ctrl = new AbortController();
        const run = buildGiftBatch({
            data: sensitiveTree(), items: items(), treeName: 'Berg', lang: 'cs', signal: ctrl.signal, env: testEnv(fresh()),
            onProgress: p => { if (p.person === 2) ctrl.abort(); },
        });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('estimateGiftSize (§5)', () => {
    it('without photos not more, without the app less; parts left out count nothing', () => {
        const data = sensitiveTree();
        const s = settingsFor(['daniel']);
        const e = estimateGiftSize(data, s);
        expect(e.withoutPhotos).toBeLessThanOrEqual(e.total);
        expect(e.withoutPhotos).toBeLessThan(e.total);
        expect(e.withoutApp).toBeLessThan(e.total);
        expect(e.total).toBe(Object.values(e.parts).reduce((a, b) => a + b, 0));
        expect(e.photos.count).toBeGreaterThan(0);
        const off = estimateGiftSize(data, settingsFor(['daniel'], 'en', {}, false));
        expect(off.total).toBeLessThanOrEqual(e.total);
        expect(off.total).toBe(e.withoutPhotos);
        const noFan = estimateGiftSize(data, settingsFor(['daniel'], 'en', { fan: false, gedcom: false }));
        expect(noFan.parts.fan).toBe(0);
        expect(noFan.parts.gedcom).toBe(0);
        expect(noFan.total).toBeLessThan(e.total);
        // A deeper cut never estimates smaller.
        const deep = estimateGiftSize(data, { ...s, cut: { ...s.cut, depth: 'all' } });
        expect(deep.total).toBeGreaterThanOrEqual(e.total);
    });

    it('the estimate without the app is of the order of the package made', async () => {
        const s = settingsFor(['daniel'], 'en', { app: false });
        const e = estimateGiftSize(sensitiveTree(), s);
        const r = await buildGiftPackage({ data: sensitiveTree(), settings: s, treeName: 'Berg', env: testEnv(fresh(), { png: undefined }) });
        expect(e.total).toBeGreaterThan(r.bytes / 4);
        expect(e.total).toBeLessThan(r.bytes * 4);
    });
});

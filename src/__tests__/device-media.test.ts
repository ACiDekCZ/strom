import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { b64url, fromB64url, openRequest, sealResponse, sha256Hex, MEDIA_BLOCK, type RequestEnvelope } from '../device/device-crypto';
import { openMediaBody, mediaBlockCount } from '../device/media-blocks';
import { configureGateway, gatewayClockSkew, GatewayError } from '../device/gateway-client';
import { setDeviceKv, memoryKv, savePairing, loadPairing } from '../device/device-store';
import { putDeviceMedia, configureDeviceMedia, forgetBegunMedia, type MediaSender } from '../device/device-media';
import { saveDeviceDraft, loadDeviceDraft, deviceDrafts, devicePhotoCount, discardDevicePhotos, devicePhotosFile, uniqueName } from '../device/device-photos';

const KEY = new Uint8Array(32).map((_, i) => 40 + i);
const DEVICE = 'dv_pychavka';
const NOW = 1_764_000_000_000;

function fakeLocalStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: k => m.get(k) ?? null,
        key: i => [...m.keys()][i] ?? null,
        removeItem: k => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

function bytes(n: number): Uint8Array {
    return new Uint8Array(n).map((_, i) => (i * 17 + 3) & 0xff);
}

interface Seen { url: string; headers: Record<string, string>; meta: Record<string, string>; blocks: number[] }

/** What the fake gateway does with the next request (first first); none: takes it all. */
type Step =
    | { open: number; body: Record<string, unknown> }
    | { sealed: number; body: Record<string, unknown>; h?: Record<string, string> }
    /** Takes the blocks up to this one, then the request ends (200 {have} — or `cut`: no answer at all). */
    | { takeTo: number; cut?: boolean }
    /** Takes it all, but the hash does not hold (409 media.hash, nothing kept). */
    | { badHash: true };

/** The gateway as the research's U9c: blocks kept per file, From checked, the bridge's answer sealed. */
class Gateway {
    seen: Seen[] = [];
    kept = new Map<string, { size: number; blocks: Map<number, Uint8Array> }>();
    steps: Step[] = [];
    asked: string[] = [];
    bridge: (sha: string, file: Uint8Array) => { s: number; body: unknown } = () => ({ s: 200, body: { id: 'I0001' } });

    sealed(nonce: string, s: number, body: unknown, h: Record<string, string> = {}): { status: number; text: string } {
        return {
            status: 200,
            text: JSON.stringify(sealResponse(KEY, DEVICE, nonce, { s, h: { 'Content-Type': 'application/json', ...h }, b: b64url(new TextEncoder().encode(JSON.stringify(body))) })),
        };
    }

    sender(): MediaSender {
        return async (url, headers, body, onProgress) => {
            const raw = new Uint8Array(await body.arrayBuffer());
            onProgress?.(raw.length);
            const sha = url.split('/').pop()!;
            const size = Number(headers['X-Strom-Size']);
            const from = Number(headers['X-Strom-From']);
            const n = headers['X-Strom-Nonce'];
            const opened = openMediaBody(KEY, headers['X-Strom-Device'], Number(headers['X-Strom-Time']), fromB64url(n, 12)!, sha, size, from, raw);
            if (!opened.ok && !opened.meta) return { status: 400, text: JSON.stringify({ code: 'device.bad' }) };
            if (!opened.ok && !('blocks' in opened)) return this.sealed(n, 400, { code: 'device.bad', header: opened.header });
            this.seen.push({ url, headers, meta: opened.headers, blocks: [...opened.blocks.keys()] });
            const step = this.steps.shift();
            if (step && 'open' in step) return { status: step.open, text: JSON.stringify(step.body) };
            if (step && 'sealed' in step) return this.sealed(n, step.sealed, step.body, step.h);
            const kept = this.kept.get(sha) ?? { size, blocks: new Map() };
            if (from > 0 && from !== kept.blocks.size) return this.sealed(n, 409, { code: 'media.from', have: String(kept.blocks.size) });
            if (from === 0) kept.blocks.clear();
            for (const [i, b] of opened.blocks) {
                if (step && 'takeTo' in step && i > step.takeTo) break;
                kept.blocks.set(i, b);
            }
            this.kept.set(sha, kept);
            if (step && 'takeTo' in step && step.cut) throw new GatewayError('network', 0);
            const total = mediaBlockCount(size);
            if (kept.blocks.size < total) return this.sealed(n, 200, { sha, have: kept.blocks.size, size });
            const file = new Uint8Array(size);
            for (const [i, b] of kept.blocks) file.set(b, (i - 1) * MEDIA_BLOCK);
            this.kept.delete(sha);
            if ((step && 'badHash' in step) || sha256Hex(file) !== sha) return this.sealed(n, 409, { code: 'media.hash' });
            const a = this.bridge(sha, file);
            return this.sealed(n, a.s, a.body);
        };
    }

    /** The tunnel: what the gateway has of a file (GET device/media/<sha>). */
    fetch(): typeof fetch {
        return (async (_url: RequestInfo | URL, init: RequestInit = {}) => {
            const env = JSON.parse(String(init.body)) as RequestEnvelope;
            const req = openRequest(KEY, env)!;
            this.asked.push(`${req.m} ${req.p}`);
            const sha = req.p.replace('device/media/', '');
            const kept = this.kept.get(sha);
            const body = kept ? { sha, size: kept.size, have: kept.blocks.size } : { sha, have: 0 };
            const sealed = sealResponse(KEY, DEVICE, env.n, { s: 200, h: { 'Content-Type': 'application/json' }, b: b64url(new TextEncoder().encode(JSON.stringify(body))) });
            return new Response(JSON.stringify(sealed), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as typeof fetch;
    }
}

let gw: Gateway;
const sleeps: number[] = [];

beforeEach(async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    setDeviceKv(memoryKv());
    gw = new Gateway();
    sleeps.length = 0;
    forgetBegunMedia();
    configureGateway(null);
    configureGateway({ now: () => NOW, sleep: async ms => { sleeps.push(ms); }, appVersion: '3.33.0', base: 'http://192.168.1.20:47800', fetch: gw.fetch() });
    configureDeviceMedia({ sender: gw.sender(), noWorker: true });
    await savePairing({
        deviceId: DEVICE, key: KEY, name: 'iPhone · Safari', kind: 'phone',
        computer: { name: 'Pracovna.local', label: 'Pracovna' }, trees: [{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků' }], treeId: 'pychavkovi',
        origin: 'http://192.168.1.20:47800', pairedAt: new Date(NOW).toISOString(),
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
    setDeviceKv(null);
    configureGateway(null);
    configureDeviceMedia(null);
});

const SIZE = MEDIA_BLOCK * 2 + 1000;
const put = (file: Uint8Array, headers: Record<string, string> = {}, onProgress?: (d: number) => void) =>
    putDeviceMedia({ sha: sha256Hex(file), file: new Blob([file as BlobPart], { type: 'image/jpeg' }), headers, onProgress });

describe('PUT /device/media of a device (U9c)', () => {
    it('sends a photo sealed: open headers with Size and From only, the meta block with the allowlist, the bridge answer', async () => {
        const file = bytes(SIZE);
        const progress: number[] = [];
        const res = await put(file, { 'Content-Type': 'image/jpeg', 'X-Strom-Name': 'IMG_2036.jpg', 'X-Strom-Batch': 'b-mlynky', 'X-Strom-Person': 'P0001', Prefer: 'respond-async' }, d => progress.push(d));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: 'I0001' });
        expect(gw.seen).toHaveLength(1);
        const s = gw.seen[0];
        expect(s.url).toBe(`http://192.168.1.20:47800/device/media/${sha256Hex(file)}`);
        expect(Object.keys(s.headers).sort()).toEqual(['Content-Type', 'X-Strom-App-Version', 'X-Strom-Device', 'X-Strom-From', 'X-Strom-Nonce', 'X-Strom-Size', 'X-Strom-Time', 'X-Strom-Tree']);
        expect(s.headers).toMatchObject({ 'X-Strom-Tree': 'pychavkovi', 'X-Strom-Size': String(SIZE), 'X-Strom-From': '0', 'X-Strom-App-Version': '3.33.0' });
        expect(s.meta).toEqual({ 'X-Strom-Name': 'IMG_2036.jpg', 'X-Strom-Batch': 'b-mlynky', 'X-Strom-Person': 'P0001', Prefer: 'respond-async' });
        expect(s.blocks).toEqual([1, 2, 3]);
        expect(progress[progress.length - 1]).toBe(SIZE);
        // Nothing asked through the tunnel for a file sent the first time.
        expect(gw.asked).toEqual([]);
    });

    it('never sends a file of 0 B (media.empty)', async () => {
        await expect(put(new Uint8Array(0))).rejects.toMatchObject({ code: 'media.empty' });
        expect(gw.seen).toHaveLength(0);
    });

    it('evens its clock out after 409 device.clock and seals the file again for the new time', async () => {
        gw.steps.push({ open: 409, body: { code: 'device.clock', now: NOW + 300_000 } });
        const res = await put(bytes(10));
        expect(res.status).toBe(200);
        expect(gw.seen).toHaveLength(2);
        expect(Number(gw.seen[1].headers['X-Strom-Time'])).toBe(NOW + 300_000);
        expect(gatewayClockSkew()).toBe(300_000);
        // A nonce seen may be the browser's own second sending after a cut: what the gateway has is asked first.
        expect(gw.asked).toEqual([`GET device/media/${sha256Hex(bytes(10))}`]);
    });

    it('a request that ended before the last block (200 {have}) goes on from have', async () => {
        gw.steps.push({ takeTo: 1 });
        const res = await put(bytes(SIZE));
        expect(res.status).toBe(200);
        expect(gw.seen.map(s => [s.headers['X-Strom-From'], s.blocks])).toEqual([['0', [1, 2, 3]], ['1', [2, 3]]]);
    });

    it('409 media.from goes on from the gateway\'s have; 400 device.bad {have} too', async () => {
        gw.kept.set(sha256Hex(bytes(SIZE)), { size: SIZE, blocks: new Map() });
        gw.steps.push({ sealed: 409, body: { code: 'media.from', have: '0' } }, { sealed: 400, body: { code: 'device.bad', have: '0' } });
        const res = await put(bytes(SIZE));
        expect(res.status).toBe(200);
        expect(gw.seen).toHaveLength(3);
    });

    it('waits the Retry-After of 429 device.busy (one file of a device at a time), then sends it', async () => {
        gw.steps.push({ sealed: 429, body: { code: 'device.busy' }, h: { 'Retry-After': '5' } });
        const res = await put(bytes(10));
        expect(res.status).toBe(200);
        expect(sleeps).toEqual([5000]);
        expect(gw.seen).toHaveLength(2);
    });

    it('409 media.hash sends the file once more from the start; a second time it is the answer', async () => {
        gw.steps.push({ badHash: true });
        expect((await put(bytes(SIZE))).status).toBe(200);
        expect(gw.seen.map(s => s.headers['X-Strom-From'])).toEqual(['0', '0']);
        gw.seen = [];
        gw.steps.push({ badHash: true }, { badHash: true });
        const res = await put(bytes(SIZE));
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ code: 'media.hash' });
        expect(gw.seen).toHaveLength(2);
    });

    it('cut off on the way: the next time it asks the gateway first and sends only the blocks it lacks', async () => {
        gw.steps.push({ takeTo: 2, cut: true });
        await expect(put(bytes(SIZE))).rejects.toBeInstanceOf(GatewayError);
        const res = await put(bytes(SIZE));
        expect(res.status).toBe(200);
        expect(gw.asked).toEqual([`GET device/media/${sha256Hex(bytes(SIZE))}`]);
        expect(gw.seen.map(s => [s.headers['X-Strom-From'], s.blocks])).toEqual([['0', [1, 2, 3]], ['2', [3]]]);
    });

    it('the gateway has it all (the bridge was away): the meta block alone with From = N', async () => {
        gw.steps.push({ sealed: 502, body: { code: 'bridge.down' } });
        await expect(put(bytes(SIZE))).rejects.toMatchObject({ code: 'bridge.down' });
        const sha = sha256Hex(bytes(SIZE));
        const blocks = new Map<number, Uint8Array>();
        for (let i = 1; i <= 3; i++) blocks.set(i, bytes(SIZE).subarray((i - 1) * MEDIA_BLOCK, Math.min(SIZE, i * MEDIA_BLOCK)));
        gw.kept.set(sha, { size: SIZE, blocks });
        const res = await put(bytes(SIZE));
        expect(res.status).toBe(200);
        expect(gw.seen[1].headers['X-Strom-From']).toBe('3');
        expect(gw.seen[1].blocks).toEqual([]);
    });

    it('gives the bridge refusal inside the seal as its status, and the gateway refusal as an error', async () => {
        gw.bridge = () => ({ s: 415, body: { code: 'media.type' } });
        expect((await put(bytes(5))).status).toBe(415);
        gw.steps.push({ open: 401, body: { code: 'device.unpaired' } });
        await expect(put(bytes(5))).rejects.toBeInstanceOf(GatewayError);
        // Unpaired: the key forgotten (the queue stays).
        expect(await loadPairing()).toBeNull();
    });
});

describe('photos kept on a device', () => {
    const photo = (id: string, name: string, n: number) => ({ id, blob: new Blob([bytes(n) as BlobPart], { type: 'image/jpeg' }), name, type: 'image/jpeg', size: n });

    it('keeps a batch per tree, counts, saves one ZIP of several and discards them all', async () => {
        await saveDeviceDraft({ treeId: 'pychavkovi', name: 'Mlýnky', personId: 'P0001', note: 'Hřbitov', photos: [photo('a', 'IMG_1.jpg', 10), photo('b', 'IMG_1.jpg', 20)] });
        await saveDeviceDraft({ treeId: 'ryzcovi', name: '', personId: '', note: '', photos: [photo('c', 'IMG_2.jpg', 5)] });
        const back = await loadDeviceDraft('pychavkovi');
        expect(back?.photos.map(p => p.size)).toEqual([10, 20]);
        expect(back?.note).toBe('Hřbitov');
        expect(await devicePhotoCount()).toBe(3);
        const file = await devicePhotosFile();
        expect(file?.name).toBe('strom-photos.zip');
        const zipText = new TextDecoder('latin1').decode(new Uint8Array(await file!.blob.arrayBuffer()));
        expect(zipText).toContain('IMG_1.jpg');
        expect(zipText).toContain('IMG_1 (2).jpg');
        expect(await discardDevicePhotos()).toBe(3);
        expect(await deviceDrafts()).toEqual([]);
        expect(await devicePhotosFile()).toBeNull();
    });

    it('drops an emptied batch and names a second copy apart', async () => {
        await saveDeviceDraft({ treeId: 'pychavkovi', name: '', personId: '', note: '', photos: [photo('a', 'x.jpg', 1)] });
        await saveDeviceDraft({ treeId: 'pychavkovi', name: '', personId: '', note: '', photos: [] });
        expect(await loadDeviceDraft('pychavkovi')).toBeNull();
        const taken = new Set<string>();
        expect([uniqueName('a.jpg', taken), uniqueName('a.jpg', taken), uniqueName('a', taken), uniqueName('a', taken)]).toEqual(['a.jpg', 'a (2).jpg', 'a', 'a (2)']);
    });
});

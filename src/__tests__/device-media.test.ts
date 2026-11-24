import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { b64url, fromB64url, sealResponse, sha256Hex, MEDIA_BLOCK } from '../device/device-crypto';
import { openMediaBody } from '../device/media-blocks';
import { configureGateway, gatewayClockSkew, GatewayError } from '../device/gateway-client';
import { setDeviceKv, memoryKv, savePairing, loadPairing } from '../device/device-store';
import { putDeviceMedia, configureDeviceMedia, type MediaSender } from '../device/device-media';
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

interface Seen { url: string; headers: Record<string, string>; meta: Record<string, string>; file: Uint8Array }

/** The gateway's side: the body opened as the research does, the bridge's answer sealed as a tunnel's. */
function gateway(seen: Seen[], answer: (s: Seen) => { status: number; body: unknown } = () => ({ status: 200, body: { s: 200, body: { id: 'I0001' } } })): MediaSender {
    return async (url, headers, body, onProgress) => {
        const raw = new Uint8Array(await body.arrayBuffer());
        onProgress?.(raw.length);
        const sha = url.split('/').pop()!;
        const nonce = fromB64url(headers['X-Strom-Nonce'], 12)!;
        const opened = openMediaBody(KEY, headers['X-Strom-Device'], Number(headers['X-Strom-Time']), nonce, sha, Number(headers['X-Strom-Meta']), raw);
        if (!opened) return { status: 400, text: JSON.stringify({ code: 'device.bad' }) };
        const s: Seen = { url, headers, meta: JSON.parse(new TextDecoder().decode(opened.meta)).h, file: opened.file };
        seen.push(s);
        const a = answer(s);
        if (a.status !== 200) return { status: a.status, text: JSON.stringify(a.body) };
        const inner = a.body as { s: number; body: unknown };
        return {
            status: 200,
            text: JSON.stringify(sealResponse(KEY, DEVICE, headers['X-Strom-Nonce'], {
                s: inner.s, h: { 'Content-Type': 'application/json' }, b: b64url(new TextEncoder().encode(JSON.stringify(inner.body))),
            })),
        };
    };
}

beforeEach(async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    setDeviceKv(memoryKv());
    configureGateway(null);
    configureGateway({ now: () => NOW, sleep: async () => undefined, appVersion: '3.33.0', base: 'http://192.168.1.20:47800' });
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

describe('PUT /device/media of a device', () => {
    it('sends a photo of 1 MiB + 1 sealed: open headers without its name, the meta block with them, the bridge answer', async () => {
        const seen: Seen[] = [];
        configureDeviceMedia({ sender: gateway(seen), noWorker: true });
        const file = bytes(MEDIA_BLOCK + 1);
        const sha = sha256Hex(file);
        const progress: number[] = [];
        const res = await putDeviceMedia({
            sha, file: new Blob([file as BlobPart], { type: 'image/jpeg' }),
            headers: { 'Content-Type': 'image/jpeg', 'X-Strom-Name': 'IMG_2036.jpg', 'X-Strom-Batch': 'b-mlynky', 'X-Strom-Person': 'P0001' },
            onProgress: d => progress.push(d),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: 'I0001' });
        expect(seen).toHaveLength(1);
        const s = seen[0];
        expect(s.url).toBe(`http://192.168.1.20:47800/device/media/${sha}`);
        expect(s.headers['X-Strom-Tree']).toBe('pychavkovi');
        expect(s.headers['X-Strom-Size']).toBe(String(MEDIA_BLOCK + 1));
        expect(s.headers['X-Strom-Batch']).toBe('b-mlynky');
        expect(Object.keys(s.headers).some(k => /name|person/i.test(k))).toBe(false);
        expect(s.meta).toEqual({ 'Content-Type': 'image/jpeg', 'X-Strom-Name': 'IMG_2036.jpg', 'X-Strom-Person': 'P0001', 'X-Strom-App-Version': '3.33.0' });
        expect(s.file).toEqual(file);
        expect(progress[progress.length - 1]).toBe(MEDIA_BLOCK + 1);
    });

    it('sends a file of 0 B as one empty block', async () => {
        const seen: Seen[] = [];
        configureDeviceMedia({ sender: gateway(seen), noWorker: true });
        const res = await putDeviceMedia({ sha: sha256Hex(new Uint8Array(0)), file: new Blob([]), headers: { 'X-Strom-Name': 'empty.txt' } });
        expect(res.status).toBe(200);
        expect(seen[0].file.length).toBe(0);
    });

    it('evens its clock out after 409 device.clock and seals the file again for the new time', async () => {
        const seen: Seen[] = [];
        let first = true;
        configureDeviceMedia({
            noWorker: true,
            sender: gateway(seen, () => {
                if (first) { first = false; return { status: 409, body: { code: 'device.clock', now: NOW + 300_000 } }; }
                return { status: 200, body: { s: 200, body: { id: 'I0002' } } };
            }),
        });
        const file = bytes(10);
        const res = await putDeviceMedia({ sha: sha256Hex(file), file: new Blob([file as BlobPart]), headers: {} });
        expect(res.status).toBe(200);
        expect(seen).toHaveLength(2);
        expect(Number(seen[1].headers['X-Strom-Time'])).toBe(NOW + 300_000);
        expect(gatewayClockSkew()).toBe(300_000);
    });

    it('gives the bridge refusal inside the seal as its status (the batch says it), and the gateway refusal as an error', async () => {
        configureDeviceMedia({ noWorker: true, sender: gateway([], () => ({ status: 200, body: { s: 409, body: { code: 'media.hash' } } })) });
        const res = await putDeviceMedia({ sha: 'ab'.repeat(32), file: new Blob([bytes(5) as BlobPart]), headers: {} });
        expect(res.status).toBe(409);
        configureDeviceMedia({ noWorker: true, sender: gateway([], () => ({ status: 401, body: { code: 'device.unpaired' } })) });
        await expect(putDeviceMedia({ sha: 'ab'.repeat(32), file: new Blob([bytes(5) as BlobPart]), headers: {} })).rejects.toBeInstanceOf(GatewayError);
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

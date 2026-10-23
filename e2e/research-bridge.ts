import { expect, Page, Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { openApp, card } from './helpers.js';

/**
 * A Strom Research bridge answered by page.route (a research that tells what
 * it has: `accepts`, `inbox`, `sends`), and a research tree opened from it —
 * shared by the research sync specs.
 */

export const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
export const HEAD = '3f2a9c1e5b7d';
export const NEW_HEAD = '9b8c7d6e5f40';
export const BRIDGE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';
/** The same bridge after the research started again with a new token (N20, `rotated`). */
export const BRIDGE2 = 'http://127.0.0.1:5998/fedcba9876543210fedcba9876543210';
const cors = { 'access-control-allow-origin': '*' };

export function researchGed(head = HEAD, extra: string[] = []): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 27 SEP 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', '1 NOTE Fíškovi',
        '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '0 @P0003@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 REFN P0003', '2 TYPE strom-research', '1 FAMC @F0001@',
        ...extra,
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
        '0 @S0001@ SOUR', '1 TITL Oddací matrika Čáslav', '1 PAGE fol. 41', '1 REFN S0001', '1 TEXT Josef Fíšek a Anna', '1 _STROM_READ research',
        '0 TRLR',
    ].join('\n');
}

export async function dropFile(page: Page, name: string, content: string): Promise<void> {
    const dataTransfer = await page.evaluateHandle(({ name, content }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([content], name, { type: 'text/plain' }));
        return dt;
    }, { name, content });
    await page.dispatchEvent('#tree-container', 'dragenter', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'dragover', { dataTransfer });
    await page.dispatchEvent('#tree-container', 'drop', { dataTransfer });
}

/** What the fake bridge says and what it got. */
export interface FakeBridge {
    head: string;
    accepts: unknown;
    inbox: { tree: string; at: string; changes: number; sent: string }[];
    sends: { intake: string; at: string; state: string; changes: number; tree: string; sent: string; decidedAt?: string; reason?: string }[];
    lastIntake: { id: string; at: string } | null;
    syncReply: { status: number; body: unknown };
    treeGed: string;
    down: boolean;
    links: string[];
    posts: string[];
    /** The bridge takes this long to answer a send (ms). */
    syncDelayMs?: number;
    /** A write at once (the research's reply has `inbox: false` and no `pending`): the version it makes. */
    onWrite?: (posted: string) => { head: string; ged: string };
    /** The sends asked to be written again (`POST /sync/<R…>/again`), by their marks. */
    againAsks?: string[];
    /** Originals it has (by SHA-256) and the id it gives them. */
    mediaKnown: Map<string, string>;
    /** Every `PUT /media/<sha>`: the hash, the headers it carried and the body's size. */
    mediaPuts: { sha: string; headers: Record<string, string>; bytes: number }[];
    /** Every `GET /media/<sha>` asked. */
    mediaAsks: string[];
    /** Status of a PUT (200 = taken). */
    mediaPutStatus: number;
    /** The body of a PUT turned down (default `{error: 'no'}`; L3: `{error, code, text, params}`). */
    mediaPutReply?: unknown;
    /** Files it can serve in full (`GET /media/<sha>?file=1`); others answer 410. */
    mediaFiles: Map<string, { type: string; body: Buffer }>;
    /** Busy (starting up): every request answers 503 with Retry-After. */
    busy?: boolean;
    /** Every request it got (path, method). */
    seen?: string[];
    /** Every `POST /batch/<id>/done`: the batch and its body. */
    batchDone?: { id: string; body: Record<string, unknown> }[];
    /** Batches it reports in `/status.batches`. */
    batches?: unknown[];
    /** A file it has, sent again with a person or a note: it adds them to its input (`added`, Strom Research 1.12). */
    knownAdds?: boolean;
    /** The research's version it says in `/status` (`strom`). */
    strom?: string;
    /** Tasks waiting for the user (`/status.waiting`). */
    waiting?: unknown[];
    /** What the bridge says it can do (`/status.features`, 1.12.0-rc.20). */
    features?: string[];
    /** More fields of `/status` (e.g. `channel`, `linkScheme`). */
    statusExtra?: Record<string, unknown>;
    /** Stuck (SIGSTOP): `/status` never answers. */
    statusHang?: boolean;
    /** `/status` answers with this code instead (404: an old token). */
    statusCode?: number;
    /** A send fails on the way (the connection drops). */
    syncAbort?: boolean;
    /** More of a written send's answer, made from what was posted (e.g. `ids` by its xrefs). */
    replyExtra?: (posted: string) => Record<string, unknown>;
    /**
     * The research started again with a new token (N20): the old address
     * (BRIDGE) is turned down, the new one (BRIDGE2) answers. Before, BRIDGE2 is turned down.
     */
    rotated?: boolean;
    /**
     * The token rotates right before this request: the next `POST /sync`, a `PUT /media`
     * after this many PUTs, or the next `POST /batch/<id>/done`.
     */
    rotateAt?: 'sync' | 'done' | number;
    /**
     * How an unknown token is turned down: 404 without a body (default — as Strom Research
     * does, so as not to tell the address is a bridge), or this status with a JSON error.
     */
    tokenRefusal?: number;
    /** The phone connection (`/phone*`, spec 012); its summary goes into `/status.phone` when `features` has `phone`. */
    phone?: FakePhone;
    /** Reading a document (`/read*`, spec 013); its readings go into `/status.reads`. */
    read?: FakeRead;
    /**
     * The family's material (`GET /material`, `POST /material/assign|hide`, `?thumb=`, spec 017).
     * Answered per `features`: `material.list`, `material.assign`, `material.thumb`.
     */
    material?: FakeMaterial;
}

/** A reading as `/status.reads` lists it. */
export interface FakeReading {
    id: string; state: string; version: number; at: string; since: string; files: number; pages: number;
    readers: number; done: number; entries: number; name: string; person: string; from: 'app' | 'research';
    /** How long it takes from its start, in seconds (only while running). */
    expectSecs?: number;
}

/** The research's reading of documents, state by state (set `state`/`done` on a reading, then poll). */
export interface FakeRead {
    /** Listed in `/status.reads`, newest first. */
    reads: FakeReading[];
    /** Every `POST /read` body. */
    posts: Record<string, unknown>[];
    /** Every `POST /read/<id>/cancel`. */
    cancels: string[];
    /** Every `POST /read/<id>/again`, with its body. */
    agains: { id: string; body: Record<string, unknown> }[];
    /** `GET /read/<id>` answers (the raw result); others: 404 read.none. */
    results: Map<string, unknown>;
    /** The id the next `POST /read` gives. */
    nextId: string;
    /** `POST /read` turned down: this status and body (and `Retry-After`). */
    startReply?: { status: number; body: unknown; retryAfter?: string };
    /** `POST /read/<id>/cancel` answers this instead of cancelling. */
    cancelReply?: { status: number; body: unknown };
    /** Every page image asked for ("<id>/<n>"). */
    pageAsks: string[];
    /** The name a new reading gets in `/status.reads` (default zapis.jpg; a page the research already had: its hash). */
    readName?: string;
    /** `GET /reads` (the history, P2): its readings; absent = an older research without it (falls through, 404). */
    history?: (FakeReading & { inSource?: boolean })[];
    /** `GET /reads` answers this instead (an archive: 404 read.none). */
    historyReply?: { status: number; body: unknown };
    /** Every `GET /reads`. */
    historyAsks?: number;
}

export const READ_ID = 'D20261019153012-a1b2';

export function fakeRead(init: Partial<FakeRead> = {}): FakeRead {
    return { reads: [], posts: [], cancels: [], agains: [], results: new Map(), nextId: READ_ID, pageAsks: [], ...init };
}

/** `accepts.read` of a research that reads (its fields as the bridge says them). */
export function readAccepts(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { ready: true, readers: 2, types: ['image/jpeg', 'image/png', 'application/pdf'], max: 20 * 1024 * 1024, pages: 10, langs: ['cs', 'en', 'de'], ...extra };
}

/** A paired phone as the research lists it. */
export interface FakePhoneEntry {
    id: string;
    name: string;
    pairedAt: string;
    lastSeenAt: string;
    address: string;
    stale: boolean;
    maybeReplaces?: string[];
}

/** What the fake research says about the phone connection, and what it was asked. */
export interface FakePhone {
    state: 'off' | 'confirm' | 'on' | 'declined' | 'error';
    since: string;
    addresses: { url: string; iface: string; kind: 'wifi' | 'ethernet' | null }[];
    addressChangedAt: string;
    lanSeenAt: string;
    phones: FakePhoneEntry[];
    error: { code: string; detail: string } | null;
    platform: string;
    network: { category: string | null; checkedAt: string } | null;
    firewall: { on: boolean | null; checkedAt: string } | null;
    /** `POST phone/on`: the window shown (`confirm`) or none possible (`no-dialog`). */
    onReply: 'confirm' | 'no-dialog';
    /** The code's end (ISO) for `qr.svg`; default: 10 minutes from the ask. */
    qrExpiresAt?: string;
    /** Every `qr.svg` ask's query (`lang=…&address=…`). */
    qrAsks: string[];
    /** Every POST: `on {"lang":"en"}`, `off`, `remove/<id>`, `restore/<id>`. */
    posts: string[];
    /** Unpaired, still restorable. */
    removed: Map<string, FakePhoneEntry>;
}

/** A phone connection that is off, nothing paired, one address; `init` changes any of it. */
export function fakePhone(init: Partial<FakePhone> = {}): FakePhone {
    return {
        state: 'off', since: '', addresses: [{ url: 'http://192.168.1.23:47800', iface: 'en0', kind: 'wifi' }],
        addressChangedAt: '', lanSeenAt: '', phones: [], error: null, platform: 'darwin', network: null, firewall: null,
        onReply: 'confirm', qrAsks: [], posts: [], removed: new Map(), ...init,
    };
}

/** All three material capabilities (`/status.features`). */
export const MATERIAL_FEATURES = ['material.list', 'material.assign', 'material.thumb'];

/** One material file as the bridge lists it (`GET /material`). */
export interface FakeMaterialFile {
    id: string;
    name: string;
    sha: string;
    mime?: string;
    bytes?: number;
    at?: string;
    from?: string;
    persons: string[];
    batch?: string;
    path?: string;
    notes?: { at?: string; by?: string; text: string }[];
    state?: 'new' | 'processed' | 'skipped';
    sorted?: { as?: string; persons?: string[]; source?: string; reason?: string };
    source?: string;
    here?: boolean;
    title?: string;
    kind?: 'photo' | 'document' | 'record' | 'other';
    date?: string;
    hidden?: { at?: string; by?: string; reason?: 'unrelated' | 'duplicate' };
}

export interface FakeMaterialBatch {
    id: string;
    name: string;
    at?: string;
    done?: string;
    persons?: string[];
    note?: string;
}

/** The research's material, what it was asked and how it misbehaves. */
export interface FakeMaterial {
    files: FakeMaterialFile[];
    batches: FakeMaterialBatch[];
    /** Names of the people it knows (REFN → name); assign accepts only these (and `knownPersons`). */
    people: Record<string, string>;
    knownPersons?: string[];
    /** Every `GET /material` query string ('' = the whole list). */
    asks: string[];
    /** Every `POST /material/assign` and `/hide` body. */
    assigns: Record<string, unknown>[];
    hides: Record<string, unknown>[];
    /** Every preview asked ("<sha>@<px>"). */
    thumbAsks: string[];
    /** The next this many requests to `/material*` answer 409 `material.busy`. */
    busyTimes?: number;
    /** Seconds in `Retry-After` and `retry` of a busy answer (default 0). */
    busyRetry?: number;
    /** Writes answer 403 `material.readonly`. */
    readonly?: boolean;
    /** Previews answer 503 `thumb.busy`. */
    thumbBusy?: boolean;
    /** `GET /material` answers this status (with a refusal body) instead. */
    listStatus?: number;
    /** The state a file had before it was hidden (restored by `hidden: false`). */
    priorState?: Map<string, FakeMaterialFile['state']>;
}

export function fakeMaterial(init: Partial<FakeMaterial> = {}): FakeMaterial {
    return { files: [], batches: [], people: {}, asks: [], assigns: [], hides: [], thumbAsks: [], ...init };
}

/** A stable fake SHA-256 from a seed. */
export function materialSha(seed: string): string {
    return createHash('sha256').update(seed).digest('hex');
}

/** A material file with defaults (an invented JPEG received on 1 Oct 2026). */
export function materialFile(n: number, init: Partial<FakeMaterialFile> = {}): FakeMaterialFile {
    const id = `I${String(n).padStart(4, '0')}`;
    return {
        id, name: `scan-${n}.jpg`, sha: materialSha(id), mime: 'image/jpeg', bytes: 400_000 + n,
        at: new Date(Date.UTC(2026, 9, 1, 8, 0, n % 60)).toISOString(), from: 'the Strom app',
        persons: [], state: 'new', ...init,
    };
}

/**
 * 3000 invented files: one batch of 2600 in folders (some sent to a person,
 * part without anyone) and 400 single files; a few hidden, a few TIFF/PDF.
 */
export function materialFixture3000(): { files: FakeMaterialFile[]; batches: FakeMaterialBatch[]; people: Record<string, string> } {
    const people: Record<string, string> = {
        P0001: 'Jan Novák (1901–1975)', P0002: 'Marie Nováková (*1905)', P0003: 'Karel Novák (1930–1999)',
        P0004: 'Eva Svobodová (1932–2010)', P0005: 'Josef Dvořák',
    };
    const batches: FakeMaterialBatch[] = [
        { id: 'b-box-2600', name: 'Krabice z půdy', at: '2026-10-10T10:00:00.000Z', done: '2026-10-10T11:30:00.000Z', note: 'Půda, 1980' },
    ];
    const folders = ['Dopisy', 'Fotky/1930', 'Fotky/1950', 'Fotky/Svatby', 'Listiny', 'Pohlednice', ''];
    const files: FakeMaterialFile[] = [];
    for (let i = 1; i <= 2600; i++) {
        const folder = folders[i % folders.length];
        const ext = i % 97 === 0 ? 'tif' : i % 53 === 0 ? 'pdf' : 'jpg';
        files.push(materialFile(i, {
            name: `sken-${i}.${ext}`,
            mime: ext === 'tif' ? 'image/tiff' : ext === 'pdf' ? 'application/pdf' : 'image/jpeg',
            batch: 'b-box-2600', path: `${folder ? `${folder}/` : ''}sken-${i}.${ext}`, from: 'batch from the Strom app',
            at: new Date(Date.UTC(2026, 9, 10, 10, Math.floor(i / 60) % 60, i % 60)).toISOString(),
            persons: i % 5 === 0 ? ['P0001'] : i % 7 === 0 ? ['P0002', 'P0003'] : [],
            ...(i % 11 === 0 ? { kind: 'photo' as const } : i % 13 === 0 ? { kind: 'document' as const } : {}),
            ...(i % 17 === 0 ? { title: `Pohled ze Žďáru ${i}` } : {}),
            ...(i % 250 === 0 ? { hidden: { at: '2026-10-11T08:00:00.000Z', by: 'app', reason: 'duplicate' as const }, state: 'skipped' as const } : {}),
        }));
    }
    for (let i = 2601; i <= 3000; i++) {
        files.push(materialFile(i, {
            name: `foto-${i}.jpg`, from: i % 2 ? 'the Strom app' : 'the terminal',
            at: new Date(Date.UTC(2026, 8, 1 + (i % 28), 9, 0, 0)).toISOString(),
            persons: i % 3 === 0 ? ['P0004'] : i % 4 === 0 ? ['P0005'] : [],
            ...(i % 9 === 0 ? { notes: [{ by: 'user', text: `Poznámka k fotce č. ${i}` }] } : {}),
        }));
    }
    return { files, batches, people };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

/** A small PNG of one colour taken from the hash (a preview of a fake file). */
export function materialPng(sha: string, width = 32, height = 24): Buffer {
    const rgb = [0, 2, 4].map(i => parseInt(sha.slice(i, i + 2) || '80', 16));
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

const PERSON_REF = /^P\d{1,7}$/;
const FILE_REF = /^I\d{1,7}$/;

/** The answer to `/material*` (null: not a material path). */
function serveMaterial(b: FakeBridge, method: string, url: URL, postData: string | null):
    { status: number; body: unknown; headers?: Record<string, string> } | null {
    const m = b.material;
    const rest = url.pathname.replace(/^\/[^/]+/, '');
    if (!m || !/^\/material(\/assign|\/hide)?$/.test(rest)) return null;
    const features = b.features ?? [];
    const refusal = (status: number, code: string, params?: Record<string, unknown>) =>
        ({ status, body: { error: code, code, text: code, ...(params ? { params } : {}) } });
    const busy = () => {
        m.busyTimes = (m.busyTimes ?? 0) - 1;
        const retry = m.busyRetry ?? 0;
        return { status: 409, body: { error: 'busy', code: 'material.busy', text: 'busy', retry },
            headers: { 'retry-after': String(retry), 'access-control-expose-headers': 'Retry-After' } };
    };
    const batchOf = (id?: string) => (id ? m.batches.find(x => x.id === id) : undefined);
    const concerns = (f: FakeMaterialFile, p: string) =>
        f.persons.includes(p) || !!f.sorted?.persons?.includes(p) || !!batchOf(f.batch)?.persons?.includes(p);
    const assignOn = features.includes('material.assign');
    const shown = (f: FakeMaterialFile): Record<string, unknown> => {
        if (assignOn) return { ...f };
        // An older research: no title, kind, date nor hidden.
        const { title: _t, kind: _k, date: _d, hidden: _h, ...older } = f;
        return older;
    };
    const peopleOf = (files: FakeMaterialFile[], batches: FakeMaterialBatch[]) => {
        const out: Record<string, string> = {};
        const add = (p: string) => { if (m.people[p]) out[p] = m.people[p]; };
        files.forEach(f => { f.persons.forEach(add); f.sorted?.persons?.forEach(add); });
        batches.forEach(x => x.persons?.forEach(add));
        return out;
    };

    if (rest === '/material') {
        if (method !== 'GET' || !features.includes('material.list')) return { status: 404, body: '' };
        m.asks.push(url.search.replace(/^\?/, '').split('&').filter(q => q && !q.startsWith('app=')).join('&'));
        if ((m.busyTimes ?? 0) > 0) return busy();
        if (m.listStatus) return refusal(m.listStatus, 'material.failed');
        const q = url.searchParams;
        const person = q.get('person');
        const batch = q.get('batch');
        const filesParam = q.get('files');
        if ((person !== null && !PERSON_REF.test(person)) || (batch !== null && !batch.trim())
            || (filesParam !== null && filesParam !== '0' && filesParam !== '1')) {
            return refusal(400, 'material.query');
        }
        let files = m.files;
        if (person) files = files.filter(f => concerns(f, person));
        if (batch) files = files.filter(f => f.batch === batch);
        const batches = m.batches
            .map(x => ({ ...x, files: files.filter(f => f.batch === x.id).length }))
            .filter(x => x.files > 0);
        const listed = filesParam === '0' ? [] : files;
        return { status: 200, body: {
            files: listed.map(shown), batches,
            ...(assignOn ? { people: peopleOf(listed, batches) } : {}),
        } };
    }

    if (method !== 'POST' || !assignOn) return { status: 404, body: '' };
    let body: Record<string, unknown>;
    try { body = JSON.parse(postData ?? ''); } catch { return refusal(400, 'material.body'); }
    if (!body || typeof body !== 'object') return refusal(400, 'material.body');
    (rest === '/material/assign' ? m.assigns : m.hides).push(body);
    if ((m.busyTimes ?? 0) > 0) return busy();
    if (m.readonly) return refusal(403, 'material.readonly');
    const ids = body.files;
    const now = new Date().toISOString();

    if (rest === '/material/hide') {
        if (!Array.isArray(ids) || ids.length === 0 || !ids.every(i => typeof i === 'string' && FILE_REF.test(i))
            || typeof body.hidden !== 'boolean'
            || (body.reason !== undefined && body.reason !== 'unrelated' && body.reason !== 'duplicate')) {
            return refusal(400, 'material.body');
        }
        const files = (ids as string[]).map(id => m.files.find(f => f.id === id));
        const missing = (ids as string[]).find((_, i) => !files[i]);
        if (missing) return refusal(404, 'material.file', { id: missing });
        m.priorState ??= new Map();
        for (const f of files as FakeMaterialFile[]) {
            if (body.hidden) {
                if (!f.hidden) m.priorState.set(f.id, f.state);
                f.hidden = { at: now, by: 'app', ...(body.reason ? { reason: body.reason as 'unrelated' | 'duplicate' } : {}) };
                f.state = 'skipped';
            } else if (f.hidden) {
                delete f.hidden;
                f.state = m.priorState.get(f.id) ?? 'new';
                m.priorState.delete(f.id);
            }
        }
        return { status: 200, body: { files: (files as FakeMaterialFile[]).map(shown), people: peopleOf(files as FakeMaterialFile[], []) } };
    }

    // POST /material/assign
    const add = body.add ?? [];
    const remove = body.remove ?? [];
    const hasFiles = ids !== undefined;
    const hasBatch = body.batch !== undefined;
    if (hasFiles === hasBatch || !Array.isArray(add) || !Array.isArray(remove)
        || (add.length === 0 && remove.length === 0)
        || ![...add, ...remove].every(p => typeof p === 'string' && PERSON_REF.test(p))
        || add.some(p => remove.includes(p))
        || (hasFiles && (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000 || !ids.every(i => typeof i === 'string' && FILE_REF.test(i))))
        || (hasBatch && (typeof body.batch !== 'string' || !body.batch))) {
        return refusal(400, 'material.body');
    }
    const known = new Set([...Object.keys(m.people), ...(m.knownPersons ?? [])]);
    const unknown = [...add, ...remove].find(p => !known.has(p as string));
    if (unknown) return refusal(404, 'material.person', { id: unknown });
    const addP = add as string[];
    const removeP = remove as string[];
    const drop = (f: FakeMaterialFile) => {
        f.persons = f.persons.filter(p => !removeP.includes(p));
        if (f.sorted?.persons) f.sorted.persons = f.sorted.persons.filter(p => !removeP.includes(p));
    };
    if (hasBatch) {
        const batch = batchOf(body.batch as string);
        if (!batch) return refusal(404, 'material.batch', { batch: body.batch });
        batch.persons = [...(batch.persons ?? []).filter(p => !removeP.includes(p)), ...addP.filter(p => !(batch.persons ?? []).includes(p))];
        const files = m.files.filter(f => f.batch === batch.id);
        files.forEach(drop);
        return { status: 200, body: { files: files.map(shown), people: peopleOf(files, [batch]), kept: [] } };
    }
    const files = (ids as string[]).map(id => m.files.find(f => f.id === id));
    const missing = (ids as string[]).find((_, i) => !files[i]);
    if (missing) return refusal(404, 'material.file', { id: missing });
    const kept: { id: string; person: string; batch: string }[] = [];
    for (const f of files as FakeMaterialFile[]) {
        for (const p of addP) if (!f.persons.includes(p)) f.persons.push(p);
        drop(f);
        const batch = batchOf(f.batch);
        for (const p of removeP) if (batch?.persons?.includes(p)) kept.push({ id: f.id, person: p, batch: batch.id });
    }
    const keptBatches = m.batches.filter(x => kept.some(k => k.batch === x.id));
    return { status: 200, body: { files: (files as FakeMaterialFile[]).map(shown), people: peopleOf(files as FakeMaterialFile[], keptBatches), kept } };
}

/** A preview or the file of a material (`GET /media/<sha>?thumb=` / `?file=1`); null: not one. */
function serveMaterialMedia(b: FakeBridge, sha: string, url: URL):
    { status: number; body: unknown; type?: string; headers?: Record<string, string> } | null {
    const m = b.material;
    if (!m) return null;
    const file = m.files.find(f => f.sha === sha);
    const thumb = url.searchParams.get('thumb');
    if (thumb !== null) {
        if (!(b.features ?? []).includes('material.thumb')) return null;
        const px = Number(thumb);
        if (![128, 256, 512].includes(px)) return { status: 400, body: { error: 'size', code: 'thumb.size', text: 'size' } };
        m.thumbAsks.push(`${sha}@${px}`);
        if (m.thumbBusy) {
            return { status: 503, body: { error: 'busy', code: 'thumb.busy', text: 'busy', retry: 1 },
                headers: { 'retry-after': '1', 'access-control-expose-headers': 'Retry-After' } };
        }
        if (!file) return { status: 404, body: { error: 'unknown' } };
        if (file.here === false) return { status: 410, body: { error: 'gone', code: 'media.gone', text: 'gone' } };
        if (!/^(image\/(jpeg|png|heic|heif)|application\/pdf)$/.test(file.mime ?? '')) {
            return { status: 415, body: { error: 'type', code: 'thumb.type', text: 'type' } };
        }
        return { status: 200, body: materialPng(sha, Math.min(px, 64), Math.min(px, 48)), type: 'image/png',
            headers: { 'cache-control': 'private, max-age=86400' } };
    }
    if (url.searchParams.get('file') === '1' && file && !b.mediaFiles.has(sha)) {
        if (file.here === false) return { status: 410, body: { error: 'gone', code: 'media.gone', text: 'gone' } };
        return (file.mime ?? '').startsWith('image/')
            ? { status: 200, body: materialPng(sha, 320, 240), type: 'image/png' }
            : { status: 200, body: Buffer.from(`fake ${file.name}`), type: file.mime ?? 'application/octet-stream' };
    }
    return null;
}

export async function fakeBridge(page: Page, init: Partial<FakeBridge> = {}): Promise<FakeBridge> {
    const b: FakeBridge = {
        head: HEAD,
        accepts: { sync: { auto: 'off' }, sources: true, verified: true, media: null },
        inbox: [], sends: [], lastIntake: null,
        syncReply: { status: 200, body: { ok: true, input: 'I0042', changes: 6, inbox: true } },
        treeGed: researchGed(),
        down: false,
        links: ['send', 'open', 'live', 'app', 'setup'],
        posts: [],
        mediaKnown: new Map(), mediaPuts: [], mediaAsks: [], mediaPutStatus: 200, mediaFiles: new Map(),
        ...init,
    };
    const serve = async (route: Route) => {
        if (b.down) return route.abort('connectionrefused');
        const url = new URL(route.request().url());
        (b.seen ??= []).push(`${route.request().method()} ${url.pathname.replace(/^\/[^/]+/, '')}`);
        if (b.busy && route.request().method() !== 'OPTIONS') {
            return route.fulfill({ status: 503, headers: { ...cors, 'content-type': 'application/json', 'retry-after': '2' }, body: JSON.stringify({ error: 'busy' }) });
        }
        const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (route.request().method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, PUT, POST', 'access-control-allow-headers': '*' } });
        }
        // A new token: the old address turns everything down (as the research does an unknown token:
        // 404 without a body, core/live.ts).
        const method = route.request().method();
        if ((b.rotateAt === 'sync' && method === 'POST' && url.pathname.endsWith('/sync'))
            || (b.rotateAt === 'done' && method === 'POST' && /\/batch\/[^/]+\/done$/.test(url.pathname))
            || (typeof b.rotateAt === 'number' && method === 'PUT' && /\/media\//.test(url.pathname) && b.mediaPuts.length >= b.rotateAt)) {
            b.rotated = true;
            b.rotateAt = undefined;
        }
        if (`${url.origin}/${url.pathname.split('/')[1]}` !== (b.rotated ? BRIDGE2 : BRIDGE)) {
            const code = b.tokenRefusal ?? 404;
            return code === 404 ? route.fulfill({ status: 404, headers: cors, body: '' }) : json(code, { error: 'unknown token' });
        }
        const media = /\/media\/([0-9a-f]{64})$/.exec(url.pathname);
        if (media) {
            const sha = media[1];
            const mat = method === 'GET' ? serveMaterialMedia(b, sha, url) : null;
            if (mat) {
                return Buffer.isBuffer(mat.body)
                    ? route.fulfill({ status: mat.status, headers: { ...cors, 'content-type': mat.type ?? 'application/octet-stream', ...(mat.headers ?? {}) }, body: mat.body })
                    : route.fulfill({ status: mat.status, headers: { ...cors, 'content-type': 'application/json', ...(mat.headers ?? {}) }, body: JSON.stringify(mat.body) });
            }
            if (route.request().method() === 'PUT') {
                const body = route.request().postDataBuffer();
                b.mediaPuts.push({ sha, headers: route.request().headers(), bytes: body?.length ?? 0 });
                if (b.mediaPutStatus !== 200) return json(b.mediaPutStatus, b.mediaPutReply ?? { error: 'no' });
                // Content it has: said so (as the research does), nothing new.
                const prior = b.mediaKnown.get(sha);
                if (prior) {
                    const h = route.request().headers();
                    const added = b.knownAdds && (h['x-strom-person'] || h['x-strom-note'])
                        ? { added: { persons: h['x-strom-person'] ? [h['x-strom-person']] : [], note: !!h['x-strom-note'] } } : {};
                    return json(200, { known: prior, kind: 'input', ...added });
                }
                const id = `I${String(100 + b.mediaPuts.length).padStart(4, '0')}`;
                b.mediaKnown.set(sha, id);
                return json(200, { input: id });
            }
            if (url.searchParams.get('file') === '1') {
                const file = b.mediaFiles.get(sha);
                return file
                    ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': file.type, 'content-length': String(file.body.length) }, body: file.body })
                    : json(410, { error: 'gone' });
            }
            b.mediaAsks.push(sha);
            const known = b.mediaKnown.get(sha);
            return known ? json(200, { known }) : json(404, { error: 'unknown' });
        }
        const material = serveMaterial(b, method, url, route.request().postData());
        if (material) {
            return material.body === ''
                ? route.fulfill({ status: material.status, headers: cors, body: '' })
                : route.fulfill({ status: material.status, headers: { ...cors, 'content-type': 'application/json', ...(material.headers ?? {}) }, body: JSON.stringify(material.body) });
        }
        const rd = b.read;
        // A read page's image (`read/<id>/page/<n>.jpg`): a drawn sheet with ruled lines (invented, no real document).
        const pageImg = /\/read\/([^/]+)\/page\/(\d+)\.jpg$/.exec(url.pathname);
        if (rd && pageImg && method === 'GET') {
            rd.pageAsks.push(`${decodeURIComponent(pageImg[1])}/${pageImg[2]}`);
            const lines = Array.from({ length: 24 }, (_, i) => `<line x1="40" x2="560" y1="${60 + i * 30}" y2="${60 + i * 30}" stroke="#c9bfa8" stroke-width="2"/>`).join('');
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#f6efe0"/>${lines}</svg>`;
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/svg+xml' }, body: svg });
        }
        if (rd && method === 'GET' && /\/reads$/.test(url.pathname) && (rd.history || rd.historyReply)) {
            rd.historyAsks = (rd.historyAsks ?? 0) + 1;
            if (rd.historyReply) return json(rd.historyReply.status, rd.historyReply.body);
            return json(200, { reads: rd.history });
        }
        const readPath = /\/read(?:\/([^/]+)(?:\/(cancel|again))?)?$/.exec(url.pathname);
        if (rd && readPath) {
            const id = readPath[1] ? decodeURIComponent(readPath[1]) : '';
            const verb = readPath[2] ?? '';
            let body: Record<string, unknown> = {};
            try { body = JSON.parse(route.request().postData() ?? '{}'); } catch { /* keep empty */ }
            const now = new Date().toISOString();
            if (method === 'POST' && !id) {
                rd.posts.push(body);
                if (rd.startReply) {
                    return route.fulfill({ status: rd.startReply.status, headers: { ...cors, 'content-type': 'application/json',
                        ...(rd.startReply.retryAfter ? { 'retry-after': rd.startReply.retryAfter } : {}) }, body: JSON.stringify(rd.startReply.body) });
                }
                const files = Array.isArray(body.files) ? body.files.length : 0;
                const reading: FakeReading = { id: rd.nextId, state: 'queued', version: 1, at: now, since: now, files, pages: files,
                    readers: body.readers === 2 ? 2 : 1, done: 0, entries: 0, name: rd.readName ?? 'zapis.jpg', person: typeof body.person === 'string' ? body.person : '', from: 'app' };
                rd.reads = [reading, ...rd.reads.filter(r => r.id !== reading.id)];
                return json(202, { read: reading.id, state: 'queued', version: 1 });
            }
            const reading = rd.reads.find(r => r.id === id);
            if (method === 'POST' && verb === 'cancel') {
                rd.cancels.push(id);
                if (rd.cancelReply) return json(rd.cancelReply.status, rd.cancelReply.body);
                if (!reading) return json(404, { error: 'No such reading.', code: 'read.none', text: 'No such reading.' });
                const was = reading.state;
                if (was === 'queued' || was === 'reading' || was === 'checking') { reading.state = 'cancelled'; reading.since = now; }
                return json(200, { read: id, state: reading.state, version: reading.version, cancelled: reading.state === 'cancelled' && was !== 'cancelled' });
            }
            if (method === 'POST' && verb === 'again') {
                rd.agains.push({ id, body });
                if (!reading) return json(404, { error: 'No such reading.', code: 'read.none', text: 'No such reading.' });
                reading.state = 'queued';
                reading.version += 1;
                reading.since = now;
                reading.done = 0;
                return json(202, { read: id, state: 'queued', version: reading.version });
            }
            if (method === 'GET' && id && !verb) {
                const result = rd.results.get(id);
                return result ? json(200, result) : json(404, { error: 'No such reading.', code: 'read.none', text: 'No such reading.' });
            }
        }
        if (url.pathname.endsWith('/status')) {
            if (b.statusHang) return new Promise<void>(() => { /* never answers */ });
            if (b.statusCode) return json(b.statusCode, { error: 'not here' });
            return json(200, {
                tree: { id: UUID, name: 'Fíškovi' }, head: b.head, links: b.links,
                accepts: b.accepts, inbox: { trees: b.inbox, material: 0 }, lastIntake: b.lastIntake,
                ...(b.batches ? { batches: b.batches } : {}),
                ...(b.strom ? { strom: b.strom } : {}),
                ...(b.waiting ? { waiting: b.waiting } : {}),
                ...(b.features ? { features: b.features } : {}),
                ...(b.accepts ? { sends: b.sends } : {}),
                ...(b.read ? { reads: b.read.reads } : {}),
                ...(b.phone ? { phone: { state: b.phone.state === 'on' || b.phone.state === 'error' ? b.phone.state : 'off', phones: b.phone.phones.length } } : {}),
                ...(b.statusExtra ?? {}),
            });
        }
        // A send taken back, written again from what the research kept (1.12): like a write at once.
        const againPath = /\/sync\/([^/]+)\/again$/.exec(url.pathname);
        if (againPath && route.request().method() === 'POST') {
            const old = b.sends.find(r => r.intake === decodeURIComponent(againPath[1]));
            (b.againAsks ??= []).push(decodeURIComponent(againPath[1]));
            if (!old || old.state !== 'undone') return json(404, { error: 'no send taken back is kept here', code: 'send.none' });
            const intake = `R${Date.now()}-again`;
            const v = b.onWrite?.(old.sent);
            if (v) { b.head = v.head; b.treeGed = v.ged; }
            (old as { again?: string }).again = intake;
            b.sends.unshift({ intake, at: new Date().toISOString(), state: 'written', changes: 6, tree: old.tree, sent: old.sent, decidedAt: new Date().toISOString() });
            return json(200, { ok: true, inbox: false, changes: 6, applied: 6, intake, ...(v ? { head: v.head } : {}) });
        }
        if (url.pathname.endsWith('/sync') && route.request().method() === 'POST') {
            if (b.syncAbort) return route.abort('connectionreset');
            if (b.syncDelayMs) await new Promise(r => setTimeout(r, b.syncDelayMs));
            const body = route.request().postData() ?? '';
            b.posts.push(body);
            const sent = /1 _STROM_SENT (\S+)/.exec(body)?.[1] ?? '';
            const appTree = /1 _STROM_APP_TREE (\S+)/.exec(body)?.[1] ?? UUID;
            const intake = `R${Date.now()}-${b.posts.length}`;
            const reply = b.syncReply.body as { inbox?: boolean; pending?: boolean; head?: string };
            if (b.syncReply.status === 200 && reply.inbox === false && !reply.pending && b.onWrite) {
                // Written at once: the research has a new version, the reply names its commit.
                const v = b.onWrite(body);
                b.head = v.head;
                b.treeGed = v.ged;
                b.sends.unshift({ intake, at: new Date().toISOString(), state: 'written', changes: 6, tree: appTree, sent, decidedAt: new Date().toISOString() });
                return json(200, { ...reply, head: v.head, intake, ...(b.replyExtra?.(body) ?? {}) });
            }
            if (b.syncReply.status === 202 || reply.pending) {
                b.sends.unshift({ intake, at: new Date().toISOString(), state: 'pending', changes: 6, tree: appTree, sent });
            }
            if (b.syncReply.status === 200 && reply.inbox) {
                const at = new Date().toISOString();
                for (const rec of b.sends) if (rec.tree === appTree && rec.state === 'pending') rec.state = 'replaced';
                b.inbox = [{ tree: appTree, at, changes: 6, sent }];
                b.sends.unshift({ intake, at, state: 'pending', changes: 6, tree: appTree, sent });
            }
            return json(b.syncReply.status, b.syncReply.status < 300 ? { ...(b.syncReply.body as object), intake } : b.syncReply.body);
        }
        if (url.pathname.endsWith('/tree.ged')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: b.treeGed });
        }
        if (url.pathname.endsWith('/cancel')) return json(200, { ok: true });
        const done = /\/batch\/([^/]+)\/done$/.exec(url.pathname);
        if (done && route.request().method() === 'POST') {
            let body: Record<string, unknown> = {};
            try { body = JSON.parse(route.request().postData() ?? '{}'); } catch { /* keep empty */ }
            (b.batchDone ??= []).push({ id: decodeURIComponent(done[1]), body });
            const files = b.mediaPuts.filter(p => p.headers['x-strom-batch'] === decodeURIComponent(done[1])).length;
            return json(200, { batch: done[1], name: body.name, inputs: files, known: 0, refused: 0, nested: [], tasks: files ? ['T0101'] : [], head: b.head });
        }
        const ph = b.phone;
        const phonePath = /\/phone(?:\/(.*))?$/.exec(url.pathname);
        if (ph && phonePath) {
            const rest = phonePath[1] ?? '';
            if (method === 'GET' && rest === '') {
                const { onReply: _r, qrExpiresAt: _q, qrAsks: _a, posts: _p, removed: _m, ...state } = ph;
                return json(200, { ...state, pair: ph.state === 'on' ? { expiresAt: ph.qrExpiresAt ?? new Date(Date.now() + 600_000).toISOString() } : null });
            }
            if (method === 'GET' && rest === 'qr.svg') {
                ph.qrAsks.push(url.searchParams.toString().replace(/(^|&)app=[^&]*/, ''));
                if (ph.state !== 'on') return json(409, { error: 'The phone connection is off.', code: 'phone.off' });
                const address = url.searchParams.get('address') || ph.addresses[0]?.url || '';
                return route.fulfill({
                    status: 200,
                    headers: {
                        ...cors, 'content-type': 'image/svg+xml', 'cache-control': 'no-store',
                        'access-control-expose-headers': 'X-Strom-Pair-Expires, X-Strom-Pair-Url',
                        'x-strom-pair-expires': ph.qrExpiresAt ?? new Date(Date.now() + 600_000).toISOString(),
                        'x-strom-pair-url': address,
                    },
                    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M4 4h7v7H4zM18 4h7v7h-7zM4 18h7v7H4zM14 14h2v2h-2z" fill="#000"/></svg>',
                });
            }
            if (method === 'POST') {
                const body = route.request().postData() ?? '';
                ph.posts.push(rest === 'on' ? `on ${body}` : rest);
                if (rest === 'on') {
                    if (ph.onReply === 'no-dialog') return json(200, { state: 'off', error: { code: 'no-dialog' } });
                    ph.state = 'confirm';
                    return json(200, { state: 'confirm' });
                }
                if (rest === 'off') {
                    ph.state = 'off';
                    ph.error = null;
                    return json(200, { state: 'off' });
                }
                const remove = /^remove\/(.+)$/.exec(rest);
                if (remove) {
                    const id = decodeURIComponent(remove[1]);
                    const at = ph.phones.findIndex(x => x.id === id);
                    if (at < 0) return json(404, { error: 'No such phone.', code: 'phone.unknown' });
                    ph.removed.set(id, ph.phones[at]);
                    ph.phones.splice(at, 1);
                    return json(200, { phones: ph.phones });
                }
                const restore = /^restore\/(.+)$/.exec(rest);
                if (restore) {
                    const id = decodeURIComponent(restore[1]);
                    const entry = ph.removed.get(id);
                    if (!entry) return json(404, { error: 'Gone.', code: 'phone.gone' });
                    ph.removed.delete(id);
                    ph.phones.push(entry);
                    return json(200, { phones: ph.phones });
                }
            }
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    };
    await page.route(`${BRIDGE}/**`, serve);
    await page.route(`${BRIDGE2}/**`, serve);
    return b;
}

/** The research opened in the app (`ged`: its file, default researchGed()); its bridge remembered (as after a ?live= / ?send=); optionally changed. */
export async function openResearch(page: Page, opts: { edit?: boolean; bridge?: boolean; capable?: boolean; auto?: boolean; media?: boolean; ged?: string } = {}): Promise<void> {
    await openApp(page);
    await page.evaluate(() => {
        // Opening links in the system is not testable: record them instead.
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
    });
    await dropFile(page, 'tree-strom.ged', opts.ged ?? researchGed());
    await expect(card(page, 'Jan')).toBeVisible();
    if (opts.bridge !== false) {
        // As after a ?live= / ?send= from a research that says what it takes.
        await page.evaluate(({ uuid, base, accepts }) => {
            localStorage.setItem(`strom-research-bridge:${uuid}`, JSON.stringify({ base, ...(accepts ? { accepts } : {}) }));
        }, { uuid: UUID, base: BRIDGE, accepts: opts.capable === false ? null : { sync: { auto: 'off' }, sources: true, verified: true, ...(opts.media ? { media: { max: 500 * 1024 * 1024, region: true } } : {}) } });
    }
    // By hand, a new tie's default (sending by itself: research-auto-send.spec.ts, chosen here) — chosen,
    // so the one-time question does not come (its own tests take it away).
    await page.evaluate((auto) => {
        const tm = window.Strom.TreeManager;
        const id = tm.getActiveTreeId()!;
        tm.patchResearchLink(id, { sendMode: auto ? 'auto' : 'manual' });
        // Sending by hand goes at once in these tests ("What will be sent" first: its own tests).
        localStorage.setItem(`strom-research-auto:${id}`, JSON.stringify({ ...JSON.parse(localStorage.getItem(`strom-research-auto:${id}`) ?? '{}'), modeAsked: true, skipPreview: true }));
    }, !!opts.auto);
    if (opts.edit) await editJan(page);
}

export async function editJan(page: Page, place = 'Praha'): Promise<void> {
    await page.evaluate((place) => {
        const dm = window.Strom.DataManager;
        const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
        dm.updatePerson(jan.id, { birthPlace: place });
    }, place);
}

export const poll = (page: Page) => page.evaluate(() => window.Strom.UI.pollResearchBridge());
export const links = (page: Page) => page.evaluate(() => (window.Strom.UI as unknown as { __links: string[] }).__links);

/**
 * The toolbar's Research menu, open (its button left of Actions; a narrow window: the More sheet's research
 * page, "Other actions" open there). `expandMore`: "Other actions ⌄" opened too (the now-and-then items).
 */
export async function openResearchMenu(page: Page, opts: { expandMore?: boolean } = {}): Promise<void> {
    await page.evaluate((expandMore) => {
        const ui = window.Strom.UI as typeof window.Strom.UI & { toggleResearchMore(): void };
        if (!ui.isResearchMenuOpen()) ui.openResearchMenu();
        const row = document.querySelector('#research-item-more');
        if (expandMore && row && row.getAttribute('aria-expanded') !== 'true') ui.toggleResearchMore();
    }, !!opts.expandMore);
}

export const block = (page: Page) => page.locator('#research-sync-block');
/** The Research button's signal for something to do: the waiting count or the attention dot (not the quieter "not sent" dot). */
export const dot = (page: Page) => page.locator('#research-menu-signal:is([data-signal="count"], [data-signal="attention"])');
/** The Research button's signal, whichever it is ('' when none). */
export const signal = (page: Page) => page.evaluate(() => {
    const el = document.getElementById('research-menu-signal');
    return el && !el.hidden ? el.dataset.signal ?? '' : '';
});

/** "Load the research version?" (asked at every load the user asks for): Load. */
export async function acceptLoad(page: Page): Promise<void> {
    await page.locator('#research-load-modal #research-load-ok').click();
}

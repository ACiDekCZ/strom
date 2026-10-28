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
    sends: { intake: string; at: string; state: string; changes: number; tree: string; sent: string; decidedAt?: string; reason?: string; conflicts?: unknown }[];
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
    /** More of the answer to a send written again (e.g. `applied`, `notWritten`), over the default one. */
    againReply?: Record<string, unknown>;
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
    /** Writes the research committed so far (each moved `head`, see moveHead). */
    headMoves?: number;
    /**
     * History in the life timeline (spec 020): `GET /history`, `POST /history/hide`,
     * `POST /experiments`, and `/status.history.rev` + `/status.experiments.history`.
     * Gated by `features` like the research (HISTORY_FEATURES).
     */
    history?: FakeHistory;
}

/** Everything the research says of the history layer (`/status.features`). */
export const HISTORY_FEATURES = ['history.events', 'history.hide', 'experiments', 'experiments.off', 'experiments.link', 'tree.state'];

/** The research's events of the time for the tree, and what it was asked. */
export interface FakeHistory {
    /**
     * The `GET /history` body (its `hidden` follows the hidings). R1 (`fakeHistoryR1`):
     * `regions`, the places' regions / persons / ids, `deleted`, `suggest`.
     */
    payload: {
        state: Record<string, unknown>; events: unknown[]; places: Record<string, Record<string, unknown>>; hidden: Record<string, unknown>[]; lang?: string;
        regions?: Record<string, Record<string, unknown>>; deleted?: Record<string, unknown>[]; suggest?: string[];
    };
    /** `/status.history.rev` (a hiding or a switch-off changes it). */
    rev: string;
    /** `/status.experiments.history`: the research looks for events for the tree. */
    searching: boolean;
    /** Every `GET /history`. */
    reads: number;
    /** Every `POST /history/hide` body. */
    hides: Record<string, unknown>[];
    /** Every `POST /experiments` body. */
    offs: Record<string, unknown>[];
    /** `POST /history/hide` answers this instead. */
    hideReply?: { status: number; body: unknown };
    /** `POST /experiments` answers this instead. */
    offReply?: { status: number; body: unknown };
    /** `/status.experiments.historyPace` (read by the app with `experiments.pace` in `features`). */
    pace?: 'sometimes' | 'rare' | 'idle';
    /** `/status.history.placeEstimate` (R6; read with `history.place`). */
    placeEstimate?: { minutes: [number, number]; usd?: [number, number] };
    /** `/status.stories.history` (R7; read with `stories.history`). */
    stories?: boolean;
    /** Bodies of the manager's writes (R1–R7), by route: `first`, `skip`, `delete`, `map`, `place`, `stories`. */
    writes: Record<FakeHistoryWrite, Record<string, unknown>[]>;
    /** A route answers this instead (busy: `{status: 503, body: {code: 'research.busy'}}`), until taken away. */
    writeReply?: Partial<Record<FakeHistoryWrite, { status: number; body: unknown }>>;
    /** Events deleted from here (kept for `do: "restore"`); an event deleted by the research's agent: `retracted`. */
    removed?: Map<string, { event: Record<string, unknown>; places: string[] }>;
    retracted?: string[];
}

/** The manager's write routes of the fake bridge (`POST /history/<route>`, `/stories`). */
export type FakeHistoryWrite = 'first' | 'skip' | 'delete' | 'map' | 'place' | 'stories';

/**
 * Invented events of the time for the research tree (historyGed: Jan lived in
 * Čáslav 1860–1910): two for Čáslav, one already hidden there.
 */
export function fakeHistory(init: Partial<FakeHistory> = {}): FakeHistory {
    return {
        payload: {
            state: { on: true, search: 'done', at: '2026-10-20T09:00:00Z', rev: 'h1' },
            lang: 'cs',
            events: [
                { id: 'E1', from: 1866, kind: 'war', scope: 'region',
                    text: { cs: 'Prusko-rakouská válka; boje v okolí Čáslavi.', en: 'Austro-Prussian War; fighting around Čáslav.' },
                    source: { title: 'Invented encyclopedia', url: 'https://example.org/war-1866', checked: '2026-10-01' } },
                { id: 'E2', from: 1873, kind: 'economy', scope: 'region',
                    text: { cs: 'Krach na vídeňské burze.', en: 'Vienna stock exchange crash.' },
                    source: { title: 'Invented encyclopedia', url: 'https://example.org/crash-1873', checked: '2026-10-01' } },
            ],
            places: { 'Čáslav': { events: ['E1', 'E2'] } },
            hidden: [{ event: 'E2', place: 'Čáslav', at: '2026-10-21T08:00:00Z' }],
        },
        rev: 'h1',
        searching: true,
        reads: 0,
        hides: [],
        offs: [],
        writes: { first: [], skip: [], delete: [], map: [], place: [], stories: [] },
        ...init,
    };
}

/** The research tree with Jan born in Čáslav in 1860, died there in 1910 (places and years the events match). */
export function historyGed(head = HEAD): string {
    return researchGed(head).replace('1 NAME Jan /Fíšek/', '1 NAME Jan /Fíšek/\n1 BIRT\n2 DATE 1860\n2 PLAC Čáslav\n1 DEAT\n2 DATE 1910\n2 PLAC Čáslav');
}

/** Everything of R1–R7 besides HISTORY_FEATURES (`history.place.direct` never: the research starts it only in its terminal). */
export const HISTORY_MANAGE_FEATURES = [
    'history.regions', 'history.first', 'history.hide.all', 'history.skip', 'history.delete', 'history.map', 'history.place',
    'stories.history', 'experiments.pace',
];
/** A research with the whole history manager (R1–R7). */
export const HISTORY_R1_FEATURES = [...HISTORY_FEATURES, ...HISTORY_MANAGE_FEATURES];

const region = (cs: string, en: string, de: string) => ({ cs, en, de });
const BOHEMIA = region('Čechy', 'Bohemia', 'Böhmen');
const EMPIRE = region('Rakouské císařství', 'Austrian Empire', 'Kaisertum Österreich');

/**
 * An invented R1 `GET /history` (spec 020 K4.3, research answer R1–R7) for the
 * history tree: regions in every state — Silesia running, Moravia first,
 * Lower Austria queued 2nd, Nebraska waiting (its sentence), Bohemia done with
 * years without events and their filling queued (one hidden), the Austrian
 * Empire covered by Bohemia and Moravia, Prussia not searched; places with
 * regions, people and record ids (Lhotka unlocated, Opava not searched,
 * Kutná Hora suggested), two events deleted on this computer (one without its
 * copy), and a local finding without region.
 */
export function fakeHistoryR1(init: Partial<FakeHistory> = {}): FakeHistory {
    const base = fakeHistory();
    const ev = base.payload.events as Record<string, unknown>[];
    for (const e of ev) e.region = { id: 'cz-bohemia', name: BOHEMIA };
    ev.push(
        { id: 'E3', from: 1867, kind: 'state', scope: 'region', region: { id: 'at-empire', name: EMPIRE },
            text: { cs: 'Rakousko-uherské vyrovnání.', en: 'The Austro-Hungarian Compromise.' },
            source: { title: 'Invented encyclopedia', url: 'https://example.org/compromise-1867', checked: '2026-10-01' } },
        { id: 'E4', from: 1880, kind: 'disaster', scope: 'local',
            text: { cs: 'Požár v Čáslavi.', en: 'A fire in Čáslav.' },
            local: { source: 'S0001', cite: 'Oddací matrika Čáslav, fol. 41' } },
    );
    base.payload = {
        state: { on: true, search: 'running', pending: 2, at: '2026-10-20T09:00:00Z', rev: 'h1' },
        lang: 'cs',
        events: ev,
        regions: {
            'cz-bohemia': { name: BOHEMIA, state: 'done', at: '2026-10-20T07:40:00Z', events: 2, hidden: 1, places: 2, persons: 8, facts: 30,
                gaps: [{ from: 1870, to: 1913 }], fill: 'queued', order: 4 },
            'cz-moravia': { name: region('Morava', 'Moravia', 'Mähren'), state: 'queued', order: 1, first: true, events: 0, places: 2, persons: 2, facts: 6 },
            'cz-silesia': { name: region('Slezsko', 'Silesia', 'Schlesien'), state: 'running', order: 2, events: 0, places: 1, persons: 1 },
            'at-lower-austria': { name: region('Dolní Rakousy', 'Lower Austria', 'Niederösterreich'), state: 'queued', order: 3, events: 0, places: 1, persons: 1 },
            'us-nebraska': { name: region('Nebraska', 'Nebraska', 'Nebraska'), state: 'waiting', why: 'its archive is held by another tree', events: 0 },
            'at-empire': { name: EMPIRE, state: 'covered', covered: ['cz-bohemia', 'cz-moravia'], events: 1 },
            'de-prussia': { name: region('Prusko', 'Prussia', 'Preußen'), state: 'skipped', events: 0, places: 1, persons: 1 },
        },
        places: {
            'Čáslav': { events: ['E1', 'E2', 'E3', 'E4'], regions: [{ id: 'cz-bohemia' }, { id: 'at-empire', to: 1918 }], persons: 3, id: 'L0001' },
            'Kutná Hora': { events: [], regions: [{ id: 'cz-bohemia' }], persons: 5, id: 'L0003' },
            'Brno': { events: [], state: 'pending', regions: [{ id: 'cz-moravia' }], persons: 2, id: 'L0002' },
            'Lhotka': { events: [], state: 'unlocated', why: 'several places of that name', persons: 1 },
            'Opava': { events: [], regions: [{ id: 'cz-silesia', from: 1742 }], persons: 1, skip: true, id: 'L0004' },
        },
        hidden: [{ event: 'E2', place: 'Čáslav', at: '2026-10-21T08:00:00Z' }],
        deleted: [
            { event: 'E9', scope: 'region', at: '2026-10-25T10:00:00Z', from: 1882, region: { id: 'cz-bohemia', name: BOHEMIA },
                text: { cs: 'Povodeň na Doubravě.', en: 'A flood on the Doubrava.' } },
            { event: 'E8', scope: 'region', at: '2026-10-24T10:00:00Z' },
        ],
        suggest: ['L0003'],
    };
    return { ...base, ...init };
}

/** The answer to `/history*`, `/experiments` and `/stories` (null: not one of them; 404 when not said in `features`). */
function serveHistory(b: FakeBridge, method: string, url: URL, postData: string | null): { status: number; body: unknown } | null {
    const h = b.history;
    const rest = url.pathname.replace(/^\/[^/]+/, '');
    if (!h || !/^\/(history|history\/(hide|first|skip|delete|map|place)|experiments|stories)$/.test(rest)) return null;
    const features = b.features ?? [];
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(postData ?? '{}'); } catch { /* keep empty */ }
    const unknown = { status: 404, body: { error: 'unknown' } };
    const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
        ({ status, body: { error, code, text: error, ...extra } });
    const bodyError = refuse(400, 'history.body', 'The request is not one the research reads.');
    // Every write moves the history's rev (the app reads it again).
    const bump = () => {
        h.rev = `h${(Number(h.rev.replace(/\D/g, '')) || 1) + 1}`;
        h.payload.state.rev = h.rev;
    };
    const regions = h.payload.regions;
    if (rest === '/history') {
        if (method !== 'GET' || !features.includes('history.events')) return unknown;
        h.reads++;
        return { status: 200, body: h.payload };
    }
    if (rest === '/history/hide') {
        if (method !== 'POST' || !features.includes('history.hide')) return unknown;
        h.hides.push(body);
        if (h.hideReply) return h.hideReply;
        // R2: in the whole tree / everything of a region only with `history.hide.all`.
        if ((body.tree === true || (body.region && !body.event)) && !features.includes('history.hide.all')) return bodyError;
        if (body.region && !body.event && regions && !regions[body.region as string]) return refuse(404, 'history.region', 'No such region in this tree.');
        const same = (x: Record<string, unknown>) => !body.event ? !x.event && x.region === body.region
            : x.event === body.event && (body.place ? x.place === body.place : body.tree ? x.tree === true : x.person === body.person);
        h.payload.hidden = h.payload.hidden.filter(x => !same(x));
        if (body.do !== 'show') {
            const target = !body.event ? { region: body.region }
                : { event: body.event, ...(body.place ? { place: body.place } : body.tree ? { tree: true } : { person: body.person }) };
            h.payload.hidden.push({ ...target, at: new Date().toISOString() });
        }
        bump();
        return { status: 200, body: { ok: true, hidden: h.payload.hidden, ...commitWrite(b) } };
    }
    if (rest === '/experiments') {
        if (method !== 'POST' || !features.includes('experiments.off')) return unknown;
        h.offs.push(body);
        if (h.offReply) return h.offReply;
        h.searching = false;
        h.payload.state.on = false;
        return { status: 200, body: { ok: true, history: false, ...commitWrite(b) } };
    }
    // The manager's writes (R1–R7): each behind its feature.
    const route = (rest === '/stories' ? 'stories' : rest.slice('/history/'.length)) as FakeHistoryWrite;
    const feature = route === 'stories' ? 'stories.history' : route === 'first' ? 'history.first' : `history.${route}`;
    if (method !== 'POST' || !features.includes(feature)) return unknown;
    h.writes[route].push(body);
    const said = h.writeReply?.[route];
    if (said) return said;
    const places = h.payload.places;
    const noRegion = refuse(404, 'history.region', 'No such region in this tree.');
    const noPlace = refuse(404, 'history.place', 'No such place in the facts of this tree.');
    const noEvent = refuse(404, 'history.event', 'No such event.');
    switch (route) {
        case 'first': {
            const id = body.region as string;
            const r = regions?.[id];
            if (!r) return noRegion;
            if (r.state === 'done') return refuse(409, 'history.done', 'The region is done.');
            r.first = true;
            if (r.state !== 'running') r.state = 'queued';
            bump();
            const first = Object.entries(regions!).filter(([, x]) => x.first).map(([region]) => ({ region, at: new Date().toISOString() }));
            return { status: 200, body: { ok: true, region: id, first, ...commitWrite(b) } };
        }
        case 'skip': {
            const undo = body.do === 'undo';
            if (typeof body.region === 'string') {
                const r = regions?.[body.region];
                if (!r) return noRegion;
                if (undo) { r.state = (r.wasState as string) ?? 'queued'; delete r.wasState; }
                else if (r.state !== 'skipped') { r.wasState = r.state; r.state = 'skipped'; }
            } else if (typeof body.place === 'string') {
                const pl = places[body.place];
                if (!pl) return noPlace;
                if (undo) delete pl.skip;
                else pl.skip = true;
            } else return bodyError;
            bump();
            // R3: a repeated request changes nothing and is no error.
            return { status: 200, body: { skip: {
                regions: Object.entries(regions ?? {}).filter(([, x]) => x.state === 'skipped').map(([id]) => id),
                places: Object.entries(places).filter(([, x]) => x.skip).map(([k]) => k),
            }, ...commitWrite(b) } };
        }
        case 'delete': {
            const id = body.event as string;
            if (typeof id !== 'string' || !id) return bodyError;
            const removed = (h.removed ??= new Map());
            const events = h.payload.events as Record<string, unknown>[];
            if (body.do === 'restore') {
                if (h.retracted?.includes(id)) return refuse(409, 'history.retracted', 'Deleted by the research; it cannot be restored here.');
                const was = removed.get(id);
                const listed = (h.payload.deleted ?? []).some(d => d.event === id);
                if (!was && !listed) return noEvent;
                h.payload.deleted = (h.payload.deleted ?? []).filter(d => d.event !== id);
                if (was) {
                    events.push(was.event);
                    for (const k of was.places) (places[k]?.events as string[] | undefined)?.push(id);
                    removed.delete(id);
                }
            } else {
                const at = events.findIndex(e => e.id === id);
                if (at < 0) return noEvent;
                const [event] = events.splice(at, 1);
                const inPlaces = Object.entries(places).filter(([, pl]) => (pl.events as string[]).includes(id)).map(([k]) => k);
                for (const k of inPlaces) places[k].events = (places[k].events as string[]).filter(x => x !== id);
                removed.set(id, { event, places: inPlaces });
                const { id: _id, kind: _k, source: _s, local: _l, ...copy } = event;
                (h.payload.deleted ??= []).unshift({ event: id, ...copy, at: new Date().toISOString() });
            }
            bump();
            return { status: 200, body: { ok: true, ...commitWrite(b) } };
        }
        case 'map': {
            const key = body.place as string;
            const pl = typeof key === 'string' ? places[key] : undefined;
            if (!pl) return noPlace;
            if (Array.isArray(body.regions)) {
                const list = body.regions as { id: string }[];
                if (!list.length) return bodyError;
                if (list.some(r => !regions?.[r.id])) return noRegion;
                pl.regions = list;
                pl.manual = true;
                delete pl.state;
                delete pl.why;
                delete pl.redo;
                delete pl.note;
            } else if (body.redo === true) {
                if (typeof body.note === 'string' && (Array.from(body.note).length > 200 || body.note.includes('�'))) return bodyError;
                delete pl.regions;
                delete pl.manual;
                pl.state = 'pending';
                pl.redo = true;
                if (typeof body.note === 'string' && body.note) pl.note = body.note;
                else delete pl.note;
            } else if (body.do === 'auto') {
                // Nothing the research decided before: the place waits to be placed.
                delete pl.manual;
                delete pl.regions;
                pl.state = 'pending';
            } else return bodyError;
            bump();
            // R5: `map` null while the place waits to be placed.
            const map = pl.regions ? { regions: pl.regions, manual: pl.manual === true, at: new Date().toISOString() } : null;
            return { status: 200, body: { place: key, map, ...commitWrite(b) } };
        }
        case 'place': {
            // R6: always the research's terminal (it says the estimate and asks); only a record id, never a name.
            const id = body.place;
            if (typeof id !== 'string' || !/^L\d{1,7}$/.test(id)) return bodyError;
            if (!Object.values(places).some(pl => pl.id === id)) return noPlace;
            const link = `strom-research://history?tree=${UUID}&place=${id}&do=search`;
            return refuse(403, 'history.link', 'The research terminal decides.', { link });
        }
        case 'stories': {
            if (typeof body.history !== 'boolean') return refuse(400, 'stories.body', 'The request is not one the research reads.');
            if (body.history && !h.searching) {
                return refuse(409, 'history.off', 'The research does not look for history.',
                    { link: `strom-research://experiment?tree=${UUID}&name=history&do=on` });
            }
            h.stories = body.history;
            return { status: 200, body: { ok: true, history: body.history, ...commitWrite(b) } };
        }
    }
    return unknown;
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
    /** Writes (`assign`, `hide`) answer after this long (ms): the real bridge commits for seconds. */
    writeDelayMs?: number;
    /** Write answers (`assign`, `hide`, a new file's `PUT /media`, `batch/<id>/done`) say `parent`: the head they were written on. */
    writeParent?: boolean;
    /** Before the next this many writes, right as each arrives, the research's agent commits a change of its own (foreignCommit). */
    foreignAtWrite?: number;
}

/**
 * The research commits a write (a material's assign / hide, a new file): its
 * head moves and its tree's file says the new one — the tree itself as it was.
 */
export function moveHead(b: FakeBridge): string {
    b.headMoves = (b.headMoves ?? 0) + 1;
    const head = `c0ffee${b.headMoves.toString(16).padStart(6, '0')}`;
    b.head = head;
    b.treeGed = b.treeGed.replace(/^1 _STROM_HEAD \S+$/m, `1 _STROM_HEAD ${head}`);
    return head;
}

/**
 * A commit of the research's own (its agent, a terminal): the head moves and
 * the tree changes (Jan gets a second name) — a newer version the app must say.
 */
export function foreignCommit(b: FakeBridge): string {
    b.headMoves = (b.headMoves ?? 0) + 1;
    const head = `beef00${b.headMoves.toString(16).padStart(6, '0')}`;
    b.head = head;
    b.treeGed = b.treeGed.replace(/^1 _STROM_HEAD \S+$/m, `1 _STROM_HEAD ${head}`).replace('1 NAME Jan /Fíšek/', '1 NAME Jan Václav /Fíšek/');
    return head;
}

/** A write of the app committed (foreignAtWrite first, if due): its answer's `head` (and `parent` with writeParent). */
function commitWrite(b: FakeBridge): { head: string; parent?: string } {
    if (b.material?.foreignAtWrite) {
        b.material.foreignAtWrite--;
        foreignCommit(b);
    }
    const parent = b.head;
    const head = moveHead(b);
    return { head, ...(b.material?.writeParent ? { parent } : {}) };
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
        return { status: 200, body: { files: (files as FakeMaterialFile[]).map(shown), people: peopleOf(files as FakeMaterialFile[], []), ...commitWrite(b) } };
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
        return { status: 200, body: { files: files.map(shown), people: peopleOf(files, [batch]), kept: [], ...commitWrite(b) } };
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
    return { status: 200, body: { files: (files as FakeMaterialFile[]).map(shown), people: peopleOf(files as FakeMaterialFile[], keptBatches), kept, ...commitWrite(b) } };
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
                // With the family's material on (spec 017), a new file is a commit, as in the research.
                return json(200, { input: id, ...(b.material ? commitWrite(b) : {}) });
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
        if (b.material?.writeDelayMs && method === 'POST' && /\/material\/(assign|hide)$/.test(url.pathname)) {
            await new Promise(resolve => setTimeout(resolve, b.material!.writeDelayMs));
        }
        const material = serveMaterial(b, method, url, route.request().postData());
        if (material) {
            return material.body === ''
                ? route.fulfill({ status: material.status, headers: cors, body: '' })
                : route.fulfill({ status: material.status, headers: { ...cors, 'content-type': 'application/json', ...(material.headers ?? {}) }, body: JSON.stringify(material.body) });
        }
        const hist = serveHistory(b, method, url, route.request().postData());
        if (hist) return json(hist.status, hist.body);
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
                ...(b.history ? {
                    history: { rev: b.history.rev, ...(b.history.placeEstimate ? { placeEstimate: b.history.placeEstimate } : {}) },
                    experiments: { history: b.history.searching, ...(b.history.pace ? { historyPace: b.history.pace } : {}) },
                    ...(b.history.stories !== undefined ? { stories: { history: b.history.stories } } : {}),
                } : {}),
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
            return json(200, { ok: true, inbox: false, changes: 6, applied: 6, intake, ...(v ? { head: v.head } : {}), ...(b.againReply ?? {}) });
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
            return json(200, { batch: done[1], name: body.name, inputs: files, known: 0, refused: 0, nested: [], tasks: files ? ['T0101'] : [], head: b.head,
                ...(b.material?.writeParent ? { parent: b.head } : {}) });
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

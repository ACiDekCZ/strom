/**
 * "Read a document" (spec 013): photos, scans or a PDF of one document go to
 * the research's bridge, whose agent reads them (transcription, translation,
 * explanation). One dialog: input → progress → result, with the error states
 * in place of its content. The reading goes on with the dialog closed: the
 * research menu, a strip in the Research panel and the button's dot say how
 * far it is, a notice says when it is done.
 *
 * Nothing is kept in the tree: the app remembers only the ids of its last
 * readings (`read.recent`), the number of readers chosen (`read.readers`) and
 * what they read with when it is not the default (`read.with`, spec 059).
 */

import { researchActionLabel, researchBridgeAgentLabel } from './research-open-mark.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId } from '../types.js';
import { PersonPicker } from '../person-picker.js';
import { sha256OfBlob } from '../sha256.js';
import { originalTargets } from '../originals.js';
import { parseLiveBridge, researchSchemeUrl, researchLinkMark, LiveStatus, type ResearchActionMark } from '../research-link.js';
import { storedResearchBridge, announcedResearchScheme, researchLinksEnabled } from '../research-device.js';
import {
    ReadAccepts, LiveRead, ReadResult, ReadFailure, ReadFileRefusal, ReadState, ReadPage, ReadEntry, ReadRegion,
    readRunning, readSlow, readFileMime, readFileKind, readFileRefusals, readUsualMinutes, readDocYear, readPageImageUrl,
    readPaceSecs, readSameSheet, readViewNames, type ReadPaceReader,
    putReadPage, startRead, fetchReadResult, readAgain, cancelRead, sanitizeLiveRead, readEndsToAnnounce, readSuperseded, READ_FEATURE,
    startSourceRead, readSourceId,
} from '../research-read.js';
import { shownExcerpts } from '../research-images.js';
import { excerptImageUrl } from '../excerpts.js';
import {
    LineSeg, parseTranscript, parseBlock, parseMarks, lineRegion, lineAt, defaultEntryIndex, canPropose, resultSections, glossFlavor,
    entryName, placeCount, placeCountAll, readerPlaces, placeContext, locateSpan, cropLayout, type PlaceContext,
} from '../read-result.js';
import { gedcomTagEventType } from '../ged-parser.js';
import { openImageViewer } from './image-viewer.js';
import { formatBytesShort } from './originals-ui.js';
import { onComputer, bridgeFailure } from './research-ui.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';
import { helpMark } from './help-mark.js';
import {
    ReadChoices, ReaderChoice, ReadWho, ReadWithItem, readerDefault, readerWithAgent, readersFromStored, readersChanged, readerHeld, readWith,
    readWhoLabel, readWhoSame, readWhoOtherAgents,
} from '../read-choices.js';

const DIALOG_ID = 'read-document-modal';
const RECENT_KEY = 'read.recent';
const READERS_KEY = 'read.readers';
/** The readers' agent, model and effort chosen last, when not as by default (spec 059). */
const WITH_KEY = 'read.with';
const RECENT_MAX = 20;
const POLL_MS = 5000;
const NOTICE_MS = 10_000;
const NOTE_MAX = 500;
/** The explanation unfolded (`'1'`) or folded (`'0'`) in the result; unset: unfolded where there is room. */
const GLOSS_KEY = 'read.glossOpen';
/** Below this the result's scan is a strip over the text with the chosen entry's crop. */
const STRIP_QUERY = '(max-width: 900px), (max-width: 1024px) and (max-height: 500px) and (orientation: landscape)';

/** One inserted file (a page of the document). */
interface Page {
    key: number;
    file: File;
    mime: string;
    kind: string;
    /** An object URL for a picture the browser shows ('' = no preview: HEIC, PDF). */
    preview: string;
    /** Its SHA-256, once computed (on sending). */
    sha: string;
    /** Refused by the research itself (415, too large): it stays in the list with that reason. */
    refused: ReadFileRefusal | null;
}

/** What stands in place of the dialog's content. */
type ErrorKind = 'down' | 'not-ready' | 'older' | 'failed' | 'cancelled' | 'busy' | 'limit' | 'unreadable' | 'source' | 'held' | 'source-again';

/** Why a source's reading cannot be shown (the `source` error: the source's own transcription stands in). */
export type SourceWhy = 'down' | 'older' | 'none' | 'archive' | 'unlinked' | 'computer' | 'other';

/**
 * `document`: pages to read; `again`: the shown reading read again, its readers chosen first;
 * `source`: a source read again from its original in the research (spec 059).
 */
export type InputMode = 'document' | 'again' | 'source';

/** A source to read again from its original (`POST sources/read`). */
export interface SourceAgain {
    /** The tree's source. */
    id: string;
    /** The research's source (S…). */
    refn: string;
    /** One excerpt alone (its `_STROM_CLIP`); '' the whole entry. */
    clip: string;
    /** The excerpt's number in the viewer (0: the whole entry). */
    excerpt: number;
    title: string;
    /** A picture of the excerpt ('' none). */
    thumb: string;
}

/** `propose`: the tree suggestion of the chosen entry; `written`: what the click wrote. */
export type Phase = 'input' | 'progress' | 'result' | 'error' | 'propose' | 'written';

export interface DialogState {
    phase: Phase;
    pages: Page[];
    personId: string;
    note: string;
    readers: 1 | 2;
    /** The reading shown (progress, result, its error). */
    readId: string;
    /** While the pages go: page k of n. */
    sending: { k: number; n: number } | null;
    /** The reading came to "comparing readings" (the step shows from then on). */
    sawChecking: boolean;
    startedAt: number;
    error: { kind: ErrorKind; failure?: ReadFailure; why?: string } | null;
    result: ReadResult | null;
    /** A quiet line over the content ("New reading cancelled; the previous result stands."). */
    notice: string;
    picker: PersonPicker | null;
    busy: boolean;
    /** The result's chosen entry (index into `entries`). */
    entry: number;
    /** The chosen transcription line of that entry (-1 = none). */
    line: number;
    /** The page shown on the scan (`pages[].n`). */
    page: number;
    /** A second reader started from the suggestion runs: the suggestion stays, the progress shows over it. */
    second: boolean;
    /** Opened from a source (its reading): when the result cannot be shown, the source's transcription stands in. */
    sourceId: string;
    /** The entry to show first (a source's `readingEntry`; '' = the usual choice). */
    entryId: string;
    /** What the input reads: pages, or the shown reading again. */
    mode: InputMode;
    /** What each reader reads with (both readers; null until the research offers a choice, spec 059). */
    with: ReaderChoice[] | null;
    /** "Adjust reading" unfolded. */
    refineOpen: boolean;
    /** Agents the research turned down for this dialog (409 read.agent): why and until when. */
    agentDown: Record<string, { why: string; resets: string }>;
    /** The readers sent with the reading (only when not as by default): shown in its progress. */
    sentWith: ReaderChoice[] | null;
    /** The offer the input was drawn with (redrawn when the research's offer changes). */
    choicesKey: string;
    /** The source read again (mode `source`, its progress and result). */
    srcAgain: SourceAgain | null;
}

/**
 * A reading the app started: shown as done in the menu and the panel until opened, its end announced once
 * (`announced`, kept over restarts); `doc` tells the same document read again.
 */
interface RecentRead { id: string; opened: boolean; announced: boolean; research: string; doc: string }

let st: DialogState | null = null;

/** The open dialog's state (null: closed). For the suggestion's own module. */
export function readDialogState(): DialogState | null {
    return st;
}
let nextKey = 1;
/** The readings each research's bridge listed last (by research, then id). */
const readsByResearch = new Map<string, Map<string, LiveRead>>();
/** Results fetched in this page (for the notice, the menu's second line, the dialog). */
const results = new Map<string, ReadResult>();
/** Readings known from the research's history (`GET reads`) only: their origin and state for the dialog. */
const historyReads = new Map<string, LiveRead>();
/** Why a reading's result could not be fetched last (by id). */
const lastFailure = new Map<string, ReadFailure>();
let listening = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let pasteHandler: ((e: ClipboardEvent) => void) | null = null;
/** What the menu, the panel strip and the button last showed of the readings (redrawn when it changes). */
let drawnKey = '';
/** Lays the result's scan out again when its box changes size. */
let scanObserver: ResizeObserver | null = null;

/** Each view's name on its tab: "Page 2", "Excerpt 1" (parts of the one page read), "Page 1 · excerpt 2" (mixed). */
function readViewLabels(pages: readonly ReadPage[]): string[] {
    const t = strings.read;
    return readViewNames(pages).map(v => !v.part ? t.pageAlt(v.sheet) : v.sheets === 1 ? t.viewExcerpt(v.part) : t.pageExcerpt(v.sheet, v.part));
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readRecent(): RecentRead[] {
    try {
        const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
        if (!Array.isArray(raw)) return [];
        return raw.filter((r): r is RecentRead => !!r && typeof r === 'object' && typeof r.id === 'string')
            // Kept before `announced` was: their end was announced at every start already.
            .map(r => ({
                id: r.id, opened: !!r.opened, announced: typeof r.announced === 'boolean' ? r.announced : true,
                research: typeof r.research === 'string' ? r.research : '', doc: typeof r.doc === 'string' ? r.doc : '',
            }))
            .slice(0, RECENT_MAX);
    } catch {
        return [];
    }
}

function writeRecent(list: RecentRead[]): void {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* not remembered */ }
}

/** A reading started (or started again: its document stays when `doc` is not given). */
function rememberRead(id: string, research: string, doc: string): void {
    const list = readRecent();
    const known = list.find(r => r.id === id)?.doc ?? '';
    writeRecent([{ id, opened: false, announced: false, research, doc: doc || known }, ...list.filter(r => r.id !== id)]);
}

/** Readings whose notice came or is no longer due (`true`), or is due again when they end (`false`). */
function markAnnounced(ids: readonly string[], value = true): void {
    if (ids.length === 0) return;
    const list = readRecent();
    for (const r of list) if (ids.includes(r.id)) r.announced = value;
    writeRecent(list);
}

function markOpened(id: string): void {
    const list = readRecent();
    const rec = list.find(r => r.id === id);
    if (!rec || rec.opened) return;
    rec.opened = true;
    writeRecent(list);
}

function storedReaders(): 1 | 2 {
    try { return localStorage.getItem(READERS_KEY) === '2' ? 2 : 1; } catch { return 1; }
}

function storeReaders(n: 1 | 2): void {
    try { localStorage.setItem(READERS_KEY, String(n)); } catch { /* not remembered */ }
}

function storedWith(): unknown {
    try { return JSON.parse(localStorage.getItem(WITH_KEY) ?? 'null'); } catch { return null; }
}

/** The readers' choice kept forgotten ("Default" in the dialog: at once, read or not). */
function forgetWith(): void {
    try { localStorage.removeItem(WITH_KEY); } catch { /* nothing kept */ }
}

/** The readers' choice kept for the next reading; as by default it is forgotten. */
function storeWith(choices: ReadChoices, chosen: readonly ReaderChoice[], readers: number): void {
    try {
        if (readersChanged(choices, chosen.slice(0, readers))) localStorage.setItem(WITH_KEY, JSON.stringify(chosen.slice(0, 2)));
        else localStorage.removeItem(WITH_KEY);
    } catch { /* not remembered */ }
}

const sameReader = (a: Pick<ReaderChoice, 'agent' | 'model' | 'effort'>, b: Pick<ReaderChoice, 'agent' | 'model' | 'effort'>): boolean =>
    a.agent === b.agent && a.model === b.model && a.effort === b.effort;

/** Why an agent cannot read now, in words ("sign-in expired", "limit reached (until 14:30)"). */
function agentWhyText(why: string, resets: string): string {
    const t = strings.read;
    if (why === 'auth') return t.agentWhyAuth;
    if (why === 'limit') {
        const at = resets ? new Date(resets) : null;
        return t.agentWhyLimit(at && Number.isFinite(at.getTime()) ? at.toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' }) : '');
    }
    return t.agentWhyOther;
}

/** A chosen reader as one line: "Claude Code · Opus · high" (a model `''`: as the agent is set). */
function readerLabel(choices: ReadChoices, r: ReaderChoice): string {
    const a = choices.agents.find(x => x.id === r.agent);
    const modelName = a?.models.find(m => m.id === r.model)?.name ?? '';
    return readWhoLabel({ name: a?.name ?? r.agent, model: r.model, modelName, effort: r.effort }, strings.read.bySettings);
}

/** Who read as one line; the model's label from the offer when the reading does not say it; `effort` off: without it. */
function whoLabel(w: ReadWho, choices: ReadChoices | null | undefined, effort = true): string {
    const modelName = w.modelName || choices?.agents.find(a => a.id === w.agent)?.models.find(m => m.id === w.model)?.name || '';
    return readWhoLabel({ ...w, modelName, effort: effort ? w.effort : '' }, strings.read.bySettings);
}

/** "Read by …", "Both readers: …" or each reader on its own (`one`: the words for a single reader). */
function whoLinesHtml(items: { label: string; same: boolean }[], one: string, cls: string): string {
    const t = strings.read;
    const line = (key: string, label: string): string =>
        `<span class="${cls}"><span class="read-who-key">${esc(key)}</span> <span class="read-who-val">${esc(label)}</span></span>`;
    if (items.length === 1) return line(one, items[0].label);
    if (items.every(i => i.same)) return line(t.whoBoth, items[0].label);
    return items.map((i, k) => line(t.whoN(k + 1), i.label)).join('');
}

/** A long name shortened in the middle (the whole name in `title`). */
function middleName(name: string, max = 42): string {
    if (name.length <= max) return name;
    const tail = Math.floor((max - 1) / 3);
    return `${name.slice(0, max - 1 - tail)}…${name.slice(-tail)}`;
}

function previewable(mime: string): boolean {
    return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif';
}

function revoke(pages: readonly Page[]): void {
    for (const p of pages) if (p.preview) URL.revokeObjectURL(p.preview);
}

function finalState(state: ReadState): boolean {
    return !readRunning(state);
}

/** "křest, 1843" — the document's kind and year from its result ('' without one). */
function docLabel(res: ReadResult | null | undefined): string {
    if (!res) return '';
    const kinds = strings.read.kinds;
    const kind = kinds[res.doc.kind] ?? kinds.other;
    const year = readDocYear(res.doc.date);
    return year ? `${kind}, ${year}` : kind;
}

/** "2 readers, agree" (green) / "2 readers, 3 places differ" (amber) / "1 reader" (grey). */
function agreeTone(res: ReadResult): { tone: 'is-ok' | 'is-warn' | 'is-muted'; text: string } {
    const t = strings.read;
    const n = res.readers.ran || res.readers.asked;
    if (n < 2) return { tone: 'is-muted', text: t.oneReader };
    if (res.readers.agree === 'differ' || res.readers.agree === 'fixed') {
        return { tone: 'is-warn', text: t.differ(n, Math.max(1, placeCountAll(res.entries))) };
    }
    return { tone: 'is-ok', text: t.agree };
}

function agreeText(res: ReadResult): string {
    return agreeTone(res).text;
}

/** A language's name in the app's language ("Latin", "latinsky"). */
function langName(code: string): string {
    const base = code.toLowerCase().split('-')[0];
    const own = strings.read.langNames[base];
    if (own) return own;
    try {
        return new Intl.DisplayNames([getCurrentLanguage()], { type: 'language' }).of(code) ?? code;
    } catch {
        return code;
    }
}

function langNames(codes: readonly string[]): string {
    return codes.map(langName).join(' / ');
}

/** A transcription's span as plain text (a title): `[?]` dropped, an illegible spot and an empty side said in words. */
function titleMarks(text: string): string {
    const t = strings.read;
    const plain = text.replace(/\[\?\]/g, '').replace(/\[\s*(?:\.{2,}|…)\s*\]/g, ` ${t.illegible} `).replace(/\s*\|\s*/g, ' ')
        .replace(/\s+/g, ' ').trim();
    return plain || t.placeMissing;
}

/** The two readers of a reading that differ, as one line each without the effort (spec 059; null: not said). */
interface VariantWho { a: string; b: string }

/** "Reader 1 · Claude Code · Opus: “text”" — one version of a place where the readers differ. */
function variantWhoLine(n: number, who: string, text: string): string {
    return `${strings.read.readerN(n)} · ${who}: “${text}”`;
}

/** "Baptisms 1846 · excerpt 1": a source read again, as the dialog's subtitle. */
function sourceAgainSub(again: SourceAgain): string {
    return [again.title, again.excerpt ? strings.read.sourceExcerpt(again.excerpt) : ''].filter(Boolean).join(' · ');
}

/** "Excerpt 1" from "excerpt 1". */
function capitalized(text: string): string {
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * Transcription segments as HTML: shape and colour for every mark (dotted, a block, a slash).
 * `who`: each version of a difference gets its reader's mark (1, 2) and the readers in its title.
 */
function segsHtml(segs: readonly LineSeg[], who: VariantWho | null = null): string {
    const t = strings.read;
    return segs.map((sg): string => {
        switch (sg.t) {
            case 'text': return esc(sg.s);
            case 'uncertain':
                return `<mark class="uncertain" title="${esc(t.uncertain)}">${esc(sg.s || '?')}<span class="read-sr"> (${esc(t.uncertain)})</span></mark>`;
            case 'illegible': return `<span class="illegible" role="img" aria-label="${esc(t.illegibleSr)}">${esc(t.illegible)}</span>`;
            case 'sep': return '<span class="read-sep" aria-hidden="true"> | </span>';
            case 'variant': {
                const mk = (n: 1 | 2): string => who ? `<span class="read-variant-mk" data-mk="${n}" aria-hidden="true"></span>` : '';
                const title = who
                    ? `${variantWhoLine(1, who.a, titleMarks(sg.at))}\n${variantWhoLine(2, who.b, titleMarks(sg.other))}`
                    : t.variantNote(titleMarks(sg.at), titleMarks(sg.other));
                return `<span class="read-variant" title="${esc(title)}">`
                    + `<span class="read-variant-a">${segsHtml(sg.a)}</span>${mk(1)}<span class="read-variant-slash" aria-hidden="true">/</span>`
                    + `<span class="read-variant-b">${segsHtml(sg.b)}</span>${mk(2)}</span>`;
            }
        }
    }).join('');
}

/** "word [?]" marks the word (as the research reads it): drawn on the word, not alone. */
function attachUncertain(text: string): string {
    return text.replace(/(\S)\s+\[\?\]/g, '$1[?]');
}

/** One side of a place where readers differ: its marks drawn as in the text; an empty side in words. */
function placeSideHtml(text: string): string {
    return text.trim() ? segsHtml(parseMarks(attachUncertain(text))) : `<span class="read-place-missing">${esc(strings.read.placeMissing)}</span>`;
}

/**
 * A place's two versions as in the text (`a`, the separator, `b`), each with its mark (`marks`: the readers'
 * 1 and 2, or the transcript so far and the new reading; none without them).
 */
function placeVariantHtml(a: string, b: string, marks: readonly [string, string] | null, sep: string, title: string): string {
    const mk = (m: string | undefined): string => m ? `<span class="read-variant-mk" data-mk="${esc(m)}" aria-hidden="true"></span>` : '';
    return `<span class="read-variant" title="${esc(title)}"><span class="read-variant-a">${placeSideHtml(a)}</span>${mk(marks?.[0])}`
        + `<span class="read-variant-slash" aria-hidden="true">${esc(sep)}</span><span class="read-variant-b">${placeSideHtml(b)}</span>${mk(marks?.[1])}</span>`;
}

/** One place as a row: the words before it, its versions, the words after it (`…` where the text goes on, drawn by CSS). */
function placeRowHtml(ctx: PlaceContext | null, variant: string, label = ''): string {
    const part = (text: string, cut: string): string => text
        ? `<span class="read-place-ctx${cut}">${segsHtml(parseMarks(attachUncertain(text)))}</span>` : '';
    const before = ctx ? part(ctx.before, ctx.moreBefore ? ' is-cut-before' : '') : '';
    const after = ctx ? part(ctx.after, ctx.moreAfter ? ' is-cut-after' : '') : '';
    return `<span class="read-place">${label ? `<span class="read-place-label">${esc(label)}:</span> ` : ''}${before}${variant}${after}</span>`;
}

/** Rows of places: past `PLACES_SHOWN` folded behind "and N more" (unfolded in place). */
const PLACES_SHOWN = 8;
function placeRowsHtml(rows: readonly { html: string; cls: string; sub?: string }[]): string {
    const out: string[] = [];
    let subShown = false;
    rows.forEach((r, i) => {
        const more = i >= PLACES_SHOWN ? ' data-more hidden' : '';
        if (r.sub && !subShown) {
            subShown = true;
            out.push(`<li class="read-legend-sub"${more}>${esc(r.sub)}</li>`);
        }
        out.push(`<li class="${r.cls}"${more}>${r.html}</li>`);
    });
    if (rows.length > PLACES_SHOWN) {
        out.push(`<li class="read-legend-more"><button type="button" class="link-button read-places-more" data-act="places-more">${esc(strings.read.placesMore(rows.length - PLACES_SHOWN))}</button></li>`);
    }
    return out.join('');
}

/** An event's name by its GEDCOM tag ("MARR" → "Marriage"), else the tag. */
function readEventName(tag: string): string {
    const t = strings.read;
    const up = tag.toUpperCase();
    const type = up === 'BIRT' ? 'birth' : up === 'DEAT' ? 'death' : gedcomTagEventType(up);
    return up === 'MARR' ? t.marriage : (type ? strings.events.types[type] : '') || tag;
}

/** What a place of the data is about ("Josef Secha · surname", "Marriage · date", "person only at reader 2"). */
function dataPlaceLabel(field: string, at: string, entry: ReadEntry): string {
    const t = strings.read;
    const reader = at ? 1 : 2;
    const person = /^(p\d+)(?:\.(\w+))?$/.exec(field);
    if (person) {
        if (!person[2]) return t.personOnly(reader);
        const p = entry.persons.find(x => x.ref === person[1]);
        const name = p ? [p.given, p.surname].filter(Boolean).join(' ') || p.written : '';
        const what = person[2] === 'role' ? t.variantRole : t.uncertainFields[person[2]] ?? person[2];
        return [name, what].filter(Boolean).join(' · ');
    }
    if (field === 'person') return t.personOnly(reader);
    if (field === 'entry') return t.entryOnly(reader);
    const ev = /^([A-Za-z_]+)(?:\.(date|place))?$/.exec(field);
    if (ev) return [readEventName(ev[1]), ev[2] === 'date' ? t.fieldDate : ev[2] === 'place' ? t.fieldPlace : ''].filter(Boolean).join(' · ');
    return field;
}

/** A region (fractions of the page) as absolute position in per cent. */
export function regionStyle(r: ReadRegion): string {
    const pc = (v: number): string => `${Math.round(v * 100000) / 1000}%`;
    return `left:${pc(r[0])};top:${pc(r[1])};width:${pc(r[2])};height:${pc(r[3])}`;
}

/** The explanation unfolded: as last chosen, else where the result has room for it. */
function glossOpen(): boolean {
    try {
        const v = localStorage.getItem(GLOSS_KEY);
        if (v === '1' || v === '0') return v === '1';
    } catch { /* storage off */ }
    return window.innerWidth > 1180;
}

/**
 * A crop of a read page as HTML: `region` (fractions; null = the whole page)
 * fitted into a `w` × `h` box. For a person's or an event's crop in a
 * suggestion (e.g. 96 × 34).
 */
export function readCropHtml(imageUrl: string, page: Pick<ReadPage, 'w' | 'h'> | null, region: ReadRegion | null, w: number, h: number, alt = ''): string {
    if (!imageUrl) return `<span class="read-crop read-crop--empty" style="width:${w}px;height:${h}px"></span>`;
    const ratio = page && page.w > 0 && page.h > 0 ? page.w / page.h : 0.75;
    const c = cropLayout(region, w, h, ratio, 0.01);
    return `<span class="read-crop" style="width:${w}px;height:${h}px"><img src="${esc(imageUrl)}" alt="${esc(alt)}" draggable="false"`
        + ` style="width:${c.width.toFixed(1)}px;height:${c.height.toFixed(1)}px;left:${c.left.toFixed(1)}px;top:${c.top.toFixed(1)}px"></span>`;
}

function whyReason(accepts: ReadAccepts): string {
    const t = strings.read;
    const reason = t.why[accepts.why] ?? t.why.other;
    if (accepts.why === 'limit' && accepts.resets) {
        const at = new Date(accepts.resets);
        if (Number.isFinite(at.getTime())) {
            return `${reason}, ${t.limitUntil(at.toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' }))}`;
        }
    }
    return reason;
}

export const readDocumentMethods = uiModule({
    // ==================== WHEN IT IS OFFERED ====================

    /**
     * What the research reads now (`accepts.read` of its live status), or null:
     * not a computer, Safari, not a research tree, an archive or a research
     * waiting for its agent, a research that does not read (older), or its
     * bridge not answering.
     */
    readDocumentAccepts(): ReadAccepts | null {
        this.ensureReadListener();
        const link = this.researchOriginalsLink();
        if (!link || !onComputer() || bridgeFailure(null) === 'safari') return null;
        if (this.activeResearchArchive() || this.activeResearchAgentAway()) return null;
        return this.researchStatusOf(link.researchId)?.accepts?.read ?? null;
    },

    /** Reading can start now (no other reading running). */
    readDocumentReady(): boolean {
        const accepts = this.readDocumentAccepts();
        return !!accepts?.ready && !this.readRunningNow();
    },

    /** The research's readings as its bridge listed them last. */
    readsOfResearch(researchId: string): LiveRead[] {
        return Array.from(readsByResearch.get(researchId)?.values() ?? []);
    },

    /** The reading running in the open tree's research (the app's own first), or null. */
    readRunningNow(): LiveRead | null {
        const link = this.researchOriginalsLink();
        if (!link) return null;
        const running = this.readsOfResearch(link.researchId).filter(r => readRunning(r.state));
        return running.find(r => r.from === 'app') ?? running[0] ?? null;
    },

    /** A reading this app started that ended and was not opened yet (newest first), or null. */
    readUnopenedNow(): LiveRead | null {
        const link = this.researchOriginalsLink();
        if (!link) return null;
        const reads = readsByResearch.get(link.researchId);
        if (!reads) return null;
        const memos = readRecent();
        for (const rec of memos) {
            if (rec.opened) continue;
            const r = reads.get(rec.id);
            if (r && (r.state === 'done' || r.state === 'unreadable') && !readSuperseded(r, reads, memos)) return r;
        }
        return null;
    },

    /**
     * The research menu's item, or null (not offered). Running: its state and a
     * dot; done and not opened: "Document read"; not ready: inactive with the
     * reason and a separate "Open research" (its mark).
     */
    readMenuEntry(): { label: string; sub: string; ai: boolean; disabled: boolean; dot: boolean; link?: { label: string; method: string; mark: ResearchActionMark } } | null {
        const accepts = this.readDocumentAccepts();
        if (!accepts) return null;
        const t = strings.read;
        const running = this.readRunningNow();
        if (running) {
            const sub = running.state === 'queued' ? t.menuQueued : t.menuRunningSub(running.done, running.readers, this.readOtherAgents(running));
            return { label: t.menuRunning, sub, ai: false, disabled: false, dot: true };
        }
        const unopened = this.readUnopenedNow();
        if (unopened?.state === 'done') {
            const what = [docLabel(results.get(unopened.id)), this.readOtherAgents(unopened)].filter(Boolean).join(' · ');
            return { label: t.menuDone, sub: t.menuDoneSub(what), ai: false, disabled: false, dot: false };
        }
        if (unopened) return { label: t.menuUnreadable, sub: t.menuUnreadableSub, ai: false, disabled: false, dot: false };
        if (!accepts.ready) {
            return { label: t.menu, sub: t.menuNotNow(whyReason(accepts)), ai: true, disabled: true, dot: false,
                link: { label: t.openResearch, method: 'researchActionOpen', mark: researchLinkMark('open') } };
        }
        return { label: t.menu, sub: t.menuSub, ai: true, disabled: false, dot: false };
    },

    /**
     * The agents a reading read with when one is not the research's own ("Codex", "Claude Code and Codex"),
     * for its line in the research panel, menu and list (spec 059); '' when all read as usual or it is not said.
     */
    readOtherAgents(r: Pick<LiveRead, 'id' | 'who'> | null | undefined): string {
        if (!r) return '';
        const own = this.researchReadAcceptsAny()?.choices?.agents[0]?.id;
        if (!own) return '';
        const names = readWhoOtherAgents(r.who ?? results.get(r.id)?.readers.who, own);
        return names.length >= 2 ? strings.read.agentsPair(names[0], names[1]) : names[0] ?? '';
    },

    // ==================== FOLLOWING THE READINGS ====================

    /** Listen to every status of a bridge (once): the readings it lists. */
    ensureReadListener(): void {
        if (listening) return;
        listening = true;
        onBridgeStatus((researchId, status) => this.onReadStatus(researchId, status));
        // A status that came before: its readings at once (no notice for what ended before).
        const link = this.researchOriginalsLink();
        const known = link ? this.researchStatusOf(link.researchId) : null;
        if (link && known) this.onReadStatus(link.researchId, known);
    },

    /** A status of a research's bridge: its readings, what ended, what to redraw. */
    onReadStatus(researchId: string, status: LiveStatus): void {
        const prev = readsByResearch.get(researchId) ?? new Map<string, LiveRead>();
        const next = new Map<string, LiveRead>();
        for (const r of status.reads ?? []) next.set(r.id, r);
        // A reading just started and not listed yet: kept until the bridge names it.
        if (st?.readId && !next.has(st.readId) && prev.get(st.readId) && readRunning(prev.get(st.readId)!.state)) {
            next.set(st.readId, prev.get(st.readId)!);
        }
        readsByResearch.set(researchId, next);
        this.readsChanged(researchId, prev);
    },

    /** The research's `read` event (following live): one reading's new state, at once. */
    noteReadEvent(researchId: string, data: unknown): void {
        const read = sanitizeLiveRead(data);
        if (!read) return;
        const prev = readsByResearch.get(researchId) ?? new Map<string, LiveRead>();
        const next = new Map(prev);
        // The event does not carry the expected time: the last one the status gave stays while it runs.
        const expect = prev.get(read.id)?.expectSecs;
        next.set(read.id, expect && read.expectSecs === undefined && readRunning(read.state) ? { ...read, expectSecs: expect } : read);
        readsByResearch.set(researchId, next);
        this.readsChanged(researchId, prev);
    },

    /** After new readings: announce what ended, follow it in the dialog, redraw the menu, the strip and the button. */
    readsChanged(researchId: string, prev: Map<string, LiveRead>): void {
        const reads = readsByResearch.get(researchId)!;
        const shownId = st && document.getElementById(DIALOG_ID) ? st.readId : '';
        const shown = shownId ? reads.get(shownId) : undefined;
        if (shown) {
            const before = prev.get(shownId);
            if (!before || before.state !== shown.state || before.done !== shown.done || before.version !== shown.version || before.entries !== shown.entries) this.followReadInDialog(shown);
        }
        // Ended with the dialog closed (or showing something else): the notice, once in the reading's life.
        const { announce, settle, rearm } = readEndsToAnnounce(reads, prev, readRecent(), shownId);
        markAnnounced(rearm, false);
        markAnnounced([...announce.map(r => r.id), ...settle]);
        for (const r of announce) void this.announceReadEnd(researchId, r);
        this.watchReads();
        this.refreshReadSurfaces();
        this.refreshReadSourceViewer();
    },

    /** Redraw the research menu, the panel strip and the button when what they show of the readings changed. */
    refreshReadSurfaces(): void {
        const running = this.readRunningNow();
        const unopened = this.readUnopenedNow();
        const key = [running?.id ?? '', running?.state ?? '', running?.done ?? '', unopened?.id ?? '', unopened?.state ?? '',
            unopened ? docLabel(results.get(unopened.id)) : '', this.readDocumentAccepts()?.ready ?? '',
            this.readOtherAgents(running), this.readOtherAgents(unopened)].join('|');
        if (key === drawnKey) return;
        drawnKey = key;
        setTimeout(() => {
            this.refreshResearchMenu();
            if (document.getElementById('live-panel')) this.renderLivePanel();
        }, 0);
    },

    /** Ask the bridge every few seconds while a reading runs or the dialog is open (the event stream may be off). */
    watchReads(): void {
        const link = this.researchOriginalsLink();
        const needed = !!link && (!!document.getElementById(DIALOG_ID) || this.readsOfResearch(link.researchId).some(r => readRunning(r.state)));
        if (!needed) {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            return;
        }
        if (pollTimer) return;
        pollTimer = setInterval(() => {
            const l = this.researchOriginalsLink();
            if (!l) { this.watchReads(); return; }
            void this.askResearchBridge(l.researchId, POLL_MS).then(() => {
                if (st && document.getElementById(DIALOG_ID) && (st.phase === 'input' || st.phase === 'error')) this.refreshReadGate();
                if (st?.phase === 'propose') this.refreshReadProposeFoot();
                this.watchReads();
            });
        }, POLL_MS);
    },

    /** The notice when a reading of this app ended with the dialog closed. */
    async announceReadEnd(researchId: string, r: LiveRead): Promise<void> {
        const t = strings.read;
        const show = { label: t.show, run: () => this.showReadDocumentDialog({ readId: r.id }) };
        if (r.state === 'done') {
            const res = await this.loadReadResult(researchId, r.id);
            const parts = res ? [docLabel(res), agreeText(res)].filter(Boolean).join(' · ') : '';
            this.showToast(t.notice(parts), NOTICE_MS, { action: show, hold: true, kind: 'read' });
            this.refreshReadSurfaces();
        } else if (r.state === 'unreadable') {
            this.showToast(t.noticeUnreadable, NOTICE_MS, { action: { ...show, label: t.showWhy }, hold: true, kind: 'read' });
        } else if (r.state === 'failed') {
            this.showToast(t.noticeFailed, NOTICE_MS, { action: show, hold: true, kind: 'read' });
        }
    },

    /** The bridge's base address (`http://127.0.0.1:<port>/<token>`) of a research, or ''. */
    readBridgeBase(researchId: string): string {
        return parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? '';
    },

    /** A reading's result (cached once it is final). */
    async loadReadResult(researchId: string, id: string): Promise<ReadResult | null> {
        const cached = results.get(id);
        if (cached && finalState(cached.state)) return cached;
        const base = this.readBridgeBase(researchId);
        if (!base) return cached ?? null;
        const reply = await fetchReadResult(base, id);
        if (!reply.ok) {
            lastFailure.set(id, reply.failure);
            return cached ?? null;
        }
        lastFailure.delete(id);
        results.set(id, reply.value);
        return reply.value;
    },

    // ==================== THE STRIP IN THE RESEARCH PANEL ====================

    /** Under the panel's head, above "Elsewhere": the running reading, or one read and not opened yet. */
    appendReadStrip(panel: HTMLElement): void {
        const t = strings.read;
        const running = this.readRunningNow();
        const unopened = running ? null : this.readUnopenedNow();
        const r = running ?? unopened;
        if (!r) return;
        const strip = document.createElement('div');
        strip.className = 'rs-elsewhere rs-elsewhere--panel read-strip';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'rs-elsewhere__row read-strip__row';
        row.id = 'read-strip';
        const dot = document.createElement('span');
        dot.className = `read-strip__dot${running ? ' is-running' : r.state === 'done' ? ' is-done' : ' is-warn'}`;
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'rs-elsewhere__label read-strip__label';
        label.textContent = running
            ? (running.state === 'queued' ? t.stripQueued : t.stripRunning)
            : r.state === 'done' ? t.stripDone : r.state === 'unreadable' ? t.stripUnreadable : t.stripFailed;
        const name = document.createElement('span');
        name.className = 'rs-elsewhere__name read-strip__name';
        const what = running
            ? [running.readers >= 2 ? t.stripReaders(running.done, running.readers) : '', running.name, this.readOtherAgents(running)].filter(Boolean).join(' · ')
            : [docLabel(results.get(r.id)) || r.name, this.readOtherAgents(r)].filter(Boolean).join(' · ');
        name.textContent = what;
        if (what) name.title = what;
        const chev = document.createElement('span');
        chev.className = 'rs-elsewhere__chev';
        chev.textContent = '›';
        chev.setAttribute('aria-hidden', 'true');
        row.append(dot, label, name, chev);
        row.setAttribute('aria-label', [label.textContent, what].filter(Boolean).join(', '));
        row.onclick = () => this.showReadDocumentDialog({ readId: r.id });
        strip.appendChild(row);
        panel.appendChild(strip);
    },

    // ==================== THE DIALOG ====================

    /**
     * Open the dialog: with files (a drop) or a person (its menu) in the input;
     * with a reading's id (the notice, the strip) on that reading; else on the
     * running reading, the one read and not opened, or a new input.
     */
    showReadDocumentDialog(opts: { personId?: string; files?: File[]; readId?: string; read?: LiveRead; sourceId?: string; entryId?: string; again?: SourceAgain } = {}): void {
        const link = this.researchOriginalsLink();
        // A source's reading opens without a research too: its transcription then stands in.
        const source = opts.sourceId ? DataManager.getData().sources?.[opts.sourceId] : undefined;
        const sourceRead = source?.reading ?? '';
        if (!link && !sourceRead) return;
        this.closeActionsMenu();
        this.hideContextMenu?.();
        if (this.isResearchMenuOpen?.()) this.closeResearchMenu();
        this.ensureReadListener();
        // Already open: files dropped on it again join its pages.
        if (st && document.getElementById(DIALOG_ID)) {
            if (opts.files?.length && st.phase === 'input') this.addReadFiles(opts.files);
            return;
        }
        const readId = sourceRead || opts.readId || '';
        if (opts.read && opts.read.id === readId) historyReads.set(readId, opts.read);
        const target = !link ? null : readId
            // Not listed live any more (an older reading of the history): as the history said it.
            ? this.readsOfResearch(link.researchId).find(r => r.id === readId) ?? (opts.read?.id === readId ? opts.read : null)
            : opts.files?.length || opts.personId || opts.again ? null : this.readRunningNow() ?? this.readUnopenedNow();
        if (!target && !readId && !this.readDocumentAccepts()) return;
        st = {
            phase: 'input', pages: [], personId: opts.personId ?? '', note: '', readers: storedReaders(), readId: '',
            sending: null, sawChecking: false, startedAt: Date.now(), error: null, result: results.get(readId) ?? null,
            notice: '', picker: null, busy: false, entry: 0, line: -1, page: 1, second: false,
            sourceId: sourceRead ? opts.sourceId ?? '' : '', entryId: sourceRead ? source?.readingEntry ?? '' : opts.entryId ?? '',
            mode: opts.again ? 'source' : 'document', with: null, refineOpen: false, agentDown: {}, sentWith: null, choicesKey: '',
            srcAgain: opts.again ?? null,
        };
        const overlay = document.createElement('div');
        overlay.id = DIALOG_ID;
        overlay.className = 'modal-overlay active';
        // Opened over a dialog that stands higher than the usual (a source's detail): above it.
        const under = Array.from(document.querySelectorAll<HTMLElement>('.modal-overlay.active'))
            .reduce((max, el) => Math.max(max, Number(getComputedStyle(el).zIndex) || 0), 0);
        if (under > 200) overlay.style.zIndex = String(under + 1);
        document.body.appendChild(overlay);
        this.pushDialog(DIALOG_ID);
        pasteHandler = (e: ClipboardEvent) => {
            if (!st || st.phase !== 'input') return;
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length === 0) return;
            e.preventDefault();
            this.addReadFiles(files);
        };
        document.addEventListener('paste', pasteHandler);
        const blocked = sourceRead ? this.readSourceBlocked() : null;
        if (blocked) {
            st.readId = readId;
            st.phase = 'error';
            st.error = { kind: 'source', why: blocked };
            this.renderReadDialog();
        } else if (target || readId) {
            st.readId = target?.id ?? readId;
            st.phase = 'progress';
            if (target) this.followReadInDialog(target);
            else void this.openReadResult(st.readId);
        } else {
            if (opts.files?.length) this.addReadFiles(opts.files, false);
            this.renderReadDialog();
        }
        this.watchReads();
    },

    /** A source's reading result (its link in the source's detail and a person's sources). */
    showReadingOfSource(sourceId: string): void {
        this.showReadDocumentDialog({ sourceId });
    },

    /**
     * "Read again…" at a source (spec 059 §4): the source's input (readers, "Adjust reading"), or the
     * progress of its reading when one runs. `clip`: one excerpt alone; '' the whole entry.
     */
    showReadSourceAgain(sourceId: string, clip = ''): void {
        const link = this.researchOriginalsLink();
        const again = this.readSourceAgainOf(sourceId, clip);
        if (!link || !again) return;
        const running = this.readSourceRunning(again.refn);
        if (running) { this.showReadDocumentDialog({ readId: running.id }); return; }
        this.showReadDocumentDialog({ again });
    },

    /** What reading a source again shows of it (null: no such source, no id of the research). */
    readSourceAgainOf(sourceId: string, clip = ''): SourceAgain | null {
        const src = DataManager.getData().sources?.[sourceId];
        const refn = readSourceId(src?.refn?.trim());
        if (!src || !refn) return null;
        const excerpts = shownExcerpts(DataManager.getCurrentTreeId(), src);
        const at = clip ? excerpts.findIndex(e => e.clip === clip) : -1;
        const pic = excerpts[Math.max(0, at)];
        return {
            id: sourceId, refn, clip, excerpt: clip ? Math.max(0, at) + 1 : 0, title: src.title,
            thumb: pic?.dataUrl ? excerptImageUrl(pic) : '',
        };
    },

    /** The reading of a source (S…) running in the open tree's research, or null. */
    readSourceRunning(refn: string): LiveRead | null {
        const link = this.researchOriginalsLink();
        if (!link || !refn) return null;
        return this.readsOfResearch(link.researchId).find(r => r.source === refn && readRunning(r.state)) ?? null;
    },

    /** The source a reading reads again (the dialog's own, else as the bridge lists the reading), or null. */
    readSourceAgainNow(): SourceAgain | null {
        if (!st) return null;
        if (st.srcAgain) return st.srcAgain;
        const refn = this.readLiveOf(st.readId)?.source ?? results.get(st.readId)?.source?.id ?? '';
        if (!refn) return null;
        const id = Object.values(DataManager.getData().sources ?? {}).find(src => readSourceId(src.refn?.trim()) === refn)?.id;
        const again = id ? this.readSourceAgainOf(id) : null;
        if (again) st.srcAgain = again;
        return again;
    },

    /** The newest result of a source read again known here (null: none). */
    readSourceResultOf(refn: string): ReadResult | null {
        let last: ReadResult | null = null;
        for (const res of results.values()) if (res.source?.id === refn && res.state === 'done') last = res;
        return last;
    },

    /** Why a source's reading cannot be fetched now at all (null: ask the research). */
    readSourceBlocked(): SourceWhy | null {
        const link = this.researchOriginalsLink();
        if (!link) return this.researchSyncLink() && researchLinksEnabled() && !onComputer() ? 'computer' : 'unlinked';
        if (this.activeResearchAgentless()) return 'archive';
        if (!this.researchBridgeUp(link.researchId) || !this.readBridgeBase(link.researchId)) return 'down';
        // An older research has no reading results to give (`GET read/<id>` is an unknown path there).
        const status = this.researchStatusOf(link.researchId);
        if (status && !status.features?.includes(READ_FEATURE) && !status.accepts?.read) return 'older';
        return null;
    },

    /** Close the dialog (a running reading goes on). */
    closeReadDocumentDialog(): void {
        document.getElementById(DIALOG_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== DIALOG_ID);
        if (pasteHandler) document.removeEventListener('paste', pasteHandler);
        pasteHandler = null;
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        scanObserver?.disconnect();
        scanObserver = null;
        if (st) {
            st.picker?.destroy();
            revoke(st.pages);
        }
        st = null;
        this.resetReadPropose();
        this.watchReads();
        this.refreshReadSurfaces();
    },

    /** Files picked, dropped or pasted: pages in order (a refused one stays with its reason). */
    addReadFiles(files: File[], render = true): void {
        if (!st) return;
        for (const file of files) {
            const mime = readFileMime(file);
            st.pages.push({ key: nextKey++, file, mime, kind: readFileKind(file), preview: previewable(mime) ? URL.createObjectURL(file) : '', sha: '', refused: null });
        }
        st.notice = '';
        if (render) this.renderReadDialog();
    },

    /** The pages' refusals: the research's own first, then its kinds, size and count (in order). */
    readPageRefusals(): (ReadFileRefusal | null)[] {
        const accepts = this.researchReadAcceptsAny();
        if (!st) return [];
        if (!accepts) return st.pages.map(p => p.refused);
        const open = st.pages.filter(p => !p.refused);
        const r = readFileRefusals(open.map(p => ({ type: p.mime, name: p.file.name, size: p.file.size })), accepts);
        let i = 0;
        return st.pages.map(p => p.refused ?? r[i++] ?? null);
    },

    /** What the research reads, live or as it said last (the dialog keeps its limits while the bridge is away). */
    researchReadAcceptsAny(): ReadAccepts | null {
        const link = this.researchOriginalsLink();
        if (!link) return null;
        return this.researchStatusOf(link.researchId)?.accepts?.read ?? this.researchAcceptsOf(link.researchId)?.read ?? null;
    },

    /** What stands in the way of reading now, in the input (null: nothing). */
    readInputGate(): ErrorKind | null {
        const link = this.researchOriginalsLink();
        if (!link) return 'down';
        const status = this.researchStatusOf(link.researchId);
        if (!status || !this.researchBridgeUp(link.researchId)) return 'down';
        const accepts = status.accepts?.read;
        if (!accepts) return 'older';
        if (!accepts.ready) return 'not-ready';
        return null;
    },

    /** After a status with the input or an error shown: its gate again (a bridge back, a research updated). */
    refreshReadGate(): void {
        if (!st) return;
        if (st.phase === 'error' && st.error?.kind === 'source' && (st.error.why === 'down' || st.error.why === 'older')) {
            const why = this.readSourceBlocked();
            if (!why) {
                st.phase = 'progress';
                st.error = null;
                void this.openReadResult(st.readId);
            } else if ((why === 'down' || why === 'older') && why !== st.error.why) {
                st.error = { kind: 'source', why };
                this.renderReadDialog();
            }
            return;
        }
        if (st.phase === 'error' && st.error && ['down', 'not-ready', 'older'].includes(st.error.kind)) {
            if (!this.readInputGate()) {
                st.phase = 'input';
                st.error = null;
                this.renderReadDialog();
            }
            return;
        }
        if (st.phase === 'input') {
            const gate = this.readInputGate();
            if (gate) {
                st.phase = 'error';
                st.error = { kind: gate };
                this.renderReadDialog();
                return;
            }
            // The research's offer of agents changed (an agent ready again, a model added): who reads drawn again.
            const choices = this.readChoicesNow();
            if ((choices ? JSON.stringify(choices) : '') !== st.choicesKey) {
                if (!choices) st.choicesKey = '';
                if (document.querySelector(`#${DIALOG_ID} #read-choose`)) this.readRedrawChoose();
            }
        }
    },

    // ==================== RENDERING ====================

    renderReadDialog(): void {
        const overlay = document.getElementById(DIALOG_ID);
        if (!overlay || !st) return;
        if (st.phase === 'input') {
            const gate = this.readInputGate();
            if (gate) { st.phase = 'error'; st.error = { kind: gate }; }
        }
        st.picker?.destroy();
        st.picker = null;
        scanObserver?.disconnect();
        scanObserver = null;
        const link = this.researchOriginalsLink();
        const tree = link ? TreeManager.getTreeMetadata(link.treeId)?.name ?? '' : '';
        const t = strings.read;
        let title = t.title;
        let sub = t.sub(tree);
        let subHtml = '';
        let body = '';
        let foot = '';
        let wide = false;
        let headLead = '';
        if (st.phase === 'input') {
            body = this.readInputHtml();
            foot = this.readInputFootHtml();
            if (st.mode === 'again') {
                const live = this.readLiveOf(st.readId);
                title = t.readAgain;
                sub = live?.name ? t.progressSub(live.name, live.pages) : sub;
            } else if (st.mode === 'source' && st.srcAgain) {
                title = t.titleSource;
                sub = sourceAgainSub(st.srcAgain);
            }
        } else if (st.phase === 'progress') {
            const live = this.readLiveOf(st.readId);
            const again = live?.source || st.srcAgain ? this.readSourceAgainNow() : null;
            title = again ? t.readingAgain : t.progressTitle;
            // The dialog's own files name it first: a page the research already had comes back under its hash.
            sub = again ? sourceAgainSub(again)
                : t.progressSub(st.pages.find(p => !p.refused)?.file.name || live?.name || '', live?.pages || st.pages.filter(p => !p.refused).length);
            body = this.readProgressHtml();
            foot = this.readProgressFootHtml();
        } else if ((st.phase === 'propose' || st.phase === 'written') && st.result) {
            const view = this.readProposeView(link ? this.readBridgeBase(link.researchId) : '');
            title = view.title;
            sub = view.sub;
            body = view.body;
            foot = view.foot;
            wide = view.wide;
            headLead = view.lead;
        } else if (st.phase === 'result' && st.result) {
            title = this.readResultTitle(st.result);
            subHtml = this.readResultSubtitle(st.result);
            body = this.readResultHtml(st.result, link ? this.readBridgeBase(link.researchId) : '');
            foot = this.readResultFootHtml();
            wide = true;
        } else {
            body = this.readErrorHtml();
            foot = this.readErrorFootHtml();
            if (st.error?.kind === 'source') {
                const src = DataManager.getData().sources?.[st.sourceId];
                title = src?.title || t.sourceLink.replace(/…$/, '');
                sub = tree;
            } else if (st.srcAgain) {
                title = t.titleSource;
                sub = sourceAgainSub(st.srcAgain);
            }
        }
        overlay.innerHTML = `
            <div class="modal batch-dialog read-dialog${wide ? ' read-dialog--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="read-title" data-phase="${st.phase}">
                <div class="modal-header batch-header">
                    ${headLead}<div class="audit-log-heading">
                        <h2 id="read-title">${esc(title)}</h2>
                        <div class="audit-log-subtitle${subHtml ? ' read-result-sub' : ''}">${subHtml || esc(sub)}</div>
                    </div>
                    <button type="button" class="close-btn" data-act="close" aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                ${st.notice ? `<p class="read-notice" role="status">${esc(st.notice)}</p>` : ''}
                <div class="modal-content batch-content read-content${wide ? ' read-content--result' : ''}">${body}</div>
                <div class="buttons batch-footer read-footer${wide || st.phase === 'written' ? ' read-footer--result' : ''}">${foot}</div>
            </div>`;
        overlay.querySelector('.read-dialog > .modal-header > [data-act="close"]')?.before(helpMark('readDocument'));
        this.wireReadDialog(overlay);
        this.tickReadProgress();
    },

    readInputHtml(): string {
        const s = st!;
        const t = strings.read;
        const accepts = this.researchReadAcceptsAny();
        const types = accepts?.types ?? [];
        const kinds = types.map(m => readFileKind({ type: m, name: '' })).join(', ');
        const limits = accepts ? t.limits(kinds, accepts.pages, Math.round(accepts.max / 1024 / 1024)) : '';
        const accept = [...types, ...types.includes('image/heic') ? ['.heic', '.heif'] : []].join(',');
        let top: string;
        if (s.pages.length === 0) {
            top = `
                <div class="read-drop" id="read-drop">
                    <div class="read-drop-title">${esc(t.drop)}</div>
                    <div class="read-drop-sub">${esc(t.dropSub)}</div>
                    <button type="button" class="secondary read-pick" data-act="pick">${esc(t.pick)}</button>
                    ${limits ? `<div class="read-limits">${esc(limits)}</div>` : ''}
                </div>`;
        } else {
            const refusals = this.readPageRefusals();
            const taken = s.pages.filter((_, i) => !refusals[i]);
            const size = taken.reduce((sum, p) => sum + p.file.size, 0);
            top = `
                <div class="read-pages-head">
                    <span class="read-pages-title">${esc(t.pagesTitle)}</span>
                    <span class="read-pages-sum">${esc(t.pagesSummary(taken.length, formatBytesShort(size)))}</span>
                    <span class="read-pages-hint">${esc(t.pagesHint)}</span>
                </div>
                <ol class="read-pages" id="read-pages">${this.readPageRowsHtml(refusals)}</ol>
                <div class="read-more" id="read-drop">
                    <span>${esc(t.dropMore)}</span>
                    <button type="button" class="research-sync-link read-pick-more" data-act="pick">${esc(t.pickMore)}</button>
                </div>`;
        }
        const readers = (accepts?.readers ?? 1) >= 2 ? `
                <fieldset class="read-readers">
                    <legend>${esc(t.readers)} <span class="read-readers-gloss">${esc(t.readersGloss)}</span></legend>
                    ${([1, 2] as const).map(n => `
                    <label class="read-reader${s.readers === n ? ' is-checked' : ''}">
                        <input type="radio" name="read-readers" value="${n}"${s.readers === n ? ' checked' : ''}>
                        <span class="read-reader-text"><strong>${esc(n === 1 ? t.r1 : t.r2)}</strong><span>${esc(n === 1 ? t.r1Sub : t.r2Sub)}</span></span>
                    </label>`).join('')}
                </fieldset>` : '';
        const choose = `<div id="read-choose" class="read-choose">${this.readChooseHtml()}</div>`;
        const slow = readSlow(accepts?.expectSecs) ? `<p class="read-slow-note">${esc(t.slowReader)}</p>` : '';
        if (s.mode === 'again') return `${readers}${choose}`;
        if (s.mode === 'source' && s.srcAgain) return `${this.readSourcePreviewHtml(s.srcAgain)}${readers}${choose}`;
        return `
                ${top}
                ${slow}
                <input type="file" id="read-input" multiple accept="${esc(accept)}" hidden>
                <div class="read-fields">
                    <div class="batch-field"><span id="read-person-label">${esc(t.person)} <span class="batch-optional">${esc(t.optional)}</span></span>
                        <div id="read-person-picker" class="read-person-picker"></div></div>
                    <label class="batch-field"><span>${esc(t.note)} <span class="batch-optional">${esc(t.optional)}</span></span>
                        <textarea id="read-note" rows="2" maxlength="${NOTE_MAX}" placeholder="${esc(t.notePlaceholder)}">${esc(s.note)}</textarea></label>
                </div>
                ${readers}
                ${choose}`;
    },

    /** In place of the pages: the excerpt (or the entry) read again and what reading it again does. */
    readSourcePreviewHtml(again: SourceAgain): string {
        const t = strings.read;
        const what = [again.excerpt ? capitalized(t.sourceExcerpt(again.excerpt)) : '', again.title].filter(Boolean).join(' · ');
        return `
                <div class="read-source-preview">
                    ${again.thumb ? `<img class="read-source-thumb" src="${esc(again.thumb)}" alt="">` : ''}
                    <div class="read-source-preview-text">
                        <span class="read-source-what">${esc(what)}</span>
                        <p class="read-source-gloss"><strong>${esc(t.sourceStrong)}</strong> ${esc(t.sourceText)}</p>
                    </div>
                </div>`;
    },

    /** The research's offer of agents, models and efforts, with the agents it turned down here as not ready (null: no choice). */
    readChoicesNow(): ReadChoices | null {
        const choices = this.researchReadAcceptsAny()?.choices;
        if (!choices || !st) return choices ?? null;
        const down = st.agentDown;
        if (!Object.keys(down).length) return choices;
        return {
            ...choices,
            agents: choices.agents.map(a => down[a.id] && a.ready ? { ...a, ready: false, why: down[a.id].why, resets: down[a.id].resets } : a),
        };
    },

    /** The readers chosen (always two; the second used only with two readers), set up from the offer on first use. */
    readChosen(choices: ReadChoices): ReaderChoice[] {
        const s = st!;
        if (!s.with) s.with = readersFromStored(choices, storedWith(), 2);
        else s.with = readersFromStored(choices, s.with, 2);
        return s.with;
    },

    /** "Who reads" with "Adjust reading" and its panel (empty: the research offers no choice). */
    readChooseHtml(): string {
        const s = st!;
        const t = strings.read;
        const choices = this.readChoicesNow();
        if (!choices) return '';
        s.choicesKey = JSON.stringify(choices);
        const chosen = this.readChosen(choices).slice(0, s.readers);
        const changed = readersChanged(choices, chosen);
        const state = changed
            ? `<span class="read-who-state"><span class="read-who-tag">${esc(t.changed)}</span><button type="button" class="research-sync-link read-reset" data-act="reset-with">${esc(t.reset)}</button></span>`
            : `<span class="read-who-state"><span class="read-who-from">${esc(t.fromSettings)}</span></span>`;
        const toggle = `<button type="button" class="research-sync-link read-refine-toggle" data-act="refine" aria-expanded="${s.refineOpen}" aria-controls="read-refine-panel">${esc(t.refine)} <span aria-hidden="true">${s.refineOpen ? '▴' : '▾'}</span></button>`;
        if (!s.refineOpen) {
            const items = chosen.map((r, at) => {
                const a = choices.agents.find(x => x.id === r.agent);
                const down = a && !a.ready ? ` · ${agentWhyText(a.why, a.resets)}` : '';
                return { label: readerLabel(choices, r), down, same: at === 0 || sameReader(r, chosen[0]) };
            });
            const line = (key: string, i: typeof items[number]): string =>
                `<span class="read-who-line"><span class="read-who-key">${esc(key)}</span> <span class="read-who-val">${esc(i.label)}</span>${i.down ? `<span class="read-who-down">${esc(i.down)}</span>` : ''}</span>`;
            const main = items.length === 1 ? line(t.whoOne, items[0])
                : items.every(i => i.same) ? line(t.whoBoth, items[0])
                    : items.map((i, k) => line(t.whoN(k + 1), i)).join('');
            return `
                <div class="read-who">
                    <div class="read-who-main">${main}${state}</div>
                    ${toggle}
                </div>`;
        }
        const rows = chosen.map((r, at) => this.readRefineRowHtml(choices, r, at, chosen.length)).join('');
        return `
                <div class="read-who read-who--open">${toggle}${state}</div>
                <div class="read-refine" id="read-refine-panel">
                    <div class="read-refine-cols" aria-hidden="true"><span></span><span>${esc(t.colAgent)}</span><span>${esc(t.colModel)}</span><span>${esc(t.colEffort)}</span></div>
                    ${rows}
                </div>`;
    },

    /** One reader's row of the panel: its agent, model and effort, and a note under it. */
    readRefineRowHtml(choices: ReadChoices, r: ReaderChoice, at: number, n: number): string {
        const t = strings.read;
        const label = n === 1 ? t.rowOnly : at === 0 ? t.row1 : t.row2;
        const a = choices.agents.find(x => x.id === r.agent);
        const select = (field: 'agent' | 'model' | 'effort', col: string, options: { value: string; text: string; disabled?: boolean }[], value: string): string => {
            const current = options.find(o => o.value === value)?.text ?? '';
            return `<select class="read-refine-select" data-at="${at}" data-field="${field}" aria-label="${esc(`${label} – ${col}`)}" title="${esc(current)}">${
                options.map(o => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}${o.disabled && o.value !== value ? ' disabled' : ''}>${esc(o.text)}</option>`).join('')}</select>`;
        };
        const agents = choices.agents.map(x => ({ value: x.id, text: x.ready ? x.name : `${x.name} – ${agentWhyText(x.why, x.resets)}`, disabled: !x.ready }));
        const models = (a?.models ?? []).map(m => ({ value: m.id, text: m.id ? m.name || m.id : t.bySettings }));
        // On a phone each choice is a full-width field with its column's name inside, on the left (spec 059 §2).
        const field = (col: string, inner: string, none = false): string =>
            `<span class="read-refine-field${none ? ' read-refine-field--none' : ''}"><span class="read-refine-field-key" aria-hidden="true">${esc(col)}</span>${inner}</span>`;
        const effort = a?.efforts.length
            ? field(t.colEffort, select('effort', t.colEffort, a.efforts.map(e => ({ value: e, text: e || t.bySettings })), r.effort))
            : field(t.colEffort, `<span class="read-refine-noeffort">${esc(t.noEffort)}</span>`, true);
        let note = '';
        if (a && !a.ready) {
            const why = agentWhyText(a.why, a.resets);
            note = `<div class="read-refine-note is-down">${esc(a.why === 'limit' ? t.downRowLimit(a.name, why) : t.downRow(a.name, why))}</div>`;
        } else if (a && a.id !== choices.agents[0]?.id) {
            note = `<div class="read-refine-note">${esc(t.billAny(a.name))}</div>`;
        }
        return `
                    <div class="read-refine-row" data-at="${at}">
                        <span class="read-refine-label">${esc(label)}</span>
                        ${field(t.colAgent, select('agent', t.colAgent, agents, r.agent))}
                        ${field(t.colModel, select('model', t.colModel, models, r.model))}
                        ${effort}
                        ${note}
                    </div>`;
    },

    /** A reader's agent, model or effort chosen in the panel. */
    readSetReader(at: number, field: 'agent' | 'model' | 'effort', value: string): void {
        const s = st;
        const choices = this.readChoicesNow();
        if (!s || !choices) return;
        const chosen = this.readChosen(choices);
        if (!chosen[at]) return;
        if (field === 'agent') chosen[at] = readerWithAgent(choices, value) ?? chosen[at];
        else chosen[at] = { ...chosen[at], [field]: value };
        this.readRedrawChoose();
    },

    /** "Who reads" and the footer drawn again (the focus stays where it was). */
    readRedrawChoose(): void {
        const overlay = document.getElementById(DIALOG_ID);
        const box = overlay?.querySelector<HTMLElement>('#read-choose');
        if (!overlay || !box || !st) return;
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && box.contains(active)
            ? active.matches('select') ? `select[data-at="${active.dataset.at}"][data-field="${active.dataset.field}"]` : active.dataset.act ? `[data-act="${active.dataset.act}"]` : ''
            : '';
        box.innerHTML = this.readChooseHtml();
        const foot = overlay.querySelector<HTMLElement>('.read-footer');
        if (foot && st.phase === 'input') foot.innerHTML = this.readInputFootHtml();
        if (focusKey) (box.querySelector<HTMLElement>(focusKey) ?? box.querySelector<HTMLElement>('[data-act="refine"]'))?.focus();
    },

    readPageRowsHtml(refusals: (ReadFileRefusal | null)[]): string {
        const s = st!;
        const t = strings.read;
        let n = 0;
        return s.pages.map((p, i) => {
            const refusal = refusals[i];
            const name = p.file.name || p.kind;
            const size = formatBytesShort(p.file.size);
            const thumb = p.preview
                ? `<img src="${esc(p.preview)}" alt="" draggable="false">`
                : `<span class="read-tile"><strong>${esc(p.kind)}</strong><small>${esc(t.noPreview)}</small></span>`;
            if (refusal) {
                const why = refusal.kind === 'type' ? `${t.errType(refusal.type)} ${t.asMaterial}`
                    : refusal.kind === 'size' ? t.errSize(refusal.mb, refusal.maxMb) : t.errPages(refusal.pages);
                return `
                    <li class="read-page is-refused" data-key="${p.key}">
                        <span class="read-grip" aria-hidden="true"></span>
                        <span class="read-thumb">${thumb}</span>
                        <span class="read-page-text">
                            <span class="read-page-name" title="${esc(name)}">${esc(middleName(name))}</span>
                            <span class="read-page-why">${esc(why)}</span>
                            <span class="read-page-meta">${esc(t.refusedLine(p.kind, size))}</span>
                        </span>
                        <span class="read-page-actions">
                            <button type="button" class="research-sync-link read-remove" data-act="remove" data-key="${p.key}" aria-label="${esc(t.removeSr(name))}">${esc(t.remove)}</button>
                        </span>
                    </li>`;
            }
            n++;
            const first = n === 1;
            const last = !s.pages.slice(i + 1).some((_, j) => !refusals[i + 1 + j]);
            return `
                    <li class="read-page" data-key="${p.key}" draggable="true" tabindex="0" aria-label="${esc(`${t.pageLine(n, p.kind, size)}, ${name}`)}">
                        <span class="read-grip" aria-hidden="true">⋮⋮</span>
                        <span class="read-thumb">${thumb}</span>
                        <span class="read-page-text">
                            <span class="read-page-name" title="${esc(name)}">${esc(middleName(name))}</span>
                            <span class="read-page-meta">${esc(t.pageLine(n, p.kind, size))}</span>
                            ${p.preview ? '' : `<span class="read-page-meta">${esc(t.noPreviewSub)}</span>`}
                        </span>
                        <span class="read-page-actions">
                            <button type="button" class="read-icon-btn" data-act="up" data-key="${p.key}" aria-label="${esc(t.moveUp(name))}"${first ? ' disabled' : ''}>↑</button>
                            <button type="button" class="read-icon-btn" data-act="down" data-key="${p.key}" aria-label="${esc(t.moveDown(name))}"${last ? ' disabled' : ''}>↓</button>
                            <button type="button" class="read-icon-btn" data-act="remove" data-key="${p.key}" aria-label="${esc(t.removeSr(name))}">×</button>
                        </span>
                    </li>`;
        }).join('');
    },

    readInputFootHtml(): string {
        const s = st!;
        const t = strings.read;
        const again = s.mode === 'again';
        const source = s.mode === 'source' ? s.srcAgain : null;
        const refusals = s.mode !== 'document' ? [] : this.readPageRefusals();
        const taken = again ? this.readLiveOf(s.readId)?.pages || 1 : source ? 1 : s.pages.filter((_, i) => !refusals[i]).length;
        const refused = s.mode !== 'document' ? 0 : s.pages.length - taken;
        const choices = this.readChoicesNow();
        const held = choices ? readerHeld(choices, this.readChosen(choices).slice(0, s.readers)) : null;
        const sum = !source ? t.footSum(taken, s.readers) : source.clip ? t.footSource(s.readers) : t.footSourceWhole(s.readers);
        const usual = this.readUsualNow(null, s.readers);
        const note = taken > 0
            ? `<strong>${esc(sum)}</strong>${usual !== null ? ` ${esc(t.usual(usual))}` : ''}${refused ? ` · ${esc(t.refusedNotSent)}` : ''}`
            : '';
        const down = held ? `<span class="read-foot-down">${esc(t.downFoot)}</span>` : '';
        return `
                <div class="batch-foot-note" id="read-foot-note">${note}${down}</div>
                <button type="button" class="secondary" data-act="close">${esc(t.close)}</button>
                <button type="button" class="primary" data-act="read"${taken === 0 || s.busy || held ? ' disabled' : ''}>${researchBridgeAgentLabel(again ? t.readAgain : t.read)}</button>`;
    },

    /** The reading as the bridge listed it last (null: not listed). */
    readLiveOf(id: string): LiveRead | null {
        const link = this.researchOriginalsLink();
        if (!link || !id) return null;
        return readsByResearch.get(link.researchId)?.get(id) ?? historyReads.get(id) ?? null;
    },

    /**
     * The minutes a reading is said to take: by its slowest reader (agent, model, effort; the research's
     * measure of its own agent, else the readings of this research that ended). Null: a reader's pace is not
     * known (another agent never read with here) — no time is said rather than one too short.
     */
    readUsualNow(live: LiveRead | null, readers: number): number | null {
        const s = st;
        const choices = this.readChoicesNow();
        const n = Math.max(1, Math.min(2, readers));
        const chosen: ReadPaceReader[] | null = live?.who?.length ? live.who
            : !choices ? null
                : s?.sentWith ?? s?.with ?? [readerDefault(choices, 0), readerDefault(choices, 1)];
        const fromLive = live?.expectSecs !== undefined;
        const who = chosen?.slice(0, n) ?? null;
        const link = this.researchOriginalsLink();
        const pace = readPaceSecs(who, {
            expectSecs: this.readExpectSecs(live),
            measured: fromLive ? who?.[0]?.agent ?? '' : choices?.agents[0]?.id ?? '',
            history: link ? [...(readsByResearch.get(link.researchId)?.values() ?? [])] : [],
            except: s?.readId ?? '',
        });
        return pace === null ? null : readUsualMinutes(n, pace);
    },

    /** How long a reading takes (seconds): the bridge's word for it, else what the research said before it started. */
    readExpectSecs(live: LiveRead | null): number | undefined {
        return live?.expectSecs ?? this.researchReadAcceptsAny()?.expectSecs;
    },

    /**
     * Whether the agent itself is slow (the several-minutes line). While queued
     * the bridge's time includes the wait for the readings before it, so only
     * the research's word for one reading counts there.
     */
    readSlowNow(live: LiveRead | null): boolean {
        return readSlow(live?.state === 'queued' ? this.researchReadAcceptsAny()?.expectSecs : this.readExpectSecs(live));
    },

    readProgressHtml(): string {
        const s = st!;
        const t = strings.read;
        const live = this.readLiveOf(s.readId);
        const state: ReadState | 'sending' = s.sending ? 'sending' : live?.state ?? 'queued';
        if (state === 'checking') s.sawChecking = true;
        const readers = live?.readers || s.readers;
        const first = s.pages.find(p => !p.refused);
        // A source read again: its excerpt, and its comparison with the transcript as a step even with one reader.
        const again = live?.source || s.srcAgain ? this.readSourceAgainNow() : null;
        const thumb = first?.preview || again?.thumb
            ? `<img src="${esc(first?.preview || again!.thumb)}" alt="">`
            : `<span class="read-tile"><strong>${esc(first?.kind ?? '')}</strong></span>`;
        const step = (mark: 'done' | 'now' | 'wait', text: string, extra = ''): string =>
            `<li class="read-step is-${mark}"><span class="read-step-mark" aria-hidden="true">${mark === 'done' ? '✓' : ''}</span>`
            + `<span class="read-step-body"><span class="read-step-text">${esc(text)}</span>${extra}</span></li>`;
        const sendingText = s.sending ? t.sendingPage(s.sending.k, s.sending.n) : state === 'queued' ? t.queued : t.sent;
        const sendMark = state === 'sending' ? 'now' : state === 'queued' ? 'now' : 'done';
        const readMark = state === 'reading' ? 'now' : state === 'checking' || state === 'done' ? 'done' : 'wait';
        const done = live?.done ?? 0;
        const bar = readers >= 2 && (state === 'reading' || state === 'checking')
            ? `<span class="read-step-sub">${esc(t.readersDone(done, readers))}</span>`
              + `<span class="batch-bar read-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${readers}" aria-valuenow="${done}" aria-label="${esc(t.readersDone(done, readers))}"><span style="width:${Math.round(done / readers * 100)}%"></span></span>`
            : '';
        const steps = [
            step(sendMark, sendingText),
            step(readMark, readMark === 'done' ? t.readDone : t.reading, bar + this.readProgressWhoHtml(live, state, readers)),
            ...(again ? [step(state === 'checking' ? 'now' : state === 'done' ? 'done' : 'wait', t.comparingSource)]
                : s.sawChecking ? [step(state === 'checking' ? 'now' : 'done', t.checking)] : []),
        ].join('');
        return `
                <div class="read-progress">
                    <div class="read-progress-thumb">${thumb}</div>
                    <ol class="read-steps">${steps}</ol>
                </div>
                <p class="read-progress-time" id="read-progress-time"></p>
                <p class="read-progress-expect" id="read-progress-expect"${this.readSlowNow(live) ? '' : ' hidden'}>${esc(t.slowReader)}</p>
                <p class="read-progress-slow" id="read-progress-slow" hidden>${esc(t.slow)}</p>
                <p class="read-progress-note">${esc(t.closeNote)}</p>
                ${this.readSoFarHtml()}`;
    },

    /**
     * Under "Reading": each reader with its agent, model and effort, done or reading — only when
     * they read otherwise than by default (spec 059); else nothing, as before.
     */
    readProgressWhoHtml(live: LiveRead | null, state: ReadState | 'sending', readers: number): string {
        const s = st!;
        const t = strings.read;
        const choices = this.readChoicesNow();
        if (!choices) return '';
        let labels: string[];
        if (live?.who?.length) {
            const differs = live.who.some((w, at) => !sameReader(w, readerDefault(choices, at)));
            if (!differs) return '';
            labels = live.who.slice(0, readers).map(w => whoLabel(w, choices));
        } else if (s.sentWith) {
            labels = s.sentWith.slice(0, readers).map(r => readerLabel(choices, r));
        } else return '';
        const done = live?.done ?? 0;
        const running = state === 'reading' || state === 'checking';
        const items = labels.map((label, at) => {
            const mark = !running ? '' : done > at || state === 'checking'
                ? ` · <span class="read-progress-who-state is-done">${esc(t.finished)}</span>`
                : ` · <span class="read-progress-who-state is-now">${esc(t.readingNow)}</span>`;
            return `<li><span class="read-who-key">${esc(labels.length === 1 ? t.whoOne : t.whoN(at + 1))}</span> <span class="read-who-val">${esc(label)}</span>${mark}</li>`;
        }).join('');
        return `<ul class="read-progress-who">${items}</ul>`;
    },

    /** While it reads: the entries read so far (a result that grows), with their marks. */
    readSoFarHtml(): string {
        const sofar = st ? results.get(st.readId) : undefined;
        if (!sofar || !readRunning(sofar.state) || sofar.entries.length === 0) return '';
        const entries = sofar.entries.map(e => `<div class="read-sofar-entry">${parseTranscript(e).lines
            .map(l => `<div class="read-sofar-line">${segsHtml(l.segs)}</div>`).join('')}</div>`).join('');
        return `<section class="read-sofar" aria-live="polite"><h3 class="read-section-title">${esc(strings.read.soFar(sofar.entries.length))}</h3>${entries}</section>`;
    },

    readProgressFootHtml(): string {
        const s = st!;
        const t = strings.read;
        const live = this.readLiveOf(s.readId);
        // Readings started in the research (its agent, the terminal) are not cancelled from here.
        const cancel = s.readId && !s.sending && live?.from !== 'research'
            ? `<button type="button" class="read-cancel" data-act="cancel"${s.busy ? ' disabled' : ''}>${esc(t.cancel)}</button>` : '';
        return `${cancel}<span class="batch-foot-note"></span>
                <button type="button" class="primary" data-act="close">${esc(t.closeKeep)}</button>`;
    },

    /** The elapsed time and the "taking longer" line (every second while the progress shows). */
    tickReadProgress(): void {
        const showing = st?.phase === 'progress' && !!document.getElementById('read-progress-time');
        if (!showing) {
            if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
            return;
        }
        const paint = (): void => {
            const s = st;
            const time = document.getElementById('read-progress-time');
            if (!s || !time || s.phase !== 'progress') { this.tickReadProgress(); return; }
            const live = this.readLiveOf(s.readId);
            const since = Date.parse(live?.since ?? '') || s.startedAt;
            const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
            const readers = live?.readers || s.readers;
            const usual = this.readUsualNow(live, readers);
            const elapsed = strings.read.elapsed(Math.floor(secs / 60), secs % 60);
            // Past the time said, one reader done: the reading waits for the other one (which one the bridge does not say).
            const waits = usual !== null && secs > usual * 60 && readers >= 2 && live?.state === 'reading' && live.done === readers - 1;
            time.textContent = `${usual === null ? strings.read.runningOnly(elapsed) : strings.read.running(usual, elapsed)}${waits ? ` · ${strings.read.waitingOther}` : ''}`;
            const slow = document.getElementById('read-progress-slow');
            if (slow) slow.hidden = usual === null || secs < usual * 60 * 2;
            // A new expected time from /status shows at once, not only at the next state.
            const expect = document.getElementById('read-progress-expect');
            if (expect) expect.hidden = !this.readSlowNow(live);
        };
        paint();
        if (!tickTimer) tickTimer = setInterval(paint, 1000);
    },

    /** The dialog follows its reading: progress, then the result or what went wrong. */
    followReadInDialog(r: LiveRead): void {
        if (!st) return;
        st.readId = r.id;
        if (r.state === 'checking') st.sawChecking = true;
        // What was written stays on screen whatever the reading does next.
        if (st.phase === 'written') return;
        if (readRunning(r.state) && st.phase === 'propose') {
            // A second reader from the suggestion: its progress over the suggestion, the choices kept.
            st.second = true;
            this.redrawReadPropose();
            return;
        }
        if (st.phase === 'propose' && r.state !== 'done') {
            // The second reading ended without a result: the first one's suggestion stays.
            st.second = false;
            st.notice = r.state === 'cancelled' ? strings.read.againCancelled : strings.read.failed;
            this.renderReadDialog();
            return;
        }
        if (readRunning(r.state)) {
            st.phase = 'progress';
            this.renderReadDialog();
            // Entries read so far show under the progress (the bridge gives the result as it grows).
            const link = this.researchOriginalsLink();
            const have = results.get(r.id)?.entries.length ?? 0;
            if (link && r.entries > have) {
                void this.loadReadResult(link.researchId, r.id).then(res => {
                    if (res && st && st.readId === r.id && st.phase === 'progress' && res.entries.length > have) this.renderReadDialog();
                });
            }
            return;
        }
        if (r.state === 'done') { void this.openReadResult(r.id); return; }
        st.second = false;
        markOpened(r.id);
        st.phase = 'error';
        st.error = r.state === 'unreadable' ? { kind: 'unreadable' } : r.state === 'cancelled' ? { kind: 'cancelled' } : { kind: 'failed' };
        if (r.state === 'unreadable') {
            const link = this.researchOriginalsLink();
            if (link) {
                void this.loadReadResult(link.researchId, r.id).then(res => {
                    if (!st || st.readId !== r.id || st.error?.kind !== 'unreadable') return;
                    st.error.why = res?.doc.why ?? 'other';
                    this.renderReadDialog();
                });
            }
        }
        this.renderReadDialog();
        this.refreshReadSurfaces();
    },

    /** Fetch and show a reading's result (opened: off the menu and the strip). */
    async openReadResult(id: string): Promise<void> {
        const link = this.researchOriginalsLink();
        if (!link || !st) return;
        const res = await this.loadReadResult(link.researchId, id);
        if (!st || st.readId !== id) return;
        markOpened(id);
        const failure = lastFailure.get(id);
        if (!res && st.sourceId) {
            // The source's own transcription stands in for what the research cannot give.
            st.phase = 'error';
            const why: SourceWhy = failure?.kind === 'none' ? (this.activeResearchAgentless() ? 'archive' : 'none')
                : !this.researchBridgeUp(link.researchId) ? 'down' : 'other';
            st.error = { kind: 'source', why, ...(failure ? { failure } : {}) };
        } else if (!res) {
            st.phase = 'error';
            st.error = { kind: this.researchBridgeUp(link.researchId) ? 'failed' : 'down', ...(failure ? { failure } : {}) };
        } else if ((res.state === 'failed' || res.state === 'cancelled') && st.phase !== 'propose' && st.phase !== 'written') {
            st.phase = 'error';
            st.error = st.sourceId ? { kind: 'source', why: 'other' } : { kind: res.state };
        } else if (res.state === 'unreadable') {
            st.phase = 'error';
            st.error = { kind: 'unreadable', why: res.doc.why ?? 'other' };
        } else if (st.phase === 'propose' || st.phase === 'written') {
            // The suggestion (or what was written) stays; a new result of the same entry refreshes the suggestion.
            const before = st.result;
            const entryId = before?.entries[st.entry]?.id;
            const k = res.entries.findIndex(e => e.id === entryId);
            const fresh = st.second;
            st.second = false;
            if (st.phase === 'propose' && k >= 0) {
                st.result = res;
                st.entry = k;
                st.page = res.entries[k].page;
                // Readers that agree on the entry: nothing is highlighted, so the notice says they agree.
                if (fresh && !st.notice) st.notice = res.entries[k].variants.length ? strings.read.secondDone : strings.read.secondAgree;
                this.refreshReadPropose(before);
            }
        } else {
            st.result = res;
            st.phase = 'result';
            const refn = this.readLiveOf(id)?.person
                || (st.personId ? originalTargets({ personId: st.personId as PersonId }, DataManager.getData()).person ?? '' : '');
            const chosen = st.entryId ? res.entries.findIndex(e => e.id === st!.entryId) : -1;
            st.entry = chosen >= 0 ? chosen : defaultEntryIndex(res.entries, refn);
            st.line = -1;
            st.page = res.entries[st.entry]?.page ?? res.pages[0]?.n ?? 1;
        }
        this.renderReadDialog();
        this.refreshReadSurfaces();
        if (res?.source) this.refreshReadSourceViewer();
    },

    // ==================== THE RESULT ====================

    /** "Baptism entry, Latin, Kurrent, 1846": the document's kind, languages, script and year. */
    readResultTitle(res: ReadResult): string {
        const t = strings.read;
        if (res.source) return t.resultSource;
        const kind = t.kindTitles[res.doc.kind] ?? t.kindTitles.other;
        return [kind, langNames(res.doc.language), t.scripts[res.doc.script] ?? '', readDocYear(res.doc.date)].filter(Boolean).join(', ');
    },

    /** The result's subtitle (HTML): the file's name, then legibility and the readers as pills. */
    readResultSubtitle(res: ReadResult): string {
        const t = strings.read;
        const again = res.source ? this.readSourceAgainNow() : null;
        const name = again ? sourceAgainSub(again) : res.pages[0]?.name ?? '';
        const file = name
            ? `<span class="read-file" title="${esc(name)}">${esc(res.pages.length > 1 && !again ? t.progressSub(middleName(name, 40), res.pages.length) : middleName(name, 48))}</span>` : '';
        const legible = res.doc.legible === 'yes' ? { tone: 'is-ok', text: t.legible }
            : { tone: 'is-warn', text: res.doc.legible === 'partly' ? t.partly : t.notLegible };
        // A source read again: how it compares with the transcript, in place of how the readers agree.
        const agree = res.source
            ? res.source.agree === 'same' ? { tone: 'is-ok', text: t.srcSame } : { tone: 'is-warn', text: t.srcDiffer(Math.max(1, res.source.variants.length)) }
            : agreeTone(res);
        const choices = this.researchReadAcceptsAny()?.choices;
        const who = (res.readers.who ?? []).filter(w => w.ran);
        const whoRow = who.length
            ? `<div class="read-result-who">${whoLinesHtml(who.map(w => ({ label: whoLabel(w, choices), same: readWhoSame(who) })), res.source ? t.newRead : t.readBy, 'read-result-who-line')}</div>`
            : '';
        return `${file}<span class="read-pills"><span class="read-pill ${legible.tone}" data-pill="legible">${esc(legible.text)}</span>`
            + `<span class="read-pill ${agree.tone}" data-pill="${res.source ? 'source' : 'readers'}">${esc(agree.text)}</span></span>${whoRow}`;
    },

    /** The two readers of a result, for its places where they differ (null: the reading says no two readers). */
    readVariantWho(res: ReadResult): VariantWho | null {
        const who = (res.readers.who ?? []).filter(w => w.ran);
        if (who.length < 2) return null;
        const choices = this.researchReadAcceptsAny()?.choices;
        return { a: whoLabel(who[0], choices, false), b: whoLabel(who[1], choices, false) };
    },

    /**
     * The result's body: the scan (left) and the text of the chosen entry
     * (right). `base` is the bridge's address: a page's image is
     * `readPageImageUrl(base, page)`.
     */
    readResultHtml(res: ReadResult, base: string): string {
        const s = st!;
        const entry = res.entries[s.entry] ?? null;
        return `
                <div class="read-result" id="read-result" data-read="${esc(res.id)}" data-entry="${s.entry}">
                    <div class="read-scan" id="read-scan">${this.readScanHtml(res, base)}</div>
                    <div class="read-text" id="read-text">${this.readTextHtml(res, entry)}</div>
                </div>`;
    },

    /** The page shown on the scan (the chosen entry's, or the one picked by its tab). */
    readShownPage(res: ReadResult): ReadPage | null {
        const s = st!;
        return res.pages.find(p => p.n === s.page) ?? res.pages[0] ?? null;
    },

    /** The scan: the entries' pills, the pages' tabs, the page with the entries' frames, the hint. */
    readScanHtml(res: ReadResult, base: string): string {
        const s = st!;
        const t = strings.read;
        const entries = res.entries;
        const page = this.readShownPage(res);
        const pageN = page?.n ?? s.page;
        const pills = entries.length >= 2 && s.phase === 'result'
            ? `<div class="read-entries" role="group" aria-label="${esc(t.entriesLabel)}">${entries.map((e, k) => {
                const name = entryName(e);
                return `<button type="button" class="read-entry-pill${k === s.entry ? ' is-selected' : ''}" data-act="entry" data-entry="${k}"`
                    + ` aria-pressed="${k === s.entry}" aria-label="${esc(t.entrySr(k + 1, name))}"><span class="read-entry-n">${k + 1}</span>`
                    + `${name ? `<span class="read-entry-name">${esc(middleName(name, 28))}</span>` : ''}</button>`;
            }).join('')}</div>` : '';
        const names = readViewLabels(res.pages);
        const tabs = res.pages.length >= 2
            ? `<div class="read-page-tabs" role="group">${res.pages.map((p, i) =>
                `<button type="button" class="read-page-tab${p.n === pageN ? ' is-selected' : ''}" data-act="page" data-page="${p.n}" aria-pressed="${p.n === pageN}">${esc(names[i])}</button>`).join('')}</div>`
            : '';
        const shownName = names[res.pages.findIndex(p => p.n === pageN)] ?? t.pageAlt(pageN);
        const url = page && base ? readPageImageUrl(base, page) : '';
        const ratio = page && page.w > 0 && page.h > 0 ? `${page.w} / ${page.h}` : '3 / 4';
        const img = url
            ? `<img class="read-scan-img" src="${esc(url)}" alt="${esc(shownName)}" draggable="false">`
            : `<span class="read-scan-noimg">${esc(t.noImage)}</span>`;
        const variants = (entries[s.entry]?.variants.length ?? 0) > 0;
        const hint = s.phase === 'result' && (entries.length >= 2 || variants) ? `<p class="read-scan-hint">${esc(t.scanHint(variants))}</p>` : '';
        return `${pills}${tabs}
                    <div class="read-scan-box">
                        <div class="read-scan-view" id="read-scan-view">
                            <div class="read-scan-sheet" id="read-scan-sheet" style="aspect-ratio: ${ratio}">
                                ${img}
                                <div class="read-scan-marks" id="read-scan-marks">${this.readScanMarksHtml(res, page)}</div>
                            </div>
                        </div>
                        ${url ? `<button type="button" class="read-scan-open" data-act="open-page" aria-label="${esc(t.openPage)}" title="${esc(t.openPage)}"><span aria-hidden="true">⤢</span></button>` : ''}
                    </div>
                    ${hint}`;
    },

    /**
     * The part of the page this view read (its region, the rest dimmed), the frames of the entries on its
     * picture (the chosen one solid; an entry of another part of the same page too), the lines that differ
     * (amber), the shown line.
     */
    readScanMarksHtml(res: ReadResult, page: ReadPage | null): string {
        const s = st!;
        const t = strings.read;
        const many = res.entries.length >= 2;
        const view = page?.region ? `<span class="read-view-clip" aria-hidden="true"><span class="read-view-region" style="${regionStyle(page.region)}"></span></span>` : '';
        const frames = res.entries.map((e, k) => {
            if (!this.readEntryOnView(res, e, page) || !e.region) return '';
            const name = entryName(e);
            return `<button type="button" class="read-frame${k === s.entry ? ' is-selected' : ''}" data-entry="${k}" style="${regionStyle(e.region)}"`
                + ` aria-label="${esc(t.entrySr(k + 1, name))}" aria-pressed="${k === s.entry}">`
                + `${many ? `<span class="read-frame-n" aria-hidden="true">${k + 1}</span>` : ''}</button>`;
        }).join('');
        const entry = res.entries[s.entry];
        let lines = '';
        if (entry?.region && this.readEntryOnView(res, entry, page)) {
            const parsed = parseTranscript(entry);
            const n = parsed.lines.length;
            lines = parsed.lines.map((l, j) => l.variant
                ? `<span class="read-scan-var" data-line="${j}" style="${regionStyle(lineRegion(entry.region!, j, n))}"></span>` : '').join('');
        }
        return `${view}${frames}${lines}<span class="read-scan-line" id="read-scan-line" hidden></span>`;
    },

    /** Whether an entry stands on the picture a view shows (its own view, or another part of the same page). */
    readEntryOnView(res: ReadResult, e: ReadEntry, page: ReadPage | null): boolean {
        if (!page) return false;
        if (e.page === page.n) return true;
        const own = res.pages.find(p => p.n === e.page);
        return !!own && readSameSheet(own, page);
    },

    /** The text column: a partly legible note, then the sections the document's kind and its data give. */
    readTextHtml(res: ReadResult, entry: ReadEntry | null): string {
        const s = st!;
        const t = strings.read;
        const partial = res.doc.legible !== 'yes'
            ? `<div class="read-partial" role="note"><strong>${esc(t.partialLead)}</strong> ${esc(t.partialText(t.whyText[res.doc.why ?? 'other'] ?? t.whyText.other))}`
              + ` <button type="button" class="read-link" data-act="insert-other">${esc(t.betterPhoto)}</button></div>` : '';
        const note = res.source ? this.readSourceNoteHtml(res) : '';
        if (!entry) return `${note}${partial}<p class="read-empty">${esc(t.noEntries)}</p>`;
        const sec = resultSections(res, entry, getCurrentLanguage());
        const parts: string[] = [note, partial];
        if (sec.transcript) {
            const parsed = parseTranscript(entry);
            const focusable = entry.region ? ' tabindex="0"' : '';
            const vwho = this.readVariantWho(res);
            const lines = parsed.lines.map((l, j) =>
                `<div class="read-line${l.variant ? ' has-variant' : ''}${j === s.line ? ' is-active' : ''}" data-line="${j}"${focusable}>${segsHtml(l.segs, vwho)}</div>`).join('');
            const legend: string[] = [];
            if (parsed.marks.uncertain) legend.push(`<li><span class="read-key read-key--uncertain" aria-hidden="true">a</span>${esc(t.uncertain)}</li>`);
            legend.push(this.readPlacesLegendHtml(entry, parsed.lines.map(l => l.text), vwho));
            if (parsed.marks.illegible) legend.push(`<li><span class="read-key read-key--illegible" aria-hidden="true"></span>${esc(t.illegibleNote)}</li>`);
            const langs = langNames(res.doc.language);
            parts.push(`
                <section class="read-section read-section--transcript" aria-labelledby="read-s-transcript">
                    <div class="read-section-head">
                        <h3 class="read-section-title" id="read-s-transcript">${esc(sec.inscription ? t.sInscription : t.sTranscript)}</h3>
                        <span class="read-section-sub">${esc(t.transcriptSub(langs))}</span>
                        <button type="button" class="read-copy" data-act="copy">${esc(t.copy)}</button>
                    </div>
                    <div class="read-transcript" id="read-transcript">${lines}</div>
                    ${legend.join('') ? `<ul class="read-legend">${legend.join('')}</ul>` : ''}
                </section>`);
        }
        if (sec.translation) {
            parts.push(`
                <section class="read-section read-section--translation" aria-labelledby="read-s-translation">
                    <div class="read-section-head"><h3 class="read-section-title" id="read-s-translation">${esc(t.sTranslation)}</h3></div>
                    <div class="read-translation">${parseBlock(entry.translation).map(l => `<p>${segsHtml(l)}</p>`).join('')}</div>
                </section>`);
        }
        if (sec.gloss) {
            const flavor = glossFlavor(res.doc.kind);
            const n = entry.glossary.length;
            const sub = flavor === 'terms' ? (n ? t.glossTerms(n) : '') : flavor === 'symbols' ? t.glossSymbols : flavor === 'context' ? t.glossContext : '';
            const open = glossOpen();
            const items = entry.glossary.map(g => `<dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}`
                + `${g.kind !== 'term' ? ` <span class="read-gloss-kind">${esc(t.glossKinds[g.kind] ?? g.kind)}</span>` : ''}</dd>`).join('');
            parts.push(`
                <section class="read-section read-section--gloss${open ? ' is-open' : ''}">
                    <div class="read-section-head">
                        <h3 class="read-section-title"><button type="button" class="read-gloss-toggle" data-act="gloss" aria-expanded="${open}" aria-controls="read-gloss-body">`
                            + `<span class="read-chev" aria-hidden="true"></span>${esc(t.sGloss)}</button></h3>
                        ${sub ? `<span class="read-section-sub">${esc(sub)}</span>` : ''}
                    </div>
                    <div class="read-gloss-body" id="read-gloss-body"${open ? '' : ' hidden'}>
                        ${items ? `<dl class="read-gloss">${items}</dl>` : ''}
                        ${sec.about ? `<h4 class="read-about-title">${esc(t.sAbout)}</h4><p class="read-about">${esc(res.context)}</p>` : ''}
                    </div>
                </section>`);
        }
        if (sec.mentioned) {
            const people = entry.persons.map(p => {
                const name = [p.given, p.surname].filter(Boolean).join(' ') || p.written;
                const role = p.role === 'mentioned' ? '' : p.roleText || t.roles[p.role] || '';
                const meta = [role, p.age, p.occupation, p.residence].filter(Boolean).join(' · ');
                return `<li><span class="read-person-name">${esc(name)}</span>${meta ? ` <span class="read-person-meta">${esc(meta)}</span>` : ''}</li>`;
            }).join('');
            parts.push(`
                <section class="read-section read-section--mentioned" aria-labelledby="read-s-mentioned">
                    <div class="read-section-head"><h3 class="read-section-title" id="read-s-mentioned">${esc(t.sMentioned)}</h3></div>
                    <ul class="read-mentioned">${people}</ul>
                </section>`);
        }
        return parts.join('');
    },

    /**
     * The places the readers differ in (spec 059 K6.5), under the transcription: the count and the readers
     * once, then one row per place with the words around it in its line (every placed one is marked in the
     * text), those without a place in the text, then those only in the data. '' without any.
     */
    readPlacesLegendHtml(entry: ReadEntry, lines: readonly string[], vwho: VariantWho | null): string {
        const t = strings.read;
        const places = readerPlaces(entry);
        const count = places.text.length + places.data.length;
        if (!count) return '';
        const mk = (n: 1 | 2): string => `<span class="read-variant-mk" data-mk="${n}" aria-hidden="true"></span>`;
        const marks = vwho ? ['1', '2'] as const : null;
        const title = (a: string, b: string): string => vwho
            ? `${variantWhoLine(1, vwho.a, titleMarks(a))}\n${variantWhoLine(2, vwho.b, titleMarks(b))}`
            : t.variantNote(titleMarks(a), titleMarks(b));
        const head = `<li class="read-legend-differ"><span class="read-key read-key--variant" aria-hidden="true">/</span>`
            + `<span class="read-legend-differ-text">${esc(t.differAt(count))}${vwho ? `: ${mk(1)}\u00a0${esc(vwho.a)}, ${mk(2)}\u00a0${esc(vwho.b)}` : ''}</span></li>`;
        const rows: { html: string; cls: string; sub?: string }[] = places.text.map(p => {
            const ctx = p.span && lines[p.line] !== undefined ? placeContext(lines[p.line], p.span[0], p.span[1]) : null;
            return { cls: 'read-legend-place', html: placeRowHtml(ctx, placeVariantHtml(p.v.at, p.v.other, marks, '/', title(p.v.at, p.v.other))) };
        });
        for (const p of places.data) {
            const role = p.v.field?.endsWith('.role');
            const a = role && p.v.at ? t.roles[p.v.at] ?? p.v.at : p.v.at;
            const b = role && p.v.other ? t.roles[p.v.other] ?? p.v.other : p.v.other;
            rows.push({
                cls: 'read-legend-place read-legend-place--data', sub: t.placesData,
                html: placeRowHtml(null, placeVariantHtml(a, b, marks, '/', title(a, b)), dataPlaceLabel(p.v.field ?? '', p.v.at, entry)),
            });
        }
        return head + placeRowsHtml(rows);
    },

    /**
     * A source read again: one sentence on what became of it (the transcript stays, the new reading beside
     * it, where they differ a task of the research decides), then the places it differs from the transcript
     * so far, each with the words around it, then how the two readers compare (spec 059 K6.5).
     */
    readSourceNoteHtml(res: ReadResult): string {
        const t = strings.read;
        const cmp = res.source!;
        const differ = cmp.agree === 'differ';
        const src = DataManager.getData().sources?.[this.readSourceAgainNow()?.id ?? ''];
        const confirmed = src ? !!this.sourceConfirmState(src).conf : false;
        const choices = this.researchReadAcceptsAny()?.choices;
        const who = (res.readers.who ?? []).filter(w => w.ran);
        const said = [t.srcStays(differ, cmp.task), confirmed ? t.keepConfirm : ''].filter(Boolean).join(' ');
        let vs = '';
        if (differ && cmp.variants.length) {
            // The words around each place: in the transcript so far, else (nothing there) around the new version in the new reading.
            const old = src?.transcript ?? '';
            const taken: [number, number][] = [];
            const chosen = res.entries[st?.entry ?? 0];
            const readTexts = [chosen, ...res.entries.filter(e => e !== chosen)].filter(Boolean).map(e => e!.transcript);
            const rows = cmp.variants.map(v => {
                let ctx: PlaceContext | null = null;
                const span = v.at && old ? locateSpan(old, v.at, taken) : null;
                if (span) {
                    taken.push(span);
                    ctx = placeContext(old, span[0], span[1]);
                } else if (!v.at && v.other) {
                    for (const text of readTexts) {
                        const sp = locateSpan(text, v.other);
                        if (sp) { ctx = placeContext(text, sp[0], sp[1]); break; }
                    }
                }
                const title = `${t.mkOld}: “${titleMarks(v.at)}”\n${t.mkNew}: “${titleMarks(v.other)}”`;
                return { cls: 'read-legend-place', html: placeRowHtml(ctx, placeVariantHtml(v.at, v.other, [t.mkOld, t.mkNew], '→', title)) };
            });
            vs = `
                    <div class="read-source-part read-source-vs">
                        <h4 class="read-source-head">${esc(t.srcVsTitle)}<span class="read-source-count"> · ${esc(t.placesN(rows.length))}</span></h4>
                        <p class="read-source-sides">${esc(t.srcSides(who.length ? whoLabel(who[0], choices, false) : ''))}</p>
                        <ul class="read-legend read-source-variants">${placeRowsHtml(rows)}</ul>
                    </div>`;
        }
        // Two readers ran: how they compare (their places are marked in the transcript and listed under it).
        const entry = res.entries[st?.entry ?? 0];
        const n = entry ? placeCount(entry) : 0;
        const readers = (res.readers.ran ?? 0) >= 2 ? `
                    <div class="read-source-part read-source-readers">
                        <h4 class="read-source-head">${esc(t.readersTitle)}</h4>
                        <p class="read-source-second">${esc(n ? t.readersDiffer(n) : t.readersAgree)}</p>
                    </div>` : '';
        return `
                <div class="read-source-note" role="note" data-agree="${cmp.agree}">
                    <p class="read-source-note-text">${esc(said)}</p>${vs}${readers}
                </div>`;
    },

    readResultFootHtml(): string {
        const t = strings.read;
        const res = st?.result;
        if (res?.source) {
            // A source read again: nothing to propose nor read anew here; a difference opens its task in the research.
            const task = res.source.agree === 'differ' && res.source.task && this.researchLinkAvailable('task') ? res.source.task : '';
            return `<span class="batch-foot-note read-kept">${esc(t.kept)}</span>
                <button type="button" class="${task ? 'secondary' : 'primary'}" data-act="close">${esc(t.close)}</button>
                ${task ? `<button type="button" class="primary" data-act="open-task" data-task="${esc(task)}">${researchActionLabel(t.openTask, researchLinkMark('task'))}</button>` : ''}`;
        }
        const propose = canPropose(res?.entries[st?.entry ?? 0]);
        const another = this.readDocumentReady()
            ? `<button type="button" class="secondary" data-act="another">${esc(t.another)}</button>` : '';
        return `<span class="batch-foot-note read-kept">${esc(t.kept)}</span>${another}
                <button type="button" class="${propose ? 'secondary' : 'primary'}" data-act="close">${esc(t.close)}</button>
                ${propose ? `<button type="button" class="primary" data-act="propose">${esc(t.propose)}</button>` : ''}`;
    },

    /** Choose an entry: the whole result (scan, text, suggestion) follows it. */
    readSelectEntry(i: number): void {
        const s = st;
        const res = s?.result;
        if (!s || !res || !res.entries[i] || i === s.entry || s.phase !== 'result') return;
        s.entry = i;
        s.line = -1;
        s.page = res.entries[i].page;
        this.readRedrawResult(true);
    },

    /** Show another page of the document on the scan. */
    readSelectPage(n: number): void {
        const s = st;
        if (!s?.result || n === s.page || !s.result.pages.some(p => p.n === n)) return;
        s.page = n;
        this.readRedrawResult(false);
    },

    /** Redraw the scan, the text and the footer (the header stays). */
    readRedrawResult(textToTop: boolean): void {
        const overlay = document.getElementById(DIALOG_ID);
        const s = st;
        if (!overlay || !s?.result || s.phase !== 'result') return;
        const link = this.researchOriginalsLink();
        const scan = overlay.querySelector<HTMLElement>('#read-scan');
        const text = overlay.querySelector<HTMLElement>('#read-text');
        const foot = overlay.querySelector<HTMLElement>('.read-footer');
        const keep = text?.scrollTop ?? 0;
        overlay.querySelector('#read-result')?.setAttribute('data-entry', String(s.entry));
        if (scan) scan.innerHTML = this.readScanHtml(s.result, link ? this.readBridgeBase(link.researchId) : '');
        if (text) {
            text.innerHTML = this.readTextHtml(s.result, s.result.entries[s.entry] ?? null);
            text.scrollTop = textToTop ? 0 : keep;
        }
        if (foot) foot.innerHTML = this.readResultFootHtml();
        this.wireReadResult(overlay);
    },

    /** The result's own wiring: lines ↔ scan, frames, the scan's layout. */
    wireReadResult(overlay: HTMLElement): void {
        const s = st;
        if (!s?.result) return;
        scanObserver?.disconnect();
        scanObserver = null;
        const view = overlay.querySelector<HTMLElement>('#read-scan-view');
        const sheet = overlay.querySelector<HTMLElement>('#read-scan-sheet');
        const img = sheet?.querySelector<HTMLImageElement>('img');
        img?.addEventListener('load', () => this.layoutReadScan());
        img?.addEventListener('error', () => {
            img.replaceWith(Object.assign(document.createElement('span'), { className: 'read-scan-noimg', textContent: strings.read.noImage }));
            overlay.querySelector('.read-scan-open')?.remove();
        });
        overlay.querySelectorAll<HTMLElement>('.read-line[data-line]').forEach(line => {
            const j = Number(line.dataset.line);
            line.addEventListener('mouseenter', () => this.showReadScanLine(j));
            line.addEventListener('mouseleave', () => this.showReadScanLine(st?.line ?? -1));
            line.addEventListener('focus', () => this.showReadScanLine(j));
            line.addEventListener('blur', () => this.showReadScanLine(st?.line ?? -1));
            line.addEventListener('click', () => this.readSelectLine(j === st?.line ? -1 : j, false));
            line.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                this.readSelectLine(j === st?.line ? -1 : j, false);
            });
        });
        overlay.querySelectorAll<HTMLElement>('.read-frame').forEach(frame => frame.addEventListener('click', (e) => {
            const k = Number(frame.dataset.entry);
            const cur = st;
            if (!cur?.result) return;
            if (k !== cur.entry) { this.readSelectEntry(k); return; }
            const entry = cur.result.entries[k];
            if (!entry?.region || !sheet || e.detail === 0) return;
            const rect = sheet.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const n = parseTranscript(entry).lines.length;
            const j = lineAt(entry.region, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, n);
            if (j >= 0) this.readSelectLine(j, true);
        }));
        if (view && typeof ResizeObserver !== 'undefined') {
            scanObserver = new ResizeObserver(() => this.layoutReadScan());
            scanObserver.observe(view);
        }
        this.layoutReadScan();
        this.showReadScanLine(s.line);
        this.readScrollScanToEntry();
    },

    /** A transcription line chosen (on the text or the scan): marked in both; -1 clears it. */
    readSelectLine(j: number, fromScan: boolean): void {
        const s = st;
        if (!s) return;
        s.line = j;
        const lines = document.querySelectorAll<HTMLElement>(`#${DIALOG_ID} .read-line[data-line]`);
        lines.forEach(l => l.classList.toggle('is-active', Number(l.dataset.line) === j));
        this.showReadScanLine(j);
        if (fromScan && j >= 0) {
            const line = document.querySelector<HTMLElement>(`#${DIALOG_ID} .read-line[data-line="${j}"]`);
            line?.scrollIntoView({ block: 'nearest' });
        }
    },

    /** The highlight of line `j` of the chosen entry on the scan (its region split evenly); -1 hides it. */
    showReadScanLine(j: number): void {
        const el = document.getElementById('read-scan-line');
        const s = st;
        if (!el || !s?.result) return;
        const entry = s.result.entries[s.entry];
        const page = this.readShownPage(s.result);
        if (j < 0 || !entry?.region || (page && !this.readEntryOnView(s.result, entry, page))) { el.hidden = true; return; }
        const parsed = parseTranscript(entry);
        el.hidden = false;
        el.setAttribute('style', regionStyle(lineRegion(entry.region, j, parsed.lines.length)));
        el.classList.toggle('is-variant', !!parsed.lines[j]?.variant);
    },

    /** Lay the page out: whole and scrollable beside the text, or the chosen entry's crop in the narrow strip. */
    layoutReadScan(): void {
        const s = st;
        const view = document.getElementById('read-scan-view');
        const sheet = document.getElementById('read-scan-sheet');
        if (!s?.result || !view || !sheet) return;
        const page = this.readShownPage(s.result);
        const img = sheet.querySelector('img');
        let ratio = page && page.w > 0 && page.h > 0 ? page.w / page.h : 0;
        if (!ratio && img && img.naturalWidth > 0 && img.naturalHeight > 0) {
            ratio = img.naturalWidth / img.naturalHeight;
            sheet.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        }
        const strip = window.matchMedia(STRIP_QUERY).matches;
        view.classList.toggle('is-strip', strip);
        if (!strip) {
            sheet.style.width = sheet.style.height = sheet.style.left = sheet.style.top = '';
            return;
        }
        const entry = s.result.entries[s.entry];
        // The chosen entry's crop on its own view; on another part of the page that part (it is what that view read).
        const region = (entry && entry.page === page?.n ? entry.region : null)
            ?? page?.region ?? (entry && this.readEntryOnView(s.result, entry, page) ? entry.region : null);
        const c = cropLayout(region, view.clientWidth, view.clientHeight, ratio || 0.75);
        sheet.style.width = `${c.width}px`;
        sheet.style.height = `${c.height}px`;
        sheet.style.left = `${c.left}px`;
        sheet.style.top = `${c.top}px`;
    },

    /** Beside the text: scroll the page so the chosen entry's frame shows (on another part of its page: that part). */
    readScrollScanToEntry(): void {
        const view = document.getElementById('read-scan-view');
        const res = st?.result;
        const page = res ? this.readShownPage(res) : null;
        const entry = res?.entries[st!.entry];
        const part = entry && page && entry.page !== page.n ? view?.querySelector<HTMLElement>('.read-view-region') : null;
        const frame = part ?? view?.querySelector<HTMLElement>('.read-frame.is-selected');
        if (!view || !frame || view.classList.contains('is-strip')) return;
        const v = view.getBoundingClientRect();
        const f = frame.getBoundingClientRect();
        if (f.top >= v.top && f.bottom <= v.bottom) return;
        view.scrollTop += f.top - v.top - 24;
    },

    /** "Copy transcription": the chosen entry's text with its original marks (`[?]`, `[...]`). */
    async copyReadTranscript(): Promise<void> {
        const entry = st?.result?.entries[st.entry];
        if (!entry) return;
        try {
            await navigator.clipboard.writeText(entry.transcript);
            this.showToast(strings.read.copied);
        } catch {
            this.showToast(strings.read.copyFailed);
        }
    },

    /** The source's own transcription (when its reading cannot be shown). */
    async copySourceTranscript(): Promise<void> {
        const text = st ? DataManager.getData().sources?.[st.sourceId]?.transcript ?? '' : '';
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            this.showToast(strings.read.copied);
        } catch {
            this.showToast(strings.read.copyFailed);
        }
    },

    /** Fold or unfold the explanation (remembered). */
    toggleReadGloss(btn: HTMLElement): void {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        const body = document.getElementById('read-gloss-body');
        if (body) body.hidden = !open;
        btn.closest('.read-section')?.classList.toggle('is-open', open);
        try { localStorage.setItem(GLOSS_KEY, open ? '1' : '0'); } catch { /* storage off */ }
    },

    /** The whole page in the image viewer (⤢). */
    openReadPage(): void {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s?.result || !link) return;
        const page = this.readShownPage(s.result);
        const base = this.readBridgeBase(link.researchId);
        if (page && base && page.image) openImageViewer(readPageImageUrl(base, page));
    },

    /**
     * "Suggest for the tree…": the step that builds the suggestion from the
     * chosen entry (`readDocumentSelection()`). The step itself comes with the
     * suggestion's own view; until then the button only exists.
     */
    readDocumentPropose(): void {
        const sel = this.readDocumentSelection();
        if (!sel || !canPropose(sel.entry) || !st) return;
        this.openReadPropose();
    },

    /** The dialog's result now: the reading, its result and the bridge's address (for the result's own view). */
    readDocumentCurrent(): { readId: string; result: ReadResult; base: string; researchId: string } | null {
        const link = this.researchOriginalsLink();
        if (!st?.result || !link) return null;
        return { readId: st.readId, result: st.result, base: this.readBridgeBase(link.researchId), researchId: link.researchId };
    },

    /**
     * The chosen entry with what a suggestion needs: its page and that page's
     * image URL ('' = none). A person's or an event's crop is
     * `readCropHtml(sel.imageUrl, sel.page, region, w, h)`.
     */
    readDocumentSelection(): {
        readId: string; result: ReadResult; base: string; researchId: string;
        entryIndex: number; entry: ReadEntry; page: ReadPage | null; imageUrl: string;
    } | null {
        const cur = this.readDocumentCurrent();
        const s = st;
        const entry = cur && s ? cur.result.entries[s.entry] : undefined;
        if (!cur || !s || !entry) return null;
        const page = cur.result.pages.find(p => p.n === entry.page) ?? null;
        return { ...cur, entryIndex: s.entry, entry, page, imageUrl: page && cur.base ? readPageImageUrl(cur.base, page) : '' };
    },

    // ==================== ERRORS ====================

    readErrorHtml(): string {
        const err = st!.error ?? { kind: 'failed' as ErrorKind };
        if (err.kind === 'source') return this.readSourceBlockHtml();
        const { title, text } = this.readErrorWords();
        return `
                <div class="read-error" data-error="${err.kind}" role="alert">
                    <h3 class="read-error-title">${esc(title)}</h3>
                    ${text ? `<p class="read-error-text">${esc(text)}</p>` : ''}
                </div>`;
    },

    /** A source's reading that cannot be shown: why, then the transcription the source carries (with its marks). */
    readSourceBlockHtml(): string {
        const s = st!;
        const t = strings.read;
        const why = s.error?.why ?? 'other';
        const transcript = DataManager.getData().sources?.[s.sourceId]?.transcript?.trim() ?? '';
        const lines = transcript
            ? parseBlock(transcript).map(segs => `<div class="read-source-line">${segsHtml(segs) || '&nbsp;'}</div>`).join('')
            : `<p class="read-source-none">${esc(t.sourceNoTranscript)}</p>`;
        return `
                <div class="read-error read-source-block" data-error="source" data-why="${esc(why)}" role="alert">
                    <h3 class="read-error-title">${esc(t.sourceBlockTitle)}</h3>
                    <p class="read-error-text">${esc(t.sourceWhy[why] ?? t.sourceWhy.other)}</p>
                </div>
                <section class="read-source-transcript" aria-labelledby="read-source-title">
                    <h3 class="read-section-title" id="read-source-title">${esc(t.sourceTranscript)}</h3>
                    <div class="read-source-lines">${lines}</div>
                </section>`;
    },

    /** The error state's title and explanation. */
    readErrorWords(): { title: string; text: string } {
        const s = st!;
        const t = strings.read;
        const err = s.error ?? { kind: 'failed' as ErrorKind };
        const accepts = this.researchReadAcceptsAny();
        let title = '';
        let text = '';
        switch (err.kind) {
            case 'down': title = t.notRunning; text = t.notRunningSub; break;
            case 'not-ready': {
                const why = err.failure?.why ?? accepts?.why ?? 'other';
                title = t.notReady(whyReason({ ...(accepts ?? { ready: false, readers: 1, types: [], max: 0, pages: 0, langs: [] }), why, resets: err.failure?.resets ?? accepts?.resets ?? '' }));
                break;
            }
            case 'older': title = t.older; break;
            case 'failed': title = t.failed; text = t.failedWhy[err.failure?.kind ?? ''] ?? ''; break;
            case 'cancelled': title = t.cancelled; break;
            // Held by the research (sealed elsewhere, files not downloaded, a full disk): its own sentence (017 U7).
            case 'held': {
                const held = err.failure?.held ?? { kind: 'seal' as const, said: '' };
                const words = this.researchWriteHeldText(held, false);
                title = words.title;
                text = held.said || words.sub;
                break;
            }
            case 'busy': title = t.busy; break;
            case 'limit': {
                title = t.limit(err.failure?.per ?? 'queue');
                const at = err.failure?.resets ? new Date(err.failure.resets)
                    : err.failure?.retryAfterMs ? new Date(Date.now() + err.failure.retryAfterMs) : null;
                if (at && Number.isFinite(at.getTime())) text = t.limitAt(at.toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' }));
                break;
            }
            case 'unreadable': {
                const why = err.why ?? 'other';
                title = t.unreadable(t.whyText[why] ?? t.whyText.other);
                text = t.advice[why] ?? t.advice.other;
                break;
            }
            // A source the research cannot read again (no original here, no transcript, not known there).
            case 'source-again': title = t.srcCannot; text = t.srcWhy[err.failure?.kind ?? ''] ?? ''; break;
        }
        return { title, text };
    },

    readErrorFootHtml(): string {
        const s = st!;
        const t = strings.read;
        const kind = s.error?.kind ?? 'failed';
        // Opening or updating the research carries the mark of its link (the update's help dialog: none).
        const marks: Record<string, ResearchActionMark> = {
            'open-research': researchLinkMark('open'),
            'update-research': this.researchLinkAvailable('update') ? researchLinkMark('update') : 'none',
            seal: researchLinkMark('seal'),
        };
        const btn = (act: string, label: string, primary = false): string =>
            `<button type="button" class="${primary ? 'primary' : 'secondary'}" data-act="${act}">${researchActionLabel(label, marks[act] ?? 'none')}</button>`;
        const close = btn('close', t.close, kind === 'limit' || kind === 'cancelled' || kind === 'source-again');
        // A reading started in the research is not read again from here.
        const own = this.readLiveOf(s.readId)?.from !== 'research';
        switch (kind) {
            case 'source': {
                const hasText = !!DataManager.getData().sources?.[s.sourceId]?.transcript?.trim();
                const open = s.error?.why === 'down' && !!this.researchOriginalsLink();
                const update = s.error?.why === 'older';
                return `<span class="batch-foot-note"></span>${hasText ? btn('copy-source', t.copy) : ''}`
                    + btn('close', t.close, !open && !update) + (open ? btn('open-research', t.openResearch, true) : '')
                    + (update ? btn('update-research', t.updateResearch, true) : '');
            }
            case 'down':
                return `<span class="batch-foot-note"></span>${this.batchAvailable() && s.pages.length ? btn('as-material', t.addMaterials) : ''}`
                    + btn('close', t.close) + btn('open-research', t.openResearch, true);
            case 'not-ready': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('open-research', t.openResearch, true)}`;
            case 'older': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('update-research', t.updateResearch, true)}`;
            case 'failed': return `<span class="batch-foot-note"></span>${own ? `${btn('close', t.close)}${btn('retry', t.retry, true)}` : btn('close', t.close, true)}`;
            case 'cancelled': return `<span class="batch-foot-note"></span>${s.readId && own ? `<button type="button" class="secondary" data-act="again">${researchBridgeAgentLabel(t.readAgain)}</button>` : ''}${close}`;
            case 'busy': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('show-running', t.showRunning, true)}`;
            case 'held': {
                const seal = this.researchSealAction(s.error?.failure?.held)[0];
                return `<span class="batch-foot-note"></span>${btn('close', t.close, !seal)}${seal ? btn('seal', seal.label, true) : ''}`;
            }
            case 'unreadable': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('insert-other', t.insertOther, true)}`;
            default: return `<span class="batch-foot-note"></span>${close}`;
        }
    },

    // ==================== WIRING ====================

    wireReadDialog(overlay: HTMLElement): void {
        const s = st;
        if (!s) return;
        // One delegated listener for every action (the overlay stays, its content is redrawn).
        if (!overlay.dataset.wired) {
            overlay.dataset.wired = '1';
            overlay.addEventListener('click', (e) => {
                const el = (e.target as Element | null)?.closest<HTMLElement>('[data-act]');
                if (!el || !overlay.contains(el) || (el as HTMLButtonElement).disabled) return;
                this.readDialogAct(el, overlay);
            });
            // A reader's agent, model or effort (spec 059).
            overlay.addEventListener('change', (e) => {
                const sel = (e.target as Element | null)?.closest<HTMLSelectElement>('select.read-refine-select');
                const field = sel?.dataset.field;
                if (!sel || (field !== 'agent' && field !== 'model' && field !== 'effort')) return;
                this.readSetReader(Number(sel.dataset.at), field, sel.value);
            });
        }
        const input = overlay.querySelector<HTMLInputElement>('#read-input');
        input?.addEventListener('change', () => {
            this.readReadFields(overlay);
            const files = Array.from(input.files ?? []);
            input.value = '';
            if (files.length) this.addReadFiles(files);
        });
        // Files dropped on the dialog (the window's own drop is off while a dialog is open).
        const content = overlay.querySelector<HTMLElement>('.read-content');
        const drop = overlay.querySelector<HTMLElement>('#read-drop');
        const hasFiles = (e: DragEvent): boolean => Array.prototype.indexOf.call(e.dataTransfer?.types ?? [], 'Files') >= 0;
        if (content && s.phase === 'input') {
            content.addEventListener('dragover', (e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                drop?.classList.add('is-over');
            });
            content.addEventListener('dragleave', (e) => {
                if (!content.contains(e.relatedTarget as Node | null)) drop?.classList.remove('is-over');
            });
            content.addEventListener('drop', (e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                drop?.classList.remove('is-over');
                this.readReadFields(overlay);
                const files = Array.from(e.dataTransfer?.files ?? []);
                if (files.length) this.addReadFiles(files);
            });
        }
        // The pages' order: dragging a row, or Alt+↑/↓ on it.
        let dragged = 0;
        overlay.querySelectorAll<HTMLElement>('.read-page[draggable="true"]').forEach(row => {
            const key = Number(row.dataset.key);
            row.addEventListener('dragstart', (e) => {
                dragged = key;
                row.classList.add('is-dragging');
                e.dataTransfer?.setData('text/plain', String(key));
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            });
            row.addEventListener('dragend', () => { dragged = 0; row.classList.remove('is-dragging'); });
            row.addEventListener('dragover', (e) => {
                if (!dragged || hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
            });
            row.addEventListener('drop', (e) => {
                if (!dragged || hasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                this.readReadFields(overlay);
                this.placeReadPage(dragged, key);
            });
            row.addEventListener('keydown', (e) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.target !== row) return;
                e.preventDefault();
                this.readReadFields(overlay);
                this.moveReadPage(key, e.key === 'ArrowUp' ? -1 : 1);
                document.querySelector<HTMLElement>(`#${DIALOG_ID} .read-page[data-key="${key}"]`)?.focus();
            });
        });
        overlay.querySelectorAll<HTMLInputElement>('input[name="read-readers"]').forEach(radio => radio.addEventListener('change', () => {
            this.readReadFields(overlay);
            s.readers = radio.value === '2' ? 2 : 1;
            overlay.querySelectorAll('.read-reader').forEach(card => card.classList.toggle('is-checked', !!card.querySelector('input:checked')));
            // Reader 1 stays as chosen, reader 2 starts as by default.
            const choices = this.readChoicesNow();
            if (choices && s.with) s.with[1] = readerDefault(choices, 1);
            if (overlay.querySelector('#read-choose') && choices) this.readRedrawChoose();
            else {
                const foot = overlay.querySelector('.read-footer');
                if (foot) foot.innerHTML = this.readInputFootHtml();
            }
        }));
        const pickerHost = overlay.querySelector<HTMLElement>('#read-person-picker');
        if (pickerHost && s.phase === 'input') {
            try {
                const data = DataManager.getData();
                s.picker = new PersonPicker({
                    containerId: 'read-person-picker',
                    onSelect: (id) => { s.personId = id; },
                    persons: Object.values(data.persons).filter(p => !p.isPlaceholder),
                    showBirthYear: true,
                });
                if (s.personId) s.picker.setValue(s.personId as PersonId);
                pickerHost.querySelector('input')?.setAttribute('aria-labelledby', 'read-person-label');
            } catch (err) {
                console.warn('Person picker unavailable', err);
            }
        }
        if (s.phase === 'result' || s.phase === 'propose') this.wireReadResult(overlay);
        if (s.phase === 'propose' || s.phase === 'written') this.wireReadPropose(overlay);
        if (s.phase === 'error' || s.phase === 'result' || s.phase === 'written') overlay.querySelector<HTMLElement>('.read-footer .primary')?.focus();
    },

    /** A click on an element with `data-act` in the dialog. */
    readDialogAct(el: HTMLElement, overlay: HTMLElement): void {
        const s = st;
        if (!s) return;
        this.readReadFields(overlay);
        const key = Number(el.dataset.key);
        switch (el.dataset.act) {
            case 'close': this.closeReadDocumentDialog(); break;
            case 'pick': overlay.querySelector<HTMLInputElement>('#read-input')?.click(); break;
            case 'remove': this.moveReadPage(key, 0); break;
            case 'up': this.moveReadPage(key, -1); break;
            case 'down': this.moveReadPage(key, 1); break;
            case 'read': void (st?.mode === 'again' ? this.readDocumentAgain() : st?.mode === 'source' ? this.submitReadSourceAgain() : this.submitReadDocument()); break;
            case 'open-task': {
                const url = el.dataset.task ? this.activeResearchLink('task', { task: el.dataset.task }) : null;
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'refine': if (st) { st.refineOpen = !st.refineOpen; this.readRedrawChoose(); } break;
            case 'reset-with': {
                const choices = this.readChoicesNow();
                if (st && choices) { st.with = [readerDefault(choices, 0), readerDefault(choices, 1)]; forgetWith(); this.readRedrawChoose(); }
                break;
            }
            case 'cancel': void this.cancelReadDocument(); break;
            case 'retry': void this.retryReadDocument(); break;
            case 'seal': this.researchSyncAction('sealTakeOver'); break;
            case 'again': this.readAgainInput(); break;
            case 'another': this.newReadInput(); break;
            case 'insert-other': this.newReadInput(true); break;
            case 'show-running': {
                const running = this.readRunningNow();
                if (running) { s.readId = running.id; this.followReadInDialog(running); }
                break;
            }
            case 'open-research': this.openResearchFromRead(); break;
            case 'update-research':
                if (this.researchLinkAvailable('update')) this.researchActionUpdate();
                else this.showResearchUpdateHelp();
                break;
            case 'as-material': {
                const files = s.pages.map(p => ({ file: p.file, path: p.file.name }));
                this.closeReadDocumentDialog();
                this.showBatchDialog({ files });
                break;
            }
            case 'entry': this.readSelectEntry(Number(el.dataset.entry)); break;
            case 'page': this.readSelectPage(Number(el.dataset.page)); break;
            case 'open-page': this.openReadPage(); break;
            case 'copy': void this.copyReadTranscript(); break;
            case 'copy-source': void this.copySourceTranscript(); break;
            case 'gloss': this.toggleReadGloss(el); break;
            case 'places-more': {
                // The rest of the places, unfolded in place (nothing redrawn).
                el.closest('ul')?.querySelectorAll<HTMLElement>('[data-more]').forEach(li => { li.hidden = false; li.removeAttribute('data-more'); });
                el.closest('li')?.remove();
                break;
            }
            case 'propose': this.readDocumentPropose(); break;
            default: this.readProposeAct(el); break;
        }
    },

    /** The person and the note as typed (kept across redraws). */
    readReadFields(overlay: HTMLElement): void {
        if (!st) return;
        const note = overlay.querySelector<HTMLTextAreaElement>('#read-note');
        if (note) st.note = note.value.slice(0, NOTE_MAX);
        const person = overlay.querySelector<HTMLInputElement>('#read-person-picker input');
        if (person && st.picker) st.personId = person.value.trim() ? st.picker.getValue() ?? '' : '';
    },

    /** Move a page up (-1) or down (+1) among the taken ones; 0 removes it. */
    moveReadPage(key: number, by: -1 | 0 | 1): void {
        if (!st) return;
        const i = st.pages.findIndex(p => p.key === key);
        if (i < 0) return;
        if (by === 0) {
            revoke(st.pages.splice(i, 1));
        } else {
            const refusals = this.readPageRefusals();
            let j = i + by;
            while (j >= 0 && j < st.pages.length && refusals[j]) j += by;
            if (j < 0 || j >= st.pages.length) return;
            const [page] = st.pages.splice(i, 1);
            st.pages.splice(j, 0, page);
        }
        this.renderReadDialog();
    },

    /** A page dragged onto another one takes its place. */
    placeReadPage(key: number, onto: number): void {
        if (!st || key === onto) return;
        const from = st.pages.findIndex(p => p.key === key);
        const to = st.pages.findIndex(p => p.key === onto);
        if (from < 0 || to < 0) return;
        const [page] = st.pages.splice(from, 1);
        st.pages.splice(to, 0, page);
        this.renderReadDialog();
    },

    /** "Read again": the readers chosen first when the research offers a choice (spec 059), else read again at once. */
    readAgainInput(): void {
        const s = st;
        if (!s?.readId) return;
        if (this.readSourceAgainNow()) { this.readSourceAgainInput(); return; }
        if (!this.readChoicesNow()) { void this.readDocumentAgain(); return; }
        s.mode = 'again';
        s.phase = 'input';
        s.error = null;
        s.notice = '';
        this.renderReadDialog();
    },

    /** A source read again, again: its input (it is started anew from the source, not from the reading). */
    readSourceAgainInput(): void {
        const s = st;
        if (!s || !this.readSourceAgainNow()) return;
        s.mode = 'source';
        s.phase = 'input';
        s.error = null;
        s.notice = '';
        s.result = null;
        s.readId = '';
        this.renderReadDialog();
    },

    /** "Read another" / "Insert another photo": the input again (the pages kept for another photo). */
    newReadInput(keepPages = false): void {
        if (!st) return;
        st.mode = 'document';
        if (!keepPages) { revoke(st.pages); st.pages = []; }
        st.phase = 'input';
        st.error = null;
        st.result = null;
        st.readId = '';
        st.notice = '';
        st.sending = null;
        st.sawChecking = false;
        st.entry = 0;
        st.line = -1;
        st.page = 1;
        this.renderReadDialog();
    },

    openResearchFromRead(): void {
        const link = this.researchOriginalsLink();
        if (this.researchLinkAvailable('open')) { this.researchActionOpen(); return; }
        const url = link ? researchSchemeUrl('open', { tree: link.researchId }, announcedResearchScheme()) : null;
        if (url) this.launchResearchLink(url);
    },

    // ==================== SENDING ====================

    /** "Read": every taken page (`PUT media/<sha>`), then `POST read`. Nothing else is asked. */
    async submitReadDocument(): Promise<void> {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s || s.busy || !link) return;
        const refusals = this.readPageRefusals();
        const pages = s.pages.filter((_, i) => !refusals[i]);
        if (pages.length === 0) return;
        const base = this.readBridgeBase(link.researchId);
        if (!base) { this.readFailed({ kind: 'down', code: '', status: 0, retryAfterMs: 0 }); return; }
        storeReaders(s.readers);
        const refn = s.personId ? originalTargets({ personId: s.personId as PersonId }, DataManager.getData()).person : undefined;
        s.busy = true;
        s.phase = 'progress';
        s.readId = '';
        s.notice = '';
        s.startedAt = Date.now();
        s.sending = { k: 1, n: pages.length };
        this.renderReadDialog();
        for (let i = 0; i < pages.length; i++) {
            if (st !== s) return;
            const p = pages[i];
            s.sending = { k: i + 1, n: pages.length };
            this.renderReadDialog();
            if (!p.sha) p.sha = await sha256OfBlob(p.file);
            const reply = await putReadPage(base, p.sha, p.file, { name: p.file.name, person: refn, mime: p.mime });
            if (st !== s) return;
            if (!reply.ok) {
                s.busy = false;
                s.sending = null;
                const f = reply.failure;
                // The research does not take this file: it stays in the list with the reason.
                if (f.kind === 'type' || f.kind === 'large') {
                    p.refused = f.kind === 'type' ? { kind: 'type', type: p.kind }
                        : { kind: 'size', mb: Math.ceil(p.file.size / 1024 / 1024 * 10) / 10, maxMb: f.most ?? Math.round((this.researchReadAcceptsAny()?.max ?? 0) / 1024 / 1024) };
                    s.phase = 'input';
                    this.renderReadDialog();
                    return;
                }
                this.readFailed(f);
                return;
            }
        }
        const reply = await startRead(base, {
            files: pages.map(p => p.sha), readers: s.readers, lang: getCurrentLanguage(), person: refn, note: s.note,
            with: this.readWithNow(),
        });
        if (st !== s) return;
        s.busy = false;
        s.sending = null;
        if (!reply.ok) {
            const f = reply.failure;
            if ((f.kind === 'type' || f.kind === 'large') && f.sha) {
                const p = s.pages.find(x => x.sha === f.sha);
                if (p) {
                    p.refused = f.kind === 'type' ? { kind: 'type', type: p.kind } : { kind: 'size', mb: Math.ceil(p.file.size / 1024 / 1024 * 10) / 10, maxMb: f.most ?? 0 };
                    s.phase = 'input';
                    this.renderReadDialog();
                    return;
                }
            }
            this.readFailed(f);
            return;
        }
        this.readStarted(link.researchId, reply.value.read, reply.value.state, pages.length, pages[0]?.file.name ?? '', pages.map(p => p.sha).join(','));
    },

    /** "Read" at a source: `POST sources/read` (its excerpt alone or the whole entry), then its progress. */
    async submitReadSourceAgain(): Promise<void> {
        const s = st;
        const link = this.researchOriginalsLink();
        const again = s?.srcAgain;
        if (!s || !again || s.busy || !link) return;
        const base = this.readBridgeBase(link.researchId);
        if (!base) { this.readFailed({ kind: 'down', code: '', status: 0, retryAfterMs: 0 }); return; }
        storeReaders(s.readers);
        s.busy = true;
        s.notice = '';
        this.renderReadDialog();
        const reply = await startSourceRead(base, {
            source: again.refn, ...(again.clip ? { clip: again.clip } : {}), readers: s.readers, lang: getCurrentLanguage(),
            with: this.readWithNow(),
        });
        if (st !== s) return;
        s.busy = false;
        if (!reply.ok) { this.readFailed(reply.failure); return; }
        s.result = null;
        this.readStarted(link.researchId, reply.value.read, reply.value.state, 1, again.title, `source:${again.refn}`, again.refn);
    },

    /**
     * `with` for the reading about to start (undefined: every reader as by default, nothing sent);
     * the choice is kept for the next dialog. Only a choice made in this dialog's input is sent.
     */
    readWithNow(): ReadWithItem[] | undefined {
        const s = st;
        const choices = this.readChoicesNow();
        if (!s || !choices || !s.with) { if (s) s.sentWith = null; return undefined; }
        storeWith(choices, s.with, s.readers);
        const w = readWith(choices, s.with, s.readers);
        s.sentWith = w ? s.with.slice(0, s.readers).map(r => ({ ...r })) : null;
        return w;
    },

    /** A reader's choice turned down (400 read.with, 409 read.agent): back to the input, the panel open, the reason at the reader. */
    readBackToInput(f: ReadFailure): void {
        const s = st;
        const choices = this.readChoicesNow();
        if (!s || !choices) return;
        const at = Math.max(0, Math.min(1, f.at ?? 0));
        if (f.kind === 'agent') {
            const agent = f.agent || this.readChosen(choices)[at]?.agent || '';
            if (agent) s.agentDown = { ...s.agentDown, [agent]: { why: f.why || 'other', resets: f.resets ?? '' } };
            s.notice = '';
        } else {
            this.readChosen(choices)[at] = readerDefault(choices, at);
            s.notice = strings.read.withGone(at + 1);
        }
        s.error = null;
        s.refineOpen = true;
        s.phase = 'input';
        this.renderReadDialog();
        // The research's offer may have changed: asked again.
        const link = this.researchOriginalsLink();
        if (link) void this.askResearchBridge(link.researchId, POLL_MS);
    },

    /** A reading started (or started again): remembered, followed. */
    readStarted(researchId: string, id: string, state: ReadState, pages: number, name: string, doc = '', source = ''): void {
        const s = st;
        rememberRead(id, researchId, doc);
        const now = new Date().toISOString();
        const reads = new Map(readsByResearch.get(researchId) ?? []);
        const prev = reads.get(id);
        reads.set(id, {
            id, state, version: (prev?.version ?? 0) + 1, at: now, since: now, files: pages, pages, readers: s?.readers ?? 1,
            done: 0, entries: 0, name: prev?.name ?? name, person: prev?.person ?? '', from: 'app',
            ...(this.researchReadAcceptsAny()?.expectSecs ? { expectSecs: this.researchReadAcceptsAny()!.expectSecs } : {}),
            ...(source || prev?.source ? { source: source || prev!.source } : {}),
        });
        readsByResearch.set(researchId, reads);
        results.delete(id);
        if (s) {
            s.readId = id;
            if (s.phase !== 'propose') s.phase = 'progress';
            s.startedAt = Date.now();
            s.sawChecking = false;
            this.renderReadDialog();
        }
        this.watchReads();
        this.refreshReadSurfaces();
        // The status soon after: the bridge's own state of it.
        void this.askResearchBridge(researchId, POLL_MS);
    },

    /** A refusal or no answer: its own state in the dialog (§7). */
    readFailed(f: ReadFailure): void {
        const s = st;
        if (!s) return;
        s.busy = false;
        s.sending = null;
        const kind: ErrorKind = f.kind === 'down' ? 'down'
            : f.kind === 'not-ready' ? 'not-ready'
            : f.kind === 'read-busy' ? 'busy'
            : f.kind === 'limit' ? 'limit'
            : f.kind === 'held' ? 'held'
            : f.kind === 'source-none' || f.kind === 'source-notext' || f.kind === 'source-noscan' ? 'source-again'
            : 'failed';
        if ((f.kind === 'with' || f.kind === 'agent') && s.phase !== 'propose' && this.readChoicesNow()) {
            this.readBackToInput(f);
            return;
        }
        // The source is read again already: that reading's progress.
        if (f.kind === 'source-running' && f.read) {
            this.readFollowSourceRunning(f.read);
            return;
        }
        // No original or no transcript in the research: the action goes away until the research's next file.
        if (f.kind === 'source-noscan' || f.kind === 'source-notext') {
            const refn = f.source || s.srcAgain?.refn;
            if (refn) this.holdReadSourceAgain(refn);
        }
        s.error = { kind, failure: f };
        if (s.phase === 'propose') {
            // A second reader refused: the suggestion of the first stays, the reason above it.
            const { title, text } = this.readErrorWords();
            s.error = null;
            s.second = false;
            s.notice = [title, text].filter(Boolean).join(' ');
            this.renderReadDialog();
            return;
        }
        s.phase = 'error';
        this.renderReadDialog();
    },

    /** "Cancel reading": at once, no question. A reading again cancelled: the previous result stands. */
    async cancelReadDocument(): Promise<void> {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s?.readId || !link || s.busy) return;
        const base = this.readBridgeBase(link.researchId);
        if (!base) return;
        s.busy = true;
        this.renderReadDialog();
        const reply = await cancelRead(base, s.readId);
        if (st !== s) return;
        s.busy = false;
        if (!reply.ok) { this.readFailed(reply.failure); return; }
        const id = s.readId;
        const reads = new Map(readsByResearch.get(link.researchId) ?? []);
        const prev = reads.get(id);
        if (prev) reads.set(id, { ...prev, state: reply.value.state, version: reply.value.version, since: new Date().toISOString() });
        readsByResearch.set(link.researchId, reads);
        markOpened(id);
        if (reply.value.state === 'done') {
            // A reading again cancelled: the previous version stands.
            results.delete(id);
            s.second = false;
            s.notice = strings.read.againCancelled;
            await this.openReadResult(id);
        } else if (reply.value.state === 'cancelled' || !reply.value.cancelled) {
            s.phase = 'error';
            s.error = { kind: reply.value.state === 'cancelled' ? 'cancelled' : 'failed' };
            this.renderReadDialog();
            if (!reply.value.cancelled && prev) this.followReadInDialog({ ...prev, state: reply.value.state });
        }
        this.refreshReadSurfaces();
    },

    /** 409 read.source.running: the dialog shows the reading of the source under way. */
    readFollowSourceRunning(id: string): void {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s) return;
        s.readId = id;
        s.error = null;
        s.result = null;
        s.phase = 'progress';
        s.startedAt = Date.now();
        s.sawChecking = false;
        const live = this.readLiveOf(id);
        if (live) this.followReadInDialog(live);
        else this.renderReadDialog();
        this.watchReads();
        if (link) void this.askResearchBridge(link.researchId, POLL_MS);
    },

    /** "Try again": the same reading again when there is one, else the pages sent anew (a source: from the source). */
    async retryReadDocument(): Promise<void> {
        if (!st) return;
        if (this.readSourceAgainNow()) {
            st.mode = 'source';
            st.phase = 'input';
            st.error = null;
            await this.submitReadSourceAgain();
            return;
        }
        if (st.readId) { await this.readDocumentAgain(); return; }
        st.phase = 'input';
        st.error = null;
        await this.submitReadDocument();
    },

    /** "Read again" (`POST read/<id>/again`). */
    async readDocumentAgain(): Promise<void> {
        const s = st;
        const link = this.researchOriginalsLink();
        if (!s?.readId || !link || s.busy) return;
        const base = this.readBridgeBase(link.researchId);
        if (!base) { this.readFailed({ kind: 'down', code: '', status: 0, retryAfterMs: 0 }); return; }
        s.busy = true;
        const reply = await readAgain(base, s.readId, s.readers, this.readWithNow());
        if (st !== s) return;
        s.busy = false;
        if (!reply.ok) { this.readFailed(reply.failure); return; }
        s.error = null;
        const prev = this.readLiveOf(s.readId);
        this.readStarted(link.researchId, reply.value.read, reply.value.state, prev?.pages ?? s.pages.length, prev?.name ?? '');
    },

    // ==================== A DROP ON THE TREE ====================

    /**
     * A drag over the window offers "Read now" beside "Add to materials": 1 to
     * `pages` files the research reads, reading possible now. Null: the usual drop.
     */
    readDropOffered(dt: DataTransfer | null): boolean {
        if (!dt || !this.readDocumentReady()) return false;
        const accepts = this.readDocumentAccepts();
        if (!accepts) return false;
        const items = Array.from(dt.items ?? []).filter(i => i.kind === 'file');
        if (items.length === 0 || items.length > accepts.pages) return false;
        // A HEIC may come without a type while dragged: only known types count.
        return items.every(i => !!i.type && accepts.types.includes(i.type.toLowerCase()));
    },
});

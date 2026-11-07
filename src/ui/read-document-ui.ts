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
import { sha256OfBlob, normalizeSha256 } from '../sha256.js';
import { safeHttpUrl } from '../validation.js';
import { originalTargets } from '../originals.js';
import { parseLiveBridge, researchSchemeUrl, researchLinkMark, LiveStatus, type ResearchActionMark } from '../research-link.js';
import { storedResearchBridge, announcedResearchScheme, researchLinksEnabled } from '../research-device.js';
import {
    ReadAccepts, LiveRead, ReadResult, ReadFailure, ReadFileRefusal, ReadState, ReadPage, ReadEntry, ReadRegion,
    readRunning, readSlow, readFileMime, readFileKind, readFileRefusals, readUsualMinutes, readDocYear, readPageImageUrl,
    readPaceSecs, readSameSheet, readViewNames, type ReadPaceReader,
    putReadPage, startRead, fetchReadResult, readAgain, cancelRead, sanitizeLiveRead, readEndsToAnnounce, readSuperseded, READ_FEATURE,
    startSourceRead, readSourceId, READ_SOURCE_ENTRY_FEATURE, READ_BLIND_TEXT_FEATURE, READ_KINDS_FEATURE, READ_VARIANT_KIND_FEATURE, type ReadBlindEntry,
    type ReadVariant,
    type ReadSourceFailCode,
    postReadTask,
} from '../research-read.js';
import { READ_SOURCE_TASK_FEATURE, readTaskChoiceFor, type ReadTaskHow } from '../research-read-task.js';
import { readTaskFootHtml, readTaskFootState, readTaskForPerson, readTaskMajorNote, type ReadTaskAct, type ReadTaskFootInput } from './read-task-view.js';
import { shownExcerpts } from '../research-images.js';
import { excerptImageUrl } from '../excerpts.js';
import {
    LineSeg, parseTranscript, parseBlock, parseMarks, lineRegion, lineAt, defaultEntryIndex, canPropose, resultSections, glossFlavor,
    entryName, placeCountAll, readerPlaces, cropLayout, stripLayout,
    sourceEntryIndex, parseBlindTranscript, transcriptLines, textVariant, mergeAdjacent, variantClass, illegibleCount, composeVerdict, verdictWhy,
    compareWithTranscript, readSourceSaysSure, type VerdictFacts, type VerdictSorted, type MergedVariant,
} from '../read-result.js';
import { resultPlaces, lineMarksHtml, checkHtml, placePopHtml, sortPlaces, sortedCounts, type ResultMarks, type ShownPlace } from './read-result-view.js';
import { gedcomTagEventType } from '../ged-parser.js';
import { formatBytesShort } from './originals-ui.js';
import { onComputer, bridgeFailure } from './research-ui.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';
import { helpMark } from './help-mark.js';
import {
    ReadChoiceModel, ReadChoices, ReaderChoice, ReadWho, ReadWithItem, readerDefault, readerWithAgent, readersFromStored, readersChanged, readerHeld, readWith,
    readWhoLabel, readWhoSame, readWhoOtherAgents,
} from '../read-choices.js';
// Each reader's state and which one failed (spec 059 P7 §9).
import { readerStates } from '../read-choices.js';
import { READ_READER_STATE_FEATURE, readFailureShown, readOneReaderFailed, type ReadReaderFailure } from '../research-read.js';
// The scan's place outline (spec 059 P7 §7).
import { READ_VARIANT_REGION_FEATURE } from '../research-read.js';

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
/** A phone upright: the result's scan is a strip over the text with the chosen entry's crop (spec 059 P7 §10). */
const STRIP_QUERY = '(max-width: 640px)';

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
type ErrorKind = 'down' | 'not-ready' | 'older' | 'failed' | 'cancelled' | 'busy' | 'limit' | 'unreadable' | 'source' | 'held' | 'source-again' | 'late';

/**
 * A start the bridge did not answer in time (`ReadFailure.late`): it may still take the reading (a busy
 * bridge takes it late), so the dialog waits for the reading to be listed and follows it, never back to
 * an empty input inviting a second reading. `before`: the readings listed when it was sent.
 */
interface LateStart {
    at: number;
    before: Set<string>;
    /** A source read again (S…). */
    source?: string;
    /** A reading read again: its id and version before. */
    again?: { id: string; version: number };
    /** Pages sent (a document), its document key. */
    pages: number;
    doc: string;
    /** A status came after the start was given up. */
    heard: boolean;
    /** No such reading listed long after: most likely not started (the dialog offers to try again). */
    gone: boolean;
}

/** How long after a start without an answer a reading still counts as possibly taken (tests shorten it with `__STROM_READ_LATE_WAIT_MS`). */
const LATE_WAIT_MS = 120_000;
function lateWaitMs(): number {
    const t = (globalThis as { __STROM_READ_LATE_WAIT_MS?: unknown }).__STROM_READ_LATE_WAIT_MS;
    return typeof t === 'number' && t > 0 ? t : LATE_WAIT_MS;
}

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
    /** `said`: the research's own sentence why a reading failed (`failure.text`, e.g. a model its agent refused). */
    error: { kind: ErrorKind; failure?: ReadFailure; why?: string; said?: string; rf?: ReadReaderFailure } | null;
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
    /** Whose transcription the result shows (spec 059 K6.6): reader 1, or the second reader's own text; a new result starts at 1. */
    reader: 1 | 2;
    /** A start without an answer in time: the reading it may have started (null: none). */
    late: LateStart | null;
    /** The place chosen in the result's text or its "To check" list ('' none, spec 059 P7). */
    focus?: string;
    /** A source read again that the research did not compare: the entry compared in the app and its differences (state only, nothing saved). */
    cmp?: { entry: number; variants: ReadVariant[] } | null;
    /** A source read again without its own entry said: the entry shown first (its comparison's). */
    srcEntry?: number;
    /** The phone's Scan tab shows (the whole scan instead of the text, spec 059 P7 §10). */
    scanTab?: boolean;
    /** The scan's column widened beside the text (desktop, spec 059 P7 §7). */
    zoom?: boolean;
    /** A source's neighbouring entries unfolded among the chips. */
    nbOpen?: boolean;
    /** The outline of the place chosen on the scan (its region, `read.variantRegion`; null none). */
    spot?: ReadRegion | null;
    /** A source read again (`read.sourceTask`): the choice made in the footer for reading `read`. */
    task?: { read: string; act: ReadTaskAct } | null;
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
/** The mark whose bubble is open (spec 059 P7 §5) and the hover bubble's pending close. */
let popFrom: HTMLElement | null = null;
let popHideTimer: ReturnType<typeof setTimeout> | null = null;
/** The panel's rows whose "How to update" is unfolded, and a failure's "Details" unfolded (both folded when the dialog opens). */
const howOpen = new Set<number>();
let detailsOpen = false;

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
    const m = a?.models.find(x => x.id === r.model);
    // The agent's own model (''): its words, with what it runs on now when the research says it.
    return readWhoLabel({ name: a?.name ?? r.agent, model: r.model, modelName: m ? modelText(m) : '', effort: r.effort },
        m && !m.id ? modelText(m) : strings.read.bySettings);
}

/** A model offered as a person reads it: its name ("Opus", "as the agent is set"), with what an alias runs on now ("Opus (now Opus 5.5)"). */
function modelText(m: ReadChoiceModel): string {
    const t = strings.read;
    const name = m.id ? m.name || m.id : t.bySettings;
    return m.nowName ? t.modelNow(name, m.nowName) : name;
}

/** An effort as a person reads it: its thoroughness ("higher"); a value the app has no word for stays as it is; '' as the program is set. */
function thoroughText(effort: string): string {
    const t = strings.read;
    return effort ? t.thorough[effort] ?? effort : t.bySettings;
}

/** An effort offered in the panel: its thoroughness with a short hint ("higher – default"). */
function thoroughOption(effort: string, byDefault: boolean): string {
    const t = strings.read;
    const hint = [byDefault ? t.thoroughDefault : '', t.thoroughHint[effort] ?? ''].filter(Boolean).join(', ');
    return hint ? `${thoroughText(effort)} – ${hint}` : thoroughText(effort);
}

/** Whose subscription a program draws on: Claude Code the Claude one, another program its own, or its credit. */
function agentBrand(a: { id: string; name: string }): { name: string; brand: string; credit: boolean } {
    if (a.id === 'claude') return { name: a.name, brand: 'Claude', credit: false };
    if (a.id === 'codex') return { name: a.name, brand: 'Codex', credit: true };
    return { name: a.name, brand: a.name, credit: true };
}

/** The command that updates Codex (shown as it is typed, never translated). */
const CODEX_UPDATE = 'npm install -g @openai/codex@latest';

/** Who read as one line; the model's label from the offer when the reading does not say it; `effort` off: without it. */
function whoLabel(w: ReadWho, choices: ReadChoices | null | undefined, effort = true): string {
    const modelName = w.modelName || choices?.agents.find(a => a.id === w.agent)?.models.find(m => m.id === w.model)?.name || '';
    return readWhoLabel({ ...w, modelName, effort: effort ? w.effort : '' }, strings.read.bySettings);
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

/** An entry as the result shows it (`readEntryView`). */
interface EntryView {
    shown: 1 | 2;
    marks: ResultMarks;
    /** Both readers read the entry (only then can they agree). */
    both: boolean;
    /** Two readers read, this entry only reader 1. */
    onlyR1: boolean;
    /** The changes against the existing transcript carry the research's kinds. */
    kinded: boolean;
}

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
 * `second`: the second reader's text, each difference its version (2) first, reader 1's (1) after it.
 */
function segsHtml(segs: readonly LineSeg[], who: VariantWho | null = null, second = false): string {
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
                const [na, nb]: [1 | 2, 1 | 2] = second ? [2, 1] : [1, 2];
                const title = who
                    ? `${variantWhoLine(na, na === 1 ? who.a : who.b, titleMarks(sg.at))}\n${variantWhoLine(nb, nb === 1 ? who.a : who.b, titleMarks(sg.other))}`
                    : second ? t.variantNote(titleMarks(sg.other), titleMarks(sg.at)) : t.variantNote(titleMarks(sg.at), titleMarks(sg.other));
                return `<span class="read-variant" title="${esc(title)}">`
                    + `<span class="read-variant-a">${segsHtml(sg.a)}</span>${mk(na)}<span class="read-variant-slash" aria-hidden="true">/</span>`
                    + `<span class="read-variant-b">${segsHtml(sg.b)}</span>${mk(nb)}</span>`;
            }
        }
    }).join('');
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
        const adopted = this.readCheckLate(researchId, reads, false);
        const shownId = st && document.getElementById(DIALOG_ID) ? st.readId : '';
        const shown = shownId ? reads.get(shownId) : undefined;
        if (shown) {
            const before = prev.get(shownId);
            if (!before || shownId === adopted || before.state !== shown.state || before.done !== shown.done || before.version !== shown.version || before.entries !== shown.entries) this.followReadInDialog(shown);
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
            srcAgain: opts.again ?? null, reader: 1, late: null,
        };
        howOpen.clear();
        detailsOpen = false;
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
        const refn = this.readLiveOf(st.readId)?.source ?? results.get(st.readId)?.source?.id ?? results.get(st.readId)?.sourceRead?.id ?? '';
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
                <div class="buttons batch-footer read-footer${wide || st.phase === 'written' ? ' read-footer--result' : ''}${st.phase === 'result' ? ' read-footer--read' : ''}">${foot}</div>
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
                    <legend>${esc(t.readers)}</legend>
                    ${([1, 2] as const).map(n => `
                    <label class="read-reader${s.readers === n ? ' is-checked' : ''}">
                        <input type="radio" name="read-readers" value="${n}"${s.readers === n ? ' checked' : ''}>
                        <span class="read-reader-text"><strong>${esc(n === 1 ? t.c1 : t.c2)}</strong><span>${esc(n === 1 ? t.c1Sub : t.c2Sub)}</span></span>
                    </label>`).join('')}
                    <p class="read-readers-why">${esc(t.readersWhy)}</p>
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
                        <p class="read-source-gloss"><strong>${esc(t.sourceLead)}</strong> ${esc(t.sourceRest)}</p>
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
        // Collapsed, nothing technical (spec 059 P7 §8): only what was changed, and the way back to the default.
        const state = changed
            ? `<span class="read-who-state"><span class="read-who-tag">${esc(t.changedKept)}</span><button type="button" class="research-sync-link read-reset" data-act="reset-with">${esc(t.reset)}</button></span>`
            : '';
        const toggle = `<button type="button" class="research-sync-link read-refine-toggle" data-act="refine" aria-expanded="${s.refineOpen}" aria-controls="read-refine-panel">${esc(t.refine)} <span aria-hidden="true">${s.refineOpen ? '▴' : '▾'}</span></button>`;
        if (!s.refineOpen) {
            // A reader that cannot start now says so even folded (the Read button is off for it).
            const held = chosen.map((r, at) => {
                const a = choices.agents.find(x => x.id === r.agent);
                if (!a || a.ready) return '';
                const who = chosen.length === 1 ? a.name : t.readerOf(at + 1, a.name);
                const why = a.why === 'auth' || a.why === 'limit' ? agentWhyText(a.why, a.resets) : '';
                return `<p class="read-who-held">${esc(why ? t.heldNow(who, why) : `${who} ${t.agentWhyOther}.`)}</p>`;
            }).join('');
            return `
                <div class="read-who">${toggle}${state}</div>
                ${held}`;
        }
        const rows = chosen.map((r, at) => this.readRefineRowHtml(choices, r, at, chosen.length)).join('');
        return `
                <div class="read-who read-who--open">${toggle}${state}</div>
                <div class="read-refine" id="read-refine-panel">
                    <div class="read-refine-cols" aria-hidden="true"><span></span><span>${esc(t.colProgram)}</span><span>${esc(t.colModel)}</span><span>${esc(t.colThorough)}</span></div>
                    ${rows}
                    ${this.readRefineFootHtml(choices, chosen)}
                </div>`;
    },

    /** Under the panel, once: what thoroughness does, and whose subscription each program used draws on. */
    readRefineFootHtml(choices: ReadChoices, chosen: readonly ReaderChoice[]): string {
        const t = strings.read;
        const used = [...new Set(chosen.map(r => r.agent))]
            .map(id => choices.agents.find(a => a.id === id))
            .filter((a): a is ReadChoices['agents'][number] => !!a);
        const thorough = used.some(a => a.efforts.length) ? `<p class="read-refine-foot-line">${esc(t.thoroughNote)}</p>` : '';
        const bill = used.length ? `<p class="read-refine-foot-line" data-note="bill">${esc(t.bill(used.map(a => agentBrand(a))))}</p>` : '';
        return thorough || bill ? `<div class="read-refine-foot">${thorough}${bill}</div>` : '';
    },

    /** One reader's row of the panel: its agent, model and effort, and a note under it. */
    readRefineRowHtml(choices: ReadChoices, r: ReaderChoice, at: number, n: number): string {
        const t = strings.read;
        const label = n === 1 ? t.rowOnly : t.readerN(at + 1);
        const a = choices.agents.find(x => x.id === r.agent);
        const select = (field: 'agent' | 'model' | 'effort', col: string, options: { value: string; text: string; disabled?: boolean }[], value: string): string => {
            const current = options.find(o => o.value === value)?.text ?? '';
            return `<select class="read-refine-select" data-at="${at}" data-field="${field}" aria-label="${esc(`${label} – ${col}`)}" title="${esc(current)}">${
                options.map(o => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}${o.disabled && o.value !== value ? ' disabled' : ''}>${esc(o.text)}</option>`).join('')}</select>`;
        };
        const agents = choices.agents.map(x => ({ value: x.id, text: x.ready ? x.name : `${x.name} – ${agentWhyText(x.why, x.resets)}`, disabled: !x.ready }));
        const models = (a?.models ?? []).map(m => ({ value: m.id, text: modelText(m) }));
        // On a phone each choice is a full-width field with its column's name inside, on the left (spec 059 §2).
        const field = (col: string, inner: string, none = false): string =>
            `<span class="read-refine-field${none ? ' read-refine-field--none' : ''}"><span class="read-refine-field-key" aria-hidden="true">${esc(col)}</span>${inner}</span>`;
        const effort = a?.efforts.length
            ? field(t.colThoroughShort, select('effort', t.colThorough, a.efforts.map(e => ({ value: e, text: thoroughOption(e, !!e && e === a.default.effort) })), r.effort))
            : field(t.colThoroughShort, `<span class="read-refine-noeffort">${esc(t.noThorough)}</span>`, true);
        let note = '';
        if (a && !a.ready) {
            const why = agentWhyText(a.why, a.resets);
            note = `<div class="read-refine-note is-down">${esc(a.why === 'limit' ? t.downRowLimit(a.name, why) : t.downRow(a.name, why))}</div>`;
        }
        if (a?.ready && a.catalogNewer && a.models.find(m => m.id === r.model)?.unsure) {
            // Codex's list is newer than the Codex installed here: this model may be unknown to it; how to update, folded.
            const open = howOpen.has(at);
            note += `<div class="read-refine-note is-unsure" data-note="catalog-newer">${esc(t.oldCodex)} `
                + `<button type="button" class="research-sync-link read-how-toggle" data-act="how-update" data-at="${at}" aria-expanded="${open}" aria-controls="read-how-${at}">${esc(t.howUpdate)} <span aria-hidden="true">${open ? '▴' : '▾'}</span></button>`
                + `<span class="read-how" id="read-how-${at}"${open ? '' : ' hidden'}><span>${esc(t.howUpdateText)}</span> <code class="read-how-cmd">${esc(CODEX_UPDATE)}</code></span></div>`;
        }
        return `
                    <div class="read-refine-row" data-at="${at}">
                        <span class="read-refine-label">${esc(label)}</span>
                        ${field(t.colProgram, select('agent', t.colProgram, agents, r.agent))}
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
        // A source read again: its comparison with the transcript is named as such.
        const again = live?.source || s.srcAgain ? this.readSourceAgainNow() : null;
        const running = state === 'reading' || state === 'checking';
        const title = s.sending ? t.sendingPage(s.sending.k, s.sending.n)
            : state === 'queued' ? t.waitTitle
                : state === 'checking' ? (again ? t.comparingSource : t.checking) : t.readingTitle;
        const done = state === 'checking' ? readers : Math.min(readers, live?.done ?? 0);
        // Each reader on its own row when the research says where each one is (`read.readerState`).
        const rows = running && readers >= 2 ? readerStates(live?.who, this.readFeatureOn(READ_READER_STATE_FEATURE))?.slice(0, readers) ?? null : null;
        // Waiting is said only once the research lists the reading as queued (not while it is not listed yet).
        const text = live?.state === 'queued' ? t.waitText
            : running && readers >= 2 && !rows && done > 0 && done < readers ? t.readersSoFar(done, readers) : '';
        // The share of readers done, never an empty bar.
        const bar = running && readers >= 2
            ? `<span class="batch-bar read-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${readers}" aria-valuenow="${done}" aria-label="${esc(t.readersDone(done, readers))}"><span style="width:${Math.max(6, Math.round(done / readers * 100))}%"></span></span>`
            : '';
        return `
                <div class="read-run" data-state="${state}">
                    <div class="read-run-head">
                        <h3 class="read-run-title">${esc(title)}</h3>
                        <span class="read-progress-time" id="read-progress-time"${running ? '' : ' hidden'}></span>
                    </div>
                    ${text ? `<p class="read-run-text">${esc(text)}</p>` : ''}
                    ${bar}
                    ${rows ? `<ul class="read-run-rows">${rows.map((w, at) => this.readRunRowHtml(w, at)).join('')}</ul>` : ''}
                    <p class="read-run-note" id="read-progress-note">${esc(t.closeShort)}</p>
                </div>
                ${this.readSoFarHtml()}`;
    },

    /**
     * One reader's row: a mark by its state (✓ in a full circle, a dashed circle, × in a square), "Reader 2 · Codex"
     * (the model too where it failed), and its state in words. `failCode`: the failure's code (a failed reading).
     */
    readRunRowHtml(w: ReadWho, at: number, failCode?: string): string {
        const t = strings.read;
        const state = w.state ?? 'reading';
        const failed = state === 'failed';
        const words = state === 'done'
            ? (failCode === undefined && w.secs !== undefined ? t.rowDone(Math.max(1, Math.round(w.secs / 60))) : t.rowDoneOnly)
            : failed ? (failCode === 'model' ? t.rowModelGone : t.rowFailed)
                : state === 'queued' ? t.rowQueued : t.rowReading;
        const model = failed ? this.readWhoModelName(w) : '';
        const agent = [w.name, model].filter(Boolean).join(' · ');
        return `<li class="read-run-row is-${state}" data-reader="${at + 1}" data-reader-state="${state}">`
            + `<span class="read-run-mark" aria-hidden="true">${state === 'done' ? '✓' : failed ? '×' : ''}</span>`
            + `<span class="read-run-who"><strong>${esc(t.readerN(at + 1))}</strong> <span class="read-run-agent">· ${esc(agent)}</span></span>`
            + `<span class="read-run-state">${esc(words)}</span></li>`;
    },

    /** A reader's model as a person reads it ("GPT-6-Astra"): the reading's label, else the offer's; '' as the program is set. */
    readWhoModelName(w: ReadWho): string {
        if (!w.model) return '';
        return w.modelName || this.readChoicesNow()?.agents.find(a => a.id === w.agent)?.models.find(m => m.id === w.model)?.name || w.model;
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
            const t = strings.read;
            const readers = live?.readers || s.readers;
            const usual = this.readUsualNow(live, readers);
            const running = !s.sending && (live?.state === 'reading' || live?.state === 'checking');
            // No running time while it waits for its turn (or its pages still go).
            time.textContent = running ? t.elapsed(Math.floor(secs / 60), secs % 60) : '';
            // Past the usual time (a new expected time from /status counts at once): the readers still reading read
            // longer than usual. A pace not known says no time, so nothing is late either.
            const late = running && live?.state === 'reading' && usual !== null && secs > usual * 60;
            const reading = Array.from(document.querySelectorAll<HTMLElement>(`#${DIALOG_ID} .read-run-row[data-reader-state="reading"]`));
            for (const row of reading) {
                row.classList.toggle('is-late', late);
                const words = row.querySelector('.read-run-state');
                if (words) words.textContent = late ? t.rowLate : t.rowReading;
            }
            const note = document.getElementById('read-progress-note');
            if (note) {
                const k = reading.length === 1 ? Number(reading[0].dataset.reader) : 0;
                note.textContent = !running || usual === null ? t.closeShort
                    : late ? (k ? t.lateReader(k, usual) : t.lateAll(usual)) : t.usualNote(usual);
                note.classList.toggle('is-late', late);
            }
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
        } else if (r.state === 'failed') {
            // The research may say why in its own sentence (a model the reader's agent refused): only its result has it.
            const link = this.researchOriginalsLink();
            if (link) {
                void this.loadReadResult(link.researchId, r.id).then(res => {
                    const rf = readFailureShown(res?.readerFailure, this.readFeatureOn(READ_READER_STATE_FEATURE));
                    if (!st || st.readId !== r.id || st.error?.kind !== 'failed' || !rf) return;
                    st.error.said = rf.text;
                    st.error.rf = rf;
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
            const rf = readFailureShown(res.readerFailure, this.readFeatureOn(READ_READER_STATE_FEATURE));
            const said = rf ? { said: rf.text, ...(st.sourceId ? {} : { rf }) } : {};
            st.error = st.sourceId ? { kind: 'source', why: 'other', ...said } : { kind: res.state, ...said };
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
            // One reader could not read (`read.readerState`): a text of one reader, never said to agree.
            const oneFailed = readOneReaderFailed(res, this.readFeatureOn(READ_READER_STATE_FEATURE));
            if (oneFailed) {
                res.readers.ran = 1;
                res.readers.agree = null;
                st.notice = strings.read.oneReaderFailed(oneFailed);
            }
            st.result = res;
            st.phase = 'result';
            const refn = this.readLiveOf(id)?.person
                || (st.personId ? originalTargets({ personId: st.personId as PersonId }, DataManager.getData()).person ?? '' : '');
            const chosen = st.entryId ? res.entries.findIndex(e => e.id === st!.entryId) : -1;
            // A source read again: its own entry first (the others are neighbours at the excerpt's edge).
            const own = chosen < 0 ? sourceEntryIndex(res.entries, this.readSourceEntryIds(res)) : -1;
            st.entry = chosen >= 0 ? chosen : own >= 0 ? own : defaultEntryIndex(res.entries, refn);
            st.line = -1;
            st.reader = 1;
            st.focus = '';
            st.cmp = null;
            st.spot = null;
            st.scanTab = false;
            st.nbOpen = false;
            st.srcEntry = st.entry;
            st.page = res.entries[st.entry]?.page ?? res.pages[0]?.n ?? 1;
        }
        this.renderReadDialog();
        this.refreshReadSurfaces();
        if (res && this.readIsSourceAgain(res)) this.refreshReadSourceViewer();
    },

    // ==================== THE RESULT ====================

    /** "Baptism entry, Latin, Kurrent, 1846": the document's kind, languages, script and year. */
    readResultTitle(res: ReadResult): string {
        const t = strings.read;
        if (this.readIsSourceAgain(res)) return t.resultSource;
        const kind = t.kindTitles[res.doc.kind] ?? t.kindTitles.other;
        return [kind, langNames(res.doc.language), t.scripts[res.doc.script] ?? '', readDocYear(res.doc.date)].filter(Boolean).join(', ');
    },

    /** The result's subtitle (HTML, spec 059 P7 §3): the file's name (a source: its kind and entry), then the result in one sentence. */
    readResultSubtitle(res: ReadResult): string {
        const t = strings.read;
        const isSource = this.readIsSourceAgain(res);
        const again = isSource ? this.readSourceAgainNow() : null;
        const name = again ? sourceAgainSub(again) : res.pages[0]?.name ?? '';
        const file = name
            ? `<span class="read-file" title="${esc(name)}">${esc(res.pages.length > 1 && !again ? t.progressSub(middleName(name, 40), res.pages.length) : middleName(name, 48))}</span>` : '';
        // A source read again: how it compares and why not, for the research's words to be found by.
        const failed = isSource ? this.readSourceFailed(res) : null;
        const cmp = isSource ? ` data-agree="${esc(!res.source || (failed && failed !== 'write') ? 'failed' : res.source.agree)}"${failed ? ` data-failed="${esc(failed)}"` : ''}` : '';
        return `${file}<p class="read-verdict" id="read-verdict"${cmp}>${this.readVerdictHtml(res)}</p>`;
    },

    /**
     * The header's sentence (spec 059 P7 §3): how legible, against the existing transcript (a source), whether the
     * readers agree (only when both read the shown entry, never when they read different kinds without a place).
     * Read only in part: the reason and, for a photo, what to do and "Insert a better photo".
     */
    readVerdictHtml(res: ReadResult): string {
        const t = strings.read;
        const entry = res.entries[st?.entry ?? 0] ?? null;
        const view = entry ? this.readEntryView(res, entry) : null;
        const isSource = this.readIsSourceAgain(res);
        const ill = entry ? illegibleCount(entry.transcript) : 0;
        const whyKey = res.doc.why ?? 'other';
        const partial = res.doc.legible !== 'yes' && (ill > 3 || res.doc.legible === 'no' || !entry);
        const src = isSource ? this.readSourceChanges(res) : null;
        let source: VerdictFacts['source'] = null;
        if (isSource) {
            if (src) {
                const minor = src.variants.filter(v => variantClass(v).minor).length;
                const sorted = this.readSourceSortedOn(res) ? this.readSourceCounts(res) : null;
                source = { compared: true, major: src.variants.length - minor, minor, kinded: src.kinded, ...(sorted ? { sorted } : {}) };
            } else {
                // The source changed meanwhile, or another failure: its own sentence; no entry found (or none said): not found.
                const failed = this.readSourceFailed(res);
                source = { compared: false, why: failed === 'no-source' ? t.srcFailedNoSource : failed && failed !== 'no-entry' ? t.srcFailed : '' };
            }
        }
        const count = view ? view.marks.places.filter(p => p.kind === 'dis').length : 0;
        const disagree = view?.both && (count > 0 || !this.readKindsText(res)) ? count : null;
        const facts: VerdictFacts = { partial, why: verdictWhy(res.doc.why, t.whyText), illegible: ill, source, disagree };
        // Bold counts marked in the plain sentence, then escaped as a whole.
        const html = esc(composeVerdict(facts, t, x => `\u0001${x.replace(/ /g, '\u00a0')}\u0002`, x => `\u0001${x}\u0002`)).replace(/\u0001/g, '<strong>').replace(/\u0002/g, '</strong>');
        const photo = partial && !isSource
            ? ` ${esc(t.advice[whyKey] ?? t.advice.other)} <button type="button" class="read-link" data-act="insert-other">${esc(t.betterPhoto)}</button>` : '';
        return html + photo;
    },

    /** The open tree's research says `feature` in its `/status.features`. */
    readFeatureOn(feature: string): boolean {
        const link = this.researchOriginalsLink();
        return !!link && !!this.researchStatusOf(link.researchId)?.features?.includes(feature);
    },

    /** A source read again: the ids of its own entries (`read.sourceEntry`; [] without it or none said). */
    readSourceEntryIds(res: ReadResult): string[] {
        return res.sourceRead?.entries.length && this.readFeatureOn(READ_SOURCE_ENTRY_FEATURE) ? res.sourceRead.entries : [];
    },

    /** Entry `k` of a source read again is a neighbour at the excerpt's edge (not the source's own entry). */
    readNeighbour(res: ReadResult, k: number): boolean {
        const own = this.readSourceEntryIds(res);
        return own.length > 0 && !!res.entries[k] && !own.includes(res.entries[k].id);
    },

    /** Why a source read again was not compared or not written (`read.sourceEntry`; null: compared and written, or not said). */
    readSourceFailed(res: ReadResult): ReadSourceFailCode | null {
        return res.sourceRead?.failed && this.readFeatureOn(READ_SOURCE_ENTRY_FEATURE) ? res.sourceRead.failed : null;
    },

    /** The result is a source read again: compared with its transcript, or (`read.sourceEntry`) its comparison failed. */
    readIsSourceAgain(res: ReadResult): boolean {
        return !!res.source || !!this.readSourceFailed(res);
    },

    /** The second reader's own text of an entry (`read.blindText`; null: none, or the research does not say it). */
    readBlindOf(res: ReadResult, entry: ReadEntry | null): ReadBlindEntry | null {
        if (!entry || !res.blind || !this.readFeatureOn(READ_BLIND_TEXT_FEATURE)) return null;
        return res.blind.entries.find(b => b.of === entry.id) ?? null;
    },

    /** Whose transcription shows: the second reader's when chosen and it read the entry, else reader 1's. */
    readerShown(res: ReadResult, entry: ReadEntry | null): 1 | 2 {
        return st?.reader === 2 && st.phase === 'result' && this.readBlindOf(res, entry) ? 2 : 1;
    },

    /** The readers read the document as different kinds (`read.kinds`): the sentence, or ''. */
    readKindsText(res: ReadResult): string {
        const k = res.readers.kinds;
        if (!k || !this.readFeatureOn(READ_KINDS_FEATURE)) return '';
        const t = strings.read;
        return t.kindsDiffer(t.kinds[k.first] ?? t.kinds.other, t.kinds[k.blind] ?? t.kinds.other);
    },

    /**
     * The one notice over the text (spec 059 P7 §3): the readers read different kinds of entry (`read.kinds`), its
     * first sentence bold, a ring with "!" for its shape ('' none). Also over the suggestion.
     */
    readKindsNoteHtml(res: ReadResult): string {
        const k = res.readers.kinds;
        if (!k || !this.readFeatureOn(READ_KINDS_FEATURE)) return '';
        const t = strings.read;
        return `<div class="read-kinds-note read-warn" role="note"><span class="read-warn-icon" aria-hidden="true">!</span>`
            + `<span class="read-warn-body"><strong>${esc(t.warnT(t.kinds[k.first] ?? t.kinds.other, t.kinds[k.blind] ?? t.kinds.other))}</strong> ${esc(t.warnS)}</span></div>`;
    },

    /** Both readers read this entry (spec 059 P7 §6): the second reader's text of it exists; never for a reader that did not read. */
    readBothRead(res: ReadResult, entry: ReadEntry): boolean {
        if (this.readFeatureOn(READ_BLIND_TEXT_FEATURE) && res.blind) return !!this.readBlindOf(res, entry);
        const who = res.readers.who;
        if (who && who.length >= 2 && !who[1].ran) return false;
        return (res.readers.ran ?? 0) >= 2;
    },

    /** The reading had two readers, though maybe not both on every entry (reader 2 failed, a neighbour only reader 1 read). */
    readTwoReaders(res: ReadResult): boolean {
        return (res.readers.asked ?? 0) >= 2 || (res.readers.ran ?? 0) >= 2 || (res.readers.who?.length ?? 0) >= 2;
    },

    /** A difference as the dialog uses it: its kind only when the research says kinds (`read.variantKind`). */
    readVariantShown<V extends ReadVariant>(v: V): V {
        if (this.readFeatureOn(READ_VARIANT_KIND_FEATURE) || !v.kind) return v;
        const { kind: _kind, ...rest } = v;
        return rest as V;
    },

    /**
     * A source read again: the entry its comparison belongs to (the research's own entry, an entry compared in the
     * app, else the entry shown first).
     */
    readSourceEntryK(res: ReadResult): number {
        if (st?.cmp) return st.cmp.entry;
        const own = this.readSourceEntryIds(res);
        const k = own.length ? sourceEntryIndex(res.entries, own) : -1;
        return k >= 0 ? k : st?.srcEntry ?? 0;
    },

    /**
     * A source read again, compared with its existing transcript (by the research, or in the app): its entry and
     * the differences (`at` the transcript's words, `other` the new reading's), neighbours merged; null: not compared.
     */
    readSourceChanges(res: ReadResult): { k: number; variants: MergedVariant[]; kinded: boolean } | null {
        let raw: readonly ReadVariant[];
        let kindOn = false;
        if (st?.cmp) raw = st.cmp.variants;
        else {
            const failed = this.readSourceFailed(res);
            if (!res.source || (failed && failed !== 'write')) return null;
            raw = res.source.agree === 'differ' ? res.source.variants.map(v => this.readVariantShown(v)) : [];
            kindOn = this.readFeatureOn(READ_VARIANT_KIND_FEATURE);
        }
        const k = this.readSourceEntryK(res);
        const entry = res.entries[k];
        const variants: MergedVariant[] = entry ? mergeAdjacent(raw, entry.transcript, 'other') : [...raw];
        return { k, variants, kinded: kindOn && variants.length > 0 && variants.every(v => !!(v.kind || v.kinds?.length)) };
    },

    /**
     * An entry as the result shows it (spec 059 P7 §1, §5, §6): whose text, its marks and places (the readers'
     * differences, the changes against the existing transcript only in reader 1's text of the source's entry,
     * uncertain and illegible words), whether both readers read it.
     */
    readEntryView(res: ReadResult, entry: ReadEntry): EntryView {
        const t = strings.read;
        const shown = this.readerShown(res, entry);
        const blind = this.readBlindOf(res, entry);
        const text = shown === 2 && blind ? blind.transcript : entry.transcript;
        const kindOn = this.readFeatureOn(READ_VARIANT_KIND_FEATURE);
        const dis = mergeAdjacent(entry.variants.filter(textVariant).map(v => this.readVariantShown(v)), entry.transcript, 'at');
        const data = readerPlaces(entry).data.map(p => {
            const role = p.v.field?.endsWith('.role');
            const v = this.readVariantShown(p.v);
            const side = (x: string): string => role && x ? t.roles[x] ?? x : x;
            return { v: { ...v, at: side(v.at), other: side(v.other) }, label: dataPlaceLabel(p.v.field ?? '', p.v.at, entry) };
        });
        const k = res.entries.indexOf(entry);
        const src = this.readIsSourceAgain(res) ? this.readSourceChanges(res) : null;
        const chg = src && src.k === k && !this.readNeighbour(res, k) ? src.variants : null;
        const marks = resultPlaces({ text, dis, disSide: shown === 2 ? 'other' : 'at', disKinded: kindOn, data, chg: shown === 1 ? chg : null });
        if (shown === 2 && chg?.length) {
            // Reader 2's text: the changes are listed (from reader 1's text) but not marked here.
            const r1 = resultPlaces({ text: entry.transcript, dis: [], disSide: 'at', disKinded: kindOn, data: [], chg });
            marks.places.push(...r1.places.filter(p => p.kind === 'chg').map(p => ({ ...p, elsewhere: true })));
        }
        // Sorted (`read.sourceTask`): each change in its group, a disagreement on a changed word covered by the change.
        if (chg && this.readSourceSortedOn(res)) marks.places = sortPlaces(marks.places);
        const both = this.readBothRead(res, entry);
        return { shown, marks, both, onlyR1: !both && this.readTwoReaders(res), kinded: !!src?.kinded };
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
                <div class="read-result${s.scanTab ? ' is-scan-tab' : ''}${s.zoom ? ' is-zoomed' : ''}" id="read-result" data-read="${esc(res.id)}" data-entry="${s.entry}">
                    <div class="read-scan" id="read-scan">${this.readScanHtml(res, base)}</div>
                    <div class="read-text" id="read-text">${this.readTextHtml(res, entry)}</div>
                </div>`;
    },

    /** The page shown on the scan (the chosen entry's, or the one picked by its tab). */
    readShownPage(res: ReadResult): ReadPage | null {
        const s = st!;
        return res.pages.find(p => p.n === s.page) ?? res.pages[0] ?? null;
    },

    /**
     * The scan (spec 059 P7 §7, §10): the entries' chips, the pages' tabs, the page with the entries' frames, the
     * chosen line's band and the place's outline, the legend, where the scan goes on. On a phone the same column is
     * the strip over the text ("entry N", Scan) and, as the Scan tab, the whole scan with "Back to the text".
     */
    readScanHtml(res: ReadResult, base: string): string {
        const s = st!;
        const t = strings.read;
        const page = this.readShownPage(res);
        const pageN = page?.n ?? s.page;
        const result = s.phase === 'result';
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
        const back = result ? `<button type="button" class="read-scan-back" data-act="scan-tab-off"><span aria-hidden="true">←</span> ${esc(t.backToText)}</button>` : '';
        const zoom = result && url ? `<button type="button" class="read-scan-zoom" data-act="scan-zoom" aria-pressed="${!!s.zoom}">${this.readZoomLabel()}</button>` : '';
        const strip = result ? `<span class="read-strip-tag">${esc(t.entryTag(s.entry + 1))}</span>`
            + `<button type="button" class="read-strip-scan" data-act="scan-tab">${esc(t.scanBtn)}</button>` : '';
        return `${back}${this.readChipsHtml(res)}${tabs}
                    <div class="read-scan-box">
                        <div class="read-scan-view" id="read-scan-view">
                            <div class="read-scan-sheet" id="read-scan-sheet" style="aspect-ratio: ${ratio}">
                                ${img}
                                <div class="read-scan-marks" id="read-scan-marks">${this.readScanMarksHtml(res, page)}</div>
                            </div>
                        </div>
                        ${zoom}${strip}
                    </div>
                    ${result ? this.readScanLegendHtml(res, page) + this.readScanLinksHtml(page) : ''}`;
    },

    /** "+ Enlarge beside the text" / "− Reduce" (spec 059 P7 §7). */
    readZoomLabel(): string {
        const t = strings.read;
        return `<span aria-hidden="true">${st?.zoom ? '−' : '+'}</span> ${esc(st?.zoom ? t.unzoom : t.zoomSide)}`;
    },

    /**
     * The entries' chips (spec 059 P7 §7): every entry; a source read again with its neighbours at the excerpt's edge
     * folded: its own entry and "+ 2 neighbouring entries", unfolded the neighbours dashed and smaller with "hide
     * neighbours" (a neighbour chosen keeps them unfolded). '' with one entry.
     */
    readChipsHtml(res: ReadResult): string {
        const s = st!;
        const t = strings.read;
        const entries = res.entries;
        if (entries.length < 2 || s.phase !== 'result') return '';
        const own = this.readSourceEntryIds(res).length > 0;
        const near = (k: number): boolean => own && this.readNeighbour(res, k);
        const nbCount = entries.filter((_, k) => near(k)).length;
        const nbChosen = near(s.entry);
        const open = !nbCount || nbChosen || !!s.nbOpen;
        const chips = entries.map((e, k) => {
            if (!open && near(k)) return '';
            const name = entryName(e);
            const tag = own ? near(k) ? t.eNb : t.eSrc : '';
            const sr = tag ? `${t.entrySr(k + 1, name)}, ${tag}` : t.entrySr(k + 1, name);
            return `<button type="button" class="read-entry-pill${k === s.entry ? ' is-selected' : ''}${own ? near(k) ? ' is-neighbour' : ' is-source' : ''}" data-act="entry" data-entry="${k}"`
                + ` aria-pressed="${k === s.entry}" aria-label="${esc(sr)}" title="${esc(sr)}"><span class="read-entry-n">${esc(t.entryN(k + 1))}</span>`
                + `${name ? `<span class="read-entry-name">${esc(middleName(name, 28))}</span>` : ''}`
                + `${tag ? `<span class="read-entry-tag">${esc(tag)}</span>` : ''}</button>`;
        }).join('');
        const toggle = !nbCount || nbChosen ? ''
            : open ? `<button type="button" class="read-nb-toggle is-less" data-act="nb-less" aria-expanded="true">${esc(t.nbLess)}</button>`
            : `<button type="button" class="read-nb-toggle is-more" data-act="nb-more" aria-expanded="false">${esc(t.nbMore(nbCount))}</button>`;
        return `<div class="read-entries" role="group" aria-label="${esc(t.entriesLabel)}">${chips}${toggle}</div>`;
    },

    /**
     * The scan's legend in one row (spec 059 P7 §7): the chosen entry, a neighbouring entry (when one is drawn), the
     * line (approximate without the research's line regions), the place (only with `read.variantRegion`).
     */
    readScanLegendHtml(res: ReadResult, page: ReadPage | null): string {
        const t = strings.read;
        const entry = res.entries[st!.entry];
        if (!entry?.region || !this.readEntryOnView(res, entry, page)) return '';
        const own = this.readSourceEntryIds(res).length > 0;
        const nb = own && res.entries.some((e, k) => this.readNeighbour(res, k) && !!e.region && this.readEntryOnView(res, e, page));
        const item = (key: string, text: string): string => `<span class="read-lg"><span class="read-lg-key ${key}" aria-hidden="true"></span>${esc(text)}</span>`;
        return `<p class="read-scan-legend">${[
            item('is-sel', t.lgSel),
            nb ? item('is-nb', t.lgNb) : '',
            parseTranscript(entry).lines.length >= 2 ? item('is-line is-approx', t.lgLine) : '',
            this.readFeatureOn(READ_VARIANT_REGION_FEATURE) ? item('is-place', t.lgPlace) : '',
        ].join('')}</p>`;
    },

    /**
     * Where the scan goes on (spec 059 K6.8): the original in full quality in the research (a source read
     * again: its excerpt; a page of the research's media: the original) and the source's page in the archive.
     */
    readScanLinks(page: ReadPage | null): { full: { url: string; text: string; mark: ResearchActionMark; title: string } | null; archive: string | null } {
        const again = this.readSourceAgainNow();
        if (again) {
            const src = DataManager.getData().sources?.[again.id];
            if (!src) return { full: null, archive: null };
            const excerpts = shownExcerpts(DataManager.getCurrentTreeId(), src);
            const exc = (again.clip ? excerpts.find(e => e.clip === again.clip) : undefined) ?? excerpts.find(e => !!e.clip);
            const url = exc ? this.excerptResearchUrl(src.id, exc) : null;
            return {
                full: url ? { url, text: strings.research.fullQuality, mark: researchLinkMark('excerpt'), title: strings.research.fullQualityTitle } : null,
                archive: safeHttpUrl((exc ?? excerpts[0])?.pageUrl) ?? safeHttpUrl(src.url),
            };
        }
        // A page of the research's media (M…): its original opens in the research.
        const sha = page && /^M\d/.test(page.file) ? normalizeSha256(page.sha) : null;
        const link = this.researchOriginalsLink();
        const url = sha && link && this.researchLinkAvailable('media')
            ? researchSchemeUrl('media', { tree: link.researchId, sha }, announcedResearchScheme()) : null;
        return {
            full: url ? { url, text: strings.research.fullQualityExternal, mark: researchLinkMark('media'), title: strings.research.fullQualityTitle } : null,
            archive: sha ? this.readArchivePageOf(sha) : null,
        };
    },

    /**
     * The archive's page of a scan the tree already knows by its SHA-256: an excerpt cut from it with its
     * page's permalink, else a source read from that page with its own address. Null: none known.
     */
    readArchivePageOf(sha: string): string | null {
        const treeId = DataManager.getCurrentTreeId();
        let fallback: string | null = null;
        for (const src of Object.values(DataManager.getData().sources ?? {})) {
            const exc = shownExcerpts(treeId, src).find(e => normalizeSha256(e.originalSha) === sha && safeHttpUrl(e.pageUrl));
            if (exc) return safeHttpUrl(exc.pageUrl);
            if (!fallback && normalizeSha256(src.readingSha) === sha) fallback = safeHttpUrl(src.url);
        }
        return fallback;
    },

    readScanLinksHtml(page: ReadPage | null): string {
        const { full, archive } = this.readScanLinks(page);
        const parts = [
            full ? `<button type="button" class="link-button read-scan-full" data-act="full-quality" title="${esc(full.title)}">${researchActionLabel(full.text, full.mark)}</button>` : '',
            archive ? `<a class="read-scan-archive" href="${esc(archive)}" target="_blank" rel="noopener noreferrer">${esc(strings.sources.viewerOpenPage)} ↗</a>` : '',
        ].filter(Boolean);
        return parts.length ? `<div class="read-scan-links">${parts.join('')}</div>` : '';
    },

    /**
     * The part of the page this view read (its region, the rest dimmed), the frames of the entries on its picture
     * (the chosen one solid, the source's own solid and thin, a neighbour dashed), the chosen line's band and the
     * place's outline (drawn by `showReadScanLine` and `showReadSpot`).
     */
    readScanMarksHtml(res: ReadResult, page: ReadPage | null): string {
        const s = st!;
        const t = strings.read;
        const many = res.entries.length >= 2;
        const view = page?.region ? `<span class="read-view-clip" aria-hidden="true"><span class="read-view-region" style="${regionStyle(page.region)}"></span></span>` : '';
        const own = this.readSourceEntryIds(res).length > 0;
        const frames = res.entries.map((e, k) => {
            if (!this.readEntryOnView(res, e, page) || !e.region) return '';
            const name = entryName(e);
            const one = k === s.entry && parseTranscript(e).lines.length < 2 ? ' is-one-line' : '';
            const near = own && this.readNeighbour(res, k);
            const sr = own ? `${t.entrySr(k + 1, name)}, ${near ? t.entryNeighbour : t.entrySource}` : t.entrySr(k + 1, name);
            return `<button type="button" class="read-frame${k === s.entry ? ' is-selected' : ''}${one}${near ? ' is-neighbour' : ''}" data-entry="${k}" style="${regionStyle(e.region)}"`
                + ` aria-label="${esc(sr)}" aria-pressed="${k === s.entry}">`
                + `${many ? `<span class="read-frame-n" aria-hidden="true">${esc(t.entryTag(k + 1))}</span>` : ''}</button>`;
        }).join('');
        return `${view}${frames}<span class="read-scan-line" id="read-scan-line" hidden></span><span class="read-scan-place" id="read-scan-place" hidden></span>`;
    },

    /** Whether an entry stands on the picture a view shows (its own view, or another part of the same page). */
    readEntryOnView(res: ReadResult, e: ReadEntry, page: ReadPage | null): boolean {
        if (!page) return false;
        if (e.page === page.n) return true;
        const own = res.pages.find(p => p.n === e.page);
        return !!own && readSameSheet(own, page);
    },

    /**
     * The text column (spec 059 P7 §3): at most one notice (the readers read different kinds; a source not compared:
     * which entry to compare), the text as read with its marks and who read it, the translation, "To check", the
     * explanation and the people mentioned.
     */
    readTextHtml(res: ReadResult, entry: ReadEntry | null): string {
        const s = st!;
        const t = strings.read;
        const isSource = this.readIsSourceAgain(res);
        const nc = isSource && s.phase === 'result' ? this.readNotComparedHtml(res) : '';
        const notice = nc || (s.phase === 'result' ? this.readKindsNoteHtml(res) : '');
        if (!entry) return `${notice}<p class="read-empty">${esc(t.noEntries)}</p>`;
        const sec = resultSections(res, entry, getCurrentLanguage());
        const view = this.readEntryView(res, entry);
        const second = view.shown === 2;
        const parts: string[] = [notice];
        // A neighbour at the excerpt's edge (`read.sourceEntry`): said first, it is not what was compared.
        const near = isSource && this.readNeighbour(res, s.entry);
        if (near) parts.push(`<p class="read-neighbour-note" role="note"><span class="read-nb-key" aria-hidden="true"></span><span>${esc(t.nbNote(view.onlyR1))}</span></p>`);
        if (s.cmp && s.cmp.entry === s.entry) parts.push(`<p class="read-nc-done" role="status">${esc(t.ncDone)}</p>`);
        if (sec.transcript) {
            const focusable = entry.region ? ' tabindex="0"' : '';
            const focus = s.focus ?? '';
            // The second reader's lines are its own (not reader 1's lines on the scan): no line to show there.
            const lines = view.marks.lines.map((l, j) => {
                const marked = view.marks.places.some(p => p.line === j && !p.elsewhere && (p.kind === 'dis' || p.kind === 'chg'));
                const cls = `read-line${marked ? ' has-variant' : ''}${!second && j === s.line ? ' is-active' : ''}`;
                return `<div class="${cls}" data-n="${j + 1}"${second ? '' : ` data-line="${j}"${focusable}`}>${lineMarksHtml(l, j, view.marks.places, focus)}</div>`;
            }).join('');
            const langs = langNames(res.doc.language);
            const r2note = second && isSource ? `<p class="read-r2note"><span class="read-r2note-key" aria-hidden="true"></span><span>${esc(t.r2note)}</span></p>` : '';
            parts.push(`
                <section class="read-section read-section--transcript${second ? ' is-second' : ''}" aria-labelledby="read-s-transcript">
                    <div class="read-section-head">
                        <h3 class="read-section-title" id="read-s-transcript">${esc(sec.inscription ? t.sInscription : t.txHead)}</h3>
                        <span class="read-section-sub">${esc(t.transcriptSub(langs))}</span>
                        ${this.readReaderSwitchHtml(res, entry, second)}
                        <button type="button" class="read-copy" data-act="copy">${esc(t.copyText)}</button>
                    </div>
                    ${r2note}
                    <div class="read-transcript" id="read-transcript">${lines}</div>
                    <p class="read-who-sentence">${esc(this.readWhoSentence(res, view))}</p>
                    ${second ? this.readBlindExtraHtml(res) : ''}
                </section>`);
        }
        // Reader 2 reads blind: the translation and explanation under its text are reader 1's.
        if (second && (sec.translation || sec.gloss)) parts.push(`<p class="read-from-first">${esc(t.fromFirst)}</p>`);
        if (sec.translation) {
            parts.push(`
                <section class="read-section read-section--translation" aria-labelledby="read-s-translation">
                    <div class="read-section-head"><h3 class="read-section-title" id="read-s-translation">${esc(t.sTranslation)}</h3></div>
                    <div class="read-translation">${parseBlock(entry.translation).map(l => `<p>${segsHtml(l)}</p>`).join('')}</div>
                </section>`);
        }
        parts.push(this.readCheckHtml(res, view, near));
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
     * Reader 1 / Reader 2 (spec 059 K6.6, P7 §6): whose text shows, without names (they are said once under the
     * text). Reader 2 off ("Reader 2 · did not read") for an entry it did not read, or when it could not read at all.
     * '' with one reader.
     */
    readReaderSwitchHtml(res: ReadResult, entry: ReadEntry, second: boolean): string {
        if (st?.phase !== 'result') return '';
        const blindOn = !!res.blind?.entries.length && this.readFeatureOn(READ_BLIND_TEXT_FEATURE);
        const who = res.readers.who ?? [];
        const r2failed = who.length >= 2 && !who[1].ran;
        if (!blindOn && !r2failed) return '';
        const t = strings.read;
        const has = blindOn && !!this.readBlindOf(res, entry);
        const btn = (n: 1 | 2): string => {
            const off = n === 2 && !has;
            const on = !off && (n === 2) === second;
            const label = off ? t.r2no : t.readerN(n);
            return `<button type="button" class="read-reader-btn${on ? ' is-on' : ''}${off ? ' is-off' : ''}" data-act="reader" data-reader="${n}" aria-pressed="${on}"`
                + `${off ? ' disabled aria-disabled="true"' : ''}><span class="read-reader-label">${esc(label)}</span></button>`;
        };
        return `<div class="read-reader-seg" role="group" aria-label="${esc(t.readerView)}">${btn(1)}${btn(2)}</div>`;
    },

    /**
     * Under the text, once (spec 059 P7 §2): whose text it is and who read it, the agents and models named only
     * here. Both read: reader 1's text, reader 2 as the check; only reader 1 read this entry; one reader.
     */
    readWhoSentence(res: ReadResult, view: EntryView): string {
        const t = strings.read;
        const who = res.readers.who ?? [];
        const choices = this.researchReadAcceptsAny()?.choices;
        const a = (i: number): string => who[i] ? whoLabel(who[i], choices, false) : '';
        // Both with the same program and model: named once.
        if (view.both) return a(0) && a(0) === a(1) ? t.whoSame(a(0)) : t.whoLine(a(0), a(1));
        if (view.onlyR1) return t.whoOnly(a(0));
        return t.whoSingle(a(0));
    },

    /** Under the second reader's text: the entries only it read, folded ('' none). */
    readBlindExtraHtml(res: ReadResult): string {
        const extra = (res.blind?.entries ?? []).filter(b => !b.of);
        if (!extra.length) return '';
        const items = extra.map(b => `<div class="read-blind-extra-text">${parseBlock(b.transcript).map(l => `<div class="read-line">${segsHtml(l)}</div>`).join('')}</div>`).join('');
        return `<details class="read-blind-extra"><summary>${esc(strings.read.blindExtra(extra.length))}</summary>${items}</details>`;
    },

    /**
     * "To check" (spec 059 P7 §4): the shown entry's places in groups (a source: changes, disagreements, uncertain,
     * illegible), substantive first, minor details folded. A neighbour without any: said that nothing is checked.
     */
    readCheckHtml(res: ReadResult, view: EntryView, near: boolean): string {
        const t = strings.read;
        const sorted = this.readSourceSortedOn(res) ? this.readSortedCheck(res) : undefined;
        const groups = checkHtml(view.marks.places, { isSource: this.readIsSourceAgain(res), shown: view.shown, kinded: view.kinded, focus: st?.focus ?? '', ...(sorted ? { sorted } : {}) });
        if (!groups && !near) return '';
        return `
                <section class="read-section read-check" aria-labelledby="read-s-check">
                    <div class="read-section-head"><h3 class="read-section-title" id="read-s-check">${esc(t.check)}</h3></div>
                    ${groups || `<p class="read-check-none">${esc(t.nbNothing)}</p>`}
                </section>`;
    },

    /**
     * A source read again that the research did not compare (spec 059 P7 §6): which entry is the source's, its
     * chips, and "Compare with the existing transcript" (in the app, nothing saved). '' when compared, or with no
     * existing transcript to compare with.
     */
    readNotComparedHtml(res: ReadResult): string {
        if (st?.cmp || this.readSourceChanges(res) || !res.entries.length) return '';
        const src = DataManager.getData().sources?.[this.readSourceAgainNow()?.id ?? ''];
        if (!src?.transcript?.trim()) return '';
        const t = strings.read;
        const chips = res.entries.map((e, k) => {
            const name = entryName(e);
            return `<button type="button" class="read-nc-chip${k === st!.entry ? ' is-selected' : ''}" data-act="entry" data-entry="${k}" aria-pressed="${k === st!.entry}">`
                + `<span class="read-entry-n">${esc(t.entryN(k + 1))}</span>${name ? `<span class="read-entry-name">${esc(middleName(name, 28))}</span>` : ''}</button>`;
        }).join('');
        return `
                <div class="read-nc" role="group" aria-labelledby="read-nc-q">
                    <p class="read-nc-q" id="read-nc-q">${esc(t.ncQ)}</p>
                    <p class="read-nc-t">${esc(t.ncT)}</p>
                    <div class="read-nc-row">${res.entries.length > 1 ? chips : ''}<button type="button" class="primary read-nc-btn" data-act="nc-compare">${esc(t.ncBtn)}</button></div>
                </div>`;
    },

    /** Compare the shown entry with the source's existing transcript in the app (spec 059 P7 §6): the dialog's state only. */
    readCompareInApp(): void {
        const s = st;
        const res = s?.result;
        const entry = res?.entries[s!.entry];
        const src = DataManager.getData().sources?.[this.readSourceAgainNow()?.id ?? ''];
        if (!s || !res || !entry || !src?.transcript) return;
        s.cmp = { entry: s.entry, variants: compareWithTranscript(src.transcript, entry.transcript) };
        s.focus = '';
        this.readRedrawResult(false);
    },

    /**
     * A source read again, sorted (spec 059, `read.sourceTask`): the research says which changes are sure or
     * assessed before, and the comparison is the research's own (not one made in the app).
     */
    readSourceSortedOn(res: ReadResult): boolean {
        return !st?.cmp && res.source?.agree === 'differ' && this.readFeatureOn(READ_SOURCE_TASK_FEATURE) && readSourceSaysSure(res.source.variants);
    },

    /** A source read again: the sorted groups' counts of its own entry (only `major` goes into a task). */
    readSourceCounts(res: ReadResult): VerdictSorted {
        const src = this.readSourceChanges(res);
        const entry = src ? res.entries[src.k] : null;
        if (!src || !entry) return { major: 0, unsure: 0, minor: 0, judged: [] };
        const places = this.readEntryView(res, entry).marks.places;
        // Without the sorted view the same counting: each change by its kind, the readers' places uncertain.
        return sortedCounts(this.readSourceSortedOn(res) ? places : sortPlaces(places));
    },

    /** The footer's input for who creates the task (`read.sourceTask`); null: the research does not say it (the footer as before). */
    readTaskInput(res: ReadResult): ReadTaskFootInput | null {
        return this.readTaskInputOf(res, st?.task?.read === res.id ? st.task.act : null);
    },

    /** `readTaskInput` with the choice made (`act`; null none). */
    readTaskInputOf(res: ReadResult, act: ReadTaskAct | null): ReadTaskFootInput | null {
        const s = res.source;
        if (!s || !s.taskSetting || s.agree !== 'differ' || st?.cmp || !this.readFeatureOn(READ_SOURCE_TASK_FEATURE)) return null;
        if (this.readSourceFailed(res) === 'write' || !this.readSourceChanges(res)) return null;
        const src = DataManager.getData().sources?.[this.readSourceAgainNow()?.id ?? ''];
        return {
            setting: s.taskSetting,
            offer: !!s.taskOffer,
            task: s.task,
            ...(s.taskFor ? { taskFor: s.taskFor } : {}),
            ...(s.decided ? { decided: s.decided } : {}),
            ...(s.openTask ? { openTask: s.openTask } : {}),
            confirmed: !!src && !!this.sourceConfirmState(src).conf,
            computer: onComputer(),
            counts: this.readSourceCounts(res),
            canOpenTask: this.researchLinkAvailable('task'),
            act,
        };
    },

    /** The footer that says who creates the task (spec 059 §1); '' without the feature or the research's fields. */
    readSourceTaskFootHtml(res: ReadResult): string {
        const input = this.readTaskInput(res);
        return input ? readTaskFootHtml(input) : '';
    },

    /** The sorted "To check" options: the sentence under the sure changes (by the footer's state), a person reviews them. */
    readSortedCheck(res: ReadResult): { note: string; person: boolean; taskLink: boolean } {
        const input = this.readTaskInput(res);
        const taskLink = this.researchLinkAvailable('task');
        if (!input) return { note: '', person: false, taskLink };
        return { note: readTaskMajorNote(readTaskFootState(input), input), person: readTaskForPerson(input), taskLink };
    },

    /**
     * A choice of the footer (spec 059 §1): the bridge creates the task (or saves without one); meanwhile the chosen
     * button is busy and the others off. `now` then opens the chat with the agent in the research's terminal (the
     * app's own link, never one from the answer). A retry repeats the choice it shows.
     */
    async readTaskChoose(how: ReadTaskHow, retry = false): Promise<void> {
        const s = st;
        const res = s?.result;
        const link = this.researchOriginalsLink();
        const input = res ? this.readTaskInput(res) : null;
        if (!s || !res?.source || !link || !input || input.act?.busy) return;
        const state = readTaskFootState(input);
        if (!retry && state !== 'A' && state !== 'append' && state !== 'E') return;
        const append = retry ? !!input.act?.append : state === 'append' && how !== 'save';
        const act: ReadTaskAct = { how, append, busy: true };
        s.task = { read: res.id, act };
        this.readRedrawTaskFoot(false);
        const reply = await postReadTask(this.readBridgeBase(link.researchId), res.source.id, res.id, how);
        if (st !== s || s.task?.act !== act) return;
        s.task = { read: res.id, act: reply.ok ? { how, append, busy: false, reply: reply.value } : { how, append, busy: false, failed: true } };
        this.readRedrawTaskFoot(true);
        if (!reply.ok) return;
        if (reply.value.outcome) {
            // Decided meanwhile, or a task already holds the places: the research's state asked again, nothing guessed here.
            void this.pollResearchBridge({ reschedule: false });
            if (reply.value.outcome === 'settled') void this.readTaskSettled(link.researchId, res.id);
            return;
        }
        const task = reply.value.task || (append ? input.openTask ?? '' : '');
        // The source's row in the viewer says the choice until the research's status does (spec 059 §2).
        this.noteReadSourceTask(res.source.id, res.id, how, task);
        if (how === 'now' && task) {
            const url = this.activeResearchLink('task', { task, taskDo: 'chat' });
            if (url) this.launchResearchLink(url);
        }
        this.refreshReadSourceViewer();
    },

    /**
     * Nothing was left to decide (409 read.decide.done / nothing): the result asked again, past the cache, and the
     * footer drawn from what it says now (decided, a task, no choice). Should it still offer the choices, the footer
     * keeps its sentence that nothing is left.
     */
    async readTaskSettled(researchId: string, id: string): Promise<void> {
        const s = st;
        const base = this.readBridgeBase(researchId);
        if (!s || !base) return;
        const reply = await fetchReadResult(base, id);
        if (st !== s || !reply.ok || s.result?.id !== id) return;
        const input = this.readTaskInputOf(reply.value, null);
        const state = input ? readTaskFootState(input) : null;
        if (state === 'A' || state === 'append' || state === 'E' || state === 'phone') return;
        results.set(id, reply.value);
        s.result = reply.value;
        delete s.task;
        this.readRedrawResult(false);
        this.refreshReadSourceViewer();
    },

    /** Redraw the footer after a choice (and the sentence over the sure changes, which follows it). */
    readRedrawTaskFoot(focus: boolean): void {
        const overlay = document.getElementById(DIALOG_ID);
        const s = st;
        if (!overlay || !s?.result || s.phase !== 'result') return;
        const foot = overlay.querySelector<HTMLElement>('.read-footer');
        if (foot) foot.innerHTML = this.readResultFootHtml();
        const note = overlay.querySelector<HTMLElement>('.read-check-group[data-group="major"] .read-check-note');
        const text = this.readSortedCheck(s.result).note;
        if (note && text) note.textContent = text;
        if (focus) overlay.querySelector<HTMLElement>('.read-footer .primary')?.focus();
    },

    /**
     * The result's footer (spec 059 P7 §3): one main action. A source compared: what became of the transcript, Close ·
     * Open task (terminal); not compared: Read again (AI) · Close; a document: Read another · Close · Propose to the tree.
     */
    readResultFootHtml(): string {
        const t = strings.read;
        const res = st?.result;
        // A phone (spec 059 P7 §10): one sentence of its own and only the main action of a document (× closes).
        const note = (lines: readonly string[], phone: string): string =>
            `<span class="batch-foot-note read-kept">${lines.filter(Boolean).map(l => `<span class="read-foot-line">${esc(l)}</span>`).join('')}`
            + `<span class="read-foot-phone">${esc(phone)}</span></span>`;
        if (res && this.readIsSourceAgain(res)) {
            // Who creates the task (`read.sourceTask`): the footer of its own; without the feature as before.
            const taskFoot = this.readSourceTaskFootHtml(res);
            if (taskFoot) return taskFoot;
            const src = DataManager.getData().sources?.[this.readSourceAgainNow()?.id ?? ''];
            const confirmed = src ? !!this.sourceConfirmState(src).conf ? t.keepConfirm : '' : '';
            const failed = this.readSourceFailed(res);
            if (!this.readSourceChanges(res) || st?.cmp) {
                const again = st?.readId ? `<button type="button" class="secondary" data-act="again">${researchBridgeAgentLabel(t.readAgain)}</button>` : '';
                return `${note([t.fNc1, confirmed], t.fNc1)}${again}<button type="button" class="primary" data-act="close">${esc(t.close)}</button>`;
            }
            // A difference opens its task in the research (terminal); nothing is proposed nor read anew here.
            const differ = res.source?.agree === 'differ';
            const task = differ && res.source!.task && this.researchLinkAvailable('task') ? res.source!.task : '';
            const lines = failed === 'write' ? [t.srcNotWritten] : [t.fSrc1, differ ? t.fSrc2 : t.fSrcSame];
            return `${note([...lines, confirmed], failed === 'write' ? t.srcNotWritten : t.fSrcPh)}
                <button type="button" class="${task ? 'secondary' : 'primary'}" data-act="close">${esc(t.close)}</button>
                ${task ? `<button type="button" class="primary" data-act="open-task" data-task="${esc(task)}">${researchActionLabel(t.openTaskN(task), researchLinkMark('task'))}</button>` : ''}`;
        }
        const propose = canPropose(res?.entries[st?.entry ?? 0]);
        const another = this.readDocumentReady()
            ? `<button type="button" class="secondary" data-act="another">${esc(t.another)}</button>` : '';
        return `${note([propose ? t.fDoc1 : '', t.fHist], propose ? t.fDoc1 : t.fHist)}${another}
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
        s.focus = '';
        s.spot = null;
        s.page = res.entries[i].page;
        // A neighbour chosen (on the scan too): the neighbours stay unfolded.
        if (this.readSourceEntryIds(res).length > 0 && this.readNeighbour(res, i)) s.nbOpen = true;
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
        // The header's sentence follows the entry and the reader shown.
        const sub = overlay.querySelector<HTMLElement>('.read-result-sub');
        if (sub) sub.innerHTML = this.readResultSubtitle(s.result);
        this.readClosePop(false);
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
            overlay.querySelector('.read-scan-zoom')?.remove();
        });
        // A line under the mouse shows on the scan (only with a mouse: a touch picks it by its click).
        const hover = (): boolean => window.matchMedia('(hover: hover)').matches;
        overlay.querySelectorAll<HTMLElement>('.read-line[data-line]').forEach(line => {
            const j = Number(line.dataset.line);
            line.addEventListener('mouseenter', () => { if (hover()) this.showReadScanLine(j); });
            line.addEventListener('mouseleave', () => { if (hover()) this.showReadScanLine(st?.line ?? -1); });
            line.addEventListener('focus', () => this.showReadScanLine(j));
            line.addEventListener('blur', () => this.showReadScanLine(st?.line ?? -1));
            line.addEventListener('click', (e) => {
                // A mark picks its line (never unpicks it); its bubble opens from the text's own listener.
                if ((e.target as Element | null)?.closest('[data-place]')) { this.readSelectLine(j, false); return; }
                this.readSelectLine(j === st?.line ? -1 : j, false);
            });
            line.addEventListener('keydown', (e) => {
                if (e.target !== line || (e.key !== 'Enter' && e.key !== ' ')) return;
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
            // The second reader's text has no lines on the scan.
            if (!entry?.region || !sheet || e.detail === 0 || this.readerShown(cur.result, entry) === 2) return;
            const rect = sheet.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const n = parseTranscript(entry).lines.length;
            // One line: a click into the frame picks no line (it is the whole entry).
            if (n < 2) return;
            const j = lineAt(entry.region, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, n);
            if (j >= 0) this.readSelectLine(j, true);
        }));
        // With a mouse, the band follows the line under it in the chosen entry's frame.
        const chosen = overlay.querySelector<HTMLElement>('.read-frame.is-selected');
        chosen?.addEventListener('mousemove', (e) => {
            const cur = st;
            const entry = cur?.result?.entries[cur.entry];
            if (!hover() || !cur?.result || !entry?.region || !sheet || this.readerShown(cur.result, entry) === 2) return;
            const n = parseTranscript(entry).lines.length;
            const rect = sheet.getBoundingClientRect();
            if (n < 2 || rect.width <= 0 || rect.height <= 0) return;
            const j = lineAt(entry.region, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, n);
            if (j >= 0) this.showReadScanLine(j);
        });
        chosen?.addEventListener('mouseleave', () => { if (hover()) this.showReadScanLine(st?.line ?? -1); });
        if (view && typeof ResizeObserver !== 'undefined') {
            scanObserver = new ResizeObserver(() => this.layoutReadScan());
            scanObserver.observe(view);
        }
        this.wireReadMarks(overlay);
        this.layoutReadScan();
        this.showReadScanLine(s.line);
        this.showReadSpot();
        this.readScrollScanToEntry();
    },

    /**
     * The marks of the text (spec 059 P7 §5): a click or Enter opens the place's bubble and lights its row in "To
     * check"; with a mouse, hovering shows it too. Esc closes the bubble (focus back on its mark), so does a click
     * elsewhere. Wired once on the text column (its content is redrawn).
     */
    wireReadMarks(overlay: HTMLElement): void {
        const text = overlay.querySelector<HTMLElement>('#read-text');
        if (!text || text.dataset.wiredMarks) return;
        text.dataset.wiredMarks = '1';
        const markOf = (e: Event): HTMLElement | null => (e.target as Element | null)?.closest<HTMLElement>('#read-transcript [data-place]') ?? null;
        const hover = (): boolean => window.matchMedia('(hover: hover)').matches;
        text.addEventListener('click', (e) => {
            const mk = markOf(e);
            if (mk) { this.readFocusPlace(mk.dataset.place ?? '', 'text', mk); return; }
            if (!(e.target as Element | null)?.closest('#read-pop')) this.readClosePop(false);
        });
        text.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('read-pop')) {
                e.preventDefault();
                e.stopPropagation();
                this.readClosePop(true);
                return;
            }
            const mk = markOf(e);
            if (mk && e.target === mk && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                this.readFocusPlace(mk.dataset.place ?? '', 'text', mk);
            }
        });
        text.addEventListener('mouseover', (e) => {
            if (!hover()) return;
            const pop = document.getElementById('read-pop');
            if ((e.target as Element | null)?.closest('#read-pop')) { if (popHideTimer) clearTimeout(popHideTimer); return; }
            const mk = markOf(e);
            if (!mk || (pop && !pop.dataset.hover)) return;
            if (popHideTimer) clearTimeout(popHideTimer);
            if (popFrom !== mk) this.readOpenPop(mk, true);
        });
        text.addEventListener('mouseout', (e) => {
            const pop = document.getElementById('read-pop');
            if (!pop?.dataset.hover) return;
            const to = (e.relatedTarget as Element | null);
            if (to && (to.closest('#read-pop') || to.closest('#read-transcript [data-place]') === popFrom)) return;
            if (popHideTimer) clearTimeout(popHideTimer);
            popHideTimer = setTimeout(() => { if (document.getElementById('read-pop')?.dataset.hover) this.readClosePop(false); }, 150);
        });
        // A click outside the text column (the scan, the header) closes a bubble too.
        if (!overlay.dataset.wiredPop) {
            overlay.dataset.wiredPop = '1';
            overlay.addEventListener('click', (e) => {
                const el = e.target as Element | null;
                if (!el?.closest('#read-text')) this.readClosePop(false);
            });
        }
    },

    /**
     * A place chosen (spec 059 P7 §1, §4): its mark in the text and its row in "To check" lit, its line on the scan.
     * From the list: the mark scrolled into view (a change of reader 1's text while reader 2's shows: reader 1's text
     * first); from the text: its bubble opens.
     */
    readFocusPlace(id: string, from: 'list' | 'text', mark?: HTMLElement): void {
        const s = st;
        const res = s?.result;
        const entry = res?.entries[s?.entry ?? 0];
        if (!s || !res || !entry || !id || s.phase !== 'result') return;
        const view = this.readEntryView(res, entry);
        const place = view.marks.places.find(p => p.id === id);
        if (!place) return;
        if (place.elsewhere) {
            s.reader = 1;
            s.focus = id;
            s.line = -1;
            this.readRedrawResult(false);
            this.readFocusPlace(id, 'list');
            return;
        }
        s.focus = id;
        const root = document.getElementById(DIALOG_ID);
        root?.querySelectorAll<HTMLElement>('#read-transcript [data-place], .read-check-row[data-place]').forEach(el => el.classList.toggle('is-focus', el.dataset.place === id));
        const row = root?.querySelector<HTMLElement>(`.read-check-row[data-place="${CSS.escape(id)}"]`);
        const li = row?.closest('li');
        if (li?.hidden) li.closest('ul')?.querySelector<HTMLElement>('[data-act="places-more"]')?.click();
        row?.closest('details')?.setAttribute('open', '');
        // Its word outlined on the scan where the research said where it lies (`read.variantRegion`).
        s.spot = this.readFeatureOn(READ_VARIANT_REGION_FEATURE) ? place.v?.region ?? null : null;
        this.showReadSpot();
        if (place.line >= 0 && view.shown === 1) this.readSelectLine(place.line, false);
        const mk = mark ?? root?.querySelector<HTMLElement>(`#read-transcript [data-place="${CSS.escape(id)}"]`) ?? null;
        if (from === 'list') {
            this.readClosePop(false);
            mk?.scrollIntoView({ block: 'nearest' });
        } else if (mk) this.readOpenPop(mk, false);
    },

    /** The bubble of a mark (spec 059 P7 §5): every place the mark is part of (a change around a disagreement). */
    readOpenPop(mk: HTMLElement, hover: boolean): void {
        const s = st;
        const res = s?.result;
        const entry = res?.entries[s?.entry ?? 0];
        const host = document.getElementById('read-text');
        if (!s || !res || !entry || !host) return;
        const view = this.readEntryView(res, entry);
        const ids = new Set<string>([mk, ...mk.querySelectorAll<HTMLElement>('[data-place]')].map(el => el.dataset.place ?? ''));
        for (let up = mk.parentElement?.closest<HTMLElement>('[data-place]'); up && host.contains(up); up = up.parentElement?.closest<HTMLElement>('[data-place]')) ids.add(up.dataset.place ?? '');
        const places: ShownPlace[] = view.marks.places.filter(p => ids.has(p.id));
        // A phone: a bottom sheet with "Show on the scan" (spec 059 P7 §10).
        const sheet = !hover && window.matchMedia(STRIP_QUERY).matches;
        const html = placePopHtml(places, view.shown, sheet);
        if (!html) return;
        this.readClosePop(false);
        const pop = document.createElement('div');
        pop.id = 'read-pop';
        pop.className = sheet ? 'read-pop is-sheet' : 'read-pop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', (mk.textContent ?? '').replace(/\s+/g, ' ').trim());
        if (hover) pop.dataset.hover = '1';
        pop.innerHTML = html + (hover ? '' : `<button type="button" class="read-pop-x" data-act="pop-close" aria-label="${esc(strings.read.popClose)}">&times;</button>`);
        host.appendChild(pop);
        popFrom = mk;
        mk.setAttribute('aria-expanded', 'true');
        if (sheet) return;
        const hr = host.getBoundingClientRect();
        const mr = mk.getBoundingClientRect();
        const left = Math.max(8, Math.min(mr.left - hr.left + host.scrollLeft - 10, host.clientWidth - pop.offsetWidth - 8));
        pop.style.left = `${left}px`;
        pop.style.top = `${mr.bottom - hr.top + host.scrollTop + 8}px`;
    },

    /** Close the bubble; `back`: focus returns to its mark. */
    readClosePop(back: boolean): void {
        if (popHideTimer) { clearTimeout(popHideTimer); popHideTimer = null; }
        document.getElementById('read-pop')?.remove();
        const from = popFrom;
        popFrom = null;
        from?.removeAttribute('aria-expanded');
        if (back && from?.isConnected) from.focus();
    },

    /** A transcription line chosen (on the text or the scan): marked in both; -1 clears it. */
    readSelectLine(j: number, fromScan: boolean): void {
        const s = st;
        if (!s) return;
        s.line = j;
        const lines = document.querySelectorAll<HTMLElement>(`#${DIALOG_ID} .read-line[data-line]`);
        lines.forEach(l => l.classList.toggle('is-active', Number(l.dataset.line) === j));
        this.showReadScanLine(j);
        // The phone's strip follows the chosen line.
        if (document.getElementById('read-scan-view')?.classList.contains('is-strip')) this.layoutReadScan();
        if (fromScan && j >= 0) {
            const line = document.querySelector<HTMLElement>(`#${DIALOG_ID} .read-line[data-line="${j}"]`);
            line?.scrollIntoView({ block: 'nearest' });
        }
    },

    /**
     * The band of line `j` of the chosen entry on the scan (spec 059 P7 §7); -1 hides it. Without the research's own
     * line regions (`read.lines`, not sent) the entry's region is split evenly: the band is approximate (dashed edges,
     * no fill). An entry of one line has no band: its frame is the line.
     */
    showReadScanLine(j: number): void {
        const el = document.getElementById('read-scan-line');
        const s = st;
        if (!el || !s?.result) return;
        const entry = s.result.entries[s.entry];
        const page = this.readShownPage(s.result);
        const frame = document.querySelector<HTMLElement>(`#${DIALOG_ID} .read-frame.is-selected`);
        frame?.classList.remove('is-lit');
        if (j < 0 || !entry?.region || (page && !this.readEntryOnView(s.result, entry, page))) { el.hidden = true; return; }
        const n = parseTranscript(entry).lines.length;
        if (n < 2) {
            el.hidden = true;
            frame?.classList.add('is-lit');
            return;
        }
        el.hidden = false;
        el.setAttribute('style', regionStyle(lineRegion(entry.region, Math.min(j, n - 1), n)));
        el.classList.add('is-approx');
    },

    /** The outline of the chosen place's word on the scan (`spot`, spec 059 P7 §7); none without its region. */
    showReadSpot(): void {
        const el = document.getElementById('read-scan-place');
        const s = st;
        if (!el || !s?.result) return;
        const entry = s.result.entries[s.entry];
        const page = this.readShownPage(s.result);
        const r = s.spot;
        if (!r || !entry || (page && !this.readEntryOnView(s.result, entry, page))) { el.hidden = true; return; }
        el.hidden = false;
        el.setAttribute('style', regionStyle(r));
    },

    /**
     * Lay the page out: whole and scrollable beside the text (and in the phone's Scan tab), or the phone's strip over
     * the text: the chosen entry as wide as the strip, around its chosen line.
     */
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
        const strip = window.matchMedia(STRIP_QUERY).matches && !s.scanTab;
        view.classList.toggle('is-strip', strip);
        if (!strip) {
            sheet.style.width = sheet.style.height = sheet.style.left = sheet.style.top = '';
            return;
        }
        const entry = s.result.entries[s.entry];
        // The chosen entry's crop on its own view; on another part of the page that part (it is what that view read).
        const own = entry && entry.page === page?.n ? entry.region : null;
        const region = own ?? page?.region ?? (entry && this.readEntryOnView(s.result, entry, page) ? entry.region : null);
        const n = entry ? parseTranscript(entry).lines.length : 0;
        const focus = own && s.line >= 0 && n >= 2 ? lineRegion(own, Math.min(s.line, n - 1), n) : null;
        const c = stripLayout(region, focus, view.clientWidth, view.clientHeight, ratio || 0.75);
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

    /** The phone's Scan tab (spec 059 P7 §10): the whole scan instead of the text, and back. */
    readScanTab(on: boolean): void {
        const s = st;
        const root = document.getElementById('read-result');
        if (!s?.result || !root) return;
        this.readClosePop(false);
        s.scanTab = on;
        root.classList.toggle('is-scan-tab', on);
        root.scrollTop = 0;
        this.layoutReadScan();
        this.showReadScanLine(s.line);
        this.showReadSpot();
        this.readScrollScanToEntry();
        document.querySelector<HTMLElement>(`#${DIALOG_ID} ${on ? '.read-scan-back' : '.read-strip-scan'}`)?.focus();
    },

    /** "+ Enlarge beside the text" / "− Reduce" (spec 059 P7 §7): the scan's column 500 ↔ 780 px on a desktop. */
    readToggleZoom(): void {
        const s = st;
        const root = document.getElementById('read-result');
        if (!s?.result || !root) return;
        s.zoom = !s.zoom;
        root.classList.toggle('is-zoomed', s.zoom);
        const btn = root.querySelector<HTMLElement>('.read-scan-zoom');
        if (btn) {
            btn.innerHTML = this.readZoomLabel();
            btn.setAttribute('aria-pressed', String(s.zoom));
        }
        this.readScrollScanToEntry();
    },

    /** A source's neighbouring entries unfolded among the chips, or folded again. */
    readToggleNeighbours(open: boolean): void {
        const s = st;
        const chips = document.querySelector<HTMLElement>(`#${DIALOG_ID} #read-scan .read-entries`);
        if (!s?.result || !chips) return;
        s.nbOpen = open;
        chips.outerHTML = this.readChipsHtml(s.result);
        document.querySelector<HTMLElement>(`#${DIALOG_ID} #read-scan .read-nb-toggle`)?.focus();
    },

    /** "Copy transcription": the chosen entry's text as shown (reader 1's or the second reader's) with its original marks (`[?]`, `[...]`). */
    async copyReadTranscript(): Promise<void> {
        const res = st?.result;
        const entry = res?.entries[st!.entry];
        if (!res || !entry) return;
        const text = this.readerShown(res, entry) === 2 ? this.readBlindOf(res, entry)?.transcript ?? entry.transcript : entry.transcript;
        try {
            await navigator.clipboard.writeText(text);
            this.showToast(strings.read.textCopied);
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
        if (err.kind === 'failed' && !err.failure) return this.readFailedHtml();
        const { title, text } = this.readErrorWords();
        return `
                <div class="read-error" data-error="${err.kind}" role="alert">
                    <h3 class="read-error-title">${esc(title)}</h3>
                    ${text ? `<p class="read-error-text">${esc(text)}</p>` : ''}
                </div>`;
    },

    /**
     * A reading that failed (spec 059 P7 §9): which reader could not read and why in plain words
     * (`read.readerState`), else that it did not finish; the readers' rows; the research's own
     * sentence only under "Details".
     */
    readFailedHtml(): string {
        const s = st!;
        const t = strings.read;
        const err = s.error ?? { kind: 'failed' as ErrorKind };
        const rf = err.rf;
        const on = this.readFeatureOn(READ_READER_STATE_FEATURE);
        const who = readerStates(this.readLiveOf(s.readId)?.who ?? results.get(s.readId)?.readers.who, on);
        const n = rf?.reader;
        let title = t.failAllTitle;
        let text = rf?.code === 'model' ? t.failAllModel : '';
        if (n) {
            title = t.readerFailed(n);
            const w = who?.[n - 1];
            const model = w ? this.readWhoModelName(w) : '';
            const older = !!w && !!this.readChoicesNow()?.agents.find(a => a.id === w.agent)?.catalogNewer;
            const why = !w ? '' : rf.code === 'model' && model ? t.whyModel(w.name, model, older) : t.whyStopped(w.name);
            const other = who?.findIndex((x, i) => i !== n - 1 && x.state === 'done') ?? -1;
            text = [why, other >= 0 ? t.otherDone(other + 1) : ''].filter(Boolean).join(' ') || text;
        }
        const rows = who && who.length >= 2
            ? `<ul class="read-run-rows">${who.map((w, at) => this.readRunRowHtml(w, at, rf?.code ?? '')).join('')}</ul>` : '';
        const said = err.said ?? '';
        const details = said ? `
                    <div class="read-details">
                        <button type="button" class="research-sync-link read-details-toggle" data-act="details" aria-expanded="${detailsOpen}" aria-controls="read-details-text"><span aria-hidden="true">${detailsOpen ? '▾' : '▸'}</span> ${esc(t.details)}</button>
                        <p class="read-details-text" id="read-details-text"${detailsOpen ? '' : ' hidden'}><strong>${esc(t.detailsLead)}</strong> <span class="read-details-said">${esc(said)}</span></p>
                    </div>` : '';
        return `
                <div class="read-error read-failed" data-error="failed"${n ? ` data-reader="${n}"` : ''} role="alert">
                    <h3 class="read-error-title">${esc(title)}</h3>
                    ${text ? `<p class="read-error-text">${esc(text)}</p>` : ''}
                    ${rows}
                    ${details}
                </div>`;
    },

    /** A failed reading's footer: nothing was written; try again (an agent starts), or another model in "Adjust reading". */
    readFailedFootHtml(own: boolean): string {
        const s = st!;
        const t = strings.read;
        // Another model only where the research offers a choice and the reading itself was this app's.
        const other = own && !!s.readId && !!this.readChoicesNow();
        const retry = own ? `<button type="button" class="${other ? 'secondary' : 'primary'}" data-act="retry">${researchBridgeAgentLabel(t.retry)}</button>` : '';
        const tryOther = other ? `<button type="button" class="primary" data-act="other-model">${esc(t.tryOther)}</button>` : '';
        return `<span class="batch-foot-note">${esc(t.failNothing)}</span>`
            + `<button type="button" class="${own ? 'secondary read-close-wide' : 'primary'}" data-act="close">${esc(t.close)}</button>${retry}${tryOther}`;
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
                    <p class="read-error-text">${esc(s.error?.said || (t.sourceWhy[why] ?? t.sourceWhy.other))}</p>
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
            case 'failed': title = t.failed; text = err.said || (t.failedWhy[err.failure?.kind ?? ''] ?? ''); break;
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
            case 'late': ({ title, text } = this.readLateWords()); break;
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
            case 'failed':
                if (!s.error?.failure) return this.readFailedFootHtml(own);
                return `<span class="batch-foot-note"></span>${own ? `${btn('close', t.close)}<button type="button" class="primary" data-act="retry">${researchBridgeAgentLabel(t.retry)}</button>` : btn('close', t.close, true)}`;
            case 'cancelled': return `<span class="batch-foot-note"></span>${s.readId && own ? `<button type="button" class="secondary" data-act="again">${researchBridgeAgentLabel(t.readAgain)}</button>` : ''}${close}`;
            case 'busy': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('show-running', t.showRunning, true)}`;
            case 'held': {
                const seal = this.researchSealAction(s.error?.failure?.held)[0];
                return `<span class="batch-foot-note"></span>${btn('close', t.close, !seal)}${seal ? btn('seal', seal.label, true) : ''}`;
            }
            case 'unreadable': return `<span class="batch-foot-note"></span>${btn('close', t.close)}${btn('insert-other', t.insertOther, true)}`;
            // Waiting for the reading the bridge may have taken: no second start offered until it most likely did not.
            case 'late': return `<span class="batch-foot-note"></span>${s.late?.gone ? `${btn('close', t.close)}${btn('retry', t.retry, true)}` : btn('close', t.close, true)}`;
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
            case 'task-now': void this.readTaskChoose('now'); break;
            case 'task-queue': void this.readTaskChoose('queue'); break;
            case 'task-save': void this.readTaskChoose('save'); break;
            case 'task-review': void this.readTaskChoose('review'); break;
            case 'task-retry': {
                const how = st?.task?.act.how;
                if (how) void this.readTaskChoose(how, true);
                break;
            }
            case 'open-settings':
                // The research's settings of the tree (its group "Reading documents", spec 059 §4).
                this.closeReadDocumentDialog();
                this.openReadTaskSettings();
                break;
            case 'refine': if (st) { st.refineOpen = !st.refineOpen; this.readRedrawChoose(); } break;
            case 'reset-with': {
                const choices = this.readChoicesNow();
                if (st && choices) { st.with = [readerDefault(choices, 0), readerDefault(choices, 1)]; forgetWith(); this.readRedrawChoose(); }
                break;
            }
            case 'how-update': {
                // A reader's "How to update" unfolded or folded (kept across redraws).
                const at = Number(el.dataset.at);
                if (howOpen.has(at)) howOpen.delete(at); else howOpen.add(at);
                this.readRedrawChoose();
                break;
            }
            case 'details': {
                // A failure's "Details" unfolded in place (the focus stays on the toggle).
                detailsOpen = !detailsOpen;
                const text = overlay.querySelector<HTMLElement>('#read-details-text');
                if (text) text.hidden = !detailsOpen;
                el.setAttribute('aria-expanded', String(detailsOpen));
                const mark = el.querySelector('[aria-hidden]');
                if (mark) mark.textContent = detailsOpen ? '▾' : '▸';
                break;
            }
            case 'other-model': this.readOtherModel(); break;
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
            case 'source-entry': {
                // Back from a neighbour to the source's own entry.
                const res = st?.result;
                const k = res ? sourceEntryIndex(res.entries, this.readSourceEntryIds(res)) : -1;
                if (k >= 0) this.readSelectEntry(k);
                break;
            }
            case 'reader': {
                // Whose transcription shows: only the view (nothing is stored); no line chosen in another reader's text.
                const n = el.dataset.reader === '2' ? 2 : 1;
                // The chosen line's band and the place's outline stay on the scan (spec 059 P7 §7).
                if (st && st.reader !== n) { st.reader = n; this.readRedrawResult(false); }
                break;
            }
            case 'page': this.readSelectPage(Number(el.dataset.page)); break;
            case 'scan-zoom': this.readToggleZoom(); break;
            case 'scan-tab': this.readScanTab(true); break;
            case 'scan-tab-off': this.readScanTab(false); break;
            case 'pop-scan': this.readScanTab(true); break;
            case 'nb-more': this.readToggleNeighbours(true); break;
            case 'nb-less': this.readToggleNeighbours(false); break;
            case 'full-quality': {
                const res = st?.result;
                const url = res ? this.readScanLinks(this.readShownPage(res)).full?.url : null;
                if (url) this.launchResearchLink(url);
                break;
            }
            case 'copy': void this.copyReadTranscript(); break;
            case 'copy-source': void this.copySourceTranscript(); break;
            case 'gloss': this.toggleReadGloss(el); break;
            case 'places-more': {
                // The rest of the places, unfolded in place (nothing redrawn).
                el.closest('ul')?.querySelectorAll<HTMLElement>('[data-more]').forEach(li => { li.hidden = false; li.removeAttribute('data-more'); });
                el.closest('li')?.remove();
                break;
            }
            case 'place': this.readFocusPlace(el.dataset.place ?? '', 'list'); break;
            case 'nc-compare': this.readCompareInApp(); break;
            case 'pop-close': this.readClosePop(true); break;
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

    /**
     * "Try another model" after a failed reading: the input again with "Adjust reading" open, the
     * readers as they were sent, and the focus on the failed reader's model (reader 1 when not known).
     */
    readOtherModel(): void {
        const s = st;
        const choices = this.readChoicesNow();
        if (!s || !choices) return;
        const who = this.readLiveOf(s.readId)?.who ?? results.get(s.readId)?.readers.who;
        const sent: ReaderChoice[] | null = who?.length ? who.map(w => ({ agent: w.agent, model: w.model, effort: w.effort })) : s.sentWith;
        if (sent?.length) {
            const base = this.readChosen(choices);
            s.with = readersFromStored(choices, [...sent, ...base.slice(sent.length)].slice(0, 2), 2);
            s.readers = sent.length >= 2 ? 2 : 1;
        }
        const failed = s.error?.rf?.reader ?? ((who?.findIndex(w => w.state === 'failed') ?? -1) + 1);
        const at = failed >= 1 && failed <= s.readers ? failed - 1 : 0;
        s.refineOpen = true;
        if (this.readSourceAgainNow()) this.readSourceAgainInput();
        else if (s.readId) {
            s.mode = 'again';
            s.phase = 'input';
            s.error = null;
            s.notice = '';
            this.renderReadDialog();
        } else this.newReadInput(true);
        document.querySelector<HTMLElement>(`#${DIALOG_ID} select[data-at="${at}"][data-field="model"]`)?.focus();
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
        const late = this.readLateStart(link.researchId, { pages: pages.length, doc: pages.map(p => p.sha).join(',') });
        const reply = await startRead(base, {
            files: pages.map(p => p.sha), readers: s.readers, lang: getCurrentLanguage(), person: refn, note: s.note,
            with: this.readWithNow(),
        });
        if (st !== s) return;
        s.busy = false;
        s.sending = null;
        if (!reply.ok) {
            const f = reply.failure;
            if (f.late) { this.readStartLate(link.researchId, late); return; }
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
        const late = this.readLateStart(link.researchId, { pages: 1, doc: `source:${again.refn}`, source: again.refn });
        const reply = await startSourceRead(base, {
            source: again.refn, ...(again.clip ? { clip: again.clip } : {}), readers: s.readers, lang: getCurrentLanguage(),
            with: this.readWithNow(),
            // The app chooses who creates the task only with a research that says so; an older one creates it itself.
            ...readTaskChoiceFor(this.researchStatusOf(link.researchId)?.features),
        });
        if (st !== s) return;
        s.busy = false;
        if (!reply.ok && reply.failure.late) { this.readStartLate(link.researchId, late); return; }
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

    /** What a start about to be sent may leave behind when its answer does not come in time. */
    readLateStart(researchId: string, what: Pick<LateStart, 'pages' | 'doc' | 'source' | 'again'>): LateStart {
        if (st) st.late = null;
        return { ...what, at: Date.now(), before: new Set(readsByResearch.get(researchId)?.keys() ?? []), heard: false, gone: false };
    },

    /**
     * A start without an answer in time: the bridge may still take it. The dialog says so and waits for the
     * reading to be listed (then its progress), never back to the input (a second reading paid for).
     */
    readStartLate(researchId: string, late: LateStart): void {
        const s = st;
        if (!s) return;
        s.busy = false;
        s.sending = null;
        s.late = late;
        if (s.phase === 'propose') {
            // A second reader from the suggestion: the suggestion stays, the words above it.
            const { title, text } = this.readLateWords();
            s.notice = [title, text].filter(Boolean).join(' ');
        } else {
            s.phase = 'error';
            s.error = { kind: 'late' };
        }
        // Listed already (a status came meanwhile): followed at once.
        const reads = readsByResearch.get(researchId);
        if (reads) this.readCheckLate(researchId, reads, true);
        if (s.late) this.renderReadDialog();
        this.watchReads();
        void this.askResearchBridge(researchId, POLL_MS);
    },

    /** The words of a start without an answer: waiting for the reading, or (long after, not listed) most likely not started. */
    readLateWords(): { title: string; text: string } {
        const t = strings.read;
        return { title: t.lateTitle, text: st?.late?.gone ? t.lateGone : t.lateWait };
    },

    /** The reading a start without an answer started, as the bridge lists it now (null: none listed). */
    readLateMatch(reads: Map<string, LiveRead>, late: LateStart): LiveRead | null {
        if (late.again) {
            const r = reads.get(late.again.id);
            return r && (r.version > late.again.version || readRunning(r.state)) ? r : null;
        }
        for (const r of reads.values()) {
            if (late.before.has(r.id) || r.from !== 'app') continue;
            // Asked for well before the start: not this one (the clock is the same computer's).
            const at = Date.parse(r.at);
            if (Number.isFinite(at) && at < late.at - 60_000) continue;
            if (late.source ? r.source === late.source : !r.source && (!r.files || r.files === late.pages)) return r;
        }
        return null;
    },

    /**
     * After a status: the reading of a start without an answer taken over when listed (its id; followed here
     * with `follow`, else by the caller); long after, the dialog says it most likely did not start.
     */
    readCheckLate(researchId: string, reads: Map<string, LiveRead>, follow: boolean): string {
        const s = st;
        const late = s?.late;
        if (!s || !late || this.researchOriginalsLink()?.researchId !== researchId) return '';
        const r = this.readLateMatch(reads, late);
        if (r) {
            s.late = null;
            rememberRead(r.id, researchId, late.doc);
            results.delete(r.id);
            if (s.phase === 'error' && s.error?.kind === 'late') {
                s.phase = 'progress';
                s.error = null;
                s.result = null;
            }
            s.readId = r.id;
            s.startedAt = Number.isFinite(Date.parse(r.at)) ? Date.parse(r.at) : Date.now();
            s.sawChecking = false;
            if (s.phase === 'propose') {
                // The words above the suggestion go (the second reader's progress follows).
                s.notice = '';
                if (document.getElementById(DIALOG_ID)) this.renderReadDialog();
            }
            if (follow && document.getElementById(DIALOG_ID)) this.followReadInDialog(r);
            return r.id;
        }
        // The listing known when the start was given up is not a status since then.
        if (follow) return '';
        const heard = late.heard;
        late.heard = true;
        if (heard && !late.gone && Date.now() - late.at >= lateWaitMs()) {
            late.gone = true;
            if (s.phase === 'propose') {
                // The second reader most likely did not start: the suggestion can be written or read again.
                s.second = false;
                const { title, text } = this.readLateWords();
                s.notice = [title, text].filter(Boolean).join(' ');
            }
            this.renderReadDialog();
        }
        return '';
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
        const late = this.readLateStart(link.researchId, { pages: 0, doc: '', again: { id: s.readId, version: this.readLiveOf(s.readId)?.version ?? 0 } });
        const reply = await readAgain(base, s.readId, s.readers, this.readWithNow());
        if (st !== s) return;
        s.busy = false;
        if (!reply.ok && reply.failure.late) { this.readStartLate(link.researchId, late); return; }
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

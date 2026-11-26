/**
 * "Give a family tree" (spec 093 §5, §8): the gift package — one ZIP for a
 * person (or a couple) with one folder inside: the cover page ("Start here"),
 * the app with the tree, the family pages, the family book, the ancestor fan
 * (SVG and PNG) and a GEDCOM, each part optional but the cover.
 *
 * The living are protected ONCE (D4, giftProtectedData) and every output gets
 * those very data with no protection of its own: the app as it is, the pages
 * and the book under 'full', the fan and the GEDCOM without any. The package
 * is made a step at a time (§8: the cut and the protection, the app, the
 * pages, the book, the fan, the GEDCOM, the ZIP), each part written into the
 * archive as soon as it is done (deflated where it pays), with a pause
 * between steps and inside the pages and the book so the window stays
 * responsive; an AbortSignal stops it anywhere (an AbortError, nothing made).
 *
 * The app, the PNG and the cover page come from the caller (`GiftPackageEnv`):
 * the app exists only in the built page, a PNG needs a canvas, the cover page
 * is its own module. Without a DOM the rest runs as it is (tests).
 *
 * Many recipients (D3, §8 "Hromadně"): buildGiftBatch makes the packages one
 * after another — each one's data and Blobs let go before the next — and
 * writes each finished ZIP into one outer ZIP (stored: already compressed),
 * or hands it to `onPersonZip` (a folder chosen by the person). One person's
 * failure (out of memory among them) is noted and the next one follows.
 */

import type { Person, PersonId, StromData } from './types.js';
import type { LineageIndex } from './lineage.js';
import { ancestorGenerations } from './lineage.js';
import {
    defaultGiftFan, giftCutIds, giftProtectedData, giftShortensLiving,
    type GiftCards, type GiftFan, type GiftLang, type GiftLetter, type GiftParts, type GiftSettings,
} from './gift-tree.js';
import { getStringsForLang, joinAnd } from './strings.js';
import { buildGiftCover, giftMessage } from './gift-cover.js';
import { shownName } from './person-name.js';
import { unicodeFileName } from './filenames.js';
import { ZipBlobSink, ZipWriter, type ZipAdded } from './zip.js';
import { buildPageSet, type PageSetOptions } from './family-pages.js';
import { buildPageSetFilesAsync, pageSetRenderedPages } from './family-pages-html.js';
import { buildFamilyBookAsync, defaultBookOptions, type BookOptions } from './book.js';
import { defaultPagesChoices, type PagesChoices } from './book-memory.js';
import {
    buildFanModel, buildFanPosterSvg, fanPosterGeometry, FAN_MAX_DESC_GENERATIONS, FAN_MAX_GENERATIONS, FAN_MIN_DESC_GENERATIONS, FAN_MIN_GENERATIONS,
    type FanModel, type FanShape,
} from './fan-chart.js';
import type { FanPortrait } from './fan-chart.js';
import { FAN_LOOK_DEFAULT, type FanLook } from './fan-look.js';
import { fanStyleFont, type FanColorMode, type FanStyle } from './fan-colors.js';
import { fanMeasureFor } from './fan-labels.js';
import { escapeXml, type PosterFooterMeta } from './export-image.js';
import { exportToGedcom } from './ged-exporter.js';
import { expandedData, hasPoolRefs } from './image-expand.js';
import { jsonBytesWithoutImages, treeImageChars } from './memory-limit.js';
import { forEachImagePlace } from './image-intern.js';

// ==================== Steps, progress, errors ====================

/** The steps of making a package (§8), in their order. */
export const GIFT_STEPS = ['cut', 'app', 'pages', 'book', 'fan', 'gedcom', 'zip'] as const;
export type GiftStep = typeof GIFT_STEPS[number];

/** The parts the package can leave out (the cover page is always in). */
export type GiftPartKey = keyof GiftParts;

/** The steps a package with these parts goes through: the parts left out are not among them. */
export function giftStepsFor(parts: GiftParts): GiftStep[] {
    return GIFT_STEPS.filter(s => s === 'cut' || s === 'zip' || parts[s]);
}

/**
 * Where the making is: the step (1-based of the steps it has), inside the
 * pages and the book `done` of `total`, and once a step is done the bytes it
 * added to the archive (`size`).
 */
export interface GiftProgress {
    step: GiftStep;
    stepIndex: number;
    stepCount: number;
    done?: number;
    total?: number;
    size?: number;
}

/** The browser ran out of memory while making `part` (a RangeError or a failed allocation). */
export class GiftOutOfMemory extends Error {
    readonly part: GiftStep;
    constructor(part: GiftStep, cause?: unknown) {
        super(`Out of memory: ${part}`);
        this.name = 'GiftOutOfMemory';
        this.part = part;
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}

/** Whether an error says the memory ran out (a RangeError: an array or a string too large, an allocation that failed). */
export function isOutOfMemory(e: unknown): boolean {
    if (e instanceof GiftOutOfMemory || e instanceof RangeError) return true;
    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    return /out of memory|allocation failed|invalid (string|array|typed array) length/i.test(msg);
}

/** The error a cancelled making ends with. */
export function giftAbortError(): Error {
    return typeof DOMException === 'function'
        ? new DOMException('The making of the package was cancelled.', 'AbortError')
        : Object.assign(new Error('The making of the package was cancelled.'), { name: 'AbortError' });
}

export function isAbortError(e: unknown): boolean {
    return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

function checkAbort(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw giftAbortError();
}

// ==================== Names ====================

/** The recipients' names as the package writes them (people not in the data left out). */
export function giftRecipientNames(data: StromData, recipients: readonly PersonId[]): string[] {
    return recipients.map(id => data.persons[id]).filter((p): p is Person => !!p).map(p => shownName(p) || '?');
}

/** "Daniel Berg", a couple "Eva Berg a Jonas Holm" (the letter's language). */
export function giftNamesLabel(lang: GiftLang, names: readonly string[]): string {
    return joinAnd(lang, [...names]);
}

/** The files of one package (§5), in the letter's language; paths below the folder. */
export interface GiftFileNames {
    /** The archive: "Rodokmen – Daniel Berg – 2026.zip", or the name typed in the guide. */
    zip: string;
    /** The one folder inside it: "Rodokmen – Daniel Berg". */
    folder: string;
    start: string;
    app: string;
    /** The family pages' folder (its index.html opens them). */
    pages: string;
    book: string;
    /**
     * The fans' stems (".svg" / ".png" follow): one per recipient and variant
     * (K5.6), a couple's with each one's name, several styles each with its
     * style's name; `style` null for the fan as in the app.
     */
    fans: { personId: PersonId; style: FanStyle | null; stem: string }[];
    gedcom: string;
}

/** The fan's variants (K5.6): each chosen style, or one as in the app (null). */
export function giftFanVariants(fan: GiftFan): (FanStyle | null)[] {
    if (fan.asTree) return [null];
    return fan.styles.length ? [...fan.styles] : [...defaultGiftFan().styles];
}

/** A fan style's name in a language ("Antique"): the fan view's own. */
export function giftFanStyleName(lang: GiftLang, style: FanStyle): string {
    const S = getStringsForLang(lang).fan;
    return style === 'color' ? S.styleColor : style === 'pastel' ? S.stylePastel : style === 'antique' ? S.styleAntique : S.styleMono;
}

/** The names of a package's files (§5); `fileName` the guide's own name for the archive (".zip" kept); `fan` its variants (K5.6). */
export function giftFileNames(
    lang: GiftLang, people: readonly { id: PersonId; name: string }[], year: number, fileName?: string, fan: GiftFan = defaultGiftFan(),
): GiftFileNames {
    const F = getStringsForLang(lang).giftTree.files;
    const label = giftNamesLabel(lang, people.map(p => p.name));
    const stem = (fileName ?? '').trim().replace(/\.zip$/i, '');
    const zip = `${unicodeFileName(stem || F.zip(label, year).replace(/\.zip$/, ''), 'family-tree')}.zip`;
    const variants = giftFanVariants(fan);
    const fans = people.flatMap(p => {
        const base = people.length > 1 ? F.fanOf(p.name) : F.fan;
        return variants.map(style => ({
            personId: p.id, style,
            stem: unicodeFileName(style && variants.length > 1 ? `${base} – ${giftFanStyleName(lang, style)}` : base, people.length > 1 ? F.fan : 'fan'),
        }));
    });
    return {
        zip,
        folder: unicodeFileName(F.folder(label), 'family-tree'),
        start: unicodeFileName(F.start, 'index.html'),
        app: unicodeFileName(F.app, 'app.html'),
        pages: unicodeFileName(F.pages, 'pages'),
        book: unicodeFileName(F.book, 'book.html'),
        fans,
        gedcom: `${unicodeFileName(F.gedcomFolder, 'gedcom')}/${unicodeFileName(F.gedcom, 'tree.ged')}`,
    };
}

/** The archive of many packages (D3): "Rodokmeny 2026.zip". */
export function giftBatchFileName(lang: GiftLang, year: number): string {
    return unicodeFileName(getStringsForLang(lang).giftTree.files.batch(year), 'family-trees.zip');
}

/** The message with the salutation in place of every language's placeholder (§6). */
export { giftMessage };

// ==================== The cover page ====================

/** One file the cover page leads to: its part, its path below the folder and its size unpacked. */
export interface GiftCoverFile {
    part: GiftPartKey;
    path: string;
    bytes: number;
}

/** What the cover page knows besides the protected data. */
export interface GiftCoverInfo {
    lang: GiftLang;
    recipients: PersonId[];
    names: string[];
    /** The parts in the package (the ones left out false). */
    parts: GiftParts;
    /** The files of the parts, in the order of the steps. */
    files: GiftCoverFile[];
    letter: GiftLetter;
    treeName: string;
    /** People in the package. */
    persons: number;
    photos: boolean;
    folder: string;
    now: Date;
    /** Whether the protection shortens some details of the living (the footer says so). */
    shortened?: boolean;
    /** The embedded @font-face rules (the pages'). */
    fontCss?: string;
}

/** The cover page ("Start here.html") from the very data every part got. */
export type GiftCoverBuilder = (data: StromData, info: GiftCoverInfo) => string | Promise<string>;


// ==================== One package ====================

/** The fan's own choices: the look, the colours, the shape, the depth, the portraits (browser). */
export interface GiftFanOptions {
    look?: FanLook;
    colorMode?: FanColorMode;
    /** The shape; default giftFanShape (two-way with descendants in the cut, else a half circle). */
    shape?: FanShape;
    /** Ancestor rings; default: as deep as the recipient's ancestors go (3–10). */
    generations?: number;
    /** Descendant rings of the two-way shape; default: as deep as the descendants in the cut go (1–5). */
    descGenerations?: number;
    portrait?: (person: Person) => FanPortrait | null;
}

/** What the making needs from the window (all optional where tests can do without). */
export interface GiftPackageEnv {
    /** The app with these data embedded, as a Blob (AppExporter.buildFocusAppBlob); required for the app part. `cards` the detail its cards open with (K5.7). */
    app?: (data: StromData, opts: { treeName: string; senderName?: string; senderMessage?: string; cards: GiftCards }) => Promise<Blob>;
    /** An SVG drawn to a PNG (svgToPngBlob); none or null: the fan only as SVG. */
    png?: (svg: string, widthPx: number, heightPx: number) => Promise<Blob | null>;
    /** The cover page; default: buildGiftCover. */
    cover?: GiftCoverBuilder;
    /** The embedded @font-face rules of the pages, the book and the fan. */
    fonts?: { pages?: string; book?: string; fan?: string };
    /** The book's remembered choices (loadBookMemory → bookOptionsFromMemory); selection, privacy and language are the package's. */
    book?: Partial<BookOptions>;
    /** The pages' remembered choices (pagesChoicesFromMemory). */
    pages?: PagesChoices;
    fan?: GiftFanOptions;
    /** The data with every image whole; default: the image pool's (expandedData) when the data hold references. */
    expand?: (data: StromData) => Promise<StromData>;
    /** The pause between steps and pieces of work; default a macrotask (setTimeout 0). */
    pause?: () => Promise<void>;
    /** Today (who is living, dates on the outputs); default the clock. */
    now?: Date;
}

export interface GiftPackageInput {
    /** The whole tree (or its lineages): the cut is taken from it. */
    data: StromData | LineageIndex;
    settings: GiftSettings;
    treeName: string;
    signal?: AbortSignal;
    onProgress?: (p: GiftProgress) => void;
    env?: GiftPackageEnv;
}

/** One file of the finished package (paths below the folder). */
export interface GiftPackageFile {
    path: string;
    /** Unpacked. */
    bytes: number;
    /** In the archive. */
    zipBytes: number;
}

export interface GiftPackageResult {
    blob: Blob;
    fileName: string;
    folder: string;
    files: GiftPackageFile[];
    /** People in the package. */
    persons: number;
    /** The archive's size. */
    bytes: number;
}

const defaultPause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** How many pages (or book chapters) are made between two pauses. */
const BATCH_PAGES = 8;

function dataOf(source: StromData | LineageIndex): StromData {
    return 'rodByPerson' in source ? source.data : source;
}

/** The fan's depth by default: as deep as the recipient's ancestors go, within the view's 3–10. */
function fanGenerations(data: StromData, id: PersonId): number {
    return Math.min(FAN_MAX_GENERATIONS, Math.max(FAN_MIN_GENERATIONS, ancestorGenerations(data, id).length));
}

/** How deep the descendants of `id` reach in `data` (placeholders not counted); 0 without any. */
function descendantDepth(data: StromData, id: PersonId): number {
    let depth = 0;
    let level: PersonId[] = [id];
    const seen = new Set<PersonId>([id]);
    while (level.length) {
        const next: PersonId[] = [];
        for (const pid of level) {
            for (const ch of data.persons[pid]?.childIds ?? []) {
                const c = data.persons[ch];
                if (!c || c.isPlaceholder || seen.has(ch)) continue;
                seen.add(ch);
                next.push(ch);
            }
        }
        if (!next.length) break;
        depth++;
        level = next;
    }
    return depth;
}

/**
 * The fan's shape by default (K5.6): two-way when the recipient has
 * descendants in the package's data, as deep as they reach (1–5 rings), else
 * a half circle of ancestors. `descGenerations` is given either way (for a
 * two-way shape taken from the app).
 */
export function giftFanShape(data: StromData, id: PersonId): { shape: 'two' | 'half'; descGenerations: number } {
    const depth = descendantDepth(data, id);
    const descGenerations = Math.min(FAN_MAX_DESC_GENERATIONS, Math.max(FAN_MIN_DESC_GENERATIONS, depth));
    return { shape: depth > 0 ? 'two' : 'half', descGenerations };
}

/** The fan poster of one recipient: the SVG and its size; null without a fan (not in the data). */
export function giftFanPoster(
    data: StromData, personId: PersonId, lang: GiftLang, opts: GiftFanOptions & { treeName?: string; dateLabel?: string; fontCss?: string } = {},
): { svg: string; widthPx: number; heightPx: number; model: FanModel } | null {
    const p = data.persons[personId];
    if (!p) return null;
    const generations = opts.generations ?? fanGenerations(data, personId);
    const auto = giftFanShape(data, personId);
    const model = buildFanModel(data, personId, {
        generations, shape: opts.shape ?? auto.shape, descGenerations: opts.descGenerations ?? auto.descGenerations,
    });
    if (!model) return null;
    const look = opts.look ?? FAN_LOOK_DEFAULT;
    const colorMode = opts.colorMode ?? 'gender';
    const measure = fanMeasureFor(fanStyleFont(look.style));
    const meta: PosterFooterMeta = {
        ...(opts.treeName ? { treeName: opts.treeName } : {}),
        viewLabel: getStringsForLang(lang).poster.viewFan(shownName(p) || '?', model.generations),
        ...(opts.dateLabel ? { dateLabel: opts.dateLabel } : {}),
    };
    const svg = buildFanPosterSvg(model, {
        esc: escapeXml,
        editable: false,
        addParentLabel: '',
        colorMode,
        style: look.style,
        content: look.content,
        measure,
        mmPerPx: 0.26,
        ...(look.portraits && opts.portrait ? { portrait: opts.portrait } : {}),
        ...(opts.fontCss ? { fontFaceCss: opts.fontCss } : {}),
    }, meta);
    const geom = fanPosterGeometry(model, meta, { colorMode, style: look.style, measure });
    return { svg, widthPx: geom.width, heightPx: geom.height, model };
}

/** The letter's date as the outputs print it ("24. 12. 2026"). */
function dateLabelOf(lang: GiftLang, d: Date): string {
    try { return d.toLocaleDateString(lang); } catch { return d.toISOString().slice(0, 10); }
}

/**
 * Make one package (§5, §8). Resolves with the ZIP as a Blob; rejects with
 * an AbortError once `signal` aborts (nothing kept), with GiftOutOfMemory
 * when the memory runs out (its part named), else with the error as it is.
 */
export async function buildGiftPackage(input: GiftPackageInput): Promise<GiftPackageResult> {
    const { settings, signal, env = {} } = input;
    const lang = settings.letter.lang;
    const parts = settings.parts;
    const now = env.now ?? new Date();
    const pause = env.pause ?? defaultPause;
    const steps = giftStepsFor(parts);
    const emit = input.onProgress ?? (() => { /* nobody listens */ });
    let current: GiftStep = 'cut';
    let index = 0;
    let stepStart = 0;

    const sink = new ZipBlobSink();
    const writer = new ZipWriter(sink.write, now, { blobParts: true });
    const files: GiftPackageFile[] = [];
    const cover: GiftCoverFile[] = [];

    const hold = async (): Promise<void> => {
        checkAbort(signal);
        await pause();
        checkAbort(signal);
    };
    const begin = (step: GiftStep): void => {
        current = step;
        index = steps.indexOf(step) + 1;
        stepStart = writer.bytes;
        emit({ step, stepIndex: index, stepCount: steps.length });
    };
    const tick = (done: number, total: number): void => emit({ step: current, stepIndex: index, stepCount: steps.length, done, total });
    const end = (): void => emit({ step: current, stepIndex: index, stepCount: steps.length, size: writer.bytes - stepStart });

    let folder = '';
    const put = async (path: string, data: Uint8Array | string | Blob, part?: GiftPartKey): Promise<ZipAdded> => {
        checkAbort(signal);
        const added = await writer.addAsync(`${folder}/${path}`, data);
        files.push({ path, bytes: added.size, zipBytes: added.csize });
        if (part) cover.push({ part, path, bytes: added.size });
        return added;
    };

    try {
        // 1. The cut and the protection of the living, once for every part (D4).
        begin('cut');
        await hold();
        const whole = dataOf(input.data);
        let data = giftProtectedData(input.data, settings.cut, settings.privacy, { photos: settings.photos, currentYear: now.getFullYear() });
        if (env.expand) data = await env.expand(data);
        else if (hasPoolRefs(data)) data = await expandedData(data);
        checkAbort(signal);
        const recipients = settings.cut.recipients.filter(id => !!data.persons[id]);
        const people = recipients.map(id => ({ id, name: shownName(data.persons[id]) || shownName(whole.persons[id]) || '?' }));
        const fan = settings.fan ?? defaultGiftFan();
        const names = giftFileNames(lang, people, now.getFullYear(), settings.fileName, fan);
        folder = names.folder;
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const dateLabel = dateLabelOf(lang, now);
        end();

        // 2. The app with the tree, opening on the recipient with the sender's message.
        if (parts.app) {
            begin('app');
            await hold();
            if (!env.app) throw new Error('The gift package needs the app builder.');
            const message = giftMessage(settings.letter).trim();
            const signature = (settings.letter.signature ?? '').trim();
            let blob: Blob | null = await env.app(data, {
                treeName: input.treeName,
                cards: settings.cards ?? 'detailed',
                ...(signature ? { senderName: signature } : {}),
                ...(message ? { senderMessage: message } : {}),
            });
            await put(names.app, blob, 'app');
            blob = null;
            end();
        }

        // 3. The family pages: the whole cut as a set of files under its folder.
        if (parts.pages) {
            begin('pages');
            await hold();
            const choices = env.pages ?? defaultPagesChoices();
            const opts: PageSetOptions = {
                lang, privacy: 'full', families: choices.families,
                clips: settings.photos ? 'full' : 'none', photos: settings.photos ? 'full' : 'none',
                map: choices.include.map, groups: { ...choices.groups }, timelines: choices.include.timelines, now,
            };
            const set = buildPageSet(data, { kind: 'tree' }, opts, { treeName: input.treeName });
            const total = pageSetRenderedPages(set).length;
            tick(0, total);
            let since = 0;
            await buildPageSetFilesAsync(set, {
                ...(env.fonts?.pages ? { fontCss: env.fonts.pages } : {}),
                pause: async () => {
                    if (++since >= BATCH_PAGES) { since = 0; await hold(); } else checkAbort(signal);
                },
                progress: (done, n) => tick(done, n),
                emit: async (e) => {
                    const path = `${names.pages}/${e.path}`;
                    await put(path, e.data, e.path === 'index.html' ? 'pages' : undefined);
                },
            });
            end();
        }

        // 4. The family book: chapter by chapter.
        if (parts.book) {
            begin('book');
            await hold();
            const base = defaultBookOptions(lang);
            const remembered = env.book ?? {};
            const options: BookOptions = {
                ...base, ...remembered,
                parts: { ...base.parts, ...(remembered.parts ?? {}), families: true },
                selection: { kind: 'tree' }, privacy: 'full', lang,
            };
            delete options.title;
            let since = 0;
            const html = await buildFamilyBookAsync(data, options, {
                treeName: input.treeName, dateLabel, forSave: true, now,
                ...(env.fonts?.book ? { fontCss: env.fonts.book } : {}),
            }, async (s) => {
                tick(s.k, s.n);
                if (++since >= BATCH_PAGES) { since = 0; await hold(); } else checkAbort(signal);
            });
            await put(names.book, html, 'book');
            end();
        }

        // 5. The fan of each recipient in each variant (K5.6): SVG, and PNG where the window draws one.
        if (parts.fan) {
            begin('fan');
            for (const f of names.fans) {
                await hold();
                // A chosen style: its own look (gender colours, portraits by the fan's and the package's photos), the shape by default;
                // as in the app: the app's look, colours and shape.
                const own: GiftFanOptions = f.style
                    ? {
                        look: { style: f.style, rodScope: 'all', content: FAN_LOOK_DEFAULT.content, portraits: fan.photos && settings.photos },
                        colorMode: 'gender',
                    }
                    : {
                        ...(env.fan?.look ? { look: env.fan.look } : {}),
                        ...(env.fan?.colorMode ? { colorMode: env.fan.colorMode } : {}),
                        ...(env.fan?.shape ? { shape: env.fan.shape } : {}),
                    };
                const poster = giftFanPoster(data, f.personId, lang, {
                    ...(env.fan?.generations ? { generations: env.fan.generations } : {}),
                    ...(env.fan?.portrait ? { portrait: env.fan.portrait } : {}),
                    ...own, treeName: input.treeName, dateLabel,
                    ...(env.fonts?.fan ? { fontCss: env.fonts.fan } : {}),
                });
                if (!poster) continue;
                await put(`${f.stem}.svg`, poster.svg, 'fan');
                if (env.png) {
                    await hold();
                    const png = await env.png(poster.svg, poster.widthPx, poster.heightPx);
                    if (png) await put(`${f.stem}.png`, png);
                }
            }
            end();
        }

        // 6. GEDCOM for other programs.
        if (parts.gedcom) {
            begin('gedcom');
            await hold();
            const ged = exportToGedcom(data, input.treeName).content;
            await put(names.gedcom, ged, 'gedcom');
            end();
        }

        // 7. The cover page (it names the files and their sizes), then the archive's directory.
        begin('zip');
        await hold();
        const info: GiftCoverInfo = {
            lang, recipients, names: people.map(p => p.name), parts: { ...parts }, files: cover.slice(),
            letter: settings.letter, treeName: input.treeName, persons, photos: settings.photos, folder, now,
            shortened: giftShortensLiving(input.data, settings.cut, settings.privacy, now.getFullYear()),
            ...(env.fonts?.pages ? { fontCss: env.fonts.pages } : {}),
        };
        const coverHtml = await (env.cover ?? buildGiftCover)(data, info);
        checkAbort(signal);
        await put(names.start, coverHtml);
        await writer.finishAsync();
        const blob = sink.blob();
        end();
        return { blob, fileName: names.zip, folder, files, persons, bytes: blob.size };
    } catch (e) {
        sink.clear();
        if (isAbortError(e) || e instanceof GiftOutOfMemory) throw e;
        if (isOutOfMemory(e)) throw new GiftOutOfMemory(current, e);
        throw e;
    }
}

// ==================== Many packages (D3) ====================

export interface GiftBatchItem {
    settings: GiftSettings;
}

/** A person's row of the batch: done (with its size) or not, and why. */
export interface GiftBatchRow {
    recipients: PersonId[];
    name: string;
    fileName: string;
    ok: boolean;
    bytes?: number;
    persons?: number;
    /** Why not: the memory ran out, or another error. */
    error?: 'memory' | 'failed';
    /** The step it stopped at. */
    part?: GiftStep;
    message?: string;
}

export interface GiftBatchProgress extends GiftProgress {
    /** 1-based. */
    person: number;
    persons: number;
    name: string;
}

export interface GiftBatchInput {
    data: StromData | LineageIndex;
    items: GiftBatchItem[];
    treeName: string;
    /** The outer archive's language (its name) and year. */
    lang: GiftLang;
    signal?: AbortSignal;
    onProgress?: (p: GiftBatchProgress) => void;
    /** Each finished package to a folder the person chose (no outer archive then). */
    onPersonZip?: (name: string, blob: Blob) => Promise<void> | void;
    /** A person finished (made or not): its row, 0-based index. */
    onPersonDone?: (row: GiftBatchRow, index: number) => void;
    env?: GiftPackageEnv;
}

export interface GiftBatchResult {
    /** The outer archive (null when the packages went to `onPersonZip`, or none was made). */
    blob: Blob | null;
    fileName: string;
    rows: GiftBatchRow[];
}

/** A name not yet in the archive: "… (2).zip" for a second one. */
function uniqueName(name: string, used: Set<string>): string {
    let out = name;
    for (let n = 2; used.has(out.toLowerCase()); n++) out = name.replace(/(\.zip)?$/i, ` (${n})$1`);
    used.add(out.toLowerCase());
    return out;
}

/**
 * Make a package for each item, one after another (§8 "Hromadně", D3). The
 * finished ZIPs go stored into one outer ZIP ("Rodokmeny 2026.zip"), or each
 * to `onPersonZip`. A person that fails is noted (`ok: false`, out of memory
 * as 'memory') and the next one follows; an abort ends it all (AbortError,
 * nothing kept).
 */
export async function buildGiftBatch(input: GiftBatchInput): Promise<GiftBatchResult> {
    const { signal, env = {} } = input;
    const now = env.now ?? new Date();
    const whole = dataOf(input.data);
    const fileName = giftBatchFileName(input.lang, now.getFullYear());
    const sink = input.onPersonZip ? null : new ZipBlobSink();
    const outer = sink ? new ZipWriter(sink.write, now, { blobParts: true }) : null;
    const rows: GiftBatchRow[] = [];
    const used = new Set<string>();
    const total = input.items.length;
    try {
        for (let i = 0; i < total; i++) {
            checkAbort(signal);
            const settings = input.items[i].settings;
            const recipients = settings.cut.recipients.filter(id => !!whole.persons[id]);
            const name = giftNamesLabel(settings.letter.lang, giftRecipientNames(whole, recipients));
            const row: GiftBatchRow = { recipients, name, fileName: '', ok: false };
            rows.push(row);
            let stopped: GiftStep = 'cut';
            try {
                let result: GiftPackageResult | null = await buildGiftPackage({
                    data: input.data, settings, treeName: input.treeName, signal, env,
                    onProgress: (p) => {
                        stopped = p.step;
                        input.onProgress?.({ ...p, person: i + 1, persons: total, name });
                    },
                });
                row.fileName = uniqueName(result.fileName, used);
                if (outer) await outer.addAsync(row.fileName, result.blob, 'store');
                else await input.onPersonZip!(row.fileName, result.blob);
                row.ok = true;
                row.bytes = result.bytes;
                row.persons = result.persons;
                // Let go of this person's package before the next one.
                result = null;
            } catch (e) {
                if (isAbortError(e)) throw e;
                const memory = e instanceof GiftOutOfMemory || isOutOfMemory(e);
                row.error = memory ? 'memory' : 'failed';
                row.part = e instanceof GiftOutOfMemory ? e.part : stopped;
                row.message = e instanceof Error ? e.message : String(e);
            }
            checkAbort(signal);
            input.onPersonDone?.(row, i);
            await (env.pause ?? defaultPause)();
        }
        checkAbort(signal);
        if (!outer || !sink) return { blob: null, fileName, rows };
        if (!rows.some(r => r.ok)) {
            sink.clear();
            return { blob: null, fileName, rows };
        }
        await outer.finishAsync();
        return { blob: sink.blob(), fileName, rows };
    } catch (e) {
        sink?.clear();
        throw e;
    }
}

// ==================== The size estimate (§5) ====================

/**
 * The app's program in the built page (strom.html of 3.32: about 15.4 MB,
 * most of it the embedded fonts and help). The bundle cannot know its own
 * size when it is built (it would change it); the guide may pass the real one.
 */
export const GIFT_APP_PROGRAM_BYTES = 15_500_000;

/** Text deflates to about this share (HTML, scripts, JSON, GEDCOM); images stay as they are. */
export const GIFT_TEXT_RATIO = 0.3;

// Rough sizes of the outputs' text, unpacked (measured on the family pages' and the book's constants).
const PAGES_SHELL_BYTES = 110_000;
const PAGES_PERSON_BYTES = 24_000 + 5_600 + 280;   // the page, its head and bar, its rows in the index and search
const PAGES_FAMILY_BYTES = 9_000 + 5_600;
const BOOK_SHELL_BYTES = 80_000;
const BOOK_PERSON_BYTES = 6_000;
const FAN_SVG_BYTES = 40_000;
const FAN_SECTOR_BYTES = 1_500;
/** Bytes of PNG per poster pixel at twice the size (a flat drawing deflates well). */
const FAN_PNG_BYTES_PER_PX = 0.12;
const GEDCOM_HEAD_BYTES = 2_000;
const GEDCOM_PERSON_BYTES = 700;
const GEDCOM_FAMILY_BYTES = 250;
const COVER_BYTES = 40_000;

export interface GiftSizeEstimate {
    /** Each part's bytes in the archive (0 for a part left out). */
    parts: { cover: number; app: number; pages: number; book: number; fan: number; gedcom: number };
    total: number;
    /** The same package without any images. */
    withoutPhotos: number;
    /** The same package without the app. */
    withoutApp: number;
    /**
     * One fan file's bytes by recipient (the same for each of its variants):
     * the SVG and the PNG; parts.fan is their sum over every variant.
     */
    fanFiles: Partial<Record<PersonId, { svg: number; png: number }>>;
    /** The images the package would carry with photos (§5: "148 fotek · +22 MB"). */
    photos: { count: number; bytes: number };
    persons: number;
}

/**
 * The package's size after compression without making it (§5): the app the
 * program and the cut's JSON, the pages and the book by people and families,
 * the fan by its size, the GEDCOM by records — text × GIFT_TEXT_RATIO, the
 * images as they are (in the app, the pages, the book and the GEDCOM each).
 * Without photos never more than with them; without the app smaller.
 */
export function estimateGiftSize(
    source: StromData | LineageIndex, settings: GiftSettings,
    opts: { appProgramBytes?: number; protectedData?: StromData; now?: Date; treeFanShape?: FanShape } = {},
): GiftSizeEstimate {
    const now = opts.now ?? new Date();
    const data = opts.protectedData
        ?? giftProtectedData(source, settings.cut, settings.privacy, { photos: true, currentYear: now.getFullYear() });
    const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
    const families = Object.keys(data.partnerships).length;
    const imageBytes = Math.round(treeImageChars(data) * 0.75);
    let imageCount = 0;
    forEachImagePlace(data, (holder, key) => { if (holder[key]) imageCount++; });
    const json = jsonBytesWithoutImages(data);
    const text = (n: number): number => Math.round(n * GIFT_TEXT_RATIO);
    const p = settings.parts;

    let fanBytes = 0;
    const fanFiles: Partial<Record<PersonId, { svg: number; png: number }>> = {};
    if (p.fan) {
        // Each recipient's poster in the shape the package draws, once per variant (K5.6).
        const fan = settings.fan ?? defaultGiftFan();
        const variants = giftFanVariants(fan).length;
        for (const id of settings.cut.recipients) {
            if (!data.persons[id]) continue;
            const auto = giftFanShape(data, id);
            const shape = fan.asTree && opts.treeFanShape ? opts.treeFanShape : auto.shape;
            const model = buildFanModel(data, id, { generations: fanGenerations(data, id), shape, descGenerations: auto.descGenerations });
            if (!model) continue;
            const sectors = model.sectors.filter(s => s.person).length + model.desc.filter(s => s.person).length;
            const geom = fanPosterGeometry(model, {});
            const file = {
                svg: text(FAN_SVG_BYTES + sectors * FAN_SECTOR_BYTES),
                png: Math.round(geom.width * geom.height * 4 * FAN_PNG_BYTES_PER_PX),
            };
            fanFiles[id] = file;
            fanBytes += variants * (file.svg + file.png);
        }
    }

    const textParts = {
        cover: text(COVER_BYTES),
        app: p.app ? text((opts.appProgramBytes ?? GIFT_APP_PROGRAM_BYTES) + json) : 0,
        pages: p.pages ? text(PAGES_SHELL_BYTES + persons * PAGES_PERSON_BYTES + families * PAGES_FAMILY_BYTES) : 0,
        book: p.book ? text(BOOK_SHELL_BYTES + persons * BOOK_PERSON_BYTES) : 0,
        fan: p.fan ? fanBytes : 0,
        gedcom: p.gedcom ? text(GEDCOM_HEAD_BYTES + persons * GEDCOM_PERSON_BYTES + families * GEDCOM_FAMILY_BYTES) : 0,
    };
    const withImages = (k: 'app' | 'pages' | 'book' | 'gedcom'): number => (p[k] ? imageBytes : 0);
    const sum = (o: Record<string, number>): number => Object.values(o).reduce((a, b) => a + b, 0);
    const imagesIn = withImages('app') + withImages('pages') + withImages('book') + withImages('gedcom');
    const withoutPhotos = sum(textParts);
    const photosOn = settings.photos;
    const parts = {
        ...textParts,
        app: textParts.app + (photosOn ? withImages('app') : 0),
        pages: textParts.pages + (photosOn ? withImages('pages') : 0),
        book: textParts.book + (photosOn ? withImages('book') : 0),
        gedcom: textParts.gedcom + (photosOn ? withImages('gedcom') : 0),
    };
    const total = sum(parts);
    return {
        parts, total, withoutPhotos, withoutApp: total - parts.app, fanFiles,
        photos: { count: imageCount, bytes: imagesIn }, persons,
    };
}

/** The people of a package without making it (the guide's summary). */
export function giftPersonCount(source: StromData | LineageIndex, settings: GiftSettings): number {
    return giftCutIds(source, settings.cut).size;
}

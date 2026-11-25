/**
 * Poster export UI: download the current tree as SVG or PNG, or print it as a
 * tiled multi-page PDF (via the browser print dialog). Split from UIClass; see
 * src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import {
    buildTreeSvg, computeBounds, escapeXml, PosterOptions, PosterFooterMeta, posterFooterHeight, POSTER_PADDING, PNG_SCALE,
} from '../export-image.js';
import { buildFanModel, buildFanPosterSvg, fanPosterGeometry, fanLineages } from '../fan-chart.js';
import { svgToPngDataUrl } from './svg-png.js';
import { fanStyleFont } from '../fan-colors.js';
import { fanMeasureFor } from '../fan-labels.js';
import { assignFanRodColors } from '../fan-rod-assign.js';
import { FanLook, PosterLook } from '../fan-look.js';
import { fanPhotoPortrait } from './fan-view.js';
import { computeTimelineModel } from '../timeline.js';
import { buildTimelinePosterSvg, timelinePosterGeometry } from '../timeline-chart.js';
import { uiModule } from './module.js';
import { runBusy, activatedElement, nextPaint } from './busy.js';
import { imagesBeforeOutput } from './output-images.js';
import { LayoutConfig, Person, StromData, TreeSpacing, ViewMode } from '../types.js';
import { layoutConfigFor, personCardHeight } from '../layout-config.js';
import { applyLivingPrivacy, PrivacyMode, presumedDeceasedSet } from '../privacy.js';
import { classifyBranches, BranchSet } from '../branch-colors.js';
import { computeIndirectIds } from '../indirect.js';
import { SettingsManager } from '../settings.js';
import { safeFileName } from '../filenames.js';
import { cardLines, cardYears } from '../card-fields.js';
import { measureCardTexts, cardNameMaxRows } from '../card-width.js';
import { appFontFaceCss, POSTER_SERIF_FACES, POSTER_LINE_FACES } from '../poster-fonts.js';
import { shownNameOrEmpty } from '../person-name.js';
import { unionOrderBadges } from '../marriage-order.js';
import { measureUnionOrderPill } from '../union-order-measure.js';
import { expandImageText, imageTextIds } from '../image-expand.js';
import { poolImagesChars } from '../memory-limit.js';
import { confirmMemoryForOutput } from './memory-limit-ui.js';

/** The face of the marriage-order pill's text (index.html .union-order-pill). */
const PILL_FACE = { family: 'Instrument Sans', weight: 600 };

/** Paper sizes in millimetres (portrait). */
const PAPER: Record<string, { w: number; h: number }> = {
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 },
};
const PAGE_MARGIN_MM = 10;
const PAGE_OVERLAP_MM = 10;
/** Millimetres per layout pixel (≈33mm wide cards — readable when printed). */
const MM_PER_PX = 0.26;

function posterFilename(ext: string): string {
    return `${safeFileName(TreeManager.getActiveTreeMetadata()?.name, 'family-tree')}.${ext}`;
}

function posterPrivacyMode(): PrivacyMode {
    const sel = document.getElementById('poster-privacy-mode') as HTMLSelectElement | null;
    const v = sel?.value;
    return (v === 'initials' || v === 'anonymous' || v === 'minimal') ? v : 'full';
}

/** What the poster will print, given the current view. */
interface PosterViewInfo {
    /** Dialog line, e.g. "Prints the current view: Family — from Jan (depth 3/3)". */
    line: string;
    /** Footer label ('' for views the poster cannot print). */
    label: string;
    /** True for views the poster cannot print (map, timeline). */
    blocked: boolean;
}

/** The focus person's name as it appears in `source` (raw or privacy-filtered). */
function focusNameFrom(source: StromData): string {
    const id = TreeRenderer.getFocusPersonId();
    const p = id ? source.persons[id] : null;
    return p ? shownNameOrEmpty(p) : '';
}

/** The view label (no "Prints…" prefix), given the focus name to embed. */
function viewLabelFor(mode: ViewMode, name: string): string {
    switch (mode) {
        case 'fan':
            return TreeRenderer.getFanShape() === 'two'
                ? strings.poster.viewFanTwoWay(name, TreeRenderer.getFanGenerations(), TreeRenderer.getFanDescGenerations())
                : strings.poster.viewFan(name, TreeRenderer.getFanGenerations());
        case 'timeline':
            return strings.poster.viewTimeline(name);
        case 'descendants':
            return strings.poster.viewDescendants(name);
        default: {
            // The depth the poster lays out with (a shown family's generations count on screen only).
            const depth = TreeRenderer.getOutputFocusDepth();
            return strings.poster.viewFamily(name, depth.up, depth.down);
        }
    }
}

/**
 * Describe what the poster will actually print for the CURRENT view — the
 * poster prints what you are looking at, so the map and the table are honestly blocked
 * rather than silently exporting the family card layout underneath. The dialog
 * line shows the RAW focus name (the user is looking at their own screen); the
 * footer label is rebuilt from privacy-filtered data in buildCurrentPoster.
 */
function posterViewInfo(): PosterViewInfo {
    const mode = TreeRenderer.getViewMode();
    if (mode === 'map') return { line: strings.poster.viewMapBlocked, label: '', blocked: true };
    if (mode === 'table') return { line: strings.poster.viewTableBlocked, label: '', blocked: true };
    const label = viewLabelFor(mode, focusNameFrom(DataManager.getData()));
    return { line: `${strings.poster.printsView} ${label}`, label, blocked: false };
}

/** The current view rendered as a poster, with the size + tiling geometry. */
interface PosterBuild {
    svg: string;
    widthPx: number;
    heightPx: number;
    /** Content predicate in poster-px space (origin top-left) for tile skipping. */
    hasContent: (x: number, y: number, w: number, h: number) => boolean;
}

/**
 * How the tree's cards are drawn in an image, as on screen: the branch
 * colours (when the setting is on), the presumed-deceased markers, the dimmed
 * context-only people, every density at the card size the view was laid out
 * with and in its look (compact: the name only; detailed: the age, the trade
 * and the place), and for the custom card (its width follows the view's
 * longest text; with the height "by content" each card's own height) its date
 * and label columns, its lines and its fonts. Shared by the poster and the family book's tree page, so both
 * draw the cards the layout was made for. `data` is the (privacy-filtered)
 * data the cards are drawn from.
 */
export function treeCardDrawing(data: StromData, layout: ReturnType<typeof TreeRenderer.getPosterLayout>,
    spacing: TreeSpacing = TreeRenderer.getLayoutSpacing()): {
    cardConfig: LayoutConfig; drawing: PosterOptions;
} {
    const mode = TreeRenderer.getViewMode();
    const focusId = TreeRenderer.getFocusPersonId();
    // The lineage markers as on screen (spec 112): the chosen shape and tint, both lines (R4), 1 and 2 (R5).
    const branchMarker = SettingsManager.getBranchMarker();
    const branches = (SettingsManager.isBranchMarkingOn() && focusId) ? classifyBranches(data, focusId) : null;
    const branchMap = branches ? new Map<string, BranchSet>([...branches.map].map(([id, set]) => [id as string, set])) : null;
    // Draw parity: the descendants / family views dim context-only people on
    // screen (opacity 0.5). Reuse the SAME membership rule so the image dims
    // exactly that set instead of printing everyone at full strength.
    const dimmedIds = (focusId && (mode === 'descendants' || mode === 'family'))
        ? computeIndirectIds(data, focusId, mode, [...layout.positions.keys()] as unknown as string[]) as unknown as Set<string>
        : undefined;
    const density = SettingsManager.getCardDensity();
    // The lines of details of the Detailed, Register and Custom cards (null: Compact, Normal).
    const fieldCards = SettingsManager.getEffectiveCardFields(density);
    const custom = !!fieldCards;
    // Every density at the card box the view was laid out with (compact
    // 150x44, the measured size of a card of details): drawing the default
    // 188x64 card on a layout made for another size overlaps the cards and
    // runs the lines through them (N16). Without the room the screen keeps
    // for pills on a card's bottom edge (no pills are drawn here). The
    // spacing the layout was made with (`dense`: the marriage-order pills on
    // the card's edge only, spec 069 §4).
    const cardConfig: LayoutConfig = { ...layoutConfigFor(spacing), ...TreeRenderer.getPosterCardBox(spacing) };
    const fields = fieldCards ?? SettingsManager.getCardFields();
    const cardLinesMap = custom
        ? new Map([...layout.positions.keys()].map(id => {
            const p = data.persons[id];
            return [id as string, p && !p.isPlaceholder ? cardLines(p, data, fields) : []];
        }))
        : undefined;
    const deceasedSet = presumedDeceasedSet(data);
    // The years under the name, as the screen says them ("1841 †" for one presumed dead).
    const cardYearsMap = custom && fields.years
        ? new Map([...layout.positions.keys()].map(id => {
            const p = data.persons[id];
            return [id as string, p ? cardYears(p, deceasedSet.has(id)) : ''];
        }))
        : undefined;
    const drawing: PosterOptions = {
        config: cardConfig,
        ...(custom ? {} : { cardDensity: density as 'compact' | 'normal' }),
        // The Normal card wraps a long name on the rows the screen measured (T40);
        // the Compact card shortens it with "…" where the screen does (1110).
        ...(density === 'normal' || density === 'compact' ? { measureCardTexts } : {}),
        branchMap,
        ...(branches ? { branchMarker, branchTint: SettingsManager.isBranchTintOn(), branchNumbered: branches.numbered } : {}),
        deceasedSet,
        ...(dimmedIds ? { dimmedIds } : {}),
        // The photo on the card as the screen draws it (spec 096 P2): its size, shape and who was laid out with one.
        ...(density === 'compact' ? {} : { cardPhoto: TreeRenderer.getPosterCardPhoto(spacing) }),
        // Marriage-order pills (T13): whose marriage a pill counts follows the
        // focus, and the pill is measured as the screen draws it.
        focusId,
        measureUnionOrderPill,
        // The faces the cards are drawn in: the serif always, the lines' sans for the custom card.
        // A view with marriage-order pills brings their sans (600) too.
        fontFaceCss: appFontFaceCss(custom ? [...POSTER_SERIF_FACES, ...POSTER_LINE_FACES]
            // The letter tag of the lineage markers (spec 112) is in the sans too.
            : unionOrderBadges(data, layout).size > 0 || (branches && branchMarker === 'tag') ? [...POSTER_SERIF_FACES, PILL_FACE] : POSTER_SERIF_FACES),
        ...(custom ? {
            cardLines: cardLinesMap,
            cardDateColumn: TreeRenderer.getPosterCardMetrics(spacing)?.dateColumn ?? 0,
            // The rows a detail takes, wrapped as on screen (same function, same measure).
            cardValueLines: fields.lines,
            // The name's rows: the Detailed card's whole name, the others' two at most (T40).
            cardNameMaxRows: cardNameMaxRows(density),
            cardStyle: fields.style,
            cardLabelColumn: TreeRenderer.getPosterCardMetrics(spacing)?.labelColumn ?? 0,
            ...(cardYearsMap ? { cardYears: cardYearsMap } : {}),
            measureCardTexts,
        } : {}),
    };
    return { cardConfig, drawing };
}

/**
 * Build the poster for whatever view is on screen: the fan chart in fan view,
 * the timeline in timeline view, the tree card layout otherwise. Returns null
 * when there is nothing printable (empty tree, or the blocked map view).
 *
 * The poster leaves the house — the living-privacy filter applies here exactly
 * like in the book/GEDCOM exports (audit K2: it used to export raw full names
 * of living people with no option at all).
 */
function posterFooterMeta(mode: ViewMode, data: StromData): PosterFooterMeta {
    return {
        treeName: TreeManager.getActiveTreeMetadata()?.name,
        // Footer leaves the house — build the label from the SAME privacy-
        // filtered data as the cards, so a living focus person is not named in
        // full in the footer while their card shows only initials (audit K2).
        viewLabel: viewLabelFor(mode, focusNameFrom(data)),
        dateLabel: new Date().toLocaleDateString(),
        // Wrapped within the image's width by the texts' widths in its fonts.
        measureFooterTexts: measureCardTexts,
    };
}

/** True for the views the poster lays out as the tree of cards (their spacing is the export's choice). */
function isTreePosterView(mode: ViewMode): boolean {
    return mode === 'family' || mode === 'descendants';
}

/**
 * The size of the tree poster laid out with `spacing` and which of its parts
 * hold anything (cards + footer strip): sheets that intersect nothing are
 * skipped, so a sparse tree corner prints no near-blank paper.
 */
function treePosterGeometry(spacing: TreeSpacing, meta: PosterFooterMeta): Omit<PosterBuild, 'svg'> | null {
    const layout = TreeRenderer.getPosterLayout({ spacing });
    if (layout.positions.size === 0) return null;
    const cfg: LayoutConfig = { ...layoutConfigFor(spacing), ...TreeRenderer.getPosterCardBox(spacing) };
    const bounds = computeBounds(layout, cfg);
    const widthPx = bounds.width + POSTER_PADDING * 2;
    const footerPx = posterFooterHeight(meta, widthPx);
    const heightPx = bounds.height + POSTER_PADDING * 2 + footerPx;
    const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const [id, pos] of layout.positions) {
        occupied.push({
            x: pos.x - bounds.minX + POSTER_PADDING,
            y: pos.y - bounds.minY + POSTER_PADDING,
            w: cfg.cardWidth,
            h: personCardHeight(cfg, id),
        });
    }
    occupied.push({ x: POSTER_PADDING, y: heightPx - footerPx, w: 420, h: footerPx });
    const hasContent = (x: number, y: number, w: number, h: number): boolean =>
        occupied.some(o => o.x < x + w && o.x + o.w > x && o.y < y + h && o.y + o.h > y);
    return { widthPx, heightPx, hasContent };
}

/** How a poster tiles onto sheets of the chosen paper: the grid, and how many sheets hold anything. */
interface SheetPlan {
    contentW: number; contentH: number; stepX: number; stepY: number;
    posterWmm: number; posterHmm: number; rows: number; cols: number;
    /** Sheets that print (the grid less the blank ones): the guide's count. */
    printedSheets: number;
    /** Whether the sheet at this offset (mm) holds anything. */
    tileHasContent: (offX: number, offY: number) => boolean;
}

function sheetPlan(poster: Omit<PosterBuild, 'svg'>, format: string, orientation: string): SheetPlan {
    const paper = PAPER[format] || PAPER.A4;
    const pageW = orientation === 'landscape' ? paper.h : paper.w;
    const pageH = orientation === 'landscape' ? paper.w : paper.h;
    const contentW = pageW - PAGE_MARGIN_MM * 2;
    const contentH = pageH - PAGE_MARGIN_MM * 2;
    const posterWmm = poster.widthPx * MM_PER_PX;
    const posterHmm = poster.heightPx * MM_PER_PX;
    const stepX = contentW - PAGE_OVERLAP_MM;
    const stepY = contentH - PAGE_OVERLAP_MM;
    const cols = Math.max(1, Math.ceil((posterWmm - PAGE_OVERLAP_MM) / stepX));
    const rows = Math.max(1, Math.ceil((posterHmm - PAGE_OVERLAP_MM) / stepY));
    // A sheet is printed only when it intersects drawn content — the poster
    // knows its own occupancy (card rects for the tree, the semicircle for
    // the fan), so sparse corners no longer print near-blank paper. Tiles
    // are mm-space; the predicate is px-space, so convert with MM_PER_PX.
    const tileHasContent = (offX: number, offY: number): boolean =>
        poster.hasContent(offX / MM_PER_PX, offY / MM_PER_PX, contentW / MM_PER_PX, contentH / MM_PER_PX);
    let printedSheets = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (tileHasContent(c * stepX, r * stepY)) printedSheets++;
        }
    }
    return { contentW, contentH, stepX, stepY, posterWmm, posterHmm, rows, cols, printedSheets, tileHasContent };
}

/** The paper format and orientation chosen in the dialog. */
function posterPaper(): { format: string; orientation: string } {
    return {
        format: (document.getElementById('poster-format') as HTMLSelectElement | null)?.value || 'A4',
        orientation: (document.getElementById('poster-orientation') as HTMLSelectElement | null)?.value || 'portrait',
    };
}

/** From this many cards the poster's button says its state at once (building it takes longer than 120 ms). */
export const POSTER_SHOWN_AT_ONCE = 1500;

/**
 * A poster built under the working state of the button that asked for it (§8), "Saving the file…": painted before
 * the build, at once for a large view (the page cannot paint while it builds). Without a button: built at once.
 */
async function posterBusy(work: () => void | Promise<void>, el: HTMLElement | null): Promise<void> {
    if (!el) { await work(); return; }
    const cards = TreeRenderer.getPosterLayout({ includeView: true }).positions.size;
    await runBusy(el, async () => { await nextPaint(); await work(); },
        { heavy: cards >= POSTER_SHOWN_AT_ONCE ? 'now' : true, label: strings.busy.savingFile });
}

/**
 * The fan poster's own look (spec 118 §10): prefilled from the screen at each
 * opening of the dialog, changed for this output only (never kept).
 */
const posterLook = new PosterLook(() => TreeRenderer.getFanLook());

/** The poster of the current view; `look`: the fan's look of this output (default: the screen's). */
function buildCurrentPoster(look?: FanLook): PosterBuild | null {
    const mode = TreeRenderer.getViewMode();
    if (mode === 'map' || mode === 'table') return null; // not printable

    const data = applyLivingPrivacy(DataManager.getData(), posterPrivacyMode());
    const meta = posterFooterMeta(mode, data);

    if (mode === 'timeline') {
        // Persons = the SAME rows the on-screen timeline draws (its scope,
        // spec 098 §11a: this view, the selection or the whole tree), fed
        // through the privacy-filtered data so living people are not named
        // in full (audit K2). This view: the layout's output people (no one
        // seen only through a link "linked in the view only").
        const ids = TreeRenderer.getTimelinePersonIds({ output: true });
        const model = computeTimelineModel(data, ids, new Date().getFullYear());
        if (model.rows.length === 0) return null;
        // Poster rasterises to PNG without a CSS context, so var(--male/--female)
        // cannot resolve — read the concrete token values now (light fallback).
        const rootStyle = getComputedStyle(document.documentElement);
        // The lineage signs before the names as on screen (spec 112 §3), in the light theme's P2 hex.
        const marker = SettingsManager.getBranchMarker();
        const timelineFocus = TreeRenderer.getFocusPersonId();
        const signs = marker !== 'none' && timelineFocus ? classifyBranches(data, timelineFocus) : null;
        const svg = buildTimelinePosterSvg(model, {
            esc: escapeXml,
            focusId: TreeRenderer.getFocusPersonId(),
            maleColor: rootStyle.getPropertyValue('--male').trim() || '#5b7f9e',
            femaleColor: rootStyle.getPropertyValue('--female').trim() || '#a1706e',
            unknownColor: rootStyle.getPropertyValue('--unknown').trim() || '#857d6c',
            branches: signs ? { marker, numbered: signs.numbered, lines: signs.map as ReadonlyMap<string, BranchSet> } : null,
        }, meta);
        const geom = timelinePosterGeometry(model, meta);
        return { svg, widthPx: geom.width, heightPx: geom.height, hasContent: geom.hasContent };
    }

    if (mode === 'fan') {
        const focusId = TreeRenderer.getFocusPersonId();
        if (!focusId) return null;
        // Shape, generations and colours as the view shows them (spec 029 §9.3).
        const model = buildFanModel(data, focusId, {
            generations: TreeRenderer.getFanGenerations(),
            shape: TreeRenderer.getFanShape(),
            descGenerations: TreeRenderer.getFanDescGenerations(),
        });
        if (!model) return null;
        const colorMode = TreeRenderer.getFanColorMode();
        // The look of this output (spec 118 §10): the dialog's own, else the screen's.
        const screen = TreeRenderer.getFanLook();
        const fanLook = look ?? screen;
        const { style, rodScope: scope, content } = fanLook;
        // The family lines in the colours the view shows (spec 114 §7), not assigned anew; in another
        // style or scope assigned from the view's memory, so each line keeps the screen's slot (spec 118 §10).
        const view = TreeRenderer.getFanView();
        const shown = view?.getModel();
        const sameModel = !!shown && shown.focus.id === focusId && shown.shape === model.shape
            && shown.generations === model.generations && shown.descGenerations === model.descGenerations;
        const rodColors = colorMode !== 'rod' || !view ? null
            : sameModel && style === screen.style && scope === screen.rodScope ? view.getRodAssignment()
                : assignFanRodColors(model, fanLineages(DataManager.getData()), view.rodMemory(), { style, scope });
        // A highlighted family line prints as it is seen (spec 114 §7).
        const highlight = view?.getPrintHighlight() ?? null;
        const measure = fanMeasureFor(fanStyleFont(style));
        const svg = buildFanPosterSvg(model, {
            ...(rodColors ? { rodColors } : {}),
            ...(highlight ? { highlight } : {}),
            esc: escapeXml,
            editable: false,
            addParentLabel: '',
            showKekule: SettingsManager.isFanKekuleEnabled(),
            colorMode,
            style,
            content,
            // The stored photos (after imagesBeforeOutput), never the veil of one on its way (spec 118 §6).
            ...(fanLook.portraits ? { portrait: (p: Person) => fanPhotoPortrait(p, false) } : {}),
            measure,
            mmPerPx: MM_PER_PX,
            fontFaceCss: appFontFaceCss([...POSTER_SERIF_FACES, ...POSTER_LINE_FACES]),
        }, meta);
        const geom = fanPosterGeometry(model, meta, { colorMode, style, measure, ...(rodColors ? { rodColors } : {}), ...(highlight ? { highlight } : {}) });
        return { svg, widthPx: geom.width, heightPx: geom.height, hasContent: geom.hasContent };
    }

    // Tree / descendants: the card layout as currently laid out, or laid out
    // again with the export's own spacing when it is not the view's (spec 069 §4).
    const spacing = SettingsManager.getPosterSpacing();
    const layout = TreeRenderer.getPosterLayout({ spacing });
    if (layout.positions.size === 0) return null;
    const { drawing } = treeCardDrawing(data, layout, spacing);
    // Marriage-order pills numbered as on screen, from the unfiltered data (T13).
    // The status mark and the story's fold as the cards show them (spec 066 P4 §7), from the app's own data;
    // under a living-privacy mode only for the people it leaves as they are (the presumed deceased).
    const privacy = posterPrivacyMode();
    const deceased = privacy === 'full' ? null : presumedDeceasedSet(DataManager.getData());
    const markIds = [...layout.positions.keys()].filter(id => !deceased || deceased.has(id));
    const options: PosterOptions = { ...meta, ...drawing, orderData: DataManager.getData(),
        cardMarks: TreeRenderer.posterCardMarks(markIds) };
    const svg = buildTreeSvg(data, layout, options);
    const geom = treePosterGeometry(spacing, meta);
    return geom ? { svg, ...geom } : null;
}

/**
 * The poster as a file, a print or the preview takes it: its pooled images
 * whole (image-expand.ts) — an SVG in an <img> or a file reads no image from
 * the pool. Only the images the poster shows are read.
 */
async function buildPosterOutput(look?: FanLook): Promise<PosterBuild | null> {
    const poster = buildCurrentPoster(look);
    return poster ? { ...poster, svg: (await expandImageText(poster.svg)).data } : null;
}

/**
 * The poster as a file or a print holds its portraits whole: near the memory
 * limit asked first (spec 135). The tree's photos are the first estimate; only
 * when they would be near, the poster's own portraits are counted.
 */
function posterMemory(): Promise<'go' | 'without' | 'cancel'> {
    return confirmMemoryForOutput({
        whole: true,
        what: 'poster',
        content: { photos: true, attachments: false, sources: false },
        refine: () => {
            const poster = buildCurrentPoster(posterLook.look());
            return poster ? poolImagesChars(imageTextIds(poster.svg)) : 0;
        },
    });
}

function downloadBlob(content: string, type: string, filename: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function svgDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The preview of the fan poster's look: built after the choices settle (150 ms), in a URL of its own. */
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let previewUrl: string | null = null;
/** Each built preview's number: a build that a newer one overtook is dropped. */
let previewSeq = 0;

function dropPreview(): void {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    previewSeq++;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    for (const id of ['poster-look-img', 'poster-look-sum-img']) document.getElementById(id)?.removeAttribute('src');
}

/** The preview: the very poster the output builds (the same function and look), made small. */
async function drawPreview(): Promise<void> {
    previewTimer = null;
    const seq = ++previewSeq;
    if (!document.getElementById('poster-modal')?.classList.contains('active') || TreeRenderer.getViewMode() !== 'fan') return;
    const poster = await buildPosterOutput(posterLook.look());
    if (seq !== previewSeq) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = poster ? URL.createObjectURL(new Blob([poster.svg], { type: 'image/svg+xml' })) : null;
    for (const id of ['poster-look-img', 'poster-look-sum-img']) {
        const img = document.getElementById(id) as HTMLImageElement | null;
        if (!img) continue;
        if (previewUrl) img.src = previewUrl; else img.removeAttribute('src');
    }
}

function schedulePreview(delay = 150): void {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { void drawPreview(); }, delay);
}

/** The dialog's choices, its note and "As on screen", and the phone's folded row, as the poster's look stands. */
function renderPosterLook(): void {
    const box = document.getElementById('poster-look');
    if (!box || box.hidden) return;
    const look = posterLook.look();
    const changed = posterLook.own() !== null;
    const S = strings.fan;
    const value = (id: string, v: string) => {
        const el = document.getElementById(id) as HTMLSelectElement | null;
        if (el) el.value = v;
    };
    value('poster-look-style', look.style);
    value('poster-look-scope', look.rodScope);
    value('poster-look-content', look.content);
    // The family lines' scope only for the colours by family line (as in the Appearance panel).
    const rodOn = TreeRenderer.getFanColorMode() === 'rod';
    const scope = document.getElementById('poster-look-scope') as HTMLSelectElement | null;
    if (scope) {
        scope.disabled = !rodOn;
        if (rodOn) scope.removeAttribute('title'); else scope.title = S.scopeOff;
    }
    const portraits = document.getElementById('poster-look-portraits') as HTMLInputElement | null;
    if (portraits) portraits.checked = look.portraits;
    const reset = document.getElementById('poster-look-reset');
    if (reset) reset.hidden = !changed;
    // The phone's folded row: the choices in words.
    const styleName = { color: S.styleColor, pastel: S.stylePastel, antique: S.styleAntique, mono: S.styleMono }[look.style];
    const contentName = { years: S.contentYears, places: S.contentPlaces, names: S.contentNames }[look.content];
    const words = [styleName, ...(rodOn ? [look.rodScope === 'main' ? S.scopeMain : S.scopeAll] : []), contentName,
        ...(look.portraits ? [S.portraitsWord] : []), ...(changed ? [strings.poster.lookChanged] : [])];
    const desc = document.getElementById('poster-look-sum-desc');
    if (desc) desc.textContent = words.join(' · ');
}

/** The phone's folded row: open or closed (closed at each opening of the dialog). */
function foldPosterLook(open: boolean): void {
    const box = document.getElementById('poster-look');
    box?.classList.toggle('is-open', open);
    document.getElementById('poster-look-sum')?.setAttribute('aria-expanded', open ? 'true' : 'false');
    const arrow = document.getElementById('poster-look-sum-arrow');
    if (arrow) arrow.textContent = open ? '▾' : '▸';
}

export const exportImageMethods = uiModule({
    showPosterDialog(): void {
        this.closeMobileMenu();
        const layout = TreeRenderer.getPosterLayout();
        if (layout.positions.size === 0) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        // Close the launching export dialog and take over the dialog stack, so a
        // parent dialog can't be reopened on top of the poster (z-index bug).
        document.getElementById('export-modal')?.classList.remove('active');
        this.clearDialogStack();
        this.pushDialog('poster-modal');
        document.getElementById('poster-modal')?.classList.add('active');

        // Tell the user WHAT will print (the poster prints what you are looking
        // at), and disable the export buttons for views that cannot be printed
        // as a poster (map: foreign raster tiles; timeline: not yet supported).
        const info = posterViewInfo();
        const labelEl = document.getElementById('poster-view-label');
        if (labelEl) labelEl.textContent = info.line;
        // The poster lays out without the links shown only in the view: said under what it prints.
        this.renderViewLinksNote(labelEl);
        document.querySelectorAll<HTMLButtonElement>('#poster-modal .menu-option').forEach(btn => {
            btn.disabled = info.blocked;
            btn.classList.toggle('disabled', info.blocked);
        });
        // Spacing: only for the tree of cards (the fan and the timeline have their own layout).
        const spacingRow = document.getElementById('poster-spacing');
        if (spacingRow) spacingRow.hidden = !isTreePosterView(TreeRenderer.getViewMode());
        // The fan poster's own look (spec 118 §10): from the screen at each opening, only in the fan view.
        posterLook.reset();
        dropPreview();
        const lookBox = document.getElementById('poster-look');
        if (lookBox) lookBox.hidden = TreeRenderer.getViewMode() !== 'fan' || info.blocked;
        foldPosterLook(false);
        renderPosterLook();
        if (lookBox && !lookBox.hidden) schedulePreview(0);
        const current = SettingsManager.getPosterSpacing();
        document.querySelectorAll<HTMLInputElement>('input[name="poster-spacing"]').forEach(radio => {
            radio.checked = radio.value === current;
        });
        this.updatePosterSheets();
    },

    /**
     * A choice of the fan poster's look (spec 118 §10): for this output only,
     * the screen, the session and the default stay as they are.
     */
    setPosterLook(field: 'style' | 'rodScope' | 'content' | 'portraits', value: string | boolean): void {
        if (!posterLook.set({ [field]: value })) return;
        renderPosterLook();
        schedulePreview();
    },

    /** "As on screen": the poster's look is the screen's again. */
    resetPosterLook(): void {
        posterLook.reset();
        renderPosterLook();
        schedulePreview();
        // The link goes with the change: the focus to the first choice.
        document.getElementById('poster-look-style')?.focus({ preventScroll: true });
    },

    /** The phone's folded "Poster appearance" row: a tap unfolds the preview and the choices. */
    togglePosterLook(): void {
        foldPosterLook(!document.getElementById('poster-look')?.classList.contains('is-open'));
    },

    /** The export's spacing (spec 069 §4): remembered on this device at once; the screen stays as it is. */
    setPosterSpacing(spacing: string): void {
        SettingsManager.setPosterSpacing(spacing === 'dense' ? 'dense' : 'normal');
    },

    /**
     * Under each spacing the sheets its poster prints on in the chosen format
     * and orientation (the guide page's count); none when both print on as many.
     */
    updatePosterSheets(): void {
        // The privacy mode changes the fan poster's names: its preview follows.
        if (!document.getElementById('poster-look')?.hidden && previewUrl) schedulePreview();
        const labels = document.querySelectorAll<HTMLElement>('#poster-spacing .poster-sheets');
        const mode = TreeRenderer.getViewMode();
        const counts = new Map<TreeSpacing, number>();
        if (isTreePosterView(mode)) {
            const meta = posterFooterMeta(mode, applyLivingPrivacy(DataManager.getData(), posterPrivacyMode()));
            const { format, orientation } = posterPaper();
            for (const spacing of ['normal', 'dense'] as const) {
                const geom = treePosterGeometry(spacing, meta);
                if (geom) counts.set(spacing, sheetPlan(geom, format, orientation).printedSheets);
            }
        }
        const differ = counts.size === 2 && counts.get('normal') !== counts.get('dense');
        const format = posterPaper().format;
        labels.forEach(el => {
            const n = counts.get(el.dataset.spacing as TreeSpacing);
            el.hidden = !differ || n === undefined;
            el.textContent = differ && n !== undefined ? strings.poster.sheetsCount(n, format) : '';
        });
    },

    closePosterDialog(): void {
        dropPreview();
        document.getElementById('poster-modal')?.classList.remove('active');
        this.clearDialogStack();
    },

    /** Download the current view as a self-contained SVG (built under its button's working state, §8). */
    async exportPosterSvg(): Promise<void> {
        // The tree's photos still on their way: the file waits for them (spec 116 §8).
        const el = activatedElement();
        if (await imagesBeforeOutput(strings.photos.out.svg, { el }) === 'cancelled') return;
        if (await posterMemory() === 'cancel') return;
        await posterBusy(async () => {
            const poster = await buildPosterOutput(posterLook.look());
            if (!poster) {
                this.showAlert(strings.poster.empty, 'warning');
                return;
            }
            downloadBlob(poster.svg, 'image/svg+xml', posterFilename('svg'));
            this.closePosterDialog();
        }, el);
    },

    /** Rasterize the current view to a 2x PNG (scaled down to the canvas limit, none when unreadable so: posterPngScales), under its button's working state (§8). */
    async exportPosterPng(): Promise<void> {
        const el = activatedElement();
        if (await imagesBeforeOutput(strings.photos.out.png, { el }) === 'cancelled') return;
        if (await posterMemory() === 'cancel') return;
        await posterBusy(async () => {
            const poster = await buildPosterOutput(posterLook.look());
            if (!poster) {
                this.showAlert(strings.poster.empty, 'warning');
                return;
            }
            try {
                // Too large even scaled down to a readable size, or no canvas holds it: no PNG (an empty
                // file before, N3); the dialog stays open with SVG and Print / PDF.
                const png = await svgToPngDataUrl(poster.svg, poster.widthPx, poster.heightPx);
                if (!png) {
                    void this.showAlert(strings.poster.pngTooLarge, 'warning');
                    return;
                }
                const { dataUrl, scale } = png;
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = posterFilename('png');
                a.click();

                if (scale < PNG_SCALE) {
                    this.showToast(strings.poster.pngScaledDown);
                }
                this.closePosterDialog();
            } catch (e) {
                console.error('PNG export failed:', e);
                this.showAlert(strings.poster.pngError, 'error');
            }
        }, el);
    },

    /**
     * Open the browser print dialog with the tree tiled across pages of the
     * chosen paper size/orientation, with a 10mm overlap and glue/crop marks.
     */
    async printPosterPdf(): Promise<void> {
        // The tree's photos still on their way: the print waits for them, its row says so (spec 116 §8, 8a).
        if (await imagesBeforeOutput(strings.photos.out.poster) === 'cancelled') return;
        if (await posterMemory() === 'cancel') return;
        const poster = await buildPosterOutput(posterLook.look());
        if (!poster) {
            this.showAlert(strings.poster.empty, 'warning');
            return;
        }
        const svg = poster.svg;
        const { format, orientation } = posterPaper();
        const {
            contentW, contentH, stepX, stepY, posterWmm, posterHmm, rows, cols, printedSheets, tileHasContent,
        } = sheetPlan(poster, format, orientation);

        const dataUrl = svgDataUrl(svg);
        const pages: string[] = [];

        // Optional first page: the whole poster in miniature with the sheet
        // grid + labels overlaid, so the person gluing knows what goes where.

        const wantGuide = (document.getElementById('poster-guide-page') as HTMLInputElement | null)?.checked ?? true;
        if (wantGuide && rows * cols > 1) {
            const gs = Math.min((contentW - 4) / posterWmm, (contentH - 30) / posterHmm);
            const gw = posterWmm * gs;
            const gh = posterHmm * gs;
            const cells: string[] = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // Each sheet covers [off, off+content], clipped to the poster.
                    const x = c * stepX * gs;
                    const y = r * stepY * gs;
                    const w = Math.min(contentW, posterWmm - c * stepX) * gs;
                    const h = Math.min(contentH, posterHmm - r * stepY) * gs;
                    const empty = !tileHasContent(c * stepX, r * stepY);
                    const label = empty ? strings.poster.emptySheet : strings.poster.pageLabel(r + 1, c + 1);
                    cells.push(`<div class="poster-guide-cell${empty ? ' skip' : ''}" style="left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm;width:${w.toFixed(2)}mm;height:${h.toFixed(2)}mm;"><span>${label}</span></div>`);
                }
            }
            pages.push(`
                <div class="poster-page poster-guide">
                    <div class="poster-guide-head">
                        <strong>${strings.poster.guideTitle}</strong>
                        <span>${strings.poster.guideInfo(printedSheets, rows, cols, PAGE_OVERLAP_MM)}</span>
                    </div>
                    <div class="poster-guide-map" style="width:${gw.toFixed(2)}mm;height:${gh.toFixed(2)}mm;">
                        <img src="${dataUrl}" style="width:${gw.toFixed(2)}mm;height:${gh.toFixed(2)}mm;">
                        ${cells.join('')}
                    </div>
                </div>`);
        }

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const offX = c * stepX;
                const offY = r * stepY;
                if (!tileHasContent(offX, offY)) continue;   // blank sheet — skip
                pages.push(`
                    <div class="poster-page">
                        <div class="poster-page-clip" style="width:${contentW}mm;height:${contentH}mm;">
                            <img src="${dataUrl}" style="width:${posterWmm}mm;height:${posterHmm}mm;margin-left:-${offX}mm;margin-top:-${offY}mm;">
                        </div>
                        <div class="poster-mark tl"></div><div class="poster-mark tr"></div>
                        <div class="poster-mark bl"></div><div class="poster-mark br"></div>
                        <div class="poster-page-label">${strings.poster.pageLabel(r + 1, c + 1)}</div>
                    </div>`);
            }
        }

        const style = `
            @page { size: ${format} ${orientation}; margin: ${PAGE_MARGIN_MM}mm; }
            body.poster-printing > *:not(#poster-print) { display: none !important; }
            #poster-print { display: block !important; }
            .poster-print { font-family: sans-serif; }
            .poster-page { position: relative; width: ${contentW}mm; height: ${contentH}mm; page-break-after: always; overflow: hidden; }
            .poster-page:last-child { page-break-after: auto; }
            .poster-page-clip { overflow: hidden; position: relative; }
            .poster-mark { position: absolute; width: 6mm; height: 6mm; border: 0.2mm solid #000; }
            .poster-mark.tl { top: 0; left: 0; border-right: none; border-bottom: none; }
            .poster-mark.tr { top: 0; right: 0; border-left: none; border-bottom: none; }
            .poster-mark.bl { bottom: 0; left: 0; border-right: none; border-top: none; }
            .poster-mark.br { bottom: 0; right: 0; border-left: none; border-top: none; }
            .poster-page-label { position: absolute; bottom: 1mm; right: 2mm; font-size: 8pt; color: #666; }
            .poster-guide-head { display: flex; flex-direction: column; gap: 1mm; margin-bottom: 4mm; font-size: 11pt; }
            .poster-guide-head span { font-size: 9pt; color: #555; }
            .poster-guide-map { position: relative; margin: 0 auto; border: 0.3mm solid #bbb; }
            .poster-guide-map img { display: block; }
            .poster-guide-cell {
                position: absolute; box-sizing: border-box;
                border: 0.3mm dashed #c0392b;
                display: flex; align-items: center; justify-content: center;
            }
            .poster-guide-cell span {
                font-size: 9pt; color: #c0392b; background: rgba(255,255,255,0.75);
                padding: 0.5mm 1.5mm; border-radius: 1mm;
            }
            .poster-guide-cell.skip { border-color: #bbb; background: rgba(200,200,200,0.25); }
            .poster-guide-cell.skip span { color: #888; }
        `;

        let container = document.getElementById('poster-print');
        if (container) container.remove();
        container = document.createElement('div');
        container.id = 'poster-print';
        container.className = 'poster-print';
        const styleEl = document.createElement('style');
        styleEl.id = 'poster-print-style';
        styleEl.media = 'print';
        styleEl.textContent = style;
        container.innerHTML = pages.join('');
        document.body.appendChild(container);
        document.head.appendChild(styleEl);
        document.body.classList.add('poster-printing');

        const cleanup = () => {
            container?.remove();
            styleEl.remove();
            document.body.classList.remove('poster-printing');
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        this.closePosterDialog();

        // Print ONLY after the tile images are decoded: Chrome snapshots the
        // page the moment print() is called, and firing it synchronously
        // produced print previews full of EMPTY pages (the SVG data URLs had
        // not finished decoding yet — reported live). All tiles share one
        // src, so decoding the first is enough; a timeout guards pathological
        // cases so the dialog always appears.
        const firstImg = container.querySelector('img');
        const ready = firstImg
            ? Promise.race([
                firstImg.decode().catch(() => undefined),
                new Promise<void>(resolve => setTimeout(resolve, 3000)),
            ])
            : Promise.resolve();
        void ready.then(() => window.print());
    },
});

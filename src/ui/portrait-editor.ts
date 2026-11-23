/**
 * The portrait editor (spec 107 §1, §3, §7, §9, §10): a fixed frame in the
 * card photo's shape (Settings › Person card) over a photo that moves.
 * Drag (mouse, one finger) moves the photo, the wheel and two fingers zoom
 * about the pointer, a double click returns to the default crop; turns by
 * 90°, straightening within ±45° (with a grid), mirroring. A live preview of
 * the card, the person page's square and the family pages' 4 : 5 is drawn
 * from the same matrix as the saved portrait (src/photo.ts).
 *
 * One step is one portrait (a new file, an attachment, the portrait itself
 * when there is no original: `squareOnly`); two steps are the partners of a
 * couple cut from its photo (steps in the header, Skip, Keep / Replace for a
 * partner who already has a portrait). The overlay's skeleton, the decoding
 * and the keys in the capture phase are the crop editor's
 * (src/ui/crop-editor.ts). The pure parts (steps, footer, the frame's place,
 * K1.5's identity) are src/portrait-editor-model.ts.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { Person, PortraitCrop } from '../types.js';
import {
    PHOTO_SIZE, PHOTO_QUALITY, compressPhoto, PortraitView, AffineMatrix,
    panPortraitView, zoomPortraitView, straightenPortraitView, turnPortraitView, mirrorPortraitView,
    portraitViewMatrix, portraitOutputMatrix, portraitZoomRange, defaultPortraitView, portraitCropFromView,
    portraitPageMatrix, invertMatrix, applyMatrix, portraitScale, portraitPageSize,
    PORTRAIT_MAX_ANGLE, PORTRAIT_ANGLE_STEP, PORTRAIT_EMPTY_FILL,
} from '../photo.js';
import { ATTACHMENT_MAX_SIDE, ATTACHMENT_QUALITY } from '../attachments.js';
import { decodeImage, renderRotated, cropToJpeg, WORK_MAX_SIDE, createEditorOverlay, bindEditorKeys } from './crop-editor.js';
import { SettingsManager } from '../settings.js';
import { shownName } from '../person-name.js';
import { cardYears } from '../card-fields.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import {
    PortraitStepState, PortraitLayout, initialPortraitSteps, portraitFooter, portraitStepCrop, finishPortraitStep,
    skipPortraitStep, portraitStepShownSkipped, isIdentityPortrait, isSmallPortrait, portraitFrameGeometry,
    formatPortraitAngle,
} from '../portrait-editor-model.js';

export interface PortraitEditorStep {
    /** Whose portrait: the card preview, the name in the header or the step. */
    person: Person;
    /** The opening crop; default the centred square (a couple: the left / right half, §7). */
    initial?: PortraitCrop;
    /** Today's portrait (one step: "Done replaces it" with Current → New; a couple: Keep / Replace). */
    current?: string;
}

export interface PortraitEditorInput {
    /** A new file, the data URL of an attachment or a couple's photo, or the portrait itself (squareOnly). */
    source: Blob | string;
    /** One step = one portrait; two = the partners of a couple. */
    steps: PortraitEditorStep[];
    /** No original (§2): only within the finished square. */
    squareOnly?: boolean;
    /** Default strings.portrait.title (one person) / twoTitle (a couple). */
    title?: string;
    /**
     * Portraits of a couple's partners (§7): the steps in the header, Skip,
     * Keep / Replace; one step then says the other partner is unknown.
     * Default: more than one step.
     */
    couple?: boolean;
    /**
     * squareOnly: "Choose the photo again…" under the note; a click closes the
     * editor (it resolves null) and calls this right away, still inside the
     * click, so the caller can open its file input.
     */
    onChooseAgain?: () => void;
}

export interface PortraitEditorResult {
    /** Per step: the portrait (256 px JPEG) and its crop, or null when skipped or kept. */
    steps: ({ photo: string; crop: PortraitCrop } | null)[];
    /** A new file: the whole photo, long side ≤ 1600 px JPEG, upright as decoded (no turn, no mirror). */
    original?: string;
}

/** Zoom buttons and keys: 10 % a step; the wheel 15 % (as the crop editor). */
const ZOOM_STEP = 1.1;
const WHEEL_STEP = 1.15;
/** The screen reader hears the zoom and the angle once they settle. */
const LIVE_DELAY_MS = 300;
/** A second tap within this time and distance is a double tap (the default crop). */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The layout for the window now (§9). */
function currentLayout(): PortraitLayout {
    if (window.matchMedia(MQ_PHONE_LANDSCAPE).matches) return 'land';
    if (window.matchMedia(MQ_MOBILE).matches) return 'phone';
    return 'wide';
}

/**
 * Open the portrait editor over everything else. Resolves with the portraits
 * (Done) or null (Cancel, Escape, ×, Choose again). Rejects when the image
 * cannot be decoded — the editor is then not shown.
 */
export async function openPortraitEditor(input: PortraitEditorInput): Promise<PortraitEditorResult | null> {
    const bitmap = await decodeImage(input.source);
    const W = bitmap.width, H = bitmap.height;
    // What the stage and the preview draw (the original up to WORK_MAX_SIDE); Done draws the original itself.
    const work: CanvasImageSource & { width: number; height: number } =
        Math.max(W, H) > WORK_MAX_SIDE ? renderRotated(bitmap, 0, WORK_MAX_SIDE) : bitmap;
    const couple = input.couple ?? input.steps.length > 1;
    const squareOnly = input.squareOnly === true;
    const fromFile = typeof input.source !== 'string';
    const P = strings.portrait;
    const lang = getCurrentLanguage();
    const cardPhoto = SettingsManager.getCardPhoto();
    const opener = document.activeElement as HTMLElement | null;

    let states: PortraitStepState[] = initialPortraitSteps({ steps: input.steps, couple }, W, H);
    // "Default" (the button, 0, a double click) goes back to the step's opening crop: a couple's partner keeps their half.
    const openingViews = states.map(s => s.view);
    let index = 0;
    let layout: PortraitLayout = currentLayout();
    let phoneSlider: 'zoom' | 'straighten' = 'zoom';
    // Closes the editor; set once the promise exists ("Choose again" in the panel reaches it through here).
    let finish: (result: PortraitEditorResult | null) => void = () => {};
    const title = input.title ?? (couple ? P.twoTitle : P.title);

    const sizeLabel = { small: strings.cardDensity.photoSmall, medium: strings.cardDensity.photoMedium, large: strings.cardDensity.photoLarge }[cardPhoto.size];
    // A 6 × 6 grid: the thirds stronger.
    const gridHtml = [1, 2, 3, 4, 5].map(i => {
        const third = i % 2 === 0 ? ' is-third' : '';
        const at = `${(i * 100) / 6}%`;
        return `<span class="pe-gl-v${third}" style="left:${at}"></span><span class="pe-gl-h${third}" style="top:${at}"></span>`;
    }).join('');

    const stepsHtml = couple ? input.steps.map((s, i) => `
        <button type="button" class="sel-tab pe-step" role="tab" data-step="${i}">
            <span class="pe-step-num" aria-hidden="true">${i + 1}</span>
            <span class="pe-step-name">${esc(shownName(s.person))}</span>
            <span class="pe-step-skipped" hidden>${esc(P.skipped)}</span>
        </button>`).join('') : '';

    const overlay = createEditorOverlay('pe-title', `
        <div class="crop-dialog pe-dialog">
            <div class="crop-toolbar pe-head">
                <h2 id="pe-title">${esc(title)}</h2>
                ${couple ? '<span class="pe-sep" aria-hidden="true"></span>' : '<span class="pe-who"></span>'}
                ${couple ? `<div class="pe-steps" role="tablist">${stepsHtml}</div>` : ''}
                <span class="pe-fill"></span>
                <button type="button" class="pe-close close-btn" aria-label="${esc(strings.buttons.close)}">&times;</button>
            </div>
            <div class="pe-steps-bar"></div>
            <div class="crop-stage pe-stage">
                <canvas class="pe-canvas" aria-hidden="true"></canvas>
                <div class="pe-other" hidden><span class="pe-other-label"></span></div>
                <div class="pe-frame" tabindex="0" role="application" aria-label="${esc(P.frameAria)}">
                    <div class="pe-shape"></div>
                    <div class="pe-grid" hidden>${gridHtml}</div>
                </div>
                <div class="pe-keep-label" hidden>${esc(P.keepStage)}</div>
                <div class="pe-bar"></div>
            </div>
            <div class="pe-panel">
                <section class="pe-sec pe-preview">
                    <h3 class="pe-sec-title">${esc(P.preview)}</h3>
                    <div class="card-signals-preview pe-card-box">
                        <div class="person-card preview-card has-photo" data-density="normal" data-photo="${cardPhoto.size}" data-shape="${cardPhoto.shape}">
                            <div class="card-avatar-wrap"><div class="card-avatar"><canvas class="pe-live-canvas pe-av" width="${PHOTO_SIZE}" height="${PHOTO_SIZE}"></canvas><img class="pe-av-current" alt="" hidden></div></div>
                            <div class="card-body">
                                <div class="name"><span class="name-text"></span></div>
                                <div class="birth-date"><span class="meta-text"></span></div>
                            </div>
                        </div>
                    </div>
                    <div class="pe-cap">${esc(P.onCard(sizeLabel))}</div>
                    <div class="pe-squares">
                        <figure><canvas class="pe-live-canvas pe-sq64" width="128" height="128"></canvas><figcaption>${esc(P.personPage)}</figcaption></figure>
                        <figure><canvas class="pe-live-canvas pe-sq45" width="104" height="130"></canvas><figcaption>${esc(P.familyPages)}</figcaption></figure>
                    </div>
                    <p class="pe-saved">${esc(cardPhoto.shape === 'rounded' ? P.savedRounded : P.savedCircle)}</p>
                </section>
                <div class="pe-choice" hidden></div>
                <div class="pe-notes"></div>
                <div class="sel-seg pe-seg">
                    <button type="button" class="sel-opt" data-sel-form="seg" data-slider="zoom" aria-pressed="true">${esc(P.zoom)}</button>
                    <button type="button" class="sel-opt" data-sel-form="seg" data-slider="straighten" aria-pressed="false">${esc(P.straighten)}</button>
                </div>
                <div class="pe-slot"></div>
                <section class="pe-sec pe-rotate"><h3 class="pe-sec-title">${esc(P.rotate)}</h3></section>
                <section class="pe-sec pe-straight"><h3 class="pe-sec-title">${esc(P.straighten)}</h3></section>
                <div class="pe-actions"></div>
            </div>
            <div class="crop-footer pe-foot">
                <span class="pe-keys">${esc(P.keys)}</span>
                <div class="pe-buttons"></div>
            </div>
        </div>
        <div class="pe-live" aria-live="polite"></div>`, 'pe-overlay');

    const q = <T extends HTMLElement>(sel: string): T => overlay.querySelector<T>(sel)!;
    const dialog = q<HTMLDivElement>('.pe-dialog');
    const head = q<HTMLDivElement>('.pe-head');
    const h2 = q<HTMLHeadingElement>('#pe-title');
    const stepsBar = q<HTMLDivElement>('.pe-steps-bar');
    const stepsEl = overlay.querySelector<HTMLDivElement>('.pe-steps');
    const fill = q<HTMLSpanElement>('.pe-fill');
    const closeBtn = q<HTMLButtonElement>('.pe-close');
    const stage = q<HTMLDivElement>('.pe-stage');
    const canvas = q<HTMLCanvasElement>('.pe-canvas');
    const frame = q<HTMLDivElement>('.pe-frame');
    const shape = q<HTMLDivElement>('.pe-shape');
    const grid = q<HTMLDivElement>('.pe-grid');
    const other = q<HTMLDivElement>('.pe-other');
    const keepLabel = q<HTMLDivElement>('.pe-keep-label');
    const bar = q<HTMLDivElement>('.pe-bar');
    const panel = q<HTMLDivElement>('.pe-panel');
    const choice = q<HTMLDivElement>('.pe-choice');
    const notes = q<HTMLDivElement>('.pe-notes');
    const seg = q<HTMLDivElement>('.pe-seg');
    const slot = q<HTMLDivElement>('.pe-slot');
    const rotateSec = q<HTMLElement>('.pe-rotate');
    const straightSec = q<HTMLElement>('.pe-straight');
    const actions = q<HTMLDivElement>('.pe-actions');
    const footButtons = q<HTMLDivElement>('.pe-buttons');
    const live = q<HTMLDivElement>('.pe-live');
    const avCanvas = q<HTMLCanvasElement>('.pe-av');
    const avCurrent = q<HTMLImageElement>('.pe-av-current');
    const cardEl = q<HTMLDivElement>('.pe-card-box .person-card');

    // ---------- the controls (one of each, put where the layout wants them) ----------
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] => {
        const el = document.createElement(tag);
        el.className = cls;
        if (html) el.innerHTML = html;
        return el;
    };
    const iconBtn = (cls: string, glyph: string, label: string): HTMLButtonElement => {
        const b = make('button', `pe-icon ${cls}`, glyph);
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        return b;
    };
    const zoomRow = make('div', 'pe-zoom');
    const zoomOut = iconBtn('pe-zoom-out', '−', strings.crop.zoomOut);
    const zoomIn = iconBtn('pe-zoom-in', '+', strings.crop.zoomIn);
    const zoomRange = make('input', 'pe-zoom-range');
    zoomRange.type = 'range';
    zoomRange.setAttribute('aria-label', P.zoom);
    const pct = make('span', 'pe-pct');
    zoomRow.append(zoomOut, zoomRange, zoomIn, pct);
    const barDivider = make('span', 'pe-bar-div');
    const resetBtn = make('button', 'pe-icon pe-reset', esc(P.reset));
    resetBtn.type = 'button';

    const angleRow = make('div', 'pe-angle');
    const angleRange = make('input', 'pe-angle-range');
    angleRange.type = 'range';
    angleRange.min = String(-PORTRAIT_MAX_ANGLE);
    angleRange.max = String(PORTRAIT_MAX_ANGLE);
    angleRange.step = String(PORTRAIT_ANGLE_STEP);
    angleRange.setAttribute('aria-label', P.straighten);
    const deg = make('span', 'pe-deg');
    angleRow.append(angleRange, deg);
    const straightHint = make('p', 'pe-hint', esc(P.straightenHint));

    const rotRow = make('div', 'pe-row pe-rot-row');
    const rotL = iconBtn('pe-rot-l', '↺', strings.crop.rotateLeft);
    const rotR = iconBtn('pe-rot-r', '↻', strings.crop.rotateRight);
    const mirrorBtn = make('button', 'pe-icon pe-mirror');
    mirrorBtn.type = 'button';
    mirrorBtn.title = P.mirror;
    mirrorBtn.innerHTML = `<span aria-hidden="true">⇋</span> <span class="pe-mirror-label">${esc(P.mirror)}</span>`;
    rotRow.append(rotL, rotR, mirrorBtn);

    const cancelBtn = make('button', 'pe-cancel', esc(strings.buttons.cancel));
    cancelBtn.type = 'button';
    const skipBtn = make('button', 'secondary pe-skip', esc(P.skip));
    skipBtn.type = 'button';
    const primaryBtn = make('button', 'primary pe-primary');
    primaryBtn.type = 'button';

    // ---------- geometry ----------
    const coarse = (): boolean => window.matchMedia('(pointer: coarse)').matches;
    let geo = { side: 200, cx: 100, cy: 100 };
    let stageW = 0, stageH = 0;
    const view = (): PortraitView => states[index].view;
    const keepOn = (): boolean => states[index].keep === true;

    const measure = (): void => {
        stageW = stage.clientWidth;
        stageH = stage.clientHeight;
        geo = portraitFrameGeometry(layout, stageW, stageH, coarse() ? 64 : 56);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(stageW * dpr));
        canvas.height = Math.max(1, Math.round(stageH * dpr));
        const F = geo.side;
        frame.style.left = `${geo.cx - F / 2}px`;
        frame.style.top = `${geo.cy - F / 2}px`;
        frame.style.width = `${F}px`;
        frame.style.height = `${F}px`;
        // The card's rounded square: 12 px of an 80 px avatar (0.15 of the side).
        shape.style.borderRadius = cardPhoto.shape === 'rounded' ? `${Math.round(F * 0.15)}px` : '50%';
        keepLabel.style.left = `${geo.cx - F / 2 + 24}px`;
        keepLabel.style.width = `${Math.max(60, F - 48)}px`;
        keepLabel.style.top = `${geo.cy + F / 2 - 84}px`;
    };

    /** The original's pixels onto the stage (CSS px), the frame's square at `geo`. */
    const stageMatrix = (v: PortraitView): AffineMatrix => {
        const m = portraitViewMatrix(v, W, H, geo.side);
        return [m[0], m[1], m[2], m[3], m[4] + geo.cx - geo.side / 2, m[5] + geo.cy - geo.side / 2];
    };

    // The portrait as Done would save it (from the working copy), redrawn once a frame.
    const out = document.createElement('canvas');
    out.width = PHOTO_SIZE;
    out.height = PHOTO_SIZE;
    const drawPortrait = (target: HTMLCanvasElement, v: PortraitView, src: CanvasImageSource): void => {
        const ctx = target.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // The frame off the photo's edge: the neutral fill (as Done bakes it).
        ctx.fillStyle = PORTRAIT_EMPTY_FILL;
        ctx.fillRect(0, 0, target.width, target.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.setTransform(...portraitViewMatrix(v, W, H, target.width));
        // JPEG has no alpha: a transparent PNG is saved on white (§10).
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(src, 0, 0, W, H);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const drawStage = (): void => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // The frame's square off the photo's edge shows what the portrait
        // will hold there (the neutral fill); the stage around it stays.
        ctx.fillStyle = PORTRAIT_EMPTY_FILL;
        ctx.fillRect((geo.cx - geo.side / 2) * dpr, (geo.cy - geo.side / 2) * dpr, geo.side * dpr, geo.side * dpr);
        const m = stageMatrix(view());
        ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(work, 0, 0, W, H);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    /** The other partner's frame, dashed, once that step has been shown (§7). */
    const drawOther = (): void => {
        const j = index === 0 ? 1 : 0;
        const o = couple ? states[j] : undefined;
        if (!o || states.length < 2 || !o.visited || o.status === 'skipped' || o.keep === true) { other.hidden = true; return; }
        const ov = o.view;
        const toPage = portraitPageMatrix(W, H, ov.quarterTurns, ov.mirror);
        const back = invertMatrix(toPage);
        if (!back) { other.hidden = true; return; }
        const orig = applyMatrix(back, ov.cx, ov.cy);
        const pt = applyMatrix(stageMatrix(view()), orig.x, orig.y);
        const page = portraitPageSize(W, H, ov.quarterTurns);
        const side = (Math.min(page.width, page.height) / ov.zoom) * portraitScale(view(), W, H, geo.side);
        const left = pt.x - side / 2, top = pt.y - side / 2;
        if (left + side < 0 || top + side < 0 || left > stageW || top > stageH) { other.hidden = true; return; }
        other.hidden = false;
        other.style.left = `${left}px`;
        other.style.top = `${top}px`;
        other.style.width = `${side}px`;
        other.style.height = `${side}px`;
        other.style.borderRadius = cardPhoto.shape === 'rounded' ? `${Math.round(side * 0.15)}px` : '50%';
        q<HTMLSpanElement>('.pe-other-label').textContent = shownName(input.steps[j].person);
    };

    const drawPreviews = (): void => {
        drawPortrait(out, view(), work);
        overlay.querySelectorAll<HTMLCanvasElement>('.pe-live-canvas').forEach(c => {
            const ctx = c.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.imageSmoothingQuality = 'high';
            // A 4 : 5 box (family pages) shows the square cut at its sides.
            const s = Math.max(c.width, c.height);
            ctx.drawImage(out, (c.width - s) / 2, (c.height - s) / 2, s, s);
        });
    };

    // ---------- the screen reader ----------
    let liveTimer: number | undefined;
    const announce = (text: string): void => {
        window.clearTimeout(liveTimer);
        liveTimer = window.setTimeout(() => { live.textContent = text; }, LIVE_DELAY_MS);
    };

    /** The controls' values from the view (sliders, %, °, Mirror). */
    const syncControls = (): void => {
        const v = view();
        const range = portraitZoomRange(W, H, v.angle);
        zoomRange.min = String(Math.round(range.min * 100));
        zoomRange.max = String(Math.round(range.max * 100));
        zoomRange.step = '1';
        const p = Math.round(v.zoom * 100);
        zoomRange.value = String(p);
        zoomRange.setAttribute('aria-valuetext', `${p} %`);
        pct.textContent = `${p} %`;
        angleRange.value = String(v.angle);
        const a = formatPortraitAngle(v.angle, lang);
        angleRange.setAttribute('aria-valuetext', a);
        deg.textContent = a;
        mirrorBtn.setAttribute('aria-pressed', String(v.mirror));
        const keep = keepOn();
        for (const el of [zoomOut, zoomIn, zoomRange, resetBtn, angleRange, rotL, rotR, mirrorBtn]) el.disabled = keep;
        stage.classList.toggle('is-keep', keep);
        keepLabel.hidden = !keep;
        avCanvas.hidden = keep;
        avCurrent.hidden = !keep;
        if (keep) avCurrent.src = input.steps[index].current ?? '';
        // The small-photo note follows the zoom.
        const smallNote = notes.querySelector<HTMLElement>('.pe-note-small');
        if (smallNote) smallNote.hidden = squareOnly || keep || !isSmallPortrait(portraitCropFromView(v, W, H), W, H);
    };

    let frameReq = 0;
    const draw = (): void => {
        syncControls();
        if (frameReq) return;
        frameReq = requestAnimationFrame(() => {
            frameReq = 0;
            drawStage();
            drawOther();
            drawPreviews();
        });
    };

    const setView = (v: PortraitView, say?: 'zoom' | 'angle'): void => {
        if (keepOn()) return;
        states = states.map((s, i) => i === index ? { ...s, view: v } : s);
        draw();
        if (say === 'zoom') announce(P.liveZoom(Math.round(v.zoom * 100)));
        if (say === 'angle') announce(P.liveAngle(formatPortraitAngle(v.angle, lang)));
    };
    const zoomTo = (z: number, anchor?: { x: number; y: number }): void =>
        setView(zoomPortraitView(view(), z, W, H, anchor ? { ...anchor, framePx: geo.side } : undefined), 'zoom');
    const reset = (): void => setView(openingViews[index] ?? defaultPortraitView(W, H), 'zoom');
    const turn = (d: 1 | -1): void => setView(turnPortraitView(view(), d, W, H));
    const straighten = (a: number): void => setView(straightenPortraitView(view(), a, W, H), 'angle');

    /** A name too long for one row goes on rows at the smaller size, as the tree's Normal card shows it whole (T40, 10h). */
    const fitPreviewName = (): void => {
        const nameText = q<HTMLSpanElement>('.pe-card-box .name-text');
        const nameEl = nameText.parentElement!;
        nameEl.classList.remove('pe-name-rows');
        nameText.style.whiteSpace = 'nowrap';
        if (nameText.clientWidth > 0 && nameText.scrollWidth > nameText.clientWidth + 1) nameEl.classList.add('pe-name-rows');
        nameText.style.whiteSpace = '';
    };
    // Measured in the fallback font before the card fonts are in: once more when they are.
    void document.fonts?.ready.then(() => { if (overlay.isConnected) fitPreviewName(); });

    // ---------- the step's panel: who, Keep / Replace, notes ----------
    const renderStep = (): void => {
        const step = input.steps[index];
        const st = states[index];
        const who = overlay.querySelector<HTMLSpanElement>('.pe-who');
        if (who) who.textContent = `· ${shownName(step.person)}`;
        cardEl.classList.remove('male', 'female', 'unknown');
        cardEl.classList.add(step.person.gender === 'male' || step.person.gender === 'female' ? step.person.gender : 'unknown');
        q<HTMLSpanElement>('.pe-card-box .name-text').textContent = shownName(step.person);
        fitPreviewName();
        const years = cardYears(step.person);
        const meta = q<HTMLSpanElement>('.pe-card-box .meta-text');
        meta.textContent = years;
        meta.parentElement!.hidden = !years;
        stepsEl?.querySelectorAll<HTMLButtonElement>('.pe-step').forEach((b, i) => {
            const s = states[i];
            const on = i === index;
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
            b.setAttribute('aria-label', P.stepAria(i + 1, states.length, shownName(input.steps[i].person)));
            const skipped = portraitStepShownSkipped(s);
            b.querySelector<HTMLElement>('.pe-step-num')!.textContent = !on && s.status === 'done' && !skipped ? '✓' : String(i + 1);
            b.querySelector<HTMLElement>('.pe-step-skipped')!.hidden = !skipped;
        });

        // Keep / Replace: a couple's partner who has a portrait (§7).
        choice.hidden = st.keep === null;
        if (st.keep !== null) {
            const tile = (keep: boolean, titleText: string, sub: string, thumb: string) => `
                <button type="button" class="sel-opt pe-tile" data-sel-form="tile" role="radio" aria-checked="${st.keep === keep}" data-keep="${keep ? 1 : 0}">
                    <span class="pe-radio" aria-hidden="true"></span>
                    <span class="pe-tile-text"><span class="pe-tile-title">${esc(titleText)}</span><span class="pe-tile-sub">${esc(sub)}</span></span>
                    ${thumb}
                </button>`;
            choice.innerHTML = `
                <div class="pe-choice-title">${esc(P.hasPortrait(shownName(step.person)))}</div>
                <div class="pe-tiles" role="radiogroup" aria-label="${esc(P.hasPortrait(shownName(step.person)))}">
                    ${tile(true, P.keep, P.keepSub, `<img class="pe-thumb" src="${esc(step.current ?? '')}" alt="">`)}
                    ${tile(false, P.replace, P.replaceSub, `<canvas class="pe-thumb pe-live-canvas" width="72" height="72"></canvas>`)}
                </div>`;
            choice.querySelectorAll<HTMLButtonElement>('.pe-tile').forEach(b => b.addEventListener('click', () => {
                const keep = b.dataset.keep === '1';
                states = states.map((s, i) => i === index ? { ...s, keep } : s);
                renderStep();
                choice.querySelector<HTMLButtonElement>(`.pe-tile[data-keep="${keep ? 1 : 0}"]`)?.focus();
            }));
        } else {
            choice.innerHTML = '';
        }

        // The notes (§2, §4, §7, §10).
        const parts: string[] = [];
        if (!couple && step.current) {
            parts.push(`<div class="pe-note pe-note-replace"><span>${esc(P.replaceNote)}</span>
                <div class="pe-pair">
                    <figure><img class="pe-thumb44" src="${esc(step.current)}" alt=""><figcaption>${esc(P.current)}</figcaption></figure>
                    <span class="pe-arrow" aria-hidden="true">→</span>
                    <figure><canvas class="pe-thumb44 pe-live-canvas" width="88" height="88"></canvas><figcaption>${esc(P.newOne)}</figcaption></figure>
                </div></div>`);
        }
        if (squareOnly) {
            parts.push(`<div class="pe-note pe-note-original"><span>${esc(P.noOriginal)}</span>${input.onChooseAgain
                ? `<button type="button" class="link-button pe-choose-again">${esc(P.chooseAgain)}</button>` : ''}</div>`);
        }
        if (!squareOnly) parts.push(`<div class="pe-note is-warn pe-note-small" hidden>${esc(P.small)}</div>`);
        if (couple && input.steps.length === 1) parts.push(`<div class="pe-note pe-note-single">${esc(P.single)}</div>`);
        notes.innerHTML = parts.join('');
        notes.hidden = parts.length === 0;
        notes.querySelector<HTMLButtonElement>('.pe-choose-again')?.addEventListener('click', () => {
            finish(null);
            input.onChooseAgain?.();
        });

        // The footer (§7): Skip, Next › / Done.
        const f = portraitFooter(states, index, couple);
        skipBtn.hidden = !f.skip;
        primaryBtn.textContent = f.primary === 'next' ? `${P.next} ›` : P.done;
        primaryBtn.dataset.action = f.primary;
        draw();
    };

    // ---------- the layout (§9): one set of controls, placed per layout ----------
    const arrange = (): void => {
        layout = currentLayout();
        dialog.dataset.layout = layout;
        overlay.classList.toggle('pe-full', layout !== 'wide');
        const wide = layout === 'wide';
        cancelBtn.className = wide ? 'secondary pe-cancel' : 'pe-cancel pe-cancel-text';
        if (wide) {
            if (stepsEl) h2.after(head.querySelector('.pe-sep')!, stepsEl);
            bar.replaceChildren(zoomRow, barDivider, resetBtn);
            rotateSec.append(rotRow);
            straightSec.append(angleRow, straightHint);
            footButtons.replaceChildren(cancelBtn, skipBtn, primaryBtn);
            slot.replaceChildren();
            actions.replaceChildren();
        } else {
            head.prepend(cancelBtn);
            if (stepsEl) stepsBar.append(stepsEl);
            bar.replaceChildren();
            straightHint.remove();
            slot.replaceChildren(zoomRow, angleRow);
            footButtons.replaceChildren();
            if (layout === 'phone') {
                actions.replaceChildren(rotRow, make('span', 'pe-fill'), skipBtn, primaryBtn);
            } else {
                fill.after(skipBtn, primaryBtn);
                actions.replaceChildren(rotRow);
            }
        }
        zoomRow.hidden = !wide && phoneSlider !== 'zoom';
        angleRow.hidden = !wide && phoneSlider !== 'straighten';
        seg.querySelectorAll<HTMLButtonElement>('[data-slider]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.slider === phoneSlider)));
        measure();
        draw();
    };

    // ---------- pointer: drag, two fingers, wheel, double click / tap ----------
    const pointers = new Map<number, { x: number; y: number }>();
    let last: { x: number; y: number } | null = null;
    let pinch: { dist: number; view: PortraitView } | null = null;
    let tap: { t: number; x: number; y: number; moved: boolean } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    /** A client point as the offset from the frame's centre. */
    const fromCentre = (x: number, y: number): { x: number; y: number } => {
        const r = stage.getBoundingClientRect();
        return { x: x - r.left - geo.cx, y: y - r.top - geo.cy };
    };
    const onBar = (e: Event): boolean => !!(e.target as HTMLElement).closest('.pe-bar');

    stage.addEventListener('pointerdown', (e) => {
        if (onBar(e) || e.button > 0) return;
        e.preventDefault();
        frame.focus({ preventScroll: true });
        if (keepOn()) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { stage.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), view: view() };
            last = null;
            tap = null;
        } else if (pointers.size === 1) {
            last = { x: e.clientX, y: e.clientY };
            tap = { t: performance.now(), x: e.clientX, y: e.clientY, moved: false };
            stage.classList.add('is-dragging');
        }
    });
    stage.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const anchor = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
            setView(zoomPortraitView(pinch.view, pinch.view.zoom * dist / pinch.dist, W, H, { ...anchor, framePx: geo.side }), 'zoom');
            return;
        }
        if (!last) return;
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
        if (dx || dy) setView(panPortraitView(view(), dx, dy, geo.side, W, H));
    });
    const endPointer = (e: PointerEvent): void => {
        if (!pointers.delete(e.pointerId)) return;
        if (pointers.size < 2) pinch = null;
        const rest = [...pointers.values()][0];
        last = rest ? { ...rest } : null;
        if (pointers.size === 0) stage.classList.remove('is-dragging');
        // A double tap on a touch screen: the default crop (dblclick covers the mouse).
        if (e.type === 'pointerup' && e.pointerType !== 'mouse' && tap && !tap.moved && pointers.size === 0) {
            const now = performance.now();
            if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX) {
                lastTap = null;
                reset();
            } else {
                lastTap = { t: now, x: e.clientX, y: e.clientY };
            }
        }
        tap = null;
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (keepOn() || onBar(e)) return;
        zoomTo(view().zoom * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP), fromCentre(e.clientX, e.clientY));
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => { if (!onBar(e) && !keepOn()) reset(); });

    // ---------- the controls ----------
    zoomOut.addEventListener('click', () => zoomTo(view().zoom / ZOOM_STEP));
    zoomIn.addEventListener('click', () => zoomTo(view().zoom * ZOOM_STEP));
    zoomRange.addEventListener('input', () => zoomTo(Number(zoomRange.value) / 100));
    resetBtn.addEventListener('click', reset);
    rotL.addEventListener('click', () => turn(-1));
    rotR.addEventListener('click', () => turn(1));
    mirrorBtn.addEventListener('click', () => setView(mirrorPortraitView(view(), W, H)));
    angleRange.addEventListener('input', () => straighten(Number(angleRange.value)));
    angleRange.addEventListener('dblclick', () => straighten(0));
    // The grid while straightening (dragged or focused).
    let gridDrag = false;
    const showGrid = (): void => { grid.hidden = !(gridDrag || document.activeElement === angleRange); };
    angleRange.addEventListener('pointerdown', () => { gridDrag = true; showGrid(); });
    angleRange.addEventListener('focus', showGrid);
    angleRange.addEventListener('blur', showGrid);
    window.addEventListener('pointerup', () => { if (gridDrag) { gridDrag = false; showGrid(); } });
    seg.querySelectorAll<HTMLButtonElement>('[data-slider]').forEach(b => b.addEventListener('click', () => {
        phoneSlider = b.dataset.slider === 'straighten' ? 'straighten' : 'zoom';
        arrange();
    }));
    stepsEl?.querySelectorAll<HTMLButtonElement>('.pe-step').forEach(b => b.addEventListener('click', () => goTo(Number(b.dataset.step))));

    const goTo = (i: number): void => {
        if (i < 0 || i >= states.length || i === index) return;
        index = i;
        states = states.map((s, k) => k === i ? { ...s, visited: true } : s);
        renderStep();
    };

    // ---------- the result ----------
    return new Promise<PortraitEditorResult | null>((resolve) => {
        let settled = false;
        let busy = false;
        const onResize = (): void => arrange();
        // The panel's content changes the stage's size (a phone: Keep / Replace, notes): the frame follows.
        let lastSize = '';
        const stageObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
            const size = `${stage.clientWidth}x${stage.clientHeight}`;
            if (size === lastSize) return;
            lastSize = size;
            measure();
            draw();
        });
        stageObserver?.observe(stage);
        const queries = [window.matchMedia(MQ_MOBILE), window.matchMedia(MQ_PHONE_LANDSCAPE)];
        const finishImpl = (result: PortraitEditorResult | null): void => {
            if (settled) return;
            settled = true;
            unbindKeys();
            window.removeEventListener('resize', onResize);
            stageObserver?.disconnect();
            queries.forEach(m => m.removeEventListener('change', onResize));
            window.clearTimeout(liveTimer);
            if (frameReq) cancelAnimationFrame(frameReq);
            overlay.remove();
            if (work !== bitmap) { (work as HTMLCanvasElement).width = 0; }
            bitmap.close();
            opener?.focus?.();
            resolve(result);
        };
        finish = finishImpl;

        const done = async (): Promise<void> => {
            if (busy) return;
            busy = true;
            primaryBtn.disabled = true;
            if (states[index].status !== 'skipped') states = finishPortraitStep(states, index);
            try {
                const crops = states.map(s => portraitStepCrop(s, W, H));
                const steps: PortraitEditorResult['steps'] = [];
                for (const crop of crops) {
                    if (!crop) { steps.push(null); continue; }
                    let photo: string;
                    if (isIdentityPortrait({ fromFile, squareOnly, stepCount: states.length }, crop, W, H)) {
                        // K1.5: nothing moved — today's bytes.
                        const src = input.source as Blob;
                        photo = await compressPhoto(src instanceof File ? src : new File([src], 'photo', { type: src.type }));
                    } else {
                        const c = document.createElement('canvas');
                        c.width = PHOTO_SIZE;
                        c.height = PHOTO_SIZE;
                        const ctx = c.getContext('2d');
                        if (!ctx) throw new Error('Canvas 2D context unavailable');
                        // The frame off the photo's edge: the neutral fill;
                        // the photo itself on white (JPEG has no alpha, §10).
                        ctx.fillStyle = PORTRAIT_EMPTY_FILL;
                        ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
                        ctx.imageSmoothingQuality = 'high';
                        ctx.setTransform(...portraitOutputMatrix(crop, W, H, PHOTO_SIZE));
                        ctx.fillStyle = '#fff';
                        ctx.fillRect(0, 0, W, H);
                        ctx.drawImage(bitmap, 0, 0);
                        photo = c.toDataURL('image/jpeg', PHOTO_QUALITY);
                    }
                    steps.push({ photo, crop });
                }
                const result: PortraitEditorResult = { steps };
                if (fromFile && steps.some(Boolean)) {
                    result.original = cropToJpeg(work, { x: 0, y: 0, w: 1, h: 1 }, ATTACHMENT_MAX_SIDE, ATTACHMENT_QUALITY).dataUrl;
                }
                finishImpl(result);
            } catch (e) {
                console.error('Portrait failed:', e);
                busy = false;
                primaryBtn.disabled = false;
            }
        };
        const next = (): void => {
            states = finishPortraitStep(states, index);
            goTo(index + 1);
            frame.focus({ preventScroll: true });
        };
        const primary = (): void => { if (primaryBtn.dataset.action === 'next') next(); else void done(); };
        const skip = (): void => {
            states = skipPortraitStep(states, index);
            if (index >= states.length - 1) void done();
            else { goTo(index + 1); frame.focus({ preventScroll: true }); }
        };

        // The keys reach the editor in the capture phase only (bindEditorKeys): the controls' own keys are here.
        const onKey = (e: KeyboardEvent): void => {
            const active = document.activeElement as HTMLElement | null;
            const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
            if (active === angleRange) {
                // Shift: ±5°; the arrows alone ±0.5° and Home / End ±45° are the slider's own.
                if (arrow && e.shiftKey && !keepOn()) { e.preventDefault(); straighten(view().angle + arrow * 5); }
                if (arrow || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') return;
            }
            if (active === zoomRange && (arrow || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown')) return;
            if (stepsEl && active?.classList.contains('pe-step') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                // The steps are a tablist: the arrows go to the next or previous step.
                e.preventDefault();
                const i = Math.max(0, Math.min(states.length - 1, index + arrow));
                goTo(i);
                stepsEl.querySelectorAll<HTMLButtonElement>('.pe-step')[i]?.focus();
                return;
            }
            if (e.key === 'Enter') {
                // A focused button does its own thing; anywhere else Enter is Next / Done.
                if (active && (active.tagName === 'BUTTON' || active.getAttribute('role') === 'tab')) return;
                e.preventDefault();
                primary();
                return;
            }
            if (e.altKey || e.ctrlKey || e.metaKey || keepOn()) return;
            const k = e.key;
            if (k === '+' || k === '=') { e.preventDefault(); zoomTo(view().zoom * ZOOM_STEP); return; }
            if (k === '-' || k === '−' || k === '_') { e.preventDefault(); zoomTo(view().zoom / ZOOM_STEP); return; }
            if (k === '[') { e.preventDefault(); turn(-1); return; }
            if (k === ']') { e.preventDefault(); turn(1); return; }
            if (k === '0') { e.preventDefault(); reset(); return; }
            if (active !== frame) return;
            // 1 % of the frame (Shift: 10 %), the photo moving as when dragged.
            const step = geo.side * (e.shiftKey ? 0.1 : 0.01);
            const d: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
            };
            const delta = d[k];
            if (!delta) return;
            e.preventDefault();
            setView(panPortraitView(view(), delta[0], delta[1], geo.side, W, H));
        };
        const unbindKeys = bindEditorKeys(overlay, () => finishImpl(null), onKey);

        cancelBtn.addEventListener('click', () => finishImpl(null));
        closeBtn.addEventListener('click', () => finishImpl(null));
        primaryBtn.addEventListener('click', primary);
        skipBtn.addEventListener('click', skip);
        window.addEventListener('resize', onResize);
        queries.forEach(m => m.addEventListener('change', onResize));

        renderStep();
        arrange();
        requestAnimationFrame(() => {
            if (settled) return;
            arrange();
            frame.focus({ preventScroll: true });
        });
    });

}

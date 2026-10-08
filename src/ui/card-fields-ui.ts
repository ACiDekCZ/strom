/**
 * Settings → Person card: the row of card types (a tile with a small sample
 * card each, a radio group), the sentence on the chosen type with "Edit as
 * Custom" for the preset types, the preview card (one for the type and the
 * signals) and, for the "Custom" type, the list of details its lines show
 * (src/card-fields.ts). A row per detail: a checkbox, the mark and the name,
 * small toggles for what the line adds (place, cause, the baptism or burial
 * standing in) and arrows to reorder — no dragging, eight rows is few enough.
 * Any number of them can be on ("Turn all on" ticks every one). Under it,
 * "Card appearance": how the card is drawn (the line style, the detail
 * length, the width, the years under the name).
 */

import { TreeRenderer } from '../renderer.js';
import { SettingsManager, CardSignals } from '../settings.js';
import { strings } from '../strings.js';
import { CARD_SIZE, CardDensity, Person, PersonId, Partnership, PartnershipId, StromData } from '../types.js';
import { ActionSignal, ACTION_GLYPH, stateStripesHtml } from '../card-signals.js';
import {
    CardFieldKey, CardFieldSettings, CardHeightMode, CardLineStyle, CardValueLines, CardWidthCap, CARD_FIELD_KEYS,
    CARD_HEIGHT_MODES, CARD_LINE_STYLES, CARD_MARKS, CARD_VALUE_LINES, CARD_WIDTH_CAPS, PLACE_KEYS, cardLines,
    cardLineHtml, cardYears, cardDateReferences, isFieldCardDensity, CARD_DENSITIES, CardPresetKey, cardTypeForKey,
    customCardSize, matchCardPreset, presetAsCustom,
} from '../card-fields.js';
import { CardHead, customCardMetrics, customCardRows, measureCardTexts } from '../card-width.js';
import { uiModule } from './module.js';

const esc = (text: string): string => text.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The name of a row: the event types, the couple's two from the relationships panel, the age. */
function fieldLabel(key: CardFieldKey): string {
    if (key === 'marriage') return strings.fields.marriageRow;
    if (key === 'divorce') return strings.fields.divorceRow;
    if (key === 'age') return strings.fields.ageRow;
    return strings.events.types[key];
}

/** A made-up person for the preview: a miller who died of consumption, married once. */
function samplePerson(): { person: Person; data: StromData } {
    const jan = 'sample_jan' as PersonId;
    const marie = 'sample_marie' as PersonId;
    const union = 'sample_union' as PartnershipId;
    const d = strings.cardDensity;
    const person: Person = {
        id: jan, firstName: 'Jan', lastName: 'Vlk', gender: 'male', isPlaceholder: false,
        birthDate: '1862', birthPlace: 'Horní Lhota',
        deathDate: '1919-03-12', deathPlace: 'Horní Lhota', deathCause: d.sampleCause,
        partnerships: [union], parentIds: [], childIds: [],
        events: [
            { id: 'e1', type: 'baptism', date: '1862-03-02', place: 'Horní Lhota' },
            { id: 'e2', type: 'burial', date: '1919-03-15', place: 'Horní Lhota' },
            { id: 'e3', type: 'occupation', note: d.sampleOccupation },
        ],
    };
    const partnership: Partnership = {
        id: union, person1Id: jan, person2Id: marie, childIds: [], status: 'married',
        startDate: '1888-02-14', startPlace: 'Dolní Lhota',
    };
    return { person, data: { persons: { [jan]: person }, partnerships: { [union]: partnership } } };
}

/** The width choice's words. */
const WIDTH_LABEL: Record<CardWidthCap, () => string> = {
    240: () => strings.cardDensity.widthNarrow,
    320: () => strings.cardDensity.widthMedium,
    400: () => strings.cardDensity.widthWide,
};

/** The card height choice's words: one height for the view, or each card by its content. */
const HEIGHT_LABEL: Record<CardHeightMode, () => string> = {
    view: () => strings.cardDensity.heightSame,
    content: () => strings.cardDensity.heightContent,
};

/** The line style choice's words. */
const STYLE_LABEL: Record<CardLineStyle, () => string> = {
    marks: () => strings.cardDensity.styleMarks,
    labels: () => strings.cardDensity.styleLabels,
};

/** The detail length choice's words. */
const LINES_LABEL: Record<CardValueLines, () => string> = {
    1: () => strings.cardDensity.lines1,
    2: () => strings.cardDensity.lines2,
    0: () => strings.cardDensity.linesAll,
};

/**
 * The sample card of the preview: its header and lines, their rows at the
 * drawn view's width (wrapped as the canvas wraps them) and its height — the
 * view's one-row height, or the sample's own when its details wrap or the
 * height is "by content".
 */
function samplePreview(density: CardPresetKey | 'custom', viewWidth: number | undefined): {
    html: string; head: CardHead; wrapped: boolean; width: number; height: number; dateColumn: number; labelColumn: number;
} {
    // The card type's own lines (Detailed, Register), Custom's stored ones.
    const fields = SettingsManager.getEffectiveCardFields(density) ?? SettingsManager.getCardFields();
    const { person, data } = samplePerson();
    const lines = cardLines(person, data, fields);
    const years = fields.years ? cardYears(person, true) : '';
    const entry = { name: 'Jan Vlk', avatar: true, lines, ...(years ? { years } : {}) };
    // The view's card width; the date (or label) column of the sample's own lines.
    const own = customCardMetrics([entry], measureCardTexts, fields.widthCap, fields.lines, fields.style,
        cardDateReferences(fields.fullDate));
    const metrics = { ...own, cardWidth: viewWidth ?? own.cardWidth };
    const { rows, heights, heads } = customCardRows([entry], metrics, measureCardTexts, fields.lines, fields.style);
    const wrapped = fields.lines !== 1;
    const html = `<div class="card-lines${wrapped ? ' card-lines--rows' : ''}">${lines.map(l =>
        cardLineHtml(l, esc, false, wrapped ? rows.get(l) : undefined, fields.style, !!rows.get(l)?.longDate)).join('')}</div>`;
    // The sample's own height when its details wrap or every card is as tall as its content.
    const height = wrapped || fields.height === 'content' ? heights[0] : customCardSize(fields.on.length, fields.years).cardHeight;
    return { html, head: heads[0], wrapped, width: metrics.cardWidth, height, dateColumn: own.dateColumn, labelColumn: own.labelColumn ?? 0 };
}

/** A row of "Card appearance": its label and a segment of choices (one pressed). */
function lookSegment(name: string, label: string, options: { value: string; label: string; active: boolean }[]): string {
    const id = `card-look-${name}-label`;
    const buttons = options.map(o =>
        `<button type="button" class="segment-btn${o.active ? ' active' : ''}" data-value="${esc(o.value)}" aria-pressed="${o.active}">${esc(o.label)}</button>`).join('');
    return `<span class="card-look-label" id="${id}">${esc(label)}</span>
        <div class="segment card-look-segment card-look-${name}" role="group" aria-labelledby="${id}">${buttons}</div>`;
}

/**
 * The preview card shrinks to the panel when it is wider (a wide card on a
 * phone): scaled as a whole, so it wraps as on the canvas, inside a box of
 * the scaled size, so nothing scrolls sideways and no empty space is left.
 */
function fitCardPreview(host: HTMLElement): void {
    const box = host.querySelector<HTMLElement>('.card-signals-preview');
    const fit = box?.querySelector<HTMLElement>('.card-preview-fit');
    const card = fit?.firstElementChild as HTMLElement | null;
    if (!box || !fit || !card) return;
    card.style.transform = '';
    fit.style.width = '';
    fit.style.height = '';
    const style = getComputedStyle(box);
    const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const width = card.offsetWidth;
    if (room <= 0 || width <= room) return;
    const k = room / width;
    card.style.transform = `scale(${k})`;
    fit.style.width = `${room}px`;
    fit.style.height = `${card.offsetHeight * k}px`;
}

/** Fit the preview again when the panel's width changes (the dialog opens, the window turns). */
const watchedPreviews = new WeakSet<HTMLElement>();
function watchCardPreview(host: HTMLElement): void {
    if (watchedPreviews.has(host) || typeof ResizeObserver === 'undefined') return;
    watchedPreviews.add(host);
    let lastWidth = -1;
    new ResizeObserver(() => {
        if (host.clientWidth === lastWidth) return;
        lastWidth = host.clientWidth;
        fitCardPreview(host);
    }).observe(host);
}

/** No signals: the tiles' small cards (unreadable at a quarter of the size). */
const NO_SIGNALS: CardSignals = { evidence: false, story: false, waiting: false, conflict: false, question: false, agent: false };

/** The scale of the small cards in the row of types (one for every type). */
const THUMB_SCALE = 0.25;

/** A card type's name; in a sentence without the "…" of Custom's. */
function typeName(density: CardDensity): string {
    return strings.cardDensity[density];
}

/** The sentence on a type under the row (Custom has none: its panel says it). */
function typeDescription(density: CardDensity): string {
    const d = strings.cardDensity;
    switch (density) {
        case 'compact': return d.compactDesc;
        case 'normal': return d.normalDesc;
        case 'detailed': return d.detailedDesc;
        case 'register': return d.registerDesc;
        default: return '';
    }
}

/**
 * After "Edit as Custom": the preset Custom took over and the Custom settings
 * it replaced (null when they already were that preset — nothing to bring
 * back). Gone with the next change in the panel, another type, or when the
 * Settings close.
 */
let customCopy: { type: CardPresetKey; prev: CardFieldSettings | null } | null = null;

/** Forget the "Custom now has the … settings" notice and what it could restore. */
export function forgetCardTypeCopy(): void {
    customCopy = null;
}

/**
 * A made-up card of a type with the chosen signals, and its box: the fixed
 * size of Compact and Normal, the sample's own for a card of details (wrapped
 * for `viewWidth`, the drawn view's card width, when given).
 */
function sampleCard(density: CardDensity, on: CardSignals, viewWidth: number | undefined): { html: string; width: number; height: number } {
    const stripes = stateStripesHtml(on.evidence ? 'partial' : null, on.story ? 'draft' : null);
    const action: ActionSignal | null = on.waiting ? 'waiting' : on.conflict ? 'conflict' : on.question ? 'question' : null;
    const badge = action ? `<span class="card-signal signal-${action}">${ACTION_GLYPH[action]}</span>` : '';
    const dot = action ? `<span class="card-signal-dot signal-${action}"></span>` : '';
    const avatar = (initials: string) =>
        `<div class="card-avatar-wrap"><div class="card-avatar"><span class="avatar-initials">${initials}</span></div>${badge}</div>`;
    if (isFieldCardDensity(density)) {
        const sample = samplePreview(density, viewWidth);
        // The width it was wrapped for (the view's; before any view, the sample's own) and its height.
        const box = `--card-date-col: ${sample.dateColumn}px; --card-label-col: ${sample.labelColumn}px; `
            + `width: ${sample.width}px; height: ${sample.height}px`;
        const { head } = sample;
        const name = sample.wrapped
            ? `<div class="name name--rows"><span class="name-text">${head.name.map(r => `<span class="name-row">${esc(r)}</span>`).join('')}</span></div>`
            : '<div class="name"><span class="name-text">Jan Vlk</span></div>';
        const years = head.years ? `<div class="card-years">${esc(head.years)}</div>` : '';
        return {
            width: sample.width, height: sample.height, html: `
            <div class="person-card male preview-card${action ? ' has-signal' : ''}" data-density="${density}" data-fields style="${box}">
                <div class="card-body card-body--custom">
                    <div class="card-head">${avatar('JV')}<div class="card-head-text">${name}${years}</div></div>
                    ${sample.html}
                </div>
                ${stripes}
                ${dot}
            </div>`,
        };
    }
    const compact = density === 'compact';
    const size = CARD_SIZE[compact ? 'compact' : 'normal'];
    return {
        width: size.cardWidth, height: size.cardHeight, html: `
        <div class="person-card male preview-card${action ? ' has-signal' : ''}" data-density="${density}">
            ${compact ? '' : avatar('JV')}
            <div class="card-body">
                <div class="name"><span class="name-text">Jan Vlk</span></div>
                ${compact ? '' : '<div class="birth-date"><span class="meta-text">1862 – 1919 · Horní Lhota</span></div>'}
            </div>
            ${stripes}
            ${dot}
        </div>`,
    };
}

/** A tile's small card: the type's sample at a quarter of its size, in a box of the scaled size. */
function thumbHtml(density: CardDensity): string {
    const { html, width, height } = sampleCard(density, NO_SIGNALS, undefined);
    const w = Math.round(width * THUMB_SCALE * 100) / 100;
    const h = Math.round(height * THUMB_SCALE * 100) / 100;
    return `<span class="card-type-thumb-box" style="width: ${w}px; height: ${h}px"><span class="card-type-thumb-card">${html}</span></span>`;
}

export const cardFieldsUiMethods = uiModule({
    /**
     * "Card detail": the row of the five types (a radio group — one tab stop,
     * the arrows move the choice), under it the chosen type's sentence with
     * "Edit as Custom" for Detailed and Register, or for Custom the notice of
     * the settings it took over, or the note that it equals a preset.
     */
    renderCardTypeSettings(): void {
        const host = document.getElementById('card-type-settings');
        if (!host) return;
        const d = strings.cardDensity;
        const current = SettingsManager.getCardDensity();
        const tiles = CARD_DENSITIES.map(density => {
            const on = density === current;
            return `<button type="button" class="card-type-tile${on ? ' is-selected' : ''}" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-density="${density}">
                <span class="card-type-thumb" aria-hidden="true">${thumbHtml(density)}</span>
                <span class="card-type-name">${esc(typeName(density))}</span>
            </button>`;
        }).join('');
        let below = '';
        if (current === 'custom') {
            const same = customCopy ? null : matchCardPreset(SettingsManager.getCardFields());
            if (customCopy) {
                below = `<div class="card-type-notice" role="status" tabindex="-1">
                    <span class="card-type-notice-text">${esc(d.copied(typeName(customCopy.type)))}</span>
                    ${customCopy.prev ? `<button type="button" class="card-type-restore">${esc(d.restore)}</button>` : ''}
                </div>`;
            } else if (same) {
                below = `<p class="card-type-same">${esc(d.sameAs(typeName(same)))}</p>`;
            }
        } else {
            const edit = current === 'detailed' || current === 'register'
                ? `<button type="button" class="secondary card-type-edit">${esc(d.editAsCustom)}</button>` : '';
            below = `<div class="card-type-about"><p class="card-type-desc" id="card-type-desc">${esc(typeDescription(current))}</p>${edit}</div>`;
        }
        host.innerHTML = `
            <span class="settings-name" id="card-type-label">${esc(d.settingLabel)}</span>
            <div class="card-type-row" id="card-type-row" role="radiogroup" aria-labelledby="card-type-label"${current === 'custom' ? '' : ' aria-describedby="card-type-desc"'}>${tiles}</div>
            ${below}`;

        const choose = (density: CardDensity): void => {
            if (density !== SettingsManager.getCardDensity()) this.setCardDensity(density);
            document.querySelector<HTMLElement>(`#card-type-row [data-density="${density}"]`)?.focus();
        };
        host.querySelectorAll<HTMLButtonElement>('.card-type-tile').forEach(tile => {
            tile.onclick = () => choose(tile.dataset.density as CardDensity);
        });
        const row = host.querySelector<HTMLElement>('.card-type-row');
        if (row) row.onkeydown = (e: KeyboardEvent) => {
            const from = (e.target as HTMLElement).closest<HTMLElement>('.card-type-tile')?.dataset.density as CardDensity | undefined;
            const next = from && cardTypeForKey(from, e.key);
            if (!next) return;
            e.preventDefault();
            e.stopPropagation();
            choose(next);
        };
        const edit = host.querySelector<HTMLButtonElement>('.card-type-edit');
        if (edit && (current === 'detailed' || current === 'register')) edit.onclick = () => {
            const prev = SettingsManager.getCardFields();
            const { fields, restorable } = presetAsCustom(current, prev);
            SettingsManager.setCardFields(fields);
            this.setCardDensity('custom');
            customCopy = { type: current, prev: restorable ? prev : null };
            this.renderCardTypeSettings();
            // The button is gone with the type: the keyboard goes to the notice.
            document.querySelector<HTMLElement>('#card-type-settings .card-type-notice')?.focus();
        };
        const restore = host.querySelector<HTMLButtonElement>('.card-type-restore');
        if (restore) restore.onclick = () => {
            const prev = customCopy?.prev;
            customCopy = null;
            if (prev) SettingsManager.setCardFields(prev);
            this.renderCardTypeSettings();
            this.renderCardPreview();
            this.renderCardFieldsSettings();
            TreeRenderer.render();
            document.querySelector<HTMLElement>('#card-type-row [aria-checked="true"]')?.focus();
        };
    },

    /** The preview card under the row of types, with the card's size. */
    renderCardPreview(): void {
        const host = document.getElementById('card-preview-settings');
        if (!host) return;
        // A card of details is as wide as the drawn view needs (src/card-width.ts);
        // as tall as the sample's details when they wrap.
        const { html, width, height } = sampleCard(SettingsManager.getCardDensity(), SettingsManager.getCardSignals(),
            TreeRenderer.getCustomCardMetrics()?.cardWidth);
        host.innerHTML = `
            <div class="card-preview-head">
                <span class="card-signals-preview-title">${esc(strings.cardDensity.cardPreview)}</span>
                <span class="card-preview-size">${esc(strings.cardDensity.size(width, height))}</span>
            </div>
            <div class="card-signals-preview" aria-hidden="true"><div class="card-preview-fit">${html}</div></div>`;
        fitCardPreview(host);
        watchCardPreview(host);
    },

    /** A made-up card in the current type with the chosen signals. */
    cardPreviewHtml(on: CardSignals): string {
        return sampleCard(SettingsManager.getCardDensity(), on, TreeRenderer.getCustomCardMetrics()?.cardWidth).html;
    },

    /** "Details on the card": only for the custom density. */
    renderCardFieldsSettings(): void {
        const host = document.getElementById('card-fields-settings');
        if (!host) return;
        const custom = SettingsManager.getCardDensity() === 'custom';
        host.hidden = !custom;
        if (!custom) { host.innerHTML = ''; return; }
        const d = strings.cardDensity;
        const s = SettingsManager.getCardFields();
        const chip = (key: CardFieldKey, opt: string, label: string, pressed: boolean) =>
            `<button type="button" class="card-field-chip" data-key="${key}" data-opt="${opt}" aria-pressed="${pressed}">${esc(label)}</button>`;
        const rows = s.order.map((key, i) => {
            const on = s.on.includes(key);
            const chips = !on ? [] : [
                PLACE_KEYS.includes(key) ? chip(key, 'place', d.optPlace, s.place.includes(key)) : '',
                key === 'death' ? chip(key, 'cause', d.optCause, s.cause) : '',
                key === 'birth' && !s.on.includes('baptism') ? chip(key, 'baptism', d.optBaptism, s.baptismFallback) : '',
                key === 'death' && !s.on.includes('burial') ? chip(key, 'burial', d.optBurial, s.burialFallback) : '',
            ].filter(Boolean);
            const label = fieldLabel(key);
            return `
                <div class="card-field-row${on ? ' is-on' : ''}" data-key="${key}">
                    <label class="card-field-main">
                        <input type="checkbox" data-key="${key}"${on ? ' checked' : ''}>
                        <span class="card-field-mark" aria-hidden="true">${esc(CARD_MARKS[key])}</span>
                        <span class="card-field-name">${esc(label)}</span>
                    </label>
                    ${chips.length ? `<div class="card-field-chips" role="group" aria-label="${esc(label)}">${chips.join('')}</div>` : ''}
                    <div class="card-field-move">
                        <button type="button" class="card-field-up" data-key="${key}" aria-label="${esc(`${d.moveUp}: ${label}`)}"${i === 0 ? ' disabled' : ''}>↑</button>
                        <button type="button" class="card-field-down" data-key="${key}" aria-label="${esc(`${d.moveDown}: ${label}`)}"${i === s.order.length - 1 ? ' disabled' : ''}>↓</button>
                    </div>
                </div>`;
        }).join('');
        const allOn = s.on.length === CARD_FIELD_KEYS.length;
        host.innerHTML = `
            <div class="card-fields-head">
                <span class="settings-name">${esc(d.fieldsTitle)}</span>
                <div class="segment card-fields-date" role="group" aria-label="${esc(d.fieldsTitle)}">
                    <button type="button" class="segment-btn${s.fullDate ? '' : ' active'}" data-full="0" aria-pressed="${!s.fullDate}">${esc(d.yearOnly)}</button>
                    <button type="button" class="segment-btn${s.fullDate ? ' active' : ''}" data-full="1" aria-pressed="${s.fullDate}">${esc(d.fullDate)}</button>
                </div>
            </div>
            <div class="card-fields-list">${rows}</div>
            <div class="card-fields-foot">
                <div class="card-fields-status" role="status">${esc(d.count(s.on.length, CARD_FIELD_KEYS.length))}</div>
                ${allOn ? '' : `<button type="button" class="secondary card-fields-all">${esc(d.allOn)}</button>`}
            </div>
            <div class="card-look">
                <span class="settings-name card-look-title">${esc(d.lookTitle)}</span>
                <div class="card-look-grid">
                    ${lookSegment('style', d.style, CARD_LINE_STYLES.map(st => ({
                        value: st, label: STYLE_LABEL[st](), active: s.style === st,
                    })))}
                    ${lookSegment('lines', d.lines, CARD_VALUE_LINES.map(n => ({
                        value: String(n), label: LINES_LABEL[n](), active: s.lines === n,
                    })))}
                    ${lookSegment('height', d.height, CARD_HEIGHT_MODES.map(h => ({
                        value: h, label: HEIGHT_LABEL[h](), active: s.height === h,
                    })))}
                    ${lookSegment('width', d.width, CARD_WIDTH_CAPS.map(cap => ({
                        value: String(cap), label: WIDTH_LABEL[cap](), active: s.widthCap === cap,
                    })))}
                </div>
                <label class="card-look-check">
                    <input type="checkbox" class="card-look-years"${s.years ? ' checked' : ''}>
                    <span>${esc(d.years)}</span>
                </label>
                <div class="card-look-scope">${esc(d.scope)}</div>
            </div>`;

        const apply = (next: CardFieldSettings, focus?: string): void => {
            SettingsManager.setCardFields(next);
            // A change of its own: the notice of the taken-over preset goes, the tile's
            // small card and the "Same as …" note follow the new settings.
            forgetCardTypeCopy();
            this.renderCardTypeSettings();
            this.renderCardFieldsSettings();
            this.renderCardPreview();
            TreeRenderer.render();
            if (focus) host.querySelector<HTMLElement>(focus)?.focus();
        };
        host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-key]').forEach(input => {
            input.onchange = () => {
                const key = input.dataset.key as CardFieldKey;
                const on = input.checked ? [...s.on, key] : s.on.filter(k => k !== key);
                apply({ ...s, on: s.order.filter(k => on.includes(k)) }, `input[data-key="${key}"]`);
            };
        });
        host.querySelectorAll<HTMLButtonElement>('.card-field-chip').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key as CardFieldKey;
                const opt = btn.dataset.opt;
                const sel = `.card-field-chip[data-key="${key}"][data-opt="${opt}"]`;
                if (opt === 'place') {
                    const place = s.place.includes(key) ? s.place.filter(k => k !== key) : [...s.place, key];
                    apply({ ...s, place }, sel);
                } else if (opt === 'cause') apply({ ...s, cause: !s.cause }, sel);
                else if (opt === 'baptism') apply({ ...s, baptismFallback: !s.baptismFallback }, sel);
                else if (opt === 'burial') apply({ ...s, burialFallback: !s.burialFallback }, sel);
            };
        });
        host.querySelectorAll<HTMLButtonElement>('.card-field-up, .card-field-down').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key as CardFieldKey;
                const up = btn.classList.contains('card-field-up');
                const order = [...s.order];
                const i = order.indexOf(key);
                const j = up ? i - 1 : i + 1;
                if (j < 0 || j >= order.length) return;
                [order[i], order[j]] = [order[j], order[i]];
                const edge = up ? j === 0 : j === order.length - 1;
                // Keep the keyboard on the row it moved; at the end, on the other arrow.
                const cls = edge ? (up ? 'card-field-down' : 'card-field-up') : (up ? 'card-field-up' : 'card-field-down');
                apply({ ...s, order, on: order.filter(k => s.on.includes(k)) }, `.${cls}[data-key="${key}"]`);
            };
        });
        host.querySelectorAll<HTMLButtonElement>('.card-look-width .segment-btn').forEach(btn => {
            btn.onclick = () => {
                const widthCap = Number(btn.dataset.value) as CardWidthCap;
                apply({ ...s, widthCap }, `.card-look-width [data-value="${btn.dataset.value}"]`);
            };
        });
        host.querySelectorAll<HTMLButtonElement>('.card-look-lines .segment-btn').forEach(btn => {
            btn.onclick = () => {
                const lines = Number(btn.dataset.value) as CardValueLines;
                apply({ ...s, lines }, `.card-look-lines [data-value="${btn.dataset.value}"]`);
            };
        });
        host.querySelectorAll<HTMLButtonElement>('.card-look-height .segment-btn').forEach(btn => {
            btn.onclick = () => {
                const height = btn.dataset.value as CardHeightMode;
                apply({ ...s, height }, `.card-look-height [data-value="${height}"]`);
            };
        });
        // Every detail on; the places, the cause and the look stay as they are.
        const allBtn = host.querySelector<HTMLButtonElement>('.card-fields-all');
        if (allBtn) allBtn.onclick = () => apply({ ...s, on: [...s.order] }, '.card-fields-list input[type="checkbox"]');
        host.querySelectorAll<HTMLButtonElement>('.card-look-style .segment-btn').forEach(btn => {
            btn.onclick = () => {
                const style = btn.dataset.value as CardLineStyle;
                apply({ ...s, style }, `.card-look-style [data-value="${style}"]`);
            };
        });
        const yearsBox = host.querySelector<HTMLInputElement>('.card-look-years');
        if (yearsBox) yearsBox.onchange = () => apply({ ...s, years: yearsBox.checked }, '.card-look-years');
        host.querySelectorAll<HTMLButtonElement>('.card-fields-date .segment-btn').forEach(btn => {
            btn.onclick = () => apply({ ...s, fullDate: btn.dataset.full === '1' }, `.card-fields-date [data-full="${btn.dataset.full}"]`);
        });
    },
});

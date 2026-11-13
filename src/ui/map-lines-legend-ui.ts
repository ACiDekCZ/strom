/**
 * The legend of the family lines on the ancestors' path (spec 054 §2) and the
 * path's part of a place's bubble (§1, entry 2).
 *
 * The legend (`.map-lines-legend`) stands on the right under the map's
 * controls on a computer and a tablet: "Family lines" with the Quarters ·
 * Eighths switch and ▴ to fold it into its chip ("Family lines (4)" with the
 * lines' colours), a row per grandparent line (or per great-grandparent line
 * under its quarter's heading), an unknown grandparent's row, the trunk, and
 * a foot with the implex sentence, the cut of a big tree, the ancestors off
 * the timeline (with their list) and "No line colours". Hovering a row
 * highlights its line for a moment, a press pins it (Escape or a second press
 * lets go).
 *
 * The legend's content is built by mapLinesLegendHtml and its presses handled
 * by bindMapLinesLegend on any host, so a phone's bottom sheet can carry the
 * same content (the phone shows no unfolded legend here). The list of the
 * ancestors off the timeline likewise: mapLinesUndatedHtml + its handlers.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { PersonId } from '../types.js';
import { shownName } from '../person-name.js';
import { yearOf } from '../dates.js';
import { branchClass, pointClassOf, type BranchInfo, type LineClass, type LineMode, type PathModel } from '../map-lines.js';
import { lineSwatch, lineColorVar, pointFill, sortLineClasses } from '../map-line-colors.js';
import { MQ_MOBILE, MQ_PHONE_LANDSCAPE } from '../breakpoints.js';
import { uiModule } from './module.js';

/** The list of the ancestors off the timeline is open (beside the legend). */
let undatedOpen = false;
let undatedOutsideBound = false;
/** The person row of a place's bubble whose actions are shown. */
let bubbleExpanded: PersonId | null = null;
/** A phone: the legend's sheet is open (its chip opens it). */
let sheetOpen = false;
let sheetOutsideBound = false;
/** Where the legend was last drawn: a computer or a tablet, a phone, a phone held sideways. */
type LegendLayout = 'wide' | 'phone' | 'land';
let lastLayout: LegendLayout | null = null;

function legendLayout(): LegendLayout {
    if (window.matchMedia(MQ_PHONE_LANDSCAPE).matches) return 'land';
    return window.matchMedia(MQ_MOBILE).matches ? 'phone' : 'wide';
}

/** Relation of a quarter (0 = father's father … 3 = mother's mother). */
function quarterRel(q: number): string {
    const f = strings.fan;
    return [f.lineFatherFather, f.lineFatherMother, f.lineMotherFather, f.lineMotherMother][q] ?? '';
}

/** Relation of an eighth (0 = father's father's father … 7 = mother's mother's mother). */
function eighthRel(e: number): string {
    const m = strings.map as unknown as Record<string, string>;
    return m[`lineE${8 + e}`] ?? '';
}

/** The line's name in a sentence: its surname, an eighth with its number in front. */
function branchName(mode: LineMode, i: number, b: BranchInfo | null): string {
    if (!b) return '';
    return mode === 'eighth' ? `${i + 1} · ${b.surname}` : b.surname;
}

/** Known lines of the mode (the chip's count and colours). */
function knownLines(model: PathModel, mode: LineMode): number[] {
    const list = mode === 'eighth' ? model.eighths : model.quarters;
    return list.flatMap((b, i) => (b ? [i] : []));
}

export const mapLinesLegendMethods = uiModule({
    /** The legend has something to show: the path is on and an ancestor is on the map. */
    mapLinesLegendShown(): boolean {
        const model = this.mapPathModel();
        return !!model && model.onMapCount > 0;
    },

    /** The line the map highlights: the hovered row, else the pinned one (index in the mode). */
    mapLineHighlight(): number | null {
        return this.mapLineHover ?? this.mapLineFocus;
    },

    /**
     * The legend's content (head, rows, foot) for the panel on the right or a
     * phone's sheet (`sheet`: the head's ▴ closes it with ×). Empty without
     * the path.
     */
    mapLinesLegendHtml(opts: { sheet?: boolean } = {}): string {
        const model = this.mapPathModel();
        if (!model || model.onMapCount === 0) return '';
        const m = strings.map;
        const esc = (t: string): string => this.escapeHtml(t);
        const mode = this.mapLineMode;
        const colors = this.mapLineColors;
        const hi = colors ? this.mapLineHighlight() : null;
        const knownE = model.eighths.filter(Boolean).length;
        const eighthsOff = knownE < 2;

        const close = opts.sheet
            ? `<button type="button" class="map-lines-collapse" data-act="collapse" aria-label="${esc(strings.buttons.close)}" title="${esc(strings.buttons.close)}">×</button>`
            : `<button type="button" class="map-lines-collapse" data-act="collapse" aria-expanded="true" aria-label="${esc(m.linesCollapse)}" title="${esc(m.linesCollapse)}">▴</button>`;
        const seg = (value: LineMode, label: string, off: boolean): string =>
            `<button type="button" class="map-lines-mode-btn${mode === value ? ' is-on' : ''}" data-act="mode" data-mode="${value}"`
            + ` aria-pressed="${mode === value}"${off ? ' aria-disabled="true"' : ''}>${esc(label)}</button>`;
        const head = `<div class="map-lines-head">
                <h3 class="map-lines-title">${esc(m.linesTitle)}</h3>
                <div class="map-lines-mode" role="group" aria-label="${esc(m.linesTitle)}">${seg('quarter', m.linesQuarters, false)}${seg('eighth', m.linesEighths, eighthsOff)}</div>
                ${close}
            </div>`;

        // A row of a known line: its swatch (the line's pattern), surname and "relation · N ancestors".
        const row = (i: number, cls: LineClass, name: string, sub: string, label: string, title = ''): string => {
            const pinned = this.mapLineFocus === i;
            const state = hi === null ? '' : hi === i ? ' is-focus' : ' is-dim';
            return `<button type="button" class="map-lines-row${state}" data-line="${i}" data-cls="${cls}" aria-pressed="${pinned}" aria-label="${esc(label)}"${title ? ` title="${esc(title)}"` : ''}>`
                + `<span class="map-lines-swatch" aria-hidden="true" style="background: ${lineSwatch(cls, true)};"></span>`
                + `<span class="map-lines-text"><span class="map-lines-name">${esc(name)}</span><span class="map-lines-sub">${esc(sub)}</span></span></button>`;
        };
        const unknown = (name: string): string =>
            `<div class="map-lines-row is-unknown${hi !== null ? ' is-dim' : ''}"><span class="map-lines-swatch is-empty" aria-hidden="true"></span>`
            + `<span class="map-lines-text"><span class="map-lines-name">${esc(name)}</span></span></div>`;

        let rows = '';
        if (colors) {
            const parts: string[] = [];
            if (mode === 'quarter') {
                model.quarters.forEach((q, i) => {
                    const rel = quarterRel(i);
                    parts.push(q
                        ? row(i, branchClass('quarter', i), q.surname, m.linesRow(rel, q.count), `${q.surname} · ${m.linesRow(rel, q.count)}`)
                        : unknown(m.linesUnknown(rel, i % 2 === 1)));
                });
            } else {
                model.quarters.forEach((q, qi) => {
                    const rel = quarterRel(qi);
                    parts.push(`<div class="map-lines-group">${esc(q ? `${q.surname} · ${rel}` : m.linesUnknown(rel, qi % 2 === 1))}</div>`);
                    if (!q) return;
                    for (let j = 0; j < 2; j++) {
                        const e = qi * 2 + j;
                        const b = model.eighths[e];
                        const relE = eighthRel(e);
                        // "1 · Surname" over "6 ancestors"; the relation only in the title and the label.
                        parts.push(b
                            ? row(e, branchClass('eighth', e), `${e + 1} · ${b.surname}`, m.linesAncestors(b.count),
                                `${e + 1} · ${b.surname} · ${m.linesRow(relE, b.count)}`, relE)
                            : unknown(`${e + 1} · ${m.linesUnknown(relE, j === 1)}`));
                    }
                });
            }
            parts.push(`<div class="map-lines-row is-trunk${hi !== null ? ' is-dim' : ''}"><span class="map-lines-swatch is-trunk" aria-hidden="true"></span>`
                + `<span class="map-lines-text"><span class="map-lines-name">${esc(m.linesTrunk)}</span></span></div>`);
            rows = `<div class="map-lines-rows">${parts.join('')}</div>`;
        }

        // The foot: implex, the cut, the ancestors off the timeline, no line colours.
        const foot: string[] = [];
        const implex = colors ? this.mapLinesImplexText(model, mode) : '';
        if (implex) foot.push(`<p class="map-lines-implex">${esc(implex)}</p>`);
        foot.push(`<p class="map-lines-cut"${this.mapLinesCutKey() ? '' : ' hidden'}>${this.mapLinesCutHtml()}</p>`);
        if (model.missing.length > 0) {
            foot.push(`<p class="map-lines-undated">${esc(m.pathUndated(model.missing.length))} `
                + `<button type="button" class="map-lines-link" data-act="undated" aria-haspopup="dialog" aria-expanded="${undatedOpen}">${esc(m.pathUndatedList)}</button></p>`);
        }
        foot.push(`<button type="button" class="map-lines-off" data-act="colors" role="checkbox" aria-checked="${!colors}">`
            + `<span class="map-lines-off-box" aria-hidden="true">${colors ? '' : '✓'}</span>${esc(m.linesOff)}</button>`);
        return head + rows + `<div class="map-lines-foot">${foot.join('')}</div>`;
    },

    /** "↻ Name (1788) is in two lines: A and B." for the first person in two lines of the mode; '' when none. */
    mapLinesImplexText(model: PathModel, mode: LineMode): string {
        const list = mode === 'eighth' ? model.eighths : model.quarters;
        for (const imp of model.implex) {
            const lines = (mode === 'eighth' ? imp.eighths : imp.quarters).filter(i => i >= 0 && list[i]);
            if (lines.length < 2) continue;
            const person = DataManager.getPerson(imp.personId);
            if (!person) continue;
            const year = yearOf(person.birthDate) ?? undefined;
            return strings.map.linesImplex(shownName(person), year, branchName(mode, lines[0], list[lines[0]]), branchName(mode, lines[1], list[lines[1]]));
        }
        return '';
    },

    /** The cut of a big tree as shown ('' = everything drawn). */
    mapLinesCutKey(): string {
        const { shown, total } = this.mapPathDrawnLines();
        return total > shown ? `${shown}/${total}` : '';
    },

    mapLinesCutHtml(): string {
        const { shown, total } = this.mapPathDrawnLines();
        if (total <= shown) return '';
        const m = strings.map;
        return `<strong>${this.escapeHtml(m.linesCut(shown, total))}</strong>. ${this.escapeHtml(m.linesCutWhy)}`;
    },

    /** After a draw: the cut line of the legend follows what was drawn (without rebuilding the legend). */
    syncMapLinesCut(): void {
        const key = this.mapLinesCutKey();
        document.querySelectorAll<HTMLElement>('.map-lines-cut').forEach(el => {
            if ((el.dataset.key ?? '') === key) return;
            el.dataset.key = key;
            el.innerHTML = this.mapLinesCutHtml();
            el.hidden = !key;
        });
    },

    /**
     * Draw the legend on the map: on a computer and a tablet the panel, or
     * folded its chip; on a phone the chip "Family lines (N)" left above the
     * bar (sideways: in the top row beside the person's chip) that opens the
     * same content as a sheet along the bottom. Gone without the path (or
     * without an ancestor on the map).
     */
    renderMapLinesLegend(): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        const layout = legendLayout();
        const phone = layout !== 'wide';
        if (lastLayout !== null && lastLayout !== layout) {
            // Another layout (a window resized, a phone turned): its own chip and panel.
            container.querySelectorAll('.map-lines-legend, .map-lines-chip').forEach(el => el.remove());
            if (undatedOpen) this.closeMapLinesUndated(false);
            sheetOpen = false;
        }
        lastLayout = layout;
        let panel = container.querySelector<HTMLElement>('.map-lines-legend');
        let chip = container.querySelector<HTMLElement>('.map-lines-chip');
        const shown = this.mapTimeOn && this.mapLinesLegendShown();
        if (!shown) {
            panel?.remove();
            chip?.remove();
            sheetOpen = false;
            container.classList.remove('has-lines-legend');
            this.closeMapLinesUndated(false);
            return;
        }
        const model = this.mapPathModel()!;
        // Keep the focus on the same control across the rebuild.
        const active = document.activeElement as HTMLElement | null;
        const was = active && (panel?.contains(active) || chip?.contains(active))
            ? { act: active.dataset.act ?? '', line: active.dataset.line ?? '', mode: active.dataset.mode ?? '', chip: chip?.contains(active) ?? false }
            : null;

        const wantChip = phone || this.mapLegendCollapsed;
        const wantPanel = phone ? sheetOpen : !this.mapLegendCollapsed;
        if (wantChip) {
            if (!chip) {
                const btn = document.createElement('button');
                btn.type = 'button';
                chip = btn;
                chip.className = 'map-lines-chip';
                chip.dataset.act = 'expand';
                this.bindMapLinesLegend(chip);
            }
            chip.classList.toggle('is-phone', phone);
            chip.classList.toggle('is-inline', layout === 'land');
            if (phone) chip.setAttribute('aria-haspopup', 'dialog');
            chip.setAttribute('aria-expanded', String(phone && sheetOpen));
            // Sideways: in the top row after the person's chip; elsewhere on the map itself.
            const pathChip = layout === 'land' ? container.querySelector<HTMLElement>('.map-topleft .map-path-chip') : null;
            if (pathChip) { if (pathChip.nextElementSibling !== chip) pathChip.after(chip); }
            else if (chip.parentElement !== container) container.appendChild(chip);
            const known = knownLines(model, this.mapLineMode);
            const bars = this.mapLineColors
                ? known.slice(0, 8).map(i => lineColorVar(branchClass(this.mapLineMode, i)))
                : ['var(--primary)'];
            chip.innerHTML = `<span class="map-lines-chip-bars" aria-hidden="true">${bars.map(c => `<span style="background: ${c};"></span>`).join('')}</span>`
                + `<span class="map-lines-chip-text">${this.escapeHtml(strings.map.linesChip(known.length))}</span>`
                + `<span class="map-lines-chip-caret" aria-hidden="true">${layout === 'phone' ? '▴' : '▾'}</span>`;
            chip.hidden = phone && sheetOpen;
        } else {
            chip?.remove();
            chip = null;
        }
        if (wantPanel) {
            if (!panel) {
                panel = document.createElement('section');
                panel.className = 'map-lines-legend';
                panel.setAttribute('aria-label', strings.map.linesTitle);
                container.appendChild(panel);
                this.bindMapLinesLegend(panel);
            }
            panel.classList.toggle('map-lines-legend--sheet', phone);
            panel.classList.toggle('map-lines-legend--land', layout === 'land');
            if (phone) panel.setAttribute('role', 'dialog');
            else panel.removeAttribute('role');
            panel.innerHTML = (phone ? '<span class="map-lines-grip" aria-hidden="true"></span>' : '') + this.mapLinesLegendHtml({ sheet: phone });
            panel.classList.toggle('is-colorless', !this.mapLineColors);
        } else {
            panel?.remove();
            panel = null;
            if (!phone) this.closeMapLinesUndated(false);
        }
        if (undatedOpen) this.renderMapLinesUndated();
        container.classList.add('has-lines-legend');
        this.positionMapLinesLegend();

        if (was) {
            // Folding moves the focus to the chip, unfolding to the fold button.
            const sel = was.line ? `[data-line="${was.line}"]` : was.mode ? `[data-mode="${was.mode}"]` : was.act ? `[data-act="${was.act}"]` : '';
            const target = panel && !was.chip && sel ? panel.querySelector<HTMLElement>(sel) : null;
            if (chip && !chip.hidden && (was.chip || !panel)) chip.focus();
            else (target ?? panel?.querySelector<HTMLElement>('.map-lines-collapse'))?.focus();
        }
    },

    /** A phone: the legend's sheet is open. */
    mapLinesSheetOpen(): boolean {
        return sheetOpen && lastLayout !== 'wide';
    },

    /** A phone: open the legend's sheet; the bubble, the choice of a person and the list give way. */
    openMapLinesSheet(): void {
        this.closeMapPopup();
        this.closeMapPathPicker(false);
        this.closeMapLinesUndated(false);
        sheetOpen = true;
        this.renderMapLinesLegend();
        document.querySelector<HTMLElement>('#map-container .map-lines-legend--sheet .map-lines-collapse')?.focus();
        if (!sheetOutsideBound) {
            sheetOutsideBound = true;
            // A press outside the sheet (and its chip) closes it.
            document.addEventListener('pointerdown', (e: PointerEvent) => {
                if (!sheetOpen) return;
                const t = e.target as Element | null;
                if (t?.closest?.('.map-lines-legend, .map-lines-chip, .map-lines-und')) return;
                this.closeMapLinesSheet(false);
            }, true);
        }
    },

    /** Close the legend's sheet; `refocus`: back to its chip. */
    closeMapLinesSheet(refocus: boolean): void {
        if (!sheetOpen) return;
        sheetOpen = false;
        this.renderMapLinesLegend();
        if (refocus) document.querySelector<HTMLElement>('#map-container .map-lines-chip')?.focus();
    },

    /** A phone: another sheet (the bubble, the choice of a person) opens, so the legend's sheets close. */
    closeMapLinesSheets(): void {
        if (lastLayout === 'wide') return;
        this.closeMapLinesUndated(false);
        this.closeMapLinesSheet(false);
    },

    /**
     * Place the legend (or its chip) under the column of the map's controls
     * (+ 12), on their right edge (left of the research's card, if any), below
     * the follow notices when they reach over it, and let it scroll down to
     * the time bar. The bubble keeps clear of it (--map-legend-room).
     */
    positionMapLinesLegend(): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        // A window resized across a breakpoint: the legend of the other layout.
        if (lastLayout !== null && legendLayout() !== lastLayout) { this.renderMapLinesLegend(); return; }
        const el = container.querySelector<HTMLElement>('.map-lines-legend, .map-lines-chip');
        if (!el) return;
        if (lastLayout !== 'wide') {
            container.style.removeProperty('--map-legend-room');
            // A phone: the chip stands 8 px above the time bar (sideways it rides in the top row).
            const chip = container.querySelector<HTMLElement>('.map-lines-chip.is-phone:not(.is-inline)');
            if (chip) {
                const box = container.getBoundingClientRect();
                const bar = container.querySelector<HTMLElement>('#map-timebar');
                const barRect = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
                chip.style.bottom = `${Math.round(barRect && barRect.height > 0 ? box.bottom - barRect.top + 8 : 74)}px`;
            }
            return;
        }
        const box = container.getBoundingClientRect();
        const controls = container.querySelector<HTMLElement>('.map-controls')?.getBoundingClientRect();
        const right = controls && controls.width > 0 ? Math.max(8, Math.round(box.right - controls.right)) : 12;
        el.style.right = `${right}px`;
        const width = el.getBoundingClientRect().width;
        const left = box.width - right - width;
        let top = controls && controls.height > 0 ? controls.bottom - box.top + 12 : 12;
        // The research's notices at the top (spec 043): the legend steps below them where they meet.
        const notices = container.querySelector<HTMLElement>('.map-follow-notices')?.getBoundingClientRect();
        if (notices && notices.height > 0 && notices.right - box.left > left && notices.left - box.left < left + width) {
            top = Math.max(top, notices.bottom - box.top + 12);
        }
        top = Math.round(top);
        el.style.top = `${top}px`;
        const bar = container.querySelector<HTMLElement>('#map-timebar');
        const barRect = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
        const floor = barRect && barRect.height > 0 ? barRect.top - box.top - 12 : box.height - 60;
        if (el.matches('.map-lines-legend')) el.style.maxHeight = `${Math.max(120, Math.round(floor - top))}px`;
        container.style.setProperty('--map-legend-room', el.matches('.map-lines-legend') ? `${Math.round(right + width + 12)}px` : '0px');
        this.positionMapLinesUndated();
    },

    /** The presses of the legend's content, on any host (the panel, the chip, a phone's sheet). */
    bindMapLinesLegend(host: HTMLElement): void {
        host.addEventListener('click', (e: Event) => {
            const t = e.target as HTMLElement;
            const btn = (t.closest('[data-act], .map-lines-row[data-line]') as HTMLElement | null);
            if (!btn || !host.contains(btn)) return;
            if (btn.dataset.line !== undefined) { this.toggleMapLineFocus(Number(btn.dataset.line)); return; }
            switch (btn.dataset.act) {
                case 'mode': {
                    if (btn.getAttribute('aria-disabled') === 'true') return;
                    this.setMapLineMode(btn.dataset.mode === 'eighth' ? 'eighth' : 'quarter');
                    return;
                }
                case 'collapse':
                    if (lastLayout !== 'wide') this.closeMapLinesSheet(true);
                    else this.setMapLegendCollapsed(true);
                    return;
                case 'expand':
                    if (lastLayout !== 'wide') this.openMapLinesSheet();
                    else this.setMapLegendCollapsed(false);
                    return;
                case 'colors': this.setMapLineColors(!this.mapLineColors); return;
                case 'undated':
                    // A phone: the list takes the legend's sheet's place.
                    if (lastLayout !== 'wide') { sheetOpen = false; this.renderMapLinesLegend(); this.openMapLinesUndated(); }
                    else this.toggleMapLinesUndated();
                    return;
            }
        });
        // A pointer that can hover: a row highlights its line while it is over it.
        host.addEventListener('mouseover', (e: MouseEvent) => {
            if (!window.matchMedia('(hover: hover)').matches || !this.mapLineColors) return;
            const row = (e.target as HTMLElement).closest('.map-lines-row[data-line]') as HTMLElement | null;
            this.setMapLineHover(row ? Number(row.dataset.line) : null);
        });
        host.addEventListener('mouseleave', () => this.setMapLineHover(null));
    },

    /** Highlight a line for a moment (hover), null = none; the pinned line comes back. */
    setMapLineHover(index: number | null): void {
        if (this.mapLineHover === index) return;
        this.mapLineHover = index;
        const container = document.getElementById('map-container');
        if (container && this.mapPathOn()) this.drawMapMarkers(container, this.mapPlaces());
        this.syncMapLinesRows();
    },

    /** The rows say which line is highlighted and which is pinned (without rebuilding the legend). */
    syncMapLinesRows(): void {
        const hi = this.mapLineColors ? this.mapLineHighlight() : null;
        document.querySelectorAll<HTMLElement>('.map-lines-rows .map-lines-row').forEach(row => {
            const i = row.dataset.line === undefined ? null : Number(row.dataset.line);
            row.classList.toggle('is-focus', hi !== null && i === hi);
            row.classList.toggle('is-dim', hi !== null && i !== hi);
            if (i !== null) row.setAttribute('aria-pressed', String(this.mapLineFocus === i));
        });
    },

    /** Pin a line (a second press on it lets go). */
    toggleMapLineFocus(index: number): void {
        this.mapLineFocus = this.mapLineFocus === index ? null : index;
        this.mapLineHover = null;
        this.refreshMapPath();
    },

    /** Quarters or eighths: the pinned line goes (its number means another line). */
    setMapLineMode(mode: LineMode): void {
        if (this.mapLineMode === mode) return;
        this.mapLineMode = mode;
        this.mapLineFocus = null;
        this.mapLineHover = null;
        this.refreshMapPath();
    },

    /** "No line colours": everything in --primary, the rows hidden; the chosen person stays. */
    setMapLineColors(on: boolean): void {
        this.mapLineColors = on;
        this.mapLineFocus = null;
        this.mapLineHover = null;
        this.refreshMapPath();
    },

    /** Fold the legend into its chip or unfold it; the map does not move. */
    setMapLegendCollapsed(collapsed: boolean): void {
        this.mapLegendCollapsed = collapsed;
        const hovered = this.mapLineHover !== null;
        this.mapLineHover = null;
        const active = document.activeElement as HTMLElement | null;
        const inLegend = !!active?.closest('.map-lines-legend, .map-lines-chip');
        this.renderMapLinesLegend();
        const container = document.getElementById('map-container');
        if (container && hovered) this.drawMapMarkers(container, this.mapPlaces());
        if (inLegend || document.activeElement === document.body) {
            const next = collapsed
                ? container?.querySelector<HTMLElement>('.map-lines-chip')
                : container?.querySelector<HTMLElement>('.map-lines-legend .map-lines-collapse');
            next?.focus();
        }
    },

    // ------------------------------------------------------------ ancestors off the timeline

    mapLinesUndatedOpen(): boolean {
        return undatedOpen;
    },

    /**
     * The list "Ancestors not on the timeline": each one's name, what is
     * missing (no birth date / no place / both) and "Person page ›"; under it
     * "Locations of places are added in Places ›".
     */
    mapLinesUndatedHtml(opts: { sheet?: boolean } = {}): string {
        const model = this.mapPathModel();
        if (!model) return '';
        const m = strings.map;
        const esc = (t: string): string => this.escapeHtml(t);
        const why = { date: m.missingDate, place: m.missingPlace, both: m.missingBoth } as const;
        const rows = model.missing.map(({ personId, reason }) => {
            const p = DataManager.getPerson(personId);
            if (!p) return '';
            return `<li class="map-lines-und-row"><span class="map-lines-und-text"><span class="map-lines-und-name">${esc(shownName(p))}</span>`
                + `<span class="map-lines-und-why">${esc(why[reason])}</span></span>`
                + `<button type="button" class="map-lines-link" data-act="person" data-person-id="${esc(personId)}">${esc(strings.fan.personPage)} ›</button></li>`;
        }).join('');
        return `${opts.sheet ? '<span class="map-lines-grip" aria-hidden="true"></span>' : ''}<div class="map-lines-und-head"><h3 class="map-lines-und-title">${esc(m.pathUndatedTitle)}</h3>`
            + `<button type="button" class="map-lines-und-close" data-act="close" aria-label="${esc(strings.buttons.close)}" title="${esc(strings.buttons.close)}">×</button></div>`
            + `<ul class="map-lines-und-list">${rows}</ul>`
            + `<p class="map-lines-und-foot">${esc(m.pathUndatedPlacesNote)} <button type="button" class="map-lines-link" data-act="places">${esc(strings.map.managePlaces)} ›</button></p>`;
    },

    /** The presses of the list, on any host (the popover, a phone's sheet). */
    bindMapLinesUndated(host: HTMLElement): void {
        host.addEventListener('click', (e: Event) => {
            const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
            if (!btn || !host.contains(btn)) return;
            if (btn.dataset.act === 'close') { this.closeMapLinesUndated(true); return; }
            if (btn.dataset.act === 'places') { this.closeMapLinesUndated(false); this.showPlacesManager(); return; }
            if (btn.dataset.act === 'person' && btn.dataset.personId) {
                this.closeMapLinesUndated(false);
                this.showPersonPage(btn.dataset.personId as PersonId);
            }
        });
    },

    toggleMapLinesUndated(): void {
        if (undatedOpen) this.closeMapLinesUndated(true);
        else this.openMapLinesUndated();
    },

    /** Open the list left of the legend. */
    openMapLinesUndated(): void {
        undatedOpen = true;
        this.renderMapLinesUndated();
        document.querySelector<HTMLElement>('#map-container .map-lines-und .map-lines-und-close')?.focus();
        if (!undatedOutsideBound) {
            undatedOutsideBound = true;
            document.addEventListener('pointerdown', (e: PointerEvent) => {
                if (!undatedOpen) return;
                const t = e.target as Element | null;
                if (t?.closest?.('.map-lines-und, [data-act="undated"]')) return;
                this.closeMapLinesUndated(false);
            }, true);
        }
    },

    renderMapLinesUndated(): void {
        const container = document.getElementById('map-container');
        if (!container) return;
        let pop = container.querySelector<HTMLElement>('.map-lines-und');
        if (!pop) {
            pop = document.createElement('div');
            pop.className = 'map-lines-und';
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-label', strings.map.pathUndatedTitle);
            container.appendChild(pop);
            this.bindMapLinesUndated(pop);
        }
        const sheet = lastLayout !== null && lastLayout !== 'wide';
        pop.classList.toggle('is-sheet', sheet);
        pop.classList.toggle('is-land', lastLayout === 'land');
        if (sheet) pop.style.cssText = '';
        pop.innerHTML = this.mapLinesUndatedHtml({ sheet });
        container.querySelector('.map-lines-legend [data-act="undated"]')?.setAttribute('aria-expanded', 'true');
        if (!sheet) this.positionMapLinesUndated();
    },

    /** Left of the legend, at its top; over it when the map has no room beside it. */
    positionMapLinesUndated(): void {
        const container = document.getElementById('map-container');
        const pop = container?.querySelector<HTMLElement>('.map-lines-und');
        const legend = container?.querySelector<HTMLElement>('.map-lines-legend');
        if (!container || !pop || !legend || pop.classList.contains('is-sheet')) return;
        const box = container.getBoundingClientRect();
        const r = legend.getBoundingClientRect();
        const width = Math.min(330, box.width - 24);
        const besideRight = box.right - r.left + 10;
        const right = box.width - besideRight - width >= 12 ? besideRight : box.right - r.right;
        pop.style.width = `${width}px`;
        pop.style.right = `${Math.round(right)}px`;
        pop.style.top = `${Math.round(r.top - box.top)}px`;
        const bar = container.querySelector<HTMLElement>('#map-timebar');
        const barRect = bar && !bar.hidden ? bar.getBoundingClientRect() : null;
        const floor = barRect && barRect.height > 0 ? barRect.top - box.top - 12 : box.height - 60;
        pop.style.maxHeight = `${Math.max(140, Math.round(floor - (r.top - box.top)))}px`;
    },

    /** Close the list; `refocus`: back to its "List ›". */
    closeMapLinesUndated(refocus: boolean): void {
        const container = document.getElementById('map-container');
        const was = undatedOpen;
        undatedOpen = false;
        container?.querySelector('.map-lines-und')?.remove();
        const link = container?.querySelector<HTMLElement>('.map-lines-legend [data-act="undated"]');
        link?.setAttribute('aria-expanded', 'false');
        // A phone: the legend's sheet gave way to the list, so its chip takes the focus.
        if (was && refocus) (link ?? container?.querySelector<HTMLElement>('.map-lines-chip'))?.focus();
    },

    // ------------------------------------------------------------ the place's bubble

    /**
     * The path's part of a place's bubble: the lines met here (a swatch and
     * "Surname · relation", an eighth "1 · Surname · relation"), the implex
     * sentence, and the rows of the ancestors (and the target) drawn here by
     * the year shown, each with its line's dot. '' without the path or nobody
     * of it here.
     */
    mapPathBubbleParts(key: string): { tags: string; implex: string; rows: string } | null {
        const model = this.mapPathModel();
        if (!model) return null;
        const year = this.mapTimeYear;
        const mode = this.mapLineMode;
        const colors = this.mapLineColors;
        const esc = (t: string): string => this.escapeHtml(t);
        const here = model.onMap.filter(a => a.pointKey === key && a.year! <= year);
        const targetHere = model.target.pointKey === key && model.target.year !== undefined && model.target.year <= year;
        if (here.length === 0 && !targetHere) return null;

        // The lines met here (not the parents' trunk).
        const tags: string[] = [];
        if (colors) {
            const seen = new Set<LineClass>();
            for (const a of here) {
                const cls = pointClassOf(a, mode);
                if (cls !== 'trunk') seen.add(cls);
            }
            for (const cls of sortLineClasses(seen)) {
                const eighth = cls[0] === 'e';
                const i = Number(cls.slice(1));
                const b = eighth ? model.eighths[i] : model.quarters[i];
                if (!b) continue;
                const text = eighth ? `${i + 1} · ${b.surname} · ${eighthRel(i)}` : `${b.surname} · ${quarterRel(i)}`;
                tags.push(`<span class="map-popup-line"><span class="map-popup-line-swatch" aria-hidden="true" style="background: ${lineSwatch(cls)};"></span>${esc(text)}</span>`);
            }
        }

        // One row per person (an implex person once, its dot split, ↻ after the name).
        const byPerson = new Map<PersonId, LineClass[]>();
        const firstYear = new Map<PersonId, number>();
        for (const a of here) {
            const list = byPerson.get(a.personId) ?? [];
            const cls = pointClassOf(a, mode);
            if (!list.includes(cls)) list.push(cls);
            byPerson.set(a.personId, list);
            firstYear.set(a.personId, Math.min(firstYear.get(a.personId) ?? Infinity, a.year!));
        }
        const implexIds = new Set(model.implex.map(i => i.personId));
        let implex = '';
        const entries = [...byPerson.entries()].sort((x, y) => firstYear.get(x[0])! - firstYear.get(y[0])!);
        const rows = entries.map(([id, classes]) => {
            const p = DataManager.getPerson(id);
            if (!p) return '';
            const twice = implexIds.has(id) && sortLineClasses(classes).length > 1;
            if (twice && !implex) implex = `${shownName(p)} ${strings.map.linesImplexShort}`;
            return this.mapPopupPathRow(id, shownName(p) + (twice ? ' ↻' : ''), firstYear.get(id)!, pointFill(classes, colors), false);
        });
        if (targetHere) {
            const name = this.mapPathName();
            rows.push(this.mapPopupPathRow(model.targetId, `◎ ${name}`, model.target.year!, 'var(--text)', true));
        }
        return {
            tags: tags.length ? `<div class="map-popup-lines">${tags.join('')}</div>` : '',
            implex: implex && colors ? `<div class="map-popup-implex">${esc(implex)}</div>` : '',
            rows: `<div class="map-popup-people is-rows">${rows.join('')}</div>`,
        };
    },

    /** A person row of the bubble in Migration over time: its dot, name and year; a press unfolds its actions. */
    mapPopupPathRow(id: PersonId, name: string, year: number | undefined, dot: string, isTarget: boolean, marks = ''): string {
        const esc = (t: string): string => this.escapeHtml(t);
        const open = bubbleExpanded === id;
        return `<div class="map-popup-prow${open ? ' is-open' : ''}${isTarget ? ' is-target' : ''}">`
            + `<button type="button" class="map-popup-person map-popup-person--row" data-person-id="${esc(id)}" aria-expanded="${open}">`
            + (dot ? `<span class="map-popup-dot" aria-hidden="true" style="background: ${dot};"></span>` : '')
            + (marks ? `<span class="map-popup-marks" aria-hidden="true">${marks}</span>` : '')
            + `<span class="map-popup-person-name">${esc(name)}</span>`
            + (year !== undefined ? `<span class="map-popup-person-year">* ${year}</span>` : '')
            + `</button>${open ? this.mapPopupPersonActs(id) : ''}</div>`;
    },

    /** "Person page ›" and "◎ Path to this person" (not for the person already chosen or one without an ancestor on the map). */
    mapPopupPersonActs(id: PersonId): string {
        const esc = (t: string): string => this.escapeHtml(t);
        const chosen = this.mapPathOn() && this.mapPathTarget === id;
        const can = !chosen && this.mapPathCount(id) > 0;
        return `<div class="map-popup-person-acts">`
            + `<button type="button" class="map-popup-act" data-pact="page" data-person-id="${esc(id)}">${esc(strings.fan.personPage)} ›</button>`
            + (can ? `<button type="button" class="map-popup-act" data-pact="path" data-person-id="${esc(id)}">◎ ${esc(strings.map.pathThisPerson)}</button>` : '')
            + `</div>`;
    },

    /** A person row of a bubble in Migration over time was pressed: its actions unfold (another row's fold). */
    toggleMapPopupPerson(row: HTMLElement): void {
        const id = row.dataset.personId as PersonId | undefined;
        const popup = row.closest('.map-popup');
        if (!id || !popup) return;
        const open = row.getAttribute('aria-expanded') !== 'true';
        popup.querySelectorAll<HTMLElement>('.map-popup-person[aria-expanded="true"]').forEach(other => {
            other.setAttribute('aria-expanded', 'false');
            other.closest('.map-popup-prow')?.classList.remove('is-open');
            other.parentElement?.querySelector('.map-popup-person-acts')?.remove();
        });
        bubbleExpanded = open ? id : null;
        if (!open) return;
        row.setAttribute('aria-expanded', 'true');
        row.closest('.map-popup-prow')?.classList.add('is-open');
        row.insertAdjacentHTML('afterend', this.mapPopupPersonActs(id));
    },

    /** A new bubble starts folded. */
    resetMapPopupPerson(): void {
        bubbleExpanded = null;
    },

    /** The year of a person as the bubble shows it ("* 1823"): birth, else nothing. */
    mapPopupBirthYear(id: PersonId): number | undefined {
        const p = DataManager.getPerson(id);
        return yearOf(p?.birthDate) ?? undefined;
    },
});

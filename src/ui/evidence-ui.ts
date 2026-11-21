/**
 * "Where evidence is missing" — for every tree, research or not. The tree
 * overview's Quality section counts people without a source, births without a
 * source and line ends (src/stats.ts computeEvidenceGaps); "Show in tree"
 * (src/ui/tree-overview.ts) dims everyone else and
 * frames them, with a pill at the top: "{what} · n", Next › (centres the next
 * one, by generation then name) and × to end. Changes that document a person
 * recount; when nobody is left the mode ends with a toast. Not kept over a
 * reload.
 *
 * "Evidence in tree" frames EVERY card by its evidence level (full solid,
 * partial dashed, none dotted, src/evidence-level.ts) without dimming; its
 * pill counts the three levels, and a count switches to the highlight of that
 * group (with Next ›), a second click back to all three. The same highlight
 * also shows other groups of people (the live research's "changed while
 * watching").
 *
 * The window's selection of people (src/ui/view-selection-ui.ts, spec 098)
 * is a group of kind 'selection': another group covers it and it comes back
 * when that one ends; its × (and Escape) clears the selection, its label
 * opens the choice. It stays up with nobody in it (an empty list, §12).
 */

import { canvasBusy } from './canvas-busy.js';
import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings } from '../strings.js';
import { PersonId, StromData } from '../types.js';
import { computeEvidenceGaps, EvidenceKind } from '../stats.js';
import { EvidenceLevel, evidenceLevels } from '../evidence-level.js';
import { assignGenerations } from '../generations.js';
import { birthResearchStatus } from '../tree-overview.js';
import { uiModule } from './module.js';
import { clearSelection, getSelection, selectionDataChanged, selectionUncovered, setHideOthers } from './view-selection-ui.js';
import { overviewChanged } from '../windows/overview-window.js';

/** A highlighted group of people: what it is, who, and where Next › stands. */
interface Highlight {
    kind: EvidenceKind | EvidenceLevel | 'changed' | 'direction' | 'direction-found' | 'ancestorGap' | 'selection';
    label: string;
    ids: PersonId[];
    index: number;
    /** Recount after a change (null: a fixed group). */
    recount: (() => PersonId[]) | null;
    /** A titled group ("Line ends: 41 people"): the title carries the count, the pill adds only "i / n" while stepping. */
    title?: (n: number) => string;
    /** Offer Cite on the current person (default: the groups without a (birth) source). */
    cite?: boolean;
    /** "Back to overview": ends the highlight and reopens where it was started from. */
    returnTo?: () => void;
    /** People shown faintly beside the group, recounted with it (a lineage's spouses). */
    faint?: () => PersonId[];
    /** Stays up with nobody in it (the window's selection, spec 098 §12). */
    keepEmpty?: boolean;
}

/** One group of people to highlight with the pill (the tree overview's cards and line ends). */
export interface HighlightGroup {
    kind: Highlight['kind'];
    title: (n: number) => string;
    personIds: PersonId[];
    /** Recount after a change (null: a fixed group). */
    recount: (() => PersonId[]) | null;
    cite: boolean;
    returnTo?: () => void;
    /** People shown faintly beside the group (neither framed nor dimmed), recounted with it. */
    faint?: () => PersonId[];
    /** Shown with nobody in it, the pill counting 0 and Next unavailable (the window's selection, spec 098 §12). */
    keepEmpty?: boolean;
}

/** The highlight being shown (null: none). */
let evidence: Highlight | null = null;
/** The Evidence mode: every card framed by its level. */
let levelsMode = false;
let listening = false;

const LEVELS: EvidenceLevel[] = ['full', 'partial', 'none'];

function levelLabel(level: EvidenceLevel): string {
    const s = strings.treeHealth;
    return level === 'full' ? s.evFull : level === 'partial' ? s.evPartial : s.evNone;
}

/** People in the order Next walks them: generation, then name. */
function walkOrder(data: StromData, ids: Iterable<PersonId>): PersonId[] {
    const gen = assignGenerations(data);
    const name = (id: PersonId): string => {
        const p = data.persons[id];
        return `${p?.lastName ?? ''} ${p?.firstName ?? ''}`.trim();
    };
    return [...ids].sort((a, b) => (gen.get(a) ?? 0) - (gen.get(b) ?? 0) || name(a).localeCompare(name(b)));
}

/** The people of one evidence level, in walk order. */
function levelIds(data: StromData, level: EvidenceLevel): PersonId[] {
    const ids: PersonId[] = [];
    for (const [id, l] of evidenceLevels(data)) if (l === level) ids.push(id);
    return walkOrder(data, ids);
}

/** The people of `kind` in `data`, in the order Next walks them: generation, then name. */
export function evidenceIds(data: StromData, kind: EvidenceKind, focus: PersonId | null): PersonId[] {
    return walkOrder(data, computeEvidenceGaps(data, focus)[kind]);
}

/** The pill just came up: the tree pans so that it covers no card (the focus kept in the view). */
function cardsClearOfPill(): void {
    ZoomPan.keepCardsClearOfPills(TreeRenderer.getFocusPersonId());
}

export const evidenceUiMethods = uiModule({
    listenForEvidenceChanges(): void {
        if (listening) return;
        listening = true;
        window.addEventListener('strom:data-changed', () => this.refreshEvidenceHighlight());
        window.addEventListener('strom:tree-switched', () => this.refreshEvidenceHighlight());
    },

    /**
     * Highlight a group of people (dim the rest) with the pill; nobody: a toast.
     * `quiet`: the group followed a filter, nobody asked for it anew (the
     * overview's own window then does not bring the main window forward).
     */
    startPersonHighlight(kind: Highlight['kind'], label: string, ids: PersonId[], recount: (() => PersonId[]) | null, _opts?: { quiet?: boolean }): void {
        this.listenForEvidenceChanges();
        if (ids.length === 0) {
            this.showToast(strings.treeHealth.highlightDone, 4000);
            return;
        }
        if (!LEVELS.includes(kind as EvidenceLevel)) levelsMode = false;
        evidence = { kind, label, ids, index: -1, recount };
        TreeRenderer.setEvidenceLevels(null);
        TreeRenderer.setEvidenceHighlight(new Set(ids));
        this.renderEvidencePill();
        cardsClearOfPill();
        this.syncPersonFilter();
    },

    /**
     * Highlight a titled group: the pill shows "{title}", "i / n" while
     * stepping, Next ›, Cite (only when `cite`), "Back to overview" (with
     * `returnTo`) and ×. Nobody in it: a toast.
     */
    highlightGroup(group: HighlightGroup): void {
        this.listenForEvidenceChanges();
        if (group.personIds.length === 0 && !group.keepEmpty) {
            this.showToast(strings.treeHealth.highlightDone, 4000);
            return;
        }
        levelsMode = false;
        evidence = {
            kind: group.kind, label: group.title(group.personIds.length), ids: [...group.personIds], index: -1,
            recount: group.recount, title: group.title, cite: group.cite, returnTo: group.returnTo, faint: group.faint,
            keepEmpty: group.keepEmpty,
        };
        TreeRenderer.setEvidenceLevels(null);
        TreeRenderer.setEvidenceHighlight(new Set(evidence.ids), group.faint ? new Set(group.faint()) : null, group.kind === 'selection');
        this.renderEvidencePill();
        cardsClearOfPill();
        // "Hide others" of the window's selection holds only while it is highlighted (§12: another group covers it)
        this.syncPersonFilter();
    },

    /** The Evidence mode: every card framed by its level, the pill counting them. */
    showEvidenceLevels(): void {
        this.listenForEvidenceChanges();
        levelsMode = true;
        evidence = null;
        TreeRenderer.setEvidenceHighlight(null);
        TreeRenderer.setEvidenceLevels(evidenceLevels(DataManager.getData()));
        this.renderEvidencePill();
        cardsClearOfPill();
        this.syncPersonFilter();
    },

    /** A count in the Evidence pill: that group highlighted (again: back to all three). */
    toggleEvidenceLevelGroup(level: EvidenceLevel): void {
        if (evidence?.kind === level) {
            this.showEvidenceLevels();
            return;
        }
        const recount = () => levelIds(DataManager.getData(), level);
        const ids = recount();
        if (ids.length === 0) return;
        evidence = { kind: level, label: levelLabel(level), ids, index: -1, recount };
        TreeRenderer.setEvidenceLevels(null);
        TreeRenderer.setEvidenceHighlight(new Set(ids));
        this.renderEvidencePill();
        this.syncPersonFilter();
    },

    /**
     * "Hide others" (spec 098 §8) to the tree: the window's selection's people
     * (a family line's spouses who married in with them) while its highlight
     * holds the pill and "Hide others" is on; otherwise everyone.
     */
    syncPersonFilter(): void {
        const sel = getSelection();
        if (!sel.ref || !sel.hideOthers || evidence?.kind !== 'selection') {
            TreeRenderer.setPersonFilter(null);
            return;
        }
        const ids = new Set(evidence.ids);
        if (evidence.faint) for (const id of evidence.faint()) ids.add(id);
        TreeRenderer.setPersonFilter(ids);
    },

    /** Which group the pill highlights now (null: none). */
    evidenceHighlightKind(): Highlight['kind'] | null {
        return evidence?.kind ?? null;
    },

    /** The group the pill highlights now, by kind and its name (null: none; the overview's own window shows it). */
    evidenceHighlightNow(): { kind: string; label: string } | null {
        return evidence ? { kind: evidence.kind, label: evidence.label } : null;
    },

    isEvidenceHighlightOn(): boolean {
        return evidence !== null || levelsMode;
    },

    /** Recount after a change or a tree switch; nobody left ends the mode. */
    refreshEvidenceHighlight(): void {
        // The window's selection first: the tree's remembered one put back, one gone cleared.
        selectionDataChanged();
        if (levelsMode && !evidence) {
            TreeRenderer.setEvidenceLevels(evidenceLevels(DataManager.getData()));
            this.renderEvidencePill();
            return;
        }
        if (!evidence || !evidence.recount) return;
        const ids = evidence.recount();
        if (ids.length === 0 && !evidence.keepEmpty) {
            if (levelsMode) {
                this.showEvidenceLevels();
                return;
            }
            this.endEvidenceHighlight();
            this.showToast(strings.treeHealth.highlightDone, 4000);
            return;
        }
        const current = evidence.ids[evidence.index];
        evidence = { ...evidence, ids, index: current ? ids.indexOf(current) : -1 };
        TreeRenderer.setEvidenceHighlight(new Set(ids), evidence.faint ? new Set(evidence.faint()) : null, evidence.kind === 'selection');
        this.renderEvidencePill();
        this.syncPersonFilter();
    },

    /** Next ›: centre the next person (the chart re-centres on them when they are not drawn). */
    evidenceNext(): void {
        if (!evidence || evidence.ids.length === 0) return;
        evidence.index = (evidence.index + 1) % evidence.ids.length;
        const id = evidence.ids[evidence.index];
        this.renderEvidencePill();
        if (document.querySelector(`.person-card[data-id="${CSS.escape(id)}"]`)) {
            ZoomPan.centerOnPerson(id);
        } else {
            // B139, 8a: the tree laid out anew round the next person under the canvas overlay (painted first).
            void canvasBusy(() => TreeRenderer.setFocus(id));
        }
    },

    endEvidenceHighlight(): void {
        evidence = null;
        levelsMode = false;
        TreeRenderer.setEvidenceHighlight(null);
        TreeRenderer.setEvidenceLevels(null);
        document.getElementById('evidence-pill')?.remove();
        // Another group ended: the window's selection comes back from under it.
        selectionUncovered();
        this.syncPersonFilter();
        // The overview's own window says what is lit here.
        overviewChanged();
    },

    /**
     * ×, Escape, "Back to overview": the group ends; on the window's
     * selection that clears it (and forgets it).
     */
    dismissEvidenceHighlight(): void {
        if (evidence?.kind === 'selection') clearSelection();
        if (evidence || levelsMode) this.endEvidenceHighlight();
    },

    /**
     * The pill: "{what} · n", Next ›, ×. In the Evidence mode: "Evidence" and
     * the three counts as buttons (the active group pressed), Next › only
     * while a group is highlighted. Hidden on the timeline and map (the mode
     * stays).
     */
    renderEvidencePill(): void {
        if (!evidence && !levelsMode) return;
        // The overview's own window says what is lit here (a new group, a recount).
        overviewChanged();
        const s = strings.treeHealth;
        let pill = document.getElementById('evidence-pill');
        if (!pill) {
            pill = document.createElement('div');
            pill.id = 'evidence-pill';
            pill.className = 'evidence-pill';
            pill.setAttribute('role', 'region');
            // Before the live-follow pill: the stylesheet stacks that one after this one (`~`).
            document.body.insertBefore(pill, document.getElementById('live-follow-pill'));
        }
        pill.setAttribute('aria-label', levelsMode ? s.evidenceMode : s.evidenceTitle);
        pill.replaceChildren();
        pill.classList.remove('evidence-pill--sel');
        const label = document.createElement('span');
        label.className = 'evidence-pill-label';
        const what = document.createElement('strong');
        if (levelsMode) {
            what.textContent = s.evidenceMode;
            label.append(what);
            pill.append(label);
            const counts = evidenceLevels(DataManager.getData());
            const levels = document.createElement('span');
            levels.className = 'evidence-pill-levels sel-seg';
            pill.append(levels);
            for (const level of LEVELS) {
                let n = 0;
                for (const l of counts.values()) if (l === level) n++;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `evidence-pill-level evidence-pill-level-${level} sel-opt`;
                btn.dataset.selForm = 'seg';
                btn.setAttribute('aria-pressed', String(evidence?.kind === level));
                btn.setAttribute('aria-label', `${levelLabel(level)}: ${n}`);
                btn.title = levelLabel(level);
                // The level drawn as the cards' frame in this mode (solid, dashed, dotted): a glyph like ◐ comes
                // from a fallback font at another size.
                const swatch = document.createElement('span');
                swatch.className = `evidence-pill-swatch evl-swatch-${level}`;
                swatch.setAttribute('aria-hidden', 'true');
                btn.append(swatch, document.createTextNode(String(n)));
                btn.disabled = n === 0;
                btn.onclick = () => this.toggleEvidenceLevelGroup(level);
                levels.append(btn);
            }
        } else if (evidence) {
            // While going through them: where you are ("3 / 16").
            const n = evidence.ids.length;
            const stepping = evidence.index >= 0 && evidence.index < n;
            if (evidence.title) {
                what.textContent = evidence.title(n);
                label.append(what);
                if (stepping) label.append(document.createTextNode(` · ${evidence.index + 1} / ${n}`));
            } else {
                what.textContent = evidence.label;
                label.append(what, document.createTextNode(stepping ? ` · ${evidence.index + 1} / ${n}` : ` · ${n}`));
            }
            if (evidence.kind === 'selection') {
                // The window's selection (spec 039 §3.1, 098 §8): the label opens the choice.
                const pick = document.createElement('button');
                pick.type = 'button';
                pick.className = 'evidence-pill-label evidence-pill-label--pick';
                pick.setAttribute('aria-haspopup', 'listbox');
                pick.setAttribute('aria-label', strings.selection.change);
                pick.title = label.textContent ?? '';
                const chev = document.createElement('span');
                chev.className = 'evidence-pill-pick-chev';
                chev.setAttribute('aria-hidden', 'true');
                chev.textContent = '▾';
                // The text cut with an ellipsis, the chevron always shown.
                const text = document.createElement('span');
                text.className = 'evidence-pill-pick-text';
                text.append(...label.childNodes);
                pick.append(text, chev);
                pick.onclick = () => this.openSelectionPicker();
                pill.append(pick);
                // "Hide others" (§8): the tree laid out from the selection alone (not in the fan: CSS)
                const sep = document.createElement('span');
                sep.className = 'evidence-pill-sep';
                sep.setAttribute('aria-hidden', 'true');
                const hide = document.createElement('button');
                hide.type = 'button';
                hide.className = 'evidence-pill-hide sel-opt';
                const on = getSelection().hideOthers;
                hide.setAttribute('aria-pressed', String(on));
                hide.title = strings.selection.hideOthersTitle;
                const box = document.createElement('span');
                box.className = 'bx';
                box.setAttribute('aria-hidden', 'true');
                box.textContent = '✓';
                const words = document.createElement('span');
                words.className = 'evidence-pill-hide-t';
                words.textContent = strings.selection.hideOthers;
                hide.append(box, words);
                hide.onclick = () => setHideOthers(!getSelection().hideOthers);
                pill.append(sep, hide);
                pill.classList.add('evidence-pill--sel');
            } else {
                pill.append(label);
            }
        }
        pill.classList.toggle('evidence-pill--back', !!evidence?.returnTo);
        if (evidence) {
            const next = document.createElement('button');
            next.type = 'button';
            next.className = 'evidence-pill-next';
            next.textContent = s.next;
            // An empty selection (§12): nobody to go to.
            next.disabled = evidence.ids.length === 0;
            next.onclick = () => this.evidenceNext();
            pill.append(next);
            // Going through the people without a (birth) source: cite right here.
            const current = evidence.index >= 0 ? evidence.ids[evidence.index] : undefined;
            const kind = evidence.kind;
            const citable = evidence.cite ?? (kind === 'birthNoSource' || kind === 'noSource');
            // A birth the research grades: one more citation does not prove it, the research
            // does (K3.2) — its sources instead.
            const graded = !!current && kind === 'birthNoSource' && !!DataManager.getPerson(current)
                && birthResearchStatus(DataManager.getPerson(current)!) !== undefined;
            if (current && citable && graded) {
                const sources = document.createElement('button');
                sources.type = 'button';
                sources.className = 'evidence-pill-sources';
                sources.textContent = s.sourcesAction;
                sources.onclick = () => {
                    this.pushDialog('person-sources-modal');
                    this.showPersonSourcesDialog(current);
                };
                pill.append(sources);
            } else if (current && citable && (kind === 'birthNoSource' || kind === 'noSource') && this.canCiteOnPerson(current)) {
                const cite = document.createElement('button');
                cite.type = 'button';
                cite.className = 'evidence-pill-cite';
                cite.textContent = s.citeAction;
                cite.onclick = () => (kind === 'birthNoSource'
                    ? this.showSourcePickerForPersonFact(current, 'birth')
                    : this.showSourcePickerForPersonId(current, true));
                pill.append(cite);
            }
            const returnTo = evidence.returnTo;
            if (returnTo) {
                const back = document.createElement('button');
                back.type = 'button';
                back.className = 'evidence-pill-back';
                back.textContent = strings.treeOverview.back;
                back.onclick = () => {
                    this.dismissEvidenceHighlight();
                    returnTo();
                };
                pill.append(back);
            }
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'evidence-pill-close';
        close.innerHTML = '&times;';
        // The window's selection: × clears it (spec 098 §1.1).
        const closeText = evidence?.kind === 'selection' ? strings.selection.clear : s.highlightEnd;
        close.setAttribute('aria-label', closeText);
        close.title = closeText;
        close.onclick = () => this.dismissEvidenceHighlight();
        pill.append(close);
    },
});

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
 */

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

/** A highlighted group of people: what it is, who, and where Next › stands. */
interface Highlight {
    kind: EvidenceKind | EvidenceLevel | 'changed' | 'direction' | 'ancestorGap';
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
}

/** The highlight being shown (null: none). */
let evidence: Highlight | null = null;
/** The Evidence mode: every card framed by its level. */
let levelsMode = false;
let listening = false;

const LEVELS: EvidenceLevel[] = ['full', 'partial', 'none'];
const LEVEL_GLYPH: Record<EvidenceLevel, string> = { full: '●', partial: '◐', none: '○' };

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

export const evidenceUiMethods = uiModule({
    listenForEvidenceChanges(): void {
        if (listening) return;
        listening = true;
        window.addEventListener('strom:data-changed', () => this.refreshEvidenceHighlight());
        window.addEventListener('strom:tree-switched', () => this.refreshEvidenceHighlight());
    },

    /** Highlight a group of people (dim the rest) with the pill; nobody: a toast. */
    startPersonHighlight(kind: Highlight['kind'], label: string, ids: PersonId[], recount: (() => PersonId[]) | null): void {
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
    },

    /**
     * Highlight a titled group: the pill shows "{title}", "i / n" while
     * stepping, Next ›, Cite (only when `cite`), "Back to overview" (with
     * `returnTo`) and ×. Nobody in it: a toast.
     */
    highlightGroup(group: HighlightGroup): void {
        this.listenForEvidenceChanges();
        if (group.personIds.length === 0) {
            this.showToast(strings.treeHealth.highlightDone, 4000);
            return;
        }
        levelsMode = false;
        evidence = {
            kind: group.kind, label: group.title(group.personIds.length), ids: [...group.personIds], index: -1,
            recount: group.recount, title: group.title, cite: group.cite, returnTo: group.returnTo,
        };
        TreeRenderer.setEvidenceLevels(null);
        TreeRenderer.setEvidenceHighlight(new Set(evidence.ids));
        this.renderEvidencePill();
    },

    /** The Evidence mode: every card framed by its level, the pill counting them. */
    showEvidenceLevels(): void {
        this.listenForEvidenceChanges();
        levelsMode = true;
        evidence = null;
        TreeRenderer.setEvidenceHighlight(null);
        TreeRenderer.setEvidenceLevels(evidenceLevels(DataManager.getData()));
        this.renderEvidencePill();
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
    },

    /** Which group the pill highlights now (null: none). */
    evidenceHighlightKind(): Highlight['kind'] | null {
        return evidence?.kind ?? null;
    },

    isEvidenceHighlightOn(): boolean {
        return evidence !== null || levelsMode;
    },

    /** Recount after a change or a tree switch; nobody left ends the mode. */
    refreshEvidenceHighlight(): void {
        if (levelsMode && !evidence) {
            TreeRenderer.setEvidenceLevels(evidenceLevels(DataManager.getData()));
            this.renderEvidencePill();
            return;
        }
        if (!evidence || !evidence.recount) return;
        const ids = evidence.recount();
        if (ids.length === 0) {
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
        TreeRenderer.setEvidenceHighlight(new Set(ids));
        this.renderEvidencePill();
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
            TreeRenderer.setFocus(id);
            void TreeRenderer.renderAsync().then(() => ZoomPan.centerOnPerson(id));
        }
    },

    endEvidenceHighlight(): void {
        evidence = null;
        levelsMode = false;
        TreeRenderer.setEvidenceHighlight(null);
        TreeRenderer.setEvidenceLevels(null);
        document.getElementById('evidence-pill')?.remove();
    },

    /**
     * The pill: "{what} · n", Next ›, ×. In the Evidence mode: "Evidence" and
     * the three counts as buttons (the active group pressed), Next › only
     * while a group is highlighted. Hidden on the timeline and map (the mode
     * stays).
     */
    renderEvidencePill(): void {
        if (!evidence && !levelsMode) return;
        const s = strings.treeHealth;
        let pill = document.getElementById('evidence-pill');
        if (!pill) {
            pill = document.createElement('div');
            pill.id = 'evidence-pill';
            pill.className = 'evidence-pill';
            pill.setAttribute('role', 'region');
            document.body.appendChild(pill);
        }
        pill.setAttribute('aria-label', levelsMode ? s.evidenceMode : s.evidenceTitle);
        pill.replaceChildren();
        const label = document.createElement('span');
        label.className = 'evidence-pill-label';
        const what = document.createElement('strong');
        if (levelsMode) {
            what.textContent = s.evidenceMode;
            label.append(what);
            pill.append(label);
            const counts = evidenceLevels(DataManager.getData());
            for (const level of LEVELS) {
                let n = 0;
                for (const l of counts.values()) if (l === level) n++;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `evidence-pill-level evidence-pill-level-${level}`;
                btn.setAttribute('aria-pressed', String(evidence?.kind === level));
                btn.setAttribute('aria-label', `${levelLabel(level)}: ${n}`);
                btn.title = levelLabel(level);
                btn.textContent = `${LEVEL_GLYPH[level]} ${n}`;
                btn.disabled = n === 0;
                btn.onclick = () => this.toggleEvidenceLevelGroup(level);
                pill.append(btn);
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
            pill.append(label);
        }
        pill.classList.toggle('evidence-pill--back', !!evidence?.returnTo);
        if (evidence) {
            const next = document.createElement('button');
            next.type = 'button';
            next.className = 'evidence-pill-next';
            next.textContent = s.next;
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
                    this.endEvidenceHighlight();
                    returnTo();
                };
                pill.append(back);
            }
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'evidence-pill-close';
        close.innerHTML = '&times;';
        close.setAttribute('aria-label', s.highlightEnd);
        close.title = s.highlightEnd;
        close.onclick = () => this.endEvidenceHighlight();
        pill.append(close);
    },
});

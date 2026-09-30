/**
 * "Where evidence is missing" — for every tree, research or not. Tree health
 * counts people without a source, births without a source and line ends
 * (src/stats.ts computeEvidenceGaps); "Show in tree" dims everyone else and
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
import { TreeManager } from '../tree-manager.js';
import { ZoomPan } from '../zoom.js';
import { strings } from '../strings.js';
import { PersonId, StromData, TreeId } from '../types.js';
import { computeEvidenceGaps, EvidenceKind } from '../stats.js';
import { EvidenceLevel, evidenceLevels } from '../evidence-level.js';
import { assignGenerations } from '../generations.js';
import { uiModule } from './module.js';

/** A highlighted group of people: what it is, who, and where Next › stands. */
interface Highlight {
    kind: EvidenceKind | EvidenceLevel | 'changed' | 'direction';
    label: string;
    ids: PersonId[];
    index: number;
    /** Recount after a change (null: a fixed group). */
    recount: (() => PersonId[]) | null;
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

const KINDS: EvidenceKind[] = ['noSource', 'birthNoSource', 'lineEnds'];

function kindLabel(kind: EvidenceKind): string {
    const s = strings.treeHealth;
    return kind === 'noSource' ? s.noSource : kind === 'birthNoSource' ? s.birthNoSource : s.lineEnds;
}

/** The people of `kind` in `data`, in the order Next walks them: generation, then name. */
function evidenceIds(data: StromData, kind: EvidenceKind, focus: PersonId | null): PersonId[] {
    return walkOrder(data, computeEvidenceGaps(data, focus)[kind]);
}

export const evidenceUiMethods = uiModule({
    /** The tree-health section (HTML): counts, "Show in tree", or the all-good sentence. */
    evidenceHealthHtml(data: StromData, treeId: string): string {
        const s = strings.treeHealth;
        const focus = DataManager.getCurrentTreeId() === treeId ? TreeRenderer.getFocusPersonId() : null;
        const gaps = computeEvidenceGaps(data, focus ?? data.lastFocusPersonId ?? null);
        const rows = KINDS.filter(k => gaps[k].length > 0);
        const body = rows.length === 0
            ? `<div class="health-block-hint health-evidence-good">${this.escapeHtml(s.evidenceAllGood)}</div>`
            : rows.map((k, i) => `
                <div class="health-evidence-row">
                    <span class="health-evidence-label">${this.escapeHtml(kindLabel(k))}</span>
                    <span class="health-evidence-count">${this.escapeHtml(i === 0 ? s.ofTotal(gaps[k].length, gaps.total) : String(gaps[k].length))}</span>
                    <button type="button" class="secondary health-evidence-show" data-evidence="${k}">${this.escapeHtml(s.showInTree)}</button>
                </div>`).join('');
        const levels = `
                <div class="health-evidence-row health-evidence-levels">
                    <span class="health-evidence-label">${this.escapeHtml(s.showEvidence)}</span>
                    <span class="health-evidence-spacer" aria-hidden="true"></span>
                    <button type="button" class="secondary health-evidence-show" data-evidence="levels">${this.escapeHtml(s.showInTree)}</button>
                </div>`;
        return `
            <div class="health-block health-evidence">
                <div class="health-block-title">${this.escapeHtml(s.evidenceTitle)}</div>
                ${body}
                ${levels}
            </div>`;
    },

    /** "Show in tree": close tree health, switch to its tree, start the highlight. */
    async showEvidenceInTree(kind: EvidenceKind | 'levels', treeId: string): Promise<void> {
        this.closeTreeHealthDialog();
        if (TreeManager.getActiveTreeId() !== treeId) await this.switchToTree(treeId as TreeId);
        this.listenForEvidenceChanges();
        if (kind === 'levels') {
            this.showEvidenceLevels();
            return;
        }
        const recount = () => evidenceIds(DataManager.getData(), kind, TreeRenderer.getFocusPersonId());
        this.startPersonHighlight(kind, kindLabel(kind), recount(), recount);
    },

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
            what.textContent = evidence.label;
            // While going through them: where you are ("3 / 16").
            const n = evidence.ids.length;
            label.append(what, document.createTextNode(evidence.index >= 0 && evidence.index < n ? ` · ${evidence.index + 1} / ${n}` : ` · ${n}`));
            pill.append(label);
        }
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
            if (current && (kind === 'birthNoSource' || kind === 'noSource') && this.canCiteOnPerson(current)) {
                const cite = document.createElement('button');
                cite.type = 'button';
                cite.className = 'evidence-pill-cite';
                cite.textContent = s.citeAction;
                cite.onclick = () => (kind === 'birthNoSource'
                    ? this.showSourcePickerForPersonFact(current, 'birth')
                    : this.showSourcePickerForPersonId(current, true));
                pill.append(cite);
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

/**
 * "Where evidence is missing" — for every tree, research or not. Tree health
 * counts people without a source, births without a source and line ends
 * (src/stats.ts computeEvidenceGaps); "Show in tree" dims everyone else and
 * frames them, with a pill at the top: "{what} · n", Next › (centres the next
 * one, by generation then name) and × to end. Changes that document a person
 * recount; when nobody is left the mode ends with a toast. Not kept over a
 * reload.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { TreeManager } from '../tree-manager.js';
import { ZoomPan } from '../zoom.js';
import { strings } from '../strings.js';
import { PersonId, StromData, TreeId } from '../types.js';
import { computeEvidenceGaps, EvidenceKind } from '../stats.js';
import { assignGenerations } from '../generations.js';
import { uiModule } from './module.js';

/** The highlight being shown (null: none). */
let evidence: { kind: EvidenceKind; ids: PersonId[]; index: number } | null = null;
let listening = false;

const KINDS: EvidenceKind[] = ['noSource', 'birthNoSource', 'lineEnds'];

function kindLabel(kind: EvidenceKind): string {
    const s = strings.treeHealth;
    return kind === 'noSource' ? s.noSource : kind === 'birthNoSource' ? s.birthNoSource : s.lineEnds;
}

/** The people of `kind` in `data`, in the order Next walks them: generation, then name. */
function evidenceIds(data: StromData, kind: EvidenceKind, focus: PersonId | null): PersonId[] {
    const ids = computeEvidenceGaps(data, focus)[kind];
    const gen = assignGenerations(data);
    const name = (id: PersonId): string => {
        const p = data.persons[id];
        return `${p?.lastName ?? ''} ${p?.firstName ?? ''}`.trim();
    };
    return [...ids].sort((a, b) => (gen.get(a) ?? 0) - (gen.get(b) ?? 0) || name(a).localeCompare(name(b)));
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
        return `
            <div class="health-block health-evidence">
                <div class="health-block-title">${this.escapeHtml(s.evidenceTitle)}</div>
                ${body}
            </div>`;
    },

    /** "Show in tree": close tree health, switch to its tree, start the highlight. */
    async showEvidenceInTree(kind: EvidenceKind, treeId: string): Promise<void> {
        this.closeTreeHealthDialog();
        if (TreeManager.getActiveTreeId() !== treeId) await this.switchToTree(treeId as TreeId);
        if (!listening) {
            listening = true;
            window.addEventListener('strom:data-changed', () => this.refreshEvidenceHighlight());
            window.addEventListener('strom:tree-switched', () => this.refreshEvidenceHighlight());
        }
        const ids = evidenceIds(DataManager.getData(), kind, TreeRenderer.getFocusPersonId());
        if (ids.length === 0) {
            this.showToast(strings.treeHealth.highlightDone, 4000);
            return;
        }
        evidence = { kind, ids, index: -1 };
        TreeRenderer.setEvidenceHighlight(new Set(ids));
        this.renderEvidencePill();
    },

    isEvidenceHighlightOn(): boolean {
        return evidence !== null;
    },

    /** Recount after a change or a tree switch; nobody left ends the mode. */
    refreshEvidenceHighlight(): void {
        if (!evidence) return;
        const ids = evidenceIds(DataManager.getData(), evidence.kind, TreeRenderer.getFocusPersonId());
        if (ids.length === 0) {
            this.endEvidenceHighlight();
            this.showToast(strings.treeHealth.highlightDone, 4000);
            return;
        }
        const current = evidence.ids[evidence.index];
        evidence = { kind: evidence.kind, ids, index: current ? ids.indexOf(current) : -1 };
        TreeRenderer.setEvidenceHighlight(new Set(ids));
        this.renderEvidencePill();
    },

    /** Next ›: centre the next person (the chart re-centres on them when they are not drawn). */
    evidenceNext(): void {
        if (!evidence || evidence.ids.length === 0) return;
        evidence.index = (evidence.index + 1) % evidence.ids.length;
        const id = evidence.ids[evidence.index];
        if (document.querySelector(`.person-card[data-id="${CSS.escape(id)}"]`)) {
            ZoomPan.centerOnPerson(id);
        } else {
            TreeRenderer.setFocus(id);
            void TreeRenderer.renderAsync().then(() => ZoomPan.centerOnPerson(id));
        }
    },

    endEvidenceHighlight(): void {
        evidence = null;
        TreeRenderer.setEvidenceHighlight(null);
        document.getElementById('evidence-pill')?.remove();
    },

    /** The pill: "{what} · n", Next ›, ×. Hidden on the timeline and map (the mode stays). */
    renderEvidencePill(): void {
        if (!evidence) return;
        const s = strings.treeHealth;
        let pill = document.getElementById('evidence-pill');
        if (!pill) {
            pill = document.createElement('div');
            pill.id = 'evidence-pill';
            pill.className = 'evidence-pill';
            pill.setAttribute('role', 'region');
            document.body.appendChild(pill);
        }
        pill.setAttribute('aria-label', s.evidenceTitle);
        pill.replaceChildren();
        const label = document.createElement('span');
        label.className = 'evidence-pill-label';
        const what = document.createElement('strong');
        what.textContent = kindLabel(evidence.kind);
        label.append(what, document.createTextNode(` · ${evidence.ids.length}`));
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'evidence-pill-next';
        next.textContent = s.next;
        next.onclick = () => this.evidenceNext();
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'evidence-pill-close';
        close.innerHTML = '&times;';
        close.setAttribute('aria-label', s.highlightEnd);
        close.title = s.highlightEnd;
        close.onclick = () => this.endEvidenceHighlight();
        pill.append(label, next, close);
    },
});

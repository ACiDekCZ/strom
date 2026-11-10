/**
 * Table view (spec 073 §16.4): the research bubble of a cell drawn and its
 * actions run. The content comes from table-research-bubble.ts; this opens
 * it as a panel under the cell (a computer, 400 px) or a sheet from the
 * bottom (a phone, 44 px actions), fills a waiting item's answer with the
 * waiting panel's own control and runs each action by what it is:
 *
 * - in the app: Compare versions, Awaiting decision, What the research
 *   knows on a conflict or its questions, the materials, the line or side
 *   branch lit in the Family view, the line in the research's overview, a
 *   source in the Sources table;
 * - a research link (a decision of a hypothesis to review, a queued task)
 *   launched with the mark its link's group has; following the research
 *   live opens the live panel while it is followed;
 * - through the bridge: the family tree's value put back;
 * - the web: an archive's website in a new window (a link, ↗).
 *
 * An action whose research link the research did not announce is left out.
 */

import { DataManager } from '../../data.js';
import { TreeRenderer } from '../../renderer.js';
import { ZoomPan } from '../../zoom.js';
import { isPhoneBar } from '../../breakpoints.js';
import type { PersonId } from '../../types.js';
import { uiModule } from '../module.js';
import { liveSession } from '../research-ui.js';
import { closeTableBubble, openBubblePanel, researchBubbleHtml, researchBubbleTitle, sheetElement } from './table-bubble.js';
import { researchBubbleActions, type ResearchBubble, type ResearchBubbleAction } from './table-research-bubble.js';
import { personLineRole, researchBranchName, type ResearchTableEnv } from './table-research.js';

/** Where a bubble opens on a computer: under the rectangle, the focus back to the cell when it closes by a key. */
export interface ResearchBubbleAnchor {
    rect: DOMRect;
    focusBack: () => HTMLElement | null;
    scroller?: HTMLElement | null;
}

export const tableResearchMethods = uiModule({
    /** A research bubble (§16.4): a panel under the cell, a sheet on a phone. */
    openTableResearchBubble(env: ResearchTableEnv, b: ResearchBubble, anchor: ResearchBubbleAnchor): void {
        const all = researchBubbleActions(b);
        const shown = (a: ResearchBubbleAction): boolean => this.tableResearchActionShown(a);
        const title = researchBubbleTitle(b);
        const run = (act: string, i: number): void => {
            const a = act === 'r' ? all[i] : undefined;
            if (a) this.runTableResearchAction(env, a);
        };
        if (isPhoneBar()) {
            const sheet = sheetElement(title, researchBubbleHtml(b, true, shown), 'research', () => this.hideBottomSheet(), run);
            this.fillTableResearchBubble(env, sheet, all, () => this.hideBottomSheet());
            this.showTableSheet(sheet);
            return;
        }
        openBubblePanel({
            rect: anchor.rect, label: title, html: researchBubbleHtml(b, false, shown), kind: 'research',
            focusBack: anchor.focusBack, scroller: anchor.scroller ?? null, onAction: run,
            fill: (el) => this.fillTableResearchBubble(env, el, all, () => closeTableBubble(false)),
        });
    },

    /**
     * The bubble's controls built in the DOM: a waiting item's answer is the
     * waiting panel's own (its mark is the item's), an empty slot when nothing
     * answers it here. Any control used, the website's link too, closes the
     * bubble after its click has run.
     */
    fillTableResearchBubble(env: ResearchTableEnv, el: HTMLElement, all: readonly ResearchBubbleAction[], close: () => void): void {
        const later = (): void => { setTimeout(close, 0); };
        for (const slot of el.querySelectorAll<HTMLElement>('[data-witem]')) {
            const a = all[Number(slot.dataset.witem)];
            const refn = a ? env.data.persons[a.personId]?.refn : undefined;
            const w = a?.waitId && refn ? env.todo.get(refn)?.find(x => x.id === a.waitId) : undefined;
            const control = w ? this.waitingAnswerControl(w) : null;
            if (!control) {
                slot.remove();
                continue;
            }
            slot.appendChild(control);
            slot.addEventListener('click', later, true);
        }
        // An item whose only action was left out keeps no empty row of actions.
        for (const row of el.querySelectorAll<HTMLElement>('.tv-rbub-acts')) if (!row.childElementCount) row.remove();
        for (const link of el.querySelectorAll<HTMLElement>('a[data-web]')) link.addEventListener('click', later);
    },

    /** An action can run here: a research link only when the research announced it. */
    tableResearchActionShown(a: ResearchBubbleAction): boolean {
        if (a.via !== 'link' || !a.link) return true;
        // Following live while it is followed opens the live panel; no link is needed.
        if (a.id === 'follow' && liveSession() && !liveSession()!.ended) return true;
        return !!this.activeResearchLink(a.link.action, a.link.params);
    },

    /** Run a bubble's action (the waiting item's answer and the website run as their own controls). */
    runTableResearchAction(env: ResearchTableEnv, a: ResearchBubbleAction): void {
        switch (a.id) {
            case 'storyCompare':
                if (!this.openWaitingStoryCompare(a.personId)) this.showStoryCompare({ personId: a.personId });
                return;
            case 'waitingPanel':
                this.showResearchWaiting();
                return;
            case 'decide':
                if (a.conflictId) this.showPersonResearchDialog(a.personId, { conflict: a.conflictId });
                return;
            case 'knows':
                this.showPersonResearchDialog(a.personId, { questions: true });
                return;
            case 'materials':
                this.showPersonMaterials(a.personId);
                return;
            case 'showLine':
                this.showTableResearchLine(env, a);
                return;
            case 'changeInResearch':
                if (a.lineId) this.openResearchDirection(a.lineId);
                return;
            case 'revert':
                if (a.fact) void this.confirmFactRevert(a.personId, a.fact);
                return;
            case 'source':
                if (a.sourceId) this.openTableSourceId(a.sourceId);
                return;
            case 'follow':
                if (liveSession() && !liveSession()!.ended) {
                    this.showLiveResearchNow();
                    return;
                }
                this.launchTableResearchLink(a);
                return;
            case 'reviewHypothesis':
            case 'openTask':
                this.launchTableResearchLink(a);
                return;
            default:
                return;
        }
    },

    /** A research link of a bubble's action, launched (its button carries the mark of the link's group). */
    launchTableResearchLink(a: ResearchBubbleAction): void {
        const url = a.link ? this.activeResearchLink(a.link.action, a.link.params) : null;
        if (url) this.launchResearchLink(url);
    },

    /**
     * "Show the line in the tree" (§16.9, 16zf): the Family view with the
     * person in the middle and the people of the line (a side branch: of the
     * branch) lit, named by the line.
     */
    showTableResearchLine(env: ResearchTableEnv, a: ResearchBubbleAction): void {
        const ids: PersonId[] = [];
        let label = '';
        if (a.branchId) {
            const branch = env.lines.branches.find(x => x.id === a.branchId);
            label = researchBranchName(env, branch, a.branchId);
            for (const q of Object.values(env.data.persons)) {
                if (!q.isPlaceholder && env.lines.placesOf(q.refn).some(x => x.role === 'branch' && x.branch === a.branchId)) ids.push(q.id);
            }
        } else if (a.lineId) {
            const line = env.lines.lines.find(x => x.id === a.lineId);
            label = line ? `${line.id} ${line.name}` : a.lineId;
            for (const q of Object.values(env.data.persons)) {
                if (q.isPlaceholder) continue;
                const role = personLineRole(env.lines, q);
                if (role?.kind === 'line' && role.line.id === a.lineId) ids.push(q.id);
            }
        }
        if (!DataManager.getPerson(a.personId)) return;
        TreeRenderer.presetViewMode('family');
        TreeRenderer.setFocus(a.personId);
        ZoomPan.centerOnPerson(a.personId);
        this.startPersonHighlight('direction', label, ids, null);
    },
});

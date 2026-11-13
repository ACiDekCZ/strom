/**
 * The main window's side of the Research overview in a window of its own
 * (spec 079 §6, K3): the state it sends there (`research-state`) and the
 * research actions it runs for it (`research-action`) with today's functions.
 * The contract is windows/overview-window.ts; the posting is wired in
 * windows/window-start.ts.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import type { PersonId, TreeId } from '../types.js';
import { researchTaskRef, type ResearchLinkParams } from '../research-link.js';
import { waitingFileWritable } from '../research-waiting-write.js';
import { pendingHypothesesOf } from '../research-hypothesis-wait.js';
import { acceptBatch } from '../research-hypothesis-waiting.js';
import { loadMoreQueueList, queueListsSnapshot, requestQueueList, retryQueueList } from '../research-queue-pages.js';
import { researchHypotheses } from '../view-links.js';
import { uiModule } from './module.js';
import { liveSession, overviewViewing, researchSession, type LiveSession } from './research-ui.js';
import { directionsWindowState, retryDirectionProblem } from './research-directions-ui.js';
import { hoverCard } from './research-overview-ui.js';
import {
    OVERVIEW_STATE_VERSION, bridgeSecrets, cloneSafe, emptyOverviewExtras, overviewChanged, overviewSessionData,
    type OverviewAction, type OverviewExtras, type OverviewResearchState, type OverviewSource, type OverviewViewingData,
} from '../windows/overview-window.js';

/** What the overview window draws: the followed research of the open tree, else its research viewed without following. */
function windowSession(): { s: LiveSession; source: OverviewSource } | null {
    const treeId = DataManager.getCurrentTreeId();
    const l = liveSession();
    if (l && !l.ended && l.treeId === treeId) return { s: l, source: 'live' };
    const v = overviewViewing();
    if (v && v.treeId === treeId) return { s: v.session, source: v.kind };
    return null;
}

export const overviewWindowMethods = uiModule({
    /**
     * An overview window opened or closed (spec 079 6g). Opened: the overview
     * here closes (whatever it showed) and does not open again while the
     * window lasts; the small panel stays. Closed: as before it opened; the
     * overview it showed without following goes with it, and a following
     * begun meanwhile does not open one here.
     */
    overviewWindowOpenChanged(open: boolean): void {
        if (open) {
            this.closeResearchOverview();
            this.renderLivePanel();
            return;
        }
        const s = liveSession();
        if (s) s.overview = false;
        this.closeOverviewViewing();
        this.renderLivePanel();
    },

    /**
     * The overview window's state now (`research-state`): the session it
     * draws, where it comes from, and what only this window knows. Without a
     * session of the open tree's research (not followed), its overview
     * without following is opened for the window, as ⤢ opens it here.
     */
    overviewWindowState(): OverviewResearchState {
        const treeId = DataManager.getCurrentTreeId();
        const researchId = treeId ? this.activeResearchId() : null;
        let w = windowSession();
        const l = liveSession();
        // Following another tree's research ends a viewing at once (syncOverviewViewing): none is opened then.
        if (!w && researchId && !(l && !l.ended)) {
            this.openOverviewViewing();
            w = windowSession();
        }
        const v = overviewViewing();
        const secrets = bridgeSecrets(w?.s.bridge.base, l?.bridge.base, v?.session.bridge.base);
        const viewing: OverviewViewingData | null = w && w.source !== 'live' && v ? {
            treeId: v.treeId, researchId: v.researchId, kind: v.kind, follow: v.follow, refreshedAt: v.refreshedAt,
            working: v.working, agentStarted: v.agentStarted, logHead: v.logHead, waitingAt: v.waitingAt,
        } : null;
        const extras: OverviewExtras = emptyOverviewExtras();
        if (treeId && researchId) {
            const sw = this.researchLiveState(treeId);
            extras.liveSwitch = sw ? { on: sw.on, pending: sw.pending, canStart: sw.canStart, canStop: sw.canStop, ended: sw.ended, note: sw.note } : null;
            extras.agentless = this.activeResearchAgentless();
            extras.noAgent = this.activeResearchNoAgent();
            extras.hypotheses = {
                pending: Object.fromEntries(pendingHypothesesOf(researchId)),
                batch: acceptBatch(researchId),
            };
        }
        extras.follow = { on: this.isLiveFollowOn(), view: this.liveFollowView() };
        extras.lines = directionsWindowState(researchSession());
        extras.queue = queueListsSnapshot();
        const meta = treeId ? TreeManager.getTreeMetadata(treeId as TreeId) : null;
        const state: OverviewResearchState = {
            v: OVERVIEW_STATE_VERSION,
            at: Date.now(),
            treeId: treeId ?? null,
            treeName: meta?.name ?? '',
            researchId,
            researchName: w?.s.name ?? '',
            source: w?.source ?? null,
            bridgeUp: !!w && (w.source === 'live' ? w.s.lostSince === null : w.source === 'bridge'),
            session: w ? overviewSessionData(w.s, secrets) : null,
            viewing,
            extras,
        };
        return cloneSafe(state, secrets) as OverviewResearchState;
    },

    /**
     * Run a research action the overview window asked for (checked by
     * readOverviewAction), as its control here runs it. Returns its outcome
     * where the window waits for one (an answer sent), else whether it ran.
     */
    runOverviewWindowAction(a: OverviewAction): unknown {
        const ws = windowSession();
        const s = ws?.s ?? null;
        const item = (id: string) => s?.waiting.find(w => w.id === id) ?? null;
        const line = (id: string) => researchSession()?.researches.find(d => d.id === id) ?? null;
        const treeId = DataManager.getCurrentTreeId();
        switch (a.action) {
            case 'show-person':
                this.overviewShowPerson(a.args.personId as PersonId, 'docked');
                return true;
            case 'show-people':
                this.startPersonHighlight('changed', a.args.title, a.args.personIds as PersonId[], null);
                return true;
            case 'show-direction': {
                const d = line(a.args.directionId);
                if (!d) return false;
                this.showDirectionInTree(d, 'docked');
                return true;
            }
            case 'person-research':
                this.showPersonResearchDialog(a.args.personId as PersonId,
                    a.args.conflict ? { conflict: a.args.conflict } : a.args.hypo ? { hypo: { id: a.args.hypo } } : {});
                return true;
            case 'tree-overview':
                if (!treeId) return false;
                void this.showTreeOverview(treeId, { section: 'quality', scroll: true });
                return true;
            case 'waiting-places':
                this.showWaitingPlaces(a.args.focus);
                return true;
            case 'waiting-group-note':
                if (!s) return false;
                void this.showWaitingGroupNote(s, a.args.group, a.args.name);
                return true;
            case 'waiting-images': {
                const w = item(a.args.itemId);
                if (!s || !w) return false;
                this.openWaitingImages(s, w, a.args.files);
                return true;
            }
            case 'line-edit': {
                const d = line(a.args.directionId);
                if (!d) return false;
                this.openDirectionForm({ mode: 'edit', direction: d });
                return true;
            }
            case 'line-new':
                if (!researchSession()) return false;
                this.openDirectionForm({ mode: 'new' });
                return true;
            case 'hover-person':
                hoverCard(a.args.personId as PersonId | null);
                return true;
            case 'follow-live':
                this.startFollowLive('overview');
                return true;
            case 'stop-follow':
                if (ws?.source !== 'live') return false;
                this.stopLiveFollow();
                return true;
            case 'follow-tree':
                this.setLiveFollow(a.args.on);
                return true;
            case 'follow-view':
                this.setLiveFollowView(a.args.view);
                return true;
            case 'turn-on': {
                // "Turn on" only: the same switch would stop a research that runs.
                const sw = treeId ? this.researchLiveState(treeId) : null;
                if (!treeId || !sw || sw.on || sw.pending || !sw.canStart) return false;
                void this.toggleResearchLive(treeId);
                return true;
            }
            case 'line-select':
                this.setWorkingLine(a.args.directionId);
                return true;
            case 'line-state': {
                const d = line(a.args.directionId);
                if (!d) return false;
                return this.changeDirectionState(d, a.args.do, a.args.reason ? { reason: a.args.reason } : {});
            }
            case 'line-move':
                this.moveDirection(a.args.directionId, a.args.move);
                return true;
            case 'line-retry':
                return retryDirectionProblem(a.args.directionId);
            case 'waiting-answer': {
                const w = item(a.args.itemId);
                if (!s || !w) return 'gone';
                return this.sendWaitingAnswer(s, w, a.args.text);
            }
            case 'waiting-sent': {
                const w = item(a.args.itemId);
                if (!s || !w) return false;
                void this.markWaitingSent(s, w);
                return true;
            }
            case 'waiting-unsent':
                if (!s) return false;
                void this.markWaitingUnsent(s, a.args.itemId);
                return true;
            case 'waiting-group-sent':
                if (!s) return false;
                void this.markWaitingGroupSent(s, a.args.group);
                return true;
            case 'waiting-file': {
                const w = item(a.args.itemId);
                const task = w ? researchTaskRef(w.id) : null;
                if (!s || !w || !task || !this.liveWaitingWrites(s).file || !waitingFileWritable(w)) return false;
                return this.sendWaitingFile(s, task, a.args.file).then(() => true);
            }
            case 'hypothesis-ask': {
                const h = researchHypotheses(DataManager.getData()).get(a.args.hypothesisId);
                if (!h) return false;
                this.askWaitingHypothesis(h, a.args.do, a.args.variant);
                return true;
            }
            case 'hypotheses-accept':
                this.acceptHypothesisProposals(a.args.ids);
                return true;
            case 'answer-task': {
                const w = item(a.args.itemId);
                if (!w) return false;
                this.answerResearchTask(w);
                return true;
            }
            case 'research-link': {
                // Built here for the open tree from the action and its parameters (never an address the window sends).
                const url = this.activeResearchLink(a.args.link, (a.args.params ?? {}) as Omit<ResearchLinkParams, 'tree'>);
                if (!url) return false;
                this.launchResearchLink(url, a.args.kind ?? 'terminal');
                return true;
            }
            case 'queue-list':
            case 'queue-more':
            case 'queue-retry': {
                const base = s?.bridge.base;
                if (!base) return false;
                if (a.action === 'queue-list') requestQueueList(base, a.args.filter, a.args.slot);
                else if (a.action === 'queue-more') loadMoreQueueList(base, a.args.filter, a.args.slot, a.args.seed as Parameters<typeof loadMoreQueueList>[3]);
                else retryQueueList(base, a.args.filter, a.args.slot);
                // A list asked: the window hears of it now (its pages come with the lists' own redraw).
                overviewChanged();
                return true;
            }
        }
    },
});

/**
 * A hypothesis decided from the app, once the research has confirmed it
 * (spec 074, DEV §4): a new version of the research with the decision is
 * loaded (quietly when it brings only that, else through the Load dialog with
 * the decision first), then the wait ends and says so — a notice with
 * "Show", the card's line for a decision made otherwise, the pinned bubble
 * closed. The research writes the family links with its decision (K1.5): the
 * tree draws them from the data it loads, nothing drawn in their place. The
 * waits turn long after ten minutes by a timer that runs only while one does.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings } from '../strings.js';
import { PersonId, ResearchHypothesis, StromData, TreeId } from '../types.js';
import { shownName } from '../person-name.js';
import { diffValues } from '../research-changes.js';
import { researchAutoState } from '../research-device.js';
import { otherLoadChanges } from '../research-conflict-card.js';
import { loadViewLinks, researchHypotheses, saveViewLinks, unlinkViewLink, viewLinkContext } from '../view-links.js';
import {
    PendingHypothesisOutcome, clearHypothesisCardNotes, evaluatePendingHypothesis, hypothesisNoteOf, nextPendingHypothesisLongAt,
    onPendingHypothesisChange, pendingHypothesesOf, setHypothesisCardNote, setPendingHypothesis, settlePendingHypotheses, touchPendingHypotheses,
} from '../research-hypothesis-wait.js';
import { HypothesisLoadRow, researchHypothesisLoadRows, researchHypothesisOutcomeToast } from '../research-hypotheses.js';
import { researchDateLabel, liveSession } from './research-ui.js';
import { researchSendMode } from './research-sync-ui.js';
import { viewLinksToldInvalid } from './view-links-list-ui.js';
import { uiModule } from './module.js';

/** How long the notice of a decision stays. */
const TOAST_MS = 8000;

// ==================== THE LONG WAIT'S TIMER ====================

let longTimer: number | undefined;

/** The timer to the next wait turning long: armed while a wait runs, gone with the last one. */
function armLongTimer(): void {
    window.clearTimeout(longTimer);
    longTimer = undefined;
    const at = nextPendingHypothesisLongAt(Date.now());
    if (at === null) return;
    longTimer = window.setTimeout(() => {
        longTimer = undefined;
        // Told to every listener: the card and the bubble draw "Not confirmed yet"; then the next one.
        touchPendingHypotheses();
    }, Math.max(0, at - Date.now()) + 50);
}
onPendingHypothesisChange(armLongTimer);

/** A version of the research being looked at for the waits (one at a time per research). */
const checking = new Set<string>();

/** The people carrying a hypothesis (the first one's card is "Show"'s). */
function hypothesisPersons(data: StromData, id: string): PersonId[] {
    return Object.entries(data.persons ?? {})
        .filter(([, p]) => !p?.isPlaceholder && (p?.research?.hypotheses ?? []).some(h => h.id === id))
        .map(([pid]) => pid as PersonId);
}

/** Whether an outcome means the research's version holds what this page asked (or decided otherwise). */
function decides(o: PendingHypothesisOutcome): boolean {
    return o.kind !== 'waiting' && o.kind !== 'gone';
}

export const hypothesisWaitMethods = uiModule({
    /**
     * The bridge says the research's version moved on (`head`): with waits of
     * this research, its version is read and each wait looked at. Only the
     * same decisions there (the hypotheses unchanged): the waits go on with
     * the new head. A decision there: the version loads — quietly when it
     * changes nothing here but the decisions (a backup first), else through
     * the Load dialog, the decision first ("Later": the card says it was
     * decided, the tree stays). Following live loads it by itself.
     */
    async researchHypothesesHeadSeen(treeId: TreeId, head: string): Promise<void> {
        const ctx = this.researchSyncLink();
        if (!ctx || ctx.treeId !== treeId || !head || head === ctx.link.head) return;
        const rid = ctx.link.id;
        const waits = pendingHypothesesOf(rid);
        if (waits.size === 0 || [...waits.values()].every(p => p.head === head)) return;
        const s = liveSession();
        if (s && !s.ended && s.treeId === treeId) return;
        if (checking.has(rid)) return;
        checking.add(rid);
        try {
            const version = await this.researchVersionRead(true);
            if (!version || DataManager.getCurrentTreeId() !== treeId) return;
            const versionHead = version.header.head || head;
            const there = researchHypotheses(version.data);
            const outcomes = new Map<string, PendingHypothesisOutcome>();
            for (const [id, p] of pendingHypothesesOf(rid)) outcomes.set(id, evaluatePendingHypothesis(p, there.get(id), versionHead));
            if (![...outcomes.values()].some(decides)) {
                // Not written yet (or gone): the waits go on with this head, the gone ones end.
                settlePendingHypotheses(rid, there, versionHead);
                return;
            }
            const here = DataManager.getData();
            const loaded = this.researchVersionAsLoaded(version.data);
            const quiet = otherLoadChanges(diffValues(here, loaded), []) === 0;
            if (!quiet) {
                const asked = new Set([...outcomes].filter(([, o]) => decides(o)).map(([id]) => id));
                const rows = this.researchHypothesisRowsFor(here, version.data, asked);
                const first = [...outcomes].find(([, o]) => researchHypothesisOutcomeToast('', o));
                const lead = first ? researchHypothesisOutcomeToast(first[0], first[1]) : rows[0]?.text ?? '';
                const st = researchAutoState(treeId);
                const nw = st.notWritten && ctx.link.sent?.state === 'written' && st.notWritten.fingerprint === ctx.link.sent.fingerprint
                    ? st.notWritten.items.length + st.notWritten.unexplained : 0;
                const answer = await this.askResearchLoad(TreeManager.getTreeMetadata(treeId)?.name ?? '', researchDateLabel(version.header.date, version.header.asOf), here, loaded, {
                    off: researchSendMode(ctx.link) === 'off', notWritten: nw,
                    decided: { intro: strings.research.hypoLoadIntro(lead), later: strings.research.hypoLoadLater, rows: () => false },
                    hypotheses: rows,
                });
                if (!answer || DataManager.getCurrentTreeId() !== treeId) {
                    this.researchHypothesesLater(rid, there, outcomes);
                    return;
                }
            }
            if (!await this.ensureLocalUnlocked()) {
                this.researchHypothesesLater(rid, there, outcomes);
                return;
            }
            // The load's end settles the waits and tells what became of them (researchHypothesesLoaded).
            await this.applyResearch(version.data, version.header, { force: true, quiet, ...(version.header.head ? { head: version.header.head } : {}) });
            this.syncPersonFormWithData();
        } finally {
            checking.delete(rid);
        }
    },

    /** "Later" (or the load not possible now): the waits end, the cards say what was decided, the tree stays. */
    researchHypothesesLater(rid: string, there: ReadonlyMap<string, ResearchHypothesis>, outcomes: ReadonlyMap<string, PendingHypothesisOutcome>): void {
        for (const [id, o] of outcomes) {
            if (o.kind === 'waiting') continue;
            setPendingHypothesis(rid, id, null);
            const note = hypothesisNoteOf(o, there.get(id), true);
            if (note) setHypothesisCardNote(rid, id, note);
        }
    },

    /** The Load dialog's hypothesis rows between this tree and the research's version (`asked`: from this page). */
    researchHypothesisRowsFor(here: StromData, there: StromData, asked: ReadonlySet<string> = new Set()): HypothesisLoadRow[] {
        return researchHypothesisLoadRows(researchHypotheses(here), researchHypotheses(there), asked, (id) => {
            const [pid] = hypothesisPersons(there, id);
            const p = pid ? there.persons[pid] : undefined;
            return p ? shownName(p) : '';
        });
    },

    /**
     * A version of the research has loaded over `treeId` (a load of any kind,
     * following live): the waits of its research are settled against it and
     * what became of them told — decided as asked: a notice with "Show" (the
     * card), the shown versions of the person's other hypotheses unlinked, a
     * pinned bubble closed with the keyboard on the person's card; open again:
     * its notice; left open: nothing; decided otherwise: the card's line. A
     * decision put off ("Later") is loaded now: its line goes.
     */
    researchHypothesesLoaded(treeId: TreeId): void {
        if (DataManager.getCurrentTreeId() !== treeId) return;
        const link = TreeManager.getTreeMetadata(treeId)?.research;
        if (!link?.id) return;
        const rid = link.id;
        clearHypothesisCardNotes(rid, 'later');
        if (pendingHypothesesOf(rid).size === 0) return;
        const data = DataManager.getData();
        const hyps = researchHypotheses(data);
        const outcomes = settlePendingHypotheses(rid, hyps, link.head ?? '');
        if (outcomes.size === 0) return;
        let told = false;
        for (const [id, o] of outcomes) {
            const note = hypothesisNoteOf(o, hyps.get(id), false);
            if (note) setHypothesisCardNote(rid, id, note);
            const text = researchHypothesisOutcomeToast(id, o);
            const [personId] = hypothesisPersons(data, id);
            if (o.kind === 'asked') this.researchHypothesisUnlinkOthers(treeId, id, personId);
            if (personId && decides(o)) {
                this.researchHypothesisBubbleDone(personId);
                this.refreshResearchEdgeSection(personId);
            }
            if (!text || told) continue;
            told = true;
            this.showToast(text, TOAST_MS, personId ? {
                kind: 'hypothesis-decided',
                action: { label: strings.conflict.show, run: () => this.showPersonResearchDialog(personId, { hypo: { id } }) },
            } : { kind: 'hypothesis-decided' });
        }
    },

    /**
     * Decided for a version: what another hypothesis of the same person shows
     * in the view goes off (one family, one place); quietly, the decision's
     * notice says it.
     */
    researchHypothesisUnlinkOthers(treeId: TreeId, hypo: string, personId: PersonId | undefined): void {
        if (!personId) return;
        const others = new Set((DataManager.getPerson(personId)?.research?.hypotheses ?? []).map(h => h.id).filter((id): id is string => !!id && id !== hypo));
        if (others.size === 0) return;
        const data = DataManager.getData();
        const ctx = viewLinkContext(data);
        let links = loadViewLinks(treeId);
        const off = links.filter(l => l.on && others.has(l.hypo));
        if (off.length === 0) return;
        for (const l of off) links = unlinkViewLink(data, links, l.hypo, ctx).links;
        viewLinksToldInvalid(treeId, off);
        void TreeRenderer.refreshViewLinks(() => saveViewLinks(treeId, links));
    },
});


/**
 * The research's verdicts on the possible duplicates of the tree check (spec
 * 021 K3.1, K3.2; ZADANI_DEV §3). When the dialog opens on a research tree
 * whose bridge judges (`duplicates.judge`), the pairs whose two people both
 * have the research's REFN are asked (`POST <token>/duplicates`, by 1000);
 * the dialog does not wait. The verdicts fill the hooks of the dialog
 * (tree-stats.ts): a label and a reason on the row, Merge… (the existing
 * person merge) or "Load the new version", the order inside the group, and
 * "two people" set aside at the group's end, not counted.
 *
 * Nothing jumps under the hand: verdicts that come while the group is open
 * only add their labels; the order and the setting aside follow at the next
 * toggle of the group or the next opening. Kept per tree for the research's
 * head they were given at (between openings too).
 */

import { TreeManager } from '../tree-manager.js';
import { parseLiveBridge } from '../research-link.js';
import { storedResearchBridge } from '../research-device.js';
import { postDuplicates } from '../quality-bridge.js';
import {
    DUPLICATES_JUDGE_FEATURE, duplicatePairKey, issueResearchPair, judgeRequests, verdictLabel, verdictRank,
    verdictReasonText, verdictsMode, type DuplicateVerdict,
} from '../duplicate-verdicts.js';
import type { ValidationIssue } from '../validation.js';
import type { StromData, TreeId, Person } from '../types.js';
import { strings } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { uiModule } from './module.js';
import type { ValidationRowExtra } from './tree-stats.js';

interface TreeVerdicts {
    rid: string;
    /** The research's head the verdicts were given at ('' unknown). */
    head: string;
    /** By pair (duplicatePairKey): the verdict, or null (none). */
    verdicts: Map<string, DuplicateVerdict | null>;
    /** Pairs whose order and setting aside are applied (else only their label shows). */
    settled: Set<string>;
    /** `loading` — asked, `done` — answered, `off` — not running, refused or no answer (one sentence). */
    state: 'loading' | 'done' | 'off';
    /** Bumped at each opening: a reply of an older one only fills the verdicts in. */
    opening: number;
}

const byTree = new Map<string, TreeVerdicts>();
let openings = 0;

const DUP = 'possibleDuplicate';

function bridgeBase(rid: string): string | null {
    return parseLiveBridge(storedResearchBridge(rid)?.base)?.base ?? null;
}

/** The research of a tree (lower case), or null. */
function researchOf(treeId: string): string | null {
    const id = TreeManager.getTreeMetadata(treeId as TreeId)?.research?.id;
    return id ? id.toLowerCase() : null;
}

/** The verdict of a finding (its pair by the tree's REFN), and the pair. */
function verdictOf(entry: TreeVerdicts, issue: ValidationIssue, data: StromData): { v: DuplicateVerdict; pair: [string, string] } | null {
    const pair = issueResearchPair(issue, data.persons);
    if (!pair) return null;
    const v = entry.verdicts.get(duplicatePairKey(pair[0], pair[1]));
    return v ? { v, pair } : null;
}

export const duplicateVerdictsMethods = uiModule({
    /**
     * The dialog opened on a tree: ask the research about its possible
     * duplicates when it judges them (never blocks; the dialog redraws when
     * the verdicts come). What was got for the same head is kept; only the
     * pairs not asked yet go.
     */
    async startDuplicateVerdicts(treeId: string, data: StromData, issues: readonly ValidationIssue[]): Promise<void> {
        const opening = ++openings;
        const rid = researchOf(treeId);
        const up = !!rid && this.researchBridgeUp(rid) && !!bridgeBase(rid);
        const mode = verdictsMode({
            research: !!rid,
            bridgeUp: up,
            featureNow: !!rid && up && (this.researchStatusOf(rid)?.features ?? []).includes(DUPLICATES_JUDGE_FEATURE),
            featureKnown: !!rid && !up && await this.researchJudgedDuplicates(rid),
        });
        if (opening !== openings) return;
        const pairs = issues.map(i => issueResearchPair(i, data.persons)).filter((p): p is [string, string] => !!p);
        if (!rid || mode === 'none' || pairs.length === 0) {
            byTree.delete(treeId);
            this.redrawDuplicateVerdicts(treeId);
            return;
        }
        const head = mode === 'query' ? this.researchHeadNow(rid) : '';
        let entry = byTree.get(treeId);
        if (!entry || entry.rid !== rid || (mode === 'query' && entry.head !== head)) {
            entry = { rid, head, verdicts: new Map(), settled: new Set(), state: 'loading', opening };
            byTree.set(treeId, entry);
        }
        entry.opening = opening;
        // A new opening: what was got so far takes its place in the order.
        for (const key of entry.verdicts.keys()) entry.settled.add(key);
        if (mode === 'off') {
            entry.state = 'off';
            this.redrawDuplicateVerdicts(treeId);
            return;
        }
        const missing = pairs.filter(([a, b]) => !entry!.verdicts.has(duplicatePairKey(a, b)));
        if (missing.length === 0) {
            entry.state = 'done';
            this.redrawDuplicateVerdicts(treeId);
            return;
        }
        entry.state = 'loading';
        this.redrawDuplicateVerdicts(treeId);
        const base = bridgeBase(rid)!;
        const got = new Map<string, DuplicateVerdict | null>();
        let failed = false;
        for (const chunk of judgeRequests(missing)) {
            const reply = await postDuplicates(base, chunk);
            if (!reply) { failed = true; break; }
            for (const pv of reply.verdicts) got.set(pv.key, pv.verdict);
            // A pair the research left out: no verdict (not asked again for this head).
            for (const [a, b] of chunk) {
                const key = duplicatePairKey(a, b);
                if (!got.has(key)) got.set(key, null);
            }
        }
        if (byTree.get(treeId) !== entry) return;
        if (failed) {
            // As not running; not asked again while this dialog is open.
            if (entry.opening === opening) entry.state = 'off';
            this.redrawDuplicateVerdicts(treeId);
            return;
        }
        for (const [key, v] of got) entry.verdicts.set(key, v);
        if (entry.opening === opening) entry.state = 'done';
        // The group closed (or not shown): the order follows at once.
        if (!this.duplicateGroupOpenNow(treeId)) for (const key of got.keys()) entry.settled.add(key);
        this.redrawDuplicateVerdicts(treeId);
    },

    /** The group of possible duplicates of this tree's open dialog shows its rows now. */
    duplicateGroupOpenNow(treeId: string): boolean {
        if (this.treeValidationOpenFor() !== treeId) return false;
        return !!document.querySelector(`#tree-validation-modal .vq-group[data-type="${DUP}"] .vq-rows`);
    },

    /** The group was opened or closed: the verdicts that came meanwhile take their place. */
    settleDuplicateVerdicts(treeId: string): void {
        const entry = byTree.get(treeId);
        if (!entry) return;
        for (const key of entry.verdicts.keys()) entry.settled.add(key);
    },

    redrawDuplicateVerdicts(treeId: string): void {
        if (this.treeValidationOpenFor() === treeId) void this.refreshTreeValidationDialog(treeId);
    },

    /** What a possible duplicate shows of the research's verdict (validationRowExtra). */
    duplicateVerdictRowExtra(issue: ValidationIssue, treeId: string, data: StromData): ValidationRowExtra | null {
        if (issue.type !== DUP) return null;
        const entry = byTree.get(treeId);
        if (!entry || entry.state === 'off') return null;
        const found = verdictOf(entry, issue, data);
        if (!found) return null;
        const { v, pair } = found;
        const settled = entry.settled.has(duplicatePairKey(pair[0], pair[1]));
        const ids = issue.personIds ?? [];
        const esc = (t: string): string => this.escapeHtml(t);
        let actionsHtml = '';
        if (v.kind === 'same' && ids.length === 2) {
            actionsHtml = `<button type="button" class="vq-verdict-action" data-vq="merge" data-a="${esc(ids[0])}" data-b="${esc(ids[1])}"
                data-focus-key="merge:${esc(ids[0])}:${esc(ids[1])}">${esc(strings.treeManager.verdictMergeAction)}</button>`;
        } else if (v.kind === 'merged') {
            actionsHtml = `<button type="button" class="vq-verdict-action" data-vq="loadNew"
                data-focus-key="load:${esc(ids.join(':'))}">${esc(strings.treeManager.verdictLoadNewVersion)}</button>`;
        }
        return {
            badgeHtml: this.duplicateVerdictBadgeHtml(v, issue, pair, data),
            hideDetail: true,
            ...(actionsHtml ? { actionsHtml } : {}),
            ...(settled && verdictRank(v.kind) !== undefined ? { rank: verdictRank(v.kind) } : {}),
            ...(settled && v.kind === 'different' ? { setAside: true } : {}),
        };
    },

    /** The label and the reason above the people. */
    duplicateVerdictBadgeHtml(v: DuplicateVerdict, issue: ValidationIssue, pair: [string, string], data: StromData): string {
        const esc = (t: string): string => this.escapeHtml(t);
        const ids = issue.personIds ?? [];
        const person = (i: number): Person | undefined => data.persons[ids[i]];
        const reason = verdictReasonText(v, person(0), person(1), pair, d => formatFlexDate(d));
        return `<div class="vq-verdict"><span class="vq-verdict-tag vq-verdict-tag--${v.kind}">${esc(verdictLabel(v.kind))}</span>`
            + `${reason ? `<span class="vq-verdict-reason">${esc(reason)}</span>` : ''}</div>`;
    },

    /** The line under the group's title (validationGroupNote). */
    duplicateVerdictNote(type: string, treeId: string): string {
        if (type !== DUP) return '';
        const entry = byTree.get(treeId);
        if (!entry) return '';
        const s = strings.treeManager;
        return entry.state === 'loading' ? s.verdictsLoading : entry.state === 'done' ? s.verdictsAssessed : s.verdictsNoBridge;
    },

    /** The pairs told apart, at the group's end (validationAsideHtml): a closed row, open the rows without actions. */
    duplicateVerdictAsideHtml(type: string, aside: readonly ValidationIssue[], treeId: string, data: StromData, open: boolean): string {
        if (type !== DUP || aside.length === 0) return '';
        const entry = byTree.get(treeId);
        if (!entry) return '';
        const esc = (t: string): string => this.escapeHtml(t);
        let html = `<div class="vq-aside">
            <button type="button" class="vq-aside-head" data-vq="aside" data-type="${esc(type)}"
                data-focus-key="aside:${esc(type)}" aria-expanded="${open}">
                <span class="vq-aside-label">${esc(strings.treeManager.verdictsGroup(aside.length))}</span>
                <span class="vq-chev" aria-hidden="true">${open ? '▼' : '▶'}</span>
            </button>`;
        if (open) {
            for (const issue of aside) {
                const found = verdictOf(entry, issue, data);
                html += `<div class="vq-aside-row" data-type="${esc(type)}">
                    ${found ? this.duplicateVerdictBadgeHtml(found.v, issue, found.pair, data) : ''}
                    <div class="validation-issue-persons">${this.validationPeopleHtml(issue, data, treeId)}</div>
                </div>`;
            }
        }
        return html + '</div>';
    },

    /** Merge… on a pair the research takes for one person: the existing person merge, the two chosen. */
    async mergeDuplicateFromValidation(treeId: string, keepId: string, otherId: string): Promise<void> {
        if (TreeManager.getActiveTreeId() !== treeId) await this.switchToTree(treeId as TreeId);
        if (TreeManager.getActiveTreeId() !== treeId || this.treeValidationReadOnly(treeId)) return;
        // The validation stays on the stack: closing the merge brings it back, redrawn.
        if (this.dialogStack[this.dialogStack.length - 1] !== 'tree-validation-modal') this.pushDialog('tree-validation-modal');
        this.closeDialogById('tree-validation-modal');
        this.pushDialog('person-merge-modal');
        this.showPersonMergeDialog(keepId as never, otherId as never);
    },

    /** "Load the new version" (merged in the research): the dialogs closed, the research's version loaded as from its menu. */
    async loadNewVersionFromValidation(treeId: string): Promise<void> {
        this.closeTreeValidationDialog();
        if (this.isTreeOverviewOpen()) this.closeTreeOverview();
        this.closeTreeManagerDialog();
        this.clearDialogStack();
        if (TreeManager.getActiveTreeId() !== treeId) await this.switchToTree(treeId as TreeId);
        if (TreeManager.getActiveTreeId() !== treeId) return;
        await this.researchLoadNewer();
    },
});

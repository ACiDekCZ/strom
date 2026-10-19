/**
 * Switching trees follows the research live where an agent works (spec 011,
 * U4b). Before the switch the open tree's changes go (if they go by
 * themselves) and are saved; following of the tree left ends quietly. After
 * it the tree opened is followed at once when its bridge answers and someone
 * works there — nothing asked, and when it cannot be followed the tree stays
 * as it is, editable, its research panel saying how things are. A bridge that
 * answers with nobody at work is never followed by itself: the panel offers
 * "Follow live" (and says so when an agent begins later), the tree is never
 * locked under an edit.
 *
 * The target's state comes from what its bridge said last (its own poll or
 * the other trees' round, research-others-ui.ts); asked once more only when
 * that is older than FOLLOW_FRESH_MS. No timer of its own.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import type { TreeId } from '../types.js';
import { storedResearchBridge } from '../research-device.js';
import { parseLiveBridge } from '../research-link.js';
import { answerFresh, followOnOpen } from '../research-follow.js';
import { liveSession } from './research-ui.js';
import { uiModule } from './module.js';

/** The switch waits at most this long for the open tree's changes to go (they stay in the tree either way). */
const SEND_BEFORE_SWITCH_MS = 15_000;
/** Opening a tree asks its bridge (when what it said is not recent) this long, as the research's own quick ask. */
const ASK_MS = 1500;
/** The opened tree's own changes may go first: following waits that long for them. */
const SEND_BEFORE_FOLLOW_MS = 10_000;

/** What the page showed when the switch began: what was followed, what was open, whether a research panel was in sight. */
export interface FollowSwitchFrom {
    followed: TreeId | null;
    open: TreeId | null;
    panelShown: boolean;
}

export const researchFollowMethods = uiModule({
    /**
     * Before the open tree is left for `target`: what the page shows now, and
     * the tree's changes sent (when they go by themselves) — the switch waits.
     */
    async researchFollowBeforeSwitch(target: TreeId): Promise<FollowSwitchFrom> {
        const s = liveSession();
        const open = DataManager.getCurrentTreeId();
        const panel = document.getElementById('live-panel');
        const from: FollowSwitchFrom = {
            followed: s && !s.ended ? s.treeId : null,
            open,
            panelShown: (!!panel && !panel.hidden) || this.isResearchOverviewOpen(),
        };
        if (open && open !== target && !DataManager.isViewMode()) await this.researchSendOpenTreeNow(SEND_BEFORE_SWITCH_MS);
        return from;
    },

    /** The tree left was followed: that ends quietly (no toast), the tree is editable again. One following at a time. */
    researchFollowLeft(left: TreeId | null): void {
        const s = liveSession();
        if (!s || s.ended || !left || s.treeId !== left || DataManager.getCurrentTreeId() === left) return;
        this.endLiveFollow(s, 'stopped');
    },

    /**
     * The switch to `treeId` is done: follow its research when an agent works
     * there, else (a research panel was in sight) show its research panel.
     */
    async researchFollowAfterSwitch(treeId: TreeId, from: FollowSwitchFrom): Promise<void> {
        const meta = TreeManager.getTreeMetadata(treeId);
        const link = meta?.research;
        if (!meta || !link || link.copy || DataManager.isViewMode() || !this.otherResearchEnabled()) return;
        const s = liveSession();
        if (s && !s.ended && s.treeId === treeId) return;
        if (this.researchModeOf(link.id, link) === 'archive') return;
        const base = storedResearchBridge(link.id)?.base;
        if (!base || !parseLiveBridge(base)) return;
        let fresh = answerFresh(this.researchAnswerOf(link.id), Date.now());
        if (!fresh) {
            await this.askResearchBridge(link.id, ASK_MS);
            fresh = answerFresh(this.researchAnswerOf(link.id), Date.now());
        }
        if (DataManager.getCurrentTreeId() !== treeId) return;
        this.refreshResearchMarks();
        const what = followOnOpen(this.researchTreeStateOf(meta), fresh);
        if (what === 'idle') this.researchNoteIdle(link.id);
        if (what !== 'follow') {
            if (from.panelShown && !(liveSession() && !liveSession()!.ended)) this.openResearchIdlePanel(link.id);
            return;
        }
        // Its own changes the research lacks go first (they would keep it from loading the research's version).
        await this.researchSendOpenTreeNow(SEND_BEFORE_FOLLOW_MS);
        if (DataManager.getCurrentTreeId() !== treeId) return;
        await this.startLiveFollow(base, {
            follow: true,
            auto: { researchId: link.id, treeId },
            from: { followed: from.followed, open: from.open },
        });
    },
});

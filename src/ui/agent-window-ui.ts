/**
 * The agent's state across the app's windows (spec 097 K1.3, K3.1).
 *
 * Main window: `agentWindowState()` builds what crosses (src/windows/agent-state.ts
 * AgentSections): the tree's research link, the followed session, the
 * Table's research input, the cards' research word, the bridge's status,
 * the lines' places and following, without a bridge address or token.
 * The posting is wired in src/windows/window-start.ts (startAgentMain).
 *
 * Satellite: `agentMirrorApplied()` puts the mirror's state where this
 * window's research reads it (src/windows/agent-mirror.ts; research-ui reads
 * the session, the Table's input and the cards' word from the mirror
 * itself): the tree's metadata, the bridge's status, then the cards and the
 * Table are drawn again.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import type { TreeId, TreeMetadata } from '../types.js';
import type { LiveStatus } from '../research-link.js';
import { storedResearchBridge } from '../research-device.js';
import { uiModule } from './module.js';
import { liveSession, researchCardInfoNow, researchMirrorChanged, researchTableLive } from './research-ui.js';
import { setMirroredResearchStatus } from './research-sync-ui.js';
import { bridgeSecrets, overviewSessionData } from '../windows/overview-window.js';
import { agentMirror } from '../windows/agent-mirror.js';
import {
    agentStateSafe, type AgentSectionName, type AgentSections, type AgentStamps, type AgentPlacesData,
} from '../windows/agent-state.js';
import type { DirectionPlaces } from '../research-directions-write.js';

/** The fields of a tree's metadata that cross (never the adopt token, the storage's own fields). */
const META_FIELDS = ['id', 'name', 'research', 'researchEdges', 'researchEdgeMotion'] as const;

/** The places last turned into a section (the same section while they do not change). */
let placesMemo: { from: DirectionPlaces; data: AgentPlacesData } | null = null;

function placesData(places: DirectionPlaces | null): AgentPlacesData | null {
    if (!places) return null;
    if (placesMemo?.from !== places) {
        placesMemo = { from: places, data: { rev: places.rev, places: [...places.places].map(([k, v]) => [k, [...v]]), lines: [...places.lines], branches: [...places.branches] } };
    }
    return placesMemo.data;
}

const EMPTY_WORK: AgentSections['work'] = { live: false, followed: false, waiting: [], working: [], queue: [], done: [] };

/** The research id whose status this window last put in from the mirror (it goes when the mirror says another). */
let mirroredStatusId: string | null = null;

export const agentWindowMethods = uiModule({
    /** The agent's state for the other windows now, safe to cross, with the stamps of its large sections. */
    agentWindowState(): { sections: AgentSections; stamps: AgentStamps } {
        const treeId = DataManager.getCurrentTreeId();
        const followedRun = this.followedRun();
        const follow = { on: this.isLiveFollowOn(), view: this.liveFollowView(), ...(followedRun ? { run: followedRun } : {}) };
        // A locked tree (§3.6) or a page without a tree of its own: nothing of its research leaves this window.
        if (!treeId || DataManager.isLocked() || DataManager.isViewMode()) {
            const sections: AgentSections = { link: { treeId: treeId ?? null, meta: null }, live: null, work: EMPTY_WORK, cards: [], status: null, places: null, follow };
            return { sections, stamps: {} };
        }
        const meta = TreeManager.getTreeMetadata(treeId as TreeId);
        // A copy of a research tree is a tree without research (spec 139 K5.1): its tie never reaches another window.
        const owner = TreeManager.canSendToResearch(treeId as TreeId);
        const researchId = owner ? meta?.research?.id ?? null : null;
        const l = liveSession();
        const secrets = bridgeSecrets(l?.bridge.base, researchId ? storedResearchBridge(researchId)?.base : null);
        const metaPart: Record<string, unknown> | null = meta ? {} : null;
        if (meta && metaPart) for (const k of META_FIELDS) if (meta[k] !== undefined && (k !== 'research' || owner)) metaPart[k] = meta[k];
        const t = researchTableLive();
        const places = placesData(t.places);
        const status = researchId ? this.researchStatusOf(researchId) : null;
        const raw: AgentSections = {
            link: { treeId, meta: metaPart },
            live: l ? overviewSessionData(l, secrets) as unknown as Record<string, unknown> : null,
            work: { live: t.live, followed: t.followed, waiting: [...t.waiting], working: [...t.working], queue: [...t.queue], done: [...t.done] },
            cards: [...researchCardInfoNow()] as [string, Record<string, unknown>][],
            // With whether its bridge answers now: the status stays after the bridge stops answering.
            status: researchId && status ? { researchId, status, up: this.researchBridgeUp(researchId) } : null,
            places: null,
            follow,
        };
        // The places (people's refs and the lines' words, no bridge) are copied only when read anew, not on every look.
        const sections = { ...agentStateSafe(raw, secrets), places };
        // The places carry their own revision: never turned into JSON again while it stands.
        return { sections, stamps: places ? { places: `${treeId}|${places.rev}` } : { places: '' } };
    },

    /** This window's mirror changed (spec 097 K1.3): the tree's metadata and status go where they are read, then the research is drawn again. */
    agentMirrorApplied(changed: readonly AgentSectionName[]): void {
        const mirror = agentMirror();
        if (!mirror) return;
        if (changed.includes('link')) {
            const meta = mirror.meta();
            TreeManager.setWindowTreeMetadata(meta && typeof meta.id === 'string' ? meta as unknown as TreeMetadata : null);
        }
        if (changed.includes('status') || changed.includes('link')) {
            const st = mirror.status();
            if (mirroredStatusId && mirroredStatusId !== st?.researchId) setMirroredResearchStatus(mirroredStatusId, null);
            mirroredStatusId = st?.researchId ?? null;
            if (st) setMirroredResearchStatus(st.researchId, st.status as LiveStatus, st.up !== false);
        }
        if (changed.includes('cards') || changed.includes('link')) researchMirrorChanged();
        // The Table reads the link, the status, the agent's work and the places (not the session's other news, nor following).
        if (changed.some(n => n === 'link' || n === 'status' || n === 'work' || n === 'places')) this.tableResearchMirrorChanged();
    },
});

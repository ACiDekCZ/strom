/**
 * The research side of place identification (spec 034) for the dialogs: one
 * place that says whether the research's actions go for the open tree (Look up, Check,
 * Select, Run now, Remove from the queue), where its bridge is and what it
 * announced. The Places dialog, the map, the person card and the waiting list
 * all ask here, so they never disagree.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { TreeManager } from '../tree-manager.js';
import { isPhoneBar } from '../breakpoints.js';
import { parseLiveBridge } from '../research-link.js';
import { announcedResearchScheme, isBridgelessWindow, storedResearchBridge } from '../research-device.js';
import { placesResearchAccess, type PlacesLinkCheck, type PlacesResearchAccess } from '../places-bridge.js';
import { uiModule } from './module.js';

export interface PlacesResearchContext {
    /** The open tree's research id (lower case), or null (no research, or a view of a shared file). */
    researchId: string | null;
    /** The bridge's address with its token (null: not known on this device). */
    base: string | null;
    /** What the bridge announced (empty when it does not answer). */
    features: readonly string[];
    access: PlacesResearchAccess;
    /**
     * A satellite window (no bridge of its own): the access is the main window's (its bridge as the
     * mirror says), and what writes to the bridge goes through the main window.
     */
    viaMain: boolean;
    /**
     * The access of the place steps that write to the bridge from this window (Look up, Check, Select,
     * Run now, Remove from the queue): the access, except in a satellite, where they do not go from
     * here yet (as before: where they go instead).
     */
    stepAccess: PlacesResearchAccess;
    /** The research's place steps go from here (stepAccess 'ok'). */
    canResearch: boolean;
    /** What a refusal's `places` link is checked against. */
    linkCheck: PlacesLinkCheck | null;
}

function openTreeResearchId(): string | null {
    if (DataManager.isViewMode()) return null;
    const treeId = DataManager.getCurrentTreeId();
    const id = treeId ? TreeManager.getTreeMetadata(treeId)?.research?.id : undefined;
    return id ? id.toLowerCase() : null;
}

export const placesResearchMethods = uiModule({
    /** Where the research's place actions stand for the open tree, now. */
    placesResearchContext(): PlacesResearchContext {
        const researchId = openTreeResearchId();
        // A satellite holds no bridge address: whether the bridge answers is the main window's (mirrored).
        const viaMain = isBridgelessWindow();
        const up = !!researchId && this.researchBridgeUp(researchId);
        const base = researchId ? parseLiveBridge(storedResearchBridge(researchId)?.base)?.base ?? null : null;
        const features = up && researchId ? this.researchStatusOf(researchId)?.features ?? [] : [];
        const access = placesResearchAccess({
            hasResearch: !!researchId, bridgeLocal: up && (viaMain || !!base), features, phoneLayout: isPhoneBar(),
        });
        const stepAccess: PlacesResearchAccess = viaMain && access === 'ok' ? 'elsewhere' : access;
        return {
            researchId, base, features, access, viaMain, stepAccess, canResearch: stepAccess === 'ok',
            linkCheck: researchId ? { tree: researchId, scheme: announcedResearchScheme() } : null,
        };
    },

    /**
     * Where the research's place steps go when they do not go here ('' when they do, or without a
     * research): its computer, the computer (a phone), a newer research. The Places dialog's context
     * line says the same.
     */
    placesResearchNote(access: PlacesResearchAccess): string {
        const d = strings.places.dialog;
        switch (access) {
            case 'elsewhere': return d.elsewhere;
            case 'phone': return d.phoneLine;
            case 'old': return strings.places.research.oldResearch;
            default: return '';
        }
    },

    /** The research terminal's link that runs the place queue (one place with `place`); null when links do not go. */
    placesRunLink(place?: string): string | null {
        return this.activeResearchLink('places', { placesDo: 'run', ...(place ? { place } : {}) });
    },
});

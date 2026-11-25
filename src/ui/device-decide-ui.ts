/**
 * A research hypothesis decided on a device of the home network (spec 094 §4,
 * 4.8; research §2.7): the same choices as the app's link today (a version,
 * no version holds, leave open, the agent's proposals) go to the gateway's
 * own `device/hypothesis/<H>`, no terminal and no mark; reopening is the
 * computer's. The research writes at once: the status is read again, the
 * tree takes its version the way it takes any.
 */

import { strings } from '../strings.js';
import { uiModule } from './module.js';
import { parseLiveBridge, researchDeviceAllows } from '../research-link.js';
import { storedResearchBridge } from '../research-device.js';
import { researchBridgeWrite } from '../research-directions-write.js';

/** What is asked of a hypothesis on a device. */
export type DeviceHypothesisDo = 'decide' | 'abandon' | 'keep-open' | 'proposed';

/** The body the gateway takes for it, or null (a version not said). */
export function deviceHypothesisBody(what: DeviceHypothesisDo, variant?: string): Record<string, unknown> | null {
    if (what === 'decide') return variant && /^[A-Z]{1,3}$/.test(variant) ? { variant } : null;
    if (what === 'abandon') return { abandon: true };
    if (what === 'keep-open') return { keepOpen: true };
    return { proposed: true };
}

export const deviceDecideMethods = uiModule({
    /** Decide hypotheses (`ids`) through the gateway, one request each; what came of it said once. */
    async deviceDecideHypotheses(ids: readonly string[], what: DeviceHypothesisDo, variant?: string): Promise<void> {
        const rid = this.activeResearchId();
        const ctx = this.researchSyncLink();
        const base = ctx ? parseLiveBridge(storedResearchBridge(ctx.link.id)?.base)?.base : null;
        const body = deviceHypothesisBody(what, variant);
        if (!rid || !base || !body) return;
        let done = 0;
        let gone = 0;
        let failed = 0;
        for (const id of ids) {
            if (!/^H\d{1,7}$/.test(id)) continue;
            const r = await researchBridgeWrite(base, 'POST', `device/hypothesis/${encodeURIComponent(id)}`, body, () => ({}));
            if (r.ok) done++;
            else if (r.status === 409 && r.errorCode === 'hypothesis.gone') gone++;
            // Refused as the computer's (403 device.computer-only): said once by the transport, the choices gone.
            else if (!researchDeviceAllows('hypothesis')) return;
            else failed++;
        }
        const D = strings.device;
        this.showToast(failed ? D.hypoFailed : gone && !done ? D.hypoGone : D.hypoDecided, failed ? 5000 : 3000);
        this.researchViewedStatusAfterWrite(rid);
    },
});

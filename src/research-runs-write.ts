/**
 * The runs of the directions written through the research's bridge (spec 126 U10): stop one run
 * (`POST <token>/runs/stop {run}`, with `run.stop` in `features`) and the most runs at once
 * (`POST <token>/settings/runs {max}`, with `run.limit`). No terminal and no new agent: neither carries
 * a mark (`RESEARCH_BRIDGE_MARKS`). Answers come typed as the directions' writes do (researchBridgeWrite).
 */

import { LiveRunLimits, LiveRunWire, researchRunRef, sanitizeRunLimits, sanitizeRuns } from './research-link.js';
import { BridgeWriteResult, bridgeWriteNotSent, researchBridgeWrite } from './research-directions-write.js';

/** The fewest and the most "most runs at once" the app writes (the research's `cap` may lower the most). */
export const RUN_LIMIT_MIN = 1;
export const RUN_LIMIT_MAX = 99;

/**
 * Stop one run: it finishes the task it works on and takes no next one (its terminal window closes by
 * itself). `run`: the run as the research answers it (state `finishing`; null: not said or not valid).
 * 404 `runs.unknown` (code `none`): the run is gone.
 */
export function postRunStop(base: string, runId: string): Promise<BridgeWriteResult<{ run: LiveRunWire | null }>> {
    const run = researchRunRef(runId);
    if (!run || run !== runId) return Promise.resolve(bridgeWriteNotSent());
    return researchBridgeWrite(base, 'POST', 'runs/stop', { run }, r => ({ run: sanitizeRuns([r.run])?.[0] ?? null }));
}

/**
 * Write the most runs at once (`run.parallel`, a whole number 1–99; the research takes 1 to its `cap`).
 * The app may only lower it: the research answers its new `limits` (null: not said or not valid), and
 * lowering it below the runs working stops none of them. Raising it is the person's in the terminal
 * (each run spends the agent's subscription): 403 `runs.raise` with the command (runLimitRaise). Out of
 * the research's range: 400 `runs.max` (code `bad-body`).
 */
export function postRunLimit(base: string, max: number): Promise<BridgeWriteResult<{ limits: LiveRunLimits | null }>> {
    if (!Number.isInteger(max) || max < RUN_LIMIT_MIN || max > RUN_LIMIT_MAX) return Promise.resolve(bridgeWriteNotSent());
    return researchBridgeWrite(base, 'POST', 'settings/runs', { max }, r => ({ limits: sanitizeRunLimits(r.limits) }));
}

/** A refused raise of the most runs at once: the terminal command that raises it (null: not said), else null (another answer). */
export function runLimitRaise(r: BridgeWriteResult<object>): { command: string | null } | null {
    return !r.ok && r.errorCode === 'runs.raise' ? { command: r.command ?? null } : null;
}

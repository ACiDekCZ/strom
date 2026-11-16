/**
 * The main window's end of the agent's mirror (spec 097 K1.3, K3.1): it
 * takes the agent's state after a hint (a change of the research panel, the
 * cards' research word, a bridge's status, the lines' places) at most once
 * per THROTTLE_MS, and once a second while another window is connected, and
 * sends only the sections that changed. A window that said hello or asked
 * gets the whole state. Nothing is built while no other window (than an
 * overview window, which has its own research state) is connected, so many
 * windows or a tree of thousands of people cost one build per tick.
 */

import type { WindowEntry, WindowRegistry } from './window-registry.js';
import { AgentStateSender, type AgentSections, type AgentStamps } from './agent-state.js';

/** At most one post of the agent's state per this many ms after hints. */
export const AGENT_THROTTLE_MS = 250;
/** The state is looked at this often while a window is connected (a change without a hint). */
export const AGENT_TICK_MS = 1000;

export interface AgentMainDeps {
    /** The agent's state now, ready to cross (agentStateSafe), and the stamps of its large sections. */
    sections(): { sections: AgentSections; stamps?: AgentStamps };
}

type RegistryPart = Pick<WindowRegistry, 'list' | 'onChange' | 'onWindowHello' | 'postAgentState' | 'setAgentRev' | 'onAgentStateRequest'>;

export interface AgentMain {
    /** Something the agent's state reads may have changed: it goes out within AGENT_THROTTLE_MS. */
    changed(): void;
    /** The revision sent last. */
    rev(): number;
    stop(): void;
}

/** A window that draws from the mirror: connected and not an overview window. */
const mirrored = (list: readonly WindowEntry[]): boolean => list.some(e => e.connected && e.kind !== 'overview');

export function startAgentMain(registry: RegistryPart, deps: AgentMainDeps, opts: { throttleMs?: number; tickMs?: number; now?: () => number } = {}): AgentMain {
    const throttle = opts.throttleMs ?? AGENT_THROTTLE_MS;
    const now = opts.now ?? Date.now;
    const sender = new AgentStateSender(now());
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = -Infinity;
    let stopped = false;

    /** Take the state now; a changed one goes to every window. */
    const take = (): void => {
        if (timer) { clearTimeout(timer); timer = null; }
        lastAt = now();
        let built: { sections: AgentSections; stamps?: AgentStamps };
        try {
            built = deps.sections();
        } catch (err) {
            console.error('agent state failed', err);
            return;
        }
        const delta = sender.next(built.sections, built.stamps);
        if (!delta) return;
        registry.postAgentState(delta);
        registry.setAgentRev(sender.rev);
    };

    const changed = (): void => {
        if (stopped || timer || !mirrored(registry.list())) return;
        timer = setTimeout(take, Math.max(0, lastAt + throttle - now()));
    };

    /** The whole state to one window (its hello, its ask), taken fresh first. */
    const sendFull = (id: string): void => {
        if (stopped) return;
        take();
        if (!sender.started) return;
        registry.postAgentState(sender.full(), id);
        registry.setAgentRev(sender.rev);
    };

    const offHello = registry.onWindowHello((id, kind) => { if (kind !== 'overview') sendFull(id); });
    const offReq = registry.onAgentStateRequest(id => sendFull(id));
    const offChange = registry.onChange(() => changed());
    const tick = setInterval(() => { if (mirrored(registry.list())) take(); }, opts.tickMs ?? AGENT_TICK_MS);

    return {
        changed,
        rev: () => sender.rev,
        stop: () => {
            stopped = true;
            offHello();
            offReq();
            offChange();
            clearInterval(tick);
            if (timer) clearTimeout(timer);
            timer = null;
        },
    };
}

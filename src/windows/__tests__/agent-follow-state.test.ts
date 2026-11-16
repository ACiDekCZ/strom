/**
 * A satellite's own following of the agent (spec 097 §1–§3, §6): attached
 * while the main window follows live, paused and back, detached kept over
 * the window's reload (sessionStorage, only `detached`), forgotten at the
 * end of the session, not at the main window's reload (until it stays not
 * live a while); the window's state in its hello and view messages.
 */

import { describe, it, expect } from 'vitest';
import { AgentFollowState, FORGET_AFTER_MS, agentFollowKey, parseAgentFollow, type AgentFollowChange } from '../agent-follow-state.js';
import { SatelliteClient } from '../satellite.js';
import type { WindowBus } from '../window-bus.js';

function memoryStorage(): Storage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        get length() { return map.size; },
        clear: () => map.clear(),
        getItem: (k: string) => map.get(k) ?? null,
        key: (i: number) => [...map.keys()][i] ?? null,
        removeItem: (k: string) => { map.delete(k); },
        setItem: (k: string, v: string) => { map.set(k, v); },
    };
}

describe('AgentFollowState', () => {
    it('attached once the main window follows live; nothing before or after', () => {
        const st = new AgentFollowState('w1', memoryStorage());
        expect(st.value).toBeNull();
        expect(st.following).toBe(false);
        st.setLive(true, false);
        expect(st.value).toBe('attached');
        expect(st.following).toBe(true);
    });

    it('a pause by hand and back; nothing kept of a pause', () => {
        const storage = memoryStorage();
        const st = new AgentFollowState('w1', storage);
        st.setLive(true, false);
        st.setPaused(true);
        expect(st.value).toBe('paused');
        expect(st.following).toBe(true);
        expect(storage.map.size).toBe(0);
        st.setPaused(false);
        expect(st.value).toBe('attached');
        // Not live: no pause.
        const off = new AgentFollowState('w2', storage);
        off.setPaused(true);
        expect(off.value).toBeNull();
    });

    it('detached is kept for the window (its reload) and only for it; Follow the agent drops it', () => {
        const storage = memoryStorage();
        const st = new AgentFollowState('w1', storage);
        st.setLive(true, false);
        st.setPaused(true);
        st.detach();
        expect(st.value).toBe('detached');
        expect(st.following).toBe(false);
        expect(storage.getItem(agentFollowKey('w1'))).toBe('detached');
        // A pause does not apply while detached.
        st.setPaused(true);
        expect(st.value).toBe('detached');
        // The window reloaded: detached again at the first live status.
        const again = new AgentFollowState('w1', storage);
        again.setLive(true, false);
        expect(again.value).toBe('detached');
        // Another window is not touched.
        const other = new AgentFollowState('w2', storage);
        other.setLive(true, false);
        expect(other.value).toBe('attached');
        again.attach();
        expect(again.value).toBe('attached');
        expect(storage.getItem(agentFollowKey('w1'))).toBeNull();
    });

    it('the end of the live session (the same main window): the strip goes, the detachment is forgotten, said once', () => {
        const storage = memoryStorage();
        const st = new AgentFollowState('w1', storage);
        const seen: AgentFollowChange[] = [];
        st.onChange(c => seen.push(c));
        st.setLive(true, false);
        st.detach();
        st.setLive(false, true);
        expect(st.value).toBeNull();
        expect(storage.getItem(agentFollowKey('w1'))).toBeNull();
        expect(seen.map(c => c.ended)).toEqual([false, false, true]);
        // Not live again: nothing more is said.
        st.setLive(false, true);
        expect(seen).toHaveLength(3);
        // A new session: attached.
        st.setLive(true, true);
        expect(st.value).toBe('attached');
    });

    it('the main window reloads (another one, not live yet): no end, the detachment stays until it stays not live a while', () => {
        const storage = memoryStorage();
        let now = 1_000_000;
        const st = new AgentFollowState('w1', storage, { now: () => now });
        const seen: AgentFollowChange[] = [];
        st.onChange(c => seen.push(c));
        st.setLive(true, false);
        st.detach();
        // The new main window's first statuses: not live yet.
        st.setLive(false, false);
        expect(st.value).toBeNull();
        expect(seen.at(-1)).toEqual({ value: null, ended: false });
        now += 2000;
        st.setLive(false, true);
        expect(storage.getItem(agentFollowKey('w1'))).toBe('detached');
        // Its following comes back: the window is detached as it was.
        st.setLive(true, true);
        expect(st.value).toBe('detached');
        // Another reload that never follows again: forgotten after a while.
        st.setLive(false, false);
        now += FORGET_AFTER_MS - 1;
        st.setLive(false, true);
        expect(storage.getItem(agentFollowKey('w1'))).toBe('detached');
        now += 1;
        st.setLive(false, true);
        expect(storage.getItem(agentFollowKey('w1'))).toBeNull();
    });

    it('parses a state from a message', () => {
        expect(['attached', 'paused', 'detached', 'live', null, 3].map(parseAgentFollow)).toEqual(['attached', 'paused', 'detached', null, null, null]);
    });
});

describe('the window\'s state in its messages (spec 097 §7)', () => {
    function fakeBus() {
        const posted: Record<string, unknown>[] = [];
        const bus = {
            post: (m: Record<string, unknown>) => { posted.push(m); },
            on: () => () => {},
        } as unknown as WindowBus;
        return { bus, posted };
    }

    it('hello and view carry it; a change of it is a view message', () => {
        const { bus, posted } = fakeBus();
        const data = { setWindowSink: () => {}, loadFromWindow: () => {}, windowDataJson: () => '{}', isEditSessionActive: () => false };
        const client = new SatelliteClient({ windowId: 'w1', kind: 'family', treeId: null } as never, { bus, data, storage: null, locks: null });
        client.setAgentFollow('detached');
        client.start();
        expect(posted.find(m => m.type === 'hello')).toMatchObject({ windowId: 'w1', agent: 'detached' });
        client.setAgentFollow('paused');
        expect(posted.at(-1)).toEqual({ type: 'view', windowId: 'w1', kind: 'family', agent: 'paused' });
        // The same again: nothing.
        const n = posted.length;
        client.setAgentFollow('paused');
        expect(posted).toHaveLength(n);
        client.setKind('fan');
        expect(posted.at(-1)).toEqual({ type: 'view', windowId: 'w1', kind: 'fan', agent: 'paused' });
        client.stop();
    });
});

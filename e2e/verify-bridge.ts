import { Page, Route } from '@playwright/test';
import { BRIDGE, FakeBridge, researchGed } from './research-bridge.js';

/**
 * The research's verifying of facts on the fake bridge (spec 065):
 * `POST /verify`, `/verify/bulk` and `/verify/stop`, answered as the research
 * does, every body kept. Registered after fakeBridge (a later route wins).
 * Invented data only.
 */

export interface FakeVerify {
    /** Every body, by route ('verify', 'verify/bulk', 'verify/stop'). */
    posts: { route: string; body: Record<string, unknown> }[];
    /** Facts a scope takes without a try: line, lineage, tree. */
    counts: { line: number; lineage: number; tree: number };
    /** The place in the queue a person's start gets. */
    position: number;
}

/** Jan's facts the research verifies: the birth by reading a record, the death by searching one. */
export const VERIFY_FACTS = [
    { fact: 'E0012', kind: 'BIRT', how: 'read', record: { source: 'S0001', title: 'Křestní matrika Čapkov', page: 'fol. 12' } },
    { fact: 'E0013', kind: 'DEAT', how: 'search' },
];

/** The research's tree with Jan's birth and death named by their ids (what /verify takes). */
export function verifyGed(head?: string): string {
    return researchGed(head, [
        '1 BIRT', '2 DATE 1860', '2 PLAC Čapkov', '2 _STROM_STATUS probable', '2 SOUR @S0001@', '2 _STROM_EID E0012',
        '1 DEAT', '2 DATE 1910', '2 PLAC Čapkov', '2 _STROM_STATUS possible', '2 _STROM_EID E0013',
    ]);
}

/** The features a research that verifies says. */
export const VERIFY_FEATURES = ['verify', 'verify.bulk', 'verify.stop'];

export async function fakeVerify(page: Page, bridge: FakeBridge, init: Partial<FakeVerify> = {}): Promise<FakeVerify> {
    const v: FakeVerify = { posts: [], counts: { line: 4, lineage: 9, tree: 30 }, position: 2, ...init };
    const cors = { 'access-control-allow-origin': '*' };
    const serve = async (route: Route): Promise<void> => {
        const req = route.request();
        if (req.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, PUT, POST', 'access-control-allow-headers': '*' } });
            return;
        }
        const path = new URL(req.url()).pathname.replace(/^\/[^/]+\//, '');
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>; } catch { /* empty */ }
        v.posts.push({ route: path, body });
        const json = (status: number, b: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(b) });
        const dry = body.dry === true;
        if (path === 'verify') {
            const facts = typeof body.fact === 'string' ? VERIFY_FACTS.filter(f => f.fact === body.fact) : VERIFY_FACTS;
            await json(200, {
                ok: true, task: dry ? null : 'T0042', facts, ...(dry ? {} : { position: v.position }),
                estimate: { sessions: 1, usd: 0.4 }, head: bridge.head,
            });
            return;
        }
        if (path === 'verify/bulk') {
            const all = v.counts[(body.scope as keyof FakeVerify['counts']) ?? 'tree'] ?? 0;
            const tried = typeof body.try === 'number';
            const facts = tried ? Math.min(all, 7) : all;
            await json(200, {
                ok: true, people: tried ? Math.min(5, all) : Math.ceil(all / 2), facts, tasks: dry ? [] : ['T0050'],
                left: all - facts, estimate: { sessions: Math.max(1, Math.round(facts / 4)), usd: facts * 0.3 }, head: bridge.head,
            });
            return;
        }
        if (path === 'verify/stop') {
            await json(200, { ok: true, dropped: 1, facts: 2, head: bridge.head });
            return;
        }
        await route.fallback();
    };
    // The app adds its version as a query: match on the path alone.
    const prefix = new URL(BRIDGE).pathname;
    await page.route(u => u.origin === new URL(BRIDGE).origin && /^\/verify(\/|$)/.test(u.pathname.slice(prefix.length)), serve);
    return v;
}

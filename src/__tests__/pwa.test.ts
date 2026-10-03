/**
 * PWA registration gate: the service worker is registered only on the hosted
 * PWA, never in the exported single-file app (embedded) or during development.
 */

import { describe, it, expect } from 'vitest';
import { shouldRegisterServiceWorker, pwaBasePath, isBetaLocation, watchForUpdate } from '../pwa.js';

describe('shouldRegisterServiceWorker', () => {
    it('registers only on the hosted PWA', () => {
        expect(shouldRegisterServiceWorker('pwa')).toBe(true);
    });
    it('never registers in embedded or dev modes', () => {
        expect(shouldRegisterServiceWorker('embedded')).toBe(false);
        expect(shouldRegisterServiceWorker('dev')).toBe(false);
    });
});

describe('pwaBasePath', () => {
    it('serves the public app from /run/', () => {
        expect(pwaBasePath('/run/')).toBe('/run/');
        expect(pwaBasePath('/run/index.html')).toBe('/run/');
        expect(pwaBasePath('/')).toBe('/run/');
    });
    it('serves the pre-release test build from /beta/', () => {
        expect(pwaBasePath('/beta/')).toBe('/beta/');
        expect(pwaBasePath('/beta')).toBe('/beta/');
        expect(pwaBasePath('/beta/index.html')).toBe('/beta/');
    });
    it('does not mistake look-alike paths for the beta', () => {
        expect(pwaBasePath('/betamax/')).toBe('/run/');
        expect(pwaBasePath('/run/beta/')).toBe('/run/');
    });
});

describe('isBetaLocation', () => {
    it('knows the beta site by its host', () => {
        expect(isBetaLocation('beta.stromapp.info', '/run/')).toBe(true);
    });
    it('knows the beta build by its path on the hosted site', () => {
        expect(isBetaLocation('stromapp.info', '/beta/')).toBe(true);
    });
    it('leaves the public app alone', () => {
        expect(isBetaLocation('stromapp.info', '/run/')).toBe(false);
        expect(isBetaLocation('www.stromapp.info', '/run/')).toBe(false);
    });
});

// ---- The update prompt's Refresh ----

import { vi, afterEach } from 'vitest';
import { applyServiceWorkerUpdate, findWaitingWorkers, resetServiceWorkerState, SKIP_WAITING_RETRY_MS } from '../pwa.js';

class FakeWorker extends EventTarget {
    messages: unknown[] = [];
    constructor(public state: string, private activatesOn = 1) { super(); }
    postMessage(msg: unknown): void {
        this.messages.push(msg);
        if (this.messages.length >= this.activatesOn) {
            this.state = 'activated';
            this.dispatchEvent(new Event('statechange'));
        }
    }
}

function fakeReg(o: { waiting?: FakeWorker | null; active?: FakeWorker | null; scope?: string; update?: () => Promise<void> }) {
    return {
        scope: o.scope ?? 'https://beta.stromapp.info/run/',
        waiting: o.waiting ?? null,
        active: o.active ?? null,
        installing: null,
        update: o.update ?? (async () => {}),
    } as unknown as ServiceWorkerRegistration;
}

function fakeContainer(regs: ServiceWorkerRegistration[], controller: unknown = null) {
    return {
        controller,
        getRegistration: async () => regs[0],
        getRegistrations: async () => regs,
    } as unknown as ServiceWorkerContainer;
}

describe('applyServiceWorkerUpdate', () => {
    afterEach(() => { resetServiceWorkerState(); vi.useRealTimers(); });

    it('tells the waiting worker to activate and reloads once it has', async () => {
        const waiting = new FakeWorker('installed');
        const reload = vi.fn();
        await applyServiceWorkerUpdate(fakeContainer([fakeReg({ waiting })]), reload);
        expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
        expect(reload).toHaveBeenCalled();
    });

    it('asks again a worker that is still waiting', async () => {
        vi.useFakeTimers();
        const waiting = new FakeWorker('installed', 2);
        const reload = vi.fn();
        await applyServiceWorkerUpdate(fakeContainer([fakeReg({ waiting })]), reload);
        expect(reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(SKIP_WAITING_RETRY_MS);
        expect(waiting.messages).toHaveLength(2);
        expect(reload).toHaveBeenCalled();
    });

    it('finds a waiting worker held by another registration of its scope', async () => {
        const waiting = new FakeWorker('installed');
        const container = {
            controller: null,
            getRegistration: async () => fakeReg({}),
            getRegistrations: async () => [fakeReg({ scope: 'https://beta.stromapp.info/other/', waiting: new FakeWorker('installed') }), fakeReg({ waiting })],
        } as unknown as ServiceWorkerContainer;
        const found = await findWaitingWorkers(null, container, '/run/');
        expect(found).toEqual([waiting]);
    });

    it('with nothing waiting, reloads onto a newer worker another window switched to', async () => {
        const reload = vi.fn();
        const active = new FakeWorker('activated');
        await applyServiceWorkerUpdate(fakeContainer([fakeReg({ active })], new FakeWorker('activated')), reload);
        expect(reload).toHaveBeenCalled();
    });

    it('with nothing waiting and the page on the newest worker, looks for the update again', async () => {
        const reload = vi.fn();
        const active = new FakeWorker('activated');
        const update = vi.fn(async () => {});
        await applyServiceWorkerUpdate(fakeContainer([fakeReg({ active, update })], active), reload);
        expect(update).toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });
});

describe('watchForUpdate (finding 34: the refresh prompt)', () => {
    type L = () => void;
    const worker = (state: string) => {
        const ls: L[] = [];
        const w = { state, addEventListener: (_: string, f: L) => { ls.push(f); }, become(next: string) { w.state = next; ls.forEach(f => f()); } };
        return w;
    };
    const registration = (init: { waiting?: unknown; installing?: unknown }) => {
        const ls: L[] = [];
        const r: { waiting: unknown; installing: unknown; addEventListener: (t: string, f: L) => void; found: (w: unknown) => void } = {
            waiting: init.waiting ?? null, installing: init.installing ?? null,
            addEventListener: (_: string, f: L) => { ls.push(f); }, found(w: unknown) { r.installing = w; ls.forEach(f => f()); } };
        return r;
    };
    const run = (r: ReturnType<typeof registration>, controlled = true) => {
        let n = 0;
        watchForUpdate(r as unknown as ServiceWorkerRegistration, () => controlled, () => { n++; });
        return () => n;
    };

    it('a worker waiting already: offered at once', () => {
        expect(run(registration({ waiting: worker('installed') }))()).toBe(1);
    });

    it('a worker still installing when the registration resolved (its updatefound gone by): offered once installed', () => {
        const w = worker('installing');
        const told = run(registration({ installing: w }));
        expect(told()).toBe(0);
        w.become('installed');
        expect(told()).toBe(1);
        w.become('activating');
        expect(told()).toBe(1);
    });

    it('a worker found later: offered once installed', () => {
        const r = registration({});
        const told = run(r);
        const w = worker('installing');
        r.found(w);
        w.become('installed');
        expect(told()).toBe(1);
    });

    it('the first install (no worker controls the page): nothing offered', () => {
        const w = worker('installing');
        const told = run(registration({ installing: w }), false);
        w.become('installed');
        expect(told()).toBe(0);
    });
});

/**
 * The person of a batch sent from a phone's Research screen (spec 094 K3.13
 * §6 point 3): searched in the research through the bridge (`people?q=`, at
 * most 8), never in the tree — the tree is not downloaded for it. Without the
 * connection only the copy of the tree held here is searched, and only when it
 * is the tree loaded now (the caller gives that search; none: nothing is
 * searched and a quiet sentence says photos go without a person too).
 *
 * Like the screen itself, this module must never reach the tree (DataManager),
 * the renderer or the person picker (device-research-imports.test.ts): the
 * held copy's search comes from the caller.
 */

import { strings } from '../strings.js';
import { peopleQueryOk, searchPeople, type DevicePersonHit } from '../device/device-research-data.js';

/** How long typing rests before the research is asked. */
export const PERSON_SEARCH_DEBOUNCE_MS = 250;
/** At most this many people are offered. */
export const PERSON_SEARCH_MAX = 8;

/** A hit's second line: "years · place" (either alone, or nothing). */
export function personHitSub(hit: Pick<DevicePersonHit, 'span' | 'place'>): string {
    return [hit.span, hit.place].map(x => (x ?? '').trim()).filter(Boolean).join(' · ');
}

/** What a search came to: the people found (at most 8) and where they were searched. */
export interface PersonSearchResult {
    query: string;
    hits: DevicePersonHit[];
    /** 'bridge': the research answered; 'held': no connection, the tree held here searched; 'none': no connection, no tree to search. */
    from: 'bridge' | 'held' | 'none';
}

export interface PersonSearchOptions {
    /** The research's tree (its ID). */
    treeId: string;
    /** The research's search (default: `people?q=` through the gateway); a failed connection throws. */
    search?: (treeId: string, q: string, signal?: AbortSignal | null) => Promise<DevicePersonHit[]>;
    /** The copy of the tree held here, searched without the connection; null: that tree is not loaded now. */
    local?: (q: string) => DevicePersonHit[] | null;
    /** Each answer (a query too short: an empty one from the bridge, at once). */
    onResult: (r: PersonSearchResult) => void;
    wait?: number;
}

/** The search behind the field: each query asked after a pause in typing, an older ask dropped. */
export interface PersonSearch {
    ask(q: string): void;
    stop(): void;
}

export function createPersonSearch(o: PersonSearchOptions): PersonSearch {
    const search = o.search ?? searchPeople;
    const wait = o.wait ?? PERSON_SEARCH_DEBOUNCE_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctl: AbortController | null = null;
    let seq = 0;
    const stop = (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
        ctl?.abort();
        ctl = null;
        seq++;
    };
    const run = async (query: string, mine: number): Promise<void> => {
        ctl = typeof AbortController === 'function' ? new AbortController() : null;
        let result: PersonSearchResult;
        try {
            const hits = await search(o.treeId, query, ctl?.signal ?? null);
            result = { query, hits: hits.slice(0, PERSON_SEARCH_MAX), from: 'bridge' };
        } catch {
            const held = o.local?.(query) ?? null;
            result = held ? { query, hits: held.slice(0, PERSON_SEARCH_MAX), from: 'held' } : { query, hits: [], from: 'none' };
        }
        if (mine === seq) o.onResult(result);
    };
    return {
        ask(q: string): void {
            stop();
            const query = q.trim();
            const mine = seq;
            if (!peopleQueryOk(query)) {
                o.onResult({ query, hits: [], from: 'bridge' });
                return;
            }
            timer = setTimeout(() => {
                timer = null;
                void run(query, mine);
            }, wait);
        },
        stop,
    };
}

function esc(text: string): string {
    return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/** The field mounted in `host`: the search, its hits (a name in the serif, "years · place"), the quiet sentence. */
export function mountPhonePersonSearch(host: HTMLElement, o: Omit<PersonSearchOptions, 'onResult'> & {
    computer: string;
    onPick: (hit: DevicePersonHit) => void;
}): PersonSearch {
    const r = strings.deviceResearch;
    host.classList.add('phone-person');
    host.innerHTML = `
        <input type="search" class="phone-person__input" autocomplete="off" enterkeyhint="search"
            aria-label="${esc(r.personTitle)}" placeholder="${esc(r.personTitle)}">
        <ul class="phone-person__hits" role="listbox" aria-label="${esc(r.personTitle)}"></ul>
        <p class="phone-person__note" aria-live="polite"></p>`;
    const input = host.querySelector<HTMLInputElement>('.phone-person__input')!;
    const list = host.querySelector<HTMLElement>('.phone-person__hits')!;
    const note = host.querySelector<HTMLElement>('.phone-person__note')!;
    note.textContent = r.personNote(o.computer);
    let shown: DevicePersonHit[] = [];
    const search = createPersonSearch({
        ...o,
        onResult: (res) => {
            shown = res.hits;
            list.innerHTML = res.hits.map((h, i) => {
                const sub = personHitSub(h);
                return `<li role="none"><button type="button" role="option" class="phone-person__hit" data-i="${i}">
                    <span class="phone-person__name">${esc(h.name)}</span>${sub ? `<span class="phone-person__sub">${esc(sub)}</span>` : ''}</button></li>`;
            }).join('');
            const asked = peopleQueryOk(res.query);
            if (asked && !res.hits.length && res.from !== 'none') {
                list.innerHTML = `<li class="phone-person__none">${esc(r.personNone)}</li>`;
            }
            note.textContent = res.from === 'bridge' ? r.personNote(o.computer) : r.personOffline;
        },
    });
    input.addEventListener('input', () => search.ask(input.value));
    list.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('.phone-person__hit');
        const hit = btn ? shown[Number(btn.dataset.i)] : undefined;
        if (!hit) return;
        search.stop();
        o.onPick(hit);
    });
    return search;
}

/**
 * Research directions in the Research overview ("research" in the research,
 * id G…): the Directions section after Now (only with two or more), each
 * direction's detail (generations of ancestors, its last session, Work on it,
 * Show in tree), its ⋯ menu (pause / end / restart in the research), the
 * direction named beside tasks while two or more run, and what the person
 * menu's "Find ancestors / descendants / Review again" says when the person
 * already has such a direction. Bridge text is set as text, never HTML.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { Person, PersonId } from '../types.js';
import { LiveDirection, LiveDirectionKind, ResearchDirectionDo } from '../research-link.js';
import { uiModule } from './module.js';
import { LiveSession, el, liveSection, liveSession } from './research-ui.js';
import { shownName } from '../person-name.js';

type Mode = 'docked' | 'overlay' | 'sheet';

/** The direction whose detail is open (one at a time). */
let expanded: string | null = null;
/** "Paused and ended" unfolded. */
let inactiveOpen = false;
/** The queue's direction filter ('all' or a direction id; not remembered). */
let queueFilter = 'all';

const KIND_GLYPH: Record<LiveDirectionKind, string> = { ancestors: '↑', descendants: '↓', person: '⌕', question: '?' };

/** The person menu's research items and the direction kind each would start. */
const MENU_KIND: Record<string, LiveDirectionKind> = {
    'research-ancestors': 'ancestors',
    'research-descendants': 'descendants',
    'research-review': 'person',
};

function personByRefn(refn: string | undefined): Person | null {
    if (!refn) return null;
    return Object.values(DataManager.getData().persons).find(p => p.refn === refn) ?? null;
}

const fullName = (p: Person): string => shownName(p);

function shortDate(iso: string): string {
    const ts = Date.parse(iso);
    return Number.isFinite(ts) ? new Date(ts).toLocaleDateString(getCurrentLanguage(), { day: 'numeric', month: 'numeric' }) : '';
}

/** Two or more directions run: tasks name theirs, the queue filters by them. */
export function directionsMulti(s: LiveSession | null): boolean {
    return !!s && s.researches.filter(d => d.state === 'active').length >= 2;
}

/** A task's direction name while two or more run ('' otherwise). */
export function taskDirectionName(s: LiveSession | null, research: string | undefined): string {
    if (!research || !directionsMulti(s)) return '';
    return s!.researches.find(d => d.id === research)?.name ?? '';
}

/** The queue filter while two or more run ('all' otherwise). */
export function queueDirectionFilter(s: LiveSession | null): string {
    if (!directionsMulti(s)) return 'all';
    if (queueFilter !== 'all' && !s!.researches.some(d => d.id === queueFilter && d.state === 'active')) queueFilter = 'all';
    return queueFilter;
}

export function setQueueDirectionFilter(id: string): void {
    queueFilter = id;
}

/** Running ones first (the one worked on first, then the newest), then paused and ended. */
function orderDirections(list: readonly LiveDirection[]): { active: LiveDirection[]; inactive: LiveDirection[] } {
    const since = (d: LiveDirection): number => Date.parse(d.since ?? '') || 0;
    const active = list.filter(d => d.state === 'active')
        .sort((a, b) => Number(!!b.working) - Number(!!a.working) || since(b) - since(a));
    const inactive = list.filter(d => d.state !== 'active').sort((a, b) => since(b) - since(a));
    return { active, inactive };
}

/** The running directions in the section's order (the queue's filter pills follow it). */
export function activeDirections(s: LiveSession): LiveDirection[] {
    return orderDirections(s.researches).active;
}

/** Running, but nothing to do and nobody on it. */
function isEmpty(d: LiveDirection): boolean {
    return d.state === 'active' && d.tasks === 0 && (d.waiting ?? 0) === 0 && !d.working;
}

/** The people of a direction, as the app knows them (null: it has no person). */
export function directionPersonIds(d: LiveDirection): PersonId[] | null {
    const focus = personByRefn(d.focus);
    if (!focus) return null;
    const data = DataManager.getData();
    const out = new Set<PersonId>([focus.id]);
    const walk = (id: PersonId, next: (p: Person) => PersonId[]): void => {
        for (const n of next(data.persons[id] ?? ({} as Person))) {
            if (out.has(n) || !data.persons[n]) continue;
            out.add(n);
            walk(n, next);
        }
    };
    if (d.direction === 'ancestors') walk(focus.id, p => p.parentIds ?? []);
    else if (d.direction === 'descendants') walk(focus.id, p => p.childIds ?? []);
    else if (d.direction === 'person') {
        for (const id of focus.parentIds ?? []) out.add(id);
        for (const id of focus.childIds ?? []) out.add(id);
        for (const pid of focus.partnerships ?? []) {
            const u = data.partnerships[pid];
            if (u) out.add(u.person1Id === focus.id ? u.person2Id : u.person1Id);
        }
    }
    return [...out].filter(id => data.persons[id]);
}

/** Generation labels: parents, grandparents, then "3. gen.". */
function generationLabel(g: number): string {
    const L = strings.live;
    return g === 1 ? L.dirGenParents : g === 2 ? L.dirGenGrandparents : L.dirGen(g);
}

export const researchDirectionsMethods = uiModule({
    /** The Directions section of the overview (two or more directions). */
    appendOverviewDirections(body: HTMLElement, s: LiveSession, fold: { id: string; collapsed: boolean; onToggle: () => void }, mode: Mode): void {
        if (s.researches.length < 2) return;
        const L = strings.live;
        const { active, inactive } = orderDirections(s.researches);
        const host = liveSection(body, { ...fold, title: L.dirTitle(active.length) });
        host.classList.add('research-directions');
        const list = el('div', 'research-directions__list');
        host.appendChild(list);
        for (const d of active) list.appendChild(this.directionRow(s, d, mode));
        if (inactive.length > 0) {
            const toggle = el('button', 'research-directions__inactive');
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', String(inactiveOpen));
            const chevron = el('span', 'live-section__chevron', inactiveOpen ? '▾' : '▸');
            chevron.setAttribute('aria-hidden', 'true');
            toggle.append(chevron, el('span', undefined, L.dirInactive(inactive.length)));
            toggle.onclick = () => {
                inactiveOpen = !inactiveOpen;
                this.renderResearchOverview();
            };
            list.appendChild(toggle);
            if (inactiveOpen) for (const d of inactive) list.appendChild(this.directionRow(s, d, mode));
        }
    },

    /** One direction: kind, name (and the arc while worked on), person and counts, ⋯; its detail when open. */
    directionRow(s: LiveSession, d: LiveDirection, mode: Mode): HTMLElement {
        const L = strings.live;
        const phone = mode === 'sheet';
        const canDo = !phone && this.researchLinkAvailable('direction');
        const open = !phone && expanded === d.id;
        const row = el('div', `research-direction${d.state !== 'active' ? ' is-inactive' : ''}${open ? ' is-open' : ''}`);
        row.dataset.direction = d.id;

        const icon = el('span', 'research-direction__icon', d.direction ? KIND_GLYPH[d.direction] : '');
        icon.setAttribute('aria-hidden', 'true');
        if (!d.direction) icon.classList.add('is-blank');
        row.appendChild(icon);

        const main = el('div', 'research-direction__main');
        const head = el('button', 'research-direction__head');
        head.type = 'button';
        const name = el('span', 'research-direction__name', d.name);
        head.appendChild(name);
        if (d.working && d.state === 'active') {
            const arc = el('span', 'agent-mark agent-mark--spin');
            arc.setAttribute('aria-hidden', 'true');
            head.appendChild(arc);
        }
        if (d.state !== 'active') head.appendChild(el('span', 'research-direction__chip', d.state === 'paused' ? L.dirPaused : L.dirDone));
        if (phone) {
            // Phone: a tap shows the direction's people in the tree.
            head.onclick = () => this.showDirectionInTree(d, mode);
        } else {
            head.setAttribute('aria-expanded', String(open));
            head.onclick = () => {
                expanded = open ? null : d.id;
                this.renderResearchOverview();
            };
        }
        main.appendChild(head);

        const meta = el('div', 'research-direction__meta');
        if (d.state !== 'active') {
            const bits = [d.reason ? L.dirReason(d.reason) : '', d.since ? L.dirSince(shortDate(d.since)) : ''].filter(Boolean);
            if (bits.length > 0) meta.appendChild(el('span', undefined, bits.join(' · ')));
        } else {
            const focus = personByRefn(d.focus);
            if (focus) {
                const link = el('button', 'live-person-link', fullName(focus));
                link.type = 'button';
                link.onclick = () => this.overviewShowPerson(focus.id, mode);
                meta.appendChild(link);
            }
            if (isEmpty(d)) {
                meta.appendChild(el('span', 'research-direction__empty', phone ? L.dirEmptyPhone : L.dirEmpty));
            } else {
                if (d.tasks) meta.appendChild(el('span', undefined, L.dirTasks(d.tasks)));
                if (d.waiting) meta.appendChild(el('span', 'research-direction__waiting', L.dirWaiting(d.waiting)));
            }
        }
        if (meta.childElementCount > 0) main.appendChild(meta);
        // Right on the row: End ↗ for an empty direction, Restart ↗ for a paused / ended one.
        if (canDo && (isEmpty(d) || d.state !== 'active')) {
            const what: ResearchDirectionDo = d.state === 'active' ? 'done' : 'resume';
            const btn = el('button', 'link-button research-direction__do', `${what === 'done' ? L.dirEnd : L.dirResume} ↗`);
            btn.type = 'button';
            btn.dataset.do = what;
            btn.onclick = () => this.runDirection(d.id, what);
            main.appendChild(btn);
        }
        if (open) main.appendChild(this.directionDetail(d, mode));
        row.appendChild(main);

        if (canDo) {
            const more = el('button', 'live-queue-more research-direction__more', '⋯');
            more.type = 'button';
            more.setAttribute('aria-label', L.dirMenu);
            more.setAttribute('aria-haspopup', 'menu');
            more.onclick = (e) => {
                e.stopPropagation();
                this.openDirectionMenu(more, d);
            };
            row.appendChild(more);
        }
        return row;
    },

    /** The open detail: generations (ancestors), the last session, Work on it ↗, Show in tree. */
    directionDetail(d: LiveDirection, mode: Mode): HTMLElement {
        const L = strings.live;
        const detail = el('div', 'research-direction__detail');
        if (d.direction === 'ancestors' && d.generations && d.generations.length > 0) {
            detail.appendChild(el('div', 'research-direction__label', L.dirGenTitle));
            const grid = el('div', 'research-direction__gens');
            d.generations.forEach((known, i) => {
                const g = i + 1;
                const max = 2 ** g;
                const cell = el('div', 'research-direction__gen');
                const bar = el('span', 'research-direction__gen-bar');
                const fill = el('span', 'research-direction__gen-fill');
                fill.style.width = `${Math.min(100, Math.round((known / max) * 100))}%`;
                bar.appendChild(fill);
                cell.append(bar, el('span', 'research-direction__gen-text', `${Math.min(known, max)}/${max} ${generationLabel(g)}`));
                grid.appendChild(cell);
            });
            detail.appendChild(grid);
        }
        if (d.last) detail.appendChild(el('div', 'research-direction__last', L.dirLast(shortDate(d.last.at), d.last.text)));
        const actions = el('div', 'research-direction__actions');
        const work = this.activeResearchLink('chat', { research: d.id });
        if (work) {
            const btn = el('button', 'link-button', `${L.dirWork} ↗`);
            btn.type = 'button';
            btn.dataset.do = 'work';
            btn.onclick = () => this.launchResearchLink(work, 'agent');
            actions.appendChild(btn);
        }
        if (directionPersonIds(d)) {
            const btn = el('button', 'link-button', L.dirShow);
            btn.type = 'button';
            btn.dataset.do = 'show';
            btn.onclick = () => this.showDirectionInTree(d, mode);
            actions.appendChild(btn);
        }
        if (actions.childElementCount > 0) detail.appendChild(actions);
        return detail;
    },

    /** The direction's people lit up in the tree, named by the direction. */
    showDirectionInTree(d: LiveDirection, mode: Mode): void {
        const ids = directionPersonIds(d);
        if (!ids) return;
        if (mode === 'sheet') this.closeResearchOverview();
        this.startPersonHighlight('direction', d.name, ids, () => directionPersonIds(d) ?? []);
    },

    /** Pause / end / restart a direction in the research (the terminal asks; the next status tells). */
    runDirection(id: string, what: ResearchDirectionDo): void {
        this.closeDirectionMenu();
        const url = this.activeResearchLink('direction', { research: id, directionDo: what });
        if (url) this.launchResearchLink(url);
    },

    /** The ⋯ menu of a direction: each action with one line of what it does. */
    openDirectionMenu(anchor: HTMLElement, d: LiveDirection): void {
        const wasOpen = document.getElementById('live-direction-menu')?.dataset.direction === d.id;
        this.closeDirectionMenu();
        if (wasOpen) return;
        const L = strings.live;
        const menu = el('div', 'context-menu live-task-menu research-direction-menu');
        menu.id = 'live-direction-menu';
        menu.dataset.direction = d.id;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', L.dirMenu);
        const items: [ResearchDirectionDo, string, string][] = d.state === 'active'
            ? [['pause', L.dirPause, L.dirPauseHint], ['done', L.dirEnd, L.dirEndHint]]
            : [['resume', L.dirResume, L.dirResumeHint]];
        for (const [what, label, hint] of items) {
            const item = el('div', 'context-menu-item research-direction-menu__item');
            item.setAttribute('role', 'menuitem');
            item.tabIndex = -1;
            item.dataset.do = what;
            item.append(el('span', 'research-direction-menu__label', `${label} ↗`), el('span', 'research-direction-menu__hint', hint));
            item.onclick = () => this.runDirection(d.id, what);
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.runDirection(d.id, what); }
            };
            menu.appendChild(item);
        }
        document.body.appendChild(menu);
        anchor.setAttribute('aria-expanded', 'true');
        const rect = anchor.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
        const below = rect.bottom + 4;
        const top = below + menu.offsetHeight > window.innerHeight - 8 ? rect.top - menu.offsetHeight - 4 : below;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        (menu.firstElementChild as HTMLElement | null)?.focus();
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeDirectionMenu();
                anchor.focus();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const all = [...menu.querySelectorAll<HTMLElement>('.context-menu-item')];
                const i = all.indexOf(document.activeElement as HTMLElement);
                all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
            }
        };
        const onDown = (e: Event): void => {
            if (!menu.contains(e.target as Node) && e.target !== anchor) this.closeDirectionMenu();
        };
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
        directionMenuCleanup = () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            anchor.removeAttribute('aria-expanded');
        };
    },

    closeDirectionMenu(): void {
        directionMenuCleanup?.();
        directionMenuCleanup = null;
        document.getElementById('live-direction-menu')?.remove();
    },

    /** Open the overview on a direction: Directions unfolded, its detail open. */
    openResearchDirection(id: string): void {
        expanded = id;
        const s = liveSession();
        if (s?.researches.find(d => d.id === id)?.state !== 'active') inactiveOpen = true;
        this.unfoldOverviewSection('directions');
        if (this.isResearchOverviewOpen()) this.renderResearchOverview();
        else this.openResearchOverview();
        requestAnimationFrame(() => {
            document.querySelector(`#research-overview .research-direction[data-direction="${CSS.escape(id)}"]`)
                ?.scrollIntoView({ block: 'nearest' });
        });
    },

    /**
     * The person's existing direction of the kind a person-menu research item
     * would start (followed live, this tree): running, or paused / ended.
     */
    personDirection(personId: PersonId, action: string): LiveDirection | null {
        const kind = MENU_KIND[action];
        const s = liveSession();
        const refn = DataManager.getPerson(personId)?.refn;
        if (!kind || !s || s.ended || s.treeId !== DataManager.getCurrentTreeId() || !refn) return null;
        const mine = s.researches.filter(d => d.direction === kind && d.focus === refn);
        return mine.find(d => d.state === 'active') ?? mine[0] ?? null;
    },
});

let directionMenuCleanup: (() => void) | null = null;

/**
 * The Research overview: the followed research at length, next to the tree.
 * One thing in two sizes with the small live panel (⤢ / ⤡); the same
 * sections, drawn by the same helpers (src/ui/research-ui.ts).
 *   - desktop (≥ 1280px): a side panel; the tree's area narrows beside it and
 *     the point in the middle of the view stays in the middle;
 *   - tablet: a 400px panel over the tree;
 *   - phone: a full-screen sheet opened from the strip.
 * Summary (state, what came while watching, this month), Waiting for you,
 * Now, Progress (changes grouped by the agent's task, filtered, hover lights
 * the card up, "Show changed in tree"), Queue, What the research knows
 * (open conflicts and hypotheses across the tree), and where evidence is
 * missing. Bridge text is set as text, never HTML. Only while following.
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { ZoomPan } from '../zoom.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { Person, PersonId } from '../types.js';
import { computeEvidenceGaps } from '../stats.js';
import { LiveChangeKind } from '../research-link.js';
import { uiModule } from './module.js';
import {
    LiveChangeItem, LiveSession, appendChangeText, el, ensureLiveTicker, liveDuration, liveSection,
    liveSession, storeLiveSection, storedLiveSections, timeEl,
} from './research-ui.js';

/** The overview stays open over a reload / the next following (per device). */
const OPEN_KEY = 'strom-live-overview-open';
/** The overview's own fold choices. */
const SECTIONS_KEY = 'strom-live-overview-sections';
/** Folded unless the user unfolds them. */
const FOLDED_BY_DEFAULT = new Set(['queue', 'knows']);
/** Changes without a task are grouped by this long. */
const GROUP_MS = 15 * 60_000;

type Filter = 'all' | Exclude<LiveChangeKind, 'other'>;
type Mode = 'docked' | 'overlay' | 'sheet';

let filter: Filter = 'all';
/** When the overview was opened (changes after it are marked new for a moment). */
let openedAt = 0;
/** Older change groups the user unfolded (by group key). */
const unfoldedGroups = new Set<string>();
/** The card lit up by hovering a change row. */
let hovered: HTMLElement | null = null;

function overviewMode(): Mode {
    if (window.matchMedia?.('(max-width: 640px)').matches) return 'sheet';
    return window.innerWidth >= 1280 ? 'docked' : 'overlay';
}

function sectionCollapsed(key: string): boolean {
    return storedLiveSections(SECTIONS_KEY)[key] ?? FOLDED_BY_DEFAULT.has(key);
}

function personByRefn(refn: string | undefined): Person | null {
    if (!refn) return null;
    return Object.values(DataManager.getData().persons).find(p => p.refn === refn) ?? null;
}

const fullName = (p: Person): string => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || '?';

function hhmm(ts: number): string {
    return new Date(ts).toLocaleTimeString(getCurrentLanguage(), { hour: 'numeric', minute: '2-digit' });
}

/** Light a card up while its change row is hovered. */
function hoverCard(id: PersonId | null): void {
    hovered?.classList.remove('overview-hover');
    hovered = id ? document.querySelector<HTMLElement>(`.person-card[data-id="${CSS.escape(id)}"]`) : null;
    hovered?.classList.add('overview-hover');
}

interface ChangeGroup {
    /** Unique per group (a task can come back later as a new run). */
    key: string;
    /** What joins the run: the task, or the 15 minutes. */
    run: string;
    title: string;
    items: LiveChangeItem[];
}

/** Changes (newest first) in runs of the same task; without one, by 15 minutes. */
function groupChanges(changes: readonly LiveChangeItem[]): ChangeGroup[] {
    const groups: ChangeGroup[] = [];
    for (const c of changes) {
        const ts = Date.parse(c.at);
        const bucket = Number.isFinite(ts) ? Math.floor(ts / GROUP_MS) * GROUP_MS : 0;
        const run = c.task ? `t:${c.task}` : `b:${bucket}`;
        const last = groups[groups.length - 1];
        if (last && last.run === run) {
            last.items.push(c);
            continue;
        }
        const title = c.task || (bucket ? `${hhmm(bucket)} – ${hhmm(bucket + GROUP_MS)}` : '');
        groups.push({ key: `${run}:${Number.isFinite(ts) ? ts : groups.length}`, run, title, items: [c] });
    }
    return groups;
}

export const researchOverviewMethods = uiModule({
    /** ⤢ is offered: following a research, on a screen wider than a phone. */
    canOpenResearchOverview(): boolean {
        const s = liveSession();
        return !!s && !s.ended && window.matchMedia?.('(max-width: 640px)').matches !== true;
    },

    /** Following the research of the tree on screen. */
    isFollowingActiveResearch(): boolean {
        const s = liveSession();
        return !!s && !s.ended && s.treeId === DataManager.getCurrentTreeId();
    },

    isResearchOverviewOpen(): boolean {
        return !!document.getElementById('research-overview');
    },

    /** The overview was open last time (a new following opens it again). */
    researchOverviewRemembered(): boolean {
        try {
            return localStorage.getItem(OPEN_KEY) === '1' && this.canOpenResearchOverview();
        } catch {
            return false;
        }
    },

    openResearchOverview(): void {
        const s = liveSession();
        if (!s || s.ended) return;
        s.overview = true;
        openedAt = Date.now();
        if (overviewMode() !== 'sheet') {
            try { localStorage.setItem(OPEN_KEY, '1'); } catch { /* not kept */ }
        }
        this.renderLivePanel();
        document.querySelector<HTMLElement>('#research-overview .research-overview__close')?.focus();
    },

    /** ⤡ (and Escape): back to the small panel; following goes on. */
    closeResearchOverview(): void {
        const s = liveSession();
        if (!s) return;
        s.overview = false;
        if (overviewMode() !== 'sheet') {
            try { localStorage.setItem(OPEN_KEY, '0'); } catch { /* not kept */ }
        }
        hoverCard(null);
        this.renderLivePanel();
    },

    /** Narrow the tree's area beside the docked overview, keeping the view's middle in the middle. */
    setResearchOverviewDocked(on: boolean): void {
        if (document.body.classList.contains('overview-docked') === on) return;
        const { width, height } = ZoomPan.getViewportSize();
        const t = ZoomPan.getTransform();
        const wx = (width / 2 - t.tx) / t.scale;
        const wy = (height / 2 - t.ty) / t.scale;
        document.body.classList.toggle('overview-docked', on);
        if (width > 0) ZoomPan.centerOnWorldPoint(wx, wy);
    },

    /** Draw (or remove) the overview. Called with every panel redraw. */
    renderResearchOverview(): void {
        const s = liveSession();
        const on = !!s && !s.ended && s.overview && DataManager.getCurrentTreeId() === s.treeId;
        let root = document.getElementById('research-overview');
        if (!on || !s) {
            if (root) {
                root.remove();
                hoverCard(null);
            }
            this.setResearchOverviewDocked(false);
            return;
        }
        const L = strings.live;
        const r = strings.research;
        const mode = overviewMode();
        if (!root) {
            root = el('aside', 'research-overview');
            root.id = 'research-overview';
            document.body.appendChild(root);
        }
        root.className = `research-overview research-overview--${mode}`;
        root.dataset.form = `${mode === 'sheet'}:${window.innerWidth >= 1280}`;
        if (mode === 'sheet') {
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
        } else {
            root.setAttribute('role', 'complementary');
            root.removeAttribute('aria-modal');
        }
        root.setAttribute('aria-label', L.overviewTitle);
        const scroller = root.querySelector<HTMLElement>('.research-overview__body');
        const scrollTop = scroller?.scrollTop ?? 0;
        root.replaceChildren();

        // Head: state dot, title, the research's name, ⤡ / ×, Stop.
        const head = el('div', 'research-overview__head');
        head.appendChild(el('span', 'live-dot live-dot--still'));
        const titles = el('div', 'research-overview__titles');
        titles.append(el('h2', 'research-overview__title', L.overviewTitle), el('span', 'research-overview__name', s.name));
        head.appendChild(titles);
        const close = el('button', 'research-overview__close', mode === 'sheet' ? '×' : '⤡');
        close.type = 'button';
        close.setAttribute('aria-label', mode === 'sheet' ? r.close : L.closeOverview);
        close.title = mode === 'sheet' ? r.close : L.closeOverview;
        close.onclick = () => this.closeResearchOverview();
        const stop = el('button', 'live-panel-action', r.stop);
        stop.type = 'button';
        stop.onclick = () => this.stopLiveFollow();
        head.append(stop, close);
        root.appendChild(head);

        const body = el('div', 'research-overview__body');
        root.appendChild(body);
        this.appendOverviewSummary(body, s, mode);
        if (s.update) this.appendUpdateStrip(body, s.update.version);

        const fold = (key: string) => ({
            id: `ov-sec-${key}`,
            collapsed: sectionCollapsed(key),
            onToggle: () => {
                storeLiveSection(SECTIONS_KEY, key, !sectionCollapsed(key));
                this.renderResearchOverview();
            },
        });

        if (s.waiting.length > 0) this.appendOverviewWaiting(body, s, fold('waiting'), mode);
        this.appendOverviewNow(body, s, fold('now'), mode);
        this.appendOverviewTimeline(body, s, fold('timeline'), mode);
        if (!s.ended) this.appendQueueSection(body, s, fold('queue'), 20, L.queueTitle);
        this.appendOverviewKnows(body, fold('knows'), mode);
        this.appendOverviewFoot(root, s, mode);
        body.scrollTop = scrollTop;

        this.setResearchOverviewDocked(mode === 'docked');
        ensureLiveTicker();
    },

    /** The summary strip: state, what came while watching, this month. */
    appendOverviewSummary(body: HTMLElement, s: LiveSession, mode: Mode): void {
        const L = strings.live;
        const data = DataManager.getData();
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder).length;
        const sources = Object.keys(data.sources ?? {}).length;
        const strip = el('div', 'research-overview__summary');
        const cell = (label: string, value: string, sub: HTMLElement | string, cls = '', title = ''): void => {
            const c = el('div', `research-overview__cell${cls ? ` ${cls}` : ''}`);
            c.append(el('div', 'research-overview__cell-label', label), el('div', 'research-overview__cell-value', value));
            const subEl = typeof sub === 'string' ? el('div', 'research-overview__cell-sub', sub) : sub;
            // One line; the whole text (and the research version) on hover.
            subEl.title = title || subEl.textContent || '';
            c.appendChild(subEl);
            strip.appendChild(c);
        };
        const [state, stateCls] = s.working.length > 0 ? [L.stateWorking, 'is-working']
            : s.waiting.length > 0 ? [L.stateWaiting, 'is-waiting'] : [L.stateIdle, 'is-idle'];
        const last = s.changes.length > 0 ? Date.parse(s.changes[0].at) : NaN;
        // When the last change came, and the research's version (its commit) after it.
        const lastText = Number.isFinite(last) ? L.lastChange(hhmm(last)) : L.noChangeYet;
        cell(L.state, state, [lastText, s.head ? s.head.slice(0, 7) : ''].filter(Boolean).join(' · '), stateCls,
            s.head ? `${lastText} · ${L.versionTitle(s.head.slice(0, 7))}` : '');
        cell(L.sinceWatching, L.plusPersons(Math.max(0, persons - s.startPersons)),
            L.plusSources(Math.max(0, sources - s.startSources), hhmm(s.startedAt)));
        if (s.spend && mode !== 'sheet') {
            let amount: string;
            try {
                amount = new Intl.NumberFormat(getCurrentLanguage(), { style: 'currency', currency: s.spend.currency }).format(s.spend.amount);
            } catch {
                amount = `${s.spend.amount.toFixed(2)} ${s.spend.currency}`;
            }
            const url = this.activeResearchLink('sessions');
            let sub: HTMLElement;
            if (url) {
                sub = el('button', 'link-button research-overview__cell-sub', L.sessions(s.spend.sessions));
                (sub as HTMLButtonElement).type = 'button';
                sub.onclick = () => this.launchResearchLink(url);
            } else {
                sub = el('div', 'research-overview__cell-sub', L.sessions(s.spend.sessions).replace(' ↗', ''));
            }
            cell(L.thisMonth, amount, sub);
        }
        strip.classList.toggle('research-overview__summary--two', strip.childElementCount === 2);
        body.appendChild(strip);
    },

    /** Waiting for you: cards (two columns), the person when the research names one. */
    appendOverviewWaiting(body: HTMLElement, s: LiveSession, fold: { id: string; collapsed: boolean; onToggle: () => void }, mode: Mode): void {
        const r = strings.research;
        const L = strings.live;
        const host = liveSection(body, { ...fold, title: `${r.waiting} · ${s.waiting.length}`, headCls: 'live-panel-heading-waiting' });
        const grid = el('div', 'research-overview__waiting live-waiting');
        host.appendChild(grid);
        const canAnswer = mode !== 'sheet' && (this.researchLinkAvailable('task') || this.researchLinkAvailable('open'));
        for (const w of s.waiting) {
            const card = el('div', 'research-overview__waiting-card');
            card.appendChild(el('div', 'research-overview__waiting-text', w.what));
            const meta = el('div', 'research-overview__waiting-meta');
            const person = personByRefn(w.person);
            if (person) {
                const link = el('button', 'live-person-link', fullName(person));
                link.type = 'button';
                link.onclick = () => this.overviewShowPerson(person.id, mode);
                meta.appendChild(link);
            } else {
                meta.appendChild(el('span', 'research-overview__muted', L.wholeResearch));
            }
            const at = timeEl(w.at, 'ago');
            if (at) meta.appendChild(at);
            card.appendChild(meta);
            if (canAnswer) {
                const answer = el('button', 'live-waiting-answer', r.answer);
                answer.type = 'button';
                answer.onclick = () => this.answerResearchTask(w);
                card.appendChild(answer);
            } else if (mode === 'sheet') {
                card.appendChild(el('div', 'research-overview__muted', L.answerOnComputer));
            }
            grid.appendChild(card);
        }
    },

    /** Now: who works on what, since when; "Show in tree" when the research names the person. */
    appendOverviewNow(body: HTMLElement, s: LiveSession, fold: { id: string; collapsed: boolean; onToggle: () => void }, mode: Mode): void {
        const L = strings.live;
        const w0 = s.working[0];
        const since0 = w0 ? Date.parse(w0.since) : NaN;
        const host = liveSection(body, {
            ...fold, title: L.now,
            summary: w0 ? [w0.who, Number.isFinite(since0) ? liveDuration(since0) : ''].filter(Boolean).join(' · ') : L.nobody,
        });
        const list = el('ul', 'live-panel-list live-working research-overview__now');
        host.appendChild(list);
        if (s.working.length === 0) list.appendChild(el('li', 'live-empty', L.nobody));
        for (const w of s.working) {
            const li = el('li', 'research-overview__now-row');
            const text = el('div', 'research-overview__now-text');
            text.appendChild(el('strong', undefined, w.who));
            if (w.task) text.appendChild(el('span', 'live-task', ` — ${w.task}`));
            const since = timeEl(w.since, 'sincefor');
            if (since) text.appendChild(since);
            li.appendChild(text);
            const person = personByRefn(w.person);
            if (person) {
                const show = el('button', 'link-button', L.showInTree);
                show.type = 'button';
                show.onclick = () => this.overviewShowPerson(person.id, mode);
                li.appendChild(show);
            }
            list.appendChild(li);
        }
    },

    /** Progress: the changes while watching, by task, filtered; hover and click reach the tree. */
    appendOverviewTimeline(body: HTMLElement, s: LiveSession, fold: { id: string; collapsed: boolean; onToggle: () => void }, mode: Mode): void {
        const L = strings.live;
        const host = liveSection(body, { ...fold, title: L.timeline, summary: s.changes.length > 0 ? String(s.changes.length) : undefined });
        host.classList.add('research-overview__timeline');

        const bar = el('div', 'research-overview__timeline-bar');
        const filters = el('div', 'research-overview__filters');
        filters.setAttribute('role', 'radiogroup');
        filters.setAttribute('aria-label', L.filterLabel);
        const count = (f: Filter): number => (f === 'all' ? s.changes.length : s.changes.filter(c => c.kind === f).length);
        const labels: Record<Filter, string> = { all: L.filterAll, persons: L.filterPersons, sources: L.filterSources, stories: L.filterStories };
        for (const f of ['all', 'persons', 'sources', 'stories'] as Filter[]) {
            const chip = el('button', 'research-overview__filter', `${labels[f]} ${count(f)}`);
            chip.type = 'button';
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', String(filter === f));
            chip.dataset.filter = f;
            chip.onclick = () => {
                filter = f;
                this.renderResearchOverview();
            };
            filters.appendChild(chip);
        }
        bar.appendChild(filters);
        const changedIds = [...new Set(s.changes.flatMap(c => c.personIds))].filter(id => DataManager.getPerson(id));
        if (changedIds.length > 0) {
            const show = el('button', 'link-button research-overview__show-changed', L.showChanged);
            show.type = 'button';
            show.onclick = () => {
                if (mode === 'sheet') this.closeResearchOverview();
                this.startPersonHighlight('changed', L.changedTitle, changedIds, null);
            };
            bar.appendChild(show);
        }
        host.appendChild(bar);

        const shown = filter === 'all' ? s.changes : s.changes.filter(c => c.kind === filter);
        if (shown.length === 0) {
            host.appendChild(el('p', 'live-empty', strings.research.noChanges));
            return;
        }
        const groups = groupChanges(shown);
        const current = s.working[0]?.task ?? '';
        groups.forEach((g, i) => {
            const open = i === 0 || unfoldedGroups.has(g.key);
            const newest = Date.parse(g.items[0].at);
            const oldest = Date.parse(g.items[g.items.length - 1].at);
            const to = i === 0 && current && g.items[0].task === current ? L.groupNow : Number.isFinite(newest) ? hhmm(newest) : '';
            const span = [Number.isFinite(oldest) ? hhmm(oldest) : '', to].filter(Boolean).join(' – ');
            const gh = el('button', 'research-overview__group-head');
            gh.type = 'button';
            gh.setAttribute('aria-expanded', String(open));
            const chevron = el('span', 'live-section__chevron', open ? '▾' : '▸');
            chevron.setAttribute('aria-hidden', 'true');
            gh.append(chevron, el('span', 'research-overview__group-title', g.title), el('span', 'research-overview__group-span', `${span} · ${g.items.length}`));
            gh.onclick = () => {
                if (i === 0) return;
                if (unfoldedGroups.has(g.key)) unfoldedGroups.delete(g.key);
                else unfoldedGroups.add(g.key);
                this.renderResearchOverview();
            };
            host.appendChild(gh);
            if (!open) return;
            const list = el('ul', 'research-overview__rows live-changes');
            for (const c of g.items) {
                const li = el('li', 'research-overview__row');
                const ts = Date.parse(c.at);
                if (Number.isFinite(ts) && ts >= openedAt && Date.now() - ts < 4000) li.classList.add('is-new');
                li.appendChild(el('span', 'research-overview__row-time', Number.isFinite(ts) ? hhmm(ts) : ''));
                const text = el('span', 'research-overview__row-text');
                appendChangeText(text, c, (id) => this.overviewShowPerson(id, mode));
                li.appendChild(text);
                const target = c.personIds.find(id => DataManager.getPerson(id));
                if (target) {
                    li.classList.add('has-person');
                    li.onmouseenter = () => hoverCard(target);
                    li.onmouseleave = () => hoverCard(null);
                    li.onclick = () => this.overviewShowPerson(target, mode);
                }
                list.appendChild(li);
            }
            host.appendChild(list);
        });
    },

    /** What the research knows across the tree: open conflicts first, then hypotheses. */
    appendOverviewKnows(body: HTMLElement, fold: { id: string; collapsed: boolean; onToggle: () => void }, mode: Mode): void {
        const L = strings.live;
        const facts = strings.research.changeWords.facts as Record<string, string>;
        const rows: { person: Person; text: string; conflict: boolean }[] = [];
        for (const p of Object.values(DataManager.getData().persons)) {
            for (const c of p.research?.conflicts ?? []) {
                if (c.status === 'decided') continue;
                const what = c.title || facts[c.fact] || c.fact;
                rows.push({ person: p, text: `${fullName(p)} · ${what}: ${c.values.map(v => v.value).join(' × ')}`, conflict: true });
            }
            for (const h of p.research?.hypotheses ?? []) {
                rows.push({ person: p, text: `${fullName(p)} · ${L.hypothesisRow(h.title)}`, conflict: false });
            }
        }
        if (rows.length === 0) return;
        rows.sort((a, b) => Number(b.conflict) - Number(a.conflict));
        const conflicts = rows.filter(r => r.conflict).length;
        const host = liveSection(body, { ...fold, title: L.knowsTitle, summary: L.knowsSum(conflicts, rows.length - conflicts) });
        const list = el('ul', 'live-panel-list research-overview__knows');
        for (const row of rows) {
            const li = el('li');
            const btn = el('button', `research-overview__knows-row${row.conflict ? ' is-conflict' : ''}`, `${row.text} ›`);
            btn.type = 'button';
            btn.onclick = () => {
                if (mode === 'sheet') this.closeResearchOverview();
                this.showPersonResearchDialog(row.person.id);
            };
            li.appendChild(btn);
            list.appendChild(li);
        }
        host.appendChild(list);
    },

    /** Foot: where evidence is missing (tree health), Open the research ↗. */
    appendOverviewFoot(root: HTMLElement, s: LiveSession, mode: Mode): void {
        const L = strings.live;
        const foot = el('div', 'research-overview__foot');
        const missing = computeEvidenceGaps(DataManager.getData()).noSource.length;
        if (missing > 0) {
            const link = el('button', 'link-button', L.missingLink(missing));
            link.type = 'button';
            link.onclick = () => this.showTreeHealthDialog(s.treeId);
            foot.appendChild(link);
        }
        // The research runs on the computer: a phone gets no ↗ into it.
        const open = mode === 'sheet' ? null : this.activeResearchLink('open');
        if (open) {
            const btn = el('button', 'link-button research-overview__open', `${strings.research.openResearch} ↗`);
            btn.type = 'button';
            btn.onclick = () => this.launchResearchLink(open);
            foot.appendChild(btn);
        }
        if (foot.childElementCount > 0) root.appendChild(foot);
    },

    /** A person from the overview: centred in the tree (the sheet closes first). */
    overviewShowPerson(id: PersonId, mode: Mode): void {
        if (!DataManager.getPerson(id)) return;
        if (mode === 'sheet') this.closeResearchOverview();
        if (document.querySelector(`.person-card[data-id="${CSS.escape(id)}"]`)) {
            ZoomPan.centerOnPerson(id);
        } else {
            TreeRenderer.setFocus(id);
            void TreeRenderer.renderAsync().then(() => ZoomPan.centerOnPerson(id));
        }
    },
});

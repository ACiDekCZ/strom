/**
 * Research hypotheses in "What waits" and in the overview's "What the
 * research knows across the tree" (spec 074, DEV §9, §10). A hypothesis item
 * under Decide: "H0022 · question", the agent's proposal with "Accept
 * proposal B" and "Leave open", two or three versions each with "Choose",
 * or only a sentence; "More ›" opens its card at the person. Every choice
 * opens the research's terminal and waits in the row for its confirmation.
 * With a research that accepts proposals at once (`hypotheses.accept.link`):
 * a box before each hypothesis with a proposal, "Select all with a
 * proposal", "{n} selected." with the large links and "Accept proposals (n)";
 * the list waits as one, and its notice says how many were accepted.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import type { PersonId, ResearchHypothesis } from '../types.js';
import { HYPOTHESES_ACCEPT_LINK_FEATURE, LiveWaiting, researchLinkMark } from '../research-link.js';
import type { HypothesisPick } from '../research-hypothesis-pick.js';
import { researchHypotheses, isOpenHypothesis } from '../view-links.js';
import {
    hypothesisCardNote, newPendingHypothesis, onPendingHypothesisChange, pendingHypothesis, setPendingHypothesis,
} from '../research-hypothesis-wait.js';
import { researchHypothesisNoteText } from '../research-hypotheses.js';
import {
    HypothesisAcceptBox, acceptBatch, acceptBatchRowResult, acceptBatchWaitingCount, acceptBigJoins, acceptSelection,
    acceptSelectionFull, clearAcceptSelection, finishAcceptBatch, hypothesisAcceptAsk, hypothesisAcceptBox,
    hypothesisOpenProposal, hypothesisProposalBigJoin, pruneAcceptSelection, selectAllAccept, startAcceptBatch,
    stopAcceptBatch, toggleAcceptSelection, waitingHypothesisPlan,
} from '../research-hypothesis-waiting.js';
import { researchActionLabel, setResearchActionLabel } from './research-open-mark.js';
import type { SearchHit } from '../section-search-match.js';
import { selectedOutside } from '../section-search-filter.js';
import { el, liveSession, markWaitingFocus } from './research-ui.js';
import { lastBridgeStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';
import type { UIClass } from './index.js';

type Mode = 'docked' | 'overlay' | 'sheet' | 'window';

/** One hypothesis of a list that accepts proposals at once. */
export interface HypothesisAcceptEntry {
    id: string;
    h: ResearchHypothesis | undefined;
    box: HypothesisAcceptBox;
}

/**
 * A list of hypotheses while its section is searched (spec 083 §1, §2): the
 * hypotheses the search shows in the section (the picked ones outside it stay
 * picked, the foot says how many) and what matched each by its number.
 */
export interface HypothesisListSearch {
    found: ReadonlySet<string>;
    hitOf?: (id: string) => SearchHit | undefined;
}

/** How long the notice of a list accepted stays. */
const TOAST_MS = 8000;

/** The people carrying a hypothesis, the item's person first. */
function hypothesisPersonIds(id: string, first?: string): PersonId[] {
    const out: PersonId[] = [];
    for (const [pid, p] of Object.entries(DataManager.getData().persons ?? {})) {
        if (p?.isPlaceholder || !(p?.research?.hypotheses ?? []).some(h => h.id === id)) continue;
        if (first && p.refn === first) out.unshift(pid as PersonId);
        else out.push(pid as PersonId);
    }
    return out;
}

/** The keyboard back where it was after a redraw (the elements carry `data-focus-key`). */
function refocus(key: string | undefined): void {
    if (!key) return;
    const target = document.querySelector<HTMLElement>(`#research-overview [data-focus-key="${CSS.escape(key)}"]`);
    if (target && !(target as HTMLButtonElement).disabled) target.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>('#research-overview .hp2-head, #research-overview .research-overview__body')?.focus?.({ preventScroll: true });
}

let listening: UIClass | null = null;

/**
 * Told whenever a wait is set or ends: the overview draws again (the rows'
 * waits), and a list asked at once whose last wait ended says how many were
 * accepted (after the load that ended them told each outcome).
 */
function listen(ui: UIClass): void {
    if (listening) { listening = ui; return; }
    listening = ui;
    let queued = false;
    onPendingHypothesisChange(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            const u = listening;
            if (!u) return;
            const rid = u.activeResearchId();
            if (rid) {
                const done = finishAcceptBatch(rid, id => !!pendingHypothesis(rid, id));
                if (done) u.showToast(strings.research.hypoAcceptedOf(done.accepted, done.of), TOAST_MS, { kind: 'hypothesis-decided' });
            }
            if (document.getElementById('research-overview')) {
                const key = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey;
                u.renderResearchOverview();
                refocus(key);
            }
        });
    });
}

export const hypothesisWaitingMethods = uiModule({
    /**
     * Accepting the agent's proposals at once is offered (DEV §10, P2): the
     * research says `hypotheses.accept.link`, its link is announced on this
     * computer, the tree takes edits.
     */
    hypothesesAcceptAvailable(): boolean {
        const rid = this.activeResearchId();
        if (!rid || DataManager.isReadOnly()) return false;
        const status = this.researchStatusOf(rid) ?? lastBridgeStatus(rid);
        return !!status?.features?.includes(HYPOTHESES_ACCEPT_LINK_FEATURE) && this.researchLinkAvailable('hypotheses');
    },

    /** The entries of a list (hypothesis ids in order, each once), each with its box. */
    hypothesisAcceptEntries(ids: readonly string[], items?: ReadonlyMap<string, LiveWaiting>): HypothesisAcceptEntry[] {
        const hyps = researchHypotheses(DataManager.getData());
        const seen = new Set<string>();
        const out: HypothesisAcceptEntry[] = [];
        for (const id of ids) {
            if (seen.has(id)) continue;
            seen.add(id);
            const h = hyps.get(id);
            const pick: HypothesisPick = h ? this.researchHypothesisPickable(h) : 'old';
            out.push({ id, h, box: hypothesisAcceptBox(h, pick, items?.get(id)) });
        }
        return out;
    },

    /** The picked ones that cannot be picked any more go (decided meanwhile, the proposal gone). */
    pruneHypothesisAcceptSelection(rid: string): void {
        if (acceptSelection(rid).size === 0) return;
        const all = this.hypothesisAcceptEntries([...researchHypotheses(DataManager.getData()).keys()]);
        pruneAcceptSelection(rid, new Set(all.filter(e => e.box === 'on').map(e => e.id)));
    },

    /** The list asked at once still waits (its boxes are locked meanwhile). */
    hypothesisAcceptLocked(rid: string): boolean {
        const b = acceptBatch(rid);
        return !!b && acceptBatchWaitingCount(b, id => !!pendingHypothesis(rid, id)) > 0;
    },

    /**
     * A hypothesis's box (DEV §10): a checkbox for one with a proposal decided
     * here (switched off while the list waits, or when 50 are picked and it is
     * not); a dashed one switched off when only the research decides it; an
     * empty place without a proposal.
     */
    hypothesisAcceptBoxEl(rid: string, e: HypothesisAcceptEntry, where: string): HTMLElement {
        const r = strings.research;
        if (e.box === 'none') {
            const gap = el('span', 'hp2-box hp2-box--none');
            gap.setAttribute('aria-hidden', 'true');
            return gap;
        }
        const box = el('input', `hp2-box${e.box === 'only-research' ? ' hp2-box--only' : ''}`);
        box.type = 'checkbox';
        box.dataset.hypo = e.id;
        box.dataset.focusKey = `hp2:${where}:${e.id}`;
        box.setAttribute('aria-label', r.hypoAcceptPick(e.id));
        if (e.box === 'only-research') {
            box.disabled = true;
            box.title = r.hypoOnlyResearch;
            return box;
        }
        const picked = acceptSelection(rid).has(e.id);
        box.checked = picked;
        if (this.hypothesisAcceptLocked(rid)) box.disabled = true;
        else if (!picked && acceptSelectionFull(rid)) {
            box.disabled = true;
            box.title = r.hypoAcceptMax;
        }
        box.onchange = () => {
            toggleAcceptSelection(rid, e.id, box.checked);
            this.renderResearchOverview();
            refocus(box.dataset.focusKey);
        };
        return box;
    },

    /** The note beside a box that cannot be ticked: only the research decides it, or it has no proposal. */
    hypothesisAcceptNote(e: HypothesisAcceptEntry): HTMLElement | null {
        const r = strings.research;
        if (e.box === 'only-research') return el('span', 'hp2-note', r.hypoOnlyResearch);
        if (e.box === 'none' && e.h && isOpenHypothesis(e.h)) return el('span', 'hp2-note', r.hypoNoProposal);
        return null;
    },

    /**
     * Above a list (DEV §10): while a list asked at once waits, its block
     * ("Waiting for confirmation in the research · 3 hypotheses", Open again,
     * Stop waiting); else "Select all with a proposal" while one can still be
     * picked. Null when neither.
     */
    hypothesisAcceptHeadEl(rid: string, entries: readonly HypothesisAcceptEntry[], where: string,
        search: HypothesisListSearch | null = null): HTMLElement | null {
        const r = strings.research;
        const b = acceptBatch(rid);
        const waiting = b ? acceptBatchWaitingCount(b, id => !!pendingHypothesis(rid, id)) : 0;
        if (b && waiting > 0) {
            const block = el('div', 'prv-wait hp2-wait');
            block.setAttribute('role', 'status');
            const title = block.appendChild(el('span', 'prv-wait-title'));
            title.appendChild(el('span', 'prv-wait-dot')).setAttribute('aria-hidden', 'true');
            title.append(r.hypoListWait(waiting));
            const actions = block.appendChild(el('span', 'prv-wait-actions'));
            const again = setResearchActionLabel(el('button', 'link-button prv-wait-again'), r.hypoWaitAgain, researchLinkMark('hypotheses'));
            again.type = 'button';
            again.dataset.focusKey = `hp2:${where}:again`;
            again.onclick = () => this.launchResearchLink(b.url, 'terminal');
            const stop = el('button', 'link-button prv-wait-stop', r.hypoWaitStop);
            stop.type = 'button';
            stop.onclick = () => {
                stopAcceptBatch(rid);
                for (const id of b.ids) setPendingHypothesis(rid, id, null);
            };
            actions.append(again, stop);
            return block;
        }
        const sel = acceptSelection(rid);
        const free = entries.filter(e => e.box === 'on' && !sel.has(e.id));
        if (free.length === 0 || acceptSelectionFull(rid)) return null;
        const head = el('div', 'hp2-head');
        // Searching (spec 083): "Select found with a proposal (n)", the ones the search shows.
        const all = el('button', `link-button hp2-all${search ? ' hp2-all--found' : ''}`,
            search ? strings.live.bulkSelectFound(entries.filter(e => e.box === 'on').length) : r.hypoSelectAll);
        all.type = 'button';
        all.dataset.focusKey = `hp2:${where}:all`;
        all.onclick = () => {
            selectAllAccept(rid, entries.filter(e => e.box === 'on').map(e => e.id));
            this.renderResearchOverview();
            refocus(`hp2:${where}:accept`);
        };
        head.appendChild(all);
        return head;
    },

    /**
     * Under a list with one picked at least (DEV §10): "{n} selected.", each
     * large link ("Large link: H0052 → A links 214 people."), "At most 50 at
     * once." at the limit, and "Accept proposals (n)" into the research's
     * terminal. Null otherwise.
     */
    hypothesisAcceptFootEl(rid: string, where: string, search: HypothesisListSearch | null = null): HTMLElement | null {
        const r = strings.research;
        if (this.hypothesisAcceptLocked(rid)) return null;
        const ids = [...acceptSelection(rid)];
        if (ids.length === 0) return null;
        const hyps = researchHypotheses(DataManager.getData());
        const foot = el('div', 'hp2-foot');
        const sum = foot.appendChild(el('p', 'hp2-sum'));
        // Searching (spec 083): the picked ones the search hides stay picked; said in amber, with the way to drop them.
        const outside = search ? selectedOutside(ids, search.found) : [];
        if (outside.length > 0) {
            sum.classList.add('research-overview__bulk-hidden');
            sum.append(strings.live.bulkSelectedHidden(ids.length, outside.length));
        } else {
            sum.append(r.hypoSelected(ids.length));
        }
        for (const big of acceptBigJoins(ids.map(id => ({ id, h: hyps.get(id) })))) sum.append(` ${r.hypoBigSum(big.id, big.variant, big.people)}`);
        if (acceptSelectionFull(rid)) sum.append(` ${r.hypoAcceptMax}`);
        if (outside.length > 0) {
            const drop = el('button', 'link-button hp2-drop-outside', strings.live.bulkDeselectHidden);
            drop.type = 'button';
            drop.dataset.focusKey = `hp2:${where}:outside`;
            drop.onclick = () => {
                for (const id of outside) toggleAcceptSelection(rid, id, false);
                this.renderResearchOverview();
                refocus(`hp2:${where}:accept`);
            };
            sum.append(' ', drop);
        }
        const btn = el('button', 'primary hp2-accept');
        btn.type = 'button';
        btn.innerHTML = researchActionLabel(r.hypoAcceptMany(ids.length), researchLinkMark('hypotheses'));
        btn.dataset.focusKey = `hp2:${where}:accept`;
        btn.onclick = () => this.acceptHypothesisProposals(ids);
        foot.appendChild(btn);
        return foot;
    },

    /**
     * "Accept proposals (n)": the link opens the research's terminal (it lists
     * them and asks once); each hypothesis waits for its confirmation as
     * asked (its version decided, or no version holds), the list as one.
     */
    acceptHypothesisProposals(ids: readonly string[]): void {
        const rid = this.activeResearchId();
        const url = rid ? this.activeResearchLink('hypotheses', { hypothesesDo: 'accept', ids }) : null;
        if (!rid || !url) return;
        listen(this);
        this.launchResearchLink(url, 'terminal');
        const hyps = researchHypotheses(DataManager.getData());
        const head = this.researchSyncLink()?.link.head ?? '';
        const now = Date.now();
        startAcceptBatch(rid, ids, url, now);
        clearAcceptSelection(rid);
        for (const id of ids) {
            const h = hyps.get(id);
            const proposal = hypothesisOpenProposal(h);
            if (!h || proposal === undefined) continue;
            const ask = hypothesisAcceptAsk(proposal);
            setPendingHypothesis(rid, id, newPendingHypothesis(h, ask.do, url, head, now, ask.do === 'decide' ? ask.variant : undefined));
        }
        refocus('hp2:knows:again');
    },

    /** Ask the research (its terminal) to decide one hypothesis of "What waits", and wait in its row. */
    askWaitingHypothesis(h: ResearchHypothesis, what: 'decide' | 'abandon' | 'keep-open', variant?: string): void {
        const rid = this.activeResearchId();
        const url = h.id ? this.activeResearchLink('hypothesis', { hypothesis: h.id, hypothesisDo: what, ...(variant ? { variant } : {}) }) : null;
        if (!rid || !url || !h.id) return;
        listen(this);
        this.launchResearchLink(url, 'terminal');
        setPendingHypothesis(rid, h.id, newPendingHypothesis(h, what, url, this.researchSyncLink()?.link.head ?? '', Date.now(), variant));
    },

    /** The wait of one hypothesis (the card's), with its Open again and Stop waiting working here. */
    waitingHypothesisWaitEl(rid: string, h: ResearchHypothesis): HTMLElement | null {
        const p = h.id ? pendingHypothesis(rid, h.id) : null;
        if (!p || !h.id) return null;
        const id = h.id;
        const host = el('div', 'hwr-wait');
        host.innerHTML = this.researchHypothesisWaitHtml(h, p);
        const again = host.querySelector<HTMLButtonElement>('.prv-wait-again');
        if (again) {
            again.dataset.focusKey = `hwr:${id}:again`;
            again.onclick = () => this.launchResearchLink(p.url, 'terminal');
        }
        const stop = host.querySelector<HTMLButtonElement>('.prv-wait-stop');
        if (stop) stop.onclick = () => setPendingHypothesis(rid, id, null);
        return host;
    },

    /** The person whose card carries a hypothesis item (the item's person first), or null. */
    waitingHypothesisPerson(w: LiveWaiting): PersonId | null {
        return hypothesisPersonIds(w.id, w.person)[0] ?? null;
    },

    /** "More ›": the hypothesis's card at its person (the overview closes first on a phone). */
    waitingHypothesisMoreEl(id: string, personId: PersonId, mode: Mode | 'panel'): HTMLButtonElement {
        const r = strings.research;
        const more = el('button', 'link-button hwr-more', r.hypoMore);
        more.type = 'button';
        more.dataset.focusKey = `hwr:${id}:more`;
        more.setAttribute('aria-label', r.hypoMoreAria(id));
        more.onclick = () => {
            if (mode === 'sheet') this.closeResearchOverview();
            this.showPersonResearchDialog(personId, { hypo: { id } });
        };
        return more;
    },

    /**
     * A hypothesis item of "What waits" in the overview (DEV §9): "H0022 ·
     * question", then what its plan offers (waitingHypothesisPlan), the wait
     * for the research's confirmation, "More ›". `accept`: the list accepts
     * proposals at once (its box before the row).
     */
    hypothesisWaitingRow(w: LiveWaiting, mode: Mode, accept: HypothesisAcceptEntry | null, hit?: SearchHit): HTMLElement {
        const r = strings.research;
        listen(this);
        const rid = this.activeResearchId() ?? '';
        const hyps = researchHypotheses(DataManager.getData());
        const h = hyps.get(w.id);
        const pick: HypothesisPick = h ? this.researchHypothesisPickable(h) : 'old';
        const pending = rid && h?.id ? pendingHypothesis(rid, h.id) : null;
        const held = !!rid && !!h?.id && hypothesisCardNote(rid, h.id)?.kind === 'later';
        const plan = waitingHypothesisPlan(w, h, pick, { pending, held });
        const li = el('li', 'research-overview__waiting-item hwr-item');
        li.dataset.id = w.id;
        li.dataset.plan = plan.kind;
        // The first row ↓ of the section's search reaches.
        li.dataset.row = '';
        if (liveSession()?.waitingView.fresh.has(w.id)) li.classList.add('is-fresh');
        markWaitingFocus(li, w);
        const [personId] = hypothesisPersonIds(w.id, w.person);
        if (personId) {
            li.classList.add('has-person');
            li.dataset.person = personId;
        }
        if (accept) li.appendChild(this.hypothesisAcceptBoxEl(rid, accept, 'waiting'));
        const main = li.appendChild(el('div', 'hwr-main'));
        const what = main.appendChild(el('p', 'hwr-what'));
        // Its number matched by the section's search: amber, as in the Queue's.
        what.appendChild(el('strong', `hwr-id${hit?.h ? ' research-overview__hit' : ''}`, w.id));
        what.append(` · ${w.what || h?.title || ''}`);
        // Why its box cannot be ticked; a row whose sentence says where it is decided needs no second one.
        const note = accept && !(plan.text && accept.box === 'only-research') ? this.hypothesisAcceptNote(accept) : null;
        if (plan.kind === 'proposal') {
            const tags = main.appendChild(el('div', 'hwr-tags'));
            const strip = tags.appendChild(el('span', 'hwr-proposal'));
            strip.appendChild(el('strong', undefined, plan.proposal ? r.hypoProposal(plan.proposal) : r.hypoProposalNone));
            const said = h?.proposal?.text?.trim();
            if (said) strip.append(` · ${said}`);
            if (plan.big) tags.appendChild(bigPill(plan.big));
            if (note) tags.appendChild(note);
        } else if (note) {
            main.appendChild(el('div', 'hwr-tags')).appendChild(note);
        }
        const terminal = researchLinkMark('hypothesis');
        if (plan.kind === 'versions' && h) {
            const box = main.appendChild(el('div', 'hwr-versions'));
            box.setAttribute('role', 'list');
            for (const v of plan.versions) {
                const row = box.appendChild(el('div', 'hwr-version'));
                row.setAttribute('role', 'listitem');
                row.dataset.variant = v.id;
                row.appendChild(el('span', 'hwr-version-id', v.id)).setAttribute('aria-hidden', 'true');
                row.appendChild(el('span', 'hwr-version-title', v.title));
                const btn = setResearchActionLabel(el('button', 'secondary hwr-pick'), r.hypoPick, terminal, { sr: false });
                btn.type = 'button';
                btn.dataset.variant = v.id;
                btn.dataset.focusKey = `hwr:${w.id}:pick:${v.id}`;
                btn.setAttribute('aria-label', `${w.id} · ${r.hypoPickAria(v.id)}`);
                btn.disabled = v.pick === 'off';
                btn.onclick = () => this.askWaitingHypothesis(h, 'decide', v.id);
                row.appendChild(btn);
                // Only some versions keep the tree as it is: each of those says so (K1.6).
                if (v.keepsTree && !plan.keepsTree) row.appendChild(el('span', 'hwr-version-note', r.hypoKeepsTree));
                if (v.waiting && rid) {
                    const wait = this.waitingHypothesisWaitEl(rid, h);
                    if (wait) row.appendChild(wait);
                }
            }
        }
        // Every choice of the row keeps the tree as it is: one sentence says only the decision is recorded (K1.6).
        if (plan.keepsTree) main.appendChild(el('p', 'hwr-keeps', r.hypoKeepsTree));
        const actions = el('div', 'hwr-actions');
        if (plan.accept && h && plan.proposal !== undefined) {
            const proposal = plan.proposal;
            const btn = setResearchActionLabel(el('button', 'secondary hwr-accept'), proposal ? r.hypoAccept(proposal) : r.hypoAcceptNone, terminal);
            btn.type = 'button';
            btn.dataset.focusKey = `hwr:${w.id}:accept`;
            btn.disabled = plan.accept === 'off';
            btn.onclick = () => {
                const ask = hypothesisAcceptAsk(proposal);
                this.askWaitingHypothesis(h, ask.do, ask.do === 'decide' ? ask.variant : undefined);
            };
            actions.appendChild(btn);
        }
        if (plan.leave && h) {
            const btn = setResearchActionLabel(el('button', 'secondary hwr-leave'), r.hypoLeave, terminal);
            btn.type = 'button';
            btn.dataset.focusKey = `hwr:${w.id}:leave`;
            btn.disabled = plan.leave === 'off';
            btn.onclick = () => this.askWaitingHypothesis(h, 'keep-open');
            actions.appendChild(btn);
        }
        if (plan.text) {
            const words = plan.text === 'merge' ? r.hypoMerge : plan.text === 'remote' ? r.hypoRemote : r.hypoVersions(h?.variants?.length ?? 0);
            actions.appendChild(el('span', 'hwr-sentence', words));
        }
        if (plan.more && personId) actions.appendChild(this.waitingHypothesisMoreEl(w.id, personId, mode));
        if (actions.childElementCount > 0) main.appendChild(actions);
        if (plan.rowWait && h && rid) {
            const wait = this.waitingHypothesisWaitEl(rid, h);
            if (wait) main.appendChild(wait);
        }
        // Decided in the research already, its version not loaded ("Later"), or decided otherwise.
        const cardNote = rid && h?.id ? hypothesisCardNote(rid, h.id) : null;
        if (cardNote) main.appendChild(el('p', 'hwr-note', researchHypothesisNoteText(cardNote)));
        return li;
    },

    /**
     * The hypothesis items of one place of "What waits" with their list for
     * accepting proposals at once (where offered): its head, the rows with
     * their boxes, its foot.
     */
    hypothesisWaitingList(items: readonly LiveWaiting[], mode: Mode, rows: HTMLElement, search: HypothesisListSearch | null = null): HTMLElement {
        const rid = this.activeResearchId();
        const hypoItems = items.filter(w => w.kind === 'hypothesis');
        if (!rid || hypoItems.length === 0 || !this.hypothesesAcceptAvailable()) return rows;
        this.pruneHypothesisAcceptSelection(rid);
        const entries = this.hypothesisAcceptEntries(hypoItems.map(w => w.id), new Map(hypoItems.map(w => [w.id, w])));
        if (!entries.some(e => e.box !== 'none')) return rows;
        const byId = new Map(entries.map(e => [e.id, e]));
        for (const li of [...rows.querySelectorAll<HTMLElement>(':scope > .hwr-item')]) {
            const e = byId.get(li.dataset.id ?? '');
            const w = hypoItems.find(x => x.id === li.dataset.id);
            if (!e || !w) continue;
            li.replaceWith(this.hypothesisWaitingRow(w, mode, e, search?.hitOf?.(w.id)));
        }
        rows.classList.add('has-accept');
        const wrap = el('div', 'hp2-list hp2-list--waiting');
        const head = this.hypothesisAcceptHeadEl(rid, entries, 'waiting', search);
        if (head) wrap.appendChild(head);
        wrap.appendChild(rows);
        const foot = this.hypothesisAcceptFootEl(rid, 'waiting', search);
        if (foot) wrap.appendChild(foot);
        return wrap;
    },

    /**
     * Under a hypothesis's row of "What the research knows" (DEV §9, §10): the
     * agent's proposal and a large link's pill (where its card shows the
     * research's new marks), what became of it (decided as accepted, or
     * already decided in the research), or why its box cannot be ticked.
     */
    hypothesisKnowsTagsEl(h: ResearchHypothesis, accept: HypothesisAcceptEntry | null): HTMLElement | null {
        const r = strings.research;
        const rid = this.activeResearchId();
        const tags = el('span', 'rok-tags');
        const pick = this.researchHypothesisPickable(h);
        const extras = pick === 'pick' || pick === 'remote' || pick === 'readonly';
        const note = rid && h.id ? hypothesisCardNote(rid, h.id) : null;
        const result = rid && h.id ? acceptBatchRowResult(acceptBatch(rid), h.id) : null;
        if (note && (note.kind === 'later' || result)) {
            tags.appendChild(el('span', 'rok-tag rok-tag--note', researchHypothesisNoteText(note)));
        } else if (!isOpenHypothesis(h)) {
            if (result === 'accepted') {
                tags.appendChild(el('span', 'rok-tag rok-tag--done', r.decided(h.status === 'decided' ? h.chosen ?? '' : r.hypoNoneWord, '')));
            }
        } else if (extras) {
            const proposal = hypothesisOpenProposal(h);
            if (proposal !== undefined) tags.appendChild(el('span', 'rok-tag', proposal ? r.hypoProposal(proposal) : r.hypoProposalNone));
            const big = hypothesisProposalBigJoin(h, proposal);
            if (big) tags.appendChild(bigPill(big));
        }
        const why = accept ? this.hypothesisAcceptNote(accept) : null;
        if (why && isOpenHypothesis(h)) tags.appendChild(why);
        return tags.childElementCount > 0 ? tags : null;
    },

    /**
     * The hypotheses' rows of "What the research knows" with the list for
     * accepting proposals at once (where offered): which rows get a box, the
     * list's head and foot. Null entries: no list.
     */
    hypothesisKnowsAccept(ids: readonly string[], mode: Mode): { entries: Map<string, HypothesisAcceptEntry>; head: HTMLElement | null; foot: HTMLElement | null } | null {
        const rid = this.activeResearchId();
        if (!rid || !this.hypothesesAcceptAvailable()) return null;
        listen(this);
        this.pruneHypothesisAcceptSelection(rid);
        const entries = this.hypothesisAcceptEntries(ids);
        if (!entries.some(e => e.box !== 'none')) return null;
        return {
            entries: new Map(entries.map(e => [e.id, e])),
            head: this.hypothesisAcceptHeadEl(rid, entries, 'knows'),
            foot: this.hypothesisAcceptFootEl(rid, 'knows'),
        };
    },
});

/** The large link's pill (DEV §7): "links 214 people". */
function bigPill(n: number): HTMLElement {
    const pill = el('span', 'prv-big');
    pill.appendChild(el('span', 'view-link-icon view-link-icon--12')).setAttribute('aria-hidden', 'true');
    pill.append(strings.research.hypoBig(n));
    return pill;
}

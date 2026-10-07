/**
 * The research edge outside the card: the bubble over a stub (hover on a
 * computer, the first tap on touch), the "Above the person" section of "What
 * the research knows" (a click on the stub goes straight there), and the
 * tree's setting in Settings → Tree (research trees only).
 */

import { DataManager } from '../data.js';
import { TreeRenderer } from '../renderer.js';
import { TreeManager } from '../tree-manager.js';
import { strings } from '../strings.js';
import { formatFlexDate } from '../dates.js';
import { PersonId, ResearchEdge, ResearchEdgeMode } from '../types.js';
import {
    edgeEndText, edgeEstimateText, edgeFactsLine, edgeNextText, edgeTimeline, edgeTone, edgeMuted, effectiveNext,
} from '../research-edge.js';
import { researchCardInfoNow } from '../card-signals.js';
import { uiModule } from './module.js';
import { shownName } from '../person-name.js';

const BUBBLE_ID = 'research-edge-bubble';
const SHOW_DELAY_MS = 150;
const HIDE_DELAY_MS = 200;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const touch = (): boolean => window.matchMedia?.('(pointer: coarse)').matches === true;

let showTimer: number | undefined;
let hideTimer: number | undefined;
/** The person whose bubble is open (touch: the next tap on the stub opens the section). */
let bubbleFor: PersonId | null = null;

function clearTimers(): void {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
}

/** Today as an ISO date (local). */
function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The person's edge and its `next` with the live bridge on top (null: none). */
function edgeOf(personId: PersonId): { edge: ResearchEdge; next: string | undefined } | null {
    const p = DataManager.getPerson(personId);
    const edge = p?.research?.edge;
    if (!p || !edge) return null;
    const live = p.refn ? researchCardInfoNow().get(p.refn) : undefined;
    return { edge, next: effectiveNext(edge, { working: !!live?.agent, waiting: !!live?.waiting, queued: !!live?.queued }) };
}

/** A person of the tree by the research's REFN. */
function personByRefn(refn: string): PersonId | null {
    return DataManager.getAllPersons().find(p => p.refn === refn)?.id ?? null;
}

function personName(id: PersonId): string {
    const p = DataManager.getPerson(id);
    return p ? shownName(p) : '?';
}

export const researchEdgeUiMethods = uiModule({
    /** Hover, focus, click and tap on a card's stub (the renderer calls it per card). */
    bindResearchEdge(personId: PersonId, el: HTMLElement): void {
        el.addEventListener('mouseenter', () => {
            if (touch()) return;
            clearTimers();
            showTimer = window.setTimeout(() => this.showResearchEdgeBubble(personId, el), SHOW_DELAY_MS);
        });
        el.addEventListener('mouseleave', () => {
            window.clearTimeout(showTimer);
            hideTimer = window.setTimeout(() => this.hideResearchEdgeBubble(), HIDE_DELAY_MS);
        });
        el.addEventListener('focus', () => {
            if (el.matches(':focus-visible')) this.showResearchEdgeBubble(personId, el);
        });
        el.addEventListener('blur', () => {
            hideTimer = window.setTimeout(() => this.hideResearchEdgeBubble(), HIDE_DELAY_MS);
        });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            // Touch: the first tap shows the bubble, the next one opens the section.
            if (touch() && bubbleFor !== personId) {
                this.showResearchEdgeBubble(personId, el);
                return;
            }
            this.openResearchEdgeSection(personId);
        });
    },

    showResearchEdgeBubble(personId: PersonId, anchor: HTMLElement): void {
        clearTimers();
        this.hideResearchEdgeBubble();
        const found = edgeOf(personId);
        if (!found) return;
        const { edge, next } = found;
        const re = strings.researchEdge;
        const tone = edgeMuted(edge.scope) ? 'none' : edgeTone(next);
        const nextText = edgeNextText(edge, next);
        const facts = edgeFactsLine(edge);
        const hypo = edge.hypos.find(h => h.join) ?? null;
        const joinId = hypo?.join ? personByRefn(hypo.join) : null;
        const hypoTitle = hypo ? DataManager.getPerson(personId)?.research?.hypotheses?.find(h => h.id === hypo.id)?.title ?? '' : '';
        const bubble = document.createElement('div');
        bubble.id = BUBBLE_ID;
        bubble.className = 'research-edge-bubble';
        bubble.setAttribute('role', 'tooltip');
        bubble.innerHTML = `
            <div class="reb-end">${esc(edgeEndText(edge))}</div>
            ${nextText ? `<div class="reb-next tone-${tone}"><span class="reb-dot" aria-hidden="true"></span>${esc(nextText)}</div>` : ''}
            ${facts ? `<div class="reb-facts">${esc(facts)}</div>` : ''}
            ${hypo && joinId ? `
                <div class="reb-hypo">
                    <span class="reb-hypo-label">${esc(re.possibleLink)}</span>
                    <button type="button" class="link-button reb-join" data-person="${esc(joinId)}">${esc(personName(joinId))}</button>${hypo.island ? ` · ${esc(re.islandFamily(hypo.island))}` : ''}
                    ${hypoTitle ? `<div class="reb-hypo-title">${esc(hypoTitle)}</div>` : ''}
                </div>` : ''}
            <button type="button" class="link-button reb-more">${esc(re.moreInResearch)}</button>`;
        document.body.appendChild(bubble);
        bubbleFor = personId;
        bubble.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
        bubble.addEventListener('mouseleave', () => {
            hideTimer = window.setTimeout(() => this.hideResearchEdgeBubble(), HIDE_DELAY_MS);
        });
        (bubble.querySelector('.reb-more') as HTMLButtonElement).onclick = () => this.openResearchEdgeSection(personId);
        bubble.querySelector<HTMLButtonElement>('.reb-join')?.addEventListener('click', () => {
            this.hideResearchEdgeBubble();
            TreeRenderer.setFocus(joinId!);
        });
        // Above the stub, kept inside the window (below it when there is no room).
        const a = anchor.getBoundingClientRect();
        const b = bubble.getBoundingClientRect();
        const left = Math.max(8, Math.min(window.innerWidth - b.width - 8, a.left + a.width / 2 - b.width / 2));
        const top = a.top - b.height - 8 >= 8 ? a.top - b.height - 8 : a.bottom + 8;
        bubble.style.left = `${left}px`;
        bubble.style.top = `${top}px`;
        if (touch()) {
            // A tap elsewhere closes it.
            const away = (e: Event): void => {
                if (bubble.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
                document.removeEventListener('pointerdown', away, true);
                this.hideResearchEdgeBubble();
            };
            document.addEventListener('pointerdown', away, true);
        }
    },

    hideResearchEdgeBubble(): void {
        document.getElementById(BUBBLE_ID)?.remove();
        bubbleFor = null;
    },

    /** "What the research knows" at its "Above the person" section. */
    openResearchEdgeSection(personId: PersonId): void {
        clearTimers();
        this.hideResearchEdgeBubble();
        this.hideContextMenu();
        this.showPersonResearchDialog(personId, { edge: true });
    },

    /** The "Above the person" section of "What the research knows" ('' without an edge). */
    researchEdgeSectionHtml(personId: PersonId): string {
        const found = edgeOf(personId);
        if (!found) return '';
        const { edge, next } = found;
        const re = strings.researchEdge;
        const person = DataManager.getPerson(personId)!;
        const asOf = DataManager.getData().researchAsOf;
        const stale = asOf && asOf < todayIso() ? strings.research.asOf(formatFlexDate(asOf)) : '';
        const tone = edgeMuted(edge.scope) ? 'none' : edgeTone(next);
        const nextText = edgeNextText(edge, next);
        const parts: string[] = [];

        parts.push(`<div class="rep-lead">
            <div class="rep-end">${esc(edgeEndText(edge))}</div>
            ${nextText ? `<div class="rep-next tone-${tone}">${esc(nextText)}</div>` : ''}
        </div>`);

        const w = edge.window;
        if (w) {
            const span = w.to - w.from + 1;
            const pct = (year: number): number => ((year - w.from) / span) * 100;
            const segs = edgeTimeline(edge);
            const est = edgeEstimateText(edge);
            const marks = new Set<number>([w.from, w.to + 1]);
            segs.forEach(sg => { marks.add(sg.from); marks.add(sg.to + 1); });
            const estMark = edge.est && edge.est.year >= w.from && edge.est.year <= w.to
                ? `<span class="rep-tl-est" style="left:${pct(edge.est.year + 0.5).toFixed(2)}%" aria-hidden="true">▲</span>` : '';
            parts.push(`<div class="rep-timeline">
                <div class="rep-tl-caption">${esc([re.baptism(w.from, w.to), est].filter(Boolean).join(' · '))}</div>
                <div class="rep-tl-bar" role="img" aria-label="${esc(re.timelineSr(w.from, w.to))}">
                    ${segs.map(sg => `<span class="rep-tl-seg seg-${sg.kind}" style="left:${pct(sg.from).toFixed(2)}%;width:${(((sg.to - sg.from + 1) / span) * 100).toFixed(2)}%"></span>`).join('')}
                </div>
                <div class="rep-tl-years" aria-hidden="true">
                    ${[...marks].sort((a, b) => a - b).map(y => {
                        const last = y === w.to + 1;
                        const edgeCls = y === w.from ? ' is-first' : last ? ' is-last' : '';
                        return `<span class="rep-tl-y${edgeCls}" style="left:${(last ? 100 : pct(y)).toFixed(2)}%">${last ? w.to : y}</span>`;
                    }).join('')}
                    ${estMark}
                </div>
                <div class="rep-tl-legend">
                    <span><i class="seg-covered"></i>${esc(re.legendCovered)}</span>
                    <span><i class="seg-norecords"></i>${esc(re.legendNoRecords)}</span>
                    <span><i class="seg-rest"></i>${esc(re.legendRest)}</span>
                </div>
            </div>`);
        }

        if (edge.books.length > 0) {
            parts.push(`<div class="rep-block"><div class="rep-sub">${esc(re.books)}</div><ul class="rep-list">
                ${edge.books.map(b => `<li>${esc(b.title)}${b.access ? ` · <span class="rep-access">${esc(re.access[b.access] ?? b.access)}</span>` : ''}</li>`).join('')}
            </ul></div>`);
        }

        if (edge.tasks.length > 0 || edge.tried.length > 0) {
            const heldWhy = (t: ResearchEdge['tasks'][number]): string => {
                const n = re.next;
                if (t.held === 'paused') return n.heldPaused;
                if (t.held === 'done') return n.heldDone;
                if (t.held === 'off-tree') return n.heldOffTree;
                if (t.held === 'parked') return n.heldParked(t.until && /^\d{4}-\d{2}-\d{2}$/.test(t.until) ? formatFlexDate(t.until) : t.until ?? '');
                return t.held ?? '';
            };
            parts.push(`<div class="rep-block"><div class="rep-sub">${esc(re.tasks)}</div>
                ${edge.tasks.length > 0 ? `<ol class="rep-tasks">${edge.tasks.map(t => `
                    <li class="${t.held ? 'is-held' : ''}">
                        <span class="rep-task-pos">${t.pos ? `${t.pos}.` : '·'}</span>
                        <span class="rep-task-body">
                            <span class="rep-task-title">${esc(t.title)}</span>${t.held ? ` <span class="rep-task-held">(${esc(heldWhy(t))})</span>` : ''}
                            ${t.note ? `<span class="rep-task-note">${esc(t.note)}</span>` : ''}
                        </span>
                    </li>`).join('')}</ol>` : ''}
                ${edge.tried.length > 0 ? `<details class="rep-tried"><summary>${esc(re.tried(edge.tried.length))}</summary>
                    <div class="rep-tried-ids">${edge.tried.map(esc).join(', ')}</div></details>` : ''}
            </div>`);
        }

        const work: string[] = [];
        if (edge.searches !== undefined) work.push(re.searches(edge.searches));
        // The agent's sessions and their price: not in an archive.
        if (edge.sessions && !this.activeResearchArchive()) {
            work.push(re.sessions(edge.sessions.n));
            if (edge.sessions.cost !== undefined) work.push(re.cost(edge.sessions.cost.toFixed(2), !!edge.sessions.partial));
        }
        if (edge.last) work.push(re.last(formatFlexDate(edge.last)));
        if (work.length > 0) parts.push(`<div class="rep-block"><div class="rep-sub">${esc(re.work)}</div><div class="rep-work">${esc(work.join(' · '))}</div></div>`);

        if (edge.hypos.length > 0) {
            const titles = new Map((person.research?.hypotheses ?? []).filter(h => h.id).map(h => [h.id!, h.title]));
            parts.push(`<div class="rep-block"><div class="rep-sub">${esc(strings.research.hypotheses)}</div>
                ${edge.hypos.map(h => {
                    const joinId = h.join ? personByRefn(h.join) : null;
                    const bits = [
                        joinId ? `${esc(re.possibleLink)}: <button type="button" class="link-button rep-join" data-person="${esc(joinId)}">${esc(personName(joinId))}</button>` : '',
                        h.island ? esc(re.islandFamily(h.island)) : '',
                        h.held ? esc(re.hypoWaiting(h.held)) : '',
                        h.tests.length > 0 ? `${esc(re.hypoTests)} ${esc(h.tests.join(', '))}` : '',
                    ].filter(Boolean);
                    return `<div class="rep-hypo">
                        <div class="rep-hypo-title">${esc(titles.get(h.id) ?? h.id)}</div>
                        ${bits.length > 0 ? `<div class="rep-hypo-meta">${bits.join(' · ')}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>`);
        }

        const openConflicts = (person.research?.conflicts ?? []).filter(c => c.status === 'open' && edge.conflicts.includes(c.id)).length;
        if (openConflicts > 0) {
            parts.push(`<div class="rep-block"><button type="button" class="link-button rep-conflicts">${esc(strings.research.conflicts)}: ${esc(re.conflictsGo(openConflicts))}</button></div>`);
        }

        // Actions the research already has (↗), only where it announced them;
        // none in an archive (each leads to an agent): its edge is a record.
        const ref = this.personResearchRef(personId);
        const actions: string[] = [];
        if (ref && !this.activeResearchNoAgent()) {
            const decide = next === 'decide';
            if (this.researchLinkAvailable('chat')) {
                actions.push(`<button type="button" class="${decide ? 'primary' : 'secondary'} rep-action" data-do="chat">${esc(decide ? re.decideInChat : re.chat)} ↗</button>`);
            }
            if (this.researchLinkAvailable('review')) {
                actions.push(`<button type="button" class="secondary rep-action" data-do="review">${esc(re.review)} ↗</button>`);
            }
            const pausedOrDone = edge.scope === 'paused' || (next === 'held' && edge.tasks.some(t => t.held === 'paused' || t.held === 'done'));
            if (pausedOrDone && edge.research && this.researchLinkAvailable('direction')) {
                actions.push(`<button type="button" class="secondary rep-action" data-do="resume">${esc(re.resume)} ↗</button>`);
            }
            const waitingTask = edge.tasks.find(t => t.stat === 'waiting') ?? (next === 'waiting' ? edge.tasks[0] : undefined);
            if (waitingTask && this.researchLinkAvailable('task')) {
                actions.push(`<button type="button" class="secondary rep-action" data-do="task" data-task="${esc(waitingTask.id)}">${esc(re.answer)} ↗</button>`);
            }
        }
        if (actions.length > 0) parts.push(`<div class="rep-actions">${actions.join('')}</div>`);

        return `<section class="person-research-section research-edge-section" id="research-edge-section">
            <details open>
                <summary class="rep-head"><span class="rep-title">${esc(re.sectionTitle)}</span>${stale ? `<span class="rep-asof">${esc(stale)}</span>` : ''}</summary>
                <div class="rep-body">${parts.join('')}</div>
            </details>
        </section>`;
    },

    /** Wire the section's links (inside the dialog `root`). */
    bindResearchEdgeSection(root: HTMLElement, personId: PersonId): void {
        const edge = DataManager.getPerson(personId)?.research?.edge;
        root.querySelectorAll<HTMLButtonElement>('.rep-join').forEach(btn => {
            btn.onclick = () => {
                this.closePersonResearchDialog();
                TreeRenderer.setFocus(btn.dataset.person as PersonId);
            };
        });
        root.querySelector<HTMLButtonElement>('.rep-conflicts')?.addEventListener('click', () => {
            root.querySelector('.person-research-conflict, .person-research-decided')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
        root.querySelectorAll<HTMLButtonElement>('.rep-action').forEach(btn => {
            btn.onclick = () => {
                const person = this.personResearchRef(personId);
                if (!person) return;
                const what = btn.dataset.do;
                if (what === 'chat') {
                    const url = this.activeResearchLink('chat', { person });
                    if (url) this.launchResearchLink(url, 'agent');
                } else if (what === 'review') {
                    const url = this.activeResearchLink('review', { person, scope: 'person' });
                    if (url) this.launchResearchLink(url);
                } else if (what === 'resume' && edge?.research) {
                    this.runDirection(edge.research, 'resume');
                } else if (what === 'task' && btn.dataset.task) {
                    const url = this.activeResearchLink('task', { task: btn.dataset.task });
                    if (url) this.launchResearchLink(url);
                }
            };
        });
    },

    // ==================== SETTINGS → TREE ====================

    /** "Research edge" and "Motion while the agent works": research trees only. */
    renderResearchEdgeSettings(): void {
        const host = document.getElementById('research-edge-settings');
        if (!host) return;
        const treeId = DataManager.getCurrentTreeId();
        const research = !!treeId && !!DataManager.getData().researchAsOf;
        host.hidden = !research;
        if (!research || !treeId) { host.innerHTML = ''; return; }
        const re = strings.researchEdge;
        // A copy someone passed on has the findings only (no next, no queue):
        // "for you" and the motion mean nothing there.
        const work = DataManager.getAllPersons().some(p => {
            const e = p.research?.edge;
            return !!e && (e.next !== undefined || e.tasks.length > 0);
        });
        const stored = TreeManager.getResearchEdgeMode(treeId);
        const mode = !work && stored === 'mine' ? 'all' : stored;
        const option = (value: ResearchEdgeMode, label: string): string => `
            <label class="settings-radio">
                <input type="radio" name="research-edge-mode" value="${value}"${mode === value ? ' checked' : ''}>
                <span>${esc(label)}</span>
            </label>`;
        host.innerHTML = `
            <div class="settings-row settings-row-stacked">
                <span class="settings-text">
                    <span class="settings-name" id="research-edge-label">${esc(re.settingLabel)}</span>
                    <span class="settings-desc">${esc(re.settingHint)}</span>
                </span>
                <div class="settings-options settings-segment" role="radiogroup" aria-labelledby="research-edge-label">
                    ${option('off', re.modeOff)}${work ? option('mine', re.modeMine) : ''}${option('all', re.modeAll)}
                </div>
            </div>
            ${work && !this.activeResearchArchive() ? `<label class="settings-checkbox settings-row settings-row-dependent${mode === 'off' ? ' is-disabled' : ''}">
                <input type="checkbox" id="research-edge-motion-toggle"${TreeManager.isResearchEdgeMotion(treeId) ? ' checked' : ''}${mode === 'off' ? ' disabled' : ''}>
                <span class="settings-text">
                    <span class="settings-name">${esc(re.motionLabel)}</span>
                    <span class="settings-desc">${esc(re.motionHint)}</span>
                </span>
            </label>` : ''}`;
        host.querySelectorAll<HTMLInputElement>('input[name="research-edge-mode"]').forEach(input => {
            input.onchange = () => {
                const value = input.value as ResearchEdgeMode;
                if (value !== 'off' && value !== 'mine' && value !== 'all') return;
                TreeManager.setResearchEdgeMode(treeId, value);
                this.renderResearchEdgeSettings();
                host.querySelector<HTMLInputElement>(`input[name="research-edge-mode"][value="${value}"]`)?.focus();
                TreeRenderer.render();
            };
        });
        host.querySelector<HTMLInputElement>('#research-edge-motion-toggle')?.addEventListener('change', (e) => {
            TreeManager.setResearchEdgeMotion(treeId, (e.target as HTMLInputElement).checked);
            TreeRenderer.render();
        });
    },
});

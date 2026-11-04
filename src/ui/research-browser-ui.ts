/**
 * The agent's browser (spec 048 §11) drawn: the "Browser" row beside the
 * agent in the ready dialog and in Research for this tree, kept up with each
 * status of the research (lit for a while and said when its sentence
 * changes), and the note at images waiting for a browser-only archive.
 */

import { strings } from '../strings.js';
import { isPhoneBar } from '../breakpoints.js';
import { researchSchemeUrl, researchLinkMark, type BrowserInfo, type LiveStatus } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import { browserRow, shortAgentName, type BrowserNote, type BrowserRow } from '../research-browser.js';
import { uiModule } from './module.js';
import { el } from './research-ui.js';
import { onBridgeStatus } from './research-sync-ui.js';
import { setResearchActionLabel, researchOpenSrText } from './research-open-mark.js';

/** How long a changed row stays lit. */
const CHANGED_MS = 4000;
const changedTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
let listening = false;

/** What a status says of the agent: its name and whether the research waits for one. */
function agentOf(status: LiveStatus): { name: string; away: boolean } {
    const away = status.treeState ? status.treeState === 'waiting' : status.accepts?.agentHere === false;
    return { name: status.agentName ?? '', away };
}

/** The Agent row's sentence (the same in the ready dialog and in Research for this tree). */
export function agentRowText(name: string, away: boolean): string {
    const s = strings.install;
    return away ? s.agentRowAway : name ? s.agentRowOn(shortAgentName(name)) : s.agentRow;
}

/** The phone's sheet: no links into the research or out of the app. */
function phone(): boolean {
    return isPhoneBar();
}

export const researchBrowserMethods = uiModule({
    /**
     * Fill (or refresh) the agent and browser rows of a `dl` that carries
     * `data-browser-research`: the agent row's text (`dd[data-row="agent"]`),
     * then the Browser row right after it — none where the research says
     * nothing of a browser.
     */
    renderBrowserRows(dl: HTMLElement, agent: { name: string; away: boolean }, info: BrowserInfo | null | undefined): void {
        const rid = dl.dataset.browserResearch ?? '';
        const agentDd = dl.querySelector<HTMLElement>('dd[data-row="agent"]');
        if (!agentDd) return;
        agentDd.textContent = agentRowText(agent.name, agent.away);
        if (agent.name && !agent.away && agent.name.length > 40) agentDd.title = agent.name;
        else agentDd.removeAttribute('title');
        const row = browserRow(info, { agent: agent.name, agentAway: agent.away, phone: phone(), links: this.researchLinkAvailable('archive') });
        let dt = dl.querySelector<HTMLElement>('dt[data-row="browser"]');
        let dd = dl.querySelector<HTMLElement>('dd[data-row="browser"]');
        const before = dl.dataset.browserText;
        dl.dataset.browserText = row?.text ?? '';
        if (!row) {
            dt?.remove();
            dd?.remove();
            return;
        }
        if (!dt || !dd) {
            dt = el('dt', 'install-ready-browser-label', strings.research.browser.rowLabel);
            dt.dataset.row = 'browser';
            dd = el('dd', 'install-ready-browser');
            dd.dataset.row = 'browser';
            agentDd.after(dt, dd);
        }
        this.fillBrowserRow(dd, row, rid, agent.name);
        // A sentence that changed while the row was on screen: lit for a while, and said.
        if (before !== undefined && before !== row.text) {
            dd.classList.add('is-changed');
            const was = changedTimers.get(dd);
            if (was) clearTimeout(was);
            changedTimers.set(dd, setTimeout(() => dd!.classList.remove('is-changed'), CHANGED_MS));
            const live = dl.parentElement?.querySelector<HTMLElement>('.browser-live');
            if (live) live.textContent = strings.research.browser.changed(row.text);
        }
    },

    /** The Browser row's content: the dot and the sentence, then its link, list or phone hint. */
    fillBrowserRow(dd: HTMLElement, row: BrowserRow, researchId: string, agentName: string): void {
        const b = strings.research.browser;
        dd.replaceChildren();
        dd.dataset.kind = row.kind;
        const state = el('span', 'browser-state');
        const dot = el('span', `browser-dot${row.on ? ' is-on' : ''}`);
        dot.setAttribute('aria-hidden', 'true');
        const text = el('span', 'browser-text', row.text);
        if (row.kind === 'otherAgent' && agentName.length > 40) text.title = b.otherAgent(agentName);
        state.append(dot, text);
        dd.appendChild(state);
        if (row.extUrl) dd.appendChild(this.browserExtLink(row.extUrl));
        if (row.unpermitted.length > 0) {
            const box = el('div', 'browser-nopermit');
            box.appendChild(el('span', 'browser-nopermit-label', b.noPermit));
            const list = el('ul', 'browser-nopermit-list');
            for (const a of row.unpermitted) {
                const li = el('li', 'browser-nopermit-item');
                const name = el('span', 'browser-archive', a.name);
                name.title = a.full;
                li.appendChild(name);
                const link = row.permitLinks ? this.browserPermitLink(researchId, a.host, a.name) : null;
                if (link) li.appendChild(link);
                list.appendChild(li);
            }
            box.appendChild(list);
            if (row.more.length > 0) {
                const more = el('span', 'browser-more', b.more(row.more.length));
                more.title = row.more.join(', ');
                box.appendChild(more);
            }
            dd.appendChild(box);
        }
        if (row.phoneHint) dd.appendChild(el('p', 'browser-hint', b.phoneHint));
    },

    /** "Claude in Chrome ↗": the extension's page in a new window. */
    browserExtLink(url: string): HTMLElement {
        const a = el('a', 'browser-ext-link', strings.research.browser.extLink);
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
    },

    /** "Permission…" with the terminal mark: the research's permission of one archive (never without a host). */
    browserPermitLink(researchId: string, host: string, name: string): HTMLElement | null {
        if (!this.researchLinkAvailable('archive')) return null;
        const url = researchSchemeUrl('archive', { tree: researchId, host }, announcedResearchScheme());
        if (!url) return null;
        const label = strings.research.browser.permitLink;
        const btn = setResearchActionLabel(el('button', 'link-button browser-permit'), label, researchLinkMark('archive'), { size: 12 });
        btn.type = 'button';
        btn.dataset.host = host;
        btn.setAttribute('aria-label', `${label} ${name}${researchOpenSrText()}`);
        btn.onclick = (e) => {
            e.stopPropagation();
            this.launchResearchLink(url);
        };
        return btn;
    },

    /** The note at images waiting for a browser-only archive: its sentence, then its link (a computer). */
    browserNoteEl(note: BrowserNote, researchId: string, extra = ''): HTMLElement {
        const p = el('p', `waiting-browser-note${extra ? ` ${extra}` : ''}`);
        p.dataset.kind = note.kind;
        p.dataset.host = note.host;
        p.appendChild(el('span', 'waiting-browser-note__text', note.text));
        if (note.extUrl) p.appendChild(this.browserExtLink(note.extUrl));
        if (note.permitHost) {
            const link = this.browserPermitLink(researchId, note.permitHost, note.name);
            if (link) p.appendChild(link);
        }
        return p;
    },

    /** Keep every agent/browser box on screen up with its research's status (one listener for all). */
    watchBrowserRows(): void {
        if (listening) return;
        listening = true;
        onBridgeStatus((rid, status) => {
            document.querySelectorAll<HTMLElement>('dl[data-browser-research]').forEach(dl => {
                if (dl.dataset.browserResearch !== rid || status.treeState === 'archive') return;
                this.renderBrowserRows(dl, agentOf(status), status.browser);
            });
        });
    },
});

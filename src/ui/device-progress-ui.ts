/**
 * Progress of the research's overview on a device of the home network (spec
 * 094 §4, 4.6; §9): one list, newest first, of what the research wrote and of
 * the tree's sends, each with where it came from under it ("agent", "from
 * iPhone · Safari", "from computer Pracovna"); what came since Progress was
 * last seen on this device has a dot before its time and "new" after its
 * source; a send of this device offers "Undo this send" (the gateway's
 * `device/sync/<I>/undo`, previewed with `{dry: true}` and asked first).
 * Outside the device mode none of this is drawn.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { uiModule } from './module.js';
import { DataManager } from '../data.js';
import { researchDeviceAllows, type ResearchSendRecord } from '../research-link.js';
import type { DeviceClient } from '../device-client.js';
import { researchBridgeWrite } from '../research-directions-write.js';
import { deviceComputerName, inDeviceMode, thisDeviceId } from './device-mode-ui.js';
import { sendSourceWords } from '../conflict-devices.js';
import { appendChangeText, el, type ChangeSourceGateway, type LiveChangeItem, type LiveSession } from './research-ui.js';

type Mode = 'docked' | 'overlay' | 'sheet' | 'window';

/** The overview's Progress keeps the last 24 hours. */
const RECENT_MS = 24 * 60 * 60_000;
/** Most rows of the device's Progress. */
const MAX_ROWS = 40;
/** When Progress was last seen on this device, per tree (ms). */
const SEEN_KEY = 'strom-device-progress-seen:';

/** The baseline of this opening of the overview: what came after it is new (null: read it again). */
let seenBase: { tree: string; at: number } | null = null;

/** The overview opened anew: what is new is counted from what was seen until now. */
export function resetDeviceProgressSeen(): void {
    seenBase = null;
}

/** When Progress of `tree` was seen before this opening (Infinity: never — then nothing is marked new). */
export function deviceProgressSeenAt(tree: string): number {
    if (seenBase?.tree === tree) return seenBase.at;
    let at = NaN;
    try { at = Number(localStorage.getItem(SEEN_KEY + tree)); } catch { /* not kept */ }
    seenBase = { tree, at: Number.isFinite(at) && at > 0 ? at : Infinity };
    return seenBase.at;
}

/** Progress of `tree` seen up to `newest` (kept for the next opening; this one keeps its marks). */
export function noteDeviceProgressSeen(tree: string, newest: number): void {
    if (!Number.isFinite(newest)) return;
    try {
        const was = Number(localStorage.getItem(SEEN_KEY + tree)) || 0;
        if (newest > was) localStorage.setItem(SEEN_KEY + tree, String(newest));
    } catch { /* not kept */ }
}

/** Where a row came from: a device of the home network, the computer, the agent ('' when not known). */
export function deviceSourceWords(client: DeviceClient | undefined, byAgent: boolean, pc: string = deviceComputerName()): string {
    return sendSourceWords(client, byAgent, pc);
}

/** The sends of the last 24 hours the research wrote (`status.sends`), as Progress shows them. */
export function deviceProgressSends(sends: readonly ResearchSendRecord[] | null | undefined, now = Date.now()): ResearchSendRecord[] {
    return (sends ?? []).filter(r => r.state === 'written' && !!r.input && now - (Date.parse(r.at) || 0) < RECENT_MS);
}

/** One change of `device/sync/<I>/undo`'s preview: `from` as it is now, `to` once the send is undone. */
interface UndoField {
    what: string;
    from: string;
    to: string;
    /** A whole fact, name or person the send added (it goes away; not just emptied). */
    whole: boolean;
}

/** What `device/sync/<I>/undo` with `{dry: true}` says. */
export interface UndoPreview {
    fields: UndoField[];
    /** Names of the other devices whose later changes stay (the research's `kept[].client`). */
    keptFrom: string[];
    /** Taken back already (`{undone: 0, undoneAt}`). */
    already: boolean;
}

/** The preview of an undo as the gateway answers it (`me`: this device, never named as another). */
export function undoPreviewOf(body: Record<string, unknown>, me: string | null): UndoPreview {
    const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const list = Array.isArray(body.fields) ? body.fields : [];
    const fields = list.slice(0, 50).flatMap((f: unknown) => {
        const r = f && typeof f === 'object' ? f as Record<string, unknown> : null;
        const what = r ? text(r.what) || text(r.field) : '';
        return r && what ? [{ what, from: text(r.from), to: text(r.to), whole: ['fact', 'name', 'person'].includes(text(r.field)) }] : [];
    });
    const keptFrom: string[] = [];
    for (const k of Array.isArray(body.kept) ? body.kept.slice(0, 50) : []) {
        const c = k && typeof k === 'object' ? (k as Record<string, unknown>).client : null;
        const cr = c && typeof c === 'object' ? c as Record<string, unknown> : null;
        const id = cr ? text(cr.id) : '';
        const name = cr ? text(cr.name).slice(0, 60) : '';
        if (id.startsWith('dv_') && id !== me && name && !keptFrom.includes(name)) keptFrom.push(name);
    }
    const already = typeof body.undoneAt === 'string' && !!body.undoneAt && !fields.length;
    return { fields, keptFrom: keptFrom.slice(0, 4), already };
}

/** A preview's field as the confirmation lists it: "what: now → after". */
export function undoFieldLine(f: UndoField): string {
    const S = strings.sync;
    const to = f.to || (f.whole && f.from ? S.undoThisRemoved : S.undoThisEmpty);
    return `${f.what}: ${f.from || S.undoThisEmpty} → ${to}`;
}

export const deviceProgressMethods = uiModule({
    /**
     * The research has the gateway of the home network's devices (a device, or `device.gateway` in its features;
     * spec 094 §9): its change lists say every line's source. undefined: as before (only another browser named).
     */
    changeSourceGateway(researchId: string): ChangeSourceGateway | undefined {
        if (inDeviceMode()) return { pc: deviceComputerName() };
        return this.phoneCaps(researchId).gateway ? { pc: '' } : undefined;
    },

    /**
     * Progress's rows on a device: the changes `shown` (the filter's) and the sends, newest first; `seen`: when it was
     * seen before (rows after it are new).
     */
    appendDeviceTimeline(host: HTMLElement, s: LiveSession, shown: readonly LiveChangeItem[], sends: readonly ResearchSendRecord[],
        seen: number, mode: Mode): void {
        type Row = { at: number; change?: LiveChangeItem; send?: ResearchSendRecord };
        const rows: Row[] = [
            ...shown.map(c => ({ at: Date.parse(c.at), change: c })),
            ...sends.map(x => ({ at: Date.parse(x.at), send: x })),
        ].filter(r => Number.isFinite(r.at)).sort((a, b) => b.at - a.at).slice(0, MAX_ROWS);
        if (rows.length === 0) {
            host.appendChild(el('p', 'live-empty', strings.research.noChanges));
            return;
        }
        const D = strings.device;
        const me = thisDeviceId();
        const undoOffered = researchDeviceAllows('sync-undo-this');
        const sources = this.liveSourceLinks(s, mode === 'sheet');
        const list = el('ul', 'research-overview__rows live-changes research-overview__rows--device');
        for (const r of rows) {
            const li = el('li', 'research-overview__row research-overview__row--device');
            const fresh = r.at > seen;
            const time = el('span', 'research-overview__row-time');
            if (fresh) {
                li.classList.add('is-unseen');
                const dot = el('span', 'research-overview__new-dot');
                dot.setAttribute('aria-hidden', 'true');
                time.appendChild(dot);
            }
            time.appendChild(document.createTextNode(new Date(r.at).toLocaleTimeString(getCurrentLanguage(), { hour: 'numeric', minute: '2-digit' })));
            li.appendChild(time);
            const text = el('span', 'research-overview__row-text');
            let from = '';
            if (r.change) {
                const c = r.change;
                // Its source stands under it (not "from …" after the line).
                if (appendChangeText(text, { ...c, via: undefined }, (id) => this.overviewShowPerson(id, mode), sources)) this.appendSourceInNewer(text, s, c, true);
                from = deviceSourceWords(c.via, !!c.task);
                const target = c.personIds.find(id => DataManager.getPerson(id));
                if (target) {
                    li.classList.add('has-person');
                    li.dataset.person = target;
                    li.onclick = () => this.overviewShowPerson(target, mode);
                }
            } else if (r.send) {
                li.dataset.send = r.send.input!;
                text.appendChild(el('span', 'research-overview__send', D.sendRow(r.send.changes)));
                from = deviceSourceWords(r.send.client, false);
            }
            const src = [from, fresh ? D.newMark : ''].filter(Boolean).join(' · ');
            if (src) text.appendChild(el('span', 'research-overview__row-src', src));
            const send = r.send;
            if (send?.input && undoOffered && !!me && send.client?.id === me) {
                const undo = el('button', 'link-button research-overview__undo-send', strings.sync.undoThis);
                undo.type = 'button';
                undo.onclick = (e) => {
                    e.stopPropagation();
                    void this.undoThisSend(s, send);
                };
                text.appendChild(undo);
            }
            li.appendChild(text);
            list.appendChild(li);
        }
        host.appendChild(list);
    },

    /**
     * "Undo this send" (spec 094 §4, 4.9 and 9.5; K2.3): the gateway's preview first — whose send and when, the
     * fields that go back (now → after) and that later changes of other devices stay (named when the research names
     * them) — then the undo; the status read again. A send undone already, or no longer one, is said instead.
     */
    async undoThisSend(s: LiveSession, send: ResearchSendRecord): Promise<void> {
        const S = strings.sync;
        const input = send.input;
        if (!input) return;
        const path = `device/sync/${encodeURIComponent(input)}/undo`;
        const preview = await researchBridgeWrite(s.bridge.base, 'POST', path, { dry: true }, r => undoPreviewOf(r, thisDeviceId()));
        if (!preview.ok) {
            // Refused as the computer's (403): said once by the transport, the button gone.
            if (!researchDeviceAllows('sync-undo-this')) return;
            const gone = preview.errorCode === 'sync.not-sync' || preview.status === 404 || preview.status === 410;
            this.showToast(gone ? S.undoThisGone : S.undoThisFailed, 5000);
            if (gone) this.researchStatusAfterWrite(s);
            return;
        }
        if (preview.already) {
            this.showToast(S.undoThisAlready, 5000);
            this.researchStatusAfterWrite(s);
            return;
        }
        const lines = preview.fields.map(undoFieldLine);
        const pc = deviceComputerName();
        const keep = preview.keptFrom.length ? S.undoThisKeepFrom(preview.keptFrom.join(', '), pc) : S.undoThisKeep(pc);
        const time = new Date(Date.parse(send.at)).toLocaleTimeString(getCurrentLanguage(), { hour: 'numeric', minute: '2-digit' });
        const from = send.client?.name && Number.isFinite(Date.parse(send.at)) ? S.undoThisFrom(send.client.name, time) : '';
        const asked = this.showConfirm(lines.length ? from : keep, S.undoThisAsk,
            { confirmLabel: S.undoThisOk, ...(lines.length ? { list: { items: lines, after: keep } } : {}) });
        // Asked from the overview's sheet (1000) on a phone: above it.
        const modal = document.getElementById('confirmation-modal');
        modal?.classList.add('over-sheet');
        const ok = await asked;
        modal?.classList.remove('over-sheet');
        if (!ok) return;
        const done = await researchBridgeWrite(s.bridge.base, 'POST', path, {}, () => ({}));
        if (!done.ok) {
            if (!researchDeviceAllows('sync-undo-this')) return;
            const gone = done.errorCode === 'sync.not-sync' || done.status === 404;
            this.showToast(gone ? S.undoThisGone : S.undoThisFailed, 5000);
        }
        this.researchStatusAfterWrite(s);
    },
});

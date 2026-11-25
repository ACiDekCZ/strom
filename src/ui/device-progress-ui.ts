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
import { appendChangeText, el, researchSession, type ChangeSourceGateway, type LiveChangeItem, type LiveSession } from './research-ui.js';
import { storedResearchBridge } from '../research-device.js';
import { BRIDGE_ANSWER_MS } from '../bridge-ask.js';
import { researchFactRef, researchFamilyRef, researchPersonRef } from '../verify.js';
import { shownName } from '../person-name.js';
import { coupleEventLabel } from '../events.js';
import { originFactLabel } from './fact-origin-ui.js';
import { researchValueText } from './person-research-ui.js';
import type { StromData } from '../types.js';

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

/**
 * This device's newest send it can undo (spec 094, 4.2 and 6.1: "Undo send…" among the research's actions):
 * written in Progress's 24 hours, with the research's input, by this device (`me`); null: none.
 */
export function deviceUndoableSend(sends: readonly ResearchSendRecord[] | null | undefined, me: string, now = Date.now()): ResearchSendRecord | null {
    if (!me) return null;
    const own = deviceProgressSends(sends, now).filter(r => r.client?.id === me && !!r.input);
    own.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
    return own[0] ?? null;
}

/** One change of `device/sync/<I>/undo`'s preview: `from` as it is now, `to` once the send is undone. */
interface UndoField {
    what: string;
    /** The part changed as the research names it (date, place, value…; fact, name, person: the whole of it). */
    field: string;
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

/**
 * The fact a preview's change is about in the app's words ("Birth – Hřibík Pýchavka"), from the research's
 * refs (`person` / `family`, `event`) and this tree's facts with their research ids (`_STROM_EID`); null when
 * the tree here does not hold it (the research's own words are shown then).
 */
export function undoFieldWhat(data: StromData, f: { field: string; event?: unknown; person?: unknown; family?: unknown }): string | null {
    const eid = researchFactRef(f.event);
    const factOf = (verify: Record<string, { eid?: string } | undefined> | undefined): string | null =>
        eid ? Object.entries(verify ?? {}).find(([, v]) => v?.eid === eid)?.[0] ?? null : null;
    const pref = researchPersonRef(f.person);
    if (pref) {
        const person = Object.values(data.persons ?? {}).find(p => researchPersonRef(p?.refn) === pref);
        if (!person) return null;
        const name = shownName(person);
        if (f.field === 'person') return name;
        if (f.field === 'name') return `${strings.research.factName} – ${name}`;
        const fact = factOf(person.researchVerify);
        return fact ? `${originFactLabel(person, fact)} – ${name}` : null;
    }
    const fref = researchFamilyRef(f.family);
    if (!fref) return null;
    const couple = Object.values(data.partnerships ?? {}).find(x => researchFamilyRef(x?.researchId) === fref);
    if (!couple) return null;
    const fact = factOf(couple.researchVerify);
    const ev = fact?.startsWith('event:') ? (couple.events ?? []).find(e => e?.id === fact.slice(6)) : undefined;
    const label = fact === 'marriage' ? strings.table.evKind.marriage : fact === 'divorce' ? strings.table.evKind.divorce
        : ev ? coupleEventLabel(ev) : '';
    if (!label) return null;
    const names = [couple.person1Id, couple.person2Id].map(id => data.persons?.[id]).filter(p => !!p).map(p => shownName(p!));
    return `${label} – ${names.join(' & ')}`;
}

/** A preview's value as the app shows it: a GEDCOM date in the app's date style (also within a whole fact), else as said. */
export function undoValueText(field: string, value: string): string {
    if (!value) return value;
    if (field === 'date') return researchValueText('', value);
    if (field === 'fact') return value.split(', ').map(part => researchValueText('', part)).join(', ');
    return value;
}

/**
 * The preview of an undo as the gateway answers it (`me`: this device, never named as another). `data`: the tree
 * here — each change named from its refs in the app's words; the research's `what` only when the tree cannot.
 */
export function undoPreviewOf(body: Record<string, unknown>, me: string | null, data?: StromData): UndoPreview {
    const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const list = Array.isArray(body.fields) ? body.fields : [];
    const fields = list.slice(0, 50).flatMap((f: unknown) => {
        const r = f && typeof f === 'object' ? f as Record<string, unknown> : null;
        if (!r) return [];
        const field = text(r.field);
        const own = data ? undoFieldWhat(data, { field, event: r.event, person: r.person, family: r.family }) : null;
        // The research's words: without the fact's id it adds ("Birth – Jan Lhoták (E0001)").
        const what = own || text(r.what).replace(/\s*\(E\d+\)$/, '') || field;
        return what ? [{ what, field, from: undoValueText(field, text(r.from)), to: undoValueText(field, text(r.to)), whole: ['fact', 'name', 'person'].includes(field) }] : [];
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
        await this.undoDeviceSend(s.bridge.base, send, () => this.researchStatusAfterWrite(s));
    },

    /** "Undo send…" among the research's actions (4.2, 6.1): this device's newest send it can undo, asked first. */
    researchActionUndoThisSend(): void {
        const id = this.activeResearchId();
        const send = id ? deviceUndoableSend(this.researchStatusOf(id)?.sends, thisDeviceId()) : null;
        const session = researchSession();
        const base = session?.researchId === id ? session.bridge.base : id ? storedResearchBridge(id)?.base : undefined;
        if (!id || !send || !base) return;
        void this.undoDeviceSend(base, send, () => {
            if (session?.researchId === id) this.researchStatusAfterWrite(session);
            else void this.askResearchBridge(id, BRIDGE_ANSWER_MS).then(() => this.refreshResearchSyncUi());
        });
    },

    /** The send undone through the gateway at `base` (preview, the question, the undo); `after` reads the status again. */
    async undoDeviceSend(base: string, send: ResearchSendRecord, after: () => void): Promise<void> {
        const S = strings.sync;
        const input = send.input;
        if (!input) return;
        const path = `device/sync/${encodeURIComponent(input)}/undo`;
        const preview = await researchBridgeWrite(base, 'POST', path, { dry: true }, r => undoPreviewOf(r, thisDeviceId(), DataManager.getData()));
        if (!preview.ok) {
            // Refused as the computer's (403): said once by the transport, the button gone.
            if (!researchDeviceAllows('sync-undo-this')) return;
            const gone = preview.errorCode === 'sync.not-sync' || preview.status === 404 || preview.status === 410;
            this.showToast(gone ? S.undoThisGone : S.undoThisFailed, 5000);
            if (gone) after();
            return;
        }
        if (preview.already) {
            this.showToast(S.undoThisAlready, 5000);
            after();
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
        const done = await researchBridgeWrite(base, 'POST', path, {}, () => ({}));
        if (!done.ok) {
            if (!researchDeviceAllows('sync-undo-this')) return;
            const gone = done.errorCode === 'sync.not-sync' || done.status === 404;
            this.showToast(gone ? S.undoThisGone : S.undoThisFailed, 5000);
        }
        after();
    },
});

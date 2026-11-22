/**
 * The tree's own writes on files (spec 102): "Link to…" (§4: a person or
 * several, an event of a person or a union, a union, a source), "Remove from
 * the tree…" (§9: with an archive the record stays for "Restore", without
 * one the file is deleted — O1), "Restore" of a file taken out of the tree,
 * and the same file added twice (§12h). Each is one undo step with a toast.
 *
 * Material outside the tree is linked with a working copy from the bridge
 * (an image reduced as an attachment, a PDF up to 2 MB, else only its
 * original), so it needs the research running (Q2).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { isPendingImageUrl } from '../research-image-refs.js';
import { DataManager } from '../data.js';
import { Attachment, MediaPlace, PartnershipId, Person, PersonId, Source } from '../types.js';
import { strings } from '../strings.js';
import { MaterialItem, directPersons, fileUrl, materialRecordNote } from '../materials.js';
import { mediaAt, mediaPersonIds, placePersonId } from '../media.js';
import { mediaPlaceLabel, mediaUseLabel, mediaUses } from '../media-uses.js';
import { MultiPersonPicker, PersonPicker } from '../person-picker.js';
import { researchPersonRef } from '../research-link.js';
import { yearOf } from '../dates.js';
import { ATTACHMENT_IMAGE_TYPES, MAX_PDF_BYTES, compressImageAttachment, readFileAsDataUrl } from '../attachments.js';
import { ORIGINAL_ONLY_DATA_URL } from '../validation.js';
import { dataUrlByteSize } from '../photo.js';
import { MaterialDialog, button, materialDialog } from './material-actions-ui.js';
import { formatBytes } from './attachments-ui.js';
import { type MaterialsContext, materialItemSha } from './materials-ui.js';
import { uiModule } from './module.js';
import { isBusy } from './busy.js';

type Target = 'person' | 'event' | 'couple' | 'source';
const TARGETS: Target[] = ['person', 'event', 'couple', 'source'];
const PICKER_ID = 'mdlg-attach-picker';
const ONE_PICKER_ID = 'mdlg-attach-one';
const MAX_PEOPLE = 50;
const MAX_SOURCES = 60;
const TOAST_MS = 8000;

export interface AttachCtx {
    /** The person it was opened from (the event and union targets start with them). */
    personId?: PersonId | null;
    /** After the link was written (the window's selection ends, a dialog redraws). */
    done?: () => void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

function fullName(p: Pick<Person, 'firstName' | 'lastName'>): string {
    return `${p.firstName} ${p.lastName}`.trim();
}

/** The item's file of the tree (with a place, or taken out of it), if any. */
function treeRecord(item: MaterialItem): Attachment | undefined {
    const id = item.attachment?.id ?? item.removedId;
    return id ? DataManager.getMedia(id) : undefined;
}

/** A place every one of the tree's files already has (shown "already linked", not chosen). */
function allHave(records: Attachment[], place: MediaPlace, key: (p: MediaPlace) => string): boolean {
    if (!records.length) return false;
    const k = key(place);
    return records.every(r => r.places.some(p => key(p) === k));
}

/**
 * The people every one of the files is already theirs: a place of theirs in
 * the tree (not taken out), or the research's assignment (REFN). Shown in
 * "Link to…" as linked already (ticked, not changeable), never "Nobody yet".
 */
export function attachFixedPeople(files: MaterialItem[], persons: Person[], recordOf: (item: MaterialItem) => Attachment | undefined = treeRecord): PersonId[] {
    if (!files.length) return [];
    const byRefn = new Map<string, Person>();
    for (const p of persons) {
        const refn = researchPersonRef(p.refn);
        if (refn && !byRefn.has(refn)) byRefn.set(refn, p);
    }
    const has = (item: MaterialItem, p: Person): boolean => {
        const rec = recordOf(item);
        if (rec && !rec.removed && mediaAt(rec, { personId: p.id })) return true;
        const refn = researchPersonRef(p.refn);
        return !!refn && item.persons.includes(refn);
    };
    // The first file's people, in its order; then those every other file has too.
    const first = files[0];
    const rec = recordOf(first);
    const ids: PersonId[] = [];
    for (const pl of rec && !rec.removed ? rec.places : []) if ('personId' in pl && !pl.fact && !pl.eventId && !ids.includes(pl.personId)) ids.push(pl.personId);
    for (const refn of first.persons) {
        const p = byRefn.get(refn);
        if (p && !ids.includes(p.id)) ids.push(p.id);
    }
    const known = new Map(persons.map(p => [p.id, p]));
    return ids.filter(id => {
        const p = known.get(id);
        return !!p && !p.isPlaceholder && files.every(i => has(i, p));
    });
}

function placeKeyOf(p: MediaPlace): string {
    if ('personId' in p) return `p:${p.personId}:${p.fact ?? ''}:${p.eventId ?? ''}`;
    if ('partnershipId' in p) return `u:${p.partnershipId}:${p.eventId ?? ''}`;
    return `s:${p.sourceId}`;
}

/** The person's events to link to: birth, death, their dated events and their unions' events. */
function eventPlaces(person: Person): MediaPlace[] {
    const out: MediaPlace[] = [];
    out.push({ personId: person.id, fact: 'birth' });
    if (person.deathDate || person.deathPlace || person.isDeceased) out.push({ personId: person.id, fact: 'death' });
    for (const ev of person.events ?? []) out.push({ personId: person.id, eventId: ev.id });
    for (const uid of person.partnerships ?? []) {
        const union = DataManager.getPartnership(uid);
        for (const ev of union?.events ?? []) out.push({ partnershipId: uid, eventId: ev.id });
    }
    return out;
}

/** The year of an event place (for the preselection of a record's event). */
function placeYear(place: MediaPlace): number | null {
    let date: string | undefined;
    if ('personId' in place) {
        const p = DataManager.getPerson(place.personId);
        date = place.fact === 'birth' ? p?.birthDate : place.fact === 'death' ? p?.deathDate : p?.events?.find(e => e.id === place.eventId)?.date;
    } else if ('partnershipId' in place) {
        date = DataManager.getPartnership(place.partnershipId)?.events?.find(e => e.id === place.eventId)?.date;
    }
    return yearOf(date);
}

export const materialAttachMethods = uiModule({
    // ==================== LINK TO… (§4) ====================

    /**
     * "Link to…" for files: the tree's (their places grow) and material
     * outside the tree (it becomes a file of the tree with a working copy).
     */
    openAttachDialog(items: MaterialItem[], ctx: AttachCtx = {}): void {
        const m = strings.materials;
        const mc = this.materialsContext();
        const files = items.filter(i => !!treeRecord(i) || (!!i.file && i.origin !== 'tree'));
        if (!files.length || DataManager.isReadOnly()) return;
        const records = files.map(treeRecord).filter((a): a is Attachment => !!a && a.places.length > 0);
        const outside = files.filter(i => !treeRecord(i));
        const bridgeUp = !!mc?.caps.bridgeUp && !!mc.base;
        const one = files.length === 1 ? files[0] : null;
        const batches = new Set(files.map(i => i.batch?.name ?? ''));
        const sub = one
            ? `${one.name} · ${outside.length ? m.attachOnlyArchive : m.attachInTree}`
            : m.attachSub(batches.size === 1 && files[0].batch ? files[0].batch.name : null, outside.length);
        const dialog = materialDialog({ title: one ? m.attachTitle : m.attachTitleN(files.length), sub, modifier: 'attach' });
        if (one) {
            dialog.box.querySelector('.mdlg-title')!.textContent = one.title;
            const att = treeRecord(one);
            // A stand-in of a file on its way is never drawn as an image (spec 116 §5): the head without one.
            if (att?.dataUrl && att.mimeType.startsWith('image/') && !att.originalOnly && !isPendingImageUrl(att.dataUrl)) {
                const img = h('img', 'mdlg-attach-thumb');
                img.alt = '';
                img.src = att.dataUrl;
                dialog.box.querySelector('.mdlg-head')!.prepend(img);
                dialog.box.querySelector('.mdlg-head')!.classList.add('has-thumb');
            }
        }
        dialog.box.setAttribute('aria-label', one ? `${m.attachTitle}: ${one.title}` : m.attachTitleN(files.length));

        // Context: the person it came from, else the file's only person.
        const own = records.length === 1 && files.length === 1 ? mediaPersonIds(records[0]) : [];
        let anchorPerson: PersonId | null = ctx.personId && DataManager.getPerson(ctx.personId) ? ctx.personId : own.length === 1 ? own[0] : null;
        // The person it was opened from is chosen at the start (1121), unless every file is theirs already
        // (a place in the tree or the research's assignment): then nothing is chosen and one sentence says so.
        const fromPerson = ctx.personId ? DataManager.getPerson(ctx.personId) : undefined;
        const fromRefn = researchPersonRef(fromPerson?.refn);
        const hasFromPerson = (i: MaterialItem): boolean => {
            const rec = treeRecord(i);
            return (!!rec && !rec.removed && !!fromPerson && mediaAt(rec, { personId: fromPerson.id })) || (!!fromRefn && i.persons.includes(fromRefn));
        };
        const fromAlready = !!fromPerson && files.every(hasFromPerson);
        const preselect: PersonId[] = fromPerson && !fromPerson.isPlaceholder && !fromAlready ? [fromPerson.id] : [];
        // Whose all the files are already (a place in the tree or the research's assignment): ticked and not
        // changeable in the list, and named above it — the same people the sentence "already linked" speaks of.
        const pickable = DataManager.getAllPersons().filter(p => !p.isPlaceholder);
        const fixedPeople = attachFixedPeople(files, pickable);
        const fixedSet = new Set(fixedPeople);

        const seg = h('div', 'mdlg-seg sel-seg');
        seg.setAttribute('role', 'radiogroup');
        const pane = h('div', 'mdlg-attach-pane');
        const note = h('p', 'mdlg-note');
        note.hidden = true;
        dialog.body.append(seg, pane, note);
        if (outside.length) {
            dialog.body.appendChild(h('p', 'mdlg-text mdlg-attach-arch', one ? (mc?.agent ? m.archiveOnlyResearch : m.archiveOnly)
                : (mc?.agent ? m.attachArchNResearch : m.attachArchN)(outside.length)));
        }
        const off = outside.length > 0 && !bridgeUp;
        if (off) dialog.body.appendChild(h('p', 'mdlg-text mdlg-attach-off', m.actionsWhenRunning));

        const confirm = button(m.attachBtn, 'is-primary', () => void run());
        confirm.disabled = true;
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), confirm);

        let target: Target = 'person';
        let chosenPeople: PersonId[] = [];
        let chosenPlace: MediaPlace | null = null;
        let multi: MultiPersonPicker | null = null;
        let single: PersonPicker | null = null;
        const cleanup = () => { multi?.destroy(); multi = null; single?.destroy(); single = null; };
        const close = dialog.close;
        dialog.close = () => { cleanup(); close(); };

        const refresh = () => {
            const n = target === 'person' ? chosenPeople.length : chosenPlace ? 1 : 0;
            confirm.textContent = target === 'person' && n ? m.attachN(n) : m.attachBtn;
            confirm.disabled = off || n === 0;
            let text = '';
            if (target === 'person' && mc?.caps.list && chosenPeople.some(id => !researchPersonRef(DataManager.getPerson(id)?.refn))) {
                text = mc.agent ? m.noRefnTreeResearch : m.noRefnTree;
            } else if (target === 'couple') text = m.coupleNote;
            else if (target === 'source') text = m.sourceDocNote;
            note.textContent = text;
            note.hidden = !text;
        };

        const radioList = (places: MediaPlace[], preselect: MediaPlace | null): HTMLElement => {
            const list = h('div', 'mdlg-attach-list');
            list.setAttribute('role', 'radiogroup');
            const data = DataManager.getData();
            for (const place of places) {
                const label = h('label', 'mdlg-radio');
                const input = h('input');
                input.type = 'radio';
                input.name = 'mdlg-attach-place';
                const done = allHave(records, place, placeKeyOf) && !outside.length;
                input.disabled = done;
                label.append(input, h('span', 'mdlg-radio-text', mediaPlaceLabel(data, place)));
                if (done) label.appendChild(h('span', 'mdlg-tag', m.attachAlready));
                input.addEventListener('change', () => { chosenPlace = place; refresh(); });
                if (!done && preselect && placeKeyOf(preselect) === placeKeyOf(place)) {
                    input.checked = true;
                    chosenPlace = place;
                }
                list.appendChild(label);
            }
            return list;
        };

        /** The event / union panes start with a person: the context's, else one picked here. */
        const withPerson = (draw: (person: Person) => void) => {
            const person = anchorPerson ? DataManager.getPerson(anchorPerson) : null;
            if (person) {
                draw(person);
                return;
            }
            const host = h('div');
            host.id = ONE_PICKER_ID;
            pane.appendChild(host);
            single = new PersonPicker({
                containerId: ONE_PICKER_ID,
                placeholder: m.attachPersonPh,
                showBirthYear: true,
                persons: DataManager.getAllPersons().filter(p => !p.isPlaceholder),
                onSelect: (id) => { anchorPerson = id; show(target); },
            });
            single.focusInput();
        };

        const personHead = (person: Person, label: (n: string) => string): HTMLElement => {
            const row = h('div', 'mdlg-attach-who');
            row.appendChild(h('span', 'mdlg-attach-whoname', label(fullName(person))));
            const change = h('button', 'link-button mdlg-attach-change', m.attachChange);
            change.type = 'button';
            change.addEventListener('click', () => { anchorPerson = null; show(target); });
            row.appendChild(change);
            return row;
        };

        const show = (next: Target) => {
            target = next;
            cleanup();
            chosenPlace = null;
            chosenPeople = [];
            pane.replaceChildren();
            seg.querySelectorAll<HTMLButtonElement>('.sel-opt').forEach(b => {
                const on = b.dataset.target === next;
                b.setAttribute('aria-checked', String(on));
                b.tabIndex = on ? 0 : -1;
            });
            if (next === 'person') {
                if (fromAlready && fromPerson) pane.appendChild(h('p', 'mdlg-text mdlg-attach-has', m.attachPersonAlready(fullName(fromPerson), files.length)));
                const host = h('div');
                host.id = PICKER_ID;
                pane.appendChild(host);
                multi = new MultiPersonPicker({
                    containerId: PICKER_ID,
                    multi: true,
                    persons: pickable,
                    placeholder: m.attachPersonPh,
                    max: MAX_PEOPLE,
                    fixed: p => fixedSet.has(p.id),
                    fixedChips: fixedPeople,
                    onChange: ids => { chosenPeople = ids; refresh(); },
                    noneLabel: m.noneChosen,
                    removeLabel: m.removePerson,
                    maxLabel: m.assignMax,
                    fixedLabel: m.attachAlready,
                    initial: preselect,
                });
                chosenPeople = [...preselect];
                multi.focusInput();
            } else if (next === 'event') {
                withPerson(person => {
                    pane.appendChild(personHead(person, m.attachEventsOf));
                    const places = eventPlaces(person);
                    // A record with a date: its event of the same year is the likely one.
                    const rec = one ? treeRecord(one) : undefined;
                    const year = one && (one.kind ?? rec?.kind) === 'record' ? (yearOf(one.date ?? rec?.date) ?? NaN) : NaN;
                    const pre = Number.isFinite(year) ? places.find(p => placeYear(p) === year) ?? null : null;
                    pane.appendChild(places.length ? radioList(places, pre) : h('p', 'mdlg-text', m.attachNoEvents));
                    pane.querySelector<HTMLInputElement>('input:checked, input:not(:disabled)')?.focus();
                });
            } else if (next === 'couple') {
                withPerson(person => {
                    pane.appendChild(personHead(person, m.attachCouplesOf));
                    const places: MediaPlace[] = (person.partnerships ?? [])
                        .filter(id => !!DataManager.getPartnership(id))
                        .map(id => ({ partnershipId: id as PartnershipId }));
                    pane.appendChild(places.length ? radioList(places, null) : h('p', 'mdlg-text', m.attachNoCouples));
                    pane.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
                });
            } else {
                const input = h('input', 'mdlg-attach-search');
                input.type = 'search';
                input.placeholder = m.attachSourcePh;
                input.setAttribute('aria-label', m.attachSourcePh);
                const host = h('div', 'mdlg-attach-sources');
                const all = Object.values(DataManager.getData().sources ?? {}) as Source[];
                const draw = () => {
                    const q = input.value.trim().toLowerCase();
                    const found = all.filter(s => this.sourceMatches(s, q)).sort((a, b) => a.title.localeCompare(b.title)).slice(0, MAX_SOURCES);
                    chosenPlace = null;
                    host.replaceChildren(found.length ? radioList(found.map(s => ({ sourceId: s.id })), null) : h('p', 'mdlg-text', m.attachNoSources));
                    refresh();
                };
                input.addEventListener('input', draw);
                pane.append(input, host);
                // New source from this file… (spec 102 §5): one file becomes the evidence of a new source.
                if (one && this.canEditSources()) {
                    const make = h('button', 'link-button mdlg-attach-newsource', m.newSourceFromFile);
                    make.type = 'button';
                    make.disabled = off;
                    make.addEventListener('click', () => {
                        dialog.close();
                        void this.makeSourceFromMaterial(one, { personId: anchorPerson });
                    });
                    pane.appendChild(make);
                }
                draw();
                input.focus();
            }
            refresh();
        };

        for (const t of TARGETS) {
            const b = h('button', 'sel-opt', m.attachTarget[t]);
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.dataset.target = t;
            b.dataset.selForm = 'seg';
            b.addEventListener('click', () => show(t));
            seg.appendChild(b);
        }
        // ←/→ on the segment (or outside a text field) switch the target; Enter links.
        dialog.box.addEventListener('keydown', (e) => {
            const el = e.target as HTMLElement;
            const typing = el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search');
            if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (seg.contains(el) || (!typing && !(el instanceof HTMLInputElement)))) {
                e.preventDefault();
                const i = TARGETS.indexOf(target);
                const next = TARGETS[(i + (e.key === 'ArrowRight' ? 1 : TARGETS.length - 1)) % TARGETS.length];
                show(next);
                seg.querySelector<HTMLElement>(`[data-target="${next}"]`)?.focus();
                return;
            }
            if (e.key === 'Enter' && !confirm.disabled && !(el instanceof HTMLButtonElement) && !(typing && target === 'person' && (el as HTMLInputElement).value)) {
                e.preventDefault();
                void run();
            }
        });
        show('person');

        const run = async () => {
            if (confirm.disabled || isBusy(confirm)) return;
            const places: MediaPlace[] = target === 'person' ? chosenPeople.map(id => ({ personId: id })) : chosenPlace ? [chosenPlace] : [];
            if (!places.length) return;
            dialog.busy(true);
            dialog.error(null);
            const targets: Array<{ id: string } | { record: Omit<Attachment, 'id' | 'places'> }> = files.filter(i => treeRecord(i)).map(i => ({ id: treeRecord(i)!.id }));
            for (const item of outside) {
                const record = await this.materialWorkingCopy(item, mc);
                if (!record) {
                    dialog.busy(false);
                    dialog.error(m.attachFailed);
                    return;
                }
                targets.push({ record });
            }
            const data = DataManager.getData();
            const toast = target === 'person'
                ? m.attachedToast.persons(chosenPeople.map(id => { const p = DataManager.getPerson(id); return p ? fullName(p) : id; }))
                : m.attachedToast[target](mediaPlaceLabel(data, places[0]));
            const changed = DataManager.linkMedia(targets, places, { toast });
            dialog.busy(false);
            if (!changed.length) return;
            dialog.close();
            this.afterMediaChange();
            ctx.done?.();
        };
    },

    /**
     * Material outside the tree as a file of the tree: its working copy from
     * the bridge (an image reduced as an attachment, a PDF up to 2 MB; any
     * other kind only its original) and what the research knows of it.
     */
    async materialWorkingCopy(item: MaterialItem, mc: MaterialsContext | null): Promise<Omit<Attachment, 'id' | 'places'> | null> {
        const sha = materialItemSha(item);
        const file = item.file;
        if (!sha || !file || !mc?.base) return null;
        const mime = file.mime || item.mime || 'application/octet-stream';
        const original = { sha256: sha, name: file.name, mimeType: mime, bytes: file.bytes ?? 0 };
        // The sender's note goes with it: a send of the tree without it would take it off in the research.
        const note = materialRecordNote(item);
        const details = {
            ...(item.titled ? { title: item.title } : {}),
            ...(item.kind ? { kind: item.kind } : {}),
            ...(item.date ? { date: item.date } : {}),
            ...(note ? { note } : {}),
        };
        const shown = ATTACHMENT_IMAGE_TYPES.includes(mime) || (mime === 'application/pdf' && (file.bytes ?? 0) <= MAX_PDF_BYTES);
        if (!shown) return { name: file.name, mimeType: mime, dataUrl: ORIGINAL_ONLY_DATA_URL, sizeBytes: 0, original, originalOnly: true, ...details };
        try {
            const res = await fetch(fileUrl(mc.base, sha), { method: 'GET', mode: 'cors', credentials: 'omit' });
            if (!res.ok) return null;
            const blob = await res.blob();
            const type = blob.type || mime;
            const picked = new File([blob], file.name, { type });
            let dataUrl: string;
            let mimeType: string;
            if (ATTACHMENT_IMAGE_TYPES.includes(type)) {
                dataUrl = await compressImageAttachment(picked);
                mimeType = 'image/jpeg';
            } else if (type === 'application/pdf' && blob.size <= MAX_PDF_BYTES) {
                dataUrl = await readFileAsDataUrl(picked);
                mimeType = 'application/pdf';
            } else {
                return { name: file.name, mimeType: mime, dataUrl: ORIGINAL_ONLY_DATA_URL, sizeBytes: 0, original, originalOnly: true, ...details };
            }
            return { name: file.name, mimeType, dataUrl, sizeBytes: dataUrlByteSize(dataUrl), original: { ...original, bytes: original.bytes || blob.size }, ...details };
        } catch {
            return null;
        }
    },

    /** After a file of the tree changed here: the person's lists, the window, the viewer. */
    afterMediaChange(): void {
        if (document.getElementById('person-modal')?.classList.contains('active')) {
            this.renderAttachmentsList();
            this.renderMaterialsSection();
        }
        this.refreshMaterialsWindow();
        this.materialViewerTreeChanged();
    },

    // ==================== REMOVE FROM THE TREE (§9) ====================

    /** Does an archive keep this item's file (a tree with an archive holding its original)? */
    materialKeptByArchive(item: MaterialItem): boolean {
        const mc = this.materialsContext();
        return !!mc?.caps.list && !!item.file;
    },

    /**
     * "Remove from the tree…": the warning names what refers to the file
     * (a source's evidence, an excerpt, a portrait). With an archive the
     * record stays taken out (Hidden · Removed from the tree, Restore); without
     * one the file is deleted (O1). True when it was removed.
     */
    async openRemoveFromTreeDialog(item: MaterialItem, opts: { leave?: () => void } = {}): Promise<boolean> {
        const m = strings.materials;
        const att = item.attachment ? DataManager.getMedia(item.attachment.id) : undefined;
        if (!att?.places.length || !DataManager.canEditMedia(att.id)) return false;
        const mc = this.materialsContext();
        const kept = this.materialKeptByArchive(item);
        const title = item.title || att.title || att.name;
        const n = att.places.length;
        const dialog: MaterialDialog = materialDialog({ title: kept ? m.rmTitle : m.rmAppTitle, modifier: 'remove' });
        dialog.body.appendChild(h('p', 'mdlg-text', kept ? m.rmText(title, n) : m.rmAppText(title, n)));
        const data = DataManager.getData();
        const refs = mediaUses(data, att.id).filter(u => u.kind === 'source' || u.kind === 'excerpt' || u.kind === 'portrait');
        if (refs.length) {
            const warn = h('div', 'mdlg-warn');
            warn.appendChild(h('p', 'mdlg-warn-title', m.rmRefs));
            for (const use of refs) {
                const what = mediaUseLabel(data, use).text;
                const row = h('div', 'mdlg-warn-row');
                row.dataset.use = use.kind;
                row.append(
                    h('span', 'mdlg-warn-ref', use.kind === 'source' ? m.rmRefDoc(what) : use.kind === 'excerpt' ? m.rmRefExcerpt(what) : m.rmRefPortrait(what)),
                    h('span', 'mdlg-warn-keep', use.kind === 'source' ? m.rmKeepDoc : use.kind === 'excerpt' ? m.rmKeepExcerpt : m.rmKeepPortrait),
                );
                warn.appendChild(row);
            }
            dialog.body.appendChild(warn);
        }
        let set: HTMLFieldSetElement | null = null;
        if (kept) {
            dialog.body.appendChild(h('p', 'mdlg-text', mc?.agent ? m.rmArchiveResearch : m.rmArchive));
            set = h('fieldset', 'mdlg-radios');
            set.appendChild(h('legend', '', m.reasonOptional));
            for (const reason of ['none', 'unrelated', 'duplicate']) {
                const label = h('label', 'mdlg-radio');
                const input = h('input');
                input.type = 'radio';
                input.name = 'mdlg-rm-reason';
                input.value = reason;
                input.checked = reason === 'none';
                label.append(input, h('span', '', m.reason[reason]));
                set.appendChild(label);
            }
            dialog.body.appendChild(set);
        } else {
            dialog.body.appendChild(h('p', 'mdlg-text mdlg-rm-app', m.rmApp));
        }
        // Its original still waiting to be sent: discarded too (ticked), or sent and detached by the research.
        const sha = att.original?.sha256;
        const state = sha ? this.mediaStateOf({ sha, bytes: att.original?.bytes, personId: mediaPersonIds(att)[0] }) : null;
        let discard: HTMLInputElement | null = null;
        if (sha && (state?.kind === 'queued' || state?.kind === 'sending')) {
            const label = h('label', 'mdlg-check');
            discard = h('input');
            discard.type = 'checkbox';
            discard.name = 'mdlg-rm-discard';
            discard.checked = true;
            const text = h('span', 'mdlg-check-text');
            text.append(h('span', '', strings.media.deleteDiscard(formatBytes(att.original?.bytes ?? 0))), h('span', 'mdlg-check-hint', strings.media.deleteDiscardHint));
            label.append(discard, text);
            dialog.body.appendChild(label);
        }
        return new Promise<boolean>((resolve) => {
            let result = false;
            const go = button(kept ? m.rmBtn : m.rmAppBtn, 'is-danger', async () => {
                if (discard && sha) await this.settleQueuedOriginal(sha, discard.checked);
                const value = set?.querySelector<HTMLInputElement>('input:checked')?.value;
                const reason = value === 'unrelated' || value === 'duplicate' ? value : undefined;
                // Deleted: the viewer has nothing left to show; kept by the archive it shows Restore.
                if (!kept) opts.leave?.();
                result = DataManager.removeMedia(att.id, {
                    keep: kept, ...(reason ? { reason } : {}),
                    toast: kept ? m.rmDoneToast(title) : m.rmAppDoneToast(title),
                });
                dialog.close();
                if (result) this.afterMediaChange();
            });
            const cancel = button(strings.buttons.cancel, '', () => dialog.close());
            const close = dialog.close;
            dialog.close = () => { close(); resolve(result); };
            dialog.foot.append(cancel, go);
            cancel.focus();
        });
    },

    /**
     * "Remove from the tree…" of a selection (spec 102 §8, §9): the files
     * that have a place in the tree and can change here, in one undo step.
     * Kept by an archive: taken out (Restore); otherwise deleted (O1). The
     * warning names what refers to them. True when they were removed.
     */
    async openRemoveManyFromTreeDialog(items: MaterialItem[]): Promise<boolean> {
        const m = strings.materials;
        const files = items.flatMap(item => {
            const att = item.attachment ? DataManager.getMedia(item.attachment.id) : undefined;
            return att?.places.length && !item.removedId && DataManager.canEditMedia(att.id) ? [{ item, att }] : [];
        });
        if (files.length < 2) return files.length === 1 ? this.openRemoveFromTreeDialog(files[0].item) : false;
        const mc = this.materialsContext();
        const kept = files.filter(f => this.materialKeptByArchive(f.item));
        const gone = files.filter(f => !this.materialKeptByArchive(f.item));
        const places = (list: typeof files) => list.reduce((sum, f) => sum + f.att.places.length, 0);
        const dialog: MaterialDialog = materialDialog({ title: kept.length ? m.rmTitle : m.rmManyAppTitle, modifier: 'remove' });
        if (kept.length) dialog.body.appendChild(h('p', 'mdlg-text', m.rmManyText(kept.length, places(kept))));
        if (gone.length) dialog.body.appendChild(h('p', 'mdlg-text', m.rmManyAppText(gone.length, places(gone))));
        const data = DataManager.getData();
        // Two files that are evidence of one source name it once.
        const seen = new Set<string>();
        const refs = files.flatMap(f => mediaUses(data, f.att.id).filter(u => u.kind === 'source' || u.kind === 'excerpt' || u.kind === 'portrait'))
            .filter(u => {
                const key = `${u.kind}\u0000${mediaUseLabel(data, u).text}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        if (refs.length) {
            const warn = h('div', 'mdlg-warn');
            warn.appendChild(h('p', 'mdlg-warn-title', m.rmRefsMany));
            const SHOWN = 5;
            for (const use of refs.slice(0, SHOWN)) {
                const what = mediaUseLabel(data, use).text;
                const row = h('div', 'mdlg-warn-row');
                row.dataset.use = use.kind;
                row.append(
                    h('span', 'mdlg-warn-ref', use.kind === 'source' ? m.rmRefDoc(what) : use.kind === 'excerpt' ? m.rmRefExcerpt(what) : m.rmRefPortrait(what)),
                    h('span', 'mdlg-warn-keep', use.kind === 'source' ? m.rmKeepDoc : use.kind === 'excerpt' ? m.rmKeepExcerpt : m.rmKeepPortrait),
                );
                warn.appendChild(row);
            }
            if (refs.length > SHOWN) warn.appendChild(h('span', 'mdlg-warn-keep', m.moreN(refs.length - SHOWN)));
            dialog.body.appendChild(warn);
        }
        let set: HTMLFieldSetElement | null = null;
        if (kept.length) {
            dialog.body.appendChild(h('p', 'mdlg-text', mc?.agent ? m.rmArchiveResearch : m.rmArchive));
            set = h('fieldset', 'mdlg-radios');
            set.appendChild(h('legend', '', m.reasonOptional));
            for (const reason of ['none', 'unrelated', 'duplicate']) {
                const label = h('label', 'mdlg-radio');
                const input = h('input');
                input.type = 'radio';
                input.name = 'mdlg-rm-reason';
                input.value = reason;
                input.checked = reason === 'none';
                label.append(input, h('span', '', m.reason[reason]));
                set.appendChild(label);
            }
            dialog.body.appendChild(set);
        }
        if (gone.length) dialog.body.appendChild(h('p', 'mdlg-text mdlg-rm-app', m.rmAppMany));
        // Originals still waiting to be sent: discarded too (ticked), or sent and detached by the research.
        const queued = files.flatMap(f => {
            const sha = f.att.original?.sha256;
            const state = sha ? this.mediaStateOf({ sha, bytes: f.att.original?.bytes, personId: mediaPersonIds(f.att)[0] }) : null;
            return sha && (state?.kind === 'queued' || state?.kind === 'sending') ? [{ sha, bytes: f.att.original?.bytes ?? 0 }] : [];
        });
        let discard: HTMLInputElement | null = null;
        if (queued.length) {
            const label = h('label', 'mdlg-check');
            discard = h('input');
            discard.type = 'checkbox';
            discard.name = 'mdlg-rm-discard';
            discard.checked = true;
            const text = h('span', 'mdlg-check-text');
            text.append(h('span', '', strings.media.deleteDiscard(formatBytes(queued.reduce((sum, q) => sum + q.bytes, 0)))), h('span', 'mdlg-check-hint', strings.media.deleteDiscardHint));
            label.append(discard, text);
            dialog.body.appendChild(label);
        }
        return new Promise<boolean>((resolve) => {
            let result = false;
            const go = button(kept.length ? m.rmBtn : m.rmManyAppBtn, 'is-danger', async () => {
                if (discard) for (const q of queued) await this.settleQueuedOriginal(q.sha, discard.checked);
                const value = set?.querySelector<HTMLInputElement>('input:checked')?.value;
                const reason = value === 'unrelated' || value === 'duplicate' ? value : undefined;
                const keep = new Set(kept.map(f => f.att.id));
                const done = DataManager.removeMediaMany(files.map(f => f.att.id), {
                    keep: id => keep.has(id), ...(reason ? { reason } : {}),
                    toast: gone.length && !kept.length ? m.rmManyAppDoneToast(files.length) : m.rmManyDoneToast(files.length),
                });
                result = done.length > 0;
                dialog.close();
                if (result) this.afterMediaChange();
            });
            const cancel = button(strings.buttons.cancel, '', () => dialog.close());
            const close = dialog.close;
            dialog.close = () => { close(); resolve(result); };
            dialog.foot.append(cancel, go);
            cancel.focus();
        });
    },

    /**
     * "Remove a person…" of a selection (spec 102 §8): one of the people on
     * the selected files, taken off all of them — the tree's files in one undo
     * step (a file left without a place: kept by an archive it stays there,
     * otherwise it is deleted and the dialog says so), the research's
     * material through the bridge (its toast offers Undo).
     */
    openSelRemovePersonDialog(items: MaterialItem[], opts: { done?: () => void; research?: (files: MaterialItem[], refn: string) => void } = {}): boolean {
        const m = strings.materials;
        const options = this.selRemovePersonOptions(items);
        if (!options.length) return false;
        const dialog: MaterialDialog = materialDialog({ title: m.selRemovePersonTitle, sub: m.selRemovePersonText(items.length) });
        const set = h('fieldset', 'mdlg-radios');
        set.appendChild(h('legend', '', m.f.persons));
        options.forEach((o, i) => {
            const label = h('label', 'mdlg-radio');
            const input = h('input');
            input.type = 'radio';
            input.name = 'mdlg-sel-person';
            input.value = String(i);
            input.checked = i === 0;
            label.append(input, h('span', '', `${o.name} (${o.tree.length + o.research.length})`));
            set.appendChild(label);
        });
        dialog.body.appendChild(set);
        const lastNote = h('p', 'mdlg-text mdlg-rm-app');
        dialog.body.appendChild(lastNote);
        const chosen = () => options[Number(set.querySelector<HTMLInputElement>('input:checked')?.value ?? 0)] ?? options[0];
        // Without an archive a file whose only places are this person's goes with it: said before it happens.
        const showLast = () => {
            const o = chosen();
            const last = o.tree.filter(f => !this.materialKeptByArchive(f.item) && f.att.places.every(p => placePersonId(p) === o.personId)).length;
            lastNote.textContent = last ? m.selRemovePersonLast(last) : '';
            lastNote.hidden = !last;
        };
        set.addEventListener('change', showLast);
        showLast();
        const go = button(m.selRemovePersonBtn, 'is-danger', () => {
            const o = chosen();
            dialog.close();
            if (o.tree.length && o.personId) {
                const what = o.tree.length === 1 ? o.tree[0].item.title : m.assignWhat.filesOnly(o.tree.length);
                const ok = DataManager.removeMediaPerson(o.tree.map(f => f.att.id), o.personId, {
                    toast: m.removedToast(o.name, what),
                });
                if (ok.length) this.afterMediaChange();
            }
            if (o.research.length && o.refn) opts.research?.(o.research, o.refn);
            opts.done?.();
        });
        dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), go);
        set.querySelector<HTMLInputElement>('input:checked')?.focus();
        return true;
    },

    /**
     * The people on the selected files (spec 102 §8): per person the tree's
     * files with a place at them and the research's material naming them
     * directly; the most files first.
     */
    selRemovePersonOptions(items: MaterialItem[]): { name: string; personId?: PersonId; refn?: string; tree: { item: MaterialItem; att: Attachment }[]; research: MaterialItem[] }[] {
        const mc = this.materialsContext();
        const bridge = !!mc?.caps.assign && !!mc.caps.bridgeUp;
        const byRefn = new Map<string, Person>();
        for (const p of DataManager.getAllPersons()) {
            const refn = researchPersonRef(p.refn);
            if (refn) byRefn.set(refn, p);
        }
        type Option = { name: string; personId?: PersonId; refn?: string; tree: { item: MaterialItem; att: Attachment }[]; research: MaterialItem[] };
        const options = new Map<string, Option>();
        const optionOf = (person: Person | undefined, refn: string | undefined): Option => {
            const key = person ? `p:${person.id}` : `r:${refn}`;
            let o = options.get(key);
            if (!o) {
                const ref = refn ?? (person ? researchPersonRef(person.refn) : null);
                o = { name: person ? (`${person.firstName} ${person.lastName}`.trim() || person.id) : this.materialPersonName(refn ?? ''),
                    ...(person ? { personId: person.id } : {}), ...(ref ? { refn: ref } : {}), tree: [], research: [] };
                options.set(key, o);
            }
            return o;
        };
        for (const item of items) {
            const att = item.attachment ? DataManager.getMedia(item.attachment.id) : undefined;
            if (att?.places.length && !item.removedId) {
                if (DataManager.isReadOnly() || !DataManager.canEditMedia(att.id)) continue;
                for (const pid of mediaPersonIds(att)) {
                    const person = DataManager.getPerson(pid);
                    if (person) optionOf(person, undefined).tree.push({ item, att });
                }
            } else if (bridge && item.origin !== 'tree' && item.file) {
                for (const refn of directPersons(item.file)) optionOf(byRefn.get(refn), refn).research.push(item);
            }
        }
        return [...options.values()].sort((a, b) => (b.tree.length + b.research.length) - (a.tree.length + a.research.length) || a.name.localeCompare(b.name));
    },

    /** "Restore" of files taken out of the tree: back with the places they had (one undo step each). */
    restoreRemovedMaterials(items: MaterialItem[]): void {
        let last = '';
        for (const item of items) {
            if (!item.removedId) continue;
            const att = DataManager.getMedia(item.removedId);
            if (att && DataManager.restoreMedia(att.id, { toast: strings.materials.restoredTreeToast(att.title || item.title || att.name) })) last = att.id;
        }
        if (last) this.afterMediaChange();
    },

    /** "×" on a file's last place: with an archive the file stays there (toast); without one it asks as Remove from the tree. */
    async removeLastMaterialPlace(item: MaterialItem, mediaId: string, place: MediaPlace, what: string, leave: () => void): Promise<boolean> {
        const m = strings.materials;
        const mc = this.materialsContext();
        if (this.materialKeptByArchive(item)) {
            const ok = DataManager.removeMediaPlace(mediaId, place, { toast: (mc?.agent ? m.lastLinkToastResearch : m.lastLinkToast)(what, item.title) });
            if (ok) this.afterMediaChange();
            return ok;
        }
        return this.openRemoveFromTreeDialog(item, { leave });
    },

    // ==================== THE SAME FILE TWICE (§12h) ====================

    /**
     * A file being added to a person whose original (or copy) is already in
     * the tree: with an archive the person is linked to it without a question
     * (toast); without one a dialog asks (Link here too / Cancel / Add as a
     * new file). 'linked' / 'cancel': handled; 'new': add it as a new file.
     */
    async sameFileTwice(personId: PersonId, file: { original?: { sha256: string } | null; dataUrl?: string; originalOnly?: boolean }): Promise<'linked' | 'cancel' | 'new' | null> {
        const m = strings.materials;
        const same = DataManager.sameFileMedia(file);
        if (!same) return null;
        if (same.places.some(p => placePersonId(p) === personId)) {
            this.showToast(m.dupHereToast, TOAST_MS, { closable: true });
            return 'cancel';
        }
        const mc = this.materialsContext();
        if (mc?.caps.list && same.original?.sha256) {
            DataManager.linkMedia([{ id: same.id }], [{ personId }], { toast: m.dupLinkedToast });
            this.afterMediaChange();
            return 'linked';
        }
        const owner = mediaPersonIds(same).map(id => DataManager.getPerson(id)).find((p): p is Person => !!p);
        const where = owner ? fullName(owner) : mediaPlaceLabel(DataManager.getData(), same.places[0]);
        const dialog = materialDialog({ title: m.dupTitle, modifier: 'dup' });
        dialog.body.appendChild(h('p', 'mdlg-text', m.dupText(where)));
        const asNew = h('button', 'link-button mdlg-dup-new', m.dupNew);
        asNew.type = 'button';
        dialog.body.appendChild(asNew);
        return new Promise(resolve => {
            let answer: 'linked' | 'cancel' | 'new' = 'cancel';
            const link = button(m.dupAttach, 'is-primary', () => {
                answer = DataManager.linkMedia([{ id: same.id }], [{ personId }], { toast: m.dupLinkedToast }).length ? 'linked' : 'cancel';
                dialog.close();
                if (answer === 'linked') this.afterMediaChange();
            });
            asNew.addEventListener('click', () => { answer = 'new'; dialog.close(); });
            const close = dialog.close;
            dialog.close = () => { close(); resolve(answer); };
            dialog.foot.append(button(strings.buttons.cancel, '', () => dialog.close()), link);
            link.focus();
        });
    },
});

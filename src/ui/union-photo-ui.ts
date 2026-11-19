/**
 * The couple's photo (spec 107 §6, §7, §10): choosing, removing and viewing
 * a union's photo, and the partners' portraits cut from it ("Make
 * portraits…": one editor with a step per partner).
 *
 * In the relationships panel these changes join the panel's edit session
 * as its other immediate operations do (witnesses, citations): they show at
 * once, Save keeps them as the panel's one undo step and leaving without
 * Save drops them. Anywhere else (the photo's viewer from the Table) Done
 * writes at once as one undo step with its own toast and Undo.
 */

import { DataManager } from '../data.js';
import { PartnershipId, Person, PersonId } from '../types.js';
import { strings, getCurrentLanguage, joinAnd } from '../strings.js';
import { dataUrlByteSize } from '../photo.js';
import { compressImageAttachment } from '../attachments.js';
import { shownName, shownNameOrEmpty } from '../person-name.js';
import { unionPartnersInOrder, unionPhotoCaption } from '../union-photo.js';
import { openPortraitEditor, PortraitEditorStep } from './portrait-editor.js';
import { canEditPortrait, pickImageFile, portraitCropOf } from './portrait-actions-ui.js';
import { openViewerList, closeImageViewer, redrawViewerList, viewerListOpen } from './image-viewer.js';
import { uiModule } from './module.js';
import { IMAGES_ARRIVED_EVENT, IMAGES_STATE_EVENT, imageLoads, type FieldKey } from '../image-loads.js';
import { personPhotoKey } from './person-photo-model.js';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

/** "123 kB": a photo's size as the person dialog writes it. */
export function photoKb(dataUrl: string): string {
    return `${Math.round(dataUrlByteSize(dataUrl) / 1024)} kB`;
}

/** The partners' names for the history ("Oskar Quellmayer", "?"). */
function partnerNames(pid: PartnershipId): [string, string] {
    const u = DataManager.getPartnership(pid);
    const [a, b] = u ? unionPartnersInOrder(DataManager.getData(), u) : [null, null];
    const name = (p: Person | null): string => (p && shownNameOrEmpty(p)) || strings.addChild.unknownPerson;
    return [name(a), name(b)];
}

/** May the couple's photo change here (the tree writable, neither partner locked)? */
export function canEditUnionPhoto(pid: PartnershipId): boolean {
    const u = DataManager.getPartnership(pid);
    if (!u || DataManager.isReadOnly() || DataManager.isTreeLocked()) return false;
    return ![u.person1Id, u.person2Id].some(id => DataManager.getPerson(id) && DataManager.isPersonLocked(id));
}

/** The evidence key of a couple's photo (spec 116). */
export function unionPhotoKey(pid: string): FieldKey {
    return `union:${pid}:photo`;
}

/** The couple's photo is still on its way after the tree (not the older one kept meanwhile: that can be shown). */
export function unionPhotoWaits(pid: string): boolean {
    return imageLoads.isPending(unionPhotoKey(pid));
}

/** The partners whose portrait may be cut from the couple's photo, in the card's order. */
function portraitPartners(pid: PartnershipId): Person[] {
    const u = DataManager.getPartnership(pid);
    if (!u) return [];
    return unionPartnersInOrder(DataManager.getData(), u).filter((p): p is Person => !!p && canEditPortrait(p.id));
}

export const unionPhotoMethods = uiModule({
    /**
     * A photo set or removed by the person: an image on its way to that place
     * no longer comes over it (spec 116 I2). In the relationships panel's
     * session only once the panel is saved (leaving without Save keeps
     * waiting for it).
     */
    dropImageWait(key: FieldKey): void {
        if (this.relSessionOwned && DataManager.isEditSessionActive()) this.relPhotoDrops.add(key);
        else imageLoads.drop(key);
    },

    /** "Choose photo" of a union (6a, 6b): a new photo, shrunk as an attachment (EXIF turned upright). */
    chooseUnionPhoto(pid: PartnershipId, done?: () => void): void {
        if (!canEditUnionPhoto(pid)) return;
        pickImageFile(file => { void this.setUnionPhotoFromFile(pid, file, done); });
    },

    async setUnionPhotoFromFile(pid: PartnershipId, file: File, done?: () => void): Promise<void> {
        if (!file.type.startsWith('image/')) {
            this.showAlert(strings.attachments.unsupportedType, 'warning');
            return;
        }
        // The file as it was, before it is shrunk: its original goes to a research that keeps it (spec 108 K2.4).
        const original = await this.preparePhotoOriginal(file, file.name, 'couple');
        let photo: string;
        try {
            photo = await compressImageAttachment(file);
        } catch (e) {
            console.error('Photo processing failed:', e);
            this.showAlert(strings.personModal.photoError, 'error');
            return;
        }
        if (!canEditUnionPhoto(pid)) return;
        const [a, b] = partnerNames(pid);
        DataManager.runBatch(strings.undo.unionPhoto(a, b), () => {
            DataManager.updatePartnership(pid, { photo, photoOriginalName: file.name, ...(original ? { photoOriginal: original } : {}) });
        });
        this.dropImageWait(unionPhotoKey(pid));
        if (original && DataManager.getPartnership(pid)?.photoOriginal?.sha256 === original.sha256) {
            const outcome = await this.queueOriginal(original, file, { partnershipId: pid });
            this.noteOriginalOutcome(outcome, file.size, { partnershipId: pid });
        }
        done?.();
    },

    /** "Remove" of a union's photo (6e): asked first; the portraits cut from it stay, cut off from it. */
    async removeUnionPhoto(pid: PartnershipId, done?: () => void): Promise<void> {
        if (!DataManager.getPartnership(pid)?.photo || !canEditUnionPhoto(pid)) return;
        const d = strings.danger;
        const confirmed = await this.showConfirm(d.undoHint, d.removeUnionPhotoTitle, {
            confirmLabel: d.removeUnionPhoto, variant: 'danger', note: { text: d.unionPhotoPortraitsStay },
        });
        if (!confirmed || !DataManager.getPartnership(pid)?.photo) return;
        const [a, b] = partnerNames(pid);
        DataManager.runBatch(strings.undo.unionPhoto(a, b), () => {
            DataManager.updatePartnership(pid, { photo: '' });
        });
        this.dropImageWait(unionPhotoKey(pid));
        done?.();
    },

    /**
     * "Make portraits…" (spec 107 §7): the editor over the couple's photo
     * with a step per partner in the card's order (the left and the right
     * half to start with, or the crop a portrait already cut from it has);
     * a partner with a portrait keeps it unless Replace is chosen. Done
     * saves every portrait made as one step, each naming the couple's photo.
     */
    async makeUnionPortraits(pid: PartnershipId, done?: () => void): Promise<void> {
        const union = DataManager.getPartnership(pid);
        if (!union?.photo || DataManager.isReadOnly()) return;
        // Not over a photo still on its way (the button waits for it, spec 116 §4.3).
        if (unionPhotoWaits(pid)) {
            this.showToast(strings.photos.recropWait);
            return;
        }
        const partners = portraitPartners(pid);
        if (!partners.length) return;
        const both = unionPartnersInOrder(DataManager.getData(), union).filter(Boolean).length;
        // A union with one known partner is still a couple's photo (portrait.single); a locked partner is left out without it.
        const couple = partners.length > 1 || both < 2;
        const steps: PortraitEditorStep[] = partners.map(person => ({
            person,
            ...(person.photoSource?.partnershipId === pid && person.photo ? { initial: portraitCropOf(person.photoSource) } : {}),
            ...(person.photo ? { current: person.photo } : {}),
        }));
        let result: Awaited<ReturnType<typeof openPortraitEditor>>;
        try {
            result = await openPortraitEditor({ source: union.photo, steps, title: strings.portrait.twoTitle, couple });
        } catch (e) {
            console.error('Photo processing failed:', e);
            this.showAlert(strings.personModal.photoError, 'error');
            return;
        }
        if (!result) return;
        const made = partners.map((p, i) => ({ id: p.id, step: result!.steps[i] ?? null }));
        // The tree may have changed while the editor was open (another window, a sync).
        const writable = made.filter((m): m is { id: PersonId; step: NonNullable<typeof m.step> } =>
            !!m.step && !!DataManager.getPerson(m.id) && canEditPortrait(m.id));
        if (!writable.length) {
            if (made.some(m => m.step)) this.showToast(strings.portrait.personGone);
            return;
        }
        const skipped = made.length - writable.length;
        const text = strings.portrait.fromUnion(writable.length, skipped);
        const names = writable.map(m => shownName(DataManager.getPerson(m.id)!));
        const inSession = DataManager.isEditSessionActive();
        DataManager.runBatch(strings.undo.portrait(joinAnd(getCurrentLanguage(), names)), () => {
            // The photo may be gone meanwhile: the portraits are kept without their link to it.
            const linked = !!DataManager.getPartnership(pid)?.photo;
            for (const m of writable) {
                DataManager.updatePerson(m.id, {
                    photo: m.step.photo,
                    photoSource: linked ? { partnershipId: pid, ...m.step.crop } : undefined,
                });
            }
        }, { text });
        for (const m of writable) this.dropImageWait(personPhotoKey(m.id));
        // In the relationships panel the change waits for its Save (one step there): the sentence alone.
        if (inSession) this.showToast(text);
        done?.();
    },

    /**
     * The couple's photo in the viewer (§7, §8): its caption and size beside
     * it, Download, and "Make portraits…" where the tree may change.
     * `readOnly`: opened where nothing may change (a locked person's panel).
     */
    openUnionPhotoViewer(pid: PartnershipId, opts: { readOnly?: boolean; done?: () => void } = {}): void {
        const union = DataManager.getPartnership(pid);
        const key = unionPhotoKey(pid);
        const waitState = (): 'loading' | 'failed' | null => {
            const st = imageLoads.stateOf(key);
            return st === 'pending' ? 'loading' : st === 'failed' ? 'failed' : null;
        };
        // A photo still on its way opens too (spec 116 §4.4): the viewer says so and shows it when it comes.
        if (!union || (!union.photo && !waitState())) return;
        const caption = unionPhotoCaption(DataManager.getData(), union);
        // What the stage shows: the photo, or the words of one on its way; drawn again when that changes.
        const look = (): string => DataManager.getPartnership(pid)?.photo ? 'photo' : waitState() ?? 'none';
        let shown = '';
        const onImages = () => { if (viewerListOpen() && look() !== shown) redrawViewerList({ stage: true }); };
        window.addEventListener(IMAGES_ARRIVED_EVENT, onImages);
        window.addEventListener(IMAGES_STATE_EVENT, onImages);
        const unwire = () => {
            window.removeEventListener(IMAGES_ARRIVED_EVENT, onImages);
            window.removeEventListener(IMAGES_STATE_EVENT, onImages);
        };
        openViewerList({
            count: 1,
            index: 0,
            show: (_i, slots) => {
                const photo = DataManager.getPartnership(pid)?.photo ?? '';
                if (!slots.redraw) {
                    shown = look();
                    if (photo) slots.image(photo);
                    else slots.wait(waitState() ?? 'failed', () => imageLoads.retry([key]));
                }
                slots.pos(caption);
                slots.note(null);
                const panel = slots.panel;
                panel.setAttribute('aria-labelledby', 'uv-title');
                const head = h('div', 'mv-head');
                const title = h('h2', 'mv-title', caption);
                title.id = 'uv-title';
                head.appendChild(title);
                // On its way: the caption alone (its size, Download and Make portraits… once it is here).
                if (!photo) {
                    panel.appendChild(head);
                    return;
                }
                const fresh = DataManager.getPartnership(pid);
                if (fresh?.photoOriginalName) head.appendChild(h('div', 'mv-name', fresh.photoOriginalName));
                head.appendChild(h('div', 'mv-summary', photoKb(photo)));
                const foot = h('div', 'mv-foot');
                const actions = h('div', 'mv-actions');
                const a = h('a', 'mv-act', strings.materials.download);
                a.href = photo;
                a.download = fresh?.photoOriginalName || 'photo.jpg';
                a.dataset.action = 'download';
                actions.appendChild(a);
                if (!opts.readOnly && fresh?.photo === photo && portraitPartners(pid).length) {
                    const b = h('button', 'mv-act', strings.relationships.makePortraits);
                    b.type = 'button';
                    b.dataset.action = 'makePortraits';
                    b.addEventListener('click', () => {
                        closeImageViewer();
                        void this.makeUnionPortraits(pid, opts.done);
                    });
                    actions.appendChild(b);
                }
                foot.appendChild(actions);
                panel.append(head, h('div', 'mv-gap'), foot);
            },
        }, unwire);
    },
});

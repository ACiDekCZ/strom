/**
 * Portrait actions outside the editor itself (spec 107 §2, §4, §10): "Edit
 * crop" in the person dialog and on the person page, "As portrait…" on an
 * attachment and "Use as portrait…" in the materials.
 *
 * In the person dialog the result waits for Save (the preview and the
 * dialog's pending portrait); anywhere else Done writes at once as one undo
 * step with its own toast. A person who is gone by the time of Done (another
 * window, a sync) gets nothing written and a toast says so.
 */

import { DataManager, auditPersonName } from '../data.js';
import { Attachment, MediaOriginal, Person, PersonId, PortraitCrop, PortraitSource } from '../types.js';
import { MaterialCaps, MaterialItem, isMaterialPortraitCandidate, isPortraitCandidate } from '../materials.js';
import { mediaAt } from '../media.js';
import { researchPersonRef } from '../research-link.js';
import { strings } from '../strings.js';
import { dataUrlByteSize } from '../photo.js';
import { shownName } from '../person-name.js';
import { openPortraitEditor, PortraitEditorInput } from './portrait-editor.js';
import { uiModule } from './module.js';
import { imageLoads } from '../image-loads.js';
import { personPhotoKey } from './person-photo-model.js';
import { portraitCropOf } from '../portrait-candidates.js';

/** Where a portrait comes from that is already in the tree: an attachment of the person or the couple's photo. */
export type PortraitOrigin = { attachmentId: string } | { partnershipId: NonNullable<PortraitSource['partnershipId']> };

/**
 * A research's picture a portrait is cut from, which becomes the tree's file
 * at the person on Done (or the person dialog's Save): the tree's file that
 * is it already (at another person), or its working copy from the bridge.
 */
export type PortraitFileLink = { id: string } | { record: Omit<Attachment, 'id' | 'places'> };

/** The picture a link names (the tree's copy or the working copy), or null. */
export function portraitLinkImage(link: PortraitFileLink): string | null {
    const att = 'id' in link ? DataManager.getMedia(link.id) : link.record;
    return att && isPortraitCandidate({ id: '', places: [], ...att }) ? att.dataUrl : null;
}

/**
 * Put a linked picture at the person, inside the caller's undo step: one more
 * place of the tree's file, else the working copy as a new file of the tree
 * with the research's original (as Link to…). The origin a portrait names, or null.
 */
export function linkPortraitFile(personId: PersonId, link: PortraitFileLink): PortraitOrigin | null {
    // The same file may have come to the tree meanwhile (another person, a sync): one file, one more place.
    const id = 'id' in link ? link.id : DataManager.sameFileMedia(link.record)?.id;
    if (id) {
        const att = DataManager.getMedia(id);
        if (!att) return null;
        if (!mediaAt(att, { personId })) DataManager.addMediaPlace(id, { personId });
        return mediaAt(DataManager.getMedia(id) ?? att, { personId }) ? { attachmentId: id } : null;
    }
    const [made] = 'record' in link ? DataManager.linkMedia([{ record: link.record }], [{ personId }]) : [];
    return made ? { attachmentId: made } : null;
}

/** The tree's file that is this research picture, one the tree shows (at any person), if any. */
export function treePortraitCopy(item: MaterialItem): Attachment | undefined {
    if (item.attachment) return isPortraitCandidate(item.attachment) && !item.attachment.removed ? item.attachment : undefined;
    const sha = item.file?.sha;
    const att = sha ? DataManager.sameFileMedia({ original: { sha256: sha } }) : undefined;
    return att && isPortraitCandidate(att) ? att : undefined;
}

/**
 * The person dialog's portrait from the editor, waiting for Save: the crop,
 * and the whole photo of a new file (an attachment on Save) or the origin it
 * was cut from in the tree.
 */
export interface PendingPortrait {
    photo: string;
    crop: PortraitCrop;
    original?: string;
    fileName?: string;
    origin?: PortraitOrigin;
    /** The new file itself and its identity, when the tree's research keeps its original (spec 108 K2.4). */
    file?: Blob;
    originalMeta?: MediaOriginal;
    /** A research's picture: it becomes the tree's file at the person on Save (1121). */
    link?: PortraitFileLink;
}

export { portraitCropOf };

/** The origin of a portrait's source (the attachment or the couple's photo it names). */
export function portraitOriginOf(source: PortraitSource): PortraitOrigin | null {
    if (source.attachmentId) return { attachmentId: source.attachmentId };
    if (source.partnershipId) return { partnershipId: source.partnershipId };
    return null;
}

/** The image an origin names, when it is still there and can be shown (not an original kept only by the research). */
export function portraitOriginImage(person: Pick<Person, 'id'>, origin: PortraitOrigin | null): string | null {
    if (!origin) return null;
    if ('attachmentId' in origin) {
        const att = DataManager.personMedia(person.id).find(a => a.id === origin.attachmentId);
        return att && !att.originalOnly && att.mimeType.startsWith('image/') && att.dataUrl ? att.dataUrl : null;
    }
    return DataManager.getPartnership(origin.partnershipId)?.photo || null;
}

/** The whole photo behind a person's portrait (the zoom's "Whole photo"), or null. */
export function portraitWholePhoto(person: Person): string | null {
    if (!person.photo || !person.photoSource) return null;
    return portraitOriginImage(person, portraitOriginOf(person.photoSource));
}

/** May this person's portrait be changed here (not read-only, not locked)? */
export function canEditPortrait(personId: PersonId): boolean {
    return !DataManager.isReadOnly() && !DataManager.isPersonLocked(personId);
}

/** A file picker of its own (the person page has no dialog's input): opened inside the click that asks for it. */
export function pickImageFile(onFile: (file: File) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.remove();
        if (file) onFile(file);
    }, { once: true });
    // Dropped with the next pick when the picker was cancelled (no change event then).
    document.querySelectorAll('input[data-portrait-pick]').forEach(el => el.remove());
    input.dataset.portraitPick = '';
    document.body.appendChild(input);
    input.click();
}

export const portraitActionsMethods = uiModule({
    /**
     * The original of a portrait's new file (spec 108 K2.4) to the research, as
     * the original of the person's attachment holding its whole photo — once
     * that attachment is in the tree.
     */
    async sendPortraitOriginal(personId: PersonId, original: MediaOriginal, file: Blob): Promise<void> {
        if (!DataManager.personMedia(personId).some(a => a.original?.sha256 === original.sha256)) return;
        const outcome = await this.queueOriginal(original, file, { personId });
        this.noteOriginalOutcome(outcome, file.size, { personId });
        this.renderAttachmentsList();
    },

    /**
     * The attachment the person's portrait is cut from as it stands now (the
     * Portrait tag): in the person's open dialog the portrait in its preview
     * (one from the editor waiting for Save names its own, a removed one
     * none), elsewhere the stored portrait's source.
     */
    portraitSourceAttachmentShown(person: Person): string | null {
        const dialog = document.getElementById('person-modal');
        if (this.currentId === person.id && dialog?.classList.contains('active')) {
            const preview = this.photoModel.value;
            if (!preview) return null;
            const pending = this.pendingPortraitFor(preview);
            if (pending) return pending.origin && 'attachmentId' in pending.origin ? pending.origin.attachmentId : null;
            if (preview !== person.photo) return null;
        }
        return person.photo ? person.photoSource?.attachmentId ?? null : null;
    },

    /**
     * Open the editor and write its portrait at once (the person page, the
     * materials outside the person dialog): one undo step, "Portrait
     * updated." or "Portrait of {n} replaced." with Undo. `origin`: the
     * attachment or the couple's photo the editor is opened on; a new file
     * becomes the person's attachment in the same step.
     */
    async editPortraitNow(personId: PersonId, input: Omit<PortraitEditorInput, 'steps'> & {
        initial?: PortraitCrop;
        origin?: PortraitOrigin;
        fileName?: string;
        /** The portrait being replaced (Current → New in the editor): another photo, not a recrop. */
        replace?: boolean;
        /** A research's picture: on Done it becomes the tree's file at the person in the same step (1121). */
        link?: PortraitFileLink;
    }): Promise<void> {
        const person = DataManager.getPerson(personId);
        if (!person || !canEditPortrait(personId)) return;
        let result: Awaited<ReturnType<typeof openPortraitEditor>>;
        try {
            result = await openPortraitEditor({
                source: input.source,
                squareOnly: input.squareOnly,
                onChooseAgain: input.onChooseAgain,
                steps: [{ person, ...(input.initial ? { initial: input.initial } : {}), ...(input.replace && person.photo ? { current: person.photo } : {}) }],
            });
        } catch (e) {
            console.error('Photo processing failed:', e);
            this.showAlert(strings.personModal.photoError, 'error');
            return;
        }
        const step = result?.steps[0];
        if (!result || !step) return;
        // The tree may have changed while the editor was open (another window, a sync).
        const now = DataManager.getPerson(personId);
        if (!now) {
            this.showToast(strings.portrait.personGone);
            return;
        }
        if (!canEditPortrait(personId)) return;
        // A new file's whole photo becomes the person's attachment; the file as it was is that attachment's
        // original, kept by a research that takes it (spec 108 K2.4).
        const file = !input.origin && !input.link && result.original && input.source instanceof Blob ? input.source : null;
        const original = file ? await this.preparePhotoOriginal(file, input.fileName || (file instanceof File ? file.name : '') || 'photo.jpg', 'portrait') : null;
        if (!DataManager.getPerson(personId) || !canEditPortrait(personId)) return;
        const replaced = !!input.replace && !!now.photo;
        const name = shownName(now);
        const toast = { text: replaced ? strings.portrait.replaced(name) : strings.portrait.updated };
        DataManager.runBatch(strings.undo.portrait(auditPersonName(now)), () => {
            let origin = input.origin ?? null;
            // A research's picture becomes the tree's file at the person only now (Cancel wrote nothing).
            if (input.link) origin = linkPortraitFile(personId, input.link);
            if (origin && !portraitOriginImage(now, origin)) origin = null;
            if (!origin && !input.link && result!.original) {
                const att = DataManager.addAttachment(personId, {
                    name: input.fileName || 'photo.jpg',
                    mimeType: 'image/jpeg',
                    dataUrl: result!.original,
                    sizeBytes: dataUrlByteSize(result!.original),
                    ...(original ? { original } : {}),
                });
                if (att) origin = { attachmentId: att.id };
            }
            DataManager.updatePerson(personId, {
                photo: step.photo,
                photoSource: origin && !input.squareOnly ? { ...origin, ...step.crop } : undefined,
            });
        }, toast);
        // The person's own portrait: one still on its way no longer comes over it (spec 116 I2).
        this.dropImageWait(personPhotoKey(personId));
        if (file && original) await this.sendPortraitOriginal(personId, original, file);
    },

    /**
     * "Edit portrait crop" (the person page's ⋯, spec 107 §2): over its
     * original when there is one, else within the finished square with
     * "Choose the photo again…" (a new file, then as §1).
     */
    editPersonPortrait(personId: PersonId): void {
        const person = DataManager.getPerson(personId);
        if (!person?.photo || !canEditPortrait(personId)) return;
        // Not over the older portrait while a newer one is on its way (spec 116 §4.3).
        if (imageLoads.isPending(personPhotoKey(personId))) {
            this.showToast(strings.photos.recropWait);
            return;
        }
        const origin = person.photoSource ? portraitOriginOf(person.photoSource) : null;
        const original = portraitOriginImage(person, origin);
        if (original && person.photoSource) {
            void this.editPortraitNow(personId, { source: original, initial: portraitCropOf(person.photoSource), origin: origin! });
            return;
        }
        void this.editPortraitNow(personId, {
            source: person.photo,
            squareOnly: true,
            onChooseAgain: () => pickImageFile(file => {
                void this.editPortraitNow(personId, { source: file, fileName: file.name, replace: true });
            }),
        });
    },

    /**
     * "As portrait…" / "Use as portrait…" (spec 107 §4): the editor over the
     * attachment; the portrait names it (no new attachment). From the open
     * person dialog of its owner the portrait waits for Save; elsewhere Done
     * writes at once, a person with a portrait seeing Current → New.
     */
    async useAttachmentAsPortrait(personId: PersonId, attachmentId: string, opts: { initial?: PortraitCrop } = {}): Promise<void> {
        const person = DataManager.getPerson(personId);
        if (!person || !canEditPortrait(personId)) return;
        const origin: PortraitOrigin = { attachmentId };
        const image = portraitOriginImage(person, origin);
        if (!image) return;
        const initial = opts.initial ? { initial: opts.initial } : {};
        const dialogOpen = this.currentId === personId && !!document.getElementById('person-modal')?.classList.contains('active');
        if (dialogOpen) {
            await this.portraitIntoPersonModal({ source: image, origin, replace: true, ...initial });
            return;
        }
        await this.editPortraitNow(personId, { source: image, origin, replace: true, ...initial });
    },

    /**
     * Who "Use as portrait…" on a material is for (null: not offered) and
     * whether it waits for the bridge: the person's own picture of the tree
     * as today; a research's picture that names the person (1121) — the
     * tree's copy when it has the file, else its working copy over the bridge
     * of a research that assigns (as Link to…).
     */
    materialPortraitOffer(item: MaterialItem, personId: PersonId | null, caps: MaterialCaps | null): { personId: PersonId; bridge: boolean } | null {
        const person = personId ? DataManager.getPerson(personId) : null;
        if (!person || !canEditPortrait(person.id) || item.tree) return null;
        const att = item.attachment;
        if (att && isPortraitCandidate(att) && DataManager.personMedia(person.id).some(a => a.id === att.id)) return { personId: person.id, bridge: false };
        const refn = researchPersonRef(person.refn);
        if (!isMaterialPortraitCandidate({ ...item, attachment: undefined }, refn)) return null;
        if (treePortraitCopy(item)) return { personId: person.id, bridge: false };
        return !att && caps?.assign ? { personId: person.id, bridge: true } : null;
    },

    /** The person's portrait is cut from this material's file already (Use as portrait… is not offered then). */
    materialPortraitShown(item: MaterialItem, personId: PersonId): boolean {
        const person = DataManager.getPerson(personId);
        const source = person ? this.portraitSourceAttachmentShown(person) : null;
        return !!source && source === (item.attachment?.id ?? treePortraitCopy(item)?.id);
    },

    /**
     * "Use as portrait…" on a material (1121): the person's own picture of
     * the tree as useAttachmentAsPortrait; a research's picture that names
     * them opens the editor over the tree's copy or its working copy from
     * the bridge, and only Done (or the dialog's Save) makes it the tree's
     * file at the person, in the portrait's undo step.
     */
    async useMaterialAsPortrait(personId: PersonId, item: MaterialItem, opts: { initial?: PortraitCrop } = {}): Promise<void> {
        const person = DataManager.getPerson(personId);
        if (!person || !canEditPortrait(personId)) return;
        const own = item.attachment && DataManager.personMedia(personId).some(a => a.id === item.attachment!.id) ? item.attachment : null;
        if (own) {
            await this.useAttachmentAsPortrait(personId, own.id, opts);
            return;
        }
        const copy = treePortraitCopy(item);
        let link: PortraitFileLink;
        if (copy) link = { id: copy.id };
        else {
            const mc = this.materialsContext();
            if (!mc?.caps.bridgeUp || !mc.base) {
                this.showToast(strings.materials.actionsWhenRunning);
                return;
            }
            const record = await this.materialWorkingCopy(item, mc);
            if (!record || !portraitLinkImage({ record })) {
                this.showAlert(strings.materials.attachFailed, 'error');
                return;
            }
            link = { record };
        }
        await this.useMaterialLink(personId, link, opts);
    },

    /**
     * The editor over a research's picture (the tree's copy or its working
     * copy): from the person's open dialog the portrait waits for Save, else
     * Done writes at once; the picture becomes the tree's file at the person
     * only then (1121).
     */
    async useMaterialLink(personId: PersonId, link: PortraitFileLink, opts: { initial?: PortraitCrop } = {}): Promise<void> {
        if (!DataManager.getPerson(personId) || !canEditPortrait(personId)) return;
        const image = portraitLinkImage(link);
        if (!image) return;
        const initial = opts.initial ? { initial: opts.initial } : {};
        const dialogOpen = this.currentId === personId && !!document.getElementById('person-modal')?.classList.contains('active');
        if (dialogOpen) await this.portraitIntoPersonModal({ source: image, link, replace: true, ...initial });
        else await this.editPortraitNow(personId, { source: image, link, replace: true, ...initial });
    },
});

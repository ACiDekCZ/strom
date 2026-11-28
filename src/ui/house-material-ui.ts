/**
 * Own research and material of a house (spec 030 §7): "Attach material…" (the ⋯ menu of a row and the open row's
 * detail) opens a dialog for files, a memory with who told it and the name after the farm; the memory and the name
 * go through `POST /houses/material` (feature `house.material`), the files the usual way of a batch
 * (`PUT media/<sha256>` + `POST batch/<id>/done` with `house`). "Take over research from a file…" opens the
 * research's terminal (`do=import`, `house.import`; not on a device of the home network). The detail lists the
 * house's materials of `GET /houses/<key>`.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { houseTitle, type TreeHouse } from '../houses.js';
import { formatPlaceDate } from '../place-identity.js';
import { fetchHouse, houseFeature, sendHouseMaterial, type HouseMaterial, type HouseMaterialBody, type HouseResearch, type HouseWriteResult } from '../house-bridge.js';
import { houseChatLink, houseImportLink, researchDeviceAllows, researchLinkMark } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import { researchActionLabel } from './research-open-mark.js';
import { showToast } from './toast.js';
import { uiModule } from './module.js';
import type { HouseMenuItem } from './houses-ui.js';

const MATERIAL_ID = 'house-material-modal';
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const IMAGE_RE = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/i;

/** What the dialog sends of its fields: the memory with its witness only with consent, the name when changed. */
export function houseMaterialRequest(house: string, f: { memory: string; witness: string; consent: boolean; name: string; nameWas: string }): HouseMaterialBody | null {
    const memory = f.memory.trim();
    const name = f.name.trim();
    const witness = f.witness.trim();
    const body: HouseMaterialBody = {
        house: house as HouseMaterialBody['house'],
        ...(memory ? { memory: { text: memory, ...(f.consent && witness ? { witness } : {}), witnessConsent: f.consent && !!witness } } : {}),
        ...(name && name !== f.nameWas.trim() ? { name } : {}),
    };
    return body.memory || body.name ? body : null;
}

/** The sentence of a refused write (the same as other bridge writes where they have one). */
export function houseMaterialError(r: Extract<HouseWriteResult, { ok: false }>, heldText: () => string): string {
    const s = strings.houses;
    const W = strings.live.waitingWrite;
    switch (r.code) {
        case 'town': return s.errTown;
        case 'archive': return s.errArchive;
        case 'invalid': return W.badBody;
        case 'held': return heldText();
        case 'locked': return W.locked;
        case 'busy': return W.busy;
        case 'full': return W.fileFull;
        case 'network': case 'timeout': return W.failed;
        default: return r.reason || W.writeFailed;
    }
}

/** One row of the house's materials: icon | title · date + its file or source | kind. */
export function houseMaterialRowHtml(m: HouseMaterial, lang: Parameters<typeof formatPlaceDate>[1]): string {
    const s = strings.houses;
    const date = formatPlaceDate(m.at, lang);
    const memory = m.kind === 'memory';
    const image = !memory && !!m.file && IMAGE_RE.test(m.file);
    const title = memory ? (m.title ? `${s.memoryTitle}: ${m.title}` : s.memoryTitle)
        : m.kind === 'own-research' ? s.ownResearch : (m.title || m.file || s.matKind.file);
    const sub = memory ? [s.familyMemory, m.witness ? s.witnessBy(m.witness) : s.witnessNone].join(' · ') : (m.file ?? '');
    const kind = memory ? s.matKind.text : image ? s.matKind.photo : s.matKind.file;
    const icon = memory ? '✎' : image ? '▣' : '▤';
    return `<div class="house-mat" data-material="${esc(m.id)}"><span class="ic" aria-hidden="true">${icon}</span>`
        + `<span class="t">${esc([title, date].filter(Boolean).join(' · '))}${sub ? `<span class="s">${esc(sub)}</span>` : ''}</span>`
        + `<span class="k">${esc(kind)}</span></div>`;
}

/** The houses' results read for their detail (materials, sensitive events): by key, with the list's rev they were read for. */
const detailRead = new Map<string, { rev: string; house: HouseResearch }>();
const detailLoading = new Set<string>();

const formatSize = (n: number, lang: string): string => n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toLocaleString(lang, { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(n / 1024)).toLocaleString(lang)} kB`;

export const houseMaterialMethods = uiModule({
    /**
     * The research's rows of a row's ⋯ menu: the house's action (houseActionOf, as in its detail: ask, move to the
     * top, ask again; any house of the tree), "Discuss with the agent" with `house.chat`, "Write the story of the house"
     * with `house.story` and "Attach material…" with
     * `house.material`. `opener`: the focus back.
     */
    houseMenuResearchItems(house: TreeHouse, opener?: HTMLElement | null): HouseMenuItem[] {
        const b = this.houseResearchBridge();
        if (!b) return [];
        const items: HouseMenuItem[] = [];
        const act = this.houseActionNow(house, 14);
        if (act) items.push({ key: `act-${act.action}`, label: '', html: act.html, run: () => this.runHouseAction(house, act.action, opener) });
        if (this.houseChatPossible()) items.push({ key: 'chat', label: '', html: this.houseChatLabel(), run: () => this.openHouseChat(house) });
        // spec 145 T4: the agent writes the house's story, through the bridge (the AI badge alone).
        if (this.houseStoryPossible()) {
            items.push({ key: 'story', label: '', html: this.houseStoryLabel(this.housePageResearch(house)), run: () => { void this.askHouseStory(house, opener); } });
        }
        if (houseFeature(b.features, 'house.material')) items.push({ key: 'attach', label: strings.houses.attach, run: () => this.showHouseMaterialDialog(house) });
        return items;
    },

    /**
     * The research's whole result of a house that has materials or events in the list (read once per list
     * rev, the row drawn again when it comes); null until read or without them.
     */
    houseResearchOf(house: TreeHouse): HouseResearch | null {
        const b = this.houseResearchBridge();
        const row = this.houseResearchRow(house);
        if (!b || !row || !(row.summary.materials || row.summary.events)) return null;
        const rev = this.houseStatesRev();
        const read = detailRead.get(row.key);
        if (read && read.rev === rev) return read.house;
        if (!detailLoading.has(row.key)) {
            detailLoading.add(row.key);
            void fetchHouse(b.base, row.key).then(r => {
                detailLoading.delete(row.key);
                if (!r.ok) return;
                detailRead.set(row.key, { rev, house: r.house });
                this.redrawHouseRow(house.id);
            });
        }
        return read?.house ?? null;
    },

    /** The research's result of a house read so far (no reading): what an output built now can use. */
    houseResearchRead(house: TreeHouse): HouseResearch | null {
        if (!this.houseResearchBridge()) return null;
        const row = this.houseResearchRow(house);
        return row ? detailRead.get(row.key)?.house ?? null : null;
    },

    /** The materials of a house the research lists with some. */
    houseMaterialsOf(house: TreeHouse): HouseMaterial[] | null {
        const row = this.houseResearchRow(house);
        if (!row?.summary.materials) return null;
        return this.houseResearchOf(house)?.materials ?? null;
    },

    /** The detail's materials and its two links ('' without the features). */
    renderHouseMaterialsHtml(house: TreeHouse): string {
        const b = this.houseResearchBridge();
        if (!b) return '';
        const s = strings.houses;
        const mats = this.houseMaterialsOf(house);
        const list = mats?.length ? `<h3 class="house-mats-h">${esc(s.materials)}</h3>`
            + `<div class="house-mats">${mats.map(m => houseMaterialRowHtml(m, getCurrentLanguage())).join('')}</div>` : '';
        const attach = houseFeature(b.features, 'house.material')
            ? `<button type="button" class="house-research-act house-attach">${esc(s.attach)}</button>` : '';
        const canImport = houseFeature(b.features, 'house.import') && researchDeviceAllows('house');
        const imp = canImport
            ? `<button type="button" class="house-research-act house-import">${researchActionLabel(s.import, researchLinkMark('house', { houseDo: 'import' }))}</button>` : '';
        const acts = attach || imp ? `<div class="house-research-acts">${attach}${imp}</div>` : '';
        const note = canImport ? `<p class="house-research-note">${esc(s.importNote)}</p>` : '';
        return list + acts + note;
    },

    /**
     * Spec 145 T2: "Discuss with the agent" — only when the research says `house.chat` (it has its agent) and not on a
     * device of the home network (like the house's other terminal links); a read-only tree keeps it as the research allows.
     */
    houseChatPossible(): boolean {
        const b = this.houseResearchBridge();
        return !!b && houseFeature(b.features, 'house.chat') && researchDeviceAllows('house');
    },

    /** The label of "Discuss with the agent" with its mark (AI + terminal). */
    houseChatLabel(): string {
        return researchActionLabel(strings.houses.discuss, researchLinkMark('house', { houseDo: 'chat' }), { size: 14 });
    },

    /** Opens the agent's chat about the house in the research's terminal (`do=chat`, the house by its key). */
    openHouseChat(house: TreeHouse, el?: HTMLElement | null): void {
        const b = this.houseResearchBridge();
        const url = b && this.houseChatPossible() ? houseChatLink(b.researchId, this.houseRequestKey(house), announcedResearchScheme()) : null;
        if (url) void this.launchResearchLink(url, 'terminal', el);
    },

    /** A click on the detail's links: true when handled. */
    houseMaterialClick(target: HTMLElement, house: TreeHouse): boolean {
        if (target.closest('.house-attach')) {
            this.showHouseMaterialDialog(house);
            return true;
        }
        const imp = target.closest<HTMLElement>('.house-import');
        if (imp) {
            const b = this.houseResearchBridge();
            const url = b ? houseImportLink(b.researchId, announcedResearchScheme()) : null;
            if (url) void this.launchResearchLink(url, 'terminal', imp);
            return true;
        }
        return false;
    },

    /**
     * Material attached to a house elsewhere (a batch of the house, Link to…; 1128): its materials read again
     * when drawn next, the research's list of houses asked anew (a new rev redraws the windows).
     */
    houseMaterialsChanged(key: string): void {
        detailRead.delete(key);
        void this.loadHouseStates();
        this.refreshHousesWindow();
    },

    /** The dialog "Attach material to the house". */
    showHouseMaterialDialog(house: TreeHouse): void {
        const b = this.houseResearchBridge();
        if (!b || !houseFeature(b.features, 'house.material')) return;
        const s = strings.houses;
        const lang = getCurrentLanguage();
        const row = this.houseResearchRow(house);
        const key = row?.key ?? house.id;
        const nameWas = row?.name ?? house.name ?? '';
        const withFiles = this.batchAvailable();
        const sub = [houseTitle(house), nameWas ? `(${nameWas})` : ''].filter(Boolean).join(' ');
        const overlay = this.openHouseSubDialog(MATERIAL_ID, s.attachTitle, sub, `
            ${withFiles ? `<div class="house-drop">
                <span>${esc(s.drop)}</span>
                <button type="button" class="secondary house-pick-files">${esc(s.pick)}</button>
                <input type="file" class="house-files-input" multiple accept="image/*,application/pdf,text/plain,text/markdown,.md,.txt" hidden>
            </div>
            <div class="house-files" hidden></div>
            <p class="house-files-note" hidden></p>` : ''}
            <label class="house-fld"><span class="lb">${esc(s.memory)}</span><textarea class="house-memory" rows="4" maxlength="20000"></textarea></label>
            <div class="house-row2">
                <label class="house-fld"><span class="lb">${esc(s.teller)}</span><input type="text" class="house-witness" maxlength="200"></label>
                <label class="house-fld"><span class="lb">${esc(s.farmName)}</span><input type="text" class="house-farm-name" maxlength="200" value="${esc(nameWas)}"></label>
            </div>
            <label class="house-consent"><input type="checkbox" class="house-witness-consent">
                <span>${esc(s.nameTeller)}<span class="sub">${esc(s.nameTellerHint)}</span></span></label>
            <p class="house-material-err" role="alert" hidden></p>`, s.attachGo);
        overlay.querySelector('.modal')?.classList.replace('modal--sm', 'modal--md');
        overlay.querySelector('.modal')?.classList.add('house-material-modal');
        const go = overlay.querySelector('.house-sub-go') as HTMLButtonElement;
        const err = overlay.querySelector('.house-material-err') as HTMLElement;
        const memory = overlay.querySelector('.house-memory') as HTMLTextAreaElement;
        const witness = overlay.querySelector('.house-witness') as HTMLInputElement;
        const consent = overlay.querySelector('.house-witness-consent') as HTMLInputElement;
        const farm = overlay.querySelector('.house-farm-name') as HTMLInputElement;
        const files: File[] = [];
        const fields = () => ({ memory: memory.value, witness: witness.value, consent: consent.checked, name: farm.value, nameWas });
        const update = (): void => {
            go.disabled = !files.length && !houseMaterialRequest(key, fields());
        };
        const renderFiles = (): void => {
            const box = overlay.querySelector('.house-files') as HTMLElement | null;
            if (!box) return;
            box.hidden = !files.length;
            const note = overlay.querySelector('.house-files-note') as HTMLElement | null;
            if (note) { note.hidden = !files.length; note.textContent = files.length ? s.attachFiles(files.length) : ''; }
            // With files the dialog goes on to the batch's wizard (spec 030 §7, question 10).
            go.textContent = files.length ? s.attachGoFiles : s.attachGo;
            box.innerHTML = files.map((f, i) => `<div class="house-file"><span class="ic" aria-hidden="true">${f.type.startsWith('image/') ? '▣' : '▤'}</span>`
                + `<span class="n">${esc(f.name)}</span><span class="z">${esc(formatSize(f.size, lang))}</span>`
                + `<button type="button" class="house-file-x" data-i="${i}" aria-label="${esc(s.removeFile(f.name))}">×</button></div>`).join('');
            update();
        };
        const addFiles = (list: FileList | null): void => {
            for (const f of Array.from(list ?? [])) files.push(f);
            renderFiles();
        };
        const input = overlay.querySelector('.house-files-input') as HTMLInputElement | null;
        (overlay.querySelector('.house-pick-files') as HTMLButtonElement | null)?.addEventListener('click', () => input?.click());
        input?.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
        const drop = overlay.querySelector('.house-drop') as HTMLElement | null;
        drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
        drop?.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop?.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); addFiles(e.dataTransfer?.files ?? null); });
        overlay.querySelector('.house-files')?.addEventListener('click', (e) => {
            const x = (e.target as HTMLElement).closest<HTMLElement>('.house-file-x');
            if (!x) return;
            files.splice(Number(x.dataset.i), 1);
            renderFiles();
        });
        for (const el of [memory, witness, farm, consent]) el.addEventListener('input', update);
        consent.addEventListener('change', update);
        update();
        go.onclick = async () => {
            const body = houseMaterialRequest(key, fields());
            if (!body && !files.length) { err.textContent = s.attachEmpty; err.hidden = false; return; }
            go.disabled = true;
            err.hidden = true;
            if (body) {
                const r = await sendHouseMaterial(b.base, body, b.features);
                if (!r.ok) {
                    err.textContent = houseMaterialError(r, () => this.researchWriteHeldText(r.held!, false).toast);
                    err.hidden = false;
                    go.disabled = false;
                    return;
                }
                detailRead.delete(key);
            }
            this.closeHouseSubDialog(MATERIAL_ID);
            if (files.length) {
                // The files the usual way: a batch of the house (spec 030 §7, `batch/<id>/done` with `house`).
                this.showBatchDialog({ files: files.map(file => ({ file, path: file.name })), house: key, houseTitle: houseTitle(house) });
                if (body) showToast(s.attached);
            } else {
                showToast(s.attached);
            }
            void this.loadHouseStates();
            this.redrawHouseRow(house.id);
        };
        memory.focus();
    },
});

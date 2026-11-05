/**
 * "Add images" at an item waiting for images of a book (spec 048 §3): files
 * dropped here or chosen, each given its image number (by its name, in order
 * to the missing ones when as many, by hand), checked before anything goes
 * (kind, size), then sent one by one through the bridge with their progress;
 * what the bridge refuses is said at the file (saved already: Replace or Keep
 * the saved one; a number it does not ask for; no room; busy) while the
 * others go on. One component for the Research overview's detail and the
 * small panel's dialog; the node outlives a host's redraw (keep the
 * instance, append its `root` again), the files stay until it is let go.
 */

import { strings } from '../strings.js';
import type { WaitingInbox } from '../research-link.js';
import { ImageAssignment, ImagesAssigned, TASK_IMAGE_ACCEPT, assignImages, fileExt, imageRanges, imageSlotOptions } from '../research-waiting.js';
import type { TaskImageResult } from '../research-waiting-write.js';

/** The numbers the task asks for (null: not known — files go without one) and those saved already. */
export interface UploadNumbers {
    want: number[] | null;
    have: number[];
}

/** How the files went once none is left to send or decide. */
export interface UploadOutcome {
    /** The task got its last image and is back in the queue. */
    woken: boolean;
    /** The task no longer waits (gone meanwhile): nothing more to send. */
    gone: boolean;
    /** The task's images as the last answer said (null: not said). */
    inbox: WaitingInbox | null;
    /** Files saved now. */
    saved: number;
    /** Files not added, each with why ("scan.jpg: Same as image 9 (M0123) – not added."); the area closes, so the host says them. */
    notes: string[];
}

export interface WaitingImagesUploadOptions {
    /** Unique per place it is drawn in (ids of its parts). */
    idPrefix: string;
    /** The research's limit per file (`accepts.media.max`). */
    maxBytes: number;
    /** The task's numbers as the research says them now (asked at every drawing). */
    numbers: () => UploadNumbers;
    /** One file through the bridge (its number, Replace, its progress). */
    upload: (file: File, opts: { image: number | null; replace: boolean; onProgress: (sent: number, total: number) => void }) => Promise<TaskImageResult>;
    /** Every file went (or the task woke, or is gone): the host closes the area and says how it went. */
    done: (outcome: UploadOutcome) => void;
    /** Cancel: the host closes the area (nothing more is sent). */
    cancel: () => void;
    /** Narrow (the panel's dialog): a file's number under its name. */
    narrow?: boolean;
}

type FileState =
    /** Before sending: in the list, given its number. */
    | 'ready'
    /** Waiting for its turn, and going. */
    | 'queued' | 'sending'
    | 'saved'
    /** Refused by the bridge: saved already (Replace?), a number not asked for, a number not told. */
    | 'exists' | 'unwanted' | 'unknown'
    /** Not saved for now: no room, busy, no answer (Try again). */
    | 'space' | 'busy' | 'fail'
    /** Not sent at all: kept the saved one; too large or a kind not taken (said by the bridge). */
    | 'kept' | 'size' | 'format' | 'pdf'
    /** Not added: the same file as another image taken already. */
    | 'same';

interface UpFile {
    id: number;
    file: File;
    /** A number chosen by hand (or Replace said yes to it); null: cleared by hand; undefined: found by itself. */
    chosen?: number | null;
    state: FileState;
    /** The number it goes as once sending began (null: none — the research tells it). */
    num: number | null;
    replace: boolean;
    sent: number;
    /** What the bridge said: the numbers it asks for (`unwanted`), still missing (`unknown`); its own sentence. */
    want?: number[];
    missing?: number[];
    said?: string;
    /** The numbers it was saved as. */
    savedAs?: number[];
    /** `saved`: the bridge had this very file under that number already (200 `same: true`). */
    already?: boolean;
    /** `same`: the image it is the same as (its number, the research's id). */
    sameImage?: number;
    sameId?: string;
}

/** Files that wait for a choice before anything more goes. */
const DECIDE: readonly FileState[] = ['exists', 'unwanted', 'unknown', 'space', 'busy', 'fail'];

const MB = 1024 * 1024;
/** Megabytes as said: one decimal under 10 MB, whole above. */
function mb(bytes: number): number {
    const v = bytes / MB;
    return v >= 10 ? Math.round(v) : Math.max(0.1, Math.round(v * 10) / 10);
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

export class WaitingImagesUpload {
    readonly root: HTMLElement;
    private readonly opts: WaitingImagesUploadOptions;
    private readonly input: HTMLInputElement;
    private files: UpFile[] = [];
    private phase: 'pick' | 'assign' | 'sending' = 'pick';
    private nextId = 1;
    private running = false;
    private woken = false;
    private gone = false;
    private lastInbox: WaitingInbox | null = null;
    private over = false;
    private frame = 0;
    private finished = false;

    constructor(opts: WaitingImagesUploadOptions) {
        this.opts = opts;
        this.root = node('div', 'waiting-upload');
        this.root.dataset.uploadId = opts.idPrefix;
        if (opts.narrow) this.root.classList.add('is-narrow');
        this.input = node('input', 'waiting-upload__input');
        this.input.type = 'file';
        this.input.multiple = true;
        this.input.accept = TASK_IMAGE_ACCEPT;
        this.input.hidden = true;
        this.input.tabIndex = -1;
        this.input.addEventListener('change', () => {
            const list = [...(this.input.files ?? [])];
            this.input.value = '';
            if (list.length > 0) this.addFiles(list);
        });
        // The whole area takes dropped files (the drop zone lights while they are over it).
        this.root.addEventListener('dragover', (e) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files') || this.phase === 'sending') return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!this.over) {
                this.over = true;
                this.root.classList.add('is-over');
            }
        });
        this.root.addEventListener('dragleave', (e) => {
            if (e.relatedTarget instanceof Node && this.root.contains(e.relatedTarget)) return;
            this.over = false;
            this.root.classList.remove('is-over');
        });
        this.root.addEventListener('drop', (e) => {
            if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files') || this.phase === 'sending') return;
            e.preventDefault();
            e.stopPropagation();
            this.over = false;
            this.root.classList.remove('is-over');
            const list = [...e.dataTransfer.files];
            if (list.length > 0) this.addFiles(list);
        });
        this.render();
    }

    /** Files are being sent (the area is not let go meanwhile). */
    get sending(): boolean {
        return this.running;
    }

    /** It has files the person chose (kept while the area is closed). */
    get hasFiles(): boolean {
        return this.files.length > 0;
    }

    /** The system's file chooser. */
    pick(): void {
        this.input.click();
    }

    /** The first thing to use: the file chooser's button, else Send. */
    focus(): void {
        const target = this.root.querySelector<HTMLElement>('.waiting-upload__choose, .waiting-upload__send');
        target?.focus({ preventScroll: true });
    }

    /** Files dropped or chosen: added to the list, every number found again. */
    addFiles(list: readonly File[]): void {
        if (this.phase === 'sending' || this.finished) return;
        for (const file of list) this.files.push({ id: this.nextId++, file, state: 'ready', num: null, replace: false, sent: 0 });
        this.phase = 'assign';
        this.render();
    }

    /** Drawn again (the task's numbers may have changed). */
    refresh(): void {
        this.render();
    }

    // ==================== ASSIGNING ====================

    private assigned(): ImagesAssigned {
        const { want, have } = this.opts.numbers();
        const ready = this.files.filter(f => f.state === 'ready');
        const out = assignImages(ready.map(f => f.file), want, have, {
            chosen: ready.map(f => typeof f.chosen === 'number' ? f.chosen : undefined),
            maxBytes: this.opts.maxBytes,
        });
        // A number cleared by hand stays cleared (nothing found for it by itself).
        ready.forEach((f, i) => {
            const a = out.files[i];
            if (f.chosen === null && !a.problem && want) {
                a.num = null;
                a.how = null;
                a.replace = 'no';
            }
        });
        const valid = out.files.filter(a => !a.problem);
        return {
            files: out.files,
            needAssign: valid.filter(a => a.how === null).length,
            needDecide: valid.filter(a => a.replace === 'ask').length,
            sendable: valid.length,
        };
    }

    private remove(id: number): void {
        this.files = this.files.filter(f => f.id !== id);
        if (this.files.length === 0 && this.phase === 'assign') this.phase = 'pick';
        this.render();
        if (this.phase === 'sending') this.settle();
    }

    // ==================== SENDING ====================

    private send(): void {
        const a = this.assigned();
        if (a.sendable === 0 || a.needAssign > 0 || a.needDecide > 0) return;
        const ready = this.files.filter(f => f.state === 'ready');
        const keep: UpFile[] = [];
        ready.forEach((f, i) => {
            const x = a.files[i];
            if (x.problem) return;
            f.num = x.num;
            f.replace = x.replace === 'yes';
            f.state = 'queued';
            f.sent = 0;
            keep.push(f);
        });
        // What could not go (checked before) stays out of the sending list.
        this.files = keep;
        this.phase = 'sending';
        this.render();
        void this.run();
    }

    private async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            for (;;) {
                if (this.woken || this.gone) break;
                const f = this.files.find(x => x.state === 'queued');
                if (!f) break;
                f.state = 'sending';
                f.sent = 0;
                this.render();
                const result = await this.opts.upload(f.file, {
                    image: f.num,
                    replace: f.replace,
                    onProgress: (sent) => {
                        f.sent = sent;
                        this.renderSoon();
                    },
                });
                this.take(f, result);
                // A PDF the research could not place: again with the first number still missing.
                if ((f.state as FileState) === 'unknown' && f.num === null && fileExt(f.file.name) === 'pdf' && f.missing && f.missing.length > 0) {
                    f.num = f.missing[0];
                    f.state = 'queued';
                }
                this.render();
            }
        } finally {
            this.running = false;
        }
        this.settle();
    }

    private take(f: UpFile, r: TaskImageResult): void {
        f.said = undefined;
        if (r.ok) {
            f.state = 'saved';
            f.sent = f.file.size;
            f.savedAs = r.images.length ? r.images : r.image !== null ? [r.image] : f.num !== null ? [f.num] : [];
            f.already = r.same;
            if (r.inbox) this.lastInbox = r.inbox;
            if (r.woken) this.woken = true;
            return;
        }
        switch (r.code) {
            case 'image-exists':
                f.state = 'exists';
                if (r.image) f.num = r.image;
                return;
            case 'image-unwanted':
                f.state = 'unwanted';
                f.want = r.want ?? this.opts.numbers().want ?? [];
                f.num = null;
                return;
            case 'image-unknown':
                f.state = 'unknown';
                f.missing = r.missing ?? [];
                return;
            // Nothing taken, nothing to decide: the others go on.
            case 'image-same':
                f.state = 'same';
                f.sameImage = r.sameImage;
                f.sameId = r.same;
                return;
            case 'too-large': f.state = 'size'; return;
            case 'type': f.state = 'format'; return;
            case 'pdf': f.state = 'pdf'; return;
            case 'full': f.state = 'space'; return;
            case 'busy': case 'locked': f.state = 'busy'; return;
            // The task no longer waits for images: nothing more goes.
            case 'none': case 'no-images': case 'no-file':
                f.state = 'fail';
                this.gone = true;
                return;
            case 'held':
                f.state = 'fail';
                f.said = r.held?.said || undefined;
                return;
            default: f.state = 'fail';
        }
    }

    /** Again: a refused file with its number (and Replace when said). */
    private again(f: UpFile, num: number | null, replace: boolean): void {
        f.num = num;
        f.replace = replace;
        f.state = 'queued';
        f.sent = 0;
        this.render();
        void this.run();
    }

    /** Nothing left to send or decide: the host is told. */
    private settle(): void {
        if (this.running || this.finished) return;
        const open = this.files.some(f => f.state === 'queued' || f.state === 'sending' || (!this.woken && !this.gone && DECIDE.includes(f.state)));
        if (open && !this.woken && !this.gone) return;
        this.finished = true;
        this.opts.done({ woken: this.woken, gone: this.gone && !this.woken, inbox: this.lastInbox, saved: this.files.filter(f => f.state === 'saved').length, notes: this.notes() });
    }

    /**
     * What the host says of the files not added (the same as an image taken
     * already) and of those the research had under that number already: the
     * area closes when the batch is done, so their sentence goes on there.
     */
    private notes(): string[] {
        const T = strings.live.waitingTask;
        return this.files.flatMap(f => f.state === 'same' ? [`${f.file.name}: ${T.sameAs(f.sameImage ?? null, f.sameId ?? '')}`]
            : f.state === 'saved' && f.already ? [`${f.file.name}: ${this.alreadyText(f)}`] : []);
    }

    /** "Already saved as image 57." (the numbers the bridge said, else none). */
    private alreadyText(f: UpFile): string {
        const nums = f.savedAs ?? [];
        return strings.live.waitingTask.alreadySaved(nums.length ? imageRanges(nums) : null, nums.length);
    }

    /** Cancel: nothing more goes; what was saved stays saved. */
    private close(): void {
        if (this.running) return;
        const saved = this.files.filter(f => f.state === 'saved').length;
        if (saved > 0 && !this.finished) {
            this.finished = true;
            this.opts.done({ woken: this.woken, gone: false, inbox: this.lastInbox, saved, notes: this.notes() });
            return;
        }
        this.opts.cancel();
    }

    // ==================== DRAWING ====================

    private renderSoon(): void {
        if (this.frame) return;
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
        this.frame = raf(() => {
            this.frame = 0;
            this.render();
        }) as unknown as number;
    }

    private render(): void {
        const T = strings.live.waitingTask;
        // The control in use keeps its focus over the redraw.
        const active = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)
            ? document.activeElement.dataset.fk ?? null : null;
        this.root.replaceChildren(this.input);
        this.root.classList.toggle('is-sending', this.phase === 'sending');
        const maxMb = Math.round(this.opts.maxBytes / MB);
        if (this.phase === 'pick') {
            const zone = node('div', 'waiting-upload__drop');
            zone.appendChild(node('span', 'waiting-upload__drop-text', T.dropHere));
            const choose = this.button('waiting-action waiting-action--secondary waiting-upload__choose', T.chooseFiles, 'choose', () => this.pick());
            zone.appendChild(choose);
            zone.appendChild(node('span', 'waiting-upload__formats', T.formats(maxMb)));
            const row = node('div', 'waiting-upload__foot');
            row.appendChild(this.button('waiting-action waiting-action--link waiting-upload__cancel', T.cancel, 'cancel', () => this.close()));
            this.root.append(zone, row);
        } else if (this.phase === 'assign') {
            this.renderAssign();
        } else {
            this.renderSending();
        }
        if (active) this.root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
    }

    private renderAssign(): void {
        const T = strings.live.waitingTask;
        const { want, have } = this.opts.numbers();
        const a = this.assigned();
        const list = node('ul', 'waiting-upload__files');
        const ready = this.files.filter(f => f.state === 'ready');
        ready.forEach((f, i) => list.appendChild(this.assignRow(f, a.files[i], a, want, have)));
        this.root.appendChild(list);
        this.root.appendChild(this.button('waiting-action waiting-action--link waiting-upload__more', T.addMore, 'more', () => this.pick()));
        const foot = node('div', 'waiting-upload__foot');
        const ok = a.sendable > 0 && a.needAssign === 0 && a.needDecide === 0;
        const send = this.button('waiting-action waiting-action--primary waiting-upload__send', T.sendImages(a.sendable), 'send', () => this.send());
        send.setAttribute('aria-disabled', String(!ok));
        foot.appendChild(send);
        foot.appendChild(this.button('waiting-action waiting-action--link waiting-upload__cancel', T.cancel, 'cancel', () => this.close()));
        if (a.needAssign > 0 || a.needDecide > 0) {
            const warn = node('span', 'waiting-upload__warn', a.needAssign > 0 ? T.needAssign(a.needAssign) : T.needDecide(a.needDecide));
            warn.id = `${this.opts.idPrefix}-warn`;
            send.setAttribute('aria-describedby', warn.id);
            foot.appendChild(warn);
        }
        this.root.appendChild(foot);
    }

    /** A file before sending: its kind, name and size, its number (a choice), why, and × Remove. */
    private assignRow(f: UpFile, x: ImageAssignment, all: ImagesAssigned, want: number[] | null, have: number[]): HTMLElement {
        const T = strings.live.waitingTask;
        const li = this.fileShell(f);
        const side = node('div', 'waiting-upload__side');
        const ext = fileExt(f.file.name).toUpperCase() || '?';
        if (x.problem) {
            li.classList.add('is-invalid');
        } else if (want) {
            const box = node('div', 'waiting-upload__pickbox');
            const sel = node('select', 'waiting-upload__num');
            sel.dataset.fk = `num-${f.id}`;
            sel.setAttribute('aria-label', `${f.file.name}: ${T.pickNum.replace(/^[—\s-]+|[—\s-]+$/g, '')}`);
            if (x.num === null) sel.classList.add('is-missing');
            const empty = node('option', '', x.how === 'pdf' ? T.noNumber : T.pickNum);
            empty.value = '';
            sel.appendChild(empty);
            for (const o of imageSlotOptions(all, x.index, want, have)) {
                const label = [T.assignTo(o.n), ...(o.saved ? [T.willReplace] : []), ...(o.takenBy !== undefined ? [T.takenOther] : [])].join(' · ');
                const opt = node('option', '', label);
                opt.value = String(o.n);
                opt.disabled = o.takenBy !== undefined;
                sel.appendChild(opt);
            }
            sel.value = x.num !== null ? String(x.num) : '';
            sel.onchange = () => {
                f.chosen = sel.value ? Number(sel.value) : null;
                this.render();
            };
            box.appendChild(sel);
            const how = x.how === 'name' ? T.byName : x.how === 'order' ? T.inOrder : x.how === 'pdf' ? T.pdfPages : '';
            if (how) box.appendChild(node('span', 'waiting-upload__how', how));
            side.appendChild(box);
        } else {
            side.appendChild(node('span', 'waiting-upload__fixed', T.noNumber));
        }
        side.appendChild(this.removeButton(f));
        li.appendChild(side);
        if (x.problem === 'format') li.appendChild(this.message(T.badFormat(ext), 'error'));
        else if (x.problem === 'size') li.appendChild(this.message(T.tooBig(mb(f.file.size), Math.round(this.opts.maxBytes / MB)), 'error'));
        else if (x.num === null && x.unwanted && x.nameNum !== null && want) {
            li.appendChild(this.message(`${T.nameHas(x.nameNum)} ${T.unwanted(imageRanges(want), want.length)}`, 'warn'));
        } else if (x.replace === 'ask' && x.num !== null) {
            li.appendChild(this.ask(T.replaceAsk(x.num), () => { f.chosen = x.num; this.render(); }, () => this.remove(f.id), f.id));
        } else if (x.replace === 'yes' && x.num !== null) {
            li.appendChild(this.message(T.replacing(x.num), 'muted'));
        }
        return li;
    }

    private renderSending(): void {
        const T = strings.live.waitingTask;
        const list = node('ul', 'waiting-upload__files');
        for (const f of this.files) list.appendChild(this.sendingRow(f));
        this.root.appendChild(list);
        const going = this.files.filter(f => f.state === 'queued' || f.state === 'sending').length;
        if (going > 0) {
            const line = node('p', 'waiting-upload__line', T.sendingN(going));
            line.setAttribute('role', 'status');
            this.root.appendChild(line);
        } else if (!this.finished) {
            // Something waits for a choice: the area can be closed meanwhile (what was saved stays).
            const foot = node('div', 'waiting-upload__foot');
            foot.appendChild(this.button('waiting-action waiting-action--link waiting-upload__cancel', T.cancel, 'cancel', () => this.close()));
            this.root.appendChild(foot);
        }
    }

    /** A file while and after it goes: its number, the progress, what the bridge said and what can be done. */
    private sendingRow(f: UpFile): HTMLElement {
        const T = strings.live.waitingTask;
        const li = this.fileShell(f);
        const side = node('div', 'waiting-upload__side');
        const numText = f.num !== null ? T.assignTo(f.num) : T.noNumber;
        const choosing = f.state === 'unwanted' || (f.state === 'unknown' && !!f.missing?.length);
        if (!choosing && f.state !== 'kept') {
            const fixed = node('span', 'waiting-upload__fixed', numText);
            if (f.state === 'saved') fixed.classList.add('is-saved');
            side.appendChild(fixed);
        }
        li.appendChild(side);
        if (f.state === 'queued' || f.state === 'sending') {
            const prog = node('div', 'waiting-upload__progress');
            const bar = node('div', 'waiting-upload__bar');
            const total = f.file.size || 1;
            const pct = Math.max(0, Math.min(100, Math.round(f.sent / total * 100)));
            bar.setAttribute('role', 'progressbar');
            bar.setAttribute('aria-valuemin', '0');
            bar.setAttribute('aria-valuemax', '100');
            bar.setAttribute('aria-valuenow', String(pct));
            bar.setAttribute('aria-label', f.file.name);
            const fill = node('span', 'waiting-upload__fill');
            fill.style.width = `${pct}%`;
            bar.appendChild(fill);
            prog.append(bar, node('span', 'waiting-upload__progress-text', T.sendingProgress(Math.floor(f.sent / MB), mb(f.file.size))));
            li.appendChild(prog);
            return li;
        }
        switch (f.state) {
            case 'saved': {
                const nums = f.savedAs ?? [];
                if (f.already) {
                    li.appendChild(this.message(this.alreadyText(f), 'muted'));
                    break;
                }
                li.appendChild(this.message(nums.length === 1 ? T.savedAs(nums[0]) : nums.length > 1 ? T.savedAs(nums[0]).replace(String(nums[0]), imageRanges(nums)) : T.savedNoNum, 'ok'));
                break;
            }
            case 'exists':
                li.appendChild(this.ask(T.replaceAsk(f.num ?? 0), () => this.again(f, f.num, true), () => {
                    f.state = 'kept';
                    this.render();
                    this.settle();
                }, f.id));
                break;
            case 'kept':
                li.appendChild(this.message(T.keptOld(f.num ?? 0), 'muted'));
                break;
            case 'same':
                li.appendChild(this.message(T.sameAs(f.sameImage ?? null, f.sameId ?? ''), 'warn'));
                break;
            case 'unwanted':
            case 'unknown': {
                const nums = f.state === 'unwanted' ? f.want ?? [] : f.missing ?? [];
                li.appendChild(this.message(f.state === 'unwanted' ? T.unwanted(imageRanges(nums), nums.length) : T.imageUnknown(imageRanges(nums), nums.length), 'warn'));
                if (nums.length > 0) li.appendChild(this.renumber(f, nums));
                break;
            }
            case 'space':
                li.appendChild(this.message(T.noSpace, 'error'));
                li.appendChild(this.retry(f));
                break;
            case 'busy':
                li.appendChild(this.message(T.imagesBusy, 'error'));
                li.appendChild(this.retry(f));
                break;
            case 'fail':
                li.appendChild(this.message(f.said ?? T.imagesFail, 'error'));
                if (!this.gone) li.appendChild(this.retry(f));
                break;
            case 'size':
                li.classList.add('is-invalid');
                li.appendChild(this.message(T.tooBig(mb(f.file.size), Math.round(this.opts.maxBytes / MB)), 'error'));
                break;
            case 'format':
                li.classList.add('is-invalid');
                li.appendChild(this.message(T.badFormat(fileExt(f.file.name).toUpperCase() || '?'), 'error'));
                break;
            case 'pdf':
                li.classList.add('is-invalid');
                li.appendChild(this.message(T.pdfUnreadable, 'error'));
                break;
        }
        return li;
    }

    /** A refused number: another chosen from those the task asks for, and sent again. */
    private renumber(f: UpFile, nums: readonly number[]): HTMLElement {
        const T = strings.live.waitingTask;
        const { have } = this.opts.numbers();
        const box = node('div', 'waiting-upload__again');
        const sel = node('select', 'waiting-upload__num is-missing');
        sel.dataset.fk = `again-${f.id}`;
        sel.setAttribute('aria-label', `${f.file.name}: ${T.pickNum.replace(/^[—\s-]+|[—\s-]+$/g, '')}`);
        const empty = node('option', '', T.pickNum);
        empty.value = '';
        sel.appendChild(empty);
        const taken = new Set(this.files.filter(x => x !== f && x.state === 'saved' && x.num !== null).map(x => x.num));
        for (const n of nums) {
            const label = [T.assignTo(n), ...(have.includes(n) ? [T.willReplace] : []), ...(taken.has(n) ? [T.takenOther] : [])].join(' · ');
            const opt = node('option', '', label);
            opt.value = String(n);
            opt.disabled = taken.has(n);
            sel.appendChild(opt);
        }
        const go = this.button('waiting-action waiting-action--link waiting-upload__retry', T.retry, `go-${f.id}`, () => {
            if (!sel.value) return;
            const n = Number(sel.value);
            this.again(f, n, have.includes(n));
        });
        go.setAttribute('aria-disabled', 'true');
        sel.onchange = () => go.setAttribute('aria-disabled', String(!sel.value));
        box.append(sel, go, this.removeButton(f));
        return box;
    }

    private retry(f: UpFile): HTMLElement {
        return this.button('waiting-action waiting-action--link waiting-upload__retry', strings.live.waitingTask.retry, `retry-${f.id}`, () => this.again(f, f.num, f.replace));
    }

    private fileShell(f: UpFile): HTMLElement {
        const li = node('li', 'waiting-upload__file');
        li.dataset.file = f.file.name;
        li.dataset.state = f.state;
        const ext = fileExt(f.file.name).toUpperCase() || '?';
        const badge = node('span', 'waiting-upload__ext', ext.slice(0, 4));
        badge.setAttribute('aria-hidden', 'true');
        const main = node('div', 'waiting-upload__main');
        main.append(node('span', 'waiting-upload__name', f.file.name), node('span', 'waiting-upload__size', `${mb(f.file.size)} MB`));
        li.append(badge, main);
        return li;
    }

    private message(text: string, tone: 'error' | 'warn' | 'muted' | 'ok'): HTMLElement {
        const p = node('p', `waiting-upload__msg is-${tone}`, text);
        if (tone === 'error' || tone === 'warn') p.setAttribute('role', 'alert');
        return p;
    }

    /** The ochre question at a file: saved already, replace it or keep the saved one. */
    private ask(text: string, yes: () => void, no: () => void, id: number): HTMLElement {
        const T = strings.live.waitingTask;
        const box = node('div', 'waiting-upload__ask');
        box.setAttribute('role', 'group');
        box.appendChild(node('span', 'waiting-upload__ask-text', text));
        box.appendChild(this.button('waiting-upload__replace', T.replace, `yes-${id}`, yes));
        box.appendChild(this.button('waiting-upload__keep', T.keepOld, `no-${id}`, no));
        return box;
    }

    private removeButton(f: UpFile): HTMLElement {
        const T = strings.live.waitingTask;
        const rm = this.button('waiting-upload__remove', '×', `rm-${f.id}`, () => this.remove(f.id));
        rm.title = T.remove;
        rm.setAttribute('aria-label', `${T.remove}: ${f.file.name}`);
        return rm;
    }

    private button(cls: string, text: string, fk: string, run: () => void): HTMLButtonElement {
        const b = node('button', cls, text);
        b.type = 'button';
        b.dataset.fk = fk;
        b.onclick = (e) => {
            e.stopPropagation();
            if (b.getAttribute('aria-disabled') === 'true') return;
            run();
        };
        return b;
    }
}

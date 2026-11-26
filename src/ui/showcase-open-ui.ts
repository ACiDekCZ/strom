/**
 * Opening the showcase (spec 143 §2, §3): from `?demo=<lang>` (downloaded
 * from the same origin, its progress in the long action's toast, Cancel),
 * and the steps any showcase file goes through (openShowcaseFile, also for
 * a file opened or dropped): its header checked, a showcase opened before
 * only switched to, else its tree made — the research's GEDCOM as a
 * research's file opens, marked a sample, tied to its research only to be
 * read (nothing is ever sent from it). A newer showcase on the web is
 * offered once per version and kept in its row's ⋯ menu in Manage trees.
 * What did not work is said in one dialog with the small sample (the Berg
 * family) as its way out; the open tree never changes then.
 *
 * A showcase file opened or dropped (§4) is told by its header and goes the
 * same steps, said in the "Opening the sample" toast. A standalone file
 * (embedded mode) never downloads: it links to the file on the web and
 * opens a downloaded one.
 *
 * Nothing here talks to a research or its bridge: the tree's research tie
 * has no bridge address, sends nothing (`sendMode: 'off'`), and the file's
 * links of the research are never noted as handled by this computer.
 */

import { strings, getCurrentLanguage } from '../strings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { SettingsManager } from '../settings.js';
import type { StromData, TreeId } from '../types.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { contentFingerprint, readResearchHeader, sanitizeLiveStatus, type ResearchHeader } from '../research-link.js';
import { stampResearchTree } from '../person-lists-data.js';
import { stripMedia } from '../attachments.js';
import { startupPerson } from '../default-person.js';
import { LAST_FOCUSED } from '../model-values.js';
import { sampleMarkOf, type ShowcaseFile, type ShowcaseLang } from '../showcase-format.js';
import {
    downloadShowcase, fetchShowcaseVersion, formatShowcaseMb, isQuotaError, newerShowcaseVersion, readShowcaseText, readShowcaseValue,
    SHOWCASE_DOWNLOAD_BYTES, showcaseExportId, showcaseFileUrl, showcaseLangParam, showcaseOfferedKey, showcasePercent,
    showcaseRoomNeeded, showcaseWebFileUrl, type ShowcaseDownloadDeps, type ShowcaseErrorKind, type ShowcaseProgress,
} from '../showcase-download.js';
import { formatTreeSize } from '../format.js';
import { runTreeSwitch } from './tree-switch-busy.js';
import { activatedElement } from './busy.js';
import { showProgressToast, type ProgressStep } from './toast.js';
import { setMirroredResearchStatus } from './research-sync-ui.js';
import { uiModule } from './module.js';

/** How long the offer of a newer showcase stands (it has two actions to read). */
const OFFER_MS = 15_000;

/** One showcase download or opening at a time (a second link or click meanwhile does nothing). */
let busy = false;

/** The newest version the web said this session, per language (the Manage trees row's update). */
const knownVersions = new Map<ShowcaseLang, string>();

/** A test's own network (null: the browser's). */
let testDeps: ShowcaseDownloadDeps | null = null;

/** For unit tests: the network the downloads use (null: the browser's). */
export function setShowcaseDepsForTest(deps: ShowcaseDownloadDeps | null): void {
    testDeps = deps;
    knownVersions.clear();
    busy = false;
}

function offeredVersion(lang: ShowcaseLang): string | null {
    try {
        return localStorage.getItem(showcaseOfferedKey(lang));
    } catch {
        return null;
    }
}

function noteOffered(lang: ShowcaseLang, version: string): void {
    try {
        localStorage.setItem(showcaseOfferedKey(lang), version);
    } catch { /* offered again next time */ }
}

/** Why a showcase did not open, with what the dialog says it with. */
export interface ShowcaseFailure {
    kind: ShowcaseErrorKind;
    /** HTTP status of the server's answer (`server`); absent: the download broke off. */
    status?: number;
    /** The showcase's size (`space`: the room it needs). */
    bytes?: number;
}

/** How opening a showcase file ended. */
export type ShowcaseOpenResult =
    | { done: 'opened'; treeId: TreeId }
    | { done: 'switched'; treeId: TreeId }
    | { done: 'cancelled' }
    | { done: 'failed'; failure: ShowcaseFailure };

/** The title and sentence of a failure's dialog (§3). */
export function showcaseErrorText(f: ShowcaseFailure): { title: string; message: string } {
    const s = strings.sample;
    switch (f.kind) {
        case 'offline': return { title: s.errTitle, message: s.errOffline };
        case 'server': return { title: s.errTitle, message: s.errServer(f.status ? s.reasonHttp(f.status) : s.reasonInterrupted) };
        case 'space': {
            const mb = String(Math.max(1, Math.ceil(showcaseRoomNeeded(f.bytes ?? 0) / (1024 * 1024))));
            return { title: s.errSpaceTitle, message: s.errSpace(mb) };
        }
        case 'broken': return { title: s.errBrokenTitle, message: s.errBroken };
        case 'newerFormat': return { title: s.errBrokenTitle, message: s.errFormat };
    }
}

/** The progress toast's step for a download as far as it is. */
export function showcaseProgressStep(p: ShowcaseProgress, lang: string): ProgressStep {
    const percent = showcasePercent(p);
    if (percent === null) return { step: `${formatShowcaseMb(p.done, lang)} MB`, percent: null };
    return { step: strings.sample.downloadedOf(formatShowcaseMb(p.done, lang), formatShowcaseMb(p.total!, lang), percent), percent };
}

/**
 * The tree of a showcase file: its research's GEDCOM read as a research's
 * file is (convertToStrom; everyone in it added as of the showcase's date),
 * its images left out when the setting says so. Throws on a GEDCOM that
 * cannot be read.
 */
export function showcaseTreeData(file: ShowcaseFile): { data: StromData; research: ResearchHeader } {
    const research = readResearchHeader(file.tree.text);
    const result = convertToStrom(parseGedcom(file.tree.text));
    let data = stampResearchTree(result.data, file.header.asOf);
    if (!SettingsManager.isImportImages()) data = stripMedia(data);
    if (!Object.values(data.persons).some(p => p && !p.isPlaceholder)) throw new Error('No one in the showcase');
    return { data, research };
}

/** What of a showcase tree's own data stays over its update (its settings), when it still fits the new data. */
export function keepShowcaseSettings(next: StromData, previous: StromData | null): StromData {
    if (!previous) return next;
    const out: StromData = { ...next };
    const def = previous.defaultPersonId;
    // "Where it was left" always stays; a person set as the default only while the update still has them.
    if (def === LAST_FOCUSED || (def !== undefined && def in next.persons)) out.defaultPersonId = def;
    if (previous.defaultView) out.defaultView = previous.defaultView;
    if (previous.tableViews?.length) out.tableViews = previous.tableViews;
    if (previous.lastFocusPersonId && previous.lastFocusPersonId in next.persons) {
        out.lastFocusPersonId = previous.lastFocusPersonId;
        if (previous.lastFocusDepthUp !== undefined) out.lastFocusDepthUp = previous.lastFocusDepthUp;
        if (previous.lastFocusDepthDown !== undefined) out.lastFocusDepthDown = previous.lastFocusDepthDown;
    }
    return out;
}

/** The showcase of the UI's language (its data's language; English for any other). */
export function showcaseLangOfUi(): ShowcaseLang {
    return showcaseLangParam(getCurrentLanguage()) ?? 'en';
}

/** The New tree row's second line: the download's size, or (a standalone file) that it opens from a downloaded file. */
export function showcaseTryDesc(embedded: boolean): string {
    return embedded ? strings.sample.tryDescEmbedded : strings.sample.tryDesc(formatShowcaseMb(SHOWCASE_DOWNLOAD_BYTES, getCurrentLanguage()));
}

/** What a showcase file read gives: the file, or why it cannot be opened. */
type ShowcaseRead = { ok: true; file: ShowcaseFile } | { ok: false; kind: 'broken' | 'newerFormat' };

export const showcaseOpenMethods = uiModule({
    /**
     * "Try the sample with research" (New tree, the empty start): the
     * showcase of the UI's language from the web; a standalone file does not
     * download it (showShowcaseEmbedded).
     */
    tryShowcase(): void {
        if (DataManager.isReadOnly()) return;
        this.closeMobileMenu();
        if (document.getElementById('new-tree-menu-modal')?.classList.contains('active')) this.closeNewTreeMenu();
        if (this.appMode === 'embedded') void this.showShowcaseEmbedded();
        else void this.openShowcaseFromUrl(showcaseLangOfUi());
    },

    /**
     * A standalone file (§4): the showcase is not downloaded. The dialog
     * links to its file on the web (a new window), opens the small sample,
     * or (primary) a downloaded showcase file.
     */
    async showShowcaseEmbedded(): Promise<void> {
        const s = strings.sample;
        const url = showcaseWebFileUrl(showcaseLangOfUi());
        const pick = await this.showChoice(s.embeddedText, s.embeddedTitle, [
            { id: 'small', label: s.openSmall },
            { id: 'file', label: s.embeddedOpen },
        ], undefined, {
            cancelLabel: strings.buttons.close,
            link: { label: s.embeddedLink, run: () => { window.open(url, '_blank', 'noopener'); } },
        });
        if (pick === 'small') await this.loadDemoTree();
        else if (pick === 'file') this.pickShowcaseFile();
    },

    /** The file picker for a downloaded showcase file (.json); the file chosen opens as a showcase. */
    pickShowcaseFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.hidden = true;
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.remove();
            if (file) void this.openShowcaseFromFile(file);
        }, { once: true });
        input.addEventListener('cancel', () => input.remove(), { once: true });
        document.body.appendChild(input);
        input.click();
    },

    /** A showcase file opened or dropped (§4): read, then the steps of openShowcaseFile; a failure has no Try again. */
    openShowcaseFromFile(file: File): Promise<ShowcaseOpenResult> {
        return this.openShowcaseRead(file.name, file.size, async () => readShowcaseText(await file.text()));
    },

    /** A showcase file read already as JSON (the JSON import found its header). */
    openShowcaseFromJson(parsed: unknown, name: string, size: number): Promise<ShowcaseOpenResult> {
        return this.openShowcaseRead(name, size, async () => readShowcaseValue(parsed));
    },

    /**
     * "Opening the sample" with the file's name and size and a bar of
     * unknown share (Cancel while it is read), then openShowcaseFile. A file
     * that cannot be opened is said in the §3 dialog, without Try again.
     */
    async openShowcaseRead(name: string, size: number, read: () => Promise<ShowcaseRead>): Promise<ShowcaseOpenResult> {
        if (busy || DataManager.isReadOnly() || DataManager.isViewMode()) return { done: 'cancelled' };
        let stopped = false;
        const sizeText = formatTreeSize(size, getCurrentLanguage());
        const toast = showProgressToast({ title: strings.sample.opening, cancel: () => { stopped = true; toast.close(); } },
            { ...(name ? { step: name } : {}), size: sizeText, percent: null });
        toast.el.classList.add('showcase-opening-toast');
        let got: ShowcaseRead;
        try {
            got = await read();
        } catch (err) {
            console.warn('The showcase file could not be read', err);
            got = { ok: false, kind: 'broken' };
        }
        if (stopped) return { done: 'cancelled' };
        if (!got.ok) {
            toast.close();
            const failure: ShowcaseFailure = { kind: got.kind };
            void this.showShowcaseError(failure);
            return { done: 'failed', failure };
        }
        // From here the tree is made: no Cancel any more.
        toast.update({ cancel: false });
        try {
            return await this.openShowcaseFile(got.file, { el: null });
        } finally {
            toast.close();
        }
    },

    /**
     * `?demo=<lang>` (§2): a showcase of that language opened before is only
     * switched to (then its version asked); else its file downloaded with
     * its progress and opened (openShowcaseFile). The open tree stays as it
     * is until the file is all in and checked.
     */
    async openShowcaseFromUrl(lang: ShowcaseLang): Promise<void> {
        if (busy || DataManager.isReadOnly() || DataManager.isViewMode()) return;
        const existing = TreeManager.findTreeByExportId(showcaseExportId(lang));
        const embedded = this.appMode === 'embedded';
        if (existing) {
            await this.switchToShowcase(existing.id);
            if (!embedded && DataManager.getCurrentTreeId() === existing.id) void this.checkShowcaseVersion(existing.id);
            return;
        }
        // A standalone file does not download it (§4): its file from the web, or the small sample.
        if (embedded) {
            await this.showShowcaseEmbedded();
            return;
        }
        busy = true;
        let file: ShowcaseFile | null = null;
        try {
            file = await this.downloadShowcaseWithToast(lang, () => { void this.openShowcaseFromUrl(lang); });
        } finally {
            busy = false;
        }
        if (file) await this.openShowcaseFile(file, { retry: () => { void this.openShowcaseFromUrl(lang); } });
    },

    /**
     * The showcase's file downloaded in the long action's toast (title
     * "Downloading the sample", "2.4 MB of 7.1 MB · 34%", Cancel). Null when
     * cancelled (said in a toast) or failed (said in the dialog, with `retry`
     * as its Try again).
     */
    async downloadShowcaseWithToast(lang: ShowcaseLang, retry?: () => void): Promise<ShowcaseFile | null> {
        const ac = new AbortController();
        const uiLang = getCurrentLanguage();
        const toast = showProgressToast({ title: strings.sample.downloading, cancel: () => ac.abort() }, { percent: null });
        toast.el.classList.add('showcase-download-toast');
        let got;
        try {
            got = await downloadShowcase(showcaseFileUrl(lang), {
                signal: ac.signal,
                onProgress: (p) => toast.update(showcaseProgressStep(p, uiLang)),
                ...(testDeps ? { deps: testDeps } : {}),
            });
        } catch (err) {
            console.warn('The showcase did not download', err);
            got = { ok: false as const, kind: 'server' as const };
        }
        toast.close();
        if (got.ok) return got.file;
        if (got.kind === 'cancelled') {
            this.showToast(strings.sample.cancelled, 5000);
            return null;
        }
        const failure: ShowcaseFailure = { kind: got.kind };
        if (got.kind === 'server' && got.status) failure.status = got.status;
        if (got.kind === 'space') failure.bytes = got.bytes;
        void this.showShowcaseError(failure, retry);
        return null;
    },

    /**
     * The steps every showcase file goes through (§2 steps 3–5; the file
     * opened or dropped too, §4): a showcase opened before (its export id)
     * is only switched to — a newer file offered as its update —, else its
     * tree is made in the switch of trees as today (the open tree's changes
     * go first). A failure is said in the §3 dialog (`retry`: its Try again,
     * for a download); its tree half made is deleted.
     */
    async openShowcaseFile(file: ShowcaseFile, opts: { retry?: () => void; el?: HTMLElement | null } = {}): Promise<ShowcaseOpenResult> {
        if (DataManager.isReadOnly() || DataManager.isViewMode()) return { done: 'cancelled' };
        const existing = TreeManager.findTreeByExportId(file.header.exportId);
        if (existing) {
            await this.switchToShowcase(existing.id);
            if (DataManager.getCurrentTreeId() !== existing.id) return { done: 'cancelled' };
            // The file in hand is newer than the tree: its update offered (no download needed).
            const newer = newerShowcaseVersion(TreeManager.getTreeMetadata(existing.id)?.sample, file.header.sampleVersion);
            if (newer) {
                knownVersions.set(file.header.lang, newer);
                this.offerShowcaseUpdate(existing.id, newer, file);
            }
            return { done: 'switched', treeId: existing.id };
        }
        if (busy) return { done: 'cancelled' };
        busy = true;
        let outcome: ShowcaseOpenResult = { done: 'cancelled' };
        try {
            const el = opts.el !== undefined ? opts.el : activatedElement();
            await runTreeSwitch(el, 'showcase', {
                before: (o) => this.researchFollowBeforeSwitch(null, o),
                go: async (from) => {
                    outcome = await this.createShowcaseTree(file);
                    if (outcome.done === 'opened') this.researchFollowLeft(from.open);
                },
                retry: () => { void this.openShowcaseFile(file, opts); },
            });
        } finally {
            busy = false;
        }
        // Set inside `go` (TypeScript does not see the callback assign it).
        const end = outcome as ShowcaseOpenResult;
        // Said once the switch has ended: from this toast on the tree takes edits and a dropped file
        // (inside `go` the switch's edit lock still stood for its last moments, refusing them).
        if (end.done === 'opened') this.showToast(strings.sample.opened, 6000, { title: strings.sample.openedTitle });
        if (end.done === 'failed') void this.showShowcaseError(end.failure, end.failure.kind === 'offline' || end.failure.kind === 'server' ? opts.retry : undefined);
        return end;
    },

    /**
     * The showcase's tree made and opened: its data as a new tree, marked a
     * sample, tied to its research to be read only, focused on its default
     * person (said in a toast by openShowcaseFile once the switch ended). Anything failing deletes the tree again and
     * opens the tree that was open.
     */
    async createShowcaseTree(file: ShowcaseFile): Promise<ShowcaseOpenResult> {
        if (!await this.ensureLocalUnlocked()) return { done: 'cancelled' };
        let built: ReturnType<typeof showcaseTreeData>;
        try {
            built = showcaseTreeData(file);
        } catch (err) {
            console.warn('The showcase tree could not be read', err);
            return { done: 'failed', failure: { kind: 'broken' } };
        }
        const before = DataManager.getCurrentTreeId();
        let treeId: TreeId | null = null;
        try {
            treeId = await DataManager.importAsNewTree(built.data, file.header.name || built.research.name || strings.sample.tag);
            TreeManager.markSampleTree(treeId, sampleMarkOf(file.header));
            this.tieShowcaseResearch(treeId, file, built.research);
            // All of it stored, or none of it (no room: the tree goes again).
            await TreeManager.flush(treeId);
            if (TreeManager.hasFailedWrite(treeId)) throw new DOMException('The showcase was not stored', 'QuotaExceededError');
        } catch (err) {
            console.warn('The showcase tree could not be made', err);
            if (treeId) await this.dropShowcaseTree(treeId, before);
            return { done: 'failed', failure: isQuotaError(err) ? { kind: 'space', bytes: file.header.sizeBytes ?? 0 } : { kind: 'broken' } };
        }
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        const start = startupPerson(DataManager.getData());
        if (start) void TreeRenderer.setFocus(start.id);
        TreeRenderer.resetFocusHistory();
        this.refreshSearch();
        this.updateUrlTreeParam(treeId);
        return { done: 'opened', treeId };
    },

    /**
     * The showcase tree's research: tied only to be read — its version as
     * the base (nothing differs), nothing ever sent (`sendMode: 'off'`), no
     * bridge known; the snapshot's status mirrored for this session when the
     * file has one (stored state only, nothing asked of a bridge).
     */
    tieShowcaseResearch(treeId: TreeId, file: ShowcaseFile, research: ResearchHeader): void {
        const id = research.treeId ?? file.research?.id ?? null;
        if (!id) return;
        const loaded = DataManager.getCurrentTreeId() === treeId ? DataManager.getData() : null;
        if (!loaded) return;
        TreeManager.setResearchLink(treeId, {
            id,
            fingerprint: contentFingerprint(loaded),
            syncedAt: file.header.asOf,
            ...(research.head ? { head: research.head } : {}),
            ...(research.mode === 'archive' ? { mode: 'archive' as const } : {}),
            sendMode: 'off',
        });
        this.researchKeepCopy(treeId, loaded);
        const status = file.research?.status ? sanitizeLiveStatus(file.research.status) : null;
        if (status) setMirroredResearchStatus(id, status);
    },

    /** A showcase tree half made goes again; the tree open before it opens again. */
    async dropShowcaseTree(treeId: TreeId, before: TreeId | null): Promise<void> {
        try {
            await TreeManager.deleteTree(treeId);
        } catch (err) {
            console.warn('The half-made showcase tree stayed', err);
        }
        if (!TreeManager.hasTrees()) {
            const fresh = DataManager.createNewTree(strings.treeManager.defaultTreeName);
            this.updateUrlTreeParam(fresh);
        } else {
            const back = before && TreeManager.getTreeMetadata(before) ? before : TreeManager.getActiveTreeId();
            if (back) {
                await DataManager.switchTree(back);
                this.updateUrlTreeParam(back);
            }
        }
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        TreeRenderer.render();
    },

    /** A showcase opened before: switched to as any tree (the open tree's changes first), no toast, no dialog. */
    async switchToShowcase(treeId: TreeId): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree) return;
        if (tree.isHidden) TreeManager.setTreeVisibility(treeId, false);
        if (DataManager.getCurrentTreeId() === treeId) return;
        await this.switchToTree(treeId, { el: null });
    },

    /**
     * The web's version of a showcase tree's language (`VERSION`; any
     * failure said nowhere): newer than the tree's, its update offered in a
     * toast — once per version.
     */
    async checkShowcaseVersion(treeId: TreeId): Promise<void> {
        const mark = TreeManager.getTreeMetadata(treeId)?.sample;
        if (!mark) return;
        const remote = await fetchShowcaseVersion(mark.lang, testDeps ?? undefined);
        if (!remote) return;
        knownVersions.set(mark.lang, remote);
        const newer = newerShowcaseVersion(TreeManager.getTreeMetadata(treeId)?.sample, remote);
        if (!newer || offeredVersion(mark.lang) === newer) return;
        noteOffered(mark.lang, newer);
        this.offerShowcaseUpdate(treeId, newer);
    },

    /** "A newer sample is available (v)." with "Update the sample…" and "Not now" under it. `file`: the newer file in hand. */
    offerShowcaseUpdate(treeId: TreeId, version: string, file?: ShowcaseFile): void {
        const s = strings.sample;
        this.showToast(s.newer, OFFER_MS, {
            title: s.newerTitle(version),
            kind: 'showcase-newer',
            hold: true,
            actionsBelow: true,
            action: { label: s.update, run: () => { void this.updateShowcase(treeId, file); } },
            more: { label: s.notNow, run: () => undefined },
        });
    },

    /** The newer version of a showcase tree known here (the web said it, or it was offered), else null. */
    showcaseNewerVersion(treeId: TreeId): string | null {
        const mark = TreeManager.getTreeMetadata(treeId)?.sample;
        if (!mark) return null;
        return newerShowcaseVersion(mark, knownVersions.get(mark.lang) ?? offeredVersion(mark.lang));
    },

    /**
     * "Update the sample…" (the toast, the row's ⋯ in Manage trees): asked
     * first, then its file downloaded anew (or the file in hand) and the
     * tree's data replaced — the same tree, its name and settings kept.
     */
    async updateShowcase(treeId: TreeId, file?: ShowcaseFile): Promise<void> {
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree?.sample) return;
        const s = strings.sample;
        const version = file?.header.sampleVersion ?? this.showcaseNewerVersion(treeId) ?? tree.sample.sampleVersion;
        const ok = await this.showConfirm(s.updateConfirm(tree.name, version), s.updateTitle, { confirmLabel: s.updateOk });
        if (!ok) return;
        await this.updateShowcaseNow(treeId, file);
    },

    /** The update itself (asked already): Try again of a failed download comes back here. */
    async updateShowcaseNow(treeId: TreeId, file?: ShowcaseFile): Promise<void> {
        const mark = TreeManager.getTreeMetadata(treeId)?.sample;
        if (!mark || busy) return;
        busy = true;
        let got: ShowcaseFile | null = file ?? null;
        try {
            if (!got) got = await this.downloadShowcaseWithToast(mark.lang, () => { void this.updateShowcaseNow(treeId); });
        } finally {
            busy = false;
        }
        if (!got) return;
        const failure = await this.replaceShowcaseTree(treeId, got);
        if (failure) void this.showShowcaseError(failure);
    },

    /**
     * A showcase tree's data replaced by a newer file of the same showcase:
     * the tree opened first, its name and settings kept, no undo into the
     * old version. Returns why it did not happen (the tree as it was), or null.
     */
    async replaceShowcaseTree(treeId: TreeId, file: ShowcaseFile): Promise<ShowcaseFailure | null> {
        const tree = TreeManager.getTreeMetadata(treeId);
        if (!tree?.sample || tree.sample.exportId !== file.header.exportId) return { kind: 'broken' };
        let built: ReturnType<typeof showcaseTreeData>;
        try {
            built = showcaseTreeData(file);
        } catch {
            return { kind: 'broken' };
        }
        if (!await this.ensureLocalUnlocked()) return null;
        await this.switchToShowcase(treeId);
        if (DataManager.getCurrentTreeId() !== treeId) return null;
        const previous = DataManager.getData();
        const next = keepShowcaseSettings(built.data, previous);
        if (!DataManager.replaceWithSourceData(treeId, next)) return null;
        await TreeManager.flush(treeId);
        if (TreeManager.hasFailedWrite(treeId)) {
            // Not stored: the tree as it was (its stored state never changed).
            DataManager.replaceWithSourceData(treeId, previous);
            return { kind: 'space', bytes: file.header.sizeBytes ?? 0 };
        }
        TreeManager.markSampleTree(treeId, sampleMarkOf(file.header));
        this.tieShowcaseResearch(treeId, file, built.research);
        this.updateTreeSwitcher();
        this.updateTreeManagerList();
        this.refreshSearch();
        this.showToast(strings.sample.updated(file.header.sampleVersion), 5000);
        return null;
    },

    /**
     * Why the showcase did not open (§3): the dialog with the warning dot,
     * Close, Try again (`retry`, only for the network and the server) and the
     * primary "Open the small sample" (the Berg family, loadDemoTree as ever).
     */
    async showShowcaseError(failure: ShowcaseFailure, retry?: () => void): Promise<void> {
        const s = strings.sample;
        const { title, message } = showcaseErrorText(failure);
        const canRetry = !!retry && (failure.kind === 'offline' || failure.kind === 'server');
        const pick = await this.showChoice(message, title, [
            ...(canRetry ? [{ id: 'retry', label: s.retry }] : []),
            { id: 'small', label: s.openSmall },
        ], undefined, { cancelLabel: strings.buttons.close, tone: 'warning' });
        if (pick === 'retry') retry?.();
        else if (pick === 'small') await this.loadDemoTree();
    },
});

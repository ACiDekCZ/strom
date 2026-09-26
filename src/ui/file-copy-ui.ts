/**
 * "Where your data is": keeps the user aware that the trees live only in the
 * browser, and whether the open tree's latest edits are in a file too. Three
 * surfaces, all driven by src/file-copy.ts:
 * - a toolbar indicator while edits are only in a storage the browser may clear;
 * - a notice at the first such edit (once per stretch of unsaved work);
 * - the storage-status dialog: state, last file copy, advice for this device
 *   (install the app, Safari's 7-day rule, iOS home-screen app), Export/Install.
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { SettingsManager } from '../settings.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { TreeId, TreeMetadata } from '../types.js';
import { formatRelativeDateTime } from '../format.js';
import { getPersistenceState, settledPersistenceState, PersistenceState } from '../persistence.js';
import {
    hasUnsavedChanges, shouldNoticeUnsaved, shouldShowUnsavedIndicator, unsavedTrees, storageAdvice, isIosDevice, browserFamily, StorageAdvice,
} from '../file-copy.js';
import { canPromptInstall, promptInstall, isStandaloneDisplay } from '../pwa.js';
import { uiModule } from './module.js';
import { iconSvg } from '../icons.js';

/** Last known storage state (refreshed on every check; best-effort until known). */
let knownState: PersistenceState = 'best-effort';

function currentAdvice(): StorageAdvice {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    return storageAdvice({
        ios: nav ? isIosDevice(nav.userAgent ?? '', nav.platform ?? '', nav.maxTouchPoints ?? 0) : false,
        standalone: isStandaloneDisplay(),
        canInstall: canPromptInstall(),
        browser: nav ? browserFamily(nav.userAgent ?? '',
            (nav as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands?.map(b => b.brand)) : 'other',
    });
}

function activeTree(): { id: TreeId; meta: TreeMetadata } | null {
    const id = DataManager.getCurrentTreeId();
    const meta = id ? TreeManager.getTreeMetadata(id) : null;
    return id && meta ? { id, meta } : null;
}

function personCount(): number {
    return Object.keys(DataManager.getData().persons).length;
}

/** Every tree whose edits no file holds (the open one counted from memory). */
function unsavedTreeList(): TreeMetadata[] {
    const openId = DataManager.getCurrentTreeId();
    const trees = TreeManager.getTrees().map(t =>
        t.id === openId ? { ...t, personCount: personCount() } : t);
    return unsavedTrees(trees);
}

type PillState = 'unsaved' | 'saved' | 'persistent';

/** Whether the "only in browser" state was showing at the last render. */
let unsavedShown = false;
/** The toolbar pill's brief "Saved to file" after an export. */
let savedFlashTimer: ReturnType<typeof setTimeout> | null = null;

/** Paint a storage pill (toolbar or storage dialog) in one of its states. */
function setPillState(el: HTMLElement, state: PillState): void {
    const s = strings.fileCopy;
    el.classList.toggle('is-unsaved', state === 'unsaved');
    el.classList.toggle('is-saved', state === 'saved');
    el.classList.toggle('is-persistent', state === 'persistent');
    let icon = el.querySelector<HTMLElement>('.storage-pill-icon');
    let label = el.querySelector<HTMLElement>('.storage-pill-label');
    if (!icon || !label) {
        icon = document.createElement('span');
        icon.className = 'storage-pill-icon';
        icon.setAttribute('aria-hidden', 'true');
        label = document.createElement('span');
        label.className = 'storage-pill-label';
        el.replaceChildren(icon, label);
    }
    icon.innerHTML = iconSvg(state === 'saved' ? 'file-saved' : state === 'persistent' ? 'lock' : 'file-unsaved');
    label.textContent = state === 'saved' ? s.savedShort : state === 'persistent' ? s.persistentShort : s.indicatorShort;
}

/** ≤1024px: the bottom bar's "More" tab carries the state, not the toolbar. */
function isBottomBarRegime(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(max-width: 1024px)').matches;
}

/**
 * The bottom bar's "More" tab speaks for what its dots show: edits only in the
 * browser (this module) and the Strom Research "New" item (research-promo-ui),
 * each flagged on the tab's dataset. No flag: the visible label names it.
 */
export function syncMoreTabLabel(): void {
    const tab = document.getElementById('bb-view-more');
    if (!tab) return;
    const storage = tab.dataset.storage === '1';
    const isNew = tab.dataset.newItem === '1';
    if (!storage && !isNew) {
        tab.removeAttribute('aria-label');
        return;
    }
    const base = storage ? strings.fileCopy.moreHint : strings.mobileMenu.more;
    tab.setAttribute('aria-label', isNew ? `${base}, ${strings.research.triggerNewSr}` : base);
}

/** Two ring pulses (CSS; none with reduced motion). */
function pulse(el: HTMLElement | null): void {
    if (!el) return;
    el.classList.remove('storage-pulse');
    void el.offsetWidth;   // restart the animation
    el.classList.add('storage-pulse');
    el.addEventListener('animationend', () => el.classList.remove('storage-pulse'), { once: true });
}

export const fileCopyMethods = uiModule({
    /** Show or hide the "only in browser" state for the open tree. */
    async refreshUnsavedIndicator(): Promise<void> {
        knownState = await getPersistenceState();
        this.renderUnsavedIndicator();
    },

    /** The state was showing at the last render (the "More" sheet asks). */
    isUnsavedInBrowser(): boolean {
        return unsavedShown;
    },

    renderUnsavedIndicator(): void {
        const show = shouldShowUnsavedIndicator({
            state: knownState,
            unsavedCount: unsavedTreeList().length,
            viewMode: DataManager.isViewMode(),
        });
        unsavedShown = show;
        const el = document.getElementById('unsaved-copy-indicator');
        if (el) {
            if (show) {
                if (savedFlashTimer) { clearTimeout(savedFlashTimer); savedFlashTimer = null; }
                el.classList.remove('is-fading');
                setPillState(el, 'unsaved');
                el.title = strings.fileCopy.indicatorTitle;
                el.setAttribute('aria-label', strings.fileCopy.indicatorTitle);
                el.style.display = 'inline-flex';
            } else if (!savedFlashTimer) {
                el.style.display = 'none';
            }
        }
        const dot = document.getElementById('bottom-bar-more-storage-dot');
        if (dot) dot.style.display = show ? 'block' : 'none';
        const more = document.getElementById('bb-view-more');
        if (more) {
            more.dataset.storage = show ? '1' : '';
            syncMoreTabLabel();
        }
    },

    /**
     * Briefly "Saved to file" where "Only in browser" was showing: the pill
     * for 4 s on wide screens, a toast in the bottom-bar regime (unless the
     * working-file save shows its own).
     */
    flashSavedToFile(): void {
        if (isBottomBarRegime()) {
            if (!this.activeFileHandleName) this.showToast(strings.fileCopy.savedShort);
            return;
        }
        const el = document.getElementById('unsaved-copy-indicator');
        if (!el) return;
        if (savedFlashTimer) clearTimeout(savedFlashTimer);
        setPillState(el, 'saved');
        el.title = strings.fileCopy.savedShort;
        el.setAttribute('aria-label', strings.fileCopy.savedShort);
        el.classList.remove('is-fading');
        el.style.display = 'inline-flex';
        savedFlashTimer = setTimeout(() => {
            el.classList.add('is-fading');
            savedFlashTimer = setTimeout(() => {
                savedFlashTimer = null;
                el.classList.remove('is-fading');
                this.renderUnsavedIndicator();
            }, 300);
        }, 4000);
    },

    /**
     * A tree's file-copy state changed (an edit, an export): refresh the
     * indicator, and for an edit of the open tree maybe raise the notice.
     */
    async handleFileCopyChange(treeId: string): Promise<void> {
        const wasShown = unsavedShown;
        // An edit's save asks for persistent storage: act on the answer.
        knownState = await settledPersistenceState();
        this.renderUnsavedIndicator();
        if (wasShown && !unsavedShown) this.flashSavedToFile();
        if (document.getElementById('storage-status-modal')?.classList.contains('active')) {
            void this.refreshStorageStatusDialog();
        }
        // The notice speaks about an edit of the open tree.
        const tree = activeTree();
        if (!tree || tree.id !== treeId) return;
        const fresh = TreeManager.getTreeMetadata(tree.id);
        if (!fresh || !hasUnsavedChanges(fresh)) {
            document.getElementById('file-copy-notice')?.remove();
            return;
        }
        if (!shouldNoticeUnsaved({
            state: knownState,
            info: fresh,
            personCount: personCount(),
            viewMode: DataManager.isViewMode(),
            enabled: SettingsManager.isFileCopyRemindersEnabled(),
            now: Date.now(),
        })) return;
        TreeManager.noteFileCopyNotice(tree.id);
        this.showFileCopyNotice(fresh.name);
    },

    showFileCopyNotice(treeName: string): void {
        const s = strings.fileCopy;
        const advice = currentAdvice();
        const message = advice === 'install' ? s.noticeInstall(treeName)
            : advice === 'install-menu' ? s.noticeInstallMenu(treeName)
            : advice === 'mac-dock' ? s.noticeMacDock(treeName)
            : advice === 'firefox' ? s.noticeFirefox(treeName)
            : advice === 'ios-safari' ? s.noticeIosSafari(treeName)
            : s.notice(treeName);
        const close = () => document.getElementById('file-copy-notice')?.remove();
        const actions = [{ label: s.save, run: () => { close(); this.saveTreeCopy(); } }];
        if (advice === 'install') {
            actions.push({ label: s.install, run: () => { close(); void this.installApp(); } });
        } else {
            actions.push({ label: s.details, run: () => { close(); void this.showStorageStatusDialog(); } });
        }
        this.showStorageNotice('file-copy-notice', message, actions);
        pulse(document.getElementById('unsaved-copy-indicator'));
        pulse(document.getElementById('bottom-bar-more-storage-dot'));
    },

    /**
     * Save the open tree where it counts as a copy: into its attached working
     * file, else a full JSON backup (all data, all content; encryption optional)
     * — not the export menu, whose share formats default to reduced privacy
     * and would not count.
     */
    saveTreeCopy(): void {
        if (this.activeFileHandleName) {
            void this.saveActiveTreeToFile();
            return;
        }
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;
        this.exportTargetTreeId = treeId;
        void this.exportTargetTreeJSON();
    },

    /** Every tree into one backup file (the "Export all" JSON, full data). */
    saveAllTreesCopy(): void {
        void this.exportAllAsJson();
    },

    async installApp(): Promise<void> {
        if (await promptInstall()) this.showToast(strings.fileCopy.installing);
        void this.refreshStorageStatusDialog();
    },

    /** The "Where your data is" dialog (indicator, notice, backups dialog). */
    async showStorageStatusDialog(): Promise<void> {
        const modal = document.getElementById('storage-status-modal');
        if (!modal) return;
        await this.refreshStorageStatusDialog();
        modal.classList.add('active');
    },

    closeStorageStatusDialog(): void {
        document.getElementById('storage-status-modal')?.classList.remove('active');
    },

    async refreshStorageStatusDialog(): Promise<void> {
        const body = document.getElementById('storage-status-body');
        if (!body) return;
        knownState = await getPersistenceState();
        const tree = activeTree();
        const state: PillState = knownState === 'persistent' ? 'persistent'
            : unsavedTreeList().length === 0 && !!tree?.meta.fileCopyAt ? 'saved' : 'unsaved';
        const pill = document.createElement('div');
        pill.className = 'storage-status-state';
        const chip = document.createElement('span');
        chip.className = 'storage-pill';
        setPillState(chip, state);
        pill.appendChild(chip);
        body.replaceChildren(pill, ...this.storageStatusParagraphs(true).map(text => {
            const p = document.createElement('p');
            p.textContent = text;
            return p;
        }));
        const advice = currentAdvice();
        const install = document.getElementById('storage-status-install');
        if (install) install.hidden = advice !== 'install';
        const save = document.getElementById('storage-status-save');
        if (save) {
            save.textContent = this.activeFileHandleName ? strings.fileAccess.saveToFile : strings.fileCopy.save;
            save.hidden = !activeTree() || DataManager.isViewMode();
        }
        const saveAll = document.getElementById('storage-status-save-all');
        if (saveAll) saveAll.hidden = DataManager.isViewMode() || TreeManager.getTrees().length < 2;
        this.renderUnsavedIndicator();
    },

    /**
     * The status as sentences: storage state, the open tree's last file copy,
     * and (withAdvice) what to do on this device. Uses the last known state.
     */
    storageStatusParagraphs(withAdvice: boolean): string[] {
        const s = strings.fileCopy;
        const out: string[] = [];
        if (withAdvice) out.push(s.intro);
        out.push(knownState === 'persistent' ? s.statePersistent
            : knownState === 'unsupported' ? s.stateUnsupported : s.stateNotPersistent);
        const tree = activeTree();
        if (tree && !DataManager.isViewMode()) {
            const { meta } = tree;
            if (meta.fileCopyAt) {
                const when = formatRelativeDateTime(Date.parse(meta.fileCopyAt), getCurrentLanguage());
                out.push(s.copyAt(meta.name, when) + ' ' + (hasUnsavedChanges(meta) ? s.copyChanged : s.copyUpToDate));
            } else {
                out.push(s.copyNever(meta.name));
            }
            const others = unsavedTreeList().filter(t => t.id !== tree.id).map(t => t.name);
            if (others.length > 0) out.push(s.othersUnsaved(others));
        }
        if (withAdvice) {
            if (knownState !== 'persistent') {
                const advice = currentAdvice();
                out.push(advice === 'install' ? s.adviceInstall
                    : advice === 'install-menu' ? s.adviceInstallMenu
                    : advice === 'mac-dock' ? s.adviceMacDock
                    : advice === 'firefox' ? s.adviceFirefox
                    : advice === 'ios-safari' ? s.adviceIosSafari
                    : advice === 'ios-app' ? s.adviceIosApp : s.adviceFile);
            }
            out.push(s.backupsNote);
        }
        return out;
    },

    toggleFileCopyReminders(enabled: boolean): void {
        SettingsManager.setFileCopyReminders(enabled);
        if (!enabled) document.getElementById('file-copy-notice')?.remove();
    },
});

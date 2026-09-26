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
    hasUnsavedChanges, shouldShowNotice, shouldShowUnsavedIndicator, unsavedTrees, storageAdvice, isIosDevice, browserFamily, StorageAdvice,
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

/** The notice text, with the device's own advice. */
function noticeMessage(treeName: string): string {
    const s = strings.fileCopy;
    const advice = currentAdvice();
    return advice === 'install' ? s.noticeInstall(treeName)
        : advice === 'install-menu' ? s.noticeInstallMenu(treeName)
        : advice === 'mac-dock' ? s.noticeMacDock(treeName)
        : advice === 'firefox' ? s.noticeFirefox(treeName)
        : advice === 'ios-safari' ? s.noticeIosSafari(treeName)
        : s.notice(treeName);
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

/** A complete backup: every kind of content (the quick save never filters). */
const ALL_CONTENT = { photos: true, attachments: true, notes: true, sources: true };

/** When the quick save last showed its own "Saved to file x" toast. */
let quickSaveAnnouncedAt = 0;

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
    icon.innerHTML = iconSvg(state === 'saved' ? 'file-saved' : state === 'persistent' ? 'lock' : 'alert-triangle');
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

/** Draw the eye to every visible form of the indicator. */
function pulseIndicators(): void {
    pulse(document.getElementById('unsaved-copy-indicator'));
    pulse(document.getElementById('bottom-bar-more-storage-dot'));
    pulse(document.querySelector<HTMLElement>('.mobile-more-storage-dot'));
    pulse(document.querySelector<HTMLElement>('.actions-menu-storage-dot'));
}

export const fileCopyMethods = uiModule({
    /** Show or hide the "only in browser" state for the open tree. */
    async refreshUnsavedIndicator(): Promise<void> {
        knownState = await getPersistenceState();
        this.renderUnsavedIndicator();
        this.renderFileCopyNotice();
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
        document.body.classList.toggle('storage-unsaved', show);
        const rowIcon = document.querySelector<HTMLElement>('.actions-storage-icon');
        if (rowIcon && !rowIcon.firstChild) rowIcon.innerHTML = iconSvg('alert-triangle');
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
            const announced = Date.now() - quickSaveAnnouncedAt < 3000;
            if (!this.activeFileHandleName && !announced) this.showToast(strings.fileCopy.savedShort);
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
     * indicator (it pulses when it turns on) and the notice.
     */
    async handleFileCopyChange(treeId: string): Promise<void> {
        const wasShown = unsavedShown;
        // An edit's save asks for persistent storage: act on the answer.
        knownState = await settledPersistenceState();
        this.renderUnsavedIndicator();
        if (wasShown && !unsavedShown) this.flashSavedToFile();
        if (!wasShown && unsavedShown) pulseIndicators();
        if (document.getElementById('storage-status-modal')?.classList.contains('active')) {
            void this.refreshStorageStatusDialog();
        }
        const tree = activeTree();
        if (tree && tree.id === treeId) this.renderFileCopyNotice();
    },

    /**
     * The "changes only in the browser" notice for the open tree: it only
     * informs (no save buttons), stays until closed, and once closed returns
     * only after the tree is saved to a file and changed again.
     */
    renderFileCopyNotice(): void {
        const tree = activeTree();
        const fresh = tree ? TreeManager.getTreeMetadata(tree.id) : null;
        const show = !!fresh && shouldShowNotice({
            state: knownState,
            info: fresh,
            personCount: personCount(),
            viewMode: DataManager.isViewMode(),
            enabled: SettingsManager.isFileCopyRemindersEnabled(),
        });
        const existing = document.getElementById('file-copy-notice');
        if (!show || !fresh) {
            existing?.remove();
            return;
        }
        const message = noticeMessage(fresh.name);
        if (existing) {
            const text = existing.querySelector('.file-copy-notice-text');
            if (text) text.textContent = message;
            return;
        }
        const treeId = fresh.id;
        const el = document.createElement('div');
        el.id = 'file-copy-notice';
        el.className = 'storage-notice file-copy-notice';
        el.setAttribute('role', 'status');
        const icon = document.createElement('span');
        icon.className = 'file-copy-notice-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = iconSvg('alert-triangle');
        const body = document.createElement('div');
        body.className = 'file-copy-notice-body';
        const text = document.createElement('p');
        text.className = 'file-copy-notice-text';
        text.textContent = message;
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'link-button file-copy-notice-link';
        link.textContent = strings.fileCopy.details;
        link.addEventListener('click', () => { void this.showStorageStatusDialog(); });
        body.append(text, link);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'file-copy-notice-close';
        close.setAttribute('aria-label', strings.buttons.close);
        close.textContent = '\u00d7';
        close.addEventListener('click', () => {
            TreeManager.noteFileCopyNoticeClosed(treeId);
            el.remove();
        });
        el.append(icon, body, close);
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
    },

    toggleFileCopyReminders(enabled: boolean): void {
        SettingsManager.setFileCopyReminders(enabled);
        this.renderFileCopyNotice();
    },

    /**
     * One click to a copy that counts: into the attached working file, else a
     * complete JSON download (all data, all content) with no dialog. With the
     * app's data encrypted the narrowed dialog opens instead, encryption on —
     * a plain file would bypass the protection the user turned on.
     */
    saveTreeCopy(): void {
        if (this.activeFileHandleName) {
            void this.saveActiveTreeToFile();
            return;
        }
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;
        if (SettingsManager.isEncryptionEnabled()) {
            this.saveTreeCopyEncrypted();
            return;
        }
        void DataManager.exportTreeJSON(treeId, null, 'full', ALL_CONTENT).then(file => {
            if (file) this.announceQuickSave(file);
        });
    },

    /** The narrowed dialog for the open tree, "Encrypt with a password" on. */
    saveTreeCopyEncrypted(): void {
        const treeId = DataManager.getCurrentTreeId();
        if (!treeId || DataManager.isViewMode()) return;
        this.exportTargetTreeId = treeId;
        void this.exportTargetTreeJSON(true);
    },

    /** Every tree into one complete JSON file, one click (see saveTreeCopy). */
    saveAllTreesCopy(): void {
        if (SettingsManager.isEncryptionEnabled()) {
            this.saveAllTreesCopyEncrypted();
            return;
        }
        void this.downloadAllTreesJson(null, false, 'full', ALL_CONTENT).then(file => this.announceQuickSave(file));
    },

    saveAllTreesCopyEncrypted(): void {
        void this.exportAllAsJson(true);
    },

    /** "Saved to file x.json" (the brief "Saved" toast of the indicator yields to it). */
    announceQuickSave(file: string): void {
        quickSaveAnnouncedAt = Date.now();
        this.showToast(strings.fileCopy.savedToast(file), 4000);
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
        const s = strings.fileCopy;
        const tree = activeTree();
        const viewMode = DataManager.isViewMode();
        const unsaved = viewMode ? [] : unsavedTreeList();
        const openUnsaved = !!tree && unsaved.some(t => t.id === tree.id);
        const para = (text: string, className?: string): HTMLParagraphElement => {
            const p = document.createElement('p');
            p.textContent = text;
            if (className) p.className = className;
            return p;
        };

        // 1) The state pill.
        const state: PillState = knownState === 'persistent' ? 'persistent'
            : unsaved.length === 0 && !!tree?.meta.fileCopyAt ? 'saved' : 'unsaved';
        const pill = document.createElement('div');
        pill.className = 'storage-status-state';
        const chip = document.createElement('span');
        chip.className = 'storage-pill';
        setPillState(chip, state);
        pill.appendChild(chip);
        const nodes: HTMLElement[] = [pill];

        // 2) The trees: a list when other trees are unsaved too, else the open tree's sentence.
        if (unsaved.some(t => t.id !== tree?.id)) {
            nodes.push(para(s.unsavedListTitle, 'storage-status-list-title'));
            const list = document.createElement('ul');
            list.className = 'storage-status-trees';
            const ordered = [...unsaved].sort((x, y) => (x.id === tree?.id ? -1 : y.id === tree?.id ? 1 : 0));
            for (const t of ordered) {
                const li = document.createElement('li');
                const name = document.createElement('span');
                name.className = 'storage-status-tree-name';
                name.textContent = t.name;
                li.appendChild(name);
                if (t.id === tree?.id) {
                    const badge = document.createElement('span');
                    badge.className = 'tree-badge';
                    badge.textContent = s.openBadge;
                    li.appendChild(badge);
                }
                const when = document.createElement('span');
                when.className = 'storage-status-tree-when';
                when.textContent = t.fileCopyAt
                    ? formatRelativeDateTime(Date.parse(t.fileCopyAt), getCurrentLanguage())
                    : s.never;
                li.appendChild(when);
                list.appendChild(li);
            }
            nodes.push(list);
        } else {
            const sentence = this.openTreeCopySentence();
            if (sentence) nodes.push(para(sentence));
        }

        // 3) Storage, 4) advice, 5) backups, 6) the general intro last.
        nodes.push(para(this.storageStateSentence()));
        if (knownState !== 'persistent') nodes.push(para(this.storageAdviceSentence()));
        nodes.push(para(s.backupsNote));
        nodes.push(para(s.intro, 'storage-status-intro'));
        body.replaceChildren(...nodes);

        const install = document.getElementById('storage-status-install');
        if (install) install.hidden = currentAdvice() !== 'install';
        // Save this tree (primary) — or, when only other trees are unsaved,
        // "Save all trees" takes the primary place; it shows beside "Save"
        // only when two or more trees are unsaved.
        const allPrimary = !openUnsaved && unsaved.length > 0;
        const save = document.getElementById('storage-status-save');
        if (save) {
            save.textContent = this.activeFileHandleName ? strings.fileAccess.saveToFile : s.save;
            save.hidden = !tree || viewMode || allPrimary;
        }
        const saveAll = document.getElementById('storage-status-save-all');
        if (saveAll) {
            saveAll.hidden = !(allPrimary || unsaved.length >= 2);
            saveAll.classList.toggle('primary', allPrimary);
            saveAll.classList.toggle('secondary', !allPrimary);
        }
        const encrypt = document.getElementById('storage-status-encrypt');
        if (encrypt) {
            encrypt.hidden = viewMode || SettingsManager.isEncryptionEnabled() || (!tree && !allPrimary);
            encrypt.dataset.target = allPrimary ? 'all' : 'tree';
        }
        this.renderUnsavedIndicator();
    },

    /** "“X” was last saved to a file … / has not been saved yet" for the open tree. */
    openTreeCopySentence(): string | null {
        const tree = activeTree();
        if (!tree || DataManager.isViewMode()) return null;
        const s = strings.fileCopy;
        const { meta } = tree;
        if (!meta.fileCopyAt) return s.copyNever(meta.name);
        const when = formatRelativeDateTime(Date.parse(meta.fileCopyAt), getCurrentLanguage());
        return s.copyAt(meta.name, when) + ' ' + (hasUnsavedChanges(meta) ? s.copyChanged : s.copyUpToDate);
    },

    storageStateSentence(): string {
        const s = strings.fileCopy;
        return knownState === 'persistent' ? s.statePersistent
            : knownState === 'unsupported' ? s.stateUnsupported : s.stateNotPersistent;
    },

    storageAdviceSentence(): string {
        const s = strings.fileCopy;
        const advice = currentAdvice();
        return advice === 'install' ? s.adviceInstall
            : advice === 'install-menu' ? s.adviceInstallMenu
            : advice === 'mac-dock' ? s.adviceMacDock
            : advice === 'firefox' ? s.adviceFirefox
            : advice === 'ios-safari' ? s.adviceIosSafari
            : advice === 'ios-app' ? s.adviceIosApp : s.adviceFile;
    },

    /** The short status for the backups dialog: storage, the open tree, other unsaved trees. */
    storageStatusParagraphs(): string[] {
        const out = [this.storageStateSentence()];
        const sentence = this.openTreeCopySentence();
        if (sentence) out.push(sentence);
        const openId = DataManager.getCurrentTreeId();
        const others = DataManager.isViewMode() ? [] : unsavedTreeList().filter(t => t.id !== openId).map(t => t.name);
        if (others.length > 0) out.push(strings.fileCopy.othersUnsaved(others));
        return out;
    },
});

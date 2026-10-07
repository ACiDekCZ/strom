/**
 * Settings Manager - Local app settings stored in localStorage
 * Settings are NOT exported with tree data - they are local preferences
 */

import { AppSettings, ThemeMode, LanguageSetting, CardDensity, SETTINGS_KEY, StromData, personSourceIds, CARD_SIZE } from './types.js';
import { CardFieldSettings, normalizeCardFields, customCardSize } from './card-fields.js';
import { initLanguage, Language } from './strings.js';

/** How many recently cited sources the picker remembers per tree. */
export const RECENT_SOURCES_MAX = 5;

/** What the card shows at a glance (Settings → "Show on card"). All on by default. */
export interface CardSignals {
    /** Person status: the evidence circle. */
    evidence: boolean;
    /** Person status: the story leaf. */
    story: boolean;
    /** Action badge: the research waits for the user about this person. */
    waiting: boolean;
    conflict: boolean;
    question: boolean;
    /** Action badge: the agent works on (or has queued) this person, while live. */
    agent: boolean;
}

export const CARD_SIGNAL_KEYS: (keyof CardSignals)[] = ['evidence', 'story', 'waiting', 'conflict', 'question', 'agent'];

/** Per device, apart from the other settings. */
const CARD_SIGNALS_KEY = 'strom-card-signals';

class SettingsManagerClass {
    private settings: AppSettings = { theme: 'system', language: 'system', encryption: false, auditLog: false };

    init(): void {
        this.load();
        this.applyTheme();
        this.applyLanguage();
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)')
            .addEventListener('change', () => this.applyTheme());
    }

    private load(): void {
        try {
            const stored = localStorage.getItem(SETTINGS_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merge with defaults (for forward compatibility)
                this.settings = { ...this.settings, ...parsed };
            }
        } catch {
            // Use defaults on error
        }
    }

    private save(): void {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    }

    getTheme(): ThemeMode {
        return this.settings.theme;
    }

    setTheme(theme: ThemeMode): void {
        this.settings.theme = theme;
        this.save();
        this.applyTheme();
    }

    getLanguage(): LanguageSetting {
        return this.settings.language;
    }

    setLanguage(language: LanguageSetting): void {
        this.settings.language = language;
        this.save();
        this.applyLanguage();
    }

    isEncryptionEnabled(): boolean {
        return this.settings.encryption;
    }

    setEncryption(enabled: boolean): void {
        this.settings.encryption = enabled;
        this.save();
    }

    isAuditLogEnabled(): boolean {
        return this.settings.auditLog;
    }

    setAuditLog(enabled: boolean): void {
        this.settings.auditLog = enabled;
        this.save();
    }

    /** Duplicate suggestions default ON (undefined = enabled). */
    isSuggestDuplicatesEnabled(): boolean {
        return this.settings.suggestDuplicates !== false;
    }

    setSuggestDuplicates(enabled: boolean): void {
        this.settings.suggestDuplicates = enabled;
        this.save();
    }

    /** Overview minimap default ON (undefined = enabled). */
    isMinimapEnabled(): boolean {
        return this.settings.minimap !== false;
    }

    setMinimap(enabled: boolean): void {
        this.settings.minimap = enabled;
        this.save();
    }

    /** Sticky generation labels default ON (undefined = enabled). */
    isGenLabelsEnabled(): boolean {
        return this.settings.genLabels !== false;
    }

    setGenLabels(enabled: boolean): void {
        this.settings.genLabels = enabled;
        this.save();
    }

    /**
     * Does the person card's life timeline list the children's deaths,
     * burials, marriages and divorces? Default OFF; one choice for everybody.
     */
    isLifelineChildEvents(): boolean {
        return this.settings.lifelineChildEvents === true;
    }

    setLifelineChildEvents(enabled: boolean): void {
        this.settings.lifelineChildEvents = enabled;
        this.save();
    }

    /** Floating zoom buttons default ON (undefined = enabled). */
    /**
     * Has the user allowed the map to look place names up online? Default is
     * NO (undefined = never asked) — nothing leaves the app until they say so.
     */
    isGeocodingAllowed(): boolean {
        return this.settings.geocoding === true;
    }

    setGeocodingAllowed(allowed: boolean): void {
        this.settings.geocoding = allowed;
        this.save();
    }

    /**
     * Show the fields that only serious research needs (sources, attachments,
     * reference numbers, name variants)? Default NO: someone writing down their
     * grandmother should meet a short form, not an archive's worth of fields.
     *
     * Hiding is only ever about EMPTY fields — see the person modal.
     */
    isAdvancedFields(): boolean {
        return this.settings.advancedFields === true;
    }

    /**
     * Has the user seen that the map background comes from openstreetmap.org
     * (the tile requests reveal which area is being viewed)? Nothing is
     * fetched until they have.
     */
    isMapTilesAcknowledged(): boolean {
        return this.settings.mapTiles === true;
    }

    setMapTilesAcknowledged(): void {
        this.settings.mapTiles = true;
        this.save();
    }

    setAdvancedFields(enabled: boolean): void {
        this.settings.advancedFields = enabled;
        this.save();
    }

    /**
     * Do imports bring images (photos, attachments, source excerpts)? Default
     * yes. Pre-fills the checkbox of the import dialogs and decides silent
     * opens (a research opened straight into a new tree, live following).
     */
    isImportImages(): boolean {
        return this.settings.importImages !== false;
    }

    setImportImages(enabled: boolean): void {
        this.settings.importImages = enabled;
        this.save();
    }

    /** Sources last cited in a tree, newest first (the picker's "Recently used"). */
    getRecentSourceIds(treeId: string): string[] {
        return this.settings.recentSourceIds?.[treeId] ?? [];
    }

    /** Remember a citation of `sourceId` in `treeId` (keeps the newest five). */
    noteRecentSource(treeId: string, sourceId: string): void {
        const all = (this.settings.recentSourceIds ??= {});
        all[treeId] = [sourceId, ...(all[treeId] ?? []).filter(id => id !== sourceId)].slice(0, RECENT_SOURCES_MAX);
        this.save();
    }

    /** Forget a tree's recent sources (the tree was deleted). */
    forgetRecentSources(treeId: string): void {
        if (!this.settings.recentSourceIds?.[treeId]) return;
        delete this.settings.recentSourceIds[treeId];
        this.save();
    }

    /**
     * One-time default for users from before the setting existed: a tree that
     * already cites sources or carries research fields was made by someone who
     * uses them — hiding them behind a new default would look like the feature
     * vanished. Runs only while the user has never decided (undefined); after
     * this, the persisted choice rules and the checkbox is the only way back.
     */
    defaultAdvancedFieldsFromData(data: StromData): void {
        if (this.settings.advancedFields !== undefined) return;
        const researchInUse = Object.keys(data.sources ?? {}).length > 0
            || Object.values(data.persons).some(p =>
                personSourceIds(p).length > 0 || (p.attachments?.length ?? 0) > 0
                || !!p.refn || !!p.question || (p.nameVariants?.length ?? 0) > 0);
        if (researchInUse) {
            this.settings.advancedFields = true;
            this.save();
        }
    }

    isZoomControlsEnabled(): boolean {
        return this.settings.zoomControls !== false;
    }

    setZoomControls(enabled: boolean): void {
        this.settings.zoomControls = enabled;
        this.save();
    }

    /** "On this day" reminder default ON (undefined = enabled). */
    isOnThisDayEnabled(): boolean {
        return this.settings.onThisDay !== false;
    }

    setOnThisDay(enabled: boolean): void {
        this.settings.onThisDay = enabled;
        this.save();
    }

    /** "On this day" also from the other visible trees (default: the open tree only). */
    isOnThisDayAllTrees(): boolean {
        return this.settings.onThisDayAllTrees === true;
    }

    setOnThisDayAllTrees(enabled: boolean): void {
        this.settings.onThisDayAllTrees = enabled;
        this.save();
    }

    /** Branch colour coding default ON (undefined = enabled). */
    isBranchColorsEnabled(): boolean {
        return this.settings.branchColors !== false;
    }

    setBranchColors(enabled: boolean): void {
        this.settings.branchColors = enabled;
        this.save();
    }

    /**
     * Default for the descendants view: show partners' whole families
     * (their other unions and step-children, de-emphasized)? Default OFF —
     * the view starts with the blood line + partners only. The in-view badge
     * toggle overrides this ad hoc; this setting is just the starting value.
     */
    isDescendantsFullFamiliesDefault(): boolean {
        return this.settings.descendantsFullFamilies === true;
    }

    setDescendantsFullFamiliesDefault(enabled: boolean): void {
        this.settings.descendantsFullFamilies = enabled;
        this.save();
    }

    /** Branch-colour legend default ON (undefined = enabled). */
    /** Branch-colour legend box: default OFF (the colours speak for
     *  themselves; the box took tree real estate on every screenshot). */
    isBranchLegendEnabled(): boolean {
        return this.settings.branchLegend === true;
    }

    setBranchLegend(enabled: boolean): void {
        this.settings.branchLegend = enabled;
        this.save();
    }

    /** Include yearly death anniversaries (not just round milestones). Default OFF. */
    isDeathAnniversariesEnabled(): boolean {
        return this.settings.deathAnniversaries === true;
    }

    setDeathAnniversaries(enabled: boolean): void {
        this.settings.deathAnniversaries = enabled;
        this.save();
    }

    /** Cross-tree connection badges (the "+N" on cards). Default ON. */
    isCrossTreeBadgesEnabled(): boolean {
        return this.settings.crossTreeBadges !== false;
    }

    setCrossTreeBadges(enabled: boolean): void {
        this.settings.crossTreeBadges = enabled;
        this.save();
    }

    /** Kekulé (ahnentafel) numbers in the fan chart. Default OFF (genealogist tool). */
    isFanKekuleEnabled(): boolean {
        return this.settings.fanKekule === true;
    }

    setFanKekule(enabled: boolean): void {
        this.settings.fanKekule = enabled;
        this.save();
    }

    /** Card detail level: compact (names only) / normal / detailed (+places, age). */
    getCardDensity(): CardDensity {
        return this.settings.cardDensity ?? 'normal';
    }

    setCardDensity(density: CardDensity): void {
        this.settings.cardDensity = density;
        this.save();
    }

    /** The export dialog's scope: the whole tree or only the current view. */
    getExportScope(): 'tree' | 'view' {
        return this.settings.exportScope === 'view' ? 'view' : 'tree';
    }

    setExportScope(scope: 'tree' | 'view'): void {
        this.settings.exportScope = scope;
        this.save();
    }

    /** Whether the user ever picked a density (the sample tree picks one only if not). */
    hasCardDensity(): boolean {
        return this.settings.cardDensity !== undefined;
    }

    /** The custom card's lines (src/card-fields.ts), repaired to a valid set. */
    getCardFields(): CardFieldSettings {
        return normalizeCardFields(this.settings.cardFields);
    }

    setCardFields(fields: CardFieldSettings): void {
        this.settings.cardFields = normalizeCardFields(fields);
        this.save();
    }

    /** The card box for the current density (the layout spaces cards by it). */
    getCardSize(): { cardWidth: number; cardHeight: number } {
        const density = this.getCardDensity();
        return density === 'custom' ? customCardSize(this.getCardFields().on.length) : CARD_SIZE[density];
    }

    /** What the card shows at a glance, for this device. */
    getCardSignals(): CardSignals {
        const out: CardSignals = { evidence: true, story: true, waiting: true, conflict: true, question: true, agent: true };
        try {
            const parsed = JSON.parse(localStorage.getItem(CARD_SIGNALS_KEY) ?? '{}') as Record<string, unknown>;
            for (const k of CARD_SIGNAL_KEYS) if (typeof parsed[k] === 'boolean') out[k] = parsed[k] as boolean;
        } catch { /* defaults */ }
        return out;
    }

    setCardSignal(key: keyof CardSignals, on: boolean): void {
        const next = { ...this.getCardSignals(), [key]: on };
        try { localStorage.setItem(CARD_SIGNALS_KEY, JSON.stringify(next)); } catch { /* not kept */ }
    }

    /** Toolbar "Add family" button default OFF (opt-in). */
    isFamilyButtonEnabled(): boolean {
        return this.settings.familyButton === true;
    }

    setFamilyButton(enabled: boolean): void {
        this.settings.familyButton = enabled;
        this.save();
    }

    /** Collaboration: sender name shown to relatives in shared files. */
    getSenderName(): string {
        return this.settings.senderName ?? '';
    }

    setSenderName(name: string): void {
        const trimmed = name.trim();
        if (trimmed) this.settings.senderName = trimmed;
        else delete this.settings.senderName;
        this.save();
    }

    /**
     * Strom Research promotion state (3.0): when the "New" marker was first
     * shown, whether it went out for good, and whether the one-time "What's
     * new" card was shown. Browser settings only — never part of tree data.
     * Writes never throw (private mode / full storage just keeps it in memory).
     */
    getResearchPromoState(): { researchNewFirstSeen?: string; researchNewDismissed?: boolean; whatsNew30Shown?: boolean } {
        const { researchNewFirstSeen, researchNewDismissed, whatsNew30Shown } = this.settings;
        return { researchNewFirstSeen, researchNewDismissed, whatsNew30Shown };
    }

    setResearchNewFirstSeen(isoDate: string): void {
        this.settings.researchNewFirstSeen = isoDate;
        this.saveQuietly();
    }

    setResearchNewDismissed(): void {
        this.settings.researchNewDismissed = true;
        this.saveQuietly();
    }

    setWhatsNew30Shown(): void {
        this.settings.whatsNew30Shown = true;
        this.saveQuietly();
    }

    /** Notice when edits live only in a storage the browser may clear (default on; src/file-copy.ts). */
    isFileCopyRemindersEnabled(): boolean {
        return this.settings.fileCopyReminders !== false;
    }

    setFileCopyReminders(enabled: boolean): void {
        this.settings.fileCopyReminders = enabled;
        this.save();
    }

    private saveQuietly(): void {
        try {
            this.save();
        } catch {
            // Storage unavailable: the state lives for this session only.
        }
    }

    private applyTheme(): void {
        const html = document.documentElement;
        let isDark = false;

        if (this.settings.theme === 'system') {
            isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        } else {
            isDark = this.settings.theme === 'dark';
        }

        html.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }

    private applyLanguage(): void {
        // Convert LanguageSetting to Language | 'system' for initLanguage
        initLanguage(this.settings.language as Language | 'system');
    }
}

export const SettingsManager = new SettingsManagerClass();

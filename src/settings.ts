/**
 * Settings Manager - Local app settings stored in localStorage
 * Settings are NOT exported with tree data - they are local preferences
 */

import { personMediaCount } from './media.js';
import { AppSettings, BranchMarker, ThemeMode, SurnameDisplay, LanguageSetting, CardDensity, TreeSpacing, StromData, CardPhotoSize, CardPhotoShape, SavedMergeRule } from './types.js';
import { CARD_SIZE, NORMAL_PHOTO_BOX } from './layout-config.js';
import { BRANCH_MARKERS, SURNAME_DISPLAYS, SETTINGS_KEY, personSourceIds } from './model-values.js';
import { CardFieldSettings, normalizeCardFields, customCardSize, normalizeCardDensity, effectiveCardFields, normalizeCardPhoto } from './card-fields.js';
import { initLanguage, Language } from './strings.js';
import { MapKind, MAP_KINDS, isMapKind, readPlacesSort, type PlacesSort } from './places.js';
import { HISTORY_KINDS, isHistoryKind, type HistoryKind } from './history.js';
import { sameSelectionRef, sanitizeSelectionRef, type SelectionRef } from './view-selection-ref.js';
import { isViewScope, scopeDefault, type ScopedView, type ViewScope } from './view-scope.js';
import { isKnowsGroup, type KnowsGroup } from './knows-group.js';

/** How many recently cited sources the picker remembers per tree. */
export const RECENT_SOURCES_MAX = 5;

/** What the card shows at a glance (Settings → "Show on card"), per device. All on by default (spec 066 P4 §4). */
export interface CardSignals {
    /** Person status: the one mark of sources and reliability (spec 066 P4 §1). */
    status: boolean;
    /** Person status: the story's folded corner. */
    story: boolean;
    /** Action badge: the research waits for the user about this person. */
    waiting: boolean;
    conflict: boolean;
    question: boolean;
    /** Action badge: the agent works on (or has queued) this person, while live. */
    agent: boolean;
    /** Links: the ⇄ N pill of a person who is also in another tree on this device. */
    crossTree: boolean;
}

export const CARD_SIGNAL_DEFAULTS: Readonly<CardSignals> = {
    status: true, story: true, waiting: true, conflict: true, question: true, agent: true, crossTree: true,
};

export const CARD_SIGNAL_KEYS = Object.keys(CARD_SIGNAL_DEFAULTS) as (keyof CardSignals)[];

/** The version of the stored card signals: 2 = `status` and `crossTree` (spec 066 P4 §8). */
export const CARD_SIGNALS_VERSION = 2;

/**
 * The stored card signals of an older build, brought to version 2 (spec 066 P4 §8), pure:
 * `status = evidence !== false || reliabilityTree === true` (the evidence stripes, or the
 * reliability mini mark chosen on purpose), `crossTree` = the general setting `crossTreeBadges`
 * (missing: on). The old keys stay as they were (older builds read them); a stored version 2
 * is returned as it is, so a second load changes nothing.
 */
export function migrateCardSignals(stored: Record<string, unknown>,
    app: { reliabilityTree?: boolean; crossTreeBadges?: boolean }): { stored: Record<string, unknown>; changed: boolean } {
    if (typeof stored.v === 'number' && stored.v >= CARD_SIGNALS_VERSION) return { stored, changed: false };
    return {
        stored: {
            ...stored,
            status: stored.evidence !== false || app.reliabilityTree === true,
            crossTree: app.crossTreeBadges !== false,
            v: CARD_SIGNALS_VERSION,
        },
        changed: true,
    };
}

/** The person card timeline's default in a tree (spec 020 K4.5). */
export interface LifelineDefaults {
    childEvents: boolean;
    history: boolean;
}

/**
 * The Timeline's history options in a tree (spec 121 §0): the kinds shown
 * (absent: all), the region (absent: all) and local history on the life lines
 * (default off). This device only: never in the tree, an export, GEDCOM or a backup.
 */
export interface TimelineHistoryOptions {
    kinds?: HistoryKind[];
    region?: string;
    local: boolean;
}

/** A tree's remembered selection of people (spec 098 §7): the main window's, with its "Hide others". */
export interface StoredSelection {
    ref: SelectionRef;
    hideOthers: boolean;
}

/** The map's scope remembered per tree (spec 098 §3, §7). */
export type StoredMapScope = ViewScope;

/**
 * The map's scope remembered per tree before spec 098 §11 (`mapScopeByTree`)
 * becomes the map's part of the scopes per tree and view (`scopeByTree`),
 * pure: a scope already stored there wins; `mapScopeByTree` goes. Returns
 * whether anything changed (the caller stores it).
 */
export function migrateMapScopeByTree(settings: AppSettings): boolean {
    const old = settings.mapScopeByTree;
    if (!old) return false;
    const all: NonNullable<AppSettings['scopeByTree']> = { ...(settings.scopeByTree ?? {}) };
    for (const [treeId, scope] of Object.entries(old)) {
        if (!isViewScope(scope) || all[treeId]?.map) continue;
        all[treeId] = { ...(all[treeId] ?? {}), map: scope };
    }
    delete settings.mapScopeByTree;
    if (Object.keys(all).length) settings.scopeByTree = all;
    return true;
}

/**
 * The family line remembered per tree before spec 098 (`rodByTree`) becomes
 * the tree's selection (`selectionByTree`, a line, Hide others off), pure:
 * a selection already stored for the tree wins; `rodByTree` goes. Returns
 * whether anything changed (the caller stores it).
 */
export function migrateRodByTree(settings: AppSettings): boolean {
    const old = settings.rodByTree;
    if (!old) return false;
    const all = { ...(settings.selectionByTree ?? {}) };
    for (const [treeId, rodId] of Object.entries(old)) {
        if (typeof rodId !== 'string' || !rodId || all[treeId]) continue;
        all[treeId] = { ref: { kind: 'rod', rodId }, hideOthers: false };
    }
    delete settings.rodByTree;
    if (Object.keys(all).length) settings.selectionByTree = all;
    return true;
}

/** Per device, apart from the other settings. */
/** The key a program's saved merge rule is stored under: trimmed, spaces folded, lower case ('' for no program). */
export function mergeRuleKey(program: string): string {
    return program.trim().replace(/\s+/g, ' ').toLowerCase();
}

const MERGE_SCOPES: readonly string[] = ['a', 'b', 'c', 'd'];
const MERGE_RULE_CHOICES: readonly string[] = ['mine', 'import', 'both', 'precise', 'each'];
const MERGE_RULE_KINDS: readonly string[] = ['name', 'birth', 'death', 'places', 'events', 'notes', 'photos', 'sex', 'marriage'];

/** A stored merge rule as it can be used, or null when it is not one (an older or hand-edited store). */
export function sanitizeMergeRule(value: unknown): SavedMergeRule | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    const rules = v.rules as Record<string, unknown> | undefined;
    if (typeof v.program !== 'string' || !v.program.trim() || !MERGE_SCOPES.includes(v.scope as string)
        || !rules || !MERGE_RULE_CHOICES.includes(rules.all as string)) return null;
    const kind: Record<string, string> = {};
    if (rules.kind && typeof rules.kind === 'object') {
        for (const [k, c] of Object.entries(rules.kind as Record<string, unknown>)) {
            if (MERGE_RULE_KINDS.includes(k) && MERGE_RULE_CHOICES.includes(c as string)) kind[k] = c as string;
        }
    }
    return {
        program: v.program.trim(),
        scope: v.scope as SavedMergeRule['scope'],
        rules: { all: rules.all as SavedMergeRule['rules']['all'], ...(Object.keys(kind).length ? { kind: kind as SavedMergeRule['rules']['kind'] } : {}) },
        savedAt: typeof v.savedAt === 'string' ? v.savedAt : '',
    };
}

export const CARD_SIGNALS_KEY = 'strom-card-signals';

/** The kinds of places the map shows (spec 031 §1), per device, apart from the other settings. */
export const MAP_KINDS_KEY = 'strom.map.kinds';

/** Fallback sender names that older builds stored as if typed (cs/en/de). */
const FORMER_SENDER_PLACEHOLDERS = new Set(['Příbuzný', 'A relative', 'Ein Verwandter', 'Ein Familienmitglied']);

const DEFAULT_SETTINGS: Readonly<AppSettings> = { theme: 'system', language: 'system', encryption: false, auditLog: false };

/** What changed when another window wrote the settings (watchOtherWindows). */
export interface SettingsChange {
    /** The language setting before the change (the caller switches the texts when it differs). */
    languageBefore: LanguageSetting;
}

class SettingsManagerClass {
    private settings: AppSettings = { ...DEFAULT_SETTINGS };
    /**
     * A window that is not the main one (a satellite, a second tab, spec 079
     * §0): the settings are read, never written — the main window is the
     * only one that stores them. A change here stays in this window.
     */
    private readOnly = false;

    /** Card signals changed in a read-only window: kept here, never stored. */
    private localCardSignals: Record<string, unknown> | null = null;

    /** The map's kinds changed in a read-only window: kept here, never stored. */
    private localMapKinds: MapKind[] | null = null;

    /** The grouping of "What the research knows" chosen in a read-only window, per tree: kept here, never stored. */
    private localKnowsGroups: Map<string, KnowsGroup> | null = null;

    init(): void {
        this.load();
        this.applyTheme();
        this.applyLanguage();
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)')
            .addEventListener('change', () => this.applyTheme());
    }

    /** Settings only read in this window (spec 079 §0); set before init. */
    setReadOnly(on: boolean): void {
        this.readOnly = on;
        if (!on) { this.localCardSignals = null; this.localMapKinds = null; this.localKnowsGroups = null; }
    }

    isReadOnly(): boolean {
        return this.readOnly;
    }

    /**
     * Follow the settings another window stores (the main window): they are
     * read again, the theme follows at once, `onChange` does the rest (the
     * language, a redraw). Returns the unsubscribe.
     */
    watchOtherWindows(onChange: (change: SettingsChange) => void): () => void {
        const handler = (e: StorageEvent): void => {
            if (e.key !== null && e.key !== SETTINGS_KEY && e.key !== CARD_SIGNALS_KEY && e.key !== MAP_KINDS_KEY) return;
            const languageBefore = this.settings.language;
            this.settings = { ...DEFAULT_SETTINGS };
            // What the main window stores wins over a change made here, as for the other settings.
            this.localCardSignals = null;
            this.localMapKinds = null;
            this.localKnowsGroups = null;
            this.load();
            this.applyTheme();
            onChange({ languageBefore });
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
    }

    private load(): void {
        try {
            const stored = localStorage.getItem(SETTINGS_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Merge with defaults (for forward compatibility)
                this.settings = { ...this.settings, ...parsed };
                // Spec 098 §7: the family line remembered per tree becomes the tree's selection.
                // Spec 098 §11: the map's scope per tree becomes the map's part of the scopes per tree and view.
                const scopes = migrateMapScopeByTree(this.settings);
                if (migrateRodByTree(this.settings) || scopes) this.saveQuietly();
            }
        } catch {
            // Use defaults on error
        }
    }

    private save(): void {
        if (this.readOnly) return;
        // Lineage markers (spec 112, R1): the first write stores the migrated choice instead of the old flag.
        if (this.settings.branchMarker === undefined || 'branchColors' in this.settings
            || (this.settings.branchMarker as string) === 'off') {
            this.settings.branchMarker = this.getBranchMarker();
            delete this.settings.branchColors;
        }
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

    /** Titles of the name ("Ing.", "ml.") shown with it, default ON (undefined = shown). */
    isShowTitles(): boolean {
        return this.settings.showTitles !== false;
    }

    setShowTitles(enabled: boolean): void {
        this.settings.showTitles = enabled;
        this.save();
    }

    /** Display: the reliability marks on the person card (`display.reliabilityCard`), default ON. */
    isReliabilityCardEnabled(): boolean {
        return this.settings.reliabilityCard !== false;
    }

    setReliabilityCard(enabled: boolean): void {
        this.settings.reliabilityCard = enabled;
        this.save();
    }

    /** Which surname names show, default 'both' (married surname with the birth one as a note). */
    getSurnameDisplay(): SurnameDisplay {
        const v = this.settings.surnameDisplay;
        return v && SURNAME_DISPLAYS.includes(v) ? v : 'both';
    }

    setSurnameDisplay(display: SurnameDisplay): void {
        this.settings.surnameDisplay = SURNAME_DISPLAYS.includes(display) ? display : 'both';
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
     * What the person card's life timeline shows by default in a tree (spec
     * 020 K4.5, set in the tree's settings, this browser): the children's
     * deaths, burials, marriages and divorces (default off) and history (the
     * "History" chip, default on). A tree never set follows the former one
     * choice for every tree (`lifelineChildEvents`, `lifelineHistory`), so
     * nothing is lost. Only the card's timeline reads it; its chips change it
     * for a while only (src/lifeline-view.ts).
     */
    getLifelineDefaults(treeId: string | null): LifelineDefaults {
        const own = treeId ? this.settings.lifelineByTree?.[treeId] : undefined;
        return {
            childEvents: own?.childEvents ?? this.settings.lifelineChildEvents === true,
            history: own?.history ?? this.settings.lifelineHistory !== false,
        };
    }

    setLifelineDefaults(treeId: string, defaults: LifelineDefaults): void {
        const all = (this.settings.lifelineByTree ??= {});
        const kinds = all[treeId]?.kinds;
        const timeline = all[treeId]?.timeline;
        all[treeId] = { childEvents: defaults.childEvents, history: defaults.history, ...(kinds ? { kinds } : {}), ...(timeline ? { timeline } : {}) };
        this.save();
    }

    /**
     * The Timeline's history options of a tree (spec 121 §0), read
     * defensively: unknown kinds dropped, all nine (or none valid) = no
     * filter. A region the research no longer has is the caller's to drop.
     */
    getTimelineHistory(treeId: string | null): TimelineHistoryOptions {
        const own = treeId ? this.settings.lifelineByTree?.[treeId]?.timeline : undefined;
        const kinds = Array.isArray(own?.kinds) ? HISTORY_KINDS.filter(k => own!.kinds!.some(v => isHistoryKind(v) && v === k)) : null;
        const region = typeof own?.region === 'string' && own.region ? own.region : undefined;
        return {
            ...(kinds && kinds.length < HISTORY_KINDS.length && (kinds.length || own!.kinds!.length === 0) ? { kinds } : {}),
            ...(region ? { region } : {}),
            local: own?.local === true,
        };
    }

    setTimelineHistory(treeId: string, o: TimelineHistoryOptions): void {
        const all = (this.settings.lifelineByTree ??= {});
        const entry = (all[treeId] ??= {});
        const kinds = o.kinds ? HISTORY_KINDS.filter(k => o.kinds!.includes(k)) : null;
        const timeline = {
            ...(kinds && kinds.length < HISTORY_KINDS.length ? { kinds } : {}),
            ...(o.region ? { region: o.region } : {}),
            ...(o.local ? { local: true } : {}),
        };
        if (Object.keys(timeline).length) entry.timeline = timeline;
        else delete entry.timeline;
        this.save();
    }

    /** Forget a tree's timeline defaults (the tree was deleted). */
    forgetLifelineDefaults(treeId: string): void {
        // The tree's selection and map scope go with it (spec 039 §3.5, 098 §7).
        let changed = false;
        // And the grouping of "What the research knows" (spec 140 K1.4).
        for (const all of [this.settings.selectionByTree, this.settings.scopeByTree, this.settings.knowsGroupByTree]) {
            if (all?.[treeId]) { delete all[treeId]; changed = true; }
        }
        if (!this.settings.lifelineByTree?.[treeId]) { if (changed) this.save(); return; }
        delete this.settings.lifelineByTree[treeId];
        this.save();
    }

    /** The selection of people remembered for a tree (spec 098 §7), checked; null: none. */
    getSelectionForTree(treeId: string | null): StoredSelection | null {
        const own = treeId ? this.settings.selectionByTree?.[treeId] : undefined;
        const ref = sanitizeSelectionRef(own?.ref);
        return ref ? { ref, hideOthers: own?.hideOthers === true } : null;
    }

    /**
     * Remember (or, with null, forget) a tree's selection. Only the main
     * window remembers (§7): another window keeps its selection in its own
     * state and changes nothing here. Stored only when it changed.
     */
    setSelectionForTree(treeId: string, sel: StoredSelection | null): void {
        if (this.readOnly) return;
        const now = this.getSelectionForTree(treeId);
        if (!now && !sel) return;
        if (now && sel && sameSelectionRef(now.ref, sel.ref) && now.hideOthers === sel.hideOthers) return;
        if (sel) (this.settings.selectionByTree ??= {})[treeId] = { ref: { ...sel.ref }, hideOthers: sel.hideOthers };
        else delete this.settings.selectionByTree![treeId];
        this.save();
    }

    /** A view's scope remembered for a tree (spec 098 §7, §11); null: never chosen. */
    getScopeForTree(treeId: string | null, view: ScopedView): ViewScope | null {
        const v = treeId ? this.settings.scopeByTree?.[treeId]?.[view] : undefined;
        return isViewScope(v) ? v : null;
    }

    /**
     * Remember a view's scope for a tree (null or the view's default:
     * forgotten). The main window only (a read-only window writes nothing),
     * stored only when it changed.
     */
    setScopeForTree(treeId: string, view: ScopedView, scope: ViewScope | null): void {
        if (this.readOnly) return;
        const next = scope === scopeDefault(view) ? null : scope;
        if (this.getScopeForTree(treeId, view) === next) return;
        const all = (this.settings.scopeByTree ??= {});
        const entry = { ...(all[treeId] ?? {}) };
        if (next) entry[view] = next;
        else delete entry[view];
        if (Object.keys(entry).length) all[treeId] = entry;
        else delete all[treeId];
        this.save();
    }

    /** How "What the research knows" is grouped for a tree (spec 140 K1.4); 'none' when never chosen. */
    getKnowsGroupForTree(treeId: string | null): KnowsGroup {
        if (!treeId) return 'none';
        const local = this.localKnowsGroups?.get(treeId);
        if (local) return local;
        const v = this.settings.knowsGroupByTree?.[treeId];
        return isKnowsGroup(v) ? v : 'none';
    }

    /**
     * Remember how "What the research knows" is grouped for a tree ('none':
     * forgotten). Stored by the main window only; a read-only window keeps
     * its choice here until the main window's settings change.
     */
    setKnowsGroupForTree(treeId: string, group: KnowsGroup): void {
        if (this.getKnowsGroupForTree(treeId) === group) return;
        if (this.readOnly) {
            (this.localKnowsGroups ??= new Map()).set(treeId, group);
            return;
        }
        const all = (this.settings.knowsGroupByTree ??= {});
        if (group === 'none') delete all[treeId];
        else all[treeId] = group;
        if (Object.keys(all).length === 0) delete this.settings.knowsGroupByTree;
        this.save();
    }

    /** The map's scope remembered for a tree (spec 098 §7); null: never chosen. */
    getMapScopeForTree(treeId: string | null): StoredMapScope | null {
        return this.getScopeForTree(treeId, 'map');
    }

    /** Remember (or, with null, forget) a tree's map scope; the main window only, stored only when it changed. */
    setMapScopeForTree(treeId: string, scope: StoredMapScope | null): void {
        this.setScopeForTree(treeId, 'map', scope);
    }

    /**
     * Experiment (spec 020): the research's events of the time in the person
     * card's life timeline. On by default (undefined = never chosen); a user's
     * own "off" stays.
     */
    isHistoryLayer(): boolean {
        return this.settings.historyLayer !== false;
    }

    setHistoryLayer(enabled: boolean): void {
        this.settings.historyLayer = enabled;
        this.save();
    }

    /** The card's line "the research does not look for history yet" was closed (spec 020 K1.6): this browser, every tree. */
    isHistoryStripClosed(): boolean {
        return this.settings.historyStripClosed === true;
    }

    setHistoryStripClosed(closed: boolean): void {
        this.settings.historyStripClosed = closed;
        this.save();
    }

    /**
     * The kinds of history the card's timeline shows (spec 1028 §6): each on
     * by default, this browser only. Settings hold the default of every tree;
     * a tree's own choice (spec 020 K8.6, its settings) wins for that tree.
     */
    getHistoryKinds(treeId: string | null = null): { region: boolean; place: boolean; local: boolean } {
        const own = treeId ? this.settings.lifelineByTree?.[treeId]?.kinds : undefined;
        return {
            region: own?.region ?? this.settings.historyKindRegion !== false,
            place: own?.place ?? this.settings.historyKindPlace !== false,
            local: own?.local ?? this.settings.historyKindLocal !== false,
        };
    }

    /** The tree has its own choice of a kind (K8.6). */
    hasTreeHistoryKinds(treeId: string | null): boolean {
        const own = treeId ? this.settings.lifelineByTree?.[treeId]?.kinds : undefined;
        return !!own && Object.keys(own).length > 0;
    }

    /**
     * A tree's kinds (K8.6): a kind equal to the Settings' default is not kept,
     * so a tree follows a later change of the default until it differs.
     */
    setTreeHistoryKinds(treeId: string, kinds: { region: boolean; place: boolean; local: boolean }): void {
        const all = (this.settings.lifelineByTree ??= {});
        const entry = (all[treeId] ??= {});
        const base = this.getHistoryKinds();
        const own: { region?: boolean; place?: boolean; local?: boolean } = {};
        for (const k of ['region', 'place', 'local'] as const) if (kinds[k] !== base[k]) own[k] = kinds[k];
        if (Object.keys(own).length) entry.kinds = own;
        else delete entry.kinds;
        this.save();
    }

    setHistoryKind(kind: 'region' | 'place' | 'local', on: boolean): void {
        if (kind === 'region') this.settings.historyKindRegion = on;
        else if (kind === 'place') this.settings.historyKindPlace = on;
        else this.settings.historyKindLocal = on;
        this.save();
    }

    /** History of places → Places: all places by people (default) or alphabetically. */
    getHistoryPlacesSort(): 'persons' | 'alpha' {
        return this.settings.historyPlacesSort === 'alpha' ? 'alpha' : 'persons';
    }

    setHistoryPlacesSort(sort: 'persons' | 'alpha'): void {
        this.settings.historyPlacesSort = sort;
        this.save();
    }

    /** Places dialog: the order of the places (default by state; an old 'unplaced' is the state order). */
    getPlacesSort(): PlacesSort {
        return readPlacesSort(this.settings.placesSort);
    }

    setPlacesSort(sort: PlacesSort): void {
        this.settings.placesSort = sort;
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

    /** The import guide's rule saved for files of `program` (spec 134 K10.4), or null. */
    getMergeRule(program: string): SavedMergeRule | null {
        const key = mergeRuleKey(program);
        return key ? sanitizeMergeRule(this.settings.mergeRules?.[key]) : null;
    }

    /** Every saved merge rule with its key, by program name. */
    getMergeRules(): Array<{ key: string; rule: SavedMergeRule }> {
        return Object.entries(this.settings.mergeRules ?? {})
            .flatMap(([key, value]) => {
                const rule = sanitizeMergeRule(value);
                return rule ? [{ key, rule }] : [];
            })
            .sort((a, b) => a.rule.program.localeCompare(b.rule.program));
    }

    /** Save the rule for files of its program (one per program: a newer one replaces it). */
    setMergeRule(rule: SavedMergeRule): void {
        const key = mergeRuleKey(rule.program);
        const clean = sanitizeMergeRule(rule);
        if (!key || !clean) return;
        (this.settings.mergeRules ??= {})[key] = clean;
        this.save();
    }

    /** Forget a saved merge rule (Settings › Remove). */
    removeMergeRule(key: string): void {
        if (!this.settings.mergeRules?.[key]) return;
        delete this.settings.mergeRules[key];
        if (!Object.keys(this.settings.mergeRules).length) delete this.settings.mergeRules;
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
                personSourceIds(p).length > 0 || personMediaCount(data, p.id) > 0
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

    /** "What's new" after an update, default ON (undefined = enabled). */
    isWhatsNewAfterUpdateEnabled(): boolean {
        return this.settings.whatsNewAfterUpdate !== false;
    }

    setWhatsNewAfterUpdate(enabled: boolean): void {
        this.settings.whatsNewAfterUpdate = enabled;
        this.save();
    }

    /**
     * Shape of the lineage marker (spec 112, R1), default the arc. Settings
     * from before it keep their choice: branch colours off → 'none' (no tint),
     * on → 'arc'. The 'off' of 3.30.0-beta.6 reads as 'none'.
     */
    getBranchMarker(): BranchMarker {
        const m = this.settings.branchMarker;
        if (m && (BRANCH_MARKERS as readonly string[]).includes(m)) return m;
        if ((m as string | undefined) === 'off') return 'none';
        return this.settings.branchColors === false ? 'none' : 'arc';
    }

    setBranchMarker(marker: BranchMarker): void {
        this.settings.branchMarker = marker;
        delete this.settings.branchColors;
        this.save();
    }

    /** Cards tinted in the lineage colour: its own switch, with any shape or alone (Milan 19 Nov 2026). */
    isBranchTintOn(): boolean {
        return this.settings.branchTint === true;
    }

    /**
     * Any lineage marking on the cards: a shape, the tint, or both. The cards'
     * line classes, the legend, the Timeline, the Table, the Fan, the Map and
     * the image export follow it ('none' without the tint = no marking).
     */
    isBranchMarkingOn(): boolean {
        return this.getBranchMarker() !== 'none' || this.isBranchTintOn();
    }

    setBranchTint(on: boolean): void {
        this.settings.branchTint = on;
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

    /** The ⇄ N pill of a person also in another tree: Settings → Show on card → Links (per device, spec 066 P4 §8). Default ON. */
    isCrossTreeBadgesEnabled(): boolean {
        return this.getCardSignals().crossTree;
    }

    setCrossTreeBadges(enabled: boolean): void {
        this.setCardSignal('crossTree', enabled);
    }

    /** Kekulé (ahnentafel) numbers in the fan chart. Default OFF (genealogist tool). */
    isFanKekuleEnabled(): boolean {
        return this.settings.fanKekule === true;
    }

    setFanKekule(enabled: boolean): void {
        this.settings.fanKekule = enabled;
        this.save();
    }

    /**
     * The card type: compact (names only), normal (default), detailed and
     * register (preset lines), custom (the user's lines). A stored value this
     * version does not know is the Normal card.
     */
    getCardDensity(): CardDensity {
        return normalizeCardDensity(this.settings.cardDensity);
    }

    setCardDensity(density: CardDensity): void {
        this.settings.cardDensity = density;
        this.save();
    }

    /** Settings → Person card → Photo on the card (spec 096): its size and shape; absent or unknown = small + circle. */
    getCardPhoto(): { size: CardPhotoSize; shape: CardPhotoShape } {
        return normalizeCardPhoto(this.settings.cardPhoto);
    }

    setCardPhoto(photo: { size?: CardPhotoSize; shape?: CardPhotoShape }): void {
        this.settings.cardPhoto = normalizeCardPhoto(photo);
        this.save();
    }

    /** The export dialog's scope: the whole tree, only the current view or a list of people (spec 084 §12). */
    getExportScope(): 'tree' | 'view' | 'list' {
        const s = this.settings.exportScope;
        return s === 'view' || s === 'list' ? s : 'tree';
    }

    setExportScope(scope: 'tree' | 'view' | 'list'): void {
        this.settings.exportScope = scope;
        this.save();
    }

    /** The list of the export dialog's list scope (an id of the tree's list; another tree's falls back). */
    getExportListId(): string | null {
        return typeof this.settings.exportListId === 'string' ? this.settings.exportListId : null;
    }

    setExportListId(id: string): void {
        this.settings.exportListId = id;
        this.save();
    }

    /** Spacing of the tree view (Settings → Person card → Spacing); absent or unknown = normal. */
    getTreeSpacing(): TreeSpacing {
        return this.settings.treeSpacing === 'dense' ? 'dense' : 'normal';
    }

    setTreeSpacing(spacing: TreeSpacing): void {
        this.settings.treeSpacing = spacing;
        this.save();
    }

    /** Spacing of an exported image, poster or PDF (the export dialog); absent or unknown = normal. */
    getPosterSpacing(): TreeSpacing {
        return this.settings.posterSpacing === 'dense' ? 'dense' : 'normal';
    }

    setPosterSpacing(spacing: TreeSpacing): void {
        this.settings.posterSpacing = spacing;
        this.save();
    }

    /** Whether the user ever picked a density (the sample tree picks one only if not). */
    hasCardDensity(): boolean {
        return this.settings.cardDensity !== undefined;
    }

    /** The Custom card's stored lines (src/card-fields.ts), repaired to a valid set. */
    getCardFields(): CardFieldSettings {
        return normalizeCardFields(this.settings.cardFields);
    }

    /**
     * The lines the card type draws (src/card-fields.ts effectiveCardFields):
     * the preset's for Detailed and Register, the stored Custom ones for
     * Custom, null for Compact and Normal.
     */
    getEffectiveCardFields(density: CardDensity = this.getCardDensity()): CardFieldSettings | null {
        return effectiveCardFields(density, this.settings.cardFields);
    }

    setCardFields(fields: CardFieldSettings): void {
        this.settings.cardFields = normalizeCardFields(fields);
        this.save();
    }

    /**
     * The card box for the current density (the layout spaces cards by it).
     * The Normal card with a medium or large photo (spec 096 §2) is wider,
     * only in a view where someone drawn has an avatar, a photo or the
     * initials (`viewHasAvatar`, D3, spec 103 K2.1); its base height stays 64
     * (a large card's own height: personHeights).
     */
    getCardSize(viewHasAvatar = false): { cardWidth: number; cardHeight: number } {
        const density = this.getCardDensity();
        const fields = this.getEffectiveCardFields(density);
        if (density === 'normal') {
            const box = NORMAL_PHOTO_BOX[viewHasAvatar ? this.getCardPhoto().size : 'small'];
            return { cardWidth: box.cardWidth, cardHeight: CARD_SIZE.normal.cardHeight };
        }
        if (!fields) return CARD_SIZE[density as 'compact' | 'normal'];
        return customCardSize(fields.on.length, fields.years, viewHasAvatar ? this.getCardPhoto().size : 'small');
    }

    /** The stored card signals as they are (older builds' keys kept), brought to version 2 once (spec 066 P4 §8). */
    private loadCardSignals(): Record<string, unknown> {
        if (this.localCardSignals) return this.localCardSignals;
        let parsed: Record<string, unknown> = {};
        try {
            const raw: unknown = JSON.parse(localStorage.getItem(CARD_SIGNALS_KEY) ?? '{}');
            if (raw && typeof raw === 'object' && !Array.isArray(raw)) parsed = raw as Record<string, unknown>;
        } catch { /* defaults */ }
        // The older switches as stored (read straight, so the order of start-up does not matter).
        let app: { reliabilityTree?: boolean; crossTreeBadges?: boolean } = this.settings;
        try {
            const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
            if (raw && typeof raw === 'object') app = { ...this.settings, ...(raw as typeof app) };
        } catch { /* the loaded settings */ }
        const { stored, changed } = migrateCardSignals(parsed, app);
        if (changed && !this.readOnly) {
            try { localStorage.setItem(CARD_SIGNALS_KEY, JSON.stringify(stored)); } catch { /* converted again next time */ }
        }
        return stored;
    }

    /** What the card shows at a glance, for this device. */
    getCardSignals(): CardSignals {
        const out: CardSignals = { ...CARD_SIGNAL_DEFAULTS };
        const stored = this.loadCardSignals();
        for (const k of CARD_SIGNAL_KEYS) if (typeof stored[k] === 'boolean') out[k] = stored[k] as boolean;
        return out;
    }

    setCardSignal(key: keyof CardSignals, on: boolean): void {
        const next = { ...this.loadCardSignals(), ...this.getCardSignals(), [key]: on, v: CARD_SIGNALS_VERSION };
        if (this.readOnly) { this.localCardSignals = next; return; }
        try { localStorage.setItem(CARD_SIGNALS_KEY, JSON.stringify(next)); } catch { /* not kept */ }
    }

    /**
     * The kinds of places the map shows, for this device, in MAP_KINDS order.
     * All four by default; a stored list that is empty or holds no known kind
     * reads as all four (at least one kind always stays on).
     */
    getMapKinds(): MapKind[] {
        if (this.localMapKinds) return [...this.localMapKinds];
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(MAP_KINDS_KEY) ?? 'null');
            if (Array.isArray(parsed)) {
                const on = MAP_KINDS.filter(k => parsed.some(v => isMapKind(v) && v === k));
                if (on.length) return on;
            }
        } catch { /* defaults */ }
        return [...MAP_KINDS];
    }

    /** Remember the map's kinds for this device; an empty list is kept as all four. */
    setMapKinds(kinds: readonly MapKind[]): void {
        const on = MAP_KINDS.filter(k => kinds.includes(k));
        if (this.readOnly) { this.localMapKinds = on.length ? on : [...MAP_KINDS]; return; }
        try { localStorage.setItem(MAP_KINDS_KEY, JSON.stringify(on.length ? on : [...MAP_KINDS])); } catch { /* not kept */ }
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
        const name = this.settings.senderName ?? '';
        // Older builds remembered the fallback placeholder as the sender's own
        // name; it is not a name, so it reads as none.
        return FORMER_SENDER_PLACEHOLDERS.has(name) ? '' : name;
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

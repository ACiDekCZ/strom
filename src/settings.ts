/**
 * Settings Manager - Local app settings stored in localStorage
 * Settings are NOT exported with tree data - they are local preferences
 */

import { AppSettings, ThemeMode, LanguageSetting, SETTINGS_KEY } from './types.js';
import { initLanguage, Language } from './strings.js';

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

    /** Floating zoom buttons default ON (undefined = enabled). */
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

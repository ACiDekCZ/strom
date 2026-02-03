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

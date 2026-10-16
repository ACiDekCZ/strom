/**
 * Links of the About dialog that depend on the UI language. The Czech users'
 * group on Facebook is a Czech community, so it is offered only in the Czech
 * UI (same gating idea as isCzechRelevant in archives.ts); other languages get
 * no link at all. A plain link — no Facebook script, widget or remote icon.
 */

import type { Language } from './strings.js';
import { getStringsForLang } from './strings.js';
import { BETA_HOSTNAME, PWA_HOSTNAME } from './types.js';

export const USERS_GROUP_URL = 'https://www.facebook.com/groups/stromapp';

/** The changelog files on GitHub: blob/<branch>/<file>. */
export const CHANGELOG_BASE_URL = 'https://github.com/ACiDekCZ/strom/blob/';

export interface AboutExternalLink {
    href: string;
    label: string;
    target: '_blank';
    rel: string;
}

/** The users' group link for the given UI language, or null where it is not offered. */
export function aboutUsersGroupLink(lang: Language): AboutExternalLink | null {
    if (lang !== 'cs') return null;
    return {
        href: USERS_GROUP_URL,
        label: getStringsForLang(lang).about.usersGroup,
        target: '_blank',
        rel: 'noopener noreferrer',
    };
}

/**
 * GitHub's anchor of a version section of the changelog: the heading
 * "## 3.12.0" becomes "#3120". A pre-release suffix is dropped, so a beta of
 * 3.12.0 points at the section of the version it prepares.
 */
export function changelogAnchor(version: string): string {
    return version.split(/[-+]/)[0].replace(/[^0-9]/g, '');
}

/** The UI languages with a changelog file of their own; any other reads the English one. */
function changelogLanguage(lang: Language): Language {
    return lang === 'cs' || lang === 'de' ? lang : 'en';
}

/** The changelog file of a changelog language (en → CHANGELOG.md, cs → CHANGELOG.cs.md, …). */
function changelogFile(lang: Language): string {
    return lang === 'en' ? 'CHANGELOG.md' : `CHANGELOG.${lang}.md`;
}

/**
 * Whether the changelog link of this build points at the beta branch. The
 * same rule as importFromFileUrl (pwa.ts): the beta site always, the public
 * site never, and anywhere else (a dev server, an exported or embedded file)
 * by the version, so a local beta build reads the beta changelog while a
 * released version always reads main. Pure for testing.
 */
export function changelogIsBeta(hostname: string, appVersion: string): boolean {
    return hostname === BETA_HOSTNAME || (hostname !== PWA_HOSTNAME && /-beta\b/.test(appVersion));
}

/**
 * The "What's new" link of the About dialog: the changelog on GitHub in the
 * UI language, at the section of the running version. A beta build reads the
 * beta branch (the section in preparation); every other build reads main,
 * which carries released versions only. Offered in every language.
 */
export function aboutChangelogLink(lang: Language, version: string, beta: boolean): AboutExternalLink {
    const known = changelogLanguage(lang);
    return {
        href: `${CHANGELOG_BASE_URL}${beta ? 'beta' : 'main'}/${changelogFile(known)}#${changelogAnchor(version)}`,
        label: getStringsForLang(known).about.whatsNew,
        target: '_blank',
        rel: 'noopener noreferrer',
    };
}

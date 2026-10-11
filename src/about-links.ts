/**
 * Links of the About dialog that depend on the UI language. The Czech users'
 * group on Facebook is a Czech community, so it is offered only in the Czech
 * UI (same gating idea as isCzechRelevant in archives.ts); other languages get
 * no link at all. A plain link — no Facebook script, widget or remote icon.
 */

import type { Language } from './strings.js';
import { getStringsForLang } from './strings.js';

export const USERS_GROUP_URL = 'https://www.facebook.com/groups/stromapp';

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

/**
 * Versions of the Strom app ("3.10.0", "3.10.0-beta.10", "3.10.0-rc.1") as
 * semantic versions: what a file's header says about the app that wrote it.
 */

const APP_VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;

/** A version of the app: three numbers, an optional pre-release and build ("1.0" is none). */
export function isAppVersion(value: string | undefined): boolean {
    return APP_VERSION_RE.test(value?.trim() ?? '');
}

/**
 * Semver precedence of two app versions: negative when `a` is older, 0 when
 * equal, positive when newer. A pre-release is older than its release, its
 * dot-separated parts compared one by one (numbers as numbers, below words;
 * words in ASCII order: beta < rc), so 3.10.0-beta.9 < 3.10.0-beta.10 <
 * 3.10.0-rc.1 < 3.10.0. Build metadata is ignored. Both must be app versions.
 */
export function compareAppVersions(a: string, b: string): number {
    const pa = APP_VERSION_RE.exec(a.trim());
    const pb = APP_VERSION_RE.exec(b.trim());
    if (!pa || !pb) throw new Error(`Not an app version: ${pa ? b : a}`);
    for (let i = 1; i <= 3; i++) {
        const d = Number(pa[i]) - Number(pb[i]);
        if (d !== 0) return d;
    }
    const preA = pa[4];
    const preB = pb[4];
    if (preA === undefined || preB === undefined) return preA === preB ? 0 : preA === undefined ? 1 : -1;
    const xs = preA.split('.');
    const ys = preB.split('.');
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
        const x = xs[i];
        const y = ys[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        const nx = /^\d+$/.test(x);
        const ny = /^\d+$/.test(y);
        if (nx && ny) {
            const d = Number(x) - Number(y);
            if (d !== 0) return d;
        } else if (nx !== ny) {
            return nx ? -1 : 1;
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return 0;
}

/**
 * The first app that writes a person of no name and no surname "? //"
 * (before it "? /Unknown/"): from it on, "? /Unknown/" in its file is the
 * surname Unknown someone typed. A real pre-release: earlier betas wrote the
 * old way. The research reads the app's files by the same version (its T08b).
 */
export const APP_WRITES_NO_SURNAME_EMPTY = '3.10.0-beta.7';

/**
 * Does a file of the Strom app (HEAD > 1 SOUR STROM) mean "? /Unknown/" as a
 * person of no surname? Yes when its `2 VERS` names no app version (missing,
 * or the fixed "1.0" of the older apps) or one before
 * 3.10.0-beta.7; from that version on it is the surname Unknown.
 */
export function appUnknownIsNoSurname(version: string | undefined): boolean {
    const v = version?.trim() ?? '';
    return !isAppVersion(v) || compareAppVersions(v, APP_WRITES_NO_SURNAME_EMPTY) < 0;
}

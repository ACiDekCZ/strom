/**
 * What changed between two versions of a multi-line text, line by line: the
 * lines both keep, the lines only the old one has (removed) and the lines
 * only the new one has (added). A changed line is the old line removed and
 * the new one added. Pure and DOM-free.
 *
 * The longest common subsequence of the lines decides what is kept; the
 * common start and end are taken off first, so a paragraph added at the end
 * or in the middle costs nothing. Lines compare without their trailing
 * spaces and Windows line ends, so spacing at a line's end never shows as a
 * change (the kept line is written as the new text has it).
 */

export type LineOp = 'same' | 'del' | 'add';

export interface LineDiffPart {
    op: LineOp;
    text: string;
}

/** Past this many line pairs the middle is compared whole (removed + added). */
const MAX_CELLS = 4_000_000;

function splitLines(text: string): string[] {
    return text.replace(/\r\n?/g, '\n').split('\n');
}

const key = (line: string): string => line.replace(/\s+$/u, '');

/** The lines of `oldText` and `newText` as kept, removed and added, in reading order. */
export function diffLines(oldText: string, newText: string): LineDiffPart[] {
    const a = splitLines(oldText);
    const b = splitLines(newText);
    const ka = a.map(key);
    const kb = b.map(key);
    let start = 0;
    while (start < a.length && start < b.length && ka[start] === kb[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) { endA--; endB--; }
    const out: LineDiffPart[] = [];
    for (let i = 0; i < start; i++) out.push({ op: 'same', text: b[i] });
    const n = endA - start;
    const m = endB - start;
    if (n > 0 && m > 0 && n * m <= MAX_CELLS) {
        // lcs[i][j]: the common lines of a[start+i..endA) and b[start+j..endB).
        const w = m + 1;
        const lcs = new Uint32Array((n + 1) * w);
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                lcs[i * w + j] = ka[start + i] === kb[start + j]
                    ? lcs[(i + 1) * w + j + 1] + 1
                    : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
            }
        }
        let i = 0;
        let j = 0;
        while (i < n || j < m) {
            if (i < n && j < m && ka[start + i] === kb[start + j]) {
                out.push({ op: 'same', text: b[start + j] });
                i++; j++;
            } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
                // Removed before added: a changed line reads old, then new.
                out.push({ op: 'del', text: a[start + i] });
                i++;
            } else {
                out.push({ op: 'add', text: b[start + j] });
                j++;
            }
        }
    } else {
        for (let i = start; i < endA; i++) out.push({ op: 'del', text: a[i] });
        for (let j = start; j < endB; j++) out.push({ op: 'add', text: b[j] });
    }
    for (let j = endB; j < b.length; j++) out.push({ op: 'same', text: b[j] });
    return out;
}

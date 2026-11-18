/**
 * A text whose number ranges ("57–58", "1860–1875") never break at their dash: in a narrow column a line
 * ending in "57–" with "58" on the next reads as two things. Each range is a span kept on one line.
 */

const RANGE = /\d+\s?[–-]\s?\d+/g;

/** `text` as nodes, each number range in a `.range-whole` span (nothing else changes). */
export function rangesWhole(text: string, doc: Document = document): DocumentFragment {
    const out = doc.createDocumentFragment();
    let at = 0;
    for (const m of text.matchAll(RANGE)) {
        const i = m.index ?? 0;
        if (i > at) out.appendChild(doc.createTextNode(text.slice(at, i)));
        const span = doc.createElement('span');
        span.className = 'range-whole';
        span.textContent = m[0];
        out.appendChild(span);
        at = i + m[0].length;
    }
    if (at < text.length) out.appendChild(doc.createTextNode(text.slice(at)));
    return out;
}

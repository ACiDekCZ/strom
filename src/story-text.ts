/**
 * The text of a story (or a long note) set as prose. The writer — often a
 * research agent writing a .md file — uses a little markdown; this renders a
 * fixed small set of it and nothing else, without any library:
 *   - a blank line: a paragraph; '\n' inside one: a line break;
 *   - a line `## …` (`#` to `######`): a subheading;
 *   - lines `- …`: a bulleted list (a line without the dash continues the item);
 *   - `**bold**` and `*italic*`.
 * A first line `# …` that only repeats the story's title is left out (the
 * reader and the book show the title already). Everything is escaped first, so
 * the only markup that survives is what is rendered here; any other markdown
 * stays plain text.
 *
 * Deliberately NOT list markers: `* ` (the genealogical birth mark, "* 1831")
 * and `1. ` (a Czech date opens a line: "1. ledna 1831 …").
 */

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*-\s+(.*)$/;

/** Bold, then italic: `*` opens before a non-space and closes after one, never inside a word. */
function inline(text: string): string {
    return esc(text)
        .replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*\p{L}\p{N}])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\p{L}\p{N}])/gu, '$1<em>$2</em>');
}

/** Compare a heading with the title: case, emphasis marks and edge punctuation aside. */
export function sameText(a: string, b: string): boolean {
    const norm = (s: string): string => s.replace(/[*_]/g, '').replace(/\s+/g, ' ')
        .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '').toLocaleLowerCase();
    return norm(a) !== '' && norm(a) === norm(b);
}

export interface StoryProseOptions {
    /** The story's title: a leading `# …` repeating it is left out. */
    title?: string;
    /** The heading level of `#`/`##` (`###` and deeper one below); default 4. */
    headingLevel?: number;
}

export function storyProseHtml(text: string, options: StoryProseOptions = {}): string {
    const base = Math.min(Math.max(options.headingLevel ?? 4, 1), 6);
    const out: string[] = [];
    let para: string[] = [];
    let items: string[][] = [];
    let first = true;

    const flushPara = (): void => {
        if (para.length > 0) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
        para = [];
    };
    const flushList = (): void => {
        if (items.length > 0) out.push(`<ul>${items.map(it => `<li>${it.map(inline).join('<br>')}</li>`).join('')}</ul>`);
        items = [];
    };

    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim();
        if (!line) {
            flushPara();
            flushList();
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            flushPara();
            flushList();
            const repeatsTitle = first && heading[1].length === 1 && !!options.title && sameText(heading[2], options.title);
            first = false;
            if (!repeatsTitle && heading[2]) {
                const level = Math.min(heading[1].length <= 2 ? base : base + 1, 6);
                out.push(`<h${level} class="story-subhead">${inline(heading[2])}</h${level}>`);
            }
            continue;
        }
        first = false;
        const bullet = BULLET.exec(raw);
        if (bullet) {
            flushPara();
            items.push([bullet[1].trim()]);
        } else if (items.length > 0) {
            items[items.length - 1].push(line);
        } else {
            para.push(line);
        }
    }
    flushPara();
    flushList();
    return out.join('');
}

/**
 * A strict XML 1.0 parser for tests: it reads a document into elements and
 * throws on anything a conforming parser rejects — a broken attribute
 * (`fontId=""0"`), a tag left open or closed by another name, a duplicate
 * attribute, a bare `&` or `<` in text or a value, an unknown entity, a
 * character XML does not allow (controls, lone surrogates, U+FFFE/FFFF),
 * "]]>" in text, a second root or text outside it. No DTD support (the
 * documents under test have none: a DOCTYPE is an error here).
 */

export interface XmlElement {
    name: string;
    attrs: Map<string, string>;
    children: XmlElement[];
    text: string;
}

const NAME = /[A-Za-z_:][A-Za-z0-9_:.\-]*/y;
const SPACE = /[ \t\r\n]+/y;

function allowedChar(cp: number): boolean {
    return cp === 0x9 || cp === 0xA || cp === 0xD
        || (cp >= 0x20 && cp <= 0xD7FF)
        || (cp >= 0xE000 && cp <= 0xFFFD)
        || (cp >= 0x10000 && cp <= 0x10FFFF);
}

/** Parse a whole document; returns its root element or throws with the offset of the first error. */
export function parseXml(src: string): XmlElement {
    let i = 0;
    const fail = (why: string): never => {
        const line = src.slice(0, i).split('\n').length;
        throw new Error(`XML not well-formed at ${i} (line ${line}): ${why} — ${JSON.stringify(src.slice(Math.max(0, i - 30), i + 30))}`);
    };
    // Every character must be one XML allows (surrogates only as pairs).
    for (let k = 0; k < src.length; k++) {
        const cp = src.codePointAt(k)!;
        if (cp > 0xFFFF) { k++; continue; }
        if (!allowedChar(cp)) { i = k; fail(`character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`); }
    }
    const match = (re: RegExp): string | null => {
        re.lastIndex = i;
        const m = re.exec(src);
        if (!m) return null;
        i += m[0].length;
        return m[0];
    };
    const expect = (s: string): void => {
        if (!src.startsWith(s, i)) fail(`expected ${JSON.stringify(s)}`);
        i += s.length;
    };
    const skipSpace = (): boolean => match(SPACE) !== null;
    const name = (): string => match(NAME) ?? fail('expected a name');
    /** Character data up to `stop`, with references resolved; `<` and a bare `&` are errors. */
    const chars = (stop: (c: string) => boolean, inValue: boolean): string => {
        let out = '';
        while (i < src.length && !stop(src[i])) {
            const c = src[i];
            if (c === '<') fail(inValue ? '"<" in an attribute value' : 'unexpected "<"');
            if (c === '&') {
                const m = /&(?:(amp|lt|gt|quot|apos)|#([0-9]+)|#x([0-9A-Fa-f]+));/y;
                m.lastIndex = i;
                const r = m.exec(src);
                if (!r) fail('a bare "&" or an unknown entity');
                const cp = r![1] ? undefined : r![2] ? parseInt(r![2], 10) : parseInt(r![3], 16);
                if (cp !== undefined && !allowedChar(cp)) fail(`a reference to U+${cp.toString(16)}`);
                out += r![1] ? { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[r![1] as 'amp'] : String.fromCodePoint(cp!);
                i += r![0].length;
                continue;
            }
            if (!inValue && src.startsWith(']]>', i)) fail('"]]>" in text');
            out += c;
            i++;
        }
        return out;
    };
    /** Comments and processing instructions (not the XML declaration). */
    const misc = (): boolean => {
        if (src.startsWith('<!--', i)) {
            const end = src.indexOf('-->', i + 4);
            if (end < 0) fail('an unclosed comment');
            if (src.slice(i + 4, end).includes('--')) fail('"--" in a comment');
            i = end + 3;
            return true;
        }
        if (src.startsWith('<?', i)) {
            i += 2;
            const target = name();
            if (target.toLowerCase() === 'xml') fail('an XML declaration not at the start');
            const end = src.indexOf('?>', i);
            if (end < 0) fail('an unclosed processing instruction');
            i = end + 2;
            return true;
        }
        if (src.startsWith('<!', i) && !src.startsWith('<![CDATA[', i)) fail('a DOCTYPE or other declaration');
        return false;
    };
    const element = (): XmlElement => {
        expect('<');
        const el: XmlElement = { name: name(), attrs: new Map(), children: [], text: '' };
        for (;;) {
            const spaced = skipSpace();
            if (src.startsWith('/>', i)) { i += 2; return el; }
            if (src[i] === '>') { i++; break; }
            if (!spaced) fail('no space before an attribute');
            const an = name();
            if (el.attrs.has(an)) fail(`attribute "${an}" twice`);
            skipSpace();
            expect('=');
            skipSpace();
            const q = src[i];
            if (q !== '"' && q !== "'") fail(`attribute "${an}" without a quoted value`);
            i++;
            const value = chars(c => c === q, true);
            expect(q);
            el.attrs.set(an, value);
        }
        // Content up to the matching end tag.
        for (;;) {
            if (i >= src.length) fail(`<${el.name}> never closed`);
            if (src.startsWith('</', i)) {
                i += 2;
                const end = name();
                if (end !== el.name) fail(`</${end}> closes <${el.name}>`);
                skipSpace();
                expect('>');
                return el;
            }
            if (src.startsWith('<![CDATA[', i)) {
                const end = src.indexOf(']]>', i + 9);
                if (end < 0) fail('an unclosed CDATA section');
                el.text += src.slice(i + 9, end);
                i = end + 3;
                continue;
            }
            if (misc()) continue;
            if (src[i] === '<') { el.children.push(element()); continue; }
            el.text += chars(c => c === '<', false);
        }
    };

    if (src.startsWith('﻿')) i = 1;
    if (src.startsWith('<?xml', i)) {
        const end = src.indexOf('?>', i);
        if (end < 0) fail('an unclosed XML declaration');
        const decl = src.slice(i, end + 2);
        if (!/^<\?xml\s+version\s*=\s*(["'])1\.[0-9]+\1(\s+encoding\s*=\s*(["'])[A-Za-z][A-Za-z0-9._-]*\3)?(\s+standalone\s*=\s*(["'])(yes|no)\5)?\s*\?>$/.test(decl)) {
            fail('a malformed XML declaration');
        }
        i = end + 2;
    }
    while (skipSpace() || misc()) { /* prolog */ }
    if (src[i] !== '<') fail('no root element');
    const root = element();
    while (skipSpace() || misc()) { /* trailing misc */ }
    if (i < src.length) fail('content after the root element');
    return root;
}

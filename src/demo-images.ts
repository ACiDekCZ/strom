/**
 * The sample tree's pictures, drawn on a canvas when it loads instead of
 * shipped inside the app: a register page with the entry written in one of
 * its rows, the crop of that row (exactly what the crop editor would cut),
 * and old-photo portrait stand-ins. They only have to show what a scan, an
 * excerpt or a portrait looks like in the tree — a few dozen lines of drawing
 * instead of hundreds of kilobytes of JPEG in every copy of the app.
 *
 * Deterministic (seeded), so the sample looks the same every time.
 */

import type { DemoImageMaker, DemoEntryImage } from './demo-tree.js';
import type { Gender } from './types.js';
import { dataUrlByteSize } from './photo.js';

const PAGE_W = 1000;
const PAGE_H = 1300;
const ROW_H = 120;
const FIRST_ROW = 150;
const ENTRY_ROW = 4;
const INK = '#3b2a1a';
const HAND = "italic 27px 'Segoe Script', 'Bradley Hand', 'Snell Roundhand', 'Apple Chancery', cursive";

/** Small seeded PRNG (mulberry32). */
function random(seed: number): () => number {
    let a = seed * 2654435761 >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function canvas(w: number, h: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    const ctx = el.getContext('2d');
    return ctx ? { el, ctx } : null;
}

function jpeg(el: HTMLCanvasElement, quality: number): { dataUrl: string; width: number; height: number; sizeBytes: number } {
    const dataUrl = el.toDataURL('image/jpeg', quality);
    return { dataUrl, width: el.width, height: el.height, sizeBytes: dataUrlByteSize(dataUrl) };
}

/** Aged paper: a warm base, darker towards the edges, faint speckles. */
function paper(ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number): void {
    ctx.fillStyle = '#eadcbc';
    ctx.fillRect(0, 0, w, h);
    const edge = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    edge.addColorStop(0, 'rgba(120, 90, 40, 0)');
    edge.addColorStop(1, 'rgba(120, 90, 40, 0.35)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < (w * h) / 900; i++) {
        ctx.fillStyle = `rgba(90, 60, 20, ${0.03 + rnd() * 0.06})`;
        ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
}

/** Words that look like handwriting without saying anything. */
function scribble(rnd: () => number, words: number): string {
    const syl = ['ber', 'ga', 'ard', 'mand', 'sen', 'hu', 'stru', 'fød', 'te', 'lin', 'dal', 'ols', 'kir', 'ke', 'af', 'og', 'pa', 'ne'];
    const out: string[] = [];
    for (let i = 0; i < words; i++) {
        const n = 1 + Math.floor(rnd() * 3);
        let w = '';
        for (let j = 0; j < n; j++) w += syl[Math.floor(rnd() * syl.length)];
        out.push(rnd() < 0.25 ? w[0].toUpperCase() + w.slice(1) : w);
    }
    return out.join(' ');
}

/** Write text word by word with a slight tremor, wrapping at maxWidth; returns the lines used. */
function hand(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number,
    lineH: number, maxLines: number, rnd: () => number): number {
    let cx = x;
    let line = 0;
    for (const word of text.split(/\s+/)) {
        const w = ctx.measureText(word).width;
        if (cx > x && cx + w > x + maxWidth) {
            line++;
            if (line >= maxLines) break;
            cx = x;
        }
        ctx.save();
        ctx.translate(cx, y + line * lineH + (rnd() - 0.5) * 2);
        ctx.rotate((rnd() - 0.5) * 0.03);
        ctx.fillText(word, 0, 0);
        ctx.restore();
        cx += w + ctx.measureText(' ').width;
    }
    return line + 1;
}

function entry(text: string, seed: number): DemoEntryImage | null {
    const page = canvas(PAGE_W, PAGE_H);
    if (!page) return null;
    const { ctx } = page;
    const rnd = random(seed);
    paper(ctx, PAGE_W, PAGE_H, rnd);

    // The register's ruling: a header band, a number column and a name column.
    ctx.strokeStyle = 'rgba(110, 70, 30, 0.45)';
    ctx.lineWidth = 1.5;
    const rows = Math.floor((PAGE_H - FIRST_ROW - 40) / ROW_H);
    for (let r = 0; r <= rows; r++) {
        ctx.beginPath();
        ctx.moveTo(50, FIRST_ROW + r * ROW_H);
        ctx.lineTo(PAGE_W - 50, FIRST_ROW + r * ROW_H);
        ctx.stroke();
    }
    for (const x of [50, 120, 330, PAGE_W - 50]) {
        ctx.beginPath();
        ctx.moveTo(x, 90);
        ctx.lineTo(x, FIRST_ROW + rows * ROW_H);
        ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.font = HAND;
    hand(ctx, scribble(rnd, 6), 140, 128, PAGE_W - 200, 30, 1, rnd);

    const firstNo = 10 + Math.floor(rnd() * 30);
    for (let r = 0; r < rows; r++) {
        const top = FIRST_ROW + r * ROW_H;
        ctx.globalAlpha = r === ENTRY_ROW ? 0.95 : 0.6 + rnd() * 0.25;
        hand(ctx, String(firstNo + r), 64, top + 44, 50, 34, 1, rnd);
        if (r === ENTRY_ROW) {
            // The entry: its first words in the name column, the rest beside them.
            const words = text.split(/\s+/);
            hand(ctx, words.slice(0, 1).join(' '), 136, top + 44, 185, 34, 2, rnd);
            hand(ctx, words.slice(1).join(' '), 344, top + 36, PAGE_W - 410, 32, 3, rnd);
        } else {
            hand(ctx, scribble(rnd, 2), 136, top + 44, 185, 34, 2, rnd);
            hand(ctx, scribble(rnd, 14 + Math.floor(rnd() * 8)), 344, top + 36, PAGE_W - 410, 32, 3, rnd);
        }
    }
    ctx.globalAlpha = 1;

    // The crop: the entry's row, as the crop editor would cut it.
    const region = { x: 40, y: FIRST_ROW + ENTRY_ROW * ROW_H - 6, w: PAGE_W - 80, h: ROW_H + 12 };
    const crop = canvas(region.w, region.h);
    if (!crop) return null;
    crop.ctx.drawImage(page.el, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
    return {
        page: jpeg(page.el, 0.7),
        excerpt: jpeg(crop.el, 0.8),
        region: { x: region.x / PAGE_W, y: region.y / PAGE_H, w: region.w / PAGE_W, h: region.h / PAGE_H },
    };
}

/** A sepia studio portrait: a dark silhouette on a vignetted backdrop. */
function portrait(seed: number, gender: Gender): string | null {
    const size = 256;
    const c = canvas(size, size);
    if (!c) return null;
    const { ctx } = c;
    const rnd = random(seed + 100);
    const back = ctx.createRadialGradient(size * 0.45, size * 0.35, 10, size / 2, size / 2, size * 0.75);
    back.addColorStop(0, `hsl(${34 + rnd() * 6}, 38%, ${74 + rnd() * 6}%)`);
    back.addColorStop(1, 'hsl(30, 30%, 38%)');
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, size, size);

    const cx = size / 2 + (rnd() - 0.5) * 14;
    ctx.fillStyle = 'rgba(52, 38, 26, 0.92)';
    // Shoulders and neck.
    ctx.beginPath();
    ctx.ellipse(cx, size + 24, gender === 'female' ? 92 : 104, 108, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(cx - 20, 140, 40, 50);
    // Hair behind the head: fuller and pinned up for the women.
    if (gender === 'female') {
        ctx.beginPath();
        ctx.ellipse(cx, 104, 54, 62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, 46, 22, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(cx, 112, 42, 54, 0, 0, Math.PI * 2);
    ctx.fill();
    if (gender === 'male') {
        // A pale collar under the chin.
        ctx.fillStyle = 'rgba(225, 210, 185, 0.85)';
        ctx.beginPath();
        ctx.moveTo(cx - 30, 182);
        ctx.lineTo(cx, 214);
        ctx.lineTo(cx + 30, 182);
        ctx.lineTo(cx + 18, 178);
        ctx.lineTo(cx, 196);
        ctx.lineTo(cx - 18, 178);
        ctx.closePath();
        ctx.fill();
    }

    const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.72);
    vignette.addColorStop(0, 'rgba(40, 25, 10, 0)');
    vignette.addColorStop(1, 'rgba(40, 25, 10, 0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255, 245, 225' : '40, 25, 10'}, ${rnd() * 0.08})`;
        ctx.fillRect(rnd() * size, rnd() * size, 1.5, 1.5);
    }
    return jpeg(c.el, 0.82).dataUrl;
}

/**
 * The sample's picture maker, or undefined where there is no canvas to draw
 * on — the tree then simply comes without pictures.
 */
export function demoImageMaker(): DemoImageMaker | undefined {
    if (typeof document === 'undefined') return undefined;
    try {
        if (!document.createElement('canvas').getContext('2d')) return undefined;
    } catch {
        return undefined;
    }
    return {
        entry: (text, seed) => entry(text, seed) ?? undefined,
        portrait: (seed, gender) => portrait(seed, gender) ?? undefined,
    };
}

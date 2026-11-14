/**
 * The scene of a live load (spec 055 §2, §3): from the tree shown before to
 * the one just drawn, in one go and in under a second. TreeRenderer.renderLive
 * draws the new state first (no empty frame, cards kept by person id) and
 * hands the before and after here; the timing and geometry are in
 * src/live-transition.ts.
 *
 *  - Cards that stay move from their old places (FLIP), the anchor stands.
 *  - New people grow out of their line: a child out of its parents' stem,
 *    a partner out of the partner's card edge, a parent out of the line
 *    above the child; with no line they fade in on their place.
 *  - People taken away shrink back into their line; a person merged into
 *    another flows into that one's card.
 *  - The lines: the old drawing a ghost over the new one.
 *  - The light along the line: a glow runs from the parents down to a new
 *    card, which then lights up (desktop and tablet; a phone only lights up).
 *  - A changed card gets a ring in the session's colour (.live-touched).
 *
 * Without motion (the setting off, reduced motion) or over the limits the
 * new state stands at once; new and changed cards get the static ring.
 */

import type { Connection, SpouseLine } from './layout/index.js';
import type { PersonId, Position, StromData } from './types.js';
import type { LiveDiff } from './live-diff.js';
import { rectsOverlap } from './children-transition.js';
import {
    LIVE, Point, childLightPath, lightFits, liveTime, newCardDelays, polylineLength, polylinePath, pulseDash, simplifyPolyline,
} from './live-transition.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface LiveSceneState {
    positions: ReadonlyMap<PersonId, Position>;
    connections: readonly Connection[];
    spouseLines: readonly SpouseLine[];
    data: StromData;
}

export interface LiveSceneInput {
    diff: LiveDiff;
    before: LiveSceneState & {
        /** The cards' elements before (a card that leaves moves into the scene's layer). */
        cards: ReadonlyMap<PersonId, HTMLElement>;
        /** A copy of the lines before, for the ghost. */
        lines: SVGSVGElement;
    };
    after: LiveSceneState;
    /** Cards whose content changed (a new element): the ones that may get the ring. */
    redrawn: ReadonlySet<PersonId>;
    /** The view moved by this much (world units) to keep the anchor in place. */
    shift: Point;
    /** The anchor's centre in the world (after). */
    anchor: Point;
    /** Whether the lines' drawing changed. */
    linesChanged: boolean;
    /** Motion allowed (the setting on, no reduced motion). */
    motion: boolean;
    /**
     * Too much changed for a scene (over LIVE.maxChangedForScene people, or
     * far more moves than the cap): nothing moves, the ring goes on at most
     * LIVE.maxAnimatedNew cards in the view, the nearest to the anchor.
     */
    overLimit: boolean;
    /** A phone or tablet: shorter times, fewer cards. */
    compact: boolean;
    /** A phone: no light along the line. */
    phone: boolean;
    /** The most cards that move (the children transition's cap). */
    cap: number;
    transform: { scale: number; tx: number; ty: number };
    container: HTMLElement;
    canvas: HTMLElement;
    svg: SVGSVGElement;
    cardEl: (id: PersonId) => HTMLElement | null;
    cardSize: (id: PersonId) => { w: number; h: number };
    /** The colour of the session a person's change belongs to (a CSS value). */
    colorOf: (id: PersonId) => string;
    /** Runs once when the scene ends (also when cut short). */
    onDone: () => void;
}

export interface LiveSceneHandle { finish: () => void }

type GrowKind = 'child' | 'partner' | 'parent';

/** How a person relates to the people drawn around them: what they grow out of. */
function growKind(data: StromData, id: PersonId, present: (q: PersonId) => boolean): { kind: GrowKind; other: PersonId } | null {
    const p = data.persons[id];
    if (!p) return null;
    const parent = p.parentIds.find(present);
    if (parent) return { kind: 'child', other: parent };
    for (const uid of p.partnerships) {
        const u = data.partnerships[uid];
        if (!u) continue;
        const q = u.person1Id === id ? u.person2Id : u.person1Id;
        if (present(q)) return { kind: 'partner', other: q };
    }
    const child = p.childIds.find(present);
    if (child) return { kind: 'parent', other: child };
    return null;
}

interface Growth {
    /** The point the card grows out of (world). */
    at: Point;
    /** The transform origin on the card: top centre, a side's middle, bottom centre. */
    origin: string;
    /** The card's top-left at the start, relative to its place (before the scale). */
    from: Point;
    /** The light's way to the card (null: no line long enough). */
    light: Point[] | null;
    kind: GrowKind;
    other: PersonId;
}

/** Where a card grows from (or shrinks into) in a state, with the light's way. */
function growthOf(state: LiveSceneState, id: PersonId, size: { w: number; h: number }, sizeOf: (q: PersonId) => { w: number; h: number },
    present: (q: PersonId) => boolean): Growth | null {
    const pos = state.positions.get(id);
    if (!pos) return null;
    const rel = growKind(state.data, id, present);
    if (!rel) return null;
    const { w, h } = size;
    if (rel.kind === 'child') {
        const line = state.connections.find(c => c.drops.some(d => d.personId === id));
        if (!line) return null;
        const at = { x: line.stemX, y: line.stemBottomY };
        return { at, origin: '50% 0', from: { x: at.x - w / 2 - pos.x, y: at.y - pos.y }, light: childLightPath(line, id), ...rel };
    }
    if (rel.kind === 'partner') {
        const op = state.positions.get(rel.other);
        if (!op) return null;
        const os = sizeOf(rel.other);
        const right = pos.x > op.x;
        const at = { x: right ? op.x + os.w : op.x, y: op.y + os.h / 2 };
        const line = state.spouseLines.find(s => (s.person1Id === id && s.person2Id === rel.other) || (s.person2Id === id && s.person1Id === rel.other));
        const light = line ? (right ? [{ x: line.xMin, y: line.y }, { x: line.xMax, y: line.y }] : [{ x: line.xMax, y: line.y }, { x: line.xMin, y: line.y }]) : null;
        return {
            at, origin: right ? '0 50%' : '100% 50%',
            from: { x: (right ? at.x : at.x - w) - pos.x, y: at.y - h / 2 - pos.y }, light, ...rel,
        };
    }
    // A parent: out of the line above the child's card.
    const cp = state.positions.get(rel.other);
    if (!cp) return null;
    const cs = sizeOf(rel.other);
    const line = state.connections.find(c => c.drops.some(d => d.personId === rel.other)
        && (c.stemPersonId === id || state.spouseLines.some(s => s.unionId === c.unionId && (s.person1Id === id || s.person2Id === id))));
    const drop = line?.drops.find(d => d.personId === rel.other);
    const at = { x: cp.x + cs.w / 2, y: drop ? drop.topY : cp.y - 30 };
    let light: Point[] | null = null;
    if (line) {
        const down = childLightPath(line, rel.other);
        if (down) {
            const up = [...down].reverse();
            if (line.stemPersonId !== id) {
                // From the couple's line along to the new parent's card edge.
                const edge = pos.x + w / 2 < line.stemX ? pos.x + w : pos.x;
                up.push({ x: edge, y: line.stemTopY });
            }
            light = simplifyPolyline(up);
        }
    }
    return { at, origin: '50% 100%', from: { x: at.x - w / 2 - pos.x, y: at.y - h - pos.y }, light, ...rel };
}

/** An opacity animation held at `from` until `a`, at `to` by `b` (ms). */
function fade(el: Element, from: number, to: number, a: number, b: number, delay = 0, fill: FillMode = 'none'): Animation {
    const end = Math.max(b, 1);
    return el.animate([
        { opacity: from, offset: 0 }, { opacity: from, offset: Math.min(a / end, 1) }, { opacity: to, offset: 1 },
    ], { duration: end, delay, easing: 'linear', fill });
}

/**
 * Play the scene. Returns its handle (finish() ends it at once: every card
 * on its place, the effects gone), or null when nothing moves (the new state
 * stands; the rings are set either way).
 */
export function playLiveScene(input: LiveSceneInput): LiveSceneHandle | null {
    const { diff, before, after, shift, transform: t, container, canvas, svg, compact, phone } = input;
    const T = (ms: number) => liveTime(ms, compact);
    const move = compact ? LIVE.compactMove : LIVE.move;
    const view = { left: -LIVE.offscreenMargin, top: -LIVE.offscreenMargin, right: container.clientWidth + LIVE.offscreenMargin, bottom: container.clientHeight + LIVE.offscreenMargin };
    const onScreen = (x: number, y: number, w: number, h: number): boolean =>
        rectsOverlap({ left: x * t.scale + t.tx, top: y * t.scale + t.ty, right: (x + w) * t.scale + t.tx, bottom: (y + h) * t.scale + t.ty }, view);
    const dist = (p: Point) => Math.hypot(p.x - input.anchor.x, p.y - input.anchor.y);

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const animations: Animation[] = [];
    const touchedEls: HTMLElement[] = [];
    const extras: Element[] = [];
    let ended = false;
    const later = (ms: number, fn: () => void): void => { timers.push(setTimeout(fn, ms)); };

    const addedSet = new Set(diff.added);
    const ringFor = (el: HTMLElement, id: PersonId, at: number): void => {
        el.style.setProperty('--live-c', input.colorOf(id));
        const on = (): void => {
            if (ended) return;
            ringCard(el, false);
            touchedEls.push(el);
        };
        if (at <= 0) on();
        else later(at, on);
    };

    // Changed cards (not new): the ring now; a card someone was merged into once the merge arrives.
    const mergedInto = new Set(diff.merged.values());
    const changedShown = [...diff.changed.keys(), ...mergedInto].filter(id => input.redrawn.has(id) || mergedInto.has(id));

    if (!input.motion || input.overLimit) {
        // No motion: everything stands; new and changed cards get the static ring
        // (over the limit only the nearest ones in the view).
        let ids = [...new Set([...diff.added, ...changedShown])];
        if (input.overLimit) {
            ids = ids.filter(id => {
                const pos = after.positions.get(id);
                const size = input.cardSize(id);
                return !!pos && onScreen(pos.x, pos.y, size.w, size.h);
            }).sort((a, b) => dist(after.positions.get(a)!) - dist(after.positions.get(b)!)).slice(0, LIVE.maxAnimatedNew);
        }
        for (const id of ids) {
            const el = input.cardEl(id);
            if (el) staticRing(el, input.colorOf(id));
        }
        input.onDone();
        return null;
    }

    // ---------- moves of the cards that stay (FLIP) ----------
    type Item = { dist: number; near: boolean; run: () => void };
    const moves: Item[] = [];
    for (const [id, pos] of after.positions) {
        if (addedSet.has(id)) continue;
        const was = before.positions.get(id);
        const el = input.cardEl(id);
        if (!was || !el) continue;
        const dx = was.x + shift.x - pos.x, dy = was.y + shift.y - pos.y;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        diff.moved.push(id);
        const { w, h } = input.cardSize(id);
        const near = onScreen(was.x + shift.x, was.y + shift.y, w, h) || onScreen(pos.x, pos.y, w, h);
        moves.push({
            dist: dist(pos), near,
            run: () => { animations.push(el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: move, easing: LIVE.ease })); },
        });
    }
    const nearMoves = moves.filter(m => m.near).sort((a, b) => a.dist - b.dist).slice(0, input.cap);
    for (const m of nearMoves) m.run();

    // ---------- new cards: grow out of their line ----------
    const presentAfter = (q: PersonId) => after.positions.has(q) && !addedSet.has(q);
    const grows: Array<{ id: PersonId; el: HTMLElement; pos: Position; g: Growth | null; dist: number; afterPartner: boolean }> = [];
    const newPartnersOf = new Set<PersonId>();
    for (const id of diff.added) {
        const pos = after.positions.get(id);
        const el = input.cardEl(id);
        if (!pos || !el) continue;
        const size = input.cardSize(id);
        if (!onScreen(pos.x, pos.y, size.w, size.h)) continue;
        // A new card next to another new one (a couple's child): from the line the layout drew.
        const g = growthOf(after, id, size, input.cardSize, q => presentAfter(q) || (addedSet.has(q) && after.positions.has(q) && q !== id));
        if (g?.kind === 'partner') newPartnersOf.add(g.other);
        grows.push({ id, el, pos, g, dist: dist(pos), afterPartner: false });
    }
    for (const it of grows) {
        if (it.g?.kind !== 'child') continue;
        const parents = after.data.persons[it.id]?.parentIds ?? [];
        it.afterPartner = parents.some(p => newPartnersOf.has(p));
    }
    const delays = newCardDelays(grows);
    // The light: the nearest new cards with a line long enough, at most 6.
    const lit = new Set(grows
        .filter(g => !phone && delays.has(g.id) && g.g?.light && lightFits(polylineLength(g.g.light)))
        .sort((a, b) => a.dist - b.dist).slice(0, LIVE.pulse.max).map(g => g.id));
    let pulses: SVGSVGElement | null = null;
    for (const it of grows) {
        const d = delays.get(it.id);
        if (d === undefined) {
            // Beyond the most that animate: it stands, with the ring.
            ringFor(it.el, it.id, 0);
            continue;
        }
        const delay = T(d);
        it.el.style.setProperty('--live-c', input.colorOf(it.id));
        if (it.g) {
            const { from, origin } = it.g;
            const start = `translate(${from.x}px, ${from.y}px) scale(${LIVE.stemScale})`;
            animations.push(it.el.animate([{ transform: start, transformOrigin: origin }, { transform: 'none', transformOrigin: origin }],
                { duration: move, delay, easing: LIVE.ease, fill: 'backwards' }));
            animations.push(fade(it.el, 0, 1, 0, move / 2, delay, 'backwards'));
        } else {
            animations.push(fade(it.el, 0, 1, 0, T(LIVE.fadeOnlyMs), delay, 'backwards'));
        }
        // The light down the line, then the card lights up; without it the glow comes once it stands.
        let glowAt = delay + move;
        if (lit.has(it.id) && it.g?.light) {
            pulses ??= pulseLayer(svg);
            const path = polylinePath(it.g.light);
            const len = polylineLength(it.g.light);
            const dash = pulseDash(len);
            const color = input.colorOf(it.id);
            // One sharp line runs down to the card, no blurred halo around it.
            const p = document.createElementNS(SVG_NS, 'path');
            p.setAttribute('d', path);
            p.setAttribute('class', 'live-pulse live-pulse--core');
            p.style.setProperty('--live-c', color);
            p.style.strokeDasharray = dash.dasharray;
            p.style.strokeDashoffset = String(dash.from);
            pulses.appendChild(p);
            animations.push(p.animate([
                { strokeDashoffset: dash.from, opacity: 0, offset: 0 },
                { strokeDashoffset: dash.from, opacity: 1, offset: 0.001 },
                { strokeDashoffset: dash.to, opacity: 1, offset: 1 },
            ], { duration: T(LIVE.pulse.to - LIVE.pulse.from), delay: delay + T(LIVE.pulse.from), easing: LIVE.pulse.ease, fill: 'both' }));
            glowAt = delay + T(LIVE.bloom.from);
        }
        const el = it.el;
        const bloom = document.createElement('span');
        bloom.className = 'live-bloom';
        bloom.setAttribute('aria-hidden', 'true');
        el.appendChild(bloom);
        extras.push(bloom);
        // The card lights up with a still, sharp 2 px ring in the session's colour (no spreading glow).
        animations.push(bloom.animate([
            { boxShadow: '0 0 0 2px var(--live-c)', opacity: 1 },
            { boxShadow: '0 0 0 2px var(--live-c)', opacity: 1 },
        ], { duration: T(LIVE.bloom.ms), delay: glowAt, easing: 'linear', fill: 'backwards' }));
        ringFor(el, it.id, glowAt);
    }

    // ---------- cards that leave, cards merged into another ----------
    const layer = document.createElement('div');
    layer.className = 'children-leaving live-leaving';
    layer.style.transform = `translate(${shift.x}px, ${shift.y}px)`;
    const removedSet = new Set([...diff.removed, ...diff.merged.keys()]);
    const presentBefore = (q: PersonId) => before.positions.has(q) && !removedSet.has(q);
    let leaving = 0;
    const leave = (id: PersonId, run: (el: HTMLElement, was: Position) => void): void => {
        const was = before.positions.get(id);
        const el = before.cards.get(id);
        if (!was || !el) return;
        const { w, h } = { w: el.offsetWidth || input.cardSize(id).w, h: el.offsetHeight || input.cardSize(id).h };
        if (!onScreen(was.x + shift.x, was.y + shift.y, w, h)) return;
        if (leaving >= LIVE.maxAnimatedNew) return;
        leaving++;
        el.removeAttribute('data-id');
        el.classList.remove('live-touched', 'live-touched-static', 'children-glow', 'children-glow-anim');
        el.style.left = `${was.x}px`;
        el.style.top = `${was.y}px`;
        layer.appendChild(el);
        run(el, was);
    };
    for (const id of diff.removed) {
        leave(id, (el, was) => {
            const size = { w: el.offsetWidth || input.cardSize(id).w, h: el.offsetHeight || input.cardSize(id).h };
            const g = growthOf(before, id, size, q => input.cardSize(q), presentBefore);
            if (!g) {
                animations.push(fade(el, 1, 0, 0, T(200), 0, 'forwards'));
                return;
            }
            const to = `translate(${g.from.x}px, ${g.from.y}px) scale(${LIVE.stemScale})`;
            void was;
            animations.push(el.animate([{ transform: 'none', transformOrigin: g.origin }, { transform: to, transformOrigin: g.origin }],
                { duration: T(LIVE.removeMs), easing: LIVE.ease, fill: 'forwards' }));
            animations.push(fade(el, 1, 0, T(LIVE.removeFade[0]), T(LIVE.removeFade[1]), 0, 'forwards'));
        });
    }
    for (const [gone, into] of diff.merged) {
        const target = after.positions.get(into);
        leave(gone, (el, was) => {
            if (!target) {
                animations.push(fade(el, 1, 0, 0, T(200), 0, 'forwards'));
                return;
            }
            const to = `translate(${target.x - shift.x - was.x}px, ${target.y - shift.y - was.y}px) scale(${LIVE.mergeScale})`;
            animations.push(el.animate([{ transform: 'none' }, { transform: to }], { duration: move, easing: LIVE.ease, fill: 'forwards' }));
            animations.push(fade(el, 1, 0, T(LIVE.mergeFade[0]), T(LIVE.mergeFade[1]), 0, 'forwards'));
        });
    }
    if (layer.childElementCount > 0) canvas.appendChild(layer);

    // ---------- the rings of changed cards ----------
    for (const id of new Set(changedShown)) {
        const el = input.cardEl(id);
        if (!el || addedSet.has(id)) continue;
        const pos = after.positions.get(id);
        const size = input.cardSize(id);
        if (!pos || !onScreen(pos.x, pos.y, size.w, size.h)) {
            el.style.setProperty('--live-c', input.colorOf(id));
            continue;
        }
        ringFor(el, id, mergedInto.has(id) ? move : 0);
        fadeChangedRows(el, animations);
    }

    // ---------- the lines: the old drawing a ghost over the new one ----------
    let ghost: SVGSVGElement | null = null;
    const anyMove = nearMoves.length > 0 || layer.childElementCount > 0;
    if (input.linesChanged && (anyMove || grows.length > 0)) {
        ghost = before.lines;
        ghost.removeAttribute('id');
        ghost.setAttribute('class', 'tree-lines-ghost');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.transform = `translate(${shift.x}px, ${shift.y}px)`;
        svg.after(ghost);
        // Lines that only grow (nothing moves): the old ones stay while the new are drawn in.
        if (anyMove) animations.push(fade(ghost, 1, 0, 0, T(LIVE.linesOutMs), 0, 'forwards'));
        animations.push(fade(svg, 0, 1, T(LIVE.linesIn[0]), T(LIVE.linesIn[1])));
    }

    const moving: HTMLElement[] = [];
    for (const a of animations) {
        const target = (a.effect as KeyframeEffect | null)?.target;
        if (target instanceof HTMLElement && target.classList.contains('person-card') && !moving.includes(target)) {
            target.style.willChange = 'transform';
            moving.push(target);
        }
    }

    const end = (): void => {
        if (ended) return;
        ended = true;
        for (const tm of timers) clearTimeout(tm);
        for (const el of moving) el.style.willChange = '';
        for (const x of extras) x.remove();
        ghost?.remove();
        layer.remove();
        pulses?.remove();
        input.onDone();
    };
    if (animations.length === 0 && timers.length === 0) {
        end();
        return null;
    }
    // The scene ends when the last animation or the last ring's start is through.
    const lastRingAt = timers.length > 0 ? 1 : 0;
    void Promise.all(animations.map(a => a.finished.catch(() => undefined))).then(() => {
        if (lastRingAt) later(T(LIVE.ring.outUntil), end);
        else end();
    });
    return {
        finish: (): void => {
            for (const a of animations) {
                try { a.finish(); } catch { /* an animation without an end */ }
            }
            for (const el of touchedEls) el.classList.remove('live-touched');
            canvas.querySelectorAll('.live-field').forEach(r => r.classList.remove('live-field'));
            end();
        },
    };
}

/** An overlay for the light, over the lines and under the cards. */
function pulseLayer(svg: SVGSVGElement): SVGSVGElement {
    const layer = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    layer.setAttribute('class', 'live-pulse-layer');
    layer.setAttribute('aria-hidden', 'true');
    for (const a of ['width', 'height']) {
        const v = svg.getAttribute(a);
        if (v) layer.setAttribute(a, v);
    }
    svg.after(layer);
    return layer;
}

/** The ring of a changed card (1 s, or 1.6 s without motion); goes by itself. */
export function ringCard(el: HTMLElement, still: boolean): void {
    const cls = still ? 'live-touched-static' : 'live-touched';
    el.classList.remove('live-touched', 'live-touched-static');
    void el.offsetWidth;
    el.classList.add(cls);
    const done = (): void => {
        el.classList.remove(cls);
        el.querySelectorAll('.live-field').forEach(r => r.classList.remove('live-field'));
    };
    if (still) setTimeout(done, LIVE.ring.staticMs);
    else {
        const onEnd = (e: AnimationEvent): void => {
            if (e.target !== el || e.animationName !== 'live-touched') return;
            el.removeEventListener('animationend', onEnd);
            done();
        };
        el.addEventListener('animationend', onEnd);
        // No animation event (a hidden page): gone after its time anyway.
        setTimeout(() => { el.removeEventListener('animationend', onEnd); done(); }, LIVE.ring.outUntil + 200);
    }
}

/** The static ring, in the session's colour. */
export function staticRing(el: HTMLElement, color: string): void {
    el.style.setProperty('--live-c', color);
    ringCard(el, true);
}

/** The changed rows of a card (.live-field): the new text fades in (0–100 ms out, 100–200 ms in). */
function fadeChangedRows(el: HTMLElement, animations: Animation[]): void {
    el.querySelectorAll<HTMLElement>('.live-field').forEach(row => {
        animations.push(row.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 1 }], { duration: 200, easing: 'linear' }));
    });
}

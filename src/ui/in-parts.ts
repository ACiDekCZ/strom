/**
 * A computation in parts (waiting buttons §8): a generator whose steps are run one after another, the page let go
 * every `sliceMs` of work (a frame painted: the working state, its step) and the last step said to `onStep`.
 * A large GEDCOM file read this way keeps its "Loading family.ged… 2,400 people" moving instead of a frozen page.
 */

/** Let the page paint a frame, then go on (a hidden page, whose frames do not come, goes on after 100 ms). */
export function paintPause(): Promise<void> {
    return new Promise(resolve => {
        let done = false;
        const go = (): void => { if (!done) { done = true; resolve(); } };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
        setTimeout(go, 100);
    });
}

export interface InPartsOpts<S> {
    /** The step at each pause (its words for the working state). */
    onStep?: (step: S) => void;
    /** Work between two pauses (ms). */
    sliceMs?: number;
    /** The pause (default: a painted frame). */
    pause?: () => Promise<void>;
}

/** Run `steps` to their end in parts; resolves with the generator's result. */
export async function runInParts<S, T>(steps: Generator<S, T, void>, opts: InPartsOpts<S> = {}): Promise<T> {
    const slice = opts.sliceMs ?? 40;
    const pause = opts.pause ?? paintPause;
    let since = Date.now();
    for (;;) {
        const r = steps.next();
        if (r.done) return r.value;
        if (Date.now() - since < slice) continue;
        opts.onStep?.(r.value);
        await pause();
        since = Date.now();
    }
}

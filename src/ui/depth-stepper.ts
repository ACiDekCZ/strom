/**
 * Depth stepper: a compact "label  − n +" control that fronts a hidden native
 * generation-depth <select>. The select stays the single source of truth —
 * the renderer fills its options and value (updateGenerationSelect) and its
 * inline onchange handler applies the depth — so every existing code path
 * keeps working. The stepper only mirrors the select and, when a button or an
 * arrow key is used, moves the select value and dispatches `change`.
 *
 * Markup (index.html):
 *   <div class="depth-stepper">
 *     <span class="depth-stepper-label">…</span>
 *     <div class="depth-stepper-group" role="group">
 *       <button class="depth-stepper-btn" data-step="-1">−</button>
 *       <span class="depth-stepper-value"></span>
 *       <button class="depth-stepper-btn" data-step="1">+</button>
 *     </div>
 *     <select class="depth-stepper-native" hidden>…</select>
 *   </div>
 *
 * Keyboard: both buttons are tab stops; ArrowUp / ArrowDown on either button
 * step the value up / down.
 */

let delegationInstalled = false;

function nativeSelect(stepper: Element): HTMLSelectElement | null {
    return stepper.querySelector('select.depth-stepper-native');
}

/** Range of the select's numeric options (min/max), or null when empty. */
function range(select: HTMLSelectElement): { min: number; max: number } | null {
    const values = Array.from(select.options).map(o => parseInt(o.value, 10)).filter(v => !isNaN(v));
    if (values.length === 0) return null;
    return { min: Math.min(...values), max: Math.max(...values) };
}

/** Mirror a select's state (value, min/max) onto its stepper. */
export function syncDepthStepper(select: HTMLSelectElement | null): void {
    installDepthStepperDelegation();
    const stepper = select?.closest('.depth-stepper');
    if (!select || !stepper) return;

    const r = range(select);
    const value = parseInt(select.value, 10);
    const valueEl = stepper.querySelector('.depth-stepper-value');
    if (valueEl) valueEl.textContent = isNaN(value) ? '0' : String(value);

    const dec = stepper.querySelector<HTMLButtonElement>('.depth-stepper-btn[data-step="-1"]');
    const inc = stepper.querySelector<HTMLButtonElement>('.depth-stepper-btn[data-step="1"]');
    const atMin = !r || isNaN(value) || value <= r.min;
    const atMax = !r || isNaN(value) || value >= r.max;

    // A button that becomes disabled while focused would drop keyboard focus
    // to <body>; hand it to the sibling button when that one is still live.
    const active = document.activeElement;
    if (dec) dec.disabled = atMin;
    if (inc) inc.disabled = atMax;
    if (active === dec && atMin && inc && !atMax) inc.focus();
    else if (active === inc && atMax && dec && !atMin) dec.focus();
}

/** Step a stepper's select by `delta` and apply it via the select's onchange. */
function step(stepper: Element, delta: number): void {
    const select = nativeSelect(stepper);
    if (!select) return;
    const r = range(select);
    const current = parseInt(select.value, 10);
    if (!r || isNaN(current)) return;
    const next = Math.min(r.max, Math.max(r.min, current + delta));
    if (next === current) return;
    select.value = String(next);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncDepthStepper(select);
}

/**
 * One document-level listener pair serves every stepper (chip, tablet toolbar,
 * descendants badge). Idempotent; installed lazily on the first sync.
 */
export function installDepthStepperDelegation(): void {
    if (delegationInstalled || typeof document === 'undefined') return;
    delegationInstalled = true;

    document.addEventListener('click', (e) => {
        const btn = (e.target as Element | null)?.closest?.('.depth-stepper-btn') as HTMLButtonElement | null;
        if (!btn || btn.disabled) return;
        const stepper = btn.closest('.depth-stepper');
        if (!stepper) return;
        step(stepper, parseInt(btn.dataset.step || '0', 10));
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const target = e.target as Element | null;
        const stepper = target?.closest?.('.depth-stepper');
        if (!stepper || !target?.closest('.depth-stepper-group')) return;
        e.preventDefault();
        // Keep canvas keyboard panning from also reacting to the arrow.
        e.stopPropagation();
        step(stepper, e.key === 'ArrowUp' ? 1 : -1);
    }, true);
}

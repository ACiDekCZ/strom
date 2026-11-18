/**
 * What a row of Awaiting action says about its own optimistic write (waiting
 * buttons §7, 7a, 7b): "saving" at its end while the write is confirmed, and
 * after a refusal the row back where it was, tinted (until the next action in
 * the row or 10 s) with one sentence and "Try again" in it. Confirmed: the
 * state just goes (no ✓). No DOM here: the overview draws it.
 */

import type { WaitingPhase } from '../research-waiting.js';

/** The scope of Awaiting action's row actions held a moment after its rows moved (busy.ts holdAfterShift). */
export const WAITING_ROWS_SCOPE = 'waiting-rows';

/** How long a refused row stays tinted (unless an action in the row comes first). */
export const WAITING_REFUSED_TINT_MS = 10_000;

/** One more action of a refusal (the seal's way of a held write). */
export interface RowAlt { label: string; run: () => void; research?: boolean; ai?: boolean }

export interface RowRefusal {
    text: string;
    retry?: () => void;
    alt?: RowAlt;
    /** The phase the research had for the item when it refused (its change ends the sentence). */
    phase: WaitingPhase;
    at: number;
    /** The tint ended (an action in the row). */
    untinted: boolean;
    /** Said once (`role=alert` only on its first drawing). */
    said: boolean;
}

export type RowNote =
    | { kind: 'saving' }
    | { kind: 'refused'; refusal: RowRefusal; tint: boolean };

export class WaitingRowNotes {
    private readonly saving = new Set<string>();
    private readonly refused = new Map<string, RowRefusal>();

    /** A write of these rows starts: they say "saving"; a sentence of a try before goes. */
    start(ids: readonly string[]): void {
        for (const id of ids) {
            this.saving.add(id);
            this.refused.delete(id);
        }
    }

    /** Confirmed (or gone): the state just goes. */
    confirm(ids: readonly string[]): void {
        for (const id of ids) this.saving.delete(id);
    }

    /** Refused: the row back (the caller), tinted, with its sentence. */
    refuse(ids: readonly string[], r: { text: string; retry?: () => void; alt?: RowAlt; phase: WaitingPhase }, now = Date.now()): void {
        for (const id of ids) {
            this.saving.delete(id);
            this.refused.set(id, { ...r, at: now, untinted: false, said: false });
        }
    }

    /** The next action in the row: its tint ends (the sentence stays until a try or a change of the item). */
    touch(id: string): boolean {
        const r = this.refused.get(id);
        if (!r || r.untinted) return false;
        r.untinted = true;
        return true;
    }

    /** The sentence goes (a new try, the item changed or gone). */
    drop(id: string): void {
        this.refused.delete(id);
    }

    /** The items as the research says them now: a sentence goes when its item is gone or its phase changed. */
    settle(items: readonly { id: string; phase: WaitingPhase }[]): void {
        for (const [id, r] of [...this.refused]) {
            const now = items.find(x => x.id === id);
            if (!now || now.phase !== r.phase) this.refused.delete(id);
        }
    }

    isSaving(id: string): boolean {
        return this.saving.has(id);
    }

    state(id: string, now = Date.now()): RowNote | null {
        if (this.saving.has(id)) return { kind: 'saving' };
        const r = this.refused.get(id);
        if (!r) return null;
        return { kind: 'refused', refusal: r, tint: !r.untinted && now - r.at < WAITING_REFUSED_TINT_MS };
    }

    /** The rows saving and refused (the overview's own window draws them as the main window has them). */
    snapshot(now = Date.now()): { saving: string[]; refused: { id: string; text: string; tint: boolean; retry: boolean }[] } {
        return {
            saving: [...this.saving],
            refused: [...this.refused].map(([id, r]) => ({ id, text: r.text, tint: !r.untinted && now - r.at < WAITING_REFUSED_TINT_MS, retry: !!r.retry })),
        };
    }

    /** The soonest moment a tint ends (the overview is drawn again then); null: none tinted. */
    nextTintEnd(now = Date.now()): number | null {
        let next: number | null = null;
        for (const r of this.refused.values()) {
            if (r.untinted) continue;
            const end = r.at + WAITING_REFUSED_TINT_MS;
            if (end > now && (next === null || end < next)) next = end;
        }
        return next;
    }
}

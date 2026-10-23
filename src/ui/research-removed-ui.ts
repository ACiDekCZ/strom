/**
 * Whether a person comes back or goes (Strom Research `sync.removed`): a send
 * the research wrote asks it as a `fact: "PERSON"` conflict decidable by a
 * side. Two ways: the person removed by an earlier send of another window
 * and edited in this one (still here) — return to the tree or keep removed;
 * or removed here and edited elsewhere (not in this copy) — remove from the
 * tree or keep. One question per person (its fact conflicts go with it,
 * never a second one; asked again by a later send it is the same id), kept
 * until the research's status says it is decided. Decided by the research's
 * `conflict` link (it only asks to confirm); where there is none, its sides
 * and where it is decided. Once decided from this window, the research's
 * version loads (asked first as any load over changes made here).
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { TreeId, StromData, Person } from '../types.js';
import { LiveStatus, SyncPersonConflict, ResearchSendRecord } from '../research-link.js';
import { loadResearchCopy } from '../research-copy.js';
import { ResearchRemovedAsk, researchAutoState, patchResearchAutoState } from '../research-device.js';
import { removedAskOpen, withoutAskedConflicts } from '../research-sync.js';
import { shownNameOrEmpty } from '../person-name.js';
import { uiModule } from './module.js';

/** The tree's person a research ref names. */
function personByRef(data: StromData | null | undefined, ref: string): Person | undefined {
    return data ? Object.values(data.persons ?? {}).find(p => !!p && p.refn?.trim() === ref) : undefined;
}

export const researchRemovedMethods = uiModule({
    /**
     * Take in the "comes back or goes" a written send asked (`data`: the state
     * sent): which way by whether the person is in that state, named from it
     * or from the research's version kept here (a person removed here). The
     * same conflict or person asked before is replaced, never listed twice.
     */
    async researchTakeRemovedAsks(treeId: TreeId, asks: readonly SyncPersonConflict[], data: StromData, intake: string, at: string): Promise<void> {
        if (!asks.length) return;
        let copy: StromData | null = null;
        if (asks.some(a => !personByRef(data, a.person))) {
            try { copy = await loadResearchCopy(treeId); } catch { /* named by its number then */ }
        }
        const kept = researchAutoState(treeId).removedAsk ?? [];
        const next = kept.filter(k => !asks.some(a => a.id === k.id || a.person === k.person));
        for (const a of asks) {
            const here = personByRef(data, a.person);
            const known = here ?? personByRef(copy, a.person);
            const prior = kept.find(k => k.id === a.id);
            next.push({
                id: a.id, person: a.person, name: (known ? shownNameOrEmpty(known) : '') || prior?.name || '',
                way: here ? 'back' : 'remove', user: a.user, research: a.research, facts: a.facts,
                intake: intake || prior?.intake || '', at, ...(prior?.taken ? { taken: prior.taken } : {}),
            });
        }
        patchResearchAutoState(treeId, { removedAsk: next.slice(-20) });
    },

    /** The "comes back or goes" still open for a tree. */
    researchRemovedAsks(treeId: TreeId): ResearchRemovedAsk[] {
        return researchAutoState(treeId).removedAsk ?? [];
    },

    /** The conflicts asked as "comes back or goes" (the PERSON ones and their persons' facts): not among the conflicts to decide. */
    researchRemovedAskIds(treeId: TreeId): Set<string> {
        return new Set(this.researchRemovedAsks(treeId).flatMap(a => [a.id, ...a.facts]));
    },

    /** Sends' records of a tree without what is asked as "comes back or goes". */
    researchWithoutRemovedAsks(treeId: TreeId, records: readonly ResearchSendRecord[]): ResearchSendRecord[] {
        return withoutAskedConflicts(records, this.researchRemovedAskIds(treeId));
    },

    /**
     * Tell the "comes back or goes" a send just asked: by hand the question at
     * once (the first person; the others from the state block), by itself a
     * toast that stays, with Decide.
     */
    async tellResearchRemovedAsks(treeId: TreeId, auto: boolean): Promise<void> {
        const asks = this.researchRemovedAsks(treeId).filter(a => !a.taken);
        if (!asks.length || DataManager.getCurrentTreeId() !== treeId) return;
        const k = strings.conflict.person;
        if (!auto) {
            await this.showResearchRemovedAsk(treeId, asks[0].id);
            return;
        }
        const a = asks[0];
        const name = a.name || a.person;
        this.showToast(a.way === 'back' ? k.backToast(name) : k.removeToast(name), Infinity, {
            closable: true, action: { label: k.decide, run: () => { void this.showResearchRemovedAsk(treeId, a.id); } },
        });
    },

    /**
     * The question for one person (the first open one without an id): its
     * two sides as the research words them, the choices as links into the
     * research — or, with no such link here, where it is decided.
     */
    async showResearchRemovedAsk(treeId: TreeId, id?: string): Promise<void> {
        const asks = this.researchRemovedAsks(treeId);
        const a = (id ? asks.find(x => x.id === id) : undefined) ?? asks.find(x => !x.taken) ?? asks[0];
        if (!a || DataManager.getCurrentTreeId() !== treeId) return;
        const k = strings.conflict;
        const p = k.person;
        const back = a.way === 'back';
        const sides = [`${k.sideApp}: ${a.user || k.empty}`, `${k.sideResearch}: ${a.research || k.empty}`].join('\n');
        const take = (side: 'user' | 'research') => this.activeResearchLink('conflict', { conflict: a.id, conflictDo: 'decide', take: side });
        const viaLink = this.researchLinkAvailable('conflict') && !!take('user');
        const message = [back ? p.backAsk : p.removeAsk, sides, viaLink ? k.linkNote : k.remote].join('\n\n');
        const choices = viaLink
            ? [{ id: 'user', label: back ? p.backTake : p.removeTake }, { id: 'research', label: back ? p.backKeep : p.removeKeep }]
            : [];
        const pick = await this.showChoice(message, back ? p.backTitle : p.removeTitle, choices, undefined,
            { subtitle: a.name || a.person, cancelLabel: viaLink ? k.later : p.close });
        if (pick !== 'user' && pick !== 'research') return;
        const url = take(pick);
        if (!url) return;
        // Asked from this window: its version loads once the research has it decided.
        patchResearchAutoState(treeId, { removedAsk: this.researchRemovedAsks(treeId).map(x => x.id === a.id ? { ...x, taken: pick } : x) });
        this.launchResearchLink(url, 'terminal');
        this.refreshResearchSyncUi();
    },

    /**
     * The research's status says which are decided: those go (their way
     * there, its version, is this tree's next load). One decided from this
     * window loads that version — the question ends where it was asked.
     */
    researchNoteRemovedSettled(treeId: TreeId, status: LiveStatus): void {
        const asks = this.researchRemovedAsks(treeId);
        if (!asks.length || !status.sends) return;
        const done = asks.filter(a => removedAskOpen(a, status.sends) === false);
        if (!done.length) return;
        const left = asks.filter(a => !done.includes(a));
        patchResearchAutoState(treeId, { removedAsk: left.length ? left : undefined });
        this.refreshResearchSyncUi();
        // Its version after the poll that saw it decided (a load asks the bridge, which would wait for this poll).
        if (done.some(a => a.taken) && DataManager.getCurrentTreeId() === treeId) {
            setTimeout(() => { if (DataManager.getCurrentTreeId() === treeId) void this.researchLoadNewer(); }, 0);
        }
    },
});

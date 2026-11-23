/**
 * The research's step that takes a send back, `strom sync undo <input>`, as
 * the dialogs say it (the notice of a copy taken off a shared research, the
 * undo of a merge already sent): the step's words with the research
 * terminal's mark, the command in a code line with Copy and — with the
 * send's input known from the research's status (`/status.sends[].input`)
 * and its links going here — the action that opens it in the research's
 * terminal. Without the input the command says "I…" and a note says where
 * the number is (`strom input list`).
 */

import { strings } from '../strings.js';
import { researchIntakeRef, researchLinkMark, researchSchemeUrl } from '../research-link.js';
import { announcedResearchScheme } from '../research-device.js';
import { researchActionLabel, researchActionMark } from './research-open-mark.js';

export interface ResearchUndoStep {
    /** The send's input in the research (I0042), null when not known here. */
    input: string | null;
    /** The command for the research's terminal. */
    command: string;
    /** The sync-undo link that runs it in the research's terminal, null without the input or the links. */
    url: string | null;
}

/** The step for a send of the research `researchId` whose input is `input` (anything not an input: not known). */
export function researchUndoStep(researchId: string, input: string | null | undefined, linksGo: boolean): ResearchUndoStep {
    const known = researchIntakeRef(input);
    return {
        input: known,
        command: `strom sync undo ${known ?? 'I…'}`,
        url: known && linksGo ? researchSchemeUrl('sync-undo', { tree: researchId, intake: known }, announcedResearchScheme()) : null,
    };
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The step's HTML: `lead` (plain text, the terminal's mark after it), the
 * command line, the note of "I…" or the action. `cmdClass`: the dialog's own
 * class of the code line; `leadClass` of the lead's paragraph.
 */
export function researchUndoStepHtml(step: ResearchUndoStep, o: { lead: string; cmdClass?: string; leadClass?: string }): string {
    const r = strings.research;
    // The step is the research terminal's: the mark of its link's group beside it (decorative; the words say it).
    return `<p class="research-undo-lead${o.leadClass ? ` ${o.leadClass}` : ''}">${esc(o.lead)}${researchActionMark(researchLinkMark('sync-undo'), { size: 12, sr: false })}</p>
        <div class="install-line-row research-undo-row">
            <code class="install-line research-undo-cmd${o.cmdClass ? ` ${o.cmdClass}` : ''}" tabindex="0">${esc(step.command)}</code>
            <button type="button" class="install-copy" data-act="undo-copy">${esc(strings.install.copy)}</button>
        </div>
        ${step.input ? '' : `<p class="research-undo-note">${esc(r.undoStepInput)}</p>`}
        ${step.url ? `<p><button type="button" class="link-button" data-act="undo-run">${researchActionLabel(r.undoStepRun, researchLinkMark('sync-undo'), { size: 12 })}</button></p>` : ''}`;
}

/** Copy and the action of a step drawn in `root` (researchUndoStepHtml); `launch` opens the link. */
export function bindResearchUndoStep(root: HTMLElement, step: ResearchUndoStep, launch: (url: string) => void, failed: () => void): void {
    root.querySelector<HTMLButtonElement>('[data-act="undo-run"]')?.addEventListener('click', () => {
        if (step.url) launch(step.url);
    });
    const copy = root.querySelector<HTMLButtonElement>('[data-act="undo-copy"]');
    copy?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(step.command);
        } catch {
            // Not allowed here: the line is selected for copying by hand.
            const code = copy.parentElement?.querySelector('code');
            const sel = window.getSelection();
            if (code && sel) {
                sel.removeAllRanges();
                const range = document.createRange();
                range.selectNodeContents(code);
                sel.addRange(range);
            }
            failed();
            return;
        }
        copy.textContent = strings.install.copied;
        copy.classList.add('copied');
        setTimeout(() => {
            if (!copy.isConnected) return;
            copy.textContent = strings.install.copy;
            copy.classList.remove('copied');
        }, 2000);
    });
}

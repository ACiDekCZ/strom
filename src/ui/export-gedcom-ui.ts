/**
 * GEDCOM export choices of spec 066: what the file is for (§4: "Back to
 * {prog}" with every source and citation, or "To share with others" — the
 * privacy and content choices as before), and the footer warning when a
 * choice leaves sources out (§5). The export dialog itself is
 * encryption-ui's; this module only adds the GEDCOM part of it.
 */

import { strings } from '../strings.js';
import { StromData } from '../types.js';
import { CONTENT_PRESETS, ContentOptions, PrivacyMode, countCitations, countLivingPersons, droppedSources } from '../privacy.js';
import { backSourceRecordCount, firstResearchNoteSource } from '../ged-exporter.js';
import { importProgramName } from '../import-next.js';
import { allShareCopies } from '../shared-events.js';
import { TreeManager } from '../tree-manager.js';
import { uiModule } from './module.js';

export type GedcomPurpose = 'back' | 'share';

/** The purpose chosen while the dialog exports GEDCOM; null: another export. */
let purpose: GedcomPurpose | null = null;

/** What the dialog says of the exported tree, computed once per tree read. */
interface GedcomTreeFacts {
    data: StromData;
    sources: number;
    /**
     * The source records "Back" writes: the sources one record of the
     * program's file became (one per page cited) go back as that one record.
     */
    backSources: number;
    citations: number;
    living: number;
    /** The record(s) of the first research fact that gets a note; null: no such fact. */
    example: string | null;
    /** `{prog}` of the tree's latest import; null: none. */
    program: string | null;
    /** The tree has a shared event (copies at two persons or more, spec 085). */
    shared: boolean;
}
let treeFacts: GedcomTreeFacts | null = null;
/** What each privacy mode leaves out of the measured tree's sources (sources ticked). */
let livingDrops: { data: StromData; byMode: Map<PrivacyMode, { sources: number; citations: number }> } | null = null;

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

export const exportGedcomMethods = uiModule({
    /**
     * The dialog opened (any export): the GEDCOM purpose shows only for a
     * GEDCOM file, preselected (`back` from the What next card, else `share`).
     */
    setupExportGedcomPurpose(gedcom: boolean, preset: GedcomPurpose = 'share'): void {
        purpose = gedcom ? preset : null;
        treeFacts = null;
        livingDrops = null;
        document.querySelector('#export-password-modal .modal')?.classList.toggle('export-dialog--ged', gedcom);
        const box = el('export-gedcom-purpose');
        if (box) box.hidden = !gedcom;
        const mark = el<HTMLInputElement>('export-back-mark');
        if (mark) mark.checked = true;
        if (!gedcom) {
            const back = el('export-back-section');
            if (back) back.hidden = true;
            const size = el('export-back-size');
            if (size) size.hidden = true;
            this.syncExportSourcesWarning();
            return;
        }
        for (const p of ['back', 'share'] as const) {
            const radio = el<HTMLInputElement>(`export-purpose-${p}`);
            if (radio) radio.checked = p === preset;
        }
        this.applyExportGedcomPurpose();
    },

    /** The purpose chosen in the dialog (a radio changed). */
    selectExportGedcomPurpose(p: GedcomPurpose): void {
        if (purpose === null) return;
        purpose = p;
        this.applyExportGedcomPurpose();
        // The choices of "To share" come back as they were left.
        if (p === 'share') {
            this.syncExportPrivacyEffects();
            this.syncExportPresetHighlight();
        }
    },

    /** The GEDCOM purpose of the open dialog; null: not a GEDCOM export. */
    exportGedcomPurpose(): GedcomPurpose | null {
        return purpose;
    },

    /** "Back": the privacy of everyone (Full data). Null: the dialog's choice. */
    exportGedcomPrivacyOverride(): PrivacyMode | null {
        return purpose === 'back' ? 'full' : null;
    },

    /** "Back": the content of `CONTENT_PRESETS.back`. Null: the dialog's choice. */
    exportGedcomContentOverride(): ContentOptions | null {
        return purpose === 'back' ? { ...CONTENT_PRESETS.back } : null;
    },

    /** "Back": the import the file goes back to (the tree's last one, as its title says); undefined otherwise. */
    exportGedcomBackTo(data: Pick<StromData, 'imports'>): string | undefined {
        if (purpose !== 'back') return undefined;
        const imports = data.imports ?? [];
        return imports[imports.length - 1]?.id;
    },

    /** The note text for the research's facts, when "Back" marks them; undefined: no notes. */
    exportGedcomResearchNote(): ((src: string) => string) | undefined {
        if (purpose !== 'back') return undefined;
        const row = el('export-back-mark-row');
        const box = el<HTMLInputElement>('export-back-mark');
        return row && !row.hidden && box?.checked ? strings.exportGed.noteText : undefined;
    },

    /** Show the sections of the chosen purpose: "Back" hides privacy and content for its summary. */
    applyExportGedcomPurpose(): void {
        const back = purpose === 'back';
        const privacy = el('export-privacy-section');
        if (privacy) privacy.style.display = back ? 'none' : '';
        const content = el('export-content-section');
        if (content) content.style.display = back ? 'none' : 'block';
        const section = el('export-back-section');
        if (section) section.hidden = !back;
        this.syncExportGedcomBack();
        this.syncExportSourcesWarning();
    },

    /** The facts of the exported tree the dialog states (null until another tree is read). */
    exportGedcomTreeFacts(): GedcomTreeFacts | null {
        const data = this.exportMeasuredData();
        if (!data) return null;
        if (treeFacts?.data === data) return treeFacts;
        const imports = data.imports ?? [];
        const last = imports[imports.length - 1];
        treeFacts = {
            data,
            sources: Object.keys(data.sources ?? {}).length,
            backSources: backSourceRecordCount(data, last?.id),
            citations: countCitations(data),
            living: countLivingPersons(data),
            example: firstResearchNoteSource(data),
            program: last ? importProgramName(last) : null,
            shared: [...allShareCopies(data).values()].some(copies => copies.length >= 2),
        };
        return treeFacts;
    },

    /** The "Back" title, summary, research-note choice, living sentence and size. */
    syncExportGedcomBack(): void {
        const s = strings.exportGed;
        const facts = purpose === null ? null : this.exportGedcomTreeFacts();
        // A tree with shared events: how the file writes them, after the lead (spec 085 §7).
        const hint = el('export-dialog-hint');
        if (hint && purpose !== null) {
            const lead = strings.encryption.exportLead.gedcom;
            hint.textContent = facts?.shared ? `${lead} ${strings.exportHelp.sharedEvents}` : lead;
        }
        const title = el('export-purpose-back-title');
        if (title) title.textContent = facts?.program ? s.back(facts.program) : s.backGeneric;
        const back = purpose === 'back';
        const size = el('export-back-size');
        if (size) size.hidden = !back || !facts;
        if (!back) return;

        const summary = el('export-back-summary');
        if (summary) {
            const rows: [boolean, string][] = [
                [true, s.sumFull],
                [true, facts && (facts.sources > 0 || facts.citations > 0) ? s.sumSources(facts.backSources, facts.citations) : s.sumNoSources],
                [true, strings.privacy.contentNotes],
                [false, s.sumNoMedia],
            ];
            summary.replaceChildren(...rows.map(([on, text]) => {
                const li = document.createElement('li');
                if (!on) li.className = 'is-off';
                const glyph = document.createElement('span');
                glyph.className = 'export-back-glyph';
                glyph.setAttribute('aria-hidden', 'true');
                glyph.textContent = on ? '✓' : '–';
                const label = document.createElement('span');
                label.textContent = text;
                li.append(glyph, label);
                return li;
            }));
        }
        const markRow = el('export-back-mark-row');
        if (markRow) markRow.hidden = !facts?.example;
        const markSub = el('export-back-mark-sub');
        if (markSub) markSub.textContent = facts?.example ? s.markResearchSub(s.noteText(facts.example)) : '';
        const living = el('export-back-living');
        if (living) living.hidden = !facts || facts.living === 0;
        const livingText = el('export-back-living-text');
        if (livingText) livingText.textContent = facts && facts.living > 0 ? s.livingNote(facts.living) : '';
        if (size && facts) {
            this.readExportContentSizes(facts.data);
            const sizes = this.exportContentSizes;
            size.textContent = sizes
                ? strings.privacy.contentEstimate(TreeManager.formatBytes(sizes.base + sizes.notes + sizes.sources))
                : '';
        }
    },

    /**
     * The footer warning of a GEDCOM file "To share" (spec 066 §5): without
     * "Sources & citations" an amber row with "Keep sources"; under a privacy
     * mode with them a quiet sentence of the living's citations left out.
     * Nothing for a tree without sources, for "Back" or another export.
     */
    syncExportSourcesWarning(): void {
        const box = el('export-sources-warning');
        if (!box) return;
        const facts = purpose === 'share' ? this.exportGedcomTreeFacts() : null;
        if (!facts || (facts.sources === 0 && facts.citations === 0)) {
            box.className = 'export-sources-warning';
            box.replaceChildren();
            return;
        }
        const s = strings.exportGed;
        const content = this.readExportContentOptions();
        const privacy = this.readExportPrivacyMode();
        let kind: 'loss' | 'living' | null = null;
        let text = '';
        if (!content.sources) {
            const d = droppedSources(facts.data, privacy, content);
            kind = 'loss';
            text = s.warnLoss(d.sources, d.citations);
        } else if (privacy !== 'full') {
            if (livingDrops?.data !== facts.data) livingDrops = { data: facts.data, byMode: new Map() };
            let d = livingDrops.byMode.get(privacy);
            if (!d) {
                d = droppedSources(facts.data, privacy, content);
                livingDrops.byMode.set(privacy, d);
            }
            if (d.citations > 0) {
                kind = 'living';
                text = s.warnLiving(facts.living, d.citations);
            }
        }
        box.className = kind ? `export-sources-warning is-${kind}` : 'export-sources-warning';
        if (!kind) {
            box.replaceChildren();
            return;
        }
        const line = document.createElement('span');
        line.className = 'export-warn-text';
        const dot = document.createElement('span');
        dot.className = 'export-warn-dot';
        dot.setAttribute('aria-hidden', 'true');
        const msg = document.createElement('span');
        msg.textContent = text;
        line.append(dot, msg);
        box.replaceChildren(line);
        if (kind === 'loss') {
            const keep = document.createElement('button');
            keep.type = 'button';
            keep.className = 'export-keep-sources';
            keep.textContent = s.keepSources;
            keep.addEventListener('click', () => this.keepExportSources());
            box.append(keep);
        }
    },

    /** "Keep sources": tick Sources & citations (a preset becomes custom content); the row goes. */
    keepExportSources(): void {
        const input = el<HTMLInputElement>('export-content-sources');
        if (input) input.checked = true;
        this.onExportContentChange();
        // The checkbox when it is in sight (a phone may keep Content folded), else the action.
        if (input?.offsetParent) input.focus();
        else el('export-submit-btn')?.focus();
    },
});

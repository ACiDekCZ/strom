/**
 * The new version of an approved story (Story.draft) against the approved one:
 * the comparison dialog (src/story-compare.ts sets its body) and what opens it
 * — the reader, the person dialog, the family book, the card's badge and
 * "Waiting for you". The decision itself is the research's: the two buttons
 * hand over strom-research://story…&do=final|keep and the terminal asks; the
 * tree changes when it is next loaded from the research.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { PersonId, PartnershipId, Story } from '../types.js';
import { formatFlexDate } from '../dates.js';
import { storyProseHtml } from '../story-text.js';
import { storyCompareHtml, wireStoryCompare, STORY_COMPARE_CSS } from '../story-compare.js';
import { ResearchStoryDo, LiveWaiting } from '../research-link.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';
import { shownName } from '../person-name.js';

const COMPARE_ID = 'story-compare-modal';
const STYLE_ID = 'story-compare-style';

/** Whose story: a person's, or a couple's. */
export type StoryTarget = { personId: PersonId } | { partnershipId: PartnershipId };

/**
 * What was handed to the research for which new version, for this session
 * only. Keyed by whose story; it holds while the same new version waits — the
 * next load from the research drops the draft (or brings another) and with it
 * the choice.
 */
const choices = new Map<string, { how: ResearchStoryDo; draft: string }>();

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** `**bold**` in a short line of UI text (the banner sentence). */
export function storyBannerHtml(text: string): string {
    return esc(text).replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>');
}

function personName(id: PersonId): string {
    const p = DataManager.getPerson(id);
    return p ? shownName(p) : '?';
}

/** The story a target carries, when a new version waits beside it. */
export function storyWithDraft(target: StoryTarget): Story | null {
    const story = 'personId' in target
        ? DataManager.getPerson(target.personId)?.story
        : DataManager.getPartnership(target.partnershipId)?.story;
    return story?.status === 'final' && story.draft?.text?.trim() ? story : null;
}

/** When the research wrote the new version, in the UI language (undefined: it did not say). */
export function draftDate(story: Story): string | undefined {
    const at = story.draft?.at;
    if (!at) return undefined;
    const lang = getCurrentLanguage();
    return formatFlexDate(at, lang === 'cs' || lang === 'de' ? lang : 'en') || undefined;
}

function targetKey(target: StoryTarget): string {
    if ('personId' in target) return target.personId;
    const u = DataManager.getPartnership(target.partnershipId);
    return u ? [u.person1Id, u.person2Id].sort().join('+') : target.partnershipId;
}

/** The couple's names, "A and B". */
function coupleName(id: PartnershipId): string {
    const u = DataManager.getPartnership(id);
    return u ? strings.story.couple(personName(u.person1Id), personName(u.person2Id)) : '?';
}

const byRefn = (refn: string | undefined): PersonId | null =>
    refn ? DataManager.getAllPersons().find(p => p.refn === refn)?.id ?? null : null;

/**
 * Whose story a "Waiting for you" item is about (kind "story"): the person,
 * or with a partner their couple. Null when the tree does not have it (yet).
 */
export function storyWaitingTarget(w: LiveWaiting): StoryTarget | null {
    if (w.kind !== 'story') return null;
    const a = byRefn(w.person);
    if (!a) return null;
    if (!w.partner) return { personId: a };
    const b = byRefn(w.partner);
    const u = b ? Object.values(DataManager.getData().partnerships).find(x =>
        (x.person1Id === a && x.person2Id === b) || (x.person1Id === b && x.person2Id === a)) : undefined;
    return u ? { partnershipId: u.id } : null;
}

/** The people a story item names, in order (one, or both partners). */
export function storyWaitingPeople(w: LiveWaiting): { id: PersonId; name: string }[] {
    return [w.person, w.partner].map(byRefn).filter((id): id is PersonId => !!id).map(id => ({ id, name: personName(id) }));
}

export const storyCompareMethods = uiModule({
    /**
     * A "Waiting for you" row of a story's new version: the label, whose it is
     * (each name shows the person in the tree) and "Compare" — the comparison
     * here in the app; without the story in the tree, the research's own way.
     */
    appendStoryWaiting(text: HTMLElement, w: LiveWaiting, show: (id: PersonId) => void): HTMLButtonElement {
        const L = strings.story;
        text.textContent = '';
        const what = document.createElement('span');
        what.className = 'live-waiting-what';
        const kind = document.createElement('span');
        kind.className = 'live-kind-story';
        kind.textContent = strings.live.kindStory;
        what.append(kind, L.nvWaitingItem);
        text.appendChild(what);
        const people = storyWaitingPeople(w);
        if (people.length > 0) {
            const who = document.createElement('span');
            who.className = 'live-waiting-who';
            // "A and B" with each name a link: the words between come from the string.
            const joiner = L.couple('\u0000', '\u0000').split('\u0000')[1];
            people.forEach((p, i) => {
                if (i > 0) who.append(joiner);
                const link = document.createElement('button');
                link.type = 'button';
                link.className = 'live-person-link';
                link.textContent = p.name;
                link.title = strings.research.showInTree;
                link.onclick = (e) => { e.stopPropagation(); show(p.id); };
                who.appendChild(link);
            });
            text.appendChild(who);
        }
        const compare = document.createElement('button');
        compare.type = 'button';
        compare.className = 'live-waiting-answer';
        compare.textContent = L.compare;
        compare.onclick = () => {
            const target = storyWaitingTarget(w);
            if (target && storyWithDraft(target)) this.showStoryCompare(target);
            else this.answerResearchTask(w);
        };
        return compare;
    },

    /** The decision links for a target ({} without them: not a computer, no announced links, …). */
    storyCompareUrls(target: StoryTarget): { final?: string; keep?: string } {
        const url = (how: ResearchStoryDo): string | null => 'personId' in target
            ? this.storyDraftUrl(target.personId, how)
            : this.coupleStoryDraftUrl(target.partnershipId, how);
        const final = url('final'), keep = url('keep');
        return final && keep ? { final, keep } : {};
    },

    /**
     * Open the comparison. `approved` replaces the approved text and title
     * (the person dialog: what is in its fields now, saved or not). Over the
     * reader or the person dialog it is pushed on the dialog stack, so Escape
     * goes back to them.
     */
    showStoryCompare(target: StoryTarget, approved?: { title?: string; text: string }): void {
        const story = storyWithDraft(target);
        if (!story?.draft) return;
        this.closeStoryCompare();
        ensureStoryCompareStyle(document);
        const L = strings.story;
        const who = 'personId' in target ? personName(target.personId) : coupleName(target.partnershipId);
        const body = storyCompareHtml({
            approved: {
                title: approved ? (approved.title || undefined) : story.title,
                text: approved?.text ?? story.text,
                facts: story.facts,
                note: story.note,
            },
            draft: story.draft,
        }, L, {
            idPrefix: 'story-compare',
            prose: (text, title) => storyProseHtml(text, { title }),
        });

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = COMPARE_ID;
        overlay.innerHTML = `
            <div class="modal modal--md story-compare" role="dialog" data-dialog-kind="info" aria-modal="true" aria-labelledby="story-compare-heading">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="story-compare-heading">${esc(L.compareTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(L.compareSub(who, draftDate(story)))}</div>
                    </div>
                    <button type="button" class="close-btn" data-compare-close aria-label="${esc(strings.buttons.close)}">&times;</button>
                </div>
                <div class="story-compare-body">${body}</div>
                <div class="buttons story-compare-foot" id="story-compare-foot"></div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) this.closeStoryCompare(); };
        overlay.querySelector<HTMLButtonElement>('[data-compare-close]')!.onclick = () => this.closeStoryCompare();
        wireStoryCompare(overlay);
        this.renderStoryCompareFoot(target, story, false);
        this.pushDialog(COMPARE_ID);
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        overlay.querySelector<HTMLButtonElement>('.sc-tab[aria-selected="true"]')?.focus({ preventScroll: true });
    },

    /** The footer: the decision, the way to it elsewhere, or what was sent. `justSent`: this open sent it. */
    renderStoryCompareFoot(target: StoryTarget, story: Story, justSent: boolean): void {
        const foot = document.getElementById('story-compare-foot');
        if (!foot) return;
        const L = strings.story;
        const urls = this.storyCompareUrls(target);
        const sent = choices.get(targetKey(target));
        const choice = sent && sent.draft === story.draft?.text ? sent.how : null;
        const close = `<button type="button" class="secondary" data-compare-close data-dismiss>${esc(strings.buttons.close)}</button>`;
        const label = (how: ResearchStoryDo): string => how === 'final' ? L.choiceFinal : L.choiceKeep;
        foot.className = 'buttons story-compare-foot';
        if (choice && justSent) {
            foot.classList.add('story-compare-foot--note');
            foot.innerHTML = `<div class="story-compare-msg" role="status"><strong>${esc(L.sentTitle(label(choice)))}</strong><span>${esc(L.sentBody)}</span></div>${close}`;
        } else if (choice && urls.final) {
            foot.classList.add('story-compare-foot--note');
            foot.innerHTML = `<div class="story-compare-msg">${esc(L.sentAgain(label(choice)))}</div>`
                + `<button type="button" class="link-button" data-compare-again>${esc(L.openAgain)}</button>${close}`;
        } else if (urls.final && urls.keep) {
            foot.innerHTML = `${close}<span class="story-compare-gap"></span>`
                + `<button type="button" class="secondary" data-compare-do="keep">${esc(L.keepOld)}</button>`
                + `<button type="button" class="primary" data-compare-do="final">${esc(L.takeNew)}</button>`;
        } else {
            foot.classList.add('story-compare-foot--note');
            foot.innerHTML = `<div class="story-compare-msg">${esc(L.decideOnDesktop)}</div>${close}`;
        }
        foot.querySelectorAll<HTMLButtonElement>('[data-compare-close]').forEach(b => { b.onclick = () => this.closeStoryCompare(); });
        foot.querySelectorAll<HTMLButtonElement>('[data-compare-do]').forEach(b => {
            b.onclick = () => {
                const how = b.dataset.compareDo as ResearchStoryDo;
                const url = urls[how];
                if (!url) return;
                // No general "Opening in the research…" here: the footer says
                // the choice is not made until the terminal confirms it.
                this.handOverResearchLink(url);
                choices.set(targetKey(target), { how, draft: story.draft?.text ?? '' });
                this.renderStoryCompareFoot(target, story, true);
                foot.querySelector<HTMLButtonElement>('[data-compare-close]')?.focus();
            };
        });
        const again = foot.querySelector<HTMLButtonElement>('[data-compare-again]');
        if (again && choice) again.onclick = () => { const url = urls[choice]; if (url) this.handOverResearchLink(url); };
    },

    closeStoryCompare(): void {
        document.getElementById(COMPARE_ID)?.remove();
        this.dialogStack = this.dialogStack.filter(d => d !== COMPARE_ID);
    },

    /**
     * The family book's window: each "Compare" there opens the same comparison
     * in a <dialog> of the book itself (the book is a window of its own, the
     * app's dialogs cannot reach it), with the same decision footer.
     */
    wireBookStoryCompare(doc: Document): void {
        doc.querySelectorAll<HTMLButtonElement>('[data-story-compare]').forEach(btn => {
            btn.addEventListener('click', () => {
                const dialog = doc.getElementById(btn.dataset.storyCompare ?? '') as HTMLDialogElement | null;
                if (!dialog) return;
                if (!dialog.dataset.wired) {
                    dialog.dataset.wired = '1';
                    wireStoryCompare(dialog);
                    dialog.querySelectorAll<HTMLButtonElement>('[data-compare-close]').forEach(b => b.addEventListener('click', () => dialog.close()));
                    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
                    const target: StoryTarget | null = dialog.dataset.storyPerson
                        ? { personId: dialog.dataset.storyPerson as PersonId }
                        : dialog.dataset.storyCouple ? { partnershipId: dialog.dataset.storyCouple as PartnershipId } : null;
                    dialog.querySelectorAll<HTMLAnchorElement>('a[data-compare-do]').forEach(a => a.addEventListener('click', () => {
                        const how = a.dataset.compareDo as ResearchStoryDo;
                        const L = strings.story;
                        const foot = dialog.querySelector<HTMLElement>('.bc-foot');
                        if (foot) {
                            foot.classList.add('bc-foot--note');
                            foot.innerHTML = `<div class="bc-msg" role="status"><strong>${esc(L.sentTitle(how === 'final' ? L.choiceFinal : L.choiceKeep))}</strong><span>${esc(L.sentBody)}</span></div><button type="button" class="bc-btn" data-compare-close>${esc(strings.buttons.close)}</button>`;
                            foot.querySelector<HTMLButtonElement>('[data-compare-close]')?.addEventListener('click', () => dialog.close());
                        }
                        if (target) choices.set(targetKey(target), { how, draft: storyWithDraft(target)?.draft?.text ?? '' });
                    }));
                }
                dialog.showModal();
            });
        });
    },
});

/** The comparison's look, once per document (the book carries its own copy). */
function ensureStoryCompareStyle(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STORY_COMPARE_CSS;
    doc.head.appendChild(style);
}

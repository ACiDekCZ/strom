# Changelog

English · [Čeština](CHANGELOG.cs.md) · [Deutsch](CHANGELOG.de.md)

## 3.13.0

*This version is in preparation; this section grows with every test version.*

- **Edge of the tree**: a hypothesis whose versions would each link a different family outside the tree shows all of them. The bubble at the edge of the tree and *Above the person* list every family with its versions, people and waiting tasks, each a link to that family; the pill reads *+ 2 families* and offers each one. With Strom Research 1.16 or later.
- **Research for this tree**: one sentence says where the terminal the research opens in is chosen: in the research's settings, with *Settings in the research* beside it. On a computer, with Strom Research 1.16 or later, which brings the choice itself (Terminal or iTerm2 on a Mac).
- **Married surname**: a GEDCOM import keeps the surname after marriage (a second `NAME` with `TYPE married`, or `_MARNM`) apart from the birth surname instead of turning it into another spelling of the name, writes it back on export and to the research, and search finds the person under it too. The name shown stays the birth surname for now.
- **Fixes**: the *+ family · N* pill at the edge of the tree counts the family it shows: for a hypothesis whose variants would each connect a different family outside the tree, the number of people and waiting tasks now belongs to the family that appears on a click.

## 3.12.0

*Released 16 October 2026.*

- **Strom archive**: the research mode without an AI agent is called *Strom archive* everywhere in the app, from the choice in *Ancestor research* to its tag in the Research menu. An archive, and a research waiting for its agent, show no agent actions, and their materials and batches are stored as they are.
- **Research overview**: *Now* comes above *Awaiting action*. Work outside the research directions shows in the row *Outside the directions*, and the live panel names the person each run works on; a person the tree in the app lacks is named by the research identifier. Following live ends at once when the research ends, becomes an archive or waits for its agent.
- **Panning from a card**: a drag that starts on a person card moves the canvas, with the mouse and with one finger; a short press stays a click, tap or long-press. The hover card hides while the canvas moves.
- **Hover card**: every union of a person has a line of its own, in the order of the marriages, with its own children.
- **Find relationship…**: the partner of a partner's sibling is a *brother-in-law* or *sister-in-law*, and any other tie through marriages is *related by marriage*, with its path to highlight, instead of "No relationship found".
- **Cards and the person editor**: the † follows the person's own data, not the death of a descendant; the editor lists birth, events and death in the order of the life; the *Symbols* card style, the photo circle beside a two-row name and long places beside the ⇄ pill (another tree has the person) are aligned. The *Anniversaries* count says what it counts ("3 anniversaries in the next 7 days").
- **Fixes**: "Also in:" no longer takes namesake sisters for one person; *Go to stromapp.info* in an exported file opens the app with the tree ready to import; the GEDCOM import summary no longer clips its labels; in Firefox, the notice about edits kept only in the browser no longer waits for the storage prompt.
- **About**: a *What's new ↗* link opens this changelog in the language of the app. At the first start of a new version a *What's new* window shows the points of that version once, with *All changes ↗* and *Don't show next time*; *Settings → Language and appearance → What's new after an update* turns it back on. On a computer with Strom Research, a newer version of the research adds its own points to the window (*Research X.Y.Z*, with *All research changes ↗*), and About shows *Research X.Y.Z • What's new ↗*.

## 3.11.0

- **Linked in the view only**: a family a research hypothesis would link can be shown where the hypothesis puts it, as hatched ghost cards, without changing the tree. Counts, the other views, sending and every output leave the shown links out. An indicator over the view opens the list of shown links.
- **What the research knows** lists a person's hypotheses with their state and versions, and a switch for each version that can be shown.
- **Conflicts from an edit in the app** show two sides, *From the app* and *In the research*; on the computer with the research, either value can be kept in one step.
- **Waiting in the research overview**: chips by kind, two phases (*To do* and *Awaiting a reply*), items grouped by place, and *Sent* written straight to the research, with Undo.
- **Research**: *Last 24 h* takes the research's own count, *This month* includes the scan readers' cost, a refused send says why in the language of the app, and an empty tree offers *Start research with this tree*.
- **About**: in the Czech interface, a link to the users' group on Facebook.
- **Fixes**: a single parent in a marriage chain stands over its own child; deleting a tree right after adding people names the right number of people; bottom sheets on touch screens are opaque from their first frame.
- **Data**: data version 12, as in 3.10; nothing to migrate. The new research parts need Strom Research 1.14.

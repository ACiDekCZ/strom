# Strom

Family tree application that runs entirely in your browser. No server required, your data stays with you.

**Online version:** [stromapp.info](https://stromapp.info)

## Features

**People & Records**
- Add, edit, delete persons; multiple marriages, divorces, step-siblings
- Adoptive, step and foster parent-child relationships (drawn distinctly)
- Flexible dates ("around 1880", "before 1900", year only)
- Photos, life events (baptism, occupation, residence…), notes
- Sources & citations with a per-tree catalog; document attachments (scans, PDFs)
- Duplicate hints while typing; family wizard (add a whole family in one form)
- Undo/redo for every change

**Visualization**
- Interactive tree with generation rows; zoom (scroll/pinch) and pan (drag/swipe)
- Family, descendants-only and timeline view modes
- Overview minimap for large trees; advanced search filters with in-tree highlighting
- Relationship calculator ("second cousin once removed")
- Family statistics charts; anniversaries panel and "on this day" reminders
- Responsive design (desktop, tablet, mobile — long-press action sheet on touch)
- Light/dark theme

**Family Collaboration (no cloud)**
- "Send to a relative": e-mail a single file with a personal note
- The recipient opens it, fills in their branch, and sends it back with one click
- Strom recognises the returned file and offers a side-by-side merge

**Tree Management**
- Multiple trees in one app; rename, duplicate, delete
- Smart merge with conflict resolution; validation; statistics
- Automatic versioned backups with one-click restore (time capsules)
- Person and tree locking

**Import / Export / Print**
- GEDCOM import & export (Ancestry, FamilySearch, Gramps; events, sources, PEDI)
- JSON export/import; HTML file import; branch-only export
- Standalone HTML file export (the whole app + data, works offline)
- Printable family book (chapters, sources as footnotes, person index)
- Poster export (SVG / PNG / tiled print)
- Living-person privacy filter for every export (initials / anonymous / minimal)

**Privacy & Offline**
- No server, no accounts, no tracking — data stays in your browser
- Optional AES-256 encryption; password-protected exports
- Installable PWA with full offline mode

**Two Ways to Use**

| Online Version | Standalone File |
|----------------|-----------------|
| [stromapp.info](https://stromapp.info) | Download `strom.html` |
| PWA - install to home screen | Works offline, no internet needed |
| Data in browser storage | Data in browser storage (separate) |
| Always latest version | Version frozen at download time |

Note: Online and standalone versions use separate storage. To transfer data between them, use JSON export/import or import the HTML file directly.

**Other**
- Person search (live search + URL parameter)
- English and Czech language
- Offline support (PWA)

## Quick Start

### Online
Visit [stromapp.info](https://stromapp.info) and start adding your family.

### Standalone
Download `strom.html` from [Releases](https://github.com/ACiDekCZ/strom/releases) and open in any browser.

### Build from Source
```bash
git clone https://github.com/ACiDekCZ/strom.git
cd strom
npm install
npm run build
# Output: strom.html
```

## Usage

- **Add Person** - Click "+ Add Person" or use the button on empty state
- **Edit Person** - Click on any person card to edit details or manage relationships
- **Navigate** - Drag to pan, scroll to zoom, or use zoom controls
- **Focus** - Click person → "Focus" to see only their immediate family
- **Export** - Menu → "Export App" to save your tree as portable HTML file
- **Import** - Supports JSON, GEDCOM, and Strom HTML files

## Technology

- TypeScript with strict mode
- esbuild for bundling
- No runtime dependencies
- Single HTML file output (~550kb)
- Works offline in any modern browser
- Progressive Web App (PWA) support

## Development

```bash
npm run watch    # Dev mode with auto-rebuild
npm run build    # Production build
npm run typecheck # Type checking
npm test         # Run tests
```

## License

This project uses a dual license model:
- **Non-commercial use**: [Mozilla Public License 2.0](LICENSE)
- **Commercial use**: Requires separate agreement. Contact: milan@stromapp.info

See the [LICENSE](LICENSE) file for details.

## Author

**Milan Víšek** - [stromapp.info](https://stromapp.info)

---

*Strom - Your family history, always with you.*

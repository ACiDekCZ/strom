# Strom

Family tree application that runs entirely in your browser. No server required, your data stays with you.

**Online version:** [stromapp.info](https://stromapp.info)

## Features

**People & Relationships**
- Add, edit, delete persons
- Multiple marriages, divorces, step-siblings
- Birth/death dates and places
- Placeholders for unknown persons

**Visualization**
- Interactive tree with generation rows
- Zoom (scroll/pinch) and pan (drag/swipe)
- Focus mode - show subset of tree around selected person
- Responsive design (desktop, tablet, mobile)
- Light/dark theme

**Tree Management**
- Multiple trees in one app
- Rename, duplicate, delete trees
- Smart merge with conflict resolution
- Tree validation (detect issues)
- Tree statistics (counts, age ranges, anniversaries)
- Set default person/tree for startup

**Import/Export**
- GEDCOM 5.5.1 import (compatible with Ancestry, FamilySearch, Gramps)
- JSON export/import
- HTML file import (extract data from exported Strom files)
- Export as standalone HTML file (works offline)
- Export only focused subset

**Encryption**
- Optional AES-256 data encryption
- Password-protected exports

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
Download `strom.html` from [Releases](https://github.com/AciDek/strom/releases) and open in any browser.

### Build from Source
```bash
git clone https://github.com/AciDek/strom.git
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

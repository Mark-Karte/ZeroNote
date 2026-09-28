<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="icons/zeronote-dark-128.png">
  <img src="icons/zeronote-light-128.png" width="112" alt="ZeroNote logo">
</picture>

# ZeroNote

**A text and notes editor for Windows**<br>
opens instantly, like Notepad++, and works with a folder as a project

<a href="README.md"><img src="https://img.shields.io/badge/-%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-2a2d36?style=for-the-badge" alt="Русский"></a>
<a href="README.en.md"><img src="https://img.shields.io/badge/-English-3b9cf6?style=for-the-badge" alt="English"></a>

<a href="https://github.com/Mark-Karte/ZeroNote/releases/latest"><img src="https://img.shields.io/github/v/release/Mark-Karte/ZeroNote?style=for-the-badge&label=version&labelColor=1c1e25&color=8cc3fc" alt="Version"></a>
<img src="https://img.shields.io/badge/Windows-10%20%C2%B7%2011-b7b5fc?style=for-the-badge&labelColor=1c1e25" alt="Windows 10 and 11">
<a href="LICENSE"><img src="https://img.shields.io/github/license/Mark-Karte/ZeroNote?style=for-the-badge&label=license&labelColor=1c1e25&color=e4b572" alt="License"></a>
<a href="https://github.com/Mark-Karte/ZeroNote/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Mark-Karte/ZeroNote/ci.yml?branch=main&style=for-the-badge&label=checks&labelColor=1c1e25&color=8ed09c" alt="Checks"></a>
<a href="https://github.com/Mark-Karte/ZeroNote/commits/main"><img src="https://img.shields.io/github/last-commit/Mark-Karte/ZeroNote?style=for-the-badge&label=last%20commit&labelColor=1c1e25&color=69cee6" alt="Last commit"></a>
<a href="https://github.com/Mark-Karte/ZeroNote/stargazers"><img src="https://img.shields.io/github/stars/Mark-Karte/ZeroNote?style=for-the-badge&label=stars&labelColor=1c1e25&color=f8a49d" alt="Stars"></a>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/window-dark.png">
  <img src="docs/screenshots/window-light.png" alt="ZeroNote window with a project open">
</picture>

<br>

<a href="https://github.com/Mark-Karte/ZeroNote/releases/latest"><img src="https://img.shields.io/badge/Download%20for%20Windows-3b9cf6?style=for-the-badge" height="36" alt="Download for Windows"></a>

<sub>Windows 10 and 11, 64-bit · about 7 MB · no administrator rights needed</sub>

</div>

> [!NOTE]
> **The interface is in Russian for now.** An English interface is coming
> in version 0.21.0 — the work is under way. Until then the screenshots
> show the Russian interface, and menu names below are given in English
> with the current Russian label in brackets. This translation of the
> README is new as well: if something reads wrong, please
> [open an issue](https://github.com/Mark-Karte/ZeroNote/issues).

ZeroNote works with a folder as a project — a file tree, full-text search
and links between notes. An Obsidian vault opens as a plain folder:
ZeroNote understands `[[links]]`, tags and frontmatter as properties
of markdown itself, not as a “compatibility mode”. ZeroNote's own project
format is a single `zeronote.toml` file, and even that appears only when
you ask for it.

## Installation

1. Download `ZeroNote_*_x64-setup.exe` from the
   [releases](https://github.com/Mark-Karte/ZeroNote/releases) page.
2. Run it. It installs into your user profile — no administrator rights
   needed.

You need Windows 10 or 11 (64-bit) and WebView2 — Windows 11 has it out
of the box, and on Windows 10 it usually arrives with Edge. The installer
is about 7 MB.

**Windows will show a blue SmartScreen window** — “Windows protected your
PC”. This happens to any program without a code-signing certificate;
a certificate costs money and isn't planned for the first round. To
install: “More info” → “Run anyway”. If you'd rather not trust it, build
from source — it's two commands, see below.

The app checks for updates **only when you ask**: Settings → About →
Updates («Параметры → Сведения → Обновления»). It never goes online
on its own; there are no background checks.

**In File Explorer**, after installation, “Open in ZeroNote” («Открыть
в ZeroNote») appears on files and on folders, and ZeroNote joins the
“Open with” list for notes, text, data and source code — fifty-odd
extensions from `.md` and `.json` to `.py` and `.cpp`. The installer
doesn't take over the defaults: to open `.md` files with a double click,
choose ZeroNote yourself — right-click a file, “Open with” → “Choose
another app”, or in Windows Settings, “Default apps”. File types assigned
to ZeroNote get their own icon in Explorer: a page with a stripe
in the file type's colour and a type label.

On Windows 11, “Open in ZeroNote” lives under “Show more options” (the same
menu opens right away with Shift+F10). Everything the installer added
to the registry is removed on uninstall; the `data` folder with settings,
themes and the session stays.

## What it looks like

One palette field, three modes: files by fuzzy match, `>` for commands,
`#` for tags. A few letters are enough — `edtr` finds `EditorHost.svelte`.

![Quick open palette](docs/screenshots/palette.png)

Search across the whole project — with snippets, so you can see what
exactly matched. The index is built in the background and doesn't get
in the way of typing.

![Project search with snippets](docs/screenshots/search.png)

Nine built-in themes: One Dark, Dracula, Tokyo Night, GitHub Light,
Solarized Light, Catppuccin Latte, Contrast, and the Obsidian Dark
and Obsidian Light pair. The first six are adaptations of popular themes
to ZeroNote's styling layer, all under the MIT license, with links
to the sources in the theme files' headers. The Obsidian pair repeats
the look of Obsidian's default theme: colours, fonts and note measures.
The light and dark pair follow the Windows setting — just like this
README: the window at the top matches your GitHub theme, and this one
shows the other.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/window-light.png">
  <img src="docs/screenshots/window-dark.png" alt="ZeroNote window in the other theme">
</picture>

## Features

### Folder as a project

- A folder opens as a root (`Ctrl+Shift+O`); roots survive a restart.
- A file tree that watches the disk: a file created by another program
  shows up by itself. Create, rename, delete — **to the Recycle Bin only**.
  Ignore rules follow `.gitignore` semantics, nested files included.
- Renaming a note fixes the links to it in other files. The list of what
  will change is shown **before** the edit, and you can back out.
- Quick open by name (`Ctrl+P`) with fuzzy matching: `edtr` finds
  `EditorHost.svelte`. It finds images and PDFs too, not just text.
- Full-text search (`Ctrl+Shift+F`) on SQLite FTS5: built in the background,
  cancellable, updated by itself as files change on disk. Regular
  expressions work too.
- Replace across the whole project or one folder: the list of changes
  is shown **before** anything is written, a file with unsaved edits
  is left alone, and the last five replacements can be undone.
- Document outline: headings as a list, a click takes you to the section,
  the section under the cursor is highlighted.
- Tags panel: which tags the project has and how much each one marks;
  a click shows the notes with that tag.
- Links between notes: `[[links]]`, tags, frontmatter, go to with `F12`
  and `Ctrl`+click, a backlinks panel. A dangling link is visible,
  and `Ctrl`+click on it creates the note where the link points.
- A link can lead to a section: `[[note#Section]]`, `[[#Section]]` —
  in the same note, `[[note#^id]]` — to a block ID; after `#` a popup
  suggests the headings. Same rules as in Obsidian.
- Attachments in Obsidian syntax: `![[picture.png]]` shows as an image,
  `[[picture.png]]` opens it in a tab.
- A screenshot from the clipboard (`Ctrl+V`) is saved as a file in the
  attachments folder, and a link to it goes into the text. A file dropped
  from Explorer onto a note's text becomes a link at the drop point;
  a file from outside the project is first copied into attachments.
  Where the attachments folder is — a setting, with the same values
  as in Obsidian. An existing file is never overwritten.
- An Obsidian vault is recognised, and its exclusion filters carry over
  into ZeroNote's format. Nothing is ever written into `.obsidian`.

### Notes

- Live markdown preview: markup characters hide, and the line under
  the cursor shows as written — you can always edit. The file itself
  doesn't change by a single byte; the “preview / source” switch is
  in the status bar.
- A note looks like it does in Obsidian: text in a proportional font,
  code in a monospace one, callouts as cards in their type's colour,
  lists with nesting guides, tags as pills. The note font is set
  separately from the code font.
- The file name stands as a title above the note, and editing that title
  renames the file — along with the links to it, as in the tree. Can be
  turned off in settings.
- Frontmatter properties as a card: key, value, tags as pills. They are
  edited as source: a click on a property puts the cursor there.
- Tables as a grid, images inline, callouts `> [!tip]` — the list
  of callouts is your own: label, colour and icon are editable. Tasks
  `- [ ]` are ticked with a click.
- Footnotes `[^1]`, comments `%%…%%` — visible in the note, kept out
  of printing and export, — a colour swatch next to a `#rrggbb` code.
- Formulas `$…$` and `$$…$$`, as in Obsidian. They are drawn by the
  window's engine in Cambria Math, a font every Windows has.
- Mermaid diagrams: a ` ```mermaid ` block shows as a diagram in the
  theme's colours.
- A home for notes — a vault that is always open, next to your projects
  and independent of them: a calendar of daily notes, “Today's note”,
  templates with `{{date}}`, `{{time}}`, `{{title}}`.
- A word count in the status bar — for the note and for the selection,
  characters in the tooltip. Properties at the top of a note aren't
  counted.

### Out into the world

- Printing, export to PDF in one command and export to HTML as one
  file — styles, images, formulas and diagrams inside, opens in any
  browser.
- Copy with formatting — into an email or Word: formulas become Word
  equations, diagrams become pictures.
- Paper is always light, even when the screen theme is dark.

### Editor

- Tabs with drag and drop, session restore after a restart — including
  unsaved tabs with no file on disk.
- Editor panes, as in VS Code: `Ctrl+\` splits a pane, tabs drag between
  panes and onto a pane's edge, one file can be open in several panes
  at once, and the layout survives a restart.
- Encodings: UTF-8, UTF-16 LE/BE, windows-1251, windows-1252, IBM866,
  KOI8-R. Detected automatically, shown in the status bar, changed
  by hand — separately “reopen as” and “convert to”.
- CRLF/LF/CR line endings are kept as they were. Indentation is detected
  from the file's content, not from a setting.
- Syntax highlighting for twenty languages, including code inside
  markdown blocks.
- A toolbar above the text; which buttons and in what order — a setting.
  Markdown formatting **toggles**: pressing it a second time removes it.
- Images and PDFs open in their own tab, with zoom and page navigation.
- Find and replace, including with regular expressions. Multiple cursors,
  code folding, bracket pairs, bookmarks, invisible characters.
- Back and forward through cursor locations (`Alt+←`, `Alt+→`) — as in
  a browser, and with the arrows in the header. A tab closed by mistake
  comes back with `Ctrl+Shift+T`, together with its cursor, language
  and bookmarks.
- Line numbers show only in code: in a note a line number tells you
  nothing. A setting brings them back anywhere.
- Autosave — a setting, off by default: a file editor doesn't write
  into someone's file without a command. Drafts always work.
- A context menu everywhere — in the text, on a tab, in the tree,
  in an input field.
- Files over 50 MB open read-only.

### Configuration

- Everything configurable lives in readable files: `settings.toml`,
  `keymap.toml`, themes. The settings window is a layer on top of them,
  not the other way round: it edits the file, keeping comments and key
  order.
- Keyboard shortcuts are reassigned on the “Hotkeys” («Клавиши») tab
  of the settings window or right in the file. The keymap grew out of
  Notepad++; new shortcuts come from VS Code.
- The theme is chosen on the “Appearance” («Оформление») tab of the
  settings window — as a card with a sample in the real colours. There,
  too: “create your own based on this one”, an editor for the theme's
  colours and sizes, and fonts for the interface and the text. Save the
  theme file — the window redraws, no restart needed.
- A typo in the settings file doesn't switch off the whole file: the
  unknown part is named in a bar at the top of the window, and everything
  else applies.

## What isn't there, and won't be in the first round

Windows only, local file system only. Out of scope: sync and cloud, Linux
and Android, plugins, macros, LSP and autocompletion, file comparison,
FTP, real-time collaboration.

Not yet, but under discussion: a link graph, a minimap. The full list is
the “Deferred” («Отложено») section in [DESIGN.md](DESIGN.md), in Russian.

## Under the hood

Tauri v2, Rust, TypeScript and Svelte 5, CodeMirror 6, SQLite FTS5. The
heavy lifting — I/O, encodings, tree walking, indexing — is done in Rust;
the window takes care of display. PDFs are shown by pdf.js, formulas
by Temml, diagrams by mermaid; all three load only when needed and don't
affect startup.

The project rests on six invariants, and the first one is: **other
people's files are untouchable**. Open, save — the file is byte-for-byte
the same: encoding, line endings, trailing newline. No auto-formatting
without an explicit command.

The concept, data model, invariants, measurements and decision log are
in [DESIGN.md](DESIGN.md) (in Russian). It also explains why each
decision was made the way it was; it's the project's main document,
and the README is only the entrance.

## Building from source

You need Rust 1.88 or newer (msvc) and Node 20+.

```bash
npm install
npm run tauri build
```

The installer will appear in `src-tauri/target/release/bundle/nsis/`.
A debug run is `npm run tauri dev`.

Checks:

```bash
npm run check
npm test
```

```bash
cd src-tauri && cargo test
```

The same three checks run on every change to `main` and on every pull
request — [.github/workflows/ci.yml](.github/workflows/ci.yml), on Windows.
The “checks” badge at the top shows the state of the latest run.

Performance measurements — the bench is built into the app and switched
on with command-line arguments; targets and results are in
[DESIGN.md](DESIGN.md), the “Measurements” («Измерения») section.

```bash
npm run tauri build
powershell -File bench\perf.ps1
```

## Found a problem?

Open an [issue](https://github.com/Mark-Karte/ZeroNote/issues) — in English
or in Russian. It helps to include your Windows version, your ZeroNote
version (Settings → About → Copy, «Параметры → Сведения → Скопировать»),
what you did, what you expected and what happened. For problems opening
a file — its encoding and line-ending type from the status bar, or better
the file itself: an encoding can't be guessed from a description.

What matters most are violations of the invariants, and the first one:
**the file changed by itself**. You opened it, edited nothing, saved —
and the file is different. Such a report is looked at before any other.

If the app behaves oddly after an update, look at the warning bar at the
top of the window: errors in `settings.toml`, `keymap.toml` and theme
files go there.

How to propose a change to the code or to a translation — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Authorship

Mark Karte and Claude (Anthropic). The project is written as a pair:
architecture decisions and acceptance are the human's, a large part
of the code and design documentation is the model's. The decision log
in [DESIGN.md](DESIGN.md) is kept so that every significant decision can
be traced and challenged, whoever proposed it.

## License

MIT — see [LICENSE](LICENSE). Copyright holder — Mark Karte.

The palettes of six built-in themes are adapted from popular editor
themes — the lightness of some colours and the mapping of roles have been
changed, the hues kept. All six sources are under the MIT license:

- **One Dark** — © 2016 GitHub Inc., [atom/one-dark-syntax](https://github.com/atom/one-dark-syntax)
- **Dracula** — © 2023 Dracula Theme, [dracula/dracula-theme](https://github.com/dracula/dracula-theme)
- **Tokyo Night** — © 2018–present Enkia, [enkia/tokyo-night-vscode-theme](https://github.com/enkia/tokyo-night-vscode-theme)
- **GitHub Light** — © 2020 Primer, [primer/github-vscode-theme](https://github.com/primer/github-vscode-theme)
- **Solarized Light** — © 2011 Ethan Schoonover, [altercation/solarized](https://github.com/altercation/solarized)
- **Catppuccin Latte** — © 2021 Catppuccin, [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin)

The Obsidian Dark and Obsidian Light pair repeats Obsidian's default theme
in numbers — the colours and sizes Obsidian publishes in its documentation
for theme authors; the code of its stylesheet is not used. Obsidian
is a trademark of Dynalist Inc.; ZeroNote is not affiliated with it.

The MIT license of all six reads the same as ours: use, copying,
modification and distribution are permitted provided the copyright notice
and the permission text accompany the copy. A link to the source and the
list of changes are in the header of each theme file; the full license
texts are in the repositories listed.

Two fonts under the SIL Open Font License 1.1 ship with the app:
**IBM Plex Sans** (© 2017 IBM Corp.) and **JetBrains Mono**
(© 2020 The JetBrains Mono Project Authors). The files and license texts
are in [src/theme/fonts/](src/theme/fonts/). This doesn't affect the rest
of the code and documentation: the OFL applies to the fonts themselves.

The app window bundles libraries under open licenses. The largest:
**pdf.js** (Apache-2.0, © Mozilla Foundation), **Temml** (MIT, © 2020 Ron
Kok), **mermaid** (MIT, © Knut Sveidqvist) with its dependencies — they are
under MIT, ISC, BSD-3-Clause and Apache-2.0, the layout engine **elkjs**
under EPL-2.0 (sources — [eclipse/elk](https://github.com/eclipse/elk) and
[kieler/elkjs](https://github.com/kieler/elkjs)), **DOMPurify** under
MPL-2.0 or Apache-2.0 at your choice. **All third-party components — fonts,
theme palettes, 91 window libraries and 210 core crates — are listed with
their license texts in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).**
The installer puts the same file next to the program; inside ZeroNote
it opens from Settings → About → Licenses («Параметры → Сведения →
Лицензии»).

**The Temml font does not ship with the app.** The `Temml.woff2` file
itself states a ban on commercial use, and the project is under MIT.
Formulas are drawn with the system font Cambria Math; because of that,
`\mathscr` letters look the same as `\mathcal`.

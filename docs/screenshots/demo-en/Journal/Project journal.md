---
tags:
  - project
  - journal
created: 2026-09-27
status: in progress
---

Notes on how the editor is being built. Related entries — [[Ideas]]
and [[Meetings]]. #project

> [!tip] Preview rule
> The line under the cursor shows as source — you can always edit it.

## Done this week

- The file tree watches the disk: a file from another program shows up by itself.
- Project search is back with **snippets** — you can see what exactly was found.
- The index builds in the background and never blocks typing.

## What's left

- [x] Syntax highlighting inside code blocks
- [x] File name above the note
- [ ] Link graph
- [ ] Comparing two files — outside the first round

## A piece of code that explains it all

Atomic save: a temporary file next to the target, flushed to disk, then swapped in.

```rust
let temp = target.with_extension("zn-tmp");
fs::write(&temp, bytes)?;
replace_file(&target, &temp)?;
```

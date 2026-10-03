# Threat model

## What the tool touches

- It reads the map file named on the command line, and the baseline map named with `--baseline`. Nothing else on the disk is opened.
- It does not follow a path written inside a map: not a `LOAD` line, not an object file, not an archive, not the ELF file named in `OUTPUT(...)`. A symbolic link given as an argument is followed, because the person who runs the tool named it; the target must be a regular file.
- It writes only to the screen (standard output and standard error).
- It opens no network connection and runs no program: not a shell, not the linker, not a binary tool.

## What the input may hold

A map file is written by the build, often in a pipeline that runs on pull requests, where the sources and the linker script come from anyone who can open one. The tool treats each file as possibly hostile. It can be huge, hold millions of lines or a single line of many megabytes, very many regions, sections or symbols, or numbers too large for any memory. It can be a binary file, an ELF file or the map of another linker given by mistake. A section, object or symbol name can be `__proto__` or `constructor`, hold control and direction characters, or start with `=` so that a spreadsheet runs it. A path can hold markup that a Markdown table would render. A line can be crafted to make a careless pattern run for a very long time.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A huge file, very many lines, regions, sections or symbols exhaust memory or time | A file over 32 MB is refused from the size of the open file before it is read; at most 2,000,000 lines, 256 regions, 20,000 output sections, 500,000 input sections and 1,000,000 symbols and assignments, each refused with exit code `2` |
| A very long line or a crafted near miss makes a pattern run for a very long time | A line over 4,096 characters is counted as not parsed and never matched; every pattern is anchored, with bounded repeats, and runs of `\S` and `\s` that cannot overlap. Tests run long near misses and check the time |
| A file that is not a GNU ld map is read as one, and passes | Both map headers must be there; any other file is `unknown-format`, an error, and nothing else is checked. A binary file, an ELF file and the maps of lld, IAR, armlink and LINK are named |
| A line is dropped, and the bytes it held are missing from a total | Every line is counted as read, skipped, blank or not parsed; the counts add up and are printed, and lines not parsed are reported by `unparsed-lines` |
| A section outside every region is missed, so its bytes are in no budget | `orphan-section` reports it; a section past the end of a full region is counted in that region and named in a note |
| Thousands of findings of one kind make the report huge | A check lists its first 200 findings in a fixed order, counts the rest in the totals and the gate, and says so in a note |
| A name such as `__proto__` or `constructor` changes how objects behave | Regions, sections, objects and budgets are kept in arrays and maps; a test checks that no prototype changes |
| A name or a path rewrites the terminal through escape sequences, or reorders text with direction characters | Control characters (C0 and C1), line and paragraph separators and Unicode direction controls are replaced by a space before any text reaches a report or an error message, and the length is capped |
| A name breaks the Markdown table in the job summary, makes a link, or hides text as an HTML tag | Pipes, backslashes, square brackets, backticks, asterisks, underscores, line breaks, `<`, `>` and `&` are escaped in every table cell |
| A CSV report runs a formula when opened in a spreadsheet | Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; every cell is quoted as RFC 4180 says |
| A map names other files, so the tool reads more than it was given | Paths in the map are text; they are never opened |
| The argument names a URL, so the tool becomes a fetcher | Arguments that look like addresses are refused; reading from standard input is refused |
| A pipe or a device in place of a file makes the tool hang | The type is looked at before the file is opened and again on the open file, and anything that is not a regular file is refused |

## Out of scope

How the firmware uses memory at run time: the real depth of the stack, the real use of the heap, what an RTOS allocates. The correctness of the GNU ld manual and of the linker. [limits.md](limits.md) lists what a map file cannot show.

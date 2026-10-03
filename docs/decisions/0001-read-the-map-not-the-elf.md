# 1. Read the map file, not the ELF file

## Context

The tool needs to say how firmware uses its flash and RAM, early enough to act: when a pull request adds a feature, before a region overflows on the next one. There are other ways to know. `size` prints the text, data and bss totals of an ELF file; `nm` and `objdump` list its symbols and sections; `--print-memory-usage` makes the linker print one line per region. Each of them needs the toolchain of the target installed where the check runs, or a reader for ELF, and none of them says which object file the bytes come from, or where the regions end.

The map file that GNU ld writes holds all of this in one text file. The manual lists what a link map shows: "A link map provides information about the link, including the following:" and "Where object files are mapped into memory." It holds the regions of the MEMORY command with their lengths, every output section with its address, size and load address, and every input section with the object file or archive member it came from. Most embedded builds already write one, and keep it as a build artifact.

A map does not say everything. It shows what the linker placed, not what the firmware does at run time: the real depth of the stack, the use of the heap, the memory an RTOS takes. And the manual does not describe the layout of its lines, so a reader has to follow the layout that ld writes, and say so when it meets a line it does not know.

## Decision

The tool reads one map file (and, for growth, an older one) as text. It reads the sentences it quotes from pages of the GNU ld manual that are saved with their addresses, and a test compares the code with the saved text. It never runs the linker or a binary tool, never opens the ELF file or an object named in the map, never fetches anything and never runs a program.

Every line of the map is counted as read, skipped, blank or not parsed, and a line that is not parsed is reported. A file that is not a GNU ld map is an error, not a pass. Every check says what it can and cannot see; the severities, the default limits and the lists of names are the tool's own and are said to be. Findings carry the line in the map, the addresses and the sizes.

Only GNU ld maps are read. The maps of LLVM lld, IAR, armlink and other linkers have other layouts; reading them by guess would give totals that look right and are not, so they are named and refused.

## Consequences

The check runs in a second, on Linux, macOS or Windows, with only Node: no cross toolchain, no account and no network access, and no input can make it run code or reach out to a host. The same map gives the same report, so it can run on every build and gate the merge, and the growth check can compare a pull request with the main branch. The cost is that it sees what the linker placed, not what the firmware does: a stack that is reserved can still be too small, and a heap can still fragment. The tool says what it left out, lists its limits in docs/limits.md, and leaves the final answer to the people who know the firmware.

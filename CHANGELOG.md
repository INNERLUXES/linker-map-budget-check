# Changes

## 1.0.0

First release.

- Reads a map file that GNU ld writes with `-Map=<file>` (from arm-none-eabi-gcc, riscv64-unknown-elf-gcc, avr-gcc and other GNU toolchains): the Memory Configuration table, the output sections with their addresses, sizes and load addresses, the input sections with their object files and archive members, and the symbols and assignments. Every line is counted as read, skipped, blank or not parsed. Never runs the linker, never reads the ELF file and never fetches anything.
- Budget: a region that holds more bytes than its length or than the budget given with `--budget` (`region-over-budget`), and a region above the warning level of `--warn-percent`, 90 by default (`region-near-full`). Sections that the linker placed past the end of a full region count in that region.
- Placement: an output section with code or data outside every declared region (`orphan-section`), and initialised data that counts in the region it runs in and the one it is loaded from (`data-counted-twice`, info).
- Stack and heap: no space set aside for the stack (`no-stack-reserve`), and malloc or sbrk linked with no space set aside for the heap (`no-heap-reserve`). Each finding says what the tool looked for and what it found.
- Largest objects: an object file or archive member that takes more of a region than `--max-object`, 25 percent by default (`large-input-section`), and the largest objects and archives of every region (`top-objects`, info, with `--top`).
- Growth: with `--baseline`, a region (`region-growth`) or an object (`object-growth`) that grew more than `--max-growth`, 1 percent of the region by default.
- The map itself: lines in no known form (`unparsed-lines`, info), and a file that is not a GNU ld map, such as a map of LLVM lld, IAR or Keil, an ELF file or a binary file (`unknown-format`, error).
- Every finding has an id, a severity (error, warning, info), the line in the map, a message with the addresses and sizes, a fix, and the sentence of the GNU ld manual it rests on, with the address.
- Every quoted sentence comes from pages of the GNU ld manual that are saved in `research/sources`; a test compares `src/data.js` and the documents with the saved text.
- Reports as text, Markdown, JSON and CSV; `--fail-on` for a pipeline gate; info never fails the run; exit code `2` for a usage or input error.
- Safe input: only the files given are read, files over 32 MB are refused, at most 2,000,000 lines, 256 regions, 20,000 output sections and 500,000 input sections, a line over 4,096 characters is not parsed, every pattern is anchored and bounded, and control characters are removed from every text shown.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation.

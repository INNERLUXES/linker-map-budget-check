# Rules and sources

Every sentence that the tool quotes comes from a page of the GNU ld manual that is saved in [research/sources](../research/sources), with its address on the first line. `src/data.js` holds them, and `test/data.test.js` compares each one with the saved text. Nothing was added from memory. Change a sentence only after saving the new page text and updating this file.

## The saved pages

| File | Address | What it is used for |
| --- | --- | --- |
| `ld-memory.txt` | https://sourceware.org/binutils/docs/ld/MEMORY.html | regions, their origin and length, the attributes, placing sections with `>region`, and the error when a region is too full |
| `ld-map-option.txt` | https://sourceware.org/binutils/docs/ld/Options.html | what a link map holds (`-M`), `--print-memory-usage`, and `-Map=mapfile` |
| `ld-output-section-lma.txt` | https://sourceware.org/binutils/docs/ld/Output-Section-LMA.html | the load address of a section, set with `AT` and `AT>` |
| `ld-output-section-description.txt` | https://sourceware.org/binutils/docs/ld/Output-Section-Description.html | the full description of an output section, with `>region` and `AT>lma_region` |
| `ld-orphan-sections.txt` | https://sourceware.org/binutils/docs/ld/Orphan-Sections.html | input sections that the linker script does not place |
| `ld-basic-concepts.txt` | https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html | input and output sections, allocatable sections, VMA and LMA, and data loaded into ROM and copied into RAM |
| `ld-location-counter.txt` | https://sourceware.org/binutils/docs/ld/Location-Counter.html | moving the location counter, which is how a stack or heap reserve is made |

The pages are saved as the text of the manual, from the heading of the section to its end, with the navigation left out. From the Options page only the entries for `-M` (`--print-map`), `--print-memory-usage` and `-Map=mapfile` are kept. The Output Section LMA page is cut before its example of start-up code, and the Location Counter page after its first example. Typographic quotes are written as plain ASCII.

The manual says what a map holds, not the exact layout of each line. The line forms that the tool reads (docs/inputs.md) are taken from maps that GNU ld writes; a line in no known form is counted and reported by `unparsed-lines`, never read by guess.

## The sentences that the findings quote

Each sentence is on its saved page word for word. A key used by "docs" is quoted in the documents and in no finding.

| Key | Used by | Sentence | Page and section |
| --- | --- | --- | --- |
| `memoryDescribes` | docs | "The MEMORY command describes the location and size of blocks of memory in the target." | `ld-memory.txt`, MEMORY Command |
| `warnTooFull` | `region-near-full` | "The linker will set section addresses based on the memory regions, and will warn about regions that become too full." | `ld-memory.txt`, MEMORY Command |
| `noShuffle` | docs | "The linker will not shuffle sections around to fit into the available regions." | `ld-memory.txt`, MEMORY Command |
| `attrUnmapped` | docs | "The attr string is an optional list of attributes that specify whether to use a particular memory region for an input section which is not explicitly mapped in the linker script." | `ld-memory.txt`, MEMORY Command |
| `lengthBytes` | `region-over-budget` | "The len is an expression for the size in bytes of the memory region." | `ld-memory.txt`, MEMORY Command |
| `directRegion` | `orphan-section` | "Once you define a memory region, you can direct the linker to place specific output sections into that memory region by using the '>region' output section attribute." | `ld-memory.txt`, MEMORY Command |
| `tooLargeError` | `region-over-budget`, `no-stack-reserve`, `no-heap-reserve` | "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message." | `ld-memory.txt`, MEMORY Command |
| `mapFile` | `unknown-format` | "Print a link map to the file mapfile." | `ld-map-option.txt`, -Map=mapfile |
| `linkMapInfo` | `unknown-format`, `unparsed-lines` | "A link map provides information about the link, including the following:" | `ld-map-option.txt`, -M, --print-map |
| `objectsMapped` | `region-growth`, `large-input-section`, `object-growth`, `top-objects` | "Where object files are mapped into memory." | `ld-map-option.txt`, -M, --print-map |
| `archiveMembers` | `large-input-section` | "All archive members included in the link, with a mention of the symbol which caused the archive member to be brought in." | `ld-map-option.txt`, -M, --print-map |
| `memoryUsagePrint` | docs | "Print used size, total size and used size of memory regions created with the MEMORY Command command." | `ld-map-option.txt`, --print-memory-usage |
| `memoryUsageUseful` | `region-growth`, `region-near-full` | "This is useful on embedded targets to have a quick view of amount of free memory." | `ld-map-option.txt`, --print-memory-usage |
| `loadAddressAt` | docs | "The load address is specified by the AT or AT> keywords." | `ld-output-section-lma.txt`, Output Section LMA |
| `romImage` | docs | "This feature is designed to make it easy to build a ROM image." | `ld-output-section-lma.txt`, Output Section LMA |
| `outputDescription` | docs | "The full description of an output section looks like this:" | `ld-output-section-description.txt`, Output Section Description |
| `mostOutputSections` | docs | "Most output sections do not use most of the optional section attributes." | `ld-output-section-description.txt`, Output Section Description |
| `orphanDefinition` | `orphan-section` | "Orphan sections are sections present in the input files which are not explicitly placed into the output file by the linker script." | `ld-orphan-sections.txt`, Orphan Sections |
| `orphanPlacement` | docs | "If new output sections are created to hold orphaned input sections, then the linker must decide where to place these new output sections in relation to existing output sections." | `ld-orphan-sections.txt`, Orphan Sections |
| `inputOutputSection` | docs | "We sometimes refer to a section in an input file as an input section; similarly, a section in the output file is an output section." | `ld-basic-concepts.txt`, Basic Linker Script Concepts |
| `allocatable` | `no-stack-reserve`, `no-heap-reserve` | "A section with no contents may be allocatable, which means that an area in memory should be set aside, but nothing in particular should be loaded there (in some cases this memory must be zeroed out)." | `ld-basic-concepts.txt`, Basic Linker Script Concepts |
| `debugging` | docs | "A section which is neither loadable nor allocatable typically contains some sort of debugging information." | `ld-basic-concepts.txt`, Basic Linker Script Concepts |
| `loadedIntoRom` | `data-counted-twice` | "An example of when they might be different is when a data section is loaded into ROM, and then copied into RAM when the program starts up (this technique is often used to initialize global variables in a ROM based system)." | `ld-basic-concepts.txt`, Basic Linker Script Concepts |
| `romLmaRamVma` | `data-counted-twice` | "In this case the ROM address would be the LMA, and the RAM address would be the VMA." | `ld-basic-concepts.txt`, Basic Linker Script Concepts |
| `moveDot` | docs | "Assigning a value to . will cause the location counter to be moved." | `ld-location-counter.txt`, The Location Counter |
| `holes` | docs | "This may be used to create holes in the output section." | `ld-location-counter.txt`, The Location Counter |

## The findings

| Id | Severity | Area | Sentences | Where the rule is written |
| --- | --- | --- | --- | --- |
| `unknown-format` | error | Map file | `mapFile`, `linkMapInfo` | [method.md](method.md#unknown-format-error) |
| `region-over-budget` | error | Budget | `tooLargeError`, `lengthBytes` | [method.md](method.md#region-over-budget-error) |
| `region-growth` | error | Growth | `objectsMapped`, `memoryUsageUseful` | [method.md](method.md#region-growth-error) |
| `region-near-full` | warning | Budget | `warnTooFull`, `memoryUsageUseful` | [method.md](method.md#region-near-full-warning) |
| `no-stack-reserve` | warning | Stack and heap | `allocatable`, `tooLargeError` | [method.md](method.md#no-stack-reserve-warning) |
| `no-heap-reserve` | warning | Stack and heap | `allocatable`, `tooLargeError` | [method.md](method.md#no-heap-reserve-warning) |
| `orphan-section` | warning | Placement | `directRegion`, `orphanDefinition` | [method.md](method.md#orphan-section-warning) |
| `large-input-section` | warning | Largest objects | `objectsMapped`, `archiveMembers` | [method.md](method.md#large-input-section-warning) |
| `object-growth` | warning | Growth | `objectsMapped` | [method.md](method.md#object-growth-warning) |
| `data-counted-twice` | info | Placement | `loadedIntoRom`, `romLmaRamVma` | [method.md](method.md#data-counted-twice-info) |
| `top-objects` | info | Largest objects | `objectsMapped` | [method.md](method.md#top-objects-info) |
| `unparsed-lines` | info | Map file | `linkMapInfo` | [method.md](method.md#unparsed-lines-info) |

## What the tool decided itself

These are not stated by the manual, and the documents say so where they apply:

- the severity of every finding
- the default limits: near full above 90 percent, an object above 25 percent of a region, growth above 1 percent of a region, the five largest objects
- that a region's use is the sum of the sizes of its sections, not the distance to the highest address used
- that a section placed within 4,096 bytes after the end of a full region counts in that region
- the list of sections that hold no code or data for the target, and the words that mark a section with no initial data
- the names of the stack and heap symbols, and the functions that show a heap is used
- that the heap is looked for only when such a function is linked
- the line forms of the map, which the manual does not describe
- the limit of 200 listed findings per check, and the size and count limits

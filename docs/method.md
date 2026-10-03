# Method

The tool reads one map file as text, works out how many bytes each memory region holds, and runs the checks below. Every check says what it reports, why it has the severity it has, what it can see and what it cannot, and the sentence of the GNU ld manual that it rests on. The pages are saved in [research/sources](../research/sources), and a test compares every quoted sentence with the saved text. Where the tool makes a choice that the manual does not state (a severity, a default limit, a list of symbol names), the text says so.

Nothing is fetched at run time, and the linker is not run. A finding names regions, sections, objects and symbols by their names and gives addresses and sizes from the map.

## What is counted

[inputs.md](inputs.md) lists the line forms. From them the tool builds, for every region of the Memory Configuration table:

- **run bytes**: the sizes of the output sections whose address (VMA) is in the region
- **load bytes**: the sizes of the output sections whose load address (LMA) is in the region and differs from the address, unless the section holds no initial data (bss, noinit, heap, stack, COMMON)
- **used** = run + load, and **free** = budget - used
- **objects**: for each object file or archive member, the sizes of its input sections in the region, the same way (an object with initialised data counts in both regions)

The budget of a region is its length, or the lower value given with `--budget`. The manual describes the length: "The len is an expression for the size in bytes of the memory region."

The tool sums the sizes of the sections. `--print-memory-usage` of ld measures from the start of the region to the highest address used, so a gap made by alignment or by a fixed address between two sections counts there and not here. Padding inside an output section (`*fill*`) is part of the section and counts here too.

When a region is too small, ld still places the sections that follow it, past the end of the region, and writes the map. The manual: "The linker will not shuffle sections around to fit into the available regions." Such a section has an address in no region. The tool counts it in the region whose end it follows, when that region is already full and the section starts within 4,096 bytes of the last byte placed in it; a note names it. Any other section at an address in no region is reported by `orphan-section`. The distance of 4,096 bytes is the tool's own: it covers the alignment of a section.

## Map file

### `unknown-format` (error)

The file is not a map that GNU ld writes: it lacks the `Memory Configuration` line or the `Linker script and memory map` line. The message says what the file looks like: a map of LLVM lld, IAR ILINK, Arm Compiler armlink (Keil MDK) or Microsoft LINK, an ELF file, a binary file, an empty file, or a text file. The manual describes the file the tool reads: "Print a link map to the file mapfile." and "A link map provides information about the link, including the following:" It is an error, because nothing was checked: a file the tool cannot read must not pass quietly. Every other area of the report is shown as `off`.

### `unparsed-lines` (info)

Lines of a GNU ld map that are in no form the tool reads. One finding gives the count, the first line with its text, and up to ten line numbers. It is info, because most such lines hold nothing that changes the totals; but a line that held an input section would be missing from them, so the report says it was not read instead of passing over it. A line longer than 4,096 characters is counted here without being read.

## Budget

### `region-over-budget` (error)

A region holds more bytes than its budget: its length, or the budget given with `--budget`. The manual: "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message." and "The len is an expression for the size in bytes of the memory region." The finding gives the bytes used and the budget, how many bytes are too many, the output sections and load images that the region holds, and, when sections lie past the end of the region, where the last one ends. The fix names the three largest objects of the region.

With the length as the budget, ld itself has failed the link with an overflow message; the finding says the same thing with the sections and objects behind it. With a lower `--budget` (room kept for a bootloader, a second image for updates, or growth), the link succeeds and only this check stops it.

### `region-near-full` (warning)

A region holds more than `--warn-percent` (90 by default) of its budget, and not more than the budget. The manual: "The linker will set section addresses based on the memory regions, and will warn about regions that become too full." and, of `--print-memory-usage`: "This is useful on embedded targets to have a quick view of amount of free memory." It is a warning, because the firmware still links; the next feature may not. The level of 90 is the tool's own.

## Stack and heap

The linker counts only what is placed in a region. The manual: "A section with no contents may be allocatable, which means that an area in memory should be set aside, but nothing in particular should be loaded there (in some cases this memory must be zeroed out)." A stack or a heap is counted only when the linker script sets space aside for it in such a section, usually by moving the location counter. The manual: "Assigning a value to . will cause the location counter to be moved." and "This may be used to create holes in the output section."

### `no-stack-reserve` (warning)

The map shows no space set aside for the stack. A reserve is an output section with `stack` in its name and a size above zero (`._user_heap_stack`, `.stack`, `.stack_dummy`), or an assignment to `.` inside a section whose expression names a stack size symbol (`_Min_Stack_Size`, `__stack_size__`, `__STACK_SIZE` and the others of the list in `src/data.js`). The finding says what was looked for, and names what was found instead:

- a top or limit symbol such as `_estack`, `__StackTop` or `__StackLimit`, which says where the stack is, not how much room it gets
- a size symbol that no section uses
- a stack section of size 0

Without a reserve, the totals do not hold the stack, the RAM can look half empty while the stack grows into `.bss`, and the link never fails for it. It is a warning, because some firmware sets the stack in a region of its own, or measures it at run time; the names that the tool looks for are its own list.

### `no-heap-reserve` (warning)

The map holds a function that takes memory from a heap (`malloc`, `_malloc_r`, `calloc`, `realloc`, `_sbrk`, `sbrk`, `pvPortMalloc` and the others of the list), as a symbol or as an input section such as `.text._sbrk`, and shows no space set aside for the heap: no output section with `heap` in its name and a size above zero, and no assignment to `.` inside a section that names a heap size symbol (`_Min_Heap_Size`, `__heap_size__`, `__HEAP_SIZE` and others). The finding names the functions it found and the symbols it found instead of a reserve. Without a reserve, `_sbrk` hands out memory up to the stack, and nothing at link time says whether there is any.

When the map holds none of these functions, the firmware does not seem to use a heap, and no heap reserve is looked for; a note says so. This check runs only when a heap is used, which is the tool's own choice: a heap reserve that nothing uses is wasted RAM.

## Placement

### `orphan-section` (warning)

An output section with a size above zero, that is not a debugging or attribute section, at an address in no region of the Memory Configuration table (and not right after the end of a full region, see above). The manual: "Once you define a memory region, you can direct the linker to place specific output sections into that memory region by using the '>region' output section attribute." and, of sections the script does not place: "Orphan sections are sections present in the input files which are not explicitly placed into the output file by the linker script." Such a section is not counted against any budget, by the linker or by this report. Common causes: a section with a fixed address and no `>region` (a buffer in CCM RAM or a backup SRAM that the MEMORY command does not declare), or an input section that the script does not name. It is a warning, because the memory may exist and work; the map alone cannot show its size.

### `data-counted-twice` (info)

An output section with its address in one region and its load address in another, such as `.data`: its initial values are stored in flash and copied to RAM by the startup code, so its bytes count in both regions. The manual: "An example of when they might be different is when a data section is loaded into ROM, and then copied into RAM when the program starts up (this technique is often used to initialize global variables in a ROM based system)." and "In this case the ROM address would be the LMA, and the RAM address would be the VMA." It is info: this is how initialised data works, and the finding explains why the same bytes appear in both totals. The fix says how to make it smaller: `const` for data that never changes, and no initial value for data that starts at zero.

## Largest objects

### `large-input-section` (warning)

One object file or archive member takes more of a region than `--max-object`: 25 percent of the region's budget by default, or a size in bytes. The manual lists what a map shows: "Where object files are mapped into memory." and "All archive members included in the link, with a mention of the symbol which caused the archive member to be brought in." The finding gives the bytes, the share, the largest input section of the object with its address, and for an archive member, the archive. It is a warning, because one large object can be right (a font, a radio stack); the default of 25 percent is the tool's own.

### `top-objects` (info)

For every region that holds objects, the largest objects and the largest archives (the members of one archive added together), with their bytes and their share of the budget, and the padding between input sections. `--top` sets how many are listed (5 by default). The manual: "Where object files are mapped into memory." The same lists are printed as tables in the text and Markdown reports. It never fails a run.

## Growth

With `--baseline`, the older map is read the same way, with the same budgets, and each region and each object of this map is compared with it. The limit is `--max-growth`: 1 percent of the region's budget by default, or a size in bytes. The manual: "Where object files are mapped into memory." and "This is useful on embedded targets to have a quick view of amount of free memory."

### `region-growth` (error)

A region grew by more than the limit since the baseline. The finding gives the bytes before and after, and the three objects that grew most, marking the new ones. It is an error, because a pipeline that gives a baseline asks for a gate on growth; raise the limit with `--max-growth`, or make the new map the baseline, when the growth is meant. A region that is in only one of the two maps is a note.

### `object-growth` (warning)

One object grew in a region by more than the limit since the baseline, or is new and takes more than the limit. It is a warning: it says where the growth of a region comes from. An object that shrank or was removed is never reported.

## Severities and the gate

An error is something the map shows to be wrong (a region over its budget, growth over the limit), or a file the tool cannot read. A warning is a use of memory that most reviewers would ask about. Info explains the totals. With the default `--fail-on error`, only errors fail the run; `--fail-on warning` fails on warnings too; info never fails. The severities are the tool's own, and the manual does not state them.

When one check finds more than 200 things, the first 200 are listed, in a fixed order, and the rest is counted (the gate uses the full count) and named in a note.

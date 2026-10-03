## linker-map-budget-check: 1 error, 6 warning, 3 info

File: `examples/thermostat.map`. Map: GNU ld, 2 regions, 329 lines (278 read, 31 skipped, 20 blank, 0 not parsed), 8 output sections in a region, 1 outside every region, 4 not allocated, 81 input sections from 29 objects. Limits: near full above 90%, an object above 25% of a region, top 5.

| Area | Result | Detail |
| --- | --- | --- |
| Map file | pass | no finding |
| Budget | **fail** | region-over-budget x1, region-near-full x1 |
| Stack and heap | warn | no-stack-reserve x1, no-heap-reserve x1 |
| Placement | warn | orphan-section x1, data-counted-twice x1 |
| Largest objects | warn | large-input-section x2, top-objects x2 |
| Growth | off | no --baseline given |

| Region | Origin | Length | Budget | Used | Free | Use | Attributes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| FLASH | 0x08000000 | 65,536 | 65,536 | 66,124 | -588 | 100.9% | xr |
| RAM | 0x20000000 | 20,480 | 20,480 | 19,136 | 1,344 | 93.4% | xrw |

Largest in FLASH:

| Object or archive | Bytes | Share |
| --- | ---: | ---: |
| build/font\_8x16.o | 22,528 | 34.4% |
| build/ble.o | 16,284 | 24.8% |
| build/ui.o | 5,328 | 8.1% |
| build/display.o | 2,924 | 4.5% |
| libc\_nano.a(libc\_a-dtoa.o) | 2,828 | 4.3% |
| libc\_nano.a (archive, 9 members) | 8,432 | 12.9% |
| libgcc.a (archive, 3 members) | 2,976 | 4.5% |

Largest in RAM:

| Object or archive | Bytes | Share |
| --- | ---: | ---: |
| build/ble.o | 10,528 | 51.4% |
| build/sensor.o | 3,072 | 15.0% |
| build/uart.o | 2,304 | 11.3% |
| build/ui.o | 1,792 | 8.8% |
| build/display.o | 1,024 | 5.0% |
| libc\_nano.a (archive, 2 members) | 108 | 0.5% |

### Budget

| Severity | Check | Where | Message | Basis | Fix |
| --- | --- | --- | --- | --- | --- |
| error | region-over-budget | region FLASH (line 41) | The region "FLASH" holds 66,124 bytes, more than its length of 65,536 bytes: 588 bytes too many (100.9%). It holds the output sections .isr\_vector, .text, .rodata, .ARM.exidx, .init\_array and .fini\_array (65,720 bytes) and the load image of .data (404 bytes). The last byte placed in it ends at 0x0801024c, 588 bytes past the end of the region at 0x08010000. | "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html) "The len is an expression for the size in bytes of the memory region." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html) | Make the code or data in "FLASH" smaller, starting with the largest objects (build/font\_8x16.o (22,528 bytes), build/ble.o (16,284 bytes) and build/ui.o (5,328 bytes)), or move a section to another region. Raise the budget only if the part really has more room. |
| warning | region-near-full | region RAM (line 42) | The region "RAM" holds 19,136 bytes of its length of 20,480 bytes (93.4%), above the warning level of 90%. 1,344 bytes are free. It holds the output sections .data and .bss (19,136 bytes). | "The linker will set section addresses based on the memory regions, and will warn about regions that become too full." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html) "This is useful on embedded targets to have a quick view of amount of free memory." (--print-memory-usage, https://sourceware.org/binutils/docs/ld/Options.html) | Plan for the next features now: find what can shrink in "RAM" (the largest objects are build/ble.o (10,528 bytes), build/sensor.o (3,072 bytes) and build/uart.o (2,304 bytes)), or set a budget with --budget that keeps room for them. |

### Stack and heap

| Severity | Check | Where | Message | Basis | Fix |
| --- | --- | --- | --- | --- | --- |
| warning | no-stack-reserve | stack (line 70) | The map shows no space set aside for the stack. The tool looked for an output section with "stack" in its name and a size above zero, or a step of the location counter by \_Min\_Stack\_Size, \_\_stack\_size\_\_, \_\_STACK\_SIZE, \_\_stack\_size and 5 more inside a section, and found none. It found \_estack = 0x20005000 (line 70), which says where the stack is, not how much room it gets. The linker checks only what is placed in a region, so the stack is not in the totals above and can grow into the data below it with no error at link time. | "A section with no contents may be allocatable, which means that an area in memory should be set aside, but nothing in particular should be loaded there (in some cases this memory must be zeroed out)." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html) "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html) | Reserve the stack in the linker script: a section in RAM that steps the location counter by the stack size (for example ". = . + \_Min\_Stack\_Size;"), so the linker counts it and stops the link when RAM is too small. |
| warning | no-heap-reserve | heap (line 160) | The firmware takes memory at run time: the map holds \_sbrk (line 160) and \_malloc\_r (line 171). It shows no space set aside for the heap: the tool looked for an output section with "heap" in its name and a size above zero, or a step of the location counter by \_Min\_Heap\_Size, \_\_heap\_size\_\_, \_\_HEAP\_SIZE, \_\_heap\_size and 5 more inside a section, and found none. The heap is then not in the totals above, and malloc can run into the stack with no error at link time. | "A section with no contents may be allocatable, which means that an area in memory should be set aside, but nothing in particular should be loaded there (in some cases this memory must be zeroed out)." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html) "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html) | Reserve the heap in the linker script, as for the stack (for example ". = . + \_Min\_Heap\_Size;" in a section in RAM), and let \_sbrk stop at the end of that space. If the firmware should not allocate at run time, remove the calls to malloc. |

### Placement

| Severity | Check | Where | Message | Basis | Fix |
| --- | --- | --- | --- | --- | --- |
| warning | orphan-section | section .ccmram (line 300) | The output section ".ccmram" (2,560 bytes at 0x10000000) lies outside every region of the Memory Configuration table (FLASH and RAM), so the linker did not count it against a region, and this report cannot either. | "Once you define a memory region, you can direct the linker to place specific output sections into that memory region by using the '&gt;region' output section attribute." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html) "Orphan sections are sections present in the input files which are not explicitly placed into the output file by the linker script." (Orphan Sections, https://sourceware.org/binutils/docs/ld/Orphan-Sections.html) | Declare the memory it is meant for with the MEMORY command and place the section there with "&gt;REGION", or move its input sections into a section that is placed in a region. |
| info | data-counted-twice | section .data (line 244) | The output section ".data" (404 bytes) runs in "RAM" at 0x20000000 and is loaded from "FLASH" at 0x080100b8. Its initial values are stored in "FLASH" and copied to "RAM" by the startup code, so the same 404 bytes count in both regions. | "An example of when they might be different is when a data section is loaded into ROM, and then copied into RAM when the program starts up (this technique is often used to initialize global variables in a ROM based system)." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html) "In this case the ROM address would be the LMA, and the RAM address would be the VMA." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html) | Nothing to fix; this is how initialised data works. To save space in both regions, make data that never changes const (it then stays in "FLASH" only) and leave data that starts at zero uninitialised (it then goes to .bss, which takes no space in "FLASH"). |

### Largest objects

| Severity | Check | Where | Message | Basis | Fix |
| --- | --- | --- | --- | --- | --- |
| warning | large-input-section | object build/font\_8x16.o in FLASH (line 207) | build/font\_8x16.o takes 22,528 bytes of "FLASH" (34.4% of 65,536 bytes), more than the limit of 16,384 bytes (25% of 65,536 bytes, --max-object). Its largest input section is .rodata.font\_8x16 (22,528 bytes at 0x080096dc). | "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html) "All archive members included in the link, with a mention of the symbol which caused the archive member to be brought in." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html) | Check whether all of it is needed: a buffer or a table that could be smaller, a library function that pulls in more than it is worth (printf with floating point is a common one), or code and data that -ffunction-sections, -fdata-sections and --gc-sections would drop. |
| warning | large-input-section | object build/ble.o in RAM (line 251) | build/ble.o takes 10,528 bytes of "RAM" (51.4% of 20,480 bytes), more than the limit of 5,120 bytes (25% of 20,480 bytes, --max-object). Its largest input section is .bss.ble\_rx\_pool (8,192 bytes at 0x200019b4). | "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html) "All archive members included in the link, with a mention of the symbol which caused the archive member to be brought in." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html) | Check whether all of it is needed: a buffer or a table that could be smaller, a library function that pulls in more than it is worth (printf with floating point is a common one), or code and data that -ffunction-sections, -fdata-sections and --gc-sections would drop. |
| info | top-objects | region FLASH (line 41) | The largest objects in "FLASH": build/font\_8x16.o 22,528 bytes (34.4%), build/ble.o 16,284 bytes (24.8%), build/ui.o 5,328 bytes (8.1%), build/display.o 2,924 bytes (4.5%) and libc\_nano.a(libc\_a-dtoa.o) 2,828 bytes (4.3%). The largest archives: libc\_nano.a 8,432 bytes in 9 members (12.9%) and libgcc.a 2,976 bytes in 3 members (4.5%). Padding between input sections takes 2 bytes. | "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html) | Nothing to fix; the list shows where the bytes go. Change the length of the list with --top. |
| info | top-objects | region RAM (line 42) | The largest objects in "RAM": build/ble.o 10,528 bytes (51.4%), build/sensor.o 3,072 bytes (15.0%), build/uart.o 2,304 bytes (11.3%), build/ui.o 1,792 bytes (8.8%) and build/display.o 1,024 bytes (5.0%). The largest archives: libc\_nano.a 108 bytes in 2 members (0.5%). | "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html) | Nothing to fix; the list shows where the bytes go. Change the length of the list with --top. |

- 4 output sections hold no code or data for the target and were not counted: .ARM.attributes, .comment, .debug\_info and .debug\_line
- .ARM.exidx (FLASH), .init\_array (FLASH), .fini\_array (FLASH) and .data (FLASH) start past the end of a full region and were counted in it (docs/method.md)

**Gate failed:** 1 error, 6 warnings.

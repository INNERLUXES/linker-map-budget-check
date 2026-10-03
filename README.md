# linker-map-budget-check

Reads the map file that GNU ld writes for firmware and reports how flash and RAM are used. You give it the map that `-Wl,-Map=firmware.map` makes with arm-none-eabi-gcc, riscv64-unknown-elf-gcc, avr-gcc or another GNU toolchain. It reads the memory regions, every output section with its address, size and load address, and every input section with its object file. It reports a region over its budget or nearly full, initialised data that takes space in flash and in RAM, a stack or heap that the linker does not count, an output section outside every region, the largest objects and archives, and growth against an older map. Every finding names the line in the map, the severity, a sentence on how to fix it, and the sentence of the GNU ld manual that it rests on, with its address.

A firmware build fails when a region overflows, but it says nothing on the build before that one, when flash was at 97 percent and the stack was never counted. The map file holds the answer for every build: which region each section went to, how big it is, and which object brought it in. This tool reads it in a second, so the check can run on every pull request and stop the one that takes the last free kilobytes.

- Every finding has an id, a severity (error, warning or info), the line in the map, a plain message with addresses and sizes, a fix, and the quoted sentence of the manual it rests on, with the address of the saved page.
- Nothing is passed without being read. Every line of the map is counted as read, skipped, blank or not parsed, and a line the tool does not know is reported. A file that is not a GNU ld map is an error; [docs/limits.md](docs/limits.md) lists what is out of reach.
- Every quoted sentence comes from the GNU ld manual, saved in [research/sources](research/sources); a test compares [src/data.js](src/data.js) and the documents with the saved text.
- Reports as text, Markdown, JSON and CSV, with an exit code for a pipeline gate. Info findings never fail the run.
- Plain JavaScript, no dependencies; the same map always gives the same report, with LF or CRLF line ends.

```
npm test
```

```
tests 97
pass 93
fail 0
skipped 4
```

These are the summary lines that `npm test` prints at the end. The skipped tests are the ones that need a system other than Windows: a symbolic link test, a device file, a file name with a control character, and a file name with a backslash. They are guarded with `process.platform`. On Linux and macOS only the test for Windows paths is skipped.

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/linker-map-budget-check.git
cd linker-map-budget-check
node bin/linker-map-budget-check.js examples/thermostat.map
```

Or without a clone, in the build folder of your firmware:

```
npx --yes github:INNERLUXES/linker-map-budget-check build/firmware.map
```

`examples/` holds the maps of a made-up thermostat on a Cortex-M4 with 64 KB of flash and 20 KB of RAM. `examples/thermostat.map` is wrong on purpose: a font and printf with floating point push flash over its length, RAM is nearly full, the stack and the heap are not reserved although malloc is linked, a DMA buffer sits in CCM RAM that the MEMORY command does not declare, and one font table takes a third of the flash. `examples/thermostat-fixed.map` is the same firmware repaired; it passes at the strictest level. `examples/thermostat-next.map` is the next build, which adds updates over the air, for the growth check. `examples/thermostat-lld.map` is a map of LLVM lld, which the tool names and does not read.

## Usage

```
node bin/linker-map-budget-check.js examples/thermostat.map --fail-on warning
```

```
linker-map-budget-check: examples/thermostat.map
map: GNU ld, 2 regions, 329 lines (278 read, 31 skipped, 20 blank, 0 not parsed), 8 output sections in a region, 1 outside every region, 4 not allocated, 81 input sections from 29 objects
limits: near full above 90%, an object above 25% of a region, top 5
areas:
  Map file         pass  no finding
  Budget           fail  region-over-budget x1, region-near-full x1
  Stack and heap   warn  no-stack-reserve x1, no-heap-reserve x1
  Placement        warn  orphan-section x1, data-counted-twice x1
  Largest objects  warn  large-input-section x2, top-objects x2
  Growth           off   no --baseline given
regions:
  region  origin      length  budget    used   free     use  attributes
  FLASH   0x08000000  65,536  65,536  66,124   -588  100.9%  xr
  RAM     0x20000000  20,480  20,480  19,136  1,344   93.4%  xrw
largest in FLASH:
   bytes  share  object
  22,528  34.4%  build/font_8x16.o
  16,284  24.8%  build/ble.o
   5,328   8.1%  build/ui.o
   2,924   4.5%  build/display.o
   2,828   4.3%  libc_nano.a(libc_a-dtoa.o)
  bytes  share  archive
  8,432  12.9%  libc_nano.a (9 members)
  2,976   4.5%  libgcc.a (3 members)
largest in RAM:
   bytes  share  object
  10,528  51.4%  build/ble.o
   3,072  15.0%  build/sensor.o
   2,304  11.3%  build/uart.o
   1,792   8.8%  build/ui.o
   1,024   5.0%  build/display.o
  bytes  share  archive
    108   0.5%  libc_nano.a (2 members)
findings: 1 error, 6 warning, 3 info

Budget (2 findings)

  ERROR    region-over-budget  examples/thermostat.map region FLASH  line 41
           The region "FLASH" holds 66,124 bytes, more than its length of 65,536 bytes: 588 bytes too many (100.9%). It holds the output sections .isr_vector, .text, .rodata, .ARM.exidx, .init_array and .fini_array (65,720 bytes) and the load image of .data (404 bytes). The last byte placed in it ends at 0x0801024c, 588 bytes past the end of the region at 0x08010000.
           basis: "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html)
           basis: "The len is an expression for the size in bytes of the memory region." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html)
           fix: Make the code or data in "FLASH" smaller, starting with the largest objects (build/font_8x16.o (22,528 bytes), build/ble.o (16,284 bytes) and build/ui.o (5,328 bytes)), or move a section to another region. Raise the budget only if the part really has more room.

  WARNING  region-near-full  examples/thermostat.map region RAM  line 42
           The region "RAM" holds 19,136 bytes of its length of 20,480 bytes (93.4%), above the warning level of 90%. 1,344 bytes are free. It holds the output sections .data and .bss (19,136 bytes).
           basis: "The linker will set section addresses based on the memory regions, and will warn about regions that become too full." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html)
           basis: "This is useful on embedded targets to have a quick view of amount of free memory." (--print-memory-usage, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Plan for the next features now: find what can shrink in "RAM" (the largest objects are build/ble.o (10,528 bytes), build/sensor.o (3,072 bytes) and build/uart.o (2,304 bytes)), or set a budget with --budget that keeps room for them.

Stack and heap (2 findings)

  WARNING  no-stack-reserve  examples/thermostat.map stack  line 70
           The map shows no space set aside for the stack. The tool looked for an output section with "stack" in its name and a size above zero, or a step of the location counter by _Min_Stack_Size, __stack_size__, __STACK_SIZE, __stack_size and 5 more inside a section, and found none. It found _estack = 0x20005000 (line 70), which says where the stack is, not how much room it gets. The linker checks only what is placed in a region, so the stack is not in the totals above and can grow into the data below it with no error at link time.
           basis: "A section with no contents may be allocatable, which means that an area in memory should be set aside, but nothing in particular should be loaded there (in some cases this memory must be zeroed out)." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html)
           basis: "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html)
           fix: Reserve the stack in the linker script: a section in RAM that steps the location counter by the stack size (for example ". = . + _Min_Stack_Size;"), so the linker counts it and stops the link when RAM is too small.

  WARNING  no-heap-reserve  examples/thermostat.map heap  line 160
           The firmware takes memory at run time: the map holds _sbrk (line 160) and _malloc_r (line 171). It shows no space set aside for the heap: the tool looked for an output section with "heap" in its name and a size above zero, or a step of the location counter by _Min_Heap_Size, __heap_size__, __HEAP_SIZE, __heap_size and 5 more inside a section, and found none. The heap is then not in the totals above, and malloc can run into the stack with no error at link time.
           basis: "A section with no contents may be allocatable, which means that an area in memory should be set aside, but nothing in particular should be loaded there (in some cases this memory must be zeroed out)." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html)
           basis: "If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html)
           fix: Reserve the heap in the linker script, as for the stack (for example ". = . + _Min_Heap_Size;" in a section in RAM), and let _sbrk stop at the end of that space. If the firmware should not allocate at run time, remove the calls to malloc.

Placement (2 findings)

  WARNING  orphan-section  examples/thermostat.map section .ccmram  line 300
           The output section ".ccmram" (2,560 bytes at 0x10000000) lies outside every region of the Memory Configuration table (FLASH and RAM), so the linker did not count it against a region, and this report cannot either.
           basis: "Once you define a memory region, you can direct the linker to place specific output sections into that memory region by using the '>region' output section attribute." (MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html)
           basis: "Orphan sections are sections present in the input files which are not explicitly placed into the output file by the linker script." (Orphan Sections, https://sourceware.org/binutils/docs/ld/Orphan-Sections.html)
           fix: Declare the memory it is meant for with the MEMORY command and place the section there with ">REGION", or move its input sections into a section that is placed in a region.

  INFO     data-counted-twice  examples/thermostat.map section .data  line 244
           The output section ".data" (404 bytes) runs in "RAM" at 0x20000000 and is loaded from "FLASH" at 0x080100b8. Its initial values are stored in "FLASH" and copied to "RAM" by the startup code, so the same 404 bytes count in both regions.
           basis: "An example of when they might be different is when a data section is loaded into ROM, and then copied into RAM when the program starts up (this technique is often used to initialize global variables in a ROM based system)." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html)
           basis: "In this case the ROM address would be the LMA, and the RAM address would be the VMA." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html)
           fix: Nothing to fix; this is how initialised data works. To save space in both regions, make data that never changes const (it then stays in "FLASH" only) and leave data that starts at zero uninitialised (it then goes to .bss, which takes no space in "FLASH").

Largest objects (4 findings)

  WARNING  large-input-section  examples/thermostat.map object build/font_8x16.o in FLASH  line 207
           build/font_8x16.o takes 22,528 bytes of "FLASH" (34.4% of 65,536 bytes), more than the limit of 16,384 bytes (25% of 65,536 bytes, --max-object). Its largest input section is .rodata.font_8x16 (22,528 bytes at 0x080096dc).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           basis: "All archive members included in the link, with a mention of the symbol which caused the archive member to be brought in." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Check whether all of it is needed: a buffer or a table that could be smaller, a library function that pulls in more than it is worth (printf with floating point is a common one), or code and data that -ffunction-sections, -fdata-sections and --gc-sections would drop.

  WARNING  large-input-section  examples/thermostat.map object build/ble.o in RAM  line 251
           build/ble.o takes 10,528 bytes of "RAM" (51.4% of 20,480 bytes), more than the limit of 5,120 bytes (25% of 20,480 bytes, --max-object). Its largest input section is .bss.ble_rx_pool (8,192 bytes at 0x200019b4).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           basis: "All archive members included in the link, with a mention of the symbol which caused the archive member to be brought in." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Check whether all of it is needed: a buffer or a table that could be smaller, a library function that pulls in more than it is worth (printf with floating point is a common one), or code and data that -ffunction-sections, -fdata-sections and --gc-sections would drop.

  INFO     top-objects  examples/thermostat.map region FLASH  line 41
           The largest objects in "FLASH": build/font_8x16.o 22,528 bytes (34.4%), build/ble.o 16,284 bytes (24.8%), build/ui.o 5,328 bytes (8.1%), build/display.o 2,924 bytes (4.5%) and libc_nano.a(libc_a-dtoa.o) 2,828 bytes (4.3%). The largest archives: libc_nano.a 8,432 bytes in 9 members (12.9%) and libgcc.a 2,976 bytes in 3 members (4.5%). Padding between input sections takes 2 bytes.
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.

  INFO     top-objects  examples/thermostat.map region RAM  line 42
           The largest objects in "RAM": build/ble.o 10,528 bytes (51.4%), build/sensor.o 3,072 bytes (15.0%), build/uart.o 2,304 bytes (11.3%), build/ui.o 1,792 bytes (8.8%) and build/display.o 1,024 bytes (5.0%). The largest archives: libc_nano.a 108 bytes in 2 members (0.5%).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.

note: 4 output sections hold no code or data for the target and were not counted: .ARM.attributes, .comment, .debug_info and .debug_line
note: .ARM.exidx (FLASH), .init_array (FLASH), .fini_array (FLASH) and .data (FLASH) start past the end of a full region and were counted in it (docs/method.md)

GATE: FAIL - 1 error, 6 warnings
```

The exit code is `1`: errors fail the run by default. The six warnings do not, unless you run with `--fail-on warning`, as here. The `info` findings never fail a run. The regions table shows each region's length, its budget (the length, or a lower value from `--budget`), the bytes used, the bytes free and the share used. FLASH holds 404 bytes of `.data` as well as the code: the initial values that the startup code copies to RAM.

The repaired firmware passes, also with `--fail-on warning`:

```
node bin/linker-map-budget-check.js examples/thermostat-fixed.map --fail-on warning
```

```
linker-map-budget-check: examples/thermostat-fixed.map
map: GNU ld, 3 regions, 311 lines (269 read, 21 skipped, 21 blank, 0 not parsed), 10 output sections in a region, 0 outside every region, 4 not allocated, 75 input sections from 24 objects
limits: near full above 90%, an object above 25% of a region, top 5
areas:
  Map file         pass  no finding
  Budget           pass  no finding
  Stack and heap   pass  no finding
  Placement        info  data-counted-twice x1
  Largest objects  info  top-objects x3
  Growth           off   no --baseline given
regions:
  region  origin      length  budget    used    free    use  attributes
  FLASH   0x08000000  65,536  65,536  44,628  20,908  68.1%  xr
  RAM     0x20000000  20,480  20,480  13,504   6,976  65.9%  xrw
  CCMRAM  0x10000000  65,536  65,536   2,560  62,976   3.9%  rw
largest in FLASH:
   bytes  share  object
  16,284  24.8%  build/ble.o
   9,728  14.8%  build/font_8x16.o
   5,328   8.1%  build/ui.o
   2,924   4.5%  build/display.o
   2,076   3.2%  build/sensor.o
  bytes  share  archive
  1,980   3.0%  libc_nano.a (6 members)
    732   1.1%  libgcc.a (1 member)
largest in RAM:
  bytes  share  object
  3,360  16.4%  build/ble.o
  3,072  15.0%  build/sensor.o
  2,304  11.3%  build/uart.o
  1,792   8.8%  build/ui.o
  1,024   5.0%  build/display.o
  bytes  share  archive
    108   0.5%  libc_nano.a (2 members)
largest in CCMRAM:
  bytes  share  object
  2,560   3.9%  build/sensor.o
findings: 0 error, 0 warning, 4 info

Placement (1 finding)

  INFO     data-counted-twice  examples/thermostat-fixed.map section .data  line 217
           The output section ".data" (404 bytes) runs in "RAM" at 0x20000000 and is loaded from "FLASH" at 0x0800acc0. Its initial values are stored in "FLASH" and copied to "RAM" by the startup code, so the same 404 bytes count in both regions.
           basis: "An example of when they might be different is when a data section is loaded into ROM, and then copied into RAM when the program starts up (this technique is often used to initialize global variables in a ROM based system)." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html)
           basis: "In this case the ROM address would be the LMA, and the RAM address would be the VMA." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html)
           fix: Nothing to fix; this is how initialised data works. To save space in both regions, make data that never changes const (it then stays in "FLASH" only) and leave data that starts at zero uninitialised (it then goes to .bss, which takes no space in "FLASH").

Largest objects (3 findings)

  INFO     top-objects  examples/thermostat-fixed.map region FLASH  line 31
           The largest objects in "FLASH": build/ble.o 16,284 bytes (24.8%), build/font_8x16.o 9,728 bytes (14.8%), build/ui.o 5,328 bytes (8.1%), build/display.o 2,924 bytes (4.5%) and build/sensor.o 2,076 bytes (3.2%). The largest archives: libc_nano.a 1,980 bytes in 6 members (3.0%) and libgcc.a 732 bytes in 1 member (1.1%). Padding between input sections takes 2 bytes.
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.

  INFO     top-objects  examples/thermostat-fixed.map region RAM  line 32
           The largest objects in "RAM": build/ble.o 3,360 bytes (16.4%), build/sensor.o 3,072 bytes (15.0%), build/uart.o 2,304 bytes (11.3%), build/ui.o 1,792 bytes (8.8%) and build/display.o 1,024 bytes (5.0%). The largest archives: libc_nano.a 108 bytes in 2 members (0.5%).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.

  INFO     top-objects  examples/thermostat-fixed.map region CCMRAM  line 33
           The largest objects in "CCMRAM": build/sensor.o 2,560 bytes (3.9%).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.

note: 4 output sections hold no code or data for the target and were not counted: .ARM.attributes, .comment, .debug_info and .debug_line

GATE: PASS (--fail-on warning)
```

The font is smaller, printf no longer pulls in floating point, the radio buffers are smaller, `._user_heap_stack` reserves 512 bytes of heap and 1 KB of stack, and CCM RAM is a region of its own. Passing means that none of the checks found anything in the map. It does not mean that the stack is deep enough at run time; [docs/limits.md](docs/limits.md) lists what a map cannot show.

The next build adds a feature. Compared with the repaired map as the baseline, it fails on growth:

```
node bin/linker-map-budget-check.js examples/thermostat-next.map --baseline examples/thermostat-fixed.map
```

```
linker-map-budget-check: examples/thermostat-next.map (baseline examples/thermostat-fixed.map)
map: GNU ld, 3 regions, 327 lines (285 read, 21 skipped, 21 blank, 0 not parsed), 10 output sections in a region, 0 outside every region, 4 not allocated, 80 input sections from 25 objects
limits: near full above 90%, an object above 25% of a region, top 5, growth above 1% of a region
areas:
  Map file         pass  no finding
  Budget           pass  no finding
  Stack and heap   pass  no finding
  Placement        info  data-counted-twice x1
  Largest objects  info  top-objects x3
  Growth           fail  region-growth x2, object-growth x3
regions:
  region  origin      length  budget    used    free    use  attributes
  FLASH   0x08000000  65,536  65,536  48,796  16,740  74.5%  xr
  RAM     0x20000000  20,480  20,480  14,528   5,952  70.9%  xrw
  CCMRAM  0x10000000  65,536  65,536   2,560  62,976   3.9%  rw
largest in FLASH:
   bytes  share  object
  16,284  24.8%  build/ble.o
   9,728  14.8%  build/font_8x16.o
   5,328   8.1%  build/ui.o
   3,400   5.2%  build/ota.o
   2,924   4.5%  build/display.o
  bytes  share  archive
  1,980   3.0%  libc_nano.a (6 members)
    732   1.1%  libgcc.a (1 member)
largest in RAM:
  bytes  share  object
  3,360  16.4%  build/ble.o
  3,072  15.0%  build/sensor.o
  2,304  11.3%  build/uart.o
  1,792   8.8%  build/ui.o
  1,024   5.0%  build/display.o
  bytes  share  archive
    108   0.5%  libc_nano.a (2 members)
largest in CCMRAM:
  bytes  share  object
  2,560   3.9%  build/sensor.o
growth since examples/thermostat-fixed.map:
  region  before   after  growth  limit
  FLASH   44,628  48,796  +4,168  655
  RAM     13,504  14,528  +1,024  204
  CCMRAM   2,560   2,560       0  655
findings: 2 error, 3 warning, 4 info

Placement (1 finding)

  INFO     data-counted-twice  examples/thermostat-next.map section .data  line 230
           The output section ".data" (404 bytes) runs in "RAM" at 0x20000000 and is loaded from "FLASH" at 0x0800bd08. Its initial values are stored in "FLASH" and copied to "RAM" by the startup code, so the same 404 bytes count in both regions.
           basis: "An example of when they might be different is when a data section is loaded into ROM, and then copied into RAM when the program starts up (this technique is often used to initialize global variables in a ROM based system)." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html)
           basis: "In this case the ROM address would be the LMA, and the RAM address would be the VMA." (Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html)
           fix: Nothing to fix; this is how initialised data works. To save space in both regions, make data that never changes const (it then stays in "FLASH" only) and leave data that starts at zero uninitialised (it then goes to .bss, which takes no space in "FLASH").

Largest objects (3 findings)

  INFO     top-objects  examples/thermostat-next.map region FLASH  line 31
           The largest objects in "FLASH": build/ble.o 16,284 bytes (24.8%), build/font_8x16.o 9,728 bytes (14.8%), build/ui.o 5,328 bytes (8.1%), build/ota.o 3,400 bytes (5.2%) and build/display.o 2,924 bytes (4.5%). The largest archives: libc_nano.a 1,980 bytes in 6 members (3.0%) and libgcc.a 732 bytes in 1 member (1.1%). Padding between input sections takes 2 bytes.
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.

  INFO     top-objects  examples/thermostat-next.map region RAM  line 32
           The largest objects in "RAM": build/ble.o 3,360 bytes (16.4%), build/sensor.o 3,072 bytes (15.0%), build/uart.o 2,304 bytes (11.3%), build/ui.o 1,792 bytes (8.8%) and build/display.o 1,024 bytes (5.0%). The largest archives: libc_nano.a 108 bytes in 2 members (0.5%).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.

  INFO     top-objects  examples/thermostat-next.map region CCMRAM  line 33
           The largest objects in "CCMRAM": build/sensor.o 2,560 bytes (3.9%).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Nothing to fix; the list shows where the bytes go. Change the length of the list with --top.

Growth (5 findings)

  ERROR    region-growth  examples/thermostat-next.map region FLASH  line 31
           The region "FLASH" grew by 4,168 bytes since the baseline map, from 44,628 bytes to 48,796 bytes, more than the limit of 655 bytes (1% of 65,536 bytes, --max-growth). The objects that grew most: build/ota.o +3,400 (new) and build/main.o +768.
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           basis: "This is useful on embedded targets to have a quick view of amount of free memory." (--print-memory-usage, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Check that the growth is meant. If it is, accept it by making this map the new baseline; if not, find the change that added it, starting with the objects named here.

  ERROR    region-growth  examples/thermostat-next.map region RAM  line 32
           The region "RAM" grew by 1,024 bytes since the baseline map, from 13,504 bytes to 14,528 bytes, more than the limit of 204 bytes (1% of 20,480 bytes, --max-growth). The objects that grew most: build/ota.o +1,024 (new).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           basis: "This is useful on embedded targets to have a quick view of amount of free memory." (--print-memory-usage, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Check that the growth is meant. If it is, accept it by making this map the new baseline; if not, find the change that added it, starting with the objects named here.

  WARNING  object-growth  examples/thermostat-next.map object build/main.o in FLASH  line 91
           build/main.o grew by 768 bytes in "FLASH" since the baseline map, from 1,224 bytes to 1,992 bytes, more than the limit of 655 bytes (1% of 65,536 bytes, --max-growth).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Check that the growth is meant: look at the change to this object, and at what it now pulls in from libraries.

  WARNING  object-growth  examples/thermostat-next.map object build/ota.o in FLASH  line 129
           build/ota.o is new in "FLASH" since the baseline map and takes 3,400 bytes, more than the limit of 655 bytes (1% of 65,536 bytes, --max-growth).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Check that the growth is meant: look at the change to this object, and at what it now pulls in from libraries.

  WARNING  object-growth  examples/thermostat-next.map object build/ota.o in RAM  line 271
           build/ota.o is new in "RAM" since the baseline map and takes 1,024 bytes, more than the limit of 204 bytes (1% of 20,480 bytes, --max-growth).
           basis: "Where object files are mapped into memory." (-M, --print-map, https://sourceware.org/binutils/docs/ld/Options.html)
           fix: Check that the growth is meant: look at the change to this object, and at what it now pulls in from libraries.

note: 4 output sections hold no code or data for the target and were not counted: .ARM.attributes, .comment, .debug_info and .debug_line

GATE: FAIL - 2 errors
```

Both regions still have room, so nothing else is reported; the growth limit (1 percent of each region by default) is what stops the change until someone accepts it. Make the new map the baseline when the growth is meant, or set `--max-growth`.

```
linker-map-budget-check <map-file> [options]
```

```
--format <name>           text, markdown, json or csv (default: text)
--fail-on <level>         exit with 1 when a finding is at this level or above: error or warning
                          (default: error); info never fails the run
--warn-percent <n>        a region above this percent of its budget is nearly full (default: 90)
--budget <region>=<size>  a budget below the length of a region, in bytes (480K, 0x78000, 1M) or as a
                          percent of the region (75%); may be given once per region
--max-object <limit>      the most one object file may take of a region, in bytes or as a percent of the
                          region's budget (default: 25%)
--top <n>                 how many of the largest objects and archives to list per region (default: 5)
--baseline <map-file>     an older map of the same firmware, for the growth checks
--max-growth <limit>      the most a region or an object may grow since the baseline, in bytes or as a
                          percent of the region's budget (default: 1%)
--help                    show the usage
--version                 show the version
```

Paths in the report are relative to the folder you run the command in, with forward slashes on every system; a file outside it is shown with its absolute path. `--budget FLASH=448K` keeps 64 KB of a 512 KB flash free for a bootloader or a second image; `--budget RAM=85%` keeps room for growth.

## What is read

[docs/inputs.md](docs/inputs.md) has the line forms and what each one is read as.

| Part of the map | What the tool takes from it |
| --- | --- |
| `Memory Configuration` | every region: name, origin, length and attributes |
| output sections | name, address (VMA), size, and the load address (LMA) when it differs |
| input sections | name, address, size and the object file or archive member; padding (`*fill*`) apart |
| symbols and assignments | names and values, to find the stack and the heap (`_estack`, `_Min_Stack_Size`, `__StackLimit`, `_sbrk`, `malloc` and others) |
| archive members, discarded input sections, common symbols, cross references | skipped and counted |

A section counts in the region that holds its address, and in the region that holds its load address when that is another one. Debugging sections and the load address of a zero-filled section never count.

## The checks

| Id | Severity | What it reports |
| --- | --- | --- |
| `unknown-format` | error | The file is not a map that GNU ld writes (an lld, IAR or Keil map, an ELF file, a binary file) |
| `region-over-budget` | error | A region holds more bytes than its length, or than `--budget` |
| `region-growth` | error | A region grew more than `--max-growth` since the `--baseline` map |
| `region-near-full` | warning | A region holds more than `--warn-percent` (90) of its budget |
| `no-stack-reserve` | warning | No section sets space aside for the stack, so the linker does not count it |
| `no-heap-reserve` | warning | malloc or sbrk is linked, and no section sets space aside for the heap |
| `orphan-section` | warning | An output section with code or data lies outside every declared region |
| `large-input-section` | warning | One object file or archive member takes more of a region than `--max-object` (25%) |
| `object-growth` | warning | One object grew in a region more than `--max-growth` since the baseline |
| `data-counted-twice` | info | Initialised data takes space where it is loaded (flash) and where it runs (RAM) |
| `top-objects` | info | The largest objects and archives of each region (`--top`) |
| `unparsed-lines` | info | Lines of the map in no form the tool reads, with their count and line numbers |

[docs/method.md](docs/method.md) gives each check, its exact rule, what it can see and what it cannot. [docs/rules-and-sources.md](docs/rules-and-sources.md) lists every quoted sentence with the saved page it comes from.

## Where the facts come from

| Fact | Source |
| --- | --- |
| Memory regions, their length, placing sections in them, and the error when one is too full | GNU ld manual, MEMORY Command, https://sourceware.org/binutils/docs/ld/MEMORY.html |
| What a link map holds, `--print-memory-usage` and `-Map` | GNU ld manual, Command-line Options, https://sourceware.org/binutils/docs/ld/Options.html |
| The load address of a section | GNU ld manual, Output Section LMA, https://sourceware.org/binutils/docs/ld/Output-Section-LMA.html |
| The description of an output section | GNU ld manual, Output Section Description, https://sourceware.org/binutils/docs/ld/Output-Section-Description.html |
| Orphan sections | GNU ld manual, Orphan Sections, https://sourceware.org/binutils/docs/ld/Orphan-Sections.html |
| Input and output sections, allocatable sections, VMA and LMA | GNU ld manual, Basic Linker Script Concepts, https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html |
| Moving the location counter to set space aside | GNU ld manual, The Location Counter, https://sourceware.org/binutils/docs/ld/Location-Counter.html |

## Formats

- `text`: for a terminal: the map line with the line counts, the limits, the areas with their result, the regions table, the largest objects and archives of each region, the growth table, then the findings grouped by area, each with its id, place, line, message, quotation and fix.
- `markdown`: the same for a pull request comment or the job summary. Pipes, square brackets, backticks, asterisks, underscores, line breaks and angle brackets from the map are escaped, so a section name cannot break a table or make a link.
- `json`: the whole report: the map counts, the areas, the regions with run and load bytes, the largest objects, the growth, every finding with id, severity, area, file, where, line, subject, message, fix, basis and source, the notes and the gate.
- `csv`: one row per finding, quoted as RFC 4180 says. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

To put the report in the job summary of a GitHub Actions run, after the firmware is built with `-Wl,-Map=build/firmware.map`:

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
    with:
      node-version: 22
  # ... build the firmware here ...
  - name: Memory report
    run: npx --yes github:INNERLUXES/linker-map-budget-check build/firmware.map --format markdown >> "$GITHUB_STEP_SUMMARY"
  - name: Memory gate
    run: npx --yes github:INNERLUXES/linker-map-budget-check build/firmware.map --budget FLASH=90% --fail-on warning
```

It needs no secrets and no toolchain of its own; a Linux runner is enough. To gate growth, keep the map of the main branch as an artifact and pass it with `--baseline`. Start with the default gate (errors only), and move to `--fail-on warning` when the first report is clean.

## Exit codes

`0` no finding at the `--fail-on` level, `1` at least one such finding (by default: an error, which includes a file that is not a GNU ld map), `2` a usage or input error (a missing file, a file over the size limit, too many lines or sections, a baseline that is not a GNU ld map, an unknown option).

## Limits

The tool reads what the linker placed, not what the firmware does. A map cannot show how deep the stack really goes, how the heap is used at run time, or a gap between two sections; it shows a stack reserve, not a stack that is big enough. Only GNU ld maps are read: the maps of LLVM lld, IAR and Keil have other layouts and are refused by name. A finding is a review item, and a clean report is not proof that the firmware fits at run time. [docs/limits.md](docs/limits.md) lists these, with the size limits.

## Related

The tool reads how firmware uses flash and RAM. The size of a web or app bundle against its budget is the subject of `bundle-budget-check` in the same organization; this tool reads only linker map files.

## Background

- How firmware is built, sized and kept inside its flash and RAM, with checks like this one in the pipeline: [embedded software development services](https://innerluxes.dev/software-development/embedded).

## License

MIT

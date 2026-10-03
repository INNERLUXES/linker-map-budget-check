# Inputs

The tool takes the path of one map file, and with `--baseline` the path of an older one. It reads those files and nothing else. It does not open the ELF file, an object file, an archive or a linker script named in the map, does not run the linker, and never reads from standard input. A symbolic link given as an argument is followed, because the person who runs the tool named it; the file it leads to must be a regular file.

## The file

- A map file that GNU ld writes when it is given `-Map=<file>`, or `-Wl,-Map=<file>` through gcc: arm-none-eabi-gcc, riscv64-unknown-elf-gcc, avr-gcc, xtensa and other GNU toolchains. The manual describes the option: "Print a link map to the file mapfile."
- A file is read as a GNU ld map when it holds both a `Memory Configuration` line and a `Linker script and memory map` line. Any other file is reported as `unknown-format`, with what it looks like: a map of LLVM lld, IAR ILINK, Arm Compiler armlink (Keil MDK) or Microsoft LINK, an ELF file, a binary file, an empty file, or a text file with no such lines. Nothing else is checked then.
- LF, CRLF and a lone CR all end a line, so a map written on Windows and one written on Linux give the same report.
- A file over 32 MB is refused from the size of the open file, before it is read. A folder, a pipe or a device is refused. At most 2,000,000 lines, 256 regions, 20,000 output sections, 500,000 input sections and 1,000,000 symbols and assignments.
- An argument that looks like an address (`https://...`) is refused. Nothing is downloaded.

## What a map holds

The manual lists what a link map shows: "A link map provides information about the link, including the following:" and, first in its list, "Where object files are mapped into memory." The tool reads the parts of the map that say where the bytes go.

| Part of the map | How it is read |
| --- | --- |
| `Archive member included to satisfy reference by file (symbol)` | skipped and counted; the members are seen again in the memory map |
| `Allocating common symbols` | skipped and counted; common symbols are seen again as `COMMON` input sections |
| `Discarded input sections` | skipped and counted; these sections are not in the output and are never counted against a region |
| `Merging program properties` and the property lines | skipped and counted |
| `Memory Configuration` | read: one region per line |
| `Linker script and memory map` | read: output sections, input sections, symbols and assignments |
| `Cross Reference Table` (from `--cref`) | skipped and counted |

Every line is counted once as read, skipped, blank or not parsed, and the four counts add up to the number of lines. The text report shows them on its `map:` line. A line that is in no known form is counted as not parsed and reported by `unparsed-lines`, so a line is never dropped without a trace.

## The Memory Configuration table

```
Name             Origin             Length             Attributes
FLASH            0x08000000         0x00010000         xr
RAM              0x20000000         0x00005000         xrw
*default*        0x00000000         0xffffffff
```

Each line gives the name, the origin, the length in bytes and the attributes of a region, as written in the MEMORY command of the linker script. The manual: "The MEMORY command describes the location and size of blocks of memory in the target." and "The len is an expression for the size in bytes of the memory region." Origins and lengths of up to 16 hexadecimal digits are read exactly, so 64-bit targets work too. `*default*` stands for the whole address space and is not a region with a budget; a map with no other region is checked for nothing but the map itself, and a note says so.

## The memory map

The memory map lists the output sections in the order of the linker script, each followed by its input sections and symbols. The manual describes the parts: "We sometimes refer to a section in an input file as an input section; similarly, a section in the output file is an output section."

| Line | Example | Read as |
| --- | --- | --- |
| output section | `.text           0x08000188     0x9554` | name, address (VMA) and size |
| output section with a load address | `.data           0x20000000      0x194 load address 0x080100b8` | the same, and the load address (LMA) |
| output section with a long name | `._user_heap_stack` and on the next line `0x20003e10      0x600` | the same; ld puts a name of 15 characters or more on its own line |
| output section that was not created | `.ARM.extab` with no address on the next line | a section of size 0 that is not counted |
| `/DISCARD/` | `/DISCARD/` | a section whose input sections are thrown away; not counted |
| input section | ` .text.main     0x080003e8      0x2c8 build/main.o` | name, address, size and object file; the object may be an archive member such as `libc_nano.a(libc_a-memcpy-stub.o)`, and a path may hold spaces |
| input section with a long name | ` .text.sensor_filter` and on the next line `0x08000d74      0x2e8 build/sensor.o` | the same |
| padding | ` *fill*         0x0800024e        0x2` | padding inside the output section, counted with the section and shown as padding |
| data statement | ` LONG           0x08000100        0x4 0x12345678` | bytes of the section that belong to no object |
| relaxation | `0x84 (size before relaxing)` | read; the size on the input section line is the one that counts |
| symbol | `0x080003e8                main` | name and address |
| assignment | `0x20005000                _estack = (ORIGIN (RAM) + LENGTH (RAM))` | name, value and expression; also `PROVIDE (end = .)` and `[!provide]` |
| a line of the script | ` *(.text*)`, ` KEEP (*(.isr_vector))`, ` FILL mask 0xff` | read, not used |
| `LOAD`, `START GROUP`, `END GROUP`, `OUTPUT(...)` | `LOAD build/main.o` | read, not used; the files are not opened |

## Where a section is counted

An output section is counted in the region that holds its address, and its input sections are counted for their object files in the same region. An output section with a load address in another region, such as `.data`, is counted in that region too. The manual: "The load address is specified by the AT or AT> keywords." and "An example of when they might be different is when a data section is loaded into ROM, and then copied into RAM when the program starts up (this technique is often used to initialize global variables in a ROM based system)."

Not counted:

- a section of size 0, a section that was not created, and `/DISCARD/`
- a section that holds no code or data for the target: debugging information, comments and attributes (`.debug*`, `.comment`, `.ARM.attributes`, `.riscv.attributes` and others of the list in `src/data.js`). The manual: "A section which is neither loadable nor allocatable typically contains some sort of debugging information." These are printed at address 0 and are left out also when a region starts at 0. A note names them.
- the load image of a section whose name says it holds no initial data: a name with `bss`, `noinit`, `no_init`, `uninit`, `heap` or `stack` in it, or `COMMON`. Such a section takes no space where it is loaded, even when ld prints a load address for it.
- the discarded input sections and the other skipped parts of the map

A section at an address in no region is reported by `orphan-section`, except one that starts right after the end of a full region, which the linker placed there because the region was too small; it is counted in that region (docs/method.md).

## The baseline

`--baseline` takes an older map of the same firmware. It is read the same way, with the same budgets. A baseline that is not a GNU ld map stops the run with exit code `2`. Regions are matched by name, and objects by the path the map writes, so the two maps should come from the same build setup.

## Options that change what is read

| Option | Read as |
| --- | --- |
| `--budget <region>=<size>` | a lower limit for one region: bytes as a decimal or `0x` number with an optional `K` (1,024) or `M` (1,048,576), as in a linker script, or a percent of the region. The region is matched by its name, or by its name in any case when only one region has it. A budget above the length is not used, and a note says so |
| `--warn-percent <n>` | the warning level, from 1 to 100, with up to two decimals |
| `--max-object <limit>` | a size, or a percent of the region's budget |
| `--top <n>` | from 1 to 100 |
| `--max-growth <limit>` | a size, or a percent of the region's budget; 0 means any growth |

# Limits

## Out of scope

- **Other linkers.** The tool reads only the map files that GNU ld writes. Maps of LLVM lld (`ld.lld -Map`), IAR ILINK, Arm Compiler armlink (Keil MDK), Microsoft LINK, TI and Microchip XC8 linkers have other layouts; a file of one of them is reported as `unknown-format` and nothing else is checked. The gold linker and mold write maps in other layouts too and are not read.
- **The ELF file.** The tool does not read the ELF file, its section headers or its symbol table, and does not run `size`, `nm` or `objdump`. [decisions/0001-read-the-map-not-the-elf.md](decisions/0001-read-the-map-not-the-elf.md) says why.

## What a map file cannot show

- **The stack at run time.** A reserve says how much room the linker sets aside, not how deep the stack really goes. Interrupts that nest, recursion and large local arrays can need more. Measure it with a stack painting test or the `-fstack-usage` files of gcc.
- **The heap at run time.** A heap reserve says how much room there is, not how much is taken or how fragmented it gets.
- **RTOS stacks and pools.** Task stacks and memory pools that an RTOS allocates from a static array are counted with the object that holds the array; ones it takes from the heap at run time are not seen.
- **Gaps.** The tool sums the sizes of sections. A gap between two sections, made by alignment or by a section at a fixed address, is not counted, so a region can be fuller than the total says. `--print-memory-usage` of ld counts up to the highest address used.
- **Bytes the linker script does not show.** A region that the hardware has but the MEMORY command does not declare, a bootloader that lives in the same flash, or a configuration block written at a fixed address by another tool is not seen. Use `--budget` to keep room for them.
- **What a name means.** A section with `bss`, `noinit`, `heap` or `stack` in its name is taken to hold no initial data, and a section named like debugging information is taken to hold no code or data for the target. A script that names its sections otherwise can mislead these rules.
- **The heap functions.** The heap check runs when the map holds `malloc`, `_sbrk` or another function of the list. A heap used through another name is not seen.
- **Why an object is large.** The map shows the input sections of an object, not the source behind them. Read the object with `nm --size-sort` to find the symbols.
- **Paths that change between builds.** Growth matches objects by the path the map writes. A build in another folder, or with other path options, makes every object look new.

## What the tool does not check

- Whether the firmware works or fits at run time. It reads a file and runs nothing.
- The size of the output files on the disk, or of a web or app bundle. `bundle-budget-check` in the same organization reads web bundles.
- Debugging sections, which do not go into the flash.
- The linker script itself: it is not opened.

## Size and counts

- A file over 32 MB is refused, from the size of the open file.
- At most 2,000,000 lines, 256 regions, 20,000 output sections, 500,000 input sections, and 1,000,000 symbols and assignments.
- A line longer than 4,096 characters is not parsed, and is counted by `unparsed-lines`.
- A check that finds more than 200 things lists the first 200 in a fixed order, counts the rest in the totals and the gate, and says so in a note.
- Text from the map shown in a report is cut to a fixed length: 80 to 200 characters for a name, 1,200 for a message and 600 for a fix.

Every limit is reported, as a finding, a note or a refusal with exit code `2`, so a cut is never silent.

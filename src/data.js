// The names, lists and sentences the checks rest on. Each sentence comes from a page of the GNU ld manual that is saved,
// with its address on the first line, in research/sources, and test/data.test.js compares this file with the saved text.
// Change a sentence here only after saving the new page text and updating docs/rules-and-sources.md. The checks in src/
// use these constants and never write a map header or a quoted sentence of their own.

export const SOURCES = [
  { id: 'ld-memory', file: 'ld-memory.txt', url: 'https://sourceware.org/binutils/docs/ld/MEMORY.html', label: 'GNU ld manual, 3.7 MEMORY Command' },
  { id: 'ld-map', file: 'ld-map-option.txt', url: 'https://sourceware.org/binutils/docs/ld/Options.html', label: 'GNU ld manual, Command-line Options: -M (--print-map), --print-memory-usage and -Map=mapfile' },
  { id: 'ld-lma', file: 'ld-output-section-lma.txt', url: 'https://sourceware.org/binutils/docs/ld/Output-Section-LMA.html', label: 'GNU ld manual, 3.6.8.2 Output Section LMA' },
  { id: 'ld-output-section', file: 'ld-output-section-description.txt', url: 'https://sourceware.org/binutils/docs/ld/Output-Section-Description.html', label: 'GNU ld manual, 3.6.1 Output Section Description' },
  { id: 'ld-orphan', file: 'ld-orphan-sections.txt', url: 'https://sourceware.org/binutils/docs/ld/Orphan-Sections.html', label: 'GNU ld manual, 3.10.4 Orphan Sections' },
  { id: 'ld-concepts', file: 'ld-basic-concepts.txt', url: 'https://sourceware.org/binutils/docs/ld/Basic-Script-Concepts.html', label: 'GNU ld manual, 3.1 Basic Linker Script Concepts' },
  { id: 'ld-dot', file: 'ld-location-counter.txt', url: 'https://sourceware.org/binutils/docs/ld/Location-Counter.html', label: 'GNU ld manual, 3.10.5 The Location Counter' }
];

export const source = (id) => SOURCES.find((s) => s.id === id);

// The header lines of a map file that GNU ld writes, as they appear in the file. docs/inputs.md describes each part.
export const MAP_HEADERS = {
  memory: 'Memory Configuration',
  map: 'Linker script and memory map',
  archive: ['Archive member included to satisfy reference by file (symbol)', 'Archive member included because of file (symbol)', 'As-needed library included to satisfy reference by file (symbol)'],
  common: 'Allocating common symbols',
  discarded: 'Discarded input sections',
  properties: 'Merging program properties',
  cref: 'Cross Reference Table'
};

// The first words of the row header of the Memory Configuration table, and the name of the region that stands for the
// whole address space when no MEMORY command is given.
export const REGION_TABLE_HEADER = ['Name', 'Origin', 'Length'];
export const DEFAULT_REGION = '*default*';

// Words that start a line of the memory map at column 0 and are not the name of an output section.
export const MAP_KEYWORDS = ['LOAD', 'START GROUP', 'END GROUP', 'OUTPUT(', 'TARGET(', 'INPUT(', 'GROUP(', 'Address of section'];

// The output section that throws its input sections away.
export const DISCARD_SECTION = '/DISCARD/';

// Data statements inside an output section (BYTE, SHORT, LONG, QUAD, SQUAD), printed like an input section.
export const DATA_STATEMENTS = ['BYTE', 'SHORT', 'LONG', 'QUAD', 'SQUAD'];

// The name ld gives to a gap of padding inside an output section.
export const FILL = '*fill*';

// The start of the line that ld writes after an input section whose size changed during relaxation.
export const SIZE_BEFORE_RELAXING = '(size before relaxing)';

// Output sections that hold no code or data for the target (debugging information, notes, attributes). They are printed
// at address 0 and are never counted against a region. The list is the tool's own.
export const NOT_ALLOCATED_PREFIXES = [
  '.debug', '.zdebug', '.comment', '.stab', '.ARM.attributes', '.riscv.attributes', '.gnu.attributes', '.gnu_debuglink',
  '.gnu_debugaltlink', '.gnu.build.attributes', '.GCC.command.line', '.line', '.symtab', '.strtab', '.shstrtab', '.xtensa.info',
  '.note.gnu.gold-version', '.MSP430.attributes', '.mdebug', '.pdr', '.gnu.warning', '.gnu.lto_'
];

// Words in the name of an output section that hold no initial data (zero-filled or reserved space). Such a section takes
// no flash, even when ld prints a load address for it. The list is the tool's own.
export const ZERO_INIT_WORDS = ['bss', 'noinit', 'no_init', 'uninit', 'heap', 'stack'];

// What the tool looks for to find a stack or a heap that the linker counts. A section whose name holds the word, with a
// size above zero, or a step of the location counter by one of the size symbols inside a section, is a reserve. A top
// or a limit symbol shows where a stack is, not that space is set aside for it. The lists are the tool's own.
export const STACK = {
  word: 'stack',
  sizeSymbols: ['_Min_Stack_Size', '__stack_size__', '__STACK_SIZE', '__stack_size', '_stack_size', 'STACK_SIZE', '_STACK_SIZE', '__StackSize', 'stack_size'],
  limitSymbols: ['__StackLimit', '_sstack', '__stack_start__', '_stack_start', '__stack_limit', '_stack_limit', '__stack_bottom'],
  topSymbols: ['_estack', '__StackTop', '__stack', '_stack', '__stack_end__', '_stack_end', '__initial_sp', '__stack_top', '_stack_top', '_eram_stack']
};
export const HEAP = {
  word: 'heap',
  sizeSymbols: ['_Min_Heap_Size', '__heap_size__', '__HEAP_SIZE', '__heap_size', '_heap_size', 'HEAP_SIZE', '_HEAP_SIZE', '__HeapSize', 'heap_size'],
  limitSymbols: ['__HeapLimit', '__heap_end__', '_heap_end', '__heap_limit', '_eheap', '__end_heap'],
  topSymbols: ['__HeapBase', '__heap_start__', '_heap_start', '_sheap', '__heap_base', 'end', '_end']
};

// Functions whose presence in the map shows that the firmware takes memory from a heap at run time. The heap check runs
// only when one of them is linked. The list is the tool's own.
export const HEAP_USERS = ['malloc', '_malloc_r', 'calloc', '_calloc_r', 'realloc', '_realloc_r', '_sbrk', 'sbrk', '_sbrk_r', 'pvPortMalloc'];

// Map files of other linkers, told apart by a line near the top, so the report can name what it was given. Reading
// them is out of scope (docs/limits.md).
export const OTHER_FORMATS = [
  { id: 'lld', name: 'an LLVM lld map file', pattern: /^\s*VMA\s+LMA\s+Size\s+Align\s+Out\s+In\s+Symbol\s*$/ },
  { id: 'iar', name: 'an IAR ILINK map file', pattern: /IAR ELF Linker|^\s*\*\*\*\s+PLACEMENT SUMMARY/ },
  { id: 'armlink', name: 'an Arm Compiler armlink map file (Keil MDK)', pattern: /Memory Map of the image|Image Symbol Table|^\s*Image component sizes/ },
  { id: 'msvc', name: 'a Microsoft LINK map file', pattern: /^\s*Preferred load address is / }
];

// Sentences quoted in the findings and the documents. Every text is on its saved page word for word
// (test/data.test.js compares them), and holds no year.
export const FACTS = {
  memoryDescribes: { source: 'ld-memory', section: 'MEMORY Command', text: 'The MEMORY command describes the location and size of blocks of memory in the target.' },
  warnTooFull: { source: 'ld-memory', section: 'MEMORY Command', text: 'The linker will set section addresses based on the memory regions, and will warn about regions that become too full.' },
  noShuffle: { source: 'ld-memory', section: 'MEMORY Command', text: 'The linker will not shuffle sections around to fit into the available regions.' },
  attrUnmapped: { source: 'ld-memory', section: 'MEMORY Command', text: 'The attr string is an optional list of attributes that specify whether to use a particular memory region for an input section which is not explicitly mapped in the linker script.' },
  lengthBytes: { source: 'ld-memory', section: 'MEMORY Command', text: 'The len is an expression for the size in bytes of the memory region.' },
  directRegion: { source: 'ld-memory', section: 'MEMORY Command', text: "Once you define a memory region, you can direct the linker to place specific output sections into that memory region by using the '>region' output section attribute." },
  tooLargeError: { source: 'ld-memory', section: 'MEMORY Command', text: 'If the combined output sections directed to a memory region are too large for the region, the linker will issue an error message.' },
  mapFile: { source: 'ld-map', section: '-Map=mapfile', text: 'Print a link map to the file mapfile.' },
  linkMapInfo: { source: 'ld-map', section: '-M, --print-map', text: 'A link map provides information about the link, including the following:' },
  objectsMapped: { source: 'ld-map', section: '-M, --print-map', text: 'Where object files are mapped into memory.' },
  archiveMembers: { source: 'ld-map', section: '-M, --print-map', text: 'All archive members included in the link, with a mention of the symbol which caused the archive member to be brought in.' },
  memoryUsagePrint: { source: 'ld-map', section: '--print-memory-usage', text: 'Print used size, total size and used size of memory regions created with the MEMORY Command command.' },
  memoryUsageUseful: { source: 'ld-map', section: '--print-memory-usage', text: 'This is useful on embedded targets to have a quick view of amount of free memory.' },
  loadAddressAt: { source: 'ld-lma', section: 'Output Section LMA', text: 'The load address is specified by the AT or AT> keywords.' },
  romImage: { source: 'ld-lma', section: 'Output Section LMA', text: 'This feature is designed to make it easy to build a ROM image.' },
  outputDescription: { source: 'ld-output-section', section: 'Output Section Description', text: 'The full description of an output section looks like this:' },
  mostOutputSections: { source: 'ld-output-section', section: 'Output Section Description', text: 'Most output sections do not use most of the optional section attributes.' },
  orphanDefinition: { source: 'ld-orphan', section: 'Orphan Sections', text: 'Orphan sections are sections present in the input files which are not explicitly placed into the output file by the linker script.' },
  orphanPlacement: { source: 'ld-orphan', section: 'Orphan Sections', text: 'If new output sections are created to hold orphaned input sections, then the linker must decide where to place these new output sections in relation to existing output sections.' },
  inputOutputSection: { source: 'ld-concepts', section: 'Basic Linker Script Concepts', text: 'We sometimes refer to a section in an input file as an input section; similarly, a section in the output file is an output section.' },
  allocatable: { source: 'ld-concepts', section: 'Basic Linker Script Concepts', text: 'A section with no contents may be allocatable, which means that an area in memory should be set aside, but nothing in particular should be loaded there (in some cases this memory must be zeroed out).' },
  debugging: { source: 'ld-concepts', section: 'Basic Linker Script Concepts', text: 'A section which is neither loadable nor allocatable typically contains some sort of debugging information.' },
  loadedIntoRom: { source: 'ld-concepts', section: 'Basic Linker Script Concepts', text: 'An example of when they might be different is when a data section is loaded into ROM, and then copied into RAM when the program starts up (this technique is often used to initialize global variables in a ROM based system).' },
  romLmaRamVma: { source: 'ld-concepts', section: 'Basic Linker Script Concepts', text: 'In this case the ROM address would be the LMA, and the RAM address would be the VMA.' },
  moveDot: { source: 'ld-dot', section: 'The Location Counter', text: 'Assigning a value to . will cause the location counter to be moved.' },
  holes: { source: 'ld-dot', section: 'The Location Counter', text: 'This may be used to create holes in the output section.' }
};

// The page of a quoted sentence.
export const factPage = (key) => source(FACTS[key].source).url;

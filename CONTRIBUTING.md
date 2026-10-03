# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows and macOS, the repository checks, CodeQL, and a secure development check of the repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, with `!` for a breaking change.

## Changing a check

1. Describe the change in docs/method.md first: what the check reports, its severity, what it can see and what it cannot, and the sentence of the GNU ld manual it follows. Where the tool makes its own choice (a severity, a default limit, a list of symbol names), say so and say why.
2. Add a test with the map written inline (test/helpers.js builds the lines in the layout ld writes), small enough that the result can be worked out by hand, and a near miss that must not match.
3. Text from the input goes through `safeText` before it reaches a finding or a note, so control characters are removed. A finding names sections, objects and symbols by their names and gives addresses and sizes; it copies no other text of the map.
4. A finding id, once released, keeps its meaning: pipelines and other tools read it from the JSON and CSV reports.
5. A thing the tool cannot see is reported as a note or a finding, never passed.

## Changing the reader

1. Every line of a map is read, skipped (a part the tool does not use), blank or not parsed, and the four counts add up to the number of lines. A new line form needs a test with the line as ld writes it, and the line it must not be mixed up with.
2. Keep the size, line and count limits, and the limit on the length of a line before a pattern runs on it. A pattern must be anchored, with bounded repeats and no nested repetition; add a test with a long near miss.
3. Maps written with LF and with CRLF line ends must give the same report. The example maps are stored as written (`.gitattributes`), and a test reads them both ways.
4. Paths are opened with `path.resolve`, never `path.join`, so an absolute path works on every system. Paths shown in a report are relative, with forward slashes. Do not assume that a backslash is a separator on Linux or macOS. A test that depends on the operating system (a path with a backslash, a link, a name with a control character, a device file) is guarded with `process.platform`, and every other test builds its paths with `resolve()` from names with forward slashes.

## Changing the quoted sentences or the lists

The sentences in `src/data.js` come from the pages of the GNU ld manual saved in `research/sources`: the MEMORY command, the map options, the output section LMA and description, orphan sections, the basic concepts and the location counter. When a page changes, save the new text in `research/sources` (the address on the first line, plain ASCII, no date), change `src/data.js` to match, and update docs/rules-and-sources.md. `test/data.test.js` compares every quoted sentence with the saved text, so changing one without the other fails. The code in `src` writes no map header of its own; it takes them from `src/data.js`.

The lists of stack and heap symbols, heap functions, sections that are not allocated and words of zero-filled sections are the tool's own. Add to them with a test that shows a real map line that needs the entry, and a near miss that must not match.

Never add a rule or a quoted sentence from memory or from a blog post. A new rule needs the official page, opened and saved, and the words of the page that it rests on.

## Rules for the code

- No runtime dependencies. Node 22 or newer and nothing else.
- The tool reads the files it is given and writes only to the screen. It opens no network connection and runs no program.
- Source files stay ASCII; write any other character in a pattern as a Unicode escape, or build it from its code point.
- Never commit a real secret, even as a fixture. `npm run check` fails on anything that looks like a credential.
- The README, the documents and the example maps carry no dates or years. Version numbers (Node 22, a toolchain version in a path) are fine.

## Before you open the pull request

```
npm test
npm run check
npm run example
```

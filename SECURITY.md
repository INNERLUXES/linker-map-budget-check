# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "linker-map-budget-check security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up map file that shows the problem, what you expected and what happened. Use made-up names for objects, paths and symbols, and no real product names, internal paths or customer data.

## Scope

In scope:

- an input that makes the tool open a network connection, open a file other than the ones it was given (such as a file named in a `LOAD` line or an object path), or run a program
- an input that makes the tool hang, take very long, or use unbounded memory, such as a very large file, very many lines, regions, sections or symbols, a very long line, or a path that is not a regular file
- text from a path, a section name, an object name or a symbol that breaks a Markdown table, injects a formula into a CSV report, or rewrites the terminal through control or direction characters
- a name such as `__proto__` that changes how objects behave inside the tool
- a map that the tool reads wrong in a way that hides a problem: bytes that are not counted in their region, a line that is dropped without being counted as not parsed, or a file that is not a GNU ld map and is read as one
- a finding that docs/method.md says is reported, for an input the tool accepts, that the report leaves out
- a sentence in src/data.js that differs from the saved page in research/sources

Out of scope: what a map file cannot show (docs/limits.md lists it), the GNU ld manual that the tool follows, the maps of other linkers, and how your pipeline stores the reports.

Read [docs/threat-model.md](docs/threat-model.md) for the rest.

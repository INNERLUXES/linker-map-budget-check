# Secure defaults

The default run is the safe run. Nothing below needs a flag, and none of it can be switched off.

## How the tool behaves by default

- **No network.** The tool reads the files it is given and sends nothing anywhere. It does not check for updates. An argument that looks like an address is refused. It can run in a locked-down job with no outbound access at all.
- **No commands.** The tool never runs a program, a shell, the linker, `size`, `nm`, `objdump`, `git` or a package manager. No name or path from the map is ever put on a command line.
- **No dependencies.** Node 22 or newer and nothing else, so a check does not add a supply chain of its own. There is no `node_modules` to install before it runs.
- **Reads only what is named.** The tool opens the map file you name and the baseline you name, and nothing that a map names: not the ELF file, not an object or archive in a `LOAD` line, not a linker script.
- **Regular files only, bounded.** Each file is opened once, its type and size are taken from the open file, and anything that is not a regular file or is over 32 MB is refused before it is read.
- **A bounded reader.** Lines are split once; a line over 4,096 characters is counted and never matched; every pattern is anchored, with bounded repeats and no nested repetition; the numbers of lines, regions, sections, input sections and symbols are capped.
- **Nothing is guessed.** A file that is not a GNU ld map is an error, not a pass. A line in no known form is counted and reported. A section outside every region is reported. A stack or heap that the map does not show is reported with what was looked for.
- **Clean output.** Text from the map has control characters, line separators and direction controls removed and its length capped before it reaches a report or an error message, so a hostile name or path cannot rewrite the terminal or reorder what a reader sees. Markdown cells escape pipes, backslashes, square brackets, backticks, asterisks, underscores, line breaks and `<`, `>` and `&`. CSV cells are quoted as RFC 4180 says, and a cell that a spreadsheet would read as a formula gets a leading `'`.
- **No prototype tricks.** Regions, sections and objects are kept in arrays and maps, so a name such as `__proto__` or `constructor` is just data.
- **The gate is on.** Without any option, an error makes the run exit with `1`.
- **Writes nothing to disk.** The report goes to the screen. Redirect it to a file or the job summary only when you need to keep it.

## Running it safely on files you do not know

1. A map file is data, and the tool treats it as data. Still, run it as a user with read access to the files and nothing else; it needs no account, no key, no toolchain and no network.
2. Read the notes and the info findings: they say what was not counted and why, so a pass is not taken for more than it is.
3. A map holds the paths of the build machine. Keep that in mind before you post a report in a public place.

## SSDF

The repository is checked against NIST SP 800-218 (SSDF) in its own pipeline, with `ssdf-repo-check` pinned to its release commit. The evidence it looks for is in these files:

| Practice | Evidence in this repository |
| --- | --- |
| PO.1 Define security requirements | CONTRIBUTING.md, docs/secure-defaults.md |
| PO.2 Roles and responsibilities | .github/CODEOWNERS |
| PO.3 Toolchain | .github/workflows/ci.yml, codeql.yml, release.yml |
| PO.4 Criteria for security checks | CodeQL with the security-extended queries |
| PO.5 Secure environments | a `permissions:` block in every workflow, actions pinned to commits |
| PS.1 Protect the code | .gitignore for keys and `.env`, `npm run check` for committed secrets |
| PS.2 Integrity of releases | SHA-256 checksums and a build provenance attestation in release.yml |
| PS.3 Archive and provenance | a CycloneDX SBOM and the CHANGELOG with every release |
| PW.1 Design for security | docs/threat-model.md |
| PW.2 Review the design | docs/decisions |
| PW.4 Reuse secure components | no runtime dependencies, a lock file, Dependabot |
| PW.5 Secure coding | CONTRIBUTING.md, `npm run check` |
| PW.6 Build settings | `npm ci` from the lock file |
| PW.7 Code review | the pull request template and CODEOWNERS |
| PW.8 Testing | `npm test` on Linux, Windows and macOS, with hostile input tests |
| PW.9 Secure defaults | this document |
| RV.1 Find vulnerabilities | SECURITY.md, Dependabot |
| RV.2 Respond to vulnerabilities | SECURITY.md |

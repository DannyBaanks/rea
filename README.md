<div align="center">

**English** · [简体中文](docs/readme/README_zh.md) · [繁體中文](docs/readme/README_zh-TW.md) · [日本語](docs/readme/README_ja.md) · [한국어](docs/readme/README_ko.md) · [Türkçe](docs/readme/README_tr.md) · [Русский](docs/readme/README_ru.md) · [Tiếng Việt](docs/readme/README_vi.md) · [ไทย](docs/readme/README_th.md) · [Deutsch](docs/readme/README_de.md) · [Español](docs/readme/README_es.md) · [Français](docs/readme/README_fr.md) · [Українська](docs/readme/README_uk.md) · [Polski](docs/readme/README_pl.md) · [Português (Brasil)](docs/readme/README_pt-BR.md) · [العربية](docs/readme/README_ar.md) · [فارسی](docs/readme/README_fa.md) · [Bahasa Indonesia](docs/readme/README_id.md) · [Italiano](docs/readme/README_it.md)
· [Ελληνικά](docs/readme/README_el.md) · [മലയാളം](docs/readme/README_ml.md) · [Roman Urdu](docs/readme/README_ur-Latn.md) · [Română](docs/readme/README_ro.md) · [Български](docs/readme/README_bg.md)

# REA: Reverse Engineer Anything

### One MCP for reverse engineering across binaries, applications, and runtime behavior.

**See a feature you like. Understand how it works, down to the binary level.**

[![npm version](https://img.shields.io/npm/v/rea-agents?style=flat-square&color=cb3837)](https://www.npmjs.com/package/rea-agents)
[![MCP tool catalog](https://img.shields.io/badge/MCP-tool_catalog-5c4ee5?style=flat-square)](docs/reference/mcp-contracts.md#generated-catalog)
[![Node.js requirements](https://img.shields.io/badge/Node.js-requirements-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#what-you-can-analyze)
[![skills.sh](https://skills.sh/b/morluto/rea?style=flat-square)](https://skills.sh/morluto/rea/reverse-engineer-anything)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)
[![Discord](https://img.shields.io/discord/1556595354999332884?logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/GkcryMnJDM)

<a href="https://trendshift.io/repositories/82054?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-82054" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/82054" alt="morluto%2Frea | Trendshift" width="250" height="55"/></a>

**[Website](https://rea.tools/) · [Guides](https://rea.tools/guides/) · [Showcases](https://rea.tools/showcase/)**

<a href="https://discord.com/invite/GkcryMnJDM"><img alt="Join the REA community on Discord" src="https://img.shields.io/badge/Join%20us%20on%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" height="40"></a>

[Quick start](#quick-start) · [Fork enhancements](#fork-enhancements-dannybaanks--isyco-edition) · [How REA works](#how-rea-works) · [What you can analyze](#what-you-can-analyze) · [Showcases](#showcases) · [Build RL environments](#build-rl-environments) · [FAQ](#faq) · [Documentation](#documentation)

<code>npx rea-agents setup</code>

</div>

> [!IMPORTANT]
> Get REA from [morluto/rea](https://github.com/morluto/rea),
> [rea.tools](https://rea.tools/), or the [rea-agents npm package](https://www.npmjs.com/package/rea-agents).
> Follow the installation and release links from these official sources. A similar
> repository name or copied README does not establish that a download is official.

> [!NOTE]
> **Fork Baseline & Divergence Information (DannyBaanks / ISyCo)**
>
> This repository is a specialized development fork maintained by DannyBaanks and the ISyCo research group (`https://github.com/DannyBaanks/rea`).
>
> - **Upstream Repository**: morluto/rea (https://github.com/morluto/rea)
> - **Base Release Tag**: `rea-agents-6.5.0` (`3b79af28e80785afce9f5998d8f03289402a1847`, released Oct 14, 2026)
> - **Upstream Synchronized**: Commit `fffb0741936067530d1ce9777461cd53e87398c2` (Oct 15, 2026; incorporates 60 upstream post-6.5.0 stability & verification fixes)
> - **Current Fork State**: `rea-agents-6.5.0-62-g6e01c226c` (62 commits ahead of the 6.5.0 tag)
> - **Key Improvements**:
>   1. **Compact MCP Catalog Profile** (`REA_MCP_TOOL_PROFILE=compact`): Progressive disclosure surface advertising only 3 meta-tools (`rea_discover`, `rea_describe`, `rea_execute`), reducing advertised schemas from 3.48 MB (213 tools) down to 7 KB (99.8% token reduction) while maintaining full tool access.
>   2. **Classic Malbolge Analysis Family**: Complete static decoding (`inspect_malbolge`), bounded in-process tracing (`trace_malbolge`), and structural decompilation projection (`decompile_malbolge`).
>   3. **Auditable Self-Modifying Memory & SHA-256 State Digests**: Step-by-step writeback logging (`position`, `value_before`, `value_after`), UUID execution tracking, and deterministic 59,049-word ternary memory digests.
>   4. **Fail-Closed 8 MiB DoS Protection**: `readSource` denies oversized sources via `stat` before loading into host RAM.

<div align="center">

<br />

<img src="docs/assets/rea-hopper-analysis.png" alt="REA launching its analysis bridge inside Hopper while inspecting a native binary" width="1200" />

<br /><br />

<table aria-label="REA community">
<tr>
<td align="center" width="360">
  <a href="https://discord.gg/GkcryMnJDM">
    <img src="docs/assets/discord.svg" height="42" alt="Discord" /><br />
    <strong>Join the Reverse Engineering Community</strong>
  </a><br />
  <sub>Discord · Q&amp;A · Show and Tell</sub>
</td>
</tr>
</table>

<br />

</div>

---

See a feature in an app that you want in your own product? Ask your agent to investigate it with REA. It can inspect the app without its source code, explain how the feature works, show the evidence, and build a version for your project.

REA connects your agent to tools for inspecting native binaries, JavaScript and Electron apps, .NET assemblies, and websites. You can also use the same tools from your terminal. Analysis runs locally, and results include the evidence and limitations behind each conclusion.

Setup registers REA with your agent and installs matching workflow instructions. Native analysis can use an existing Hopper, Ghidra, IDA or Kuna installation; setup can optionally install Hopper with approval. Static JavaScript analysis needs no native analysis engine.

> **[Visit the REA website](https://rea.tools/)** for setup instructions, illustrated guides, and real case studies.

## Quick start

On Linux, Ghidra, JADX, firmware tool launches and static JavaScript/Electron
analysis require a procps-compatible `ps` on REA's `PATH` for process ownership
checks. Recovery steps are in `docs/getting-started/installation.md` under
"Linux owned-process prerequisite".

### Set up your agent

With Node.js and npm installed, run:

```bash
npx rea-agents setup
```

Choose your agents, review the proposed changes, and approve them. Setup adds
REA's MCP server and matching workflow instructions, with backups of existing
configuration. Restart your agent afterward. Setup records the selected runtime and REA
entry script directly. If acquired through a package runner, keep its cache entry
available. Run package acquisition from a trusted directory outside the target
project. Installation and recovery details are in the setup guide below.

Setup supports Claude Code, Codex, Cursor, Gemini CLI, Grok Build and
[other agents](docs/getting-started/installation.md#supported-agents). See
[installation and setup](docs/getting-started/installation.md) for provider configuration,
manual MCP registration, Claude Code/Codex plugins, and the Cursor Marketplace
plugin.

MCP uses compact input schemas by default to reduce context overhead. Set
`REA_MCP_INPUT_SCHEMA_PROFILE=full` in your MCP registration when you need the
complete advertised field guidance and nested validation details. Both profiles
keep the full tool set and canonical server validation. See
"Compact input schema profile" in the MCP contracts guide.

Complete output schemas are advertised by default. If your client caps the
complete `tools/list` frame, set `REA_MCP_OUTPUT_SCHEMA_PROFILE=compact` to
bound each advertised output schema, or `off` to omit output schemas entirely.
Both settings keep canonical server-side validation and complete structured
results. See "Output schemas" in the MCP contracts guide.

### Ask your agent

```text
Understand how search works in the Notes app, show me the evidence, and build a
similar feature for my project.
```

Replace Notes with your target app and the feature you want to understand.

### Use the terminal

Inspect an extracted JavaScript/Electron app directory or ASAR:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

The result includes modules, imports, Electron boundaries and their evidence.
Replace the path with your target, such as `"D:/apps/example"` on Windows.

To install the `rea` command for regular use:

```bash
npm install --global rea-agents
rea --help
```

For native analysis, configure a provider first. See the
[CLI and Evidence guide](docs/getting-started/cli.md) for native commands, provider selection,
snapshots and scripting.

### Update REA

REA changes quickly, and new releases include frequent bug fixes. Keep your
installation up to date.

For a CLI installed with `npm install --global` or `bun add --global`:

```bash
rea update
```

`rea --update` is an alias for this verified workflow and accepts the same global
output flags. Use `rea update` when combining it with other command controls.

Updater commands retain at most 4 MiB of stdout and stderr combined. Oversized
metadata replies are rejected after the command exits; verbose installs continue
with bounded diagnostics. Human progress output respects terminal backpressure
and waits for submitted writes to finish.

Bun global updates require Bun 1.2.17 or later. With an older Bun release,
upgrade Bun manually before running `rea update`.

To refresh your agent registrations and skill, run the setup command printed
by the update.

If you use `npx`, update your agent setup with:

```bash
npx rea-agents@latest setup
```

Review the setup changes and restart your agent. For one-off CLI commands,
use `npx rea-agents@latest` followed by the command. With Bun, use
`bunx rea-agents@latest` in place of `npx rea-agents@latest`.

## Fork enhancements: DannyBaanks / ISyCo edition

This fork incorporates critical architectural additions tailored for token-constrained agent environments and esoteric binary/self-modifying program analysis.

### Installation from this repository

> [!WARNING]
> Running `npx rea-agents setup` or `npm install -g rea-agents` installs the **official upstream distribution** from npm, which does **not** include this fork's features (such as the Malbolge analysis engine or the compact catalog profile).
> To use the enhancements in this fork, clone this repository and run from source or link it locally.

#### 1. Clone and compile the fork

```sh
git clone https://github.com/DannyBaanks/rea.git
cd rea
npm install
npm run compile
```

#### 2. Configure your agent to use this fork

Add this local repository build as an MCP server in your agent's MCP configuration (e.g., Claude Code, Cursor, Gemini CLI, Windsurf).

**Claude Code CLI:**

```sh
claude mcp add rea -- node /absolute/path/to/rea/scripts/rea.mjs mcp
```

**Agent MCP configuration (with compact profile enabled):**

```json
{
  "mcpServers": {
    "rea": {
      "command": "node",
      "args": ["/absolute/path/to/rea/scripts/rea.mjs", "mcp"],
      "env": {
        "REA_MCP_TOOL_PROFILE": "compact"
      }
    }
  }
}
```

#### 3. (Optional) Link the CLI locally

To use the `rea` CLI command with this fork across your system:

```sh
npm link
rea --help
```

### 1. Compact MCP catalog profile (`REA_MCP_TOOL_PROFILE=compact`)

In standard upstream REA, starting the MCP server advertises all 213 tools immediately, generating a schema payload of **3,487,784 bytes (~3.48 MB)**. For agents with strict tool-call constraints or context-window limits (such as Claude Code, Cursor, Gemini CLI, Grok, or Kimi), this large tool payload leads to truncated system instructions, high context costs, and high latency.

The compact profile implements progressive capability disclosure:

- **Only 3 tools advertised**:
  - `rea_discover`: Query tools by name, category (`kind`), or keyword, returning capped 160-character summaries.
  - `rea_describe`: Resolves and returns the full schema and contract for a specific tool on demand.
  - `rea_execute`: Dispatches tool invocation, validating arguments strictly against the target schema and enforcing admission controls.
- **Payload reduction**: From 3,487,784 bytes (213 tools) to **7,065 bytes** (3 tools) — a **99.8% reduction in token overhead**.
- **Full capability access**: All 213 upstream tools remain fully registered, admitted, and callable through `rea_execute`.

To activate the compact profile:

```sh
export REA_MCP_TOOL_PROFILE=compact
```

Or in your agent configuration's environment variables:

```json
{
  "mcpServers": {
    "rea": {
      "command": "node",
      "args": ["/absolute/path/to/rea/scripts/rea.mjs", "mcp"],
      "env": {
        "REA_MCP_TOOL_PROFILE": "compact"
      }
    }
  }
}
```

### 2. Classic Malbolge analysis & reverse engineering suite

Adds native support for analyzing and reverse-engineering programs written in Classic Malbolge (59,049 ten-trit memory machine), using a bit-exact TypeScript port of the canonical ISyCo interpreter:

- `inspect_malbolge`: Static positional decode of source cells into opcodes (`(cell + position) % 94`), mnemonics (`jmp`, `out`, `in`, `rotate`, `movd`, `crazy`, `nop`, `halt`), whitespace tracking, and opcode distribution statistics without executing any code.
- `trace_malbolge`: Bounded in-process virtual machine execution returning step-by-step register states (`a`, `d`, code pointer, opcode), captured Latin-1 output bytes, explicit halt/budget exhaustion facts, and detailed memory mutations. Bit-exact parity with canonical ISyCo runs (e.g., standard "Hello, world." halts at step 48).
- `decompile_malbolge`: Structural reverse-engineering projection identifying translator-family bootstraps (initial jump to nop blocks), executed instruction spans vs data candidate spans, and reconstructed output strings.

CLI usage examples:

```sh
# Decode source structure statically
npx rea-agents inspect_malbolge /path/to/program.mal

# Trace execution with bounded step budget
npx rea-agents trace_malbolge /path/to/program.mal --max_steps 50000

# Structural decompilation projection
npx rea-agents decompile_malbolge /path/to/program.mal
```

### 3. Auditable self-modifying memory & cryptographic state digests

Malbolge programs mutate their own memory space and encrypt instructions after execution. This fork adds forensic instrumentation:

- **Write-by-write mutation tracing**: Every step event in `trace_malbolge` records each memory write (`position`, `value_before`, `value_after`), covering both explicit stores (`rotate`, `crazy`) and post-instruction self-encryption.
- **Cryptographic state digests**: Computes SHA-256 digests over the comma-joined 59,049-word memory space at load time (`state_digest_before`) and termination (`state_digest_after`). Invalid runs return `null` rather than falsifying state facts.
- **Execution identity**: Every traced run receives a unique UUID (`execution_id`) linking all mutation events to a single immutable execution session, separate from the source file's SHA-256 artifact digest.
- **Mutation accounting**: Tracks total `writebacks` and actual `representation_changes` (writes that genuinely altered cell values).

### 4. Fail-closed DoS protection (8 MiB source cap)

To prevent memory exhaustion and denial-of-service from massive memory dumps or extended-Malbolge cores (such as the 371 MB malbolge-lisp core), `readSource` checks file size via `stat` before reading. Files exceeding `MAX_MALBOLGE_SOURCE_BYTES = 8 * 1024 * 1024` (8 MiB) are rejected immediately before touching host RAM.

### 5. Upstream baseline & divergence state

| Property                     | Value                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Upstream Repository          | morluto/rea                                                                    |
| Fork Repository              | DannyBaanks/rea                                                                |
| Base Upstream Tag            | rea-agents-6.5.0 (commit 3b79af28e80785afce9f5998d8f03289402a1847, 2026-10-14) |
| Synchronized Upstream Commit | fffb0741936067530d1ce9777461cd53e87398c2 (2026-10-15)                          |
| Git Describe                 | rea-agents-6.5.0-62-g6e01c226c                                                 |
| Commits Ahead of Tag         | 62 total (60 upstream post-6.5.0 fixes + 2 fork feature suites)                |
| Active Fork Branch           | main (tracking privado/main)                                                   |

## How REA works

Your agent calls REA through MCP to inspect the target and trace relevant code.
REA returns findings with their evidence. The agent uses them to ask follow-up
questions, explain the behavior, or write and test an implementation.
CLI commands use the same workflows.

![REA investigation flow: your agent asks about a local target, REA inspects and traces it using analysis tools, and the agent uses the returned code, references and unknowns to explain, implement and test.](website/public/assets/figures/rea-investigation-flow.svg)

[Open the full-size figure](website/public/assets/figures/rea-investigation-flow.svg).

<a id="current-status"></a>

## What you can analyze

REA requires Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), or 26.12.1+, plus npm.
Additional tools and host support depend on the target:

| Target                  | What REA returns                                                                                         | Requirements and guide                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop installations   | Runtime candidates, supporting files, component markers and next probes                                  | Built-in bounded directory/header inspection; [desktop applications](docs/desktop-applications.md)                                                                   |
| Native binaries         | Pseudocode, assembly, strings, symbols, calls and references                                             | Hopper, Ghidra, IDA or Kuna; [native analysis](docs/guides/native/native-investigation.md)                                                                           |
| Offline ELF layout      | Sections, segments, original symbols/relocations and static mitigation candidates                        | Caller-supplied pwntools on Linux x64; [binary diagnostics](docs/guides/native/binary-diagnostics.md)                                                                |
| Go binaries             | Embedded compiler version, modules, replacements and build settings                                      | Built-in static ELF/PE/thin Mach-O inspection; no Go installation required                                                                                           |
| GPU code objects        | CUDA/HIP targets, selected kernel parameters and resources, retained PTX text                            | Built-in static ELF/PE/fatbin/CUBIN/PTX inspection; [GPU code objects](docs/gpu-code-objects.md)                                                                     |
| Model artifacts         | GGUF / safetensors metadata, tensor declarations and derived totals                                      | Built-in header inspection; optional full-file hash; [model files](docs/model-artifacts.md)                                                                          |
| IL2CPP metadata         | Unity global-metadata.dat assembly images, type and method names and index ranges                        | Built-in static decoding of versions 24, 27, 29, 31 and 39; no Unity required                                                                                        |
| Godot PCK               | Archive inventory and extraction, original header/directory facts and selected content identities        | Built-in static formats 2, 3 and 4; no Godot required                                                                                                                |
| Rust binaries           | Embedded cargo-auditable crate names, versions, sources and dependency edges                             | Built-in static ELF/PE/thin Mach-O inspection; [Rust binaries](docs/rust-binaries.md)                                                                                |
| PE certificates         | Authenticode WIN_CERTIFICATE entries and PKCS#7 signer/X.509 identity fields                             | Built-in static PE inspection; [PE certificates](docs/pe-certificates.md)                                                                                            |
| PE imports              | Import and delay-load DLL names, ordinals, IAT RVAs and pefile import hash                               | Built-in static PE inspection; [PE imports](docs/pe-imports.md)                                                                                                      |
| Windows shortcuts       | Shell Link target, arguments, working dir, ExtraData and Tracker droid facts                             | Built-in static LNK inspection; [Windows shortcuts](docs/guides/native/windows-shortcut.md)                                                                          |
| ELF notes               | PT_NOTE/SHT_NOTE owners, types, GNU build-id and ABI-tag fields                                          | Built-in static ELF inspection; [ELF notes](docs/elf-notes.md)                                                                                                       |
| Binary hardening        | PIE, NX, RELRO, CFG and related header flags for ELF, PE and Mach-O                                      | Built-in static header inspection; [binary hardening](docs/binary-hardening.md)                                                                                      |
| Apple IPS crashes       | .ips metadata, threads, images, registers and documented crash classes                                   | Built-in static JSON inspection; [Apple IPS](docs/apple-ips.md)                                                                                                      |
| Linux kernel modules    | .modinfo keys, __versions CRCs, this_module presence, and signature trailer                              | Built-in static ELF inspection; [kernel modules](docs/kernel-modules.md)                                                                                             |
| Erlang BEAM             | IFF chunks, atoms, exports, imports, lambdas and the Code header                                         | Built-in static BEAM inspection; [Erlang BEAM](docs/erlang-beam.md)                                                                                                  |
| WASM artifact           | Validation, sections, exact import/export WAT forms and decoded WAT                                      | Caller-supplied WABT 1.0.42; `inspect_wasm_artifact`                                                                                                                 |
| EVM bytecode            | Dispatch selectors, byte offsets, inferred arguments and mutability                                      | Local raw/hex carrier on Linux x64; [offline EVM guide](docs/guides/evm/evm-bytecode.md)                                                                             |
| SQLite databases        | Tables, columns, indexes, views, triggers and selected ordinary-table rows                               | Local database/WAL snapshot; Node.js 24.x >=24.15 or 26+ with native SQLite limits                                                                                   |
| Recorded Linux crashes  | Raw notes, every recorded thread's registers/signals and optional mapping candidates                     | Caller-supplied pwntools on Linux x64; optional GDB/pwndbg; [recorded crashes](docs/guides/native/recorded-crashes.md)                                               |
| JavaScript / Electron   | Modules, imports, source maps, routes, IPC, native add-ons, `rea audit-release-exposure`                 | Node.js and npm; Linux: procps-compatible `ps`; [application analysis](docs/guides/javascript/javascript-application-workflows.md)                                   |
| Websites                | Page structure, scripts, network observations and requested screenshots                                  | A Chrome-family browser; [browser analysis](docs/guides/web/browser-observation.md)                                                                                  |
| Saved network captures  | Requests, responses, exposed payloads and source locations                                               | HAR or Fiddler Everywhere SAZ; mitmdump on Linux for native mitmproxy; [capture guide](docs/guides/web/web-network-captures.md)                                      |
| .NET assemblies         | Metadata, CIL instructions, declared native dependencies and build comparisons                           | None (static only); [managed-code guide](docs/guides/managed/managed-code-analysis.md)                                                                               |
| Android APKs            | Manifest declarations, classes, decompiled methods and references                                        | Headless JADX and a full JDK on Linux/macOS/Windows x64; [Android guide](docs/guides/android/android-analysis.md)                                                    |
| APK signatures          | v1/v2/v3/v3.1 signers, certificate fingerprints, key rotation and digest self-consistency                | None (static only); `inspect_apk_signature`                                                                                                                          |
| Android devices         | Devices, packages, processes, logs, dumps, screen captures, and APK/file transfers                       | Caller-supplied adb (emulator or hardware); [ADB guide](docs/guides/android/adb-device-analysis.md)                                                                  |
| JEB projects            | Engine-backed project units, artifact digests and type/method pseudo-code                                | A caller-started JEB client serving MCP, selected with REA_JEB_MCP_URL; [JEB guide](docs/providers/jeb-analysis.md)                                                  |
| Android resources       | Decoded manifest, string tables, locales and version facts                                               | Caller-supplied Apktool launcher; [resource guide](docs/guides/android/apktool-resource-analysis.md)                                                                 |
| Flutter apps            | Dart snapshot hash, per-ABI library digests and engine build provenance                                  | None (static APK parsing); [Flutter guide](docs/guides/android/flutter-analysis.md)                                                                                  |
| Firmware                | Regions, extraction results and native-analysis handoffs                                                 | Binwalk / Unblob on Linux; [firmware guide](docs/guides/firmware/firmware-analysis.md)                                                                               |
| Recorded packets        | Selected fields, repeated values, filters and decode-as rules                                            | Linux: TShark 4.x + prlimit; [capture guide](docs/guides/data/packet-captures.md)                                                                                    |
| Packet summaries        | Endpoints, DNS, TLS SNI, protocol distribution and HTTP requests                                         | Caller-supplied tshark and capinfos (Linux-verified); [pcap guide](docs/guides/data/pcap-analysis.md)                                                                |
| Recorded logic signals  | Decoder annotations, sample ranges and diagnostics                                                       | Linux: sigrok-cli 0.7.2 + prlimit; [signal recordings](docs/guides/signals/signal-recordings.md)                                                                     |
| Packages and resources  | File inventories, digests, plists, Apple bundle anatomy and extracted resources                          | [Artifact and JavaScript guide](docs/guides/javascript/javascript-artifact-reconstruction.md), [Apple applications](docs/guides/apple/apple-application-analysis.md) |
| Process behavior        | Terminal output, interactions, exit and filesystem observations, and run comparisons                     | Linux/macOS with a native PTY; [process capture](docs/guides/runtime/process-capture.md)                                                                             |
| PyInstaller executables | CArchive members, Python version, entry scripts and extracted bytecode                                   | None (static only); [Python packaged applications](docs/python-packaged-applications.md)                                                                             |
| Deno compile binaries   | Virtual files, entry point, recorded options, npm snapshot length                                        | None (static only); [Deno compile executables](docs/deno-standalone.md)                                                                                              |
| Malbolge programs       | Positional instruction decode, memory writeback audit, Latin-1 output, state digests, bootstrap analysis | Built-in canonical ISyCo engine; bounded 8 MiB source cap; `inspect_malbolge`, `trace_malbolge`, `decompile_malbolge`                                                |

Static JavaScript and .NET inspection read the supplied files without running
the application. Runtime capture runs or interacts with the selected target
using your user permissions; each runtime guide describes its effects.

For offline native-binary inspection, REA also supports caller-supplied GNU
objdump and Rizin. See the [reverse-engineering tools guide](docs/reverse-engineering-tools.md)
for provider setup, CLI commands, and Evidence limitations. REA does not install
or update either provider.

<a id="choosing-a-deep-analysis-provider"></a>

Native formats and host support vary by provider. See
[Hopper and Ghidra setup](docs/getting-started/installation.md#hopper), the
[IDA guide](docs/providers/ida-provider.md) (including an optional native MCP bridge), the
[Kuna decompiler guide](docs/kuna-provider.md), and
[experimental Windows Ghidra support](docs/providers/windows-ghidra-p0.md).
Ghidra also supports [16-bit DOS analysis](docs/providers/ghidra-dos.md).
For large binaries, raise the provider's startup deadline with
`REA_GHIDRA_STARTUP_TIMEOUT_MS` or `REA_HOPPER_STARTUP_TIMEOUT_MS`.
For provider selection, see the [CLI guide](docs/getting-started/cli.md#choose-a-provider).
Check [release availability](docs/getting-started/installation.md#released-package-and-main)
for features added since the latest npm release.

## Showcases

<a href="https://rea.tools/showcase/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/rea-showcases-dark.svg" />
    <img alt="Illustrations of the DX-Ball sound-pan, Notion clipboard-bridge, and TH04 bullet-ring showcases" src="docs/assets/rea-showcases.svg" />
  </picture>
</a>

### DX-Ball: reconstruct a sound-pan calculation

Follow a sound call into its position-to-pan helper, inspect the instructions,
and turn incomplete pseudocode into C. The reconstruction passes 3,205
original-x86 cases and reproduces all 63 compiled function bytes.

[Read the case study](https://rea.tools/showcase/dx-ball/) ·
[Reconstruction repository](https://github.com/N0zoM1z0/dx-ball)

### Notion: trace the Electron clipboard bridge

Find the renderer's clipboard API, follow it through preload and IPC into the
main process, and inspect the rich clipboard format.

[Read the case study](https://rea.tools/showcase/notion/)

### TH04: recover a DOS bullet-ring calculation

Inspect the original PC-98 game's 16-bit instructions, recover the fixed and
aimed angle calculations, and compare the reconstructed C++ with the
historical compiler output.

[Read the case study](https://rea.tools/showcase/th04/) ·
[Reconstruction repository](https://github.com/N0zoM1z0/th04)

### Build RL environments with REA

Record a web app session, turn its API into tools, and export an environment an AI agent can use. Run it with AgentEnv, then add tasks and reward checks for RL training or evaluation.

[Read the guide](https://rea.tools/guides/rl-environments/) ·
[Watch the video](https://x.com/reatools/status/2112574822584918075?s=20)

If you've used REA on something interesting, we'd love to see it. Share your
case in an [issue](https://github.com/morluto/rea/issues) or a
[pull request](https://github.com/morluto/rea/pulls), including the target,
your question, how REA helped, and what you found.

## Build RL environments

Give an AI agent a local environment to practice tasks such as finding an issue or creating a folder, without running the original app. Use it for reinforcement learning (RL) or to test how well an agent completes tasks.

REA turns recorded API requests and responses into tools the agent can call. The environment uses the recorded data and supports changes only when the recording confirms their effects.

With REA set up in your agent, replace the example URL and folder tasks below with your own:

```text
Use REA to build an RL environment from my test web app at
http://127.0.0.1:3000.
Cover listing, creating, renaming, and deleting folders. You may create and
remove test folders. Leave existing data unchanged.
Save it in a folder named my-env. Check which operations work and tell me
how to run it.
```

<details>
<summary>Use the command line instead</summary>

Use these commands if you already have a file containing the app’s recorded browser requests and responses. Running the result also requires AgentEnv and Docker.

```sh
rea environment-build ./session.har ./my-env --name my-env --json
agent-env run ./my-env
```

</details>

REA exports a runnable environment with a basic test to check that it starts and responds. Use it with your RL framework to define task goals, add reward checks, and run training.

[Build an environment](https://rea.tools/guides/rl-environments/) ·
[Environment reference](docs/agent-environments.md) ·
[Watch the demo on X](https://x.com/reatools/status/2112574822584918075?s=20)

### Desktop app environments

REA can also build an environment of a Linux desktop app, which an agent uses through screenshots, the mouse and the keyboard. From a one-line request, such as "Build me a Gnote environment where the agent adds olive oil to the shopping list note", your agent installs the app on a local build computer, writes the task, exports the environment and checks the task in a fresh computer. The machine that builds it needs Linux on amd64 or arm64, Docker and the agentenv framework version the guide pins.

[Set up desktop app environments](docs/desktop-build-computer.md)

## FAQ

<details>
<summary><strong>Which agents can use REA?</strong></summary>

Any agent that supports local MCP servers. Setup configures the
[supported agents](docs/getting-started/installation.md#supported-agents); other clients can use
[manual MCP registration](docs/getting-started/installation.md#mcp-registry).

</details>

<details>
<summary><strong>Do I need a native analysis engine?</strong></summary>

Deep native analysis uses Hopper, Ghidra, IDA or Kuna, depending on the target
and operation. Static JavaScript and .NET inspection work without a native
analysis engine. Setup can install Hopper after approval; Ghidra, IDA and Kuna
use your existing installations. See [provider setup](docs/getting-started/installation.md#hopper)
for the options and their supported targets.

</details>

<details>
<summary><strong>Do I need to start Hopper first?</strong></summary>

REA starts Hopper when an operation needs it. On macOS, a first-run dialog may
ask you to choose demo mode or activate your license. Complete that prompt in the
same user session before your first CLI/MCP operation or unattended job. Open
Hopper manually if needed. See
[Hopper startup and troubleshooting](docs/getting-started/installation.md#launcher-paths-and-troubleshooting).

</details>

<details>
<summary><strong>What does installing the skill from skills.sh do?</strong></summary>

The skill supplies investigation instructions for your agent. Use `npx rea-agents setup`
to register REA's MCP server and install the matching instructions, then restart
your agent. See [skill-only installation](docs/getting-started/installation.md#skill-only-installation).

</details>

<details>
<summary><strong>What code does REA return?</strong></summary>

Native analysis returns pseudocode and assembly. JavaScript/Electron analysis
recovers modules and their relationships. Your agent uses these findings to
write and test an implementation; the [showcases](#showcases) give worked examples.

</details>

<details>
<summary><strong>Does REA upload my app?</strong></summary>

REA analyzes targets locally. Your agent receives the tool results, and its
model provider has its own data policy.

</details>

<details>
<summary><strong>What should I do if I hit a bug?</strong></summary>

Update first; a recent release may already fix it.

For a CLI installed with `npm install --global` or `bun add --global`:

```bash
rea update
```

For agent setup through `npx`:

```bash
npx rea-agents@latest setup
```

If you're using an agent, complete the [setup refresh](#update-rea) and restart
it. Retry the same task. If the problem persists, [open an issue](https://github.com/morluto/rea/issues)
with your REA version, target type, steps to reproduce and error output.

</details>

## Documentation

Start with the website's [worked guides](https://rea.tools/guides/).
For exact options, prerequisites and result contracts:

- [Installation and setup](docs/getting-started/installation.md): agent registration, provider configuration, updates and uninstall.
- [Readiness and troubleshooting](docs/getting-started/installation.md#check-readiness-for-your-task): diagnose one agent or analysis engine.
- [CLI and Evidence](docs/getting-started/cli.md): commands, provider selection, snapshots, import/export and exit statuses.
- [MCP contracts](docs/reference/mcp-contracts.md) and [agent prompts](docs/getting-started/mcp-prompts.md): tool results, sessions and guided investigations.
- [Tool catalog](docs/reference/mcp-contracts.md#generated-catalog): generated inventory of tools, providers and CLI commands.
- [Roadmap](docs/development/roadmap.md): planned work and capability trackers.

Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Star history

🎉 **400,000 GitHub stars — thank you!**

Thanks to everyone using REA, reporting bugs, requesting features, testing builds, and contributing fixes.

<a href="https://www.star-history.com/?repos=morluto%2Frea&amp;type=date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
    <img alt="REA GitHub star history" src="https://api.star-history.com/chart?repos=morluto/rea&amp;type=date" />
  </picture>
</a>

## Disclaimer

See [DISCLAIMER.md](DISCLAIMER.md) for responsible-use guidance.

The project's position on illegal or unauthorized use covers all REA versions,
distribution channels, and platforms; each copy retains its applicable licenses.

REA is for lawful research, education, interoperability, software preservation,
and analysis of software you own or are authorized to examine.

## Contributing

We'd love your help with REA! [Open an issue](https://github.com/morluto/rea/issues) to
report a bug or suggest a feature, or [send a pull request](https://github.com/morluto/rea/pulls)
to improve the code or docs.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and checks,
[testing](docs/development/testing.md) for verification lanes, and the
[architecture map](docs/architecture/architecture.mermaid) for selected layers and dependency paths.

## License

[MIT](LICENSE)

REA-authored code is licensed under MIT. Third-party material retains its own
licenses and copyright notices; see
[Third-party notices](THIRD_PARTY_NOTICES.md) for the dependency inventory,
preserved license texts, and external-tool terms.

**You must legally obtain and be authorized to use commercial tools**, including
IDA Pro / Hex-Rays decompilers, Hopper, and JEB, under their applicable
licenses. REA grants no tool license, key, or activation entitlement. Trials and
demos remain subject to vendor terms, including user, feature, automation, and
output sharing restrictions. Cracked copies, stolen keys, unauthorized key
sharing, and bypassing license restrictions are not authorized. This guidance
does not amend MIT or third-party licenses.

<p align="center">
  <a href="https://awesome.re"><img src="https://awesome.re/badge.svg" alt="Awesome" /></a>
  <img src="https://img.shields.io/badge/frontieragent%20entries-18-blueviolet" alt="Entry count" />
  <img src="https://img.shields.io/badge/frontieragent-v0.1.0-informational" alt="Upstream version" />
  <img src="https://img.shields.io/github/last-commit/ZeroPointRepo/awesome-frontieragent" alt="Last commit" />
  <img src="https://img.shields.io/badge/status-unofficial-lightgrey" alt="Unofficial" />
  <img src="https://img.shields.io/badge/license-CC%20BY%204.0-lightgrey" alt="License" />
</p>

<!-- D8: this H1 is a searchable surface. The exact phrase people type goes FIRST, qualifiers after. -->
# FrontierAgent skills, plugins, and workflows

**Every way to extend FrontierAgent, with the manifest facts that matter: which surface it plugs into, what it declares, and which key it wants.**

---

## Contents

- [What is FrontierAgent?](#what-is-frontieragent)
- [FrontierAgent quickstart](#frontieragent-quickstart)
- [The catalog](#the-catalog)
- [Writing a FrontierAgent skill](#writing-a-frontieragent-skill)
- [Writing a FrontierAgent workflow plugin](#writing-a-frontieragent-workflow-plugin)
- [Good to know](#good-to-know)

- **Full catalog:** every verified FrontierAgent project (6) in [CATALOG.md](CATALOG.md)
- **Machine-readable:** the same rows as data in [catalog.csv](catalog.csv) and [plugins.json](plugins.json), a registry feed in [dsh-market](https://github.com/dsh-market/dsh-market)'s schema

---

## What is FrontierAgent?

[FrontierAgent](https://github.com/ApodexAI/FrontierAgent) is [Apodex AI](https://www.apodex.com/)'s
open-source agent runtime and terminal client, released 2026-08-22 under Apache 2.0 alongside the
Apodex-1.1 model. You get a command-line TUI with two workflows: **ReAct**, one stateful agent that
researches, reads files, writes deliverables and runs commands inside a task-scoped sandbox, and
**Agent Team**, a coordinator that keeps a task board, fans work out to parallel sub-agents, and
synthesizes their reports. The same engine runs the benchmark suite Apodex evaluates its models on.

Three surfaces let you add something of your own, and they are not equally open. The difference
matters before you spend a weekend on one:

| Surface | What you ship | Reaches the shipped terminal? |
|---|---|---|
| **Skills** | a `SKILL.md` directory under `plugins/skills/` | Yes, through a profile's `skills:` list |
| **Workflow plugins** | a Python package under `workflows/` exporting `register(ctx)` | Not selectable: `--mode` accepts `react` and `agent_team` only |
| **Tools** | nothing, from outside | No. The registry is a closed allowlist |

**Skills are the surface to build on.** No code, no fork, no Python: a directory, a Markdown file
with YAML frontmatter, and one line in a profile you own. FrontierAgent ships zero skills, so
everything here is somebody's own.

**Workflow plugins are real but half-wired.** The loader genuinely discovers any package you drop
in `workflows/` and calls its `register(ctx)`, and registration works. The terminal then refuses to
select it, because mode selection is checked against a hardcoded pair before the profile is read.
Today a workflow plugin is reachable from the evaluation kernel or from your own code embedding the
framework, not from `frontier-agent --mode`.

**Tools cannot be added from outside at all.** `plugins/tools/__init__.py` is a fixed import list
and the framework's own architecture guide says it plainly: adding a Python module under
`plugins/tools/` does not make it agent-accessible. A custom tool object still works when your own
code passes it to the agent loop directly, which is what a workflow plugin's node function can do.

## FrontierAgent quickstart

Install the runtime:

```bash
git clone https://github.com/ApodexAI/FrontierAgent.git && cd FrontierAgent && uv sync --python 3.12 --extra dev
```

Point it at any OpenAI-compatible endpoint by writing `.env`, then open the terminal:

```bash
uv run frontier-agent --mode react --cwd /path/to/project
```

Swap in the multi-agent coordinator when the task splits into independent parts:

```bash
uv run frontier-agent --mode agent_team --cwd /path/to/project
```

## ⭐ Featured skill

**[youtube-transcripts](https://github.com/ZeroPointRepo/transcriptapi-frontieragent-skill)** by
[ZeroPointRepo](https://github.com/ZeroPointRepo) lets an agent read video. Transcripts with
timestamps, video and channel search, and handle resolution, for when the claim you need is in a
conference talk rather than a paper. Needs `TRANSCRIPT_API_KEY`, free tier.

<details>
<summary>Install</summary>

```bash
git clone https://github.com/ZeroPointRepo/transcriptapi-frontieragent-skill.git plugins/skills/youtube-transcripts
```

</details>

## The catalog

### Skills

- **Read video: transcripts, search, and channel lookup** with [youtube-transcripts](https://github.com/ZeroPointRepo/transcriptapi-frontieragent-skill) by [ZeroPointRepo](https://github.com/ZeroPointRepo). Frontmatter parses, declares `bash` and `read_text`, ships a helper script. Needs `TRANSCRIPT_API_KEY`, free tier. MIT.

FrontierAgent bundles no skills of its own, and it opened on 2026-08-22, so this section starts
almost empty. If you have written one,
[open an issue](https://github.com/ZeroPointRepo/awesome-frontieragent/issues/new?template=add-entry.yml)
and it goes in.

### Workflow Plugins

- **Run one stateful agent that researches, edits files and iterates in a sandbox** with [stateful_react_agent](https://github.com/ApodexAI/FrontierAgent/tree/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/workflows/stateful_react_agent) by [Apodex AI](https://github.com/ApodexAI). Bundled. Registers `stateful-react-agent`, exports `register(ctx)` and a module-level `PipelineSpec`. Apache-2.0.
- **Split a task across parallel sub-agents behind a coordinator with a task board** with [agent_team](https://github.com/ApodexAI/FrontierAgent/tree/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/workflows/agent_team) by [Apodex AI](https://github.com/ApodexAI). Bundled. Registers `agent-team` and `agent-team-report`, plus main and sub agent roles. Apache-2.0.

Both shipped plugins are the vendor's own. No third-party workflow package exists yet.

### Distributions

- **Run a Chinese-language deep-research build with an evidence chain on every conclusion** with [deepresearch-community](https://github.com/dappweb/deepresearch-community) by [dappweb](https://github.com/dappweb). Downstream distribution from 元话 (metachina.ai), targets local and on-premise model endpoints. Apache-2.0.

### Official & Reference

- **The runtime, the terminal client, and the evaluation suite** with [FrontierAgent](https://github.com/ApodexAI/FrontierAgent) by [Apodex AI](https://github.com/ApodexAI). The upstream project. Apache-2.0.
- **Reproduce the deep-research benchmark numbers** with [AgentHarness](https://github.com/ApodexAI/AgentHarness) by [Apodex AI](https://github.com/ApodexAI). Evaluation harness for Apodex-1.0 on public benchmarks. Apache-2.0.
- **Read the method behind the model** with [the Apodex-1.1 tech report](https://arxiv.org/abs/2608.23283) by [Apodex AI](https://github.com/ApodexAI). arXiv:2608.23283.
- **Score a run against 41 verifiable deep-search queries** with [FrontierSearchBench](https://github.com/ApodexAI/FrontierAgent/tree/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/benchmarks/frontier_search_bench) by [Apodex AI](https://github.com/ApodexAI). Bundled benchmark with official scorers. Apache-2.0.
- **Pull the weights** with [the Apodex collection on Hugging Face](https://huggingface.co/apodex) by [Apodex AI](https://github.com/ApodexAI).
- **Skip model hosting entirely** with [the Apodex API platform](https://platform.apodex.ai) by [Apodex AI](https://github.com/ApodexAI). OpenAI-compatible endpoint, free trial at time of writing.
- **Ask the people building it** in [the Apodex AI Discord](https://discord.gg/TDJA59TCng) by [Apodex AI](https://github.com/ApodexAI).

### Guides & Install

- **Pick the right install path before you start** with [the installation chooser](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/install/README.md) by [Apodex AI](https://github.com/ApodexAI). Routes on where the model runs, not on your operating system.
- **Get the terminal open against a hosted endpoint** with [the endpoint quickstart](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/install/tui-endpoint-quickstart.md) by [Apodex AI](https://github.com/ApodexAI). No Docker, no local model. Also in [中文](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/install/tui-endpoint-quickstart.zh-CN.md).
- **Understand the runtime before you extend it** with [the framework architecture guide](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/framework.md) by [Apodex AI](https://github.com/ApodexAI). Pipeline specs, the observer contract, agent teams, and the sandbox model.
- **Author a workflow end to end** with [the workflow authoring guide](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/workflows.md) by [Apodex AI](https://github.com/ApodexAI). Agent definitions, pipeline specs, node functions, profiles, and the registration hook.
- **Drive the terminal properly** with [the TUI user guide](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/tui-user-guide.md) by [Apodex AI](https://github.com/ApodexAI). Approvals, `/revert`, steering, and session resume. Also in [中文](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/tui-user-guide.zh-CN.md).
- **Run it in Docker** with [the Docker and Compose guide](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/install/docker.md) by [Apodex AI](https://github.com/ApodexAI). Published amd64 and arm64 images, no local Python.
- **Serve the model on your own NVIDIA GPU** with [the Linux NVIDIA guide](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/install/linux-nvidia.md) by [Apodex AI](https://github.com/ApodexAI). SGLang in Docker, with a [no-nested-Docker variant](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/install/linux-nvidia-native.md) and a [GPU compatibility matrix](https://github.com/ApodexAI/FrontierAgent/blob/ce4dd2dc715d2c1d51f16c2d2d506f97686db27a/docs/install/gpu-compatibility.md).

## Writing a FrontierAgent skill

A skill is a directory holding a `SKILL.md` with YAML frontmatter. It is the only surface you can
extend from outside without touching the framework's code.

```bash
mkdir -p plugins/skills/my-skill
```

A minimal `SKILL.md`:

```yaml
---
name: my-skill
description: One sentence on what this does and when to reach for it.
version: 1.0.0
author: you
license: MIT
tags:
  - research
allowed-tools:
  - bash
  - read_text
---

# My skill

The workflow the agent should follow, written for the agent.
```

Enable it in a profile. The built-ins ship with `skills: []`, and a file at
`~/.apodex/profiles/react.yaml` overrides the built-in of the same name, so you never edit the
package:

```yaml
skills: ["*"]
```

Five things the loader does that the docs do not spell out, each of them a real trip hazard:

1. **The directory name is the skill id.** `name` in the frontmatter is only a display name. A
   profile allowlist and the enable/disable state both key on the directory.
2. **`read_text` must be in the role's tools.** The framework injects skill metadata into the
   system prompt and expects the model to open `SKILL.md` itself. Without `read_text` the model
   sees your skill listed and can never read it, which looks exactly like the skill being ignored.
3. **Descriptions are cut at 250 characters** in the injected block, and the whole block is capped
   around 8,000. Write a description that survives the cut, and put the detail in the body.
4. **Skills live in the install tree, not your home directory.** The path is
   `<FrontierAgent>/plugins/skills/`, resolved from the package location, with no environment
   override. The profile that enables them can live in `~/.apodex/`, but the skill itself cannot.
5. **Frontmatter failures are silent.** A `SKILL.md` whose YAML does not parse loads with empty
   metadata rather than raising, so a stray tab costs you `allowed-tools` and you get no warning.
   `tags` and `allowed-tools` must be YAML lists; a plain string is dropped.

Your key is your own business. FrontierAgent loads a repo-root `.env` into the process environment
at import and shell commands inherit it, so a variable you document in `SKILL.md` resolves inside
the commands you tell the agent to run. Nothing infers or validates your variable name, so say
plainly what happens when it is missing.

## Writing a FrontierAgent workflow plugin

A workflow plugin is a Python package under `workflows/` exporting `register(context)`. The loader
walks that directory, imports every child with an `__init__.py`, and calls `register` on each.

```python
def register(ctx):
    ctx.register_agent(AgentDefinition(
        role_id="my_role",
        display_name="My Role",
        allowed_tools=["read_file", "read_text"],
    ))
    ctx.register_pipeline(PipelineSpec(
        pipeline_id="my-workflow",
        name="My Workflow",
        entry_point="run",
        terminal_nodes=["run"],
        nodes=[...],
        transitions=[...],
    ))
```

Four things worth knowing before you commit to this surface:

1. **Read the reachability line in the table above first.** Registration succeeds and the terminal
   still will not offer your pipeline: `--mode` and `/mode` are both checked against a hardcoded
   pair of names before any profile is loaded. You reach a custom pipeline from the evaluation
   kernel or from your own embedding code.
2. **`register` cannot add a tool.** The context exposes pipeline, agent and topology registration
   and nothing else, and the tool map is built before plugins load. To give your nodes a tool of
   your own, build the tool object in the node function and hand it to the agent loop directly.
3. **Registration is validated and it fails quietly.** A malformed `AgentDefinition` is logged and
   skipped, and the run continues without your workflow. Watch the log the first time.
4. **Pipeline ids are claimed first-come.** Registering an id that already exists raises rather
   than overriding, so pick something specific.

## Good to know

<details>
<summary><strong>🛡️ Security notice</strong></summary>

This is a **curated list, not a security audit**. A listing means the project is real and working as
of its last check, not that its code has been reviewed for safety. Read a project before you install
it or hand it credentials, the same as you would any package or browser extension.

</details>

<details>
<summary><strong>🤝 Contributing</strong></summary>

PRs are very welcome, see [CONTRIBUTING.md](CONTRIBUTING.md) for the format and the acceptance
rules.

</details>

---

<p align="center">
Maintained by <a href="https://github.com/ZeroPointRepo">ZeroPointRepo</a> · list content licensed
<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · Built with <a href="https://crhq.ai">crhq.ai</a>
<br />
<sub>Unofficial, community-maintained. Not affiliated with or endorsed by the FrontierAgent project or
its maintainers.</sub>
</p>

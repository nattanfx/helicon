# PRD: Helicon v1 - Desktop + Web ADE for Muse Code CLI

> Herdado do [Helicon original](https://github.com/HarjjotSinghh/helicon), em inglês como recebido. É um rascunho de planejamento anterior ao fork; algumas afirmações estão superadas (ex.: existe CLI nativa no Windows, e este fork é Windows em português, sem suporte a terceiros).

> Status: draft · Scope: desktop + web together · Daemon: local-first, self-hosted remote supported · Approvals: configurable · Tests: deep modules

## Problem Statement

Muse Code is a terminal-only agent (`muse`, macOS/Linux, WSL2 on Windows). Developers who live in Codex-style and Claude-Code-desktop-style apps - sidebar of projects, resumable sessions/tasks, inline diffs, approval surfacing - have no equivalent for Muse. On Windows there is not even a native CLI; it only runs inside WSL2. Context lives in the terminal and is lost between sessions.

## Solution

Helicon: a sidebar-first desktop app (Tauri 2, Win/Mac/Linux) and web app sharing one React UI and one daemon design. The daemon spawns one `muse serve` host per workspace over the Muse Session Protocol (MSP) via the official MIT `@muse-code/sdk`. Users see projects grouped by working directory (including isolated worktrees), each with its sessions/tasks, resumable - including sessions started from the `muse` TUI. Windows routes through WSL2 with path translation. Auth stays the user's own `muse login`; Helicon never stores credentials and never bypasses approvals or billing.

## User Stories

### Projects & sidebar

1. As a developer, I want a sidebar listing all projects grouped by working directory, so that I can find every directory the agent worked in.
2. As a developer, I want worktree-isolated work to appear under its project with a worktree badge, so that parallel agent runs don't confuse me.
3. As a developer, I want to star/pin frequent projects, so that my daily repos stay on top.
4. As a developer, I want to search projects by path or name, so that I can jump in a large list.
5. As a developer, I want to open a project in my editor or file manager from the sidebar, so that I can inspect agent output directly.

### Sessions & tasks

6. As a developer, I want each project to show its sessions/tasks with titles and recency, so that I can resume work.
7. As a developer, I want to resume any past session for a workspace, including ones started from the `muse` terminal TUI, so that terminal and GUI stay interoperable.
8. As a developer, I want to start a new session in a chosen directory, so that greenfield work is explicit.
9. As a developer, I want to rename sessions, so that important threads are findable.
10. As a developer, I want to steer a running turn with a follow-up message, so that I can correct course without restarting.
11. As a developer, I want to interrupt a running turn, so that I can stop wasted work.
12. As a developer, I want queued follow-ups while the agent works, so that I can batch instructions.
13. As a developer, I want todo lists surfaced per session, so that long tasks stay legible.
14. As a developer, I want context-compaction events visible in the transcript, so that I know when history was summarized.

### Editor integration & diffs

15. As a developer, I want file edits shown as inline diffs with accept/reject, so that I can review before keeping changes.
16. As a developer, I want `@`-mentions for files (respecting `.gitignore` by default), so that I can ground prompts precisely.
17. As a developer, I want the active editor file/selection attached to prompts (toggleable), so that context follows my cursor.
18. As a developer, I want `!` shell commands runnable from the chat box, so that I can act without leaving the app.
19. As a developer, I want to create a worktree from the app for parallel tasks, so that my working copy stays clean.

### Approvals & safety

20. As a developer, I want approval prompts with allow/deny and policy amendment, so that risky tools always need my consent.
21. As a developer, I want the default approval mode to be configurable (on-request, prompt-unmatched, deny-unmatched), so that teams can match their risk posture.
22. As a developer, I want `allow-all` to require an explicit dangerous opt-in, so that it is never enabled by accident.
23. As a developer, I want all files saved before each prompt (toggleable autosave), so that agent edits never lose my unsaved work.
24. As a developer, I want a visible warning before using Contributor-tier models that training uses my prompts/outputs, so that I can choose Standard for sensitive code.

### Models & skills

25. As a developer, I want model and reasoning-effort selection per conversation, so that I can trade cost vs depth.
26. As a developer, I want `/` slash commands exposing project/user/plugin skills, so that repeatable workflows are one keystroke away.

### Windows / cross-platform

27. As a Windows developer, I want Helicon to detect missing WSL2/Ubuntu and guide setup, so that I am not stuck on install.
28. As a Windows developer, I want `muse serve` to run inside WSL2 transparently with path translation, so that the app feels native.
29. As a macOS/Linux developer, I want the CLI auto-detected on PATH and common install locations, so that onboarding is one login.

### Web mode

30. As a developer, I want the web app against a local daemon on my machine first, so that my code never leaves my box by default.
31. As a developer, I want to optionally point the web UI at a self-hosted remote daemon, so that I can reach home/lab machines.
32. As a developer, I want remote connections to fail closed without credentials in the URL, so that I cannot leak auth by sharing links.

### Auth & onboarding

33. As a new user, I want a checklist (CLI found → logged in → folder opened → first prompt), so that I succeed in under 10 minutes.
34. As a user, I want sign-in to happen via the official `muse login` flow only, so that Helicon never sees my credentials.

## Implementation Decisions

- **Modules (deep, tested in isolation):**
  - `Daemon` - owns one MSP host per workspace: connect, list/resume sessions, send/steer/queue/interrupt, approvals relay, worktree create, protocol-type regeneration on CLI upgrade. Interface: session/turn/approval events in, user actions out; stdio JSON-RPC hidden inside.
  - `State store` - local-first persistence of projects (cwd/worktree root) → sessions → turns; records terminal-originated sessions; never stores credentials. Interface: CRUD + search by path/text.
  - `WSL router` (Windows) - detects distro, spawns serve via the Linux side, translates Windows↔WSL paths, surfaces setup guidance. Interface: `serve(endpoint)` in, translated paths out; no-ops on macOS/Linux.
  - `UI shell` (thin) - shared React components (sidebar, session view, diffs, approvals, onboarding); desktop and web shells differ only in transport to the daemon.
- **Protocol:** MSP over `muse serve` stdio via `@muse-code/sdk`; regenerate wire types from `muse schema generate-ts` on CLI upgrades; support `muse` ≥ 1.0.3.
- **Approvals:** map 1:1 onto Muse modes; default is user-configurable; `allow-all` gated behind an explicit dangerous opt-in plus sandbox guidance.
- **Auth contract:** read-only use of the user's `muse login` credentials; key storage via OS credential store or env only; nothing in the state DB or logs.
- **Contributor transparency:** model picker labels Contributor vs Standard; one-time acknowledge dialog for Contributor data-use before first run.
- **Web transports:** local daemon preferred; remote daemon permitted with explicit host allow-list and no credential-in-URL; fail closed.
- **No TUI scraping:** terminal-interop happens through session resume over MSP, not keystroke injection.

## Testing Decisions

- A good test asserts external behavior (sessions listed, approvals gated, paths translated), not implementation details (exact RPC bytes, React tree shape).
- Tested: `Daemon` (connect/list/resume/steer/interrupt/approval relay against recorded MSP transcripts), `State store` (grouping by directory, TUI-session import, search), `WSL router` (path translation matrix, missing-distro guidance, no-op off Windows).
- Prior art: SDK repo conformance transcripts for MSP; community VS Code wrapper behaviors (resume, approval modes) as acceptance references.
- UI shell: untested except approval/diff accept-reject flows via end-to-end smoke on all three OSes (Windows via WSL2).

## Out of Scope

- Mobile apps in v1 (planned later: a relay to monitor and steer running sessions from a phone); native IDE plugins; hosted multi-user cloud with shared billing.
- Credential hosting, key resale, or any billing/auth bypass.
- Training or fine-tuning models; telemetry beyond local opt-in crash reports.
- Non-Muse providers (single-provider v1 keeps MSP semantics honest).

## Further Notes

- Name `Helicon` avoids the `Muse` mark. Keep the "Not affiliated with Meta" note in README and docs; app UI stays unbranded. Attorney review still pending before first public launch.
- Repo default branch is `prod`; either keep or migrate to `main` before first tag.
- Revisit `allow-all` posture and remote-daemon hardening at a security review before any release.
- Releases: every release gets a git tag plus a GitHub Release with downloadable desktop binaries. Windows is the primary target, with macOS and Linux supported from day one.
- Versioning: semver. Merged PRs with considerable work bump at least the patch version, never major for routine work.

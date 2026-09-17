# Changelog

## 0.12.4

### Fixed

- **A failed turn's red banner no longer sticks around** ([#22](https://github.com/HarjjotSinghh/helicon/issues/22)). The banner has a close button, and a closed or retried banner stays closed when the thread reloads; before, reopening the thread or restarting the app brought it back. Once the conversation moves past a failed turn, the failure shows as a small "Failed · reason" note in the history instead of a full banner with no way to act on it.

## 0.12.3

### Changed

- **Ultra is gone from the effort picker.** Checked against a real `muse serve` 1.3.0: picking Ultra sends `max` to the model, so it was Max under another name, and the Muse CLI no longer offers it either. Max is now the top of the scale. A thread or setting left on Ultra carries on as Max, and `/effort ultra` still works and means Max.

## 0.12.2

### Fixed

- **Links open in your browser.** Clicking a link in a reply, like a pull request Muse mentions, did nothing in the desktop app. Web and mail links now open in the default browser or mail app, and a link can no longer navigate the Helicon window away. File links still open in the file viewer.

## 0.12.1

### Fixed

- **macOS stops asking for folder access over and over.** The app bundle was not properly signed, so macOS could not remember an Allow and asked again for every project, once for each process Helicon runs. The whole app is now signed as one, so a protected location like Documents asks once. Builds are not yet signed with an Apple Developer ID, so expect one prompt per location again after each update.

### New

- **Close the plan, goal and background-task cards.** Each card above the composer has a close button. A closed card stays hidden in that thread; while one has something to show, a button in the thread's top bar brings it back.

## 0.12.0

### New

- **Muse for Windows, no WSL.** Muse Code now runs natively on Windows, and Helicon runs it that way. When Muse for Windows is installed (`irm https://dev.meta.ai/install.ps1 | iex` in PowerShell), Helicon runs it directly with your Windows paths, runs `!` commands in PowerShell, and never starts WSL. Muse inside WSL2 keeps working: Helicon uses it when native Muse is not installed, and `HELICON_MUSE_RUNTIME=wsl` (or `--runtime wsl` for the web server) keeps WSL when both are. Threads started in WSL live with WSL's Muse, so they stay there. Setup, the sidebar status and Settings show which one is in use.
- **A file viewer beside the thread.** The folder button in the thread's top bar, or Cmd/Ctrl+Shift+E, opens the project's files on the right: a tree you can search by name, tabs, and a resizable panel.
  - Source files show with syntax highlighting and line numbers, and a link to a line range scrolls to and marks it.
  - Markdown opens as a rendered preview, with a toggle to its source, which you can edit and save (Cmd/Ctrl+S). If the file changed on disk since you opened it, Helicon asks before overwriting.
  - Images, video, audio and PDFs preview in place; anything else opens in its default app.
  - File paths Muse mentions in a reply, the files on read, edit and write tool rows, and the changed-file chips under a turn all open in the viewer. A file Muse edits reloads while it is open.
  - The viewer reads and writes only inside the project folder, and serves files so that a page in the project cannot run inside Helicon.

## 0.11.1

### Fixed

- **Dragging a project to reorder the sidebar works again.** The drop marker showed where a project would land, but letting go left the order unchanged, in the desktop app and in the browser alike. The drop handler was reading which project was being dragged from state captured before the drag began, when nothing was.

## 0.11.0

Built on the Muse Session Protocol methods that shipped with Muse Code 1.3.0, each checked against a real `muse serve` host.

### New

- **Plan usage.** The 5-hour window and the weekly cap, as Muse reports them with each model call, with when each resets. A small meter sits in the sidebar footer and a full card leads the usage page. This is your actual allowance, not the API-rate estimate the rest of the usage page shows. (`usage/read`, `usage/changed`)
- **Goal controls.** `/goal <objective>` now sets the goal through Muse's own goal command, which starts work on it straight away. `/goal pause`, `/goal resume` and `/goal clear` work from the composer, and the goal panel has Pause, Resume and Clear. Hosts without the goal commands keep the old behaviour. (`goal/set`, `edit`, `pause`, `resume`, `clear`)
- **Background tasks.** A running tool call can be sent to the background and keeps running while Muse moves on; one running there can be stopped, and a bar above the composer stops every background task in the thread at once. (`task/background`, `task/stop`, `task/stopAll`)
- **Workflow controls.** Cancel a running workflow, and skip or retry one of its agents from the workflow details sheet. (`workflow/cancel`, `workflow/childControl`)
- **Subagent controls.** Message a running subagent, give a finished one a follow-up task, stop, pause, resume, reopen or close it. These appear on subagents that carry a subagent id; Muse Code 1.3.0 does not report one yet (meta-models/muse-code-sdk#13), so they light up once it does. (`subagent/*`)
- **Full tool output.** Output Muse trimmed in the view gets a "Show full output" button that reads the stored log a page at a time. (`item/readOutput`)

### Fixed

- **Reasoning effort now takes effect.** Muse Code 1.3.0 accepts the effort sent with each turn and then drops it before the model call (meta-models/muse-code-sdk#6). Helicon now also sets it as the session's standing default, which Muse does apply, and the effort picker updates the open thread immediately.

### Changed

- **Skills come from the session.** With a thread open, the slash menu lists the skills Muse itself resolves for that session, and refreshes when Muse says they changed; the `muse skills list` CLI call remains for new threads and for reading a skill's instructions. Skills that declare an argument hint show it. (`skill/list`, `skill/changed`)
- **Renames reach Muse.** Renaming a thread renames the Muse session too, so the CLI and `/name` addressing see the same name, and a rename made in another Muse client shows up here. (`session/rename`, `session/nameChanged`)

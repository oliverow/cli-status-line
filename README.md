# cli-status-line

A Claude Code mod that draws the CLI status line as a colored band above the prompt in the desktop app, which has no status line of its own. It is a TypeScript port of the author's `statusline-command.sh`, so it shows that layout, not whatever status line you have configured.

Built with Claude Code 2.1.288.

## What it shows

From left to right, separated by `|`:

- **📥** when `~/.claude` is behind its remote. The mod runs `git fetch` there when the session starts and every 10 minutes.
- **Folder name** of the session's working directory, in blue.
- **Git:** the branch, commits ahead (`↑`) and behind (`↓`) its upstream as of the last fetch, and counts of staged (`+`), modified (`~`) and untracked (`?`) files.
- **Model, effort and context %.** The context % turns yellow at 70% and red at 90%. Effort appears after the first reply of the session.
- **Prompt cache time left:** an estimate, 1 hour after the last reply of the main conversation (`CACHE_TTL_MS` in `hooks/register.tsx`). Yellow in the last 5 minutes, `cache cold` once it has passed.
- **GPUs**, on machines with `nvidia-smi`: each GPU's index, green when free, red when one of your processes uses it, gray when another user's process uses it or more than 1 GiB of its memory is taken. `nvidia-smi` can hang for good when the driver is wedged, so at most one query runs at a time; while the last reading is more than two minutes old the part shows `gpu:?`.
- **Session time and cost.**

When the session runs on a Mac, an **Open in VS Code** button at the end opens the session's folder in `Visual Studio Code - Insiders` (`EDITOR_APP` in `hooks/register.tsx`; set it to `Visual Studio Code` for the stable release), with macOS `open -a`.

The band refreshes every minute and after each reply. It is drawn only in the desktop app; the terminal shows the real status line. In a remote SSH session from the desktop app, Claude Code runs on the remote machine, so the mod must be installed there.

## What it runs

- `git symbolic-ref`, `git rev-list` and `git status --porcelain` in the session's working directory and in `~/.claude`.
- `git fetch -q` in `~/.claude`, with prompts and interactive SSH turned off.
- `uname` and `command -v nvidia-smi` once when the session starts.
- `nvidia-smi --query-compute-apps` and `--query-gpu`, and `ps` on the PIDs using a GPU, every minute where `nvidia-smi` exists.
- `open -a <editor> <folder>` when you press the button.

Nothing is sent anywhere.

## Install

```bash
claude plugin marketplace add oliverow/cli-status-line
```

```bash
claude plugin install cli-status-line@cli-status-line
```

To try it for one session from a clone:

```bash
claude --plugin-dir ./cli-status-line
```

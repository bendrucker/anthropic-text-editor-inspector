---
name: run-app
description: Start this app's dev server, drive it in a real browser, and run the repo's verification commands. Use when running, screenshotting, or QAing the app, confirming a change works in the running UI, driving a live API run, or measuring rendered styles such as color contrast. Covers the sandbox, port, browser-session, and worktree failures that look like something else.
---

# Running and verifying this app

## Verification commands

| Command | Checks |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run roundtrip` | Markdown serializer is a fixed point, and lead prompts resolve to the inline path. Fails on content drift, not just code changes. |
| `bun run conversation` | Conversation fixtures |

## Fresh worktree

- `bun install --frozen-lockfile`.
- `.env.local` is gitignored and is **not** copied into a new worktree. If it is missing, copy it from the primary checkout. Without it the app asks for a pasted key.
- Confirm the base is current: `git merge-base --is-ancestor origin/main HEAD`. `wt switch --create <name> -y` cuts from *local* `main`, even when the same invocation fetched.
- Subagents: do not invoke the `worktrunk:wt-switch-create` skill. It re-roots the shared session's working directory and breaks the parent.

## Dev server

Start it with **`dangerouslyDisableSandbox: true`** and `run_in_background: true`:

```
bun run dev --port <port> --strictPort
```

- Pick a port yourself. Many dev servers run concurrently here.
- `--strictPort` is required. Without it vite silently takes the next free port and you drive the wrong app.
- Confirm the port serves *your* checkout before measuring anything. See [Wrong checkout and stale probes](#wrong-checkout-and-stale-probes).

| Symptom | Cause | Fix |
| --- | --- | --- |
| App shows 502 from `/anthropic`; server log has `getaddrinfo ENOTFOUND api.anthropic.com` | Server started inside the Bash sandbox. The host is allowlisted, so this reads as a network outage, not a restriction. | Restart with `dangerouslyDisableSandbox: true`. |
| `--strictPort` exits, port in use | Often your own earlier vite, left alive by a `pkill` that did not match | `lsof -ti tcp:<port>`, kill that pid, retry |

## Wrong checkout and stale probes

A dev server serves the checkout it started in, and many of them run here at once across several checkouts. That includes the primary repo, and worktrees that `wt remove` has since trashed. A request to a port belonging to someone else's checkout succeeds and returns a plausible page. The measurement then describes code that is not yours, which is what makes this expensive.

Confirming the port number is not enough, because two checkouts answer the same URL with different source. Plant a token nothing else can produce, then read the served source back:

```
printf '\n// probe-%s\n' "$(git rev-parse --short HEAD)" >> lib/paint.ts
curl -s http://localhost:<port>/lib/paint.ts | grep -c 'probe-'
```

Plant one rather than grepping a value already in the source. A distinctive-looking string can be identical in the checkout next door, so it returns a match that proves nothing.

Plant in a module you are not editing. The probe only has to prove which checkout is serving, so any served module works, and cleanup is then a plain `git checkout lib/paint.ts`.

When no untouched module is served, plant in the file under test instead and delete just the planted line, not the whole file: `git checkout` would discard your edits along with the token.

```
sed -i '' '/probe-/d' lib/paint.ts
```

A discriminator on a *rendered* value can pass while the source belongs to another checkout. Grid tracks measured at 509.64 and then 491 across a viewport change read as responsive, and neither number came from the build under test. Served source cannot move like that.

`lsof -a -p <pid> -d cwd` names the checkout a stray server is serving. Vite's watcher itself works: an edit to a file the server is watching writes an `hmr update` line to the dev log, so an edit that writes no such line points at the same problem.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Measurement describes code you replaced | The port belongs to another checkout | `curl` the module, then `lsof` the pid |
| No `hmr update` line for a file you just edited | Same | Same |
| A server whose cwd is under `.git/wt/trash/` | The server outlived the worktree `wt remove` trashed | Kill it |
| Edits to `--init-script` have no effect | `agent-browser open` does not re-inject the script on a URL the session already holds | Open under a new session name |
| `agent-browser eval` refused before it runs | A Bash hook matches on the word | An `--init-script` that rescans on a timer and writes JSON into a hidden element, read back with a plain selector |

## API key

`ANTHROPIC_API_KEY` in `.env.local` is injected by the dev-server proxy. The bundle receives only a boolean saying a key exists. Live runs need no key of your own and no paste into the UI.

## Browser (agent-browser)

`agent-browser session id --scope worktree` derives the id from the process cwd, and the Bash tool's cwd resets to the primary repo between calls. Agents in different worktrees therefore compute the same id and share one tab — the tab silently follows whichever agent drove it last.

Compute the id **once** with an explicit `--prefix`, persist it, and re-export the literal on every call:

```
agent-browser session id --scope worktree --prefix <branch> > tmp/browser-session
export AGENT_BROWSER_SESSION="$(cat /abs/path/to/tmp/browser-session)"
```

Before trusting any snapshot, run `agent-browser get url` and confirm the port is yours.

Close only your own session: `agent-browser close --session <id>`. `agent-browser close --all` closes every agent's session, including ones still working.

## Measuring rendered color

Tailwind v4 emits `oklch()`, and `getComputedStyle(el).color` returns that string unchanged. A script parsing it with an `rgb()` regex matches nothing and reports a near-zero failure count for the whole app. This is how Tailwind v4 works, not a bug to wait out.

Read sRGB by rasterizing instead: assign the computed string to `ctx.fillStyle` on a 1×1 canvas, `fillRect`, and read `getImageData`. For the background, walk ancestors converting each `backgroundColor` the same way until one is opaque, compositing by alpha.

## Removing this skill

| Section | Removable when | Where that shows |
| --- | --- | --- |
| Dev server sandbox | Sandboxed Bash resolves allowlisted hosts for spawned servers | A sandboxed `bun run dev` completes a live run with no `ENOTFOUND` |
| Wrong checkout | Never while several agents run servers on one machine. | — |
| `--init-script`, `eval` | `agent-browser open` re-injects an edited script, and the hook stops matching on `eval` | A second `open` under the same session name picks up an edited script |
| Browser session pinning | `agent-browser session id` stops keying on process cwd, or the Bash cwd stops resetting | Two agents in different worktrees compute different ids |
| `.env.local`, stale base | Worktree creation copies gitignored env files and cuts from the fetched remote head | A fresh `wt switch --create` worktree has `.env.local` and passes the `merge-base` check |
| `oklch()` | Never. It is a property of Tailwind v4's output. | — |
| Verification commands, ports, API key | Never. Project facts. | — |

The stale-base and subagent-reroot lines belong in `worktrunk:wt-switch-create`. Delete them here if they land there.

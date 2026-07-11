# Claude Code from your phone — without the VS Code SSH tunnel

Access and steer your Claude Code sessions on a remote "brain server" from a
mobile browser or the Claude app, **including your existing chat history**,
without VNC and without keeping a VS Code funnel open in the foreground.

This uses Claude Code's built-in **Remote Control**: your session runs on the
server and speaks outbound HTTPS to Anthropic; you attach to it from the
[Claude app](https://claude.ai/code) or any browser. No open ports, no tunnel.

## The key insight

- `claude remote-control` (server mode) only starts **new** sessions.
- To reach a **prior chat**, resume it locally first, *then* turn on Remote
  Control — the conversation history carries over.

## Quick start (manual)

```bash
ssh user@brain-server
cd /path/to/project          # the dir where the old session ran

claude --resume              # pick your past chat from the list
# inside the resumed session:
/remote-control              # (or /rc) — prints a URL + QR code
```

Then on your phone: scan the QR or open the session at claude.ai/code / the
Claude app. You now steer the existing conversation from mobile; it keeps
running if you close the browser.

Requirements: Claude Code CLI ≥ 2.1.51, logged in via `claude /login` (not an
API key). Check with `claude --version`.

## One-step helper: `rc`

Source [`rc.sh`](./rc.sh) from your `~/.bashrc` / `~/.zshrc` on the server:

```bash
source ~/path/to/rc.sh
```

Then:

```bash
rc            # session picker + Remote Control in one go
rc <id/name>  # resume a specific prior session + Remote Control
rc-list       # list past session transcripts for the current directory
```

## Always-on: systemd user service

For a durable, phone-reachable session that survives reboots, use
[`claude-remote-control.service`](./claude-remote-control.service). See the
install notes at the top of that file. Caveat: server mode resumes the most
recent *Remote Control* session (`--continue`), not an arbitrary old chat —
for old chats use the `rc` helper interactively.

## Where your sessions live

Transcripts are stored as JSONL under:

```
~/.claude/projects/<slugified-working-dir>/<session-id>.jsonl
```

Default retention is 30 days (`cleanupPeriodDays` in `~/.claude/settings.json`).
Export a readable copy from inside a session with `/export <file>`.

## Docs

- Remote Control: https://code.claude.com/docs/en/remote-control
- Managing sessions: https://code.claude.com/docs/en/sessions
- Claude Code on the web: https://code.claude.com/docs/en/claude-code-on-the-web

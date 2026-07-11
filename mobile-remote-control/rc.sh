# Claude Code Remote Control – shell helper
#
# Source this from your ~/.bashrc or ~/.zshrc on the "brain server":
#
#     source ~/path/to/rc.sh
#
# Then, from any directory that has prior Claude Code sessions:
#
#     rc            # opens the session picker, then enables Remote Control
#     rc <id/name>  # resumes a specific prior session, then enables Remote Control
#
# The resumed conversation history is carried over, so you get your
# existing chat – steerable from your phone (Claude app / claude.ai/code).
#
# Requires: Claude Code CLI >= 2.1.51, logged in via `claude /login`.

rc() {
  # Resume a prior local session and turn on Remote Control in one step.
  # `--resume` with no arg opens the interactive picker of past chats in $PWD.
  claude --resume "$@" --remote-control
}

# Convenience: list past sessions for the current directory without resuming.
# (Session transcripts live under ~/.claude/projects/<slugified-cwd>/*.jsonl)
rc-list() {
  local slug
  slug="$(pwd | sed 's/[^a-zA-Z0-9]/-/g')"
  local dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/${slug}"
  if [ -d "$dir" ]; then
    ls -1t "$dir"/*.jsonl 2>/dev/null || echo "No sessions found in $dir"
  else
    echo "No session directory for this path: $dir"
  fi
}

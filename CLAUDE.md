# CLAUDE.md

The shared instructions for all coding agents in this repo are in AGENTS.md (ChatGPT/Codex reads
that file directly). Edit AGENTS.md, not this file, so both tools follow the same rules.

@AGENTS.md

## Claude Code specifics

- The Bash tool runs Git Bash on Windows; PowerShell is also available. Use absolute or repo-relative
  paths, and put scratch files in the session scratchpad, not the repo.
- Run long-lived servers (scan server, Vite) as background tasks and stop them with TaskStop when
  done; don't leave them running between turns.

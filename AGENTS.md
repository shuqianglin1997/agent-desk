# AgentDesk workspace instructions

## Personal Agent Mesh development gate

- Any task involving devices, P2P links, remote control, cross-device session discovery, session transfer, or distributed Agent workflows must read `docs/PERSONAL_AGENT_MESH_PLAN.md` completely before planning or editing code.
- After any conversation/context compaction, handoff, resumed task, or long interruption, read that document again from beginning to end before the next implementation action. A conversation summary is not a substitute.
- The plan front matter is the implementation authority. Version 0.5 was owner-approved on 2026-08-10; implementation may proceed phase by phase while that approved status remains in force. Stop implementation whenever the plan returns to `DRAFT FOR OWNER REVIEW`.
- Preserve the existing fixed main-window skeleton and the single `复制会话信息` contract unless the owner explicitly approves a documented change.
- Update the plan's decision log when an approved decision changes the baseline.

## Durable GitHub authentication and push continuity

- The owner has already established that `shuqianglin1997/Skills` is their repository and has explicitly authorized AgentDesk development pushes. Do not repeatedly question repository ownership.
- Before starting any new GitHub verification flow, inspect and reuse the previously successful Git transport, credential helper, GitHub CLI login, SSH agent, or repository-specific key.
- Never leave a successful push dependent on a temporary GitHub CLI directory or an in-memory credential. Persist the working authentication in the macOS Keychain or a repository-scoped SSH key, then verify it with a non-mutating remote check before ending the task.
- If persistent authentication is genuinely absent or expired, state the exact missing mechanism once and restore a durable path. Do not send the owner through repeated email/device verification as the default response on later pushes.
- Never report a push as complete until the intended remote branch ref has been read back and matches the local commit.

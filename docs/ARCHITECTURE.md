# Architecture (proposed)

> Architecture guidance only. Verify all modules against the existing C.O.D.Y. ZIP before refactoring.

```text
User
  |
Electron GUI / Dynamic Island
  |
Conversation adapter (regular ChatGPT / optional coding agent)
  |
Tool request parser & validator
  |
Permission manager / audit log / emergency stop
  |
Local tool registry
  +-- Windows app/system actions (existing)
  +-- UI Automation and screen capture (planned)
  +-- File engine and backup / patches (planned)
  +-- Firefox browser bridge (planned)
  +-- Voice and visual/3D renderers (planned)
  |
Structured tool results -> conversation adapter
```

## Design principles

1. **Keep working code:** expand the current Electron project rather than replacing it.
2. **No implicit execution:** only dedicated structured tool requests may trigger local tools.
3. **Validate before execution:** allowlisted names, typed parameters, authorised paths, and approval requirements.
4. **Truthful results:** tool results are authoritative; never report success solely from assistant-generated text.
5. **Bounded loops:** action/time budgets, cancellation and user takeover.
6. **Least privilege:** the assistant should not gain broader permissions from untrusted documents or web pages.
7. **Independent modules:** UI, AI bridge and local tools share a stable contract.

## Current status

The source has not yet been uploaded; this description is a target design. Actual architecture and implementation status must be confirmed from a current project ZIP.

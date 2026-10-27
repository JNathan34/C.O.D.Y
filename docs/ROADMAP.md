# C.O.D.Y. Roadmap

This is a plan, not an implementation status report.

## Phase 1 — Reliable foundations
- Stabilise existing ChatGPT conversation flow and streaming in Electron.
- Define a versioned request/result contract for local tools.
- Preserve the existing working app launch and volume control.
- Implement permission prompts, logging and cancellation.

## Phase 2 — Windows and file tools
- Safe file listing, reading, backup, patching, writing and restoration.
- Windows UI Automation to discover and interact with accessible controls.
- Observe → decide → act → verify loop, with bounded action count.
- Local build/test tools only with explicit permission and confinement.

## Phase 3 — Browser and voice
- Firefox extension bridge integration, with connection state and permission boundaries.
- Speech-to-text, text-to-speech and Dynamic Island state synchronisation.
- Screenshot vision only when the model/bridge supports image inputs.

## Phase 4 — Visual interaction
- Transparent Windows annotation overlay.
- Animated arrows, highlights, labels and interactive explanations.
- Three.js-based stateful models that can be edited rather than regenerated.

## Phase 5 — Polish and release
- Automated tests, crash reporting without secrets, reproducible packaging.
- Dependency audits, licences, docs and optional signed installer.
- Public release only after security review and explicit approval.

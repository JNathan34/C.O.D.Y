# C.O.D.Y.

**C.O.D.Y.** is an in-development Windows desktop AI assistant combining a custom Electron interface, conversational AI, and permission-controlled computer automation.

> **Status:** Early development. This repository is being prepared for the source code. Features below include ideas and roadmap items, not a claim that they are all implemented.

## Vision

C.O.D.Y. aims to provide one assistant that can converse naturally, understand user-approved screen content, and request validated actions from local Windows tools. The regular ChatGPT experience is the default conversational controller; a dedicated coding agent can be used for tasks that benefit from it.

## Capabilities

**Previously demonstrated in the local prototype (not yet uploaded here):**
- Basic application launching, such as opening Notepad.
- Basic Windows controls, such as changing audio volume.
- An Electron-based user interface and experimental ChatGPT integration.

**Planned / in development:**
- Reliable chat sessions, streaming responses and conversation history.
- Structured multi-step tool execution with actual result feedback.
- Safe file reading, editing, patching and backup/restore.
- Windows UI Automation with optional screenshot-based understanding.
- Firefox browser control via an independently installed browser integration.
- Voice input, spoken responses and an animated Dynamic Island.
- On-screen annotations and editable, interactive 3D models.

See [Roadmap](docs/ROADMAP.md) and [Architecture](docs/ARCHITECTURE.md).

## Project organisation

Development currently happens across separate Core AI, GUI, and Research conversations. Releases have been assembled and tested locally as ZIP files; source-code publication will be introduced gradually.

- [Development workflow and handoffs](docs/WORKFLOW.md)
- [Tool protocol and security approach](docs/TOOL_PROTOCOL.md)
- [Security guidance](SECURITY.md)

## Getting started

Application source code and reproducible build instructions have **not yet been published**. Do not assume this repository already contains an installable C.O.D.Y. release.

## Licensing and credits

No general project licence has been selected yet. Public visibility does not itself grant reuse rights. Any future reused open-source components must retain their required notices, and proprietary HeyClicky application assets/code should not be committed without appropriate permission.

This project is an independent experiment, not an official OpenAI or HeyClicky product.

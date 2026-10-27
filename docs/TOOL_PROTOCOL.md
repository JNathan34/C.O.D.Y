# Structured tool protocol (design draft)

C.O.D.Y.'s current ChatGPT bridge may not expose native tool calling. If it does not, use a dedicated machine-readable message channel or strictly validated action envelope—not loose regex matching inside normal prose.

Example request:

```json
{
  "protocolVersion": 1,
  "requestId": "req-001",
  "tool": "app.open",
  "args": {"app": "notepad"}
}
```

Example local result:

```json
{
  "protocolVersion": 1,
  "requestId": "req-001",
  "status": "success",
  "result": {"app": "notepad", "launched": true}
}
```

## Required checks

- Reject unknown protocol versions, tools or argument shapes.
- Require exact request IDs and deduplicate repeats.
- Allow only approved applications and authorised filesystem roots.
- Check the operation's permission tier and prompt before sensitive changes.
- Use per-step timeout and total action budget.
- Treat screen contents, web pages and file contents as untrusted data.
- Return real failures for denied, unsupported and timed-out requests.
- Do not expose arbitrary shell execution through an open-ended AI text field.

## Initial tools

Start with existing `app.open` and volume commands; then add `file.list`, `file.read`, `file.patch`, `file.backup`, `desktop.inspect` and `desktop.click` in testable increments.

The envelope above is a **proposal**, not a confirmed description of the existing implementation.

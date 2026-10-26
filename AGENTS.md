# infisical

## Linear issue IDs (branches & PRs)

- **Backlog:** Linear is the system of record. Do not open new GitHub issues for planning or tracking.
- **Default team:** The Overseer (`OVR`) for work in this repository.
- **Branches:** `<LINEAR-ID>-short-kebab-desc` (Linear “copy git branch name”), e.g. `OVR-458-enable-web-search`.
- **Pull requests:** Title `[<LINEAR-ID>] …`; body includes `Fixes <LINEAR-ID>` (or `Part of <LINEAR-ID>` for partial work).
- **No issue yet:** Create a Linear issue in the matching team first, or ask the operator for one before branching.

## Shared rules (OVR-561)

- The single source of shared bot and agent rules is `/home/box/bot-context/hard-rules.md`, which lives on Garrett's Grok Bot box. Only Garrett changes it. Cloud agents can't see the box, so they follow this mirror and the Linear issue they were given.
- Never print or commit secrets. All keys live in Infisical.

## Linear workflow
- Linear is the staging area for code work that comes from Linear, Lead Engineer, or the Grok bots. When a task links a Linear issue, read it first and work from it.
- Manual work Garrett starts directly in Cursor does not need a Linear issue. Only create one if he asks.
- When an issue exists:
  - Branch name starts with the issue ID: `OVR-123-short-desc`.
  - PR title starts with the ID: `[OVR-123] Short description`. PR body includes `Fixes OVR-123` for each issue it finishes.
  - Direct pushes to main start the commit message with the ID: `OVR-123: short description`.
  - When finished, comment on the issue with the merged PR link or commit SHA plus one line on what shipped, and make sure it's Done.
  - Partly done or blocked: comment the state and next step, leave it open. Never write "done" in the description and leave it open.
- Any issue you create gets a label and a priority and is assigned to Garrett. Never assign or delegate to Cursor's Linear integration.

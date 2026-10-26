# infisical

## Linear issue IDs (branches & PRs)

- **Backlog:** Linear is the system of record. Do not open new GitHub issues for planning or tracking.
- **Default team:** The Overseer (`OVR`) for work in this repository.
- **Branches:** `<LINEAR-ID>-short-kebab-desc` (Linear “copy git branch name”), e.g. `OVR-458-enable-web-search`.
- **Pull requests:** Title `[<LINEAR-ID>] …`; body includes `Fixes <LINEAR-ID>` (or `Part of <LINEAR-ID>` for partial work).
- **No issue yet:** Create a Linear issue in the matching team first, or ask the operator for one before branching.

## Shared rules (OVR-561)

- The single source of shared bot and agent rules is `/home/box/bot-context/hard-rules.md`, which lives on Garrett's Grok Bot box. Only Garrett changes it. Cloud agents can't see the box, so they follow this mirror and the Linear issue they were given.
- Put the Linear ID in the branch name (`<ID>-short-desc`) and in the PR title (`[<ID>] ...`), so a merge auto-closes the issue.
- When the work is finished, mark the Linear issue Done with a proof link (PR, deploy or verification).
- Never print or commit secrets. All keys live in Infisical.

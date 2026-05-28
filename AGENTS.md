# Agent Instructions

This repo is a voice cooking companion kit: server, static recipe UI, and ESP32-S3 hardware materials.

## Collaboration Rules

- Review and brainstorm with the user before starting each planned PR group.
- Keep changes scoped to the approved PR group.
- For future work, confirm scope with the user before making broad architecture or product-direction changes.

## Security and Privacy

- Never write secrets, API keys, access tokens, private URLs, personal deployment details, real user data, or other sensitive information into source files, docs, tests, fixtures, logs, commits, or GitHub replies.
- Use placeholders in examples, such as `API_TOKEN`, `OPENAI_API_KEY`, or `https://example.com`.
- Keep uploaded audio and generated speech temporary unless the user explicitly approves a different retention model.
- Avoid logging raw uploaded audio. Transcript logging must be short, configurable, and documented.

## Required PR Review Workflow

When handling GitHub PR review feedback, follow:

- [docs/pr-review-workflow.md](./docs/pr-review-workflow.md)

In particular:

- fetch unresolved review threads before editing
- summarize actionable comments before making changes
- validate comments against the code
- ask before staging, committing, pushing, commenting on GitHub, or resolving threads

## Implementation Notes

- The canonical device API is `POST /query-audio`.
- Do not add `/app/*` compatibility routes unless the user explicitly reverses that decision.
- The root path `/` should serve the static web UI.
- Any endpoint that uses the OpenAI API should require `API_TOKEN` when token protection is configured.

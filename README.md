# Voice Cooking Companion Kit

A voice cooking companion kit for a countertop ESP32-S3 device.

This repo is intended to contain the whole project:

- a small standalone server with `/query` and `/query-audio`
- a static recipe UI served from `/`
- SQLite-backed recipe and cooking-session state
- temporary generated speech audio
- ESP32-S3 hardware docs, firmware, and reference materials in `hardware/`

The copied hardware kit lives in:

- [hardware/README.md](./hardware/README.md)
- [hardware/cooking-companion-sketch/README.md](./hardware/cooking-companion-sketch/README.md)

## Intended Device API

The hardware should call:

- `POST /query-audio`

If `API_TOKEN` is configured on the server, use:

- `POST /query-audio?token=<API_TOKEN>`

Generated audio URLs are expected to be temporary and relative by default, for example:

- `/audio/example.mp3`

## Hosting

The server is intended to run in a container on local hardware or a remote hosting service. Runtime data should be mounted outside the image so recipes, sessions, and temporary generated audio survive container restarts.

With Docker:

```bash
docker build -t voice-cooking-companion .
docker run --env-file .env -p 3000:3000 -v "$PWD/data:/app/data" -v "$PWD/generated-audio:/app/generated-audio" voice-cooking-companion
```

Or with Compose:

```bash
docker compose up --build
```

Mount these paths for persistent runtime data:

- `/app/data`
- `/app/generated-audio`

## Development

```bash
pnpm install
pnpm run dev
```

Open:

- `http://localhost:3000`

Useful checks:

```bash
pnpm run check
pnpm run build
pnpm run prune-audio
```

## Configuration

All environment variables are optional for the text-only server flow. Voice features and LLM-assisted helpers require `OPENAI_API_KEY`.

If `API_TOKEN` is set, protected endpoints require either `?token=<API_TOKEN>` or an `x-api-token` header.

Recipe markdown uploads are protected when `API_TOKEN` is configured. The root web UI accepts the token in its protected-action controls and sends it as `x-api-token`.

## Recipe Markdown

Recipe uploads accept a markdown file or pasted markdown with this shape:

```markdown
# Lemon Garlic Pasta

A quick pasta for weeknight cooking.

## Ingredients
- 8 oz pasta
- 2 cloves garlic, minced

## Instructions
1. Boil the pasta until al dente.
2. Saute the garlic, then toss with pasta.

## Tags
- pasta
- quick
```

If a recipe with the same title already exists, the import endpoint returns a duplicate response and the UI asks before updating the existing recipe.

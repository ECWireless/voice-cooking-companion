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

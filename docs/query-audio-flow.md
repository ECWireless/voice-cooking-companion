# Query Audio Flow

`POST /query-audio` is the hardware-facing voice endpoint.

It supports two request modes:

- multipart spoken query with an `audio` file field
- JSON next-step request with `inputMode: "next_step"`

If `API_TOKEN` is configured, `/query-audio` requires either `?token=<API_TOKEN>` or `x-api-token: <API_TOKEN>`.

## Multipart Spoken Query

Expected request:

- `Content-Type: multipart/form-data`
- file field `audio`, with `file` accepted as a fallback
- optional `sessionId`

Flow:

1. Token guard runs when configured.
2. The server collects form fields and the `audio` upload.
3. The server validates audio type and size.
4. OpenAI speech-to-text produces a transcript.
5. The transcript is sent to the same deterministic query service used by `/query`.
6. The query service updates the narrow cooking session state.
7. OpenAI text-to-speech generates an MP3 for `answerText`.
8. The MP3 is stored under `generated-audio`.
9. The response includes a temporary relative `audio.url`.

Each request records a privacy-aware query event with route, mode, stage, outcome, status code, session ID, audio metadata, duration, and a short transcript snippet when configured. Uploaded audio is never stored in the event log.

## JSON Next Step

Expected request:

```json
{
  "inputMode": "next_step",
  "sessionId": "sess_123"
}
```

Flow:

1. Token guard runs when configured.
2. The deterministic query service advances the cooking session.
3. OpenAI text-to-speech generates an MP3 for the response.
4. The response includes `answerText`, `session`, and temporary `audio.url`.

## Response Shape

```json
{
  "ok": true,
  "transcript": "How do I make lemon garlic pasta?",
  "intent": "recipe_lookup",
  "answerText": "I found Weeknight Lemon Garlic Pasta. Want ingredients or the first step?",
  "audio": {
    "mimeType": "audio/mpeg",
    "url": "/audio/1779890000000-example.mp3"
  },
  "session": {
    "id": "sess_123",
    "activeRecipeId": "weeknight-lemon-garlic-pasta-1",
    "stepIndex": 0,
    "phase": "ingredients"
  }
}
```

`audio.url` is relative by default. The ESP32 sketch joins relative audio URLs to `API_ORIGIN`.

## Firmware URL

Configure the sketch with:

```cpp
const char* API_ORIGIN = "https://example.com";
const char* API_URL_BASE = "https://example.com/query-audio";
const char* GATEWAY_TOKEN = "";
```

When the server has `API_TOKEN` configured, put that value in `GATEWAY_TOKEN`; the sketch appends it as `?token=...`.

## Generated Audio Retention

Generated MP3 files are temporary implementation artifacts.

Run:

```bash
pnpm run prune-audio
```

Files older than `GENERATED_AUDIO_TTL_HOURS` are deleted from `GENERATED_AUDIO_DIR`.

## Diagnostics

Recent query events are stored in SQLite and can be fetched with:

```bash
curl -H "x-api-token: $API_TOKEN" "http://localhost:3000/api/query-events?limit=25"
```

If `API_TOKEN` is configured, this endpoint is protected. Events include only audio metadata, request stage/outcome, status, duration, session ID, intent, and optional short transcript snippets.

Configuration:

- `ENABLE_QUERY_EVENT_LOG`: set to `false` or `0` to disable SQLite query events.
- `QUERY_EVENT_TRANSCRIPT_CHARS`: maximum transcript snippet length; set to `0` to disable transcript snippets.
- `QUERY_EVENT_LIMIT`: default number of events returned by `/api/query-events`.

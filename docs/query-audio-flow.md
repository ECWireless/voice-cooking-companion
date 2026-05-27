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
2. The server validates audio type and size.
3. OpenAI speech-to-text produces a transcript.
4. The transcript is sent to the same deterministic query service used by `/query`.
5. The query service updates the narrow cooking session state.
6. OpenAI text-to-speech generates an MP3 for `answerText`.
7. The MP3 is stored under `generated-audio`.
8. The response includes a temporary relative `audio.url`.

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

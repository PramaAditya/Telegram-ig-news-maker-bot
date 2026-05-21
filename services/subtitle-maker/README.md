# Subtitle Maker Microservice

**Notice to AI Assistants:** This document is written specifically to provide context for future AI coding sessions. Read this carefully before modifying this service.

## Purpose
This is an internal Express.js microservice (`subtitle-maker`) within the broader `ig-news-maker-bot` project. It receives video or audio files, transcribes them using ElevenLabs, dynamically chunks the words into perfectly timed subtitles, translates them using Google Gemini (if the source language differs from the target language), applies algorithmic censorship to bypass social media filters, and returns either an `.srt` file string or a raw JSON object.

*Note: Hardsubbing (burning subtitles into video via ffmpeg) was explicitly removed from this service to keep it lightweight. Do not re-add ffmpeg unless explicitly requested.*

## Architecture & Integration
- **Internal API:** This service is accessible within the Docker network at `http://subtitle-maker:3001`.
- **Local Volume Mapping:** This service shares a Docker volume (`telegram-data`) with the local `telegram-bot-api` server. It can process files via standard `multipart/form-data` uploads, OR by receiving an absolute path (`filePath` in the body) referencing the shared volume. The latter is preferred for large files to avoid network I/O.
- **Environment Variables:**
  - `ELEVENLABS_API_KEY`: Required for transcription.
  - `GOOGLE_GENERATIVE_AI_API_KEY`: Required for Gemini (translation).
  - `SUBTITLE_GENERATOR_MODEL`: Gemini model to use (defaults to `gemini-1.5-flash`).
  - `TARGET_LANG`: Default target language code (defaults to `ind`).
  - `PORT`: Express port (defaults to 3001).

## Core Files
- `src/index.ts`: The Express server and main orchestration pipeline.
- `src/elevenlabs.ts`: Handles the `multipart/form-data` upload to ElevenLabs `scribe_v1` model to get word-level timestamped transcriptions.
- `src/chunker.ts`: Programmatic logic to merge individual words into cohesive subtitle chunks based on character limits, durations, and silence gaps.
- `src/gemini.ts`: Handles LLM interactions. Translates chunks while strictly maintaining their IDs, using context from the original media.
- `src/sanitize.ts`: A dictionary-based string replacer that obfuscates sensitive keywords to prevent algorithm shadowbans.

## API Reference

### `POST /process`
Accepts either `multipart/form-data` (with a `file` field) OR `application/json` (with a `filePath` field).

**Parameters (Body or Query):**
- `file` (File, optional): The media file to transcribe.
- `filePath` (String, optional): Absolute local path to the media file (useful for shared Docker volumes).
- `targetLanguage` or `targetLang` (String, optional): Target language for translation (e.g., `en`, `ind`, `es`). Overrides `TARGET_LANG` env var. Can be passed in query string.
- `context` (String, optional): Additional context passed to Gemini to aid in translation accuracy (e.g., specific names or terminology).
- `censorDictionary` (Array, optional): Custom dictionary array matching the `BannedWord[]` interface: `[ { "word": "israel", "replacement": "1srI?l", "type": "partial" } ]`. Overrides the default built-in dictionary.
- `outputFormat` (String, optional): The desired response format. Either `srt` (default) or `json`.
- `elevenLabsKey` (String, optional): Overrides env variable.
- `geminiKey` (String, optional): Overrides env variable.

**Behavioral Logic:**
1. Triggers ElevenLabs Speech-to-Text.
2. Formats into `Chunk` objects.
3. Detects audio language. If `audioLanguage` (first 2 chars) matches `targetLanguage` (first 2 chars), translation is skipped.
4. Applies `sanitize.ts` to the final text.
5. Cleans up any uploaded files from Multer's `temp` directory and from Gemini's File API.
# Image Curator Agent

A specialized AI Agent / Utility that autonomously searches for, evaluates, and curates highly relevant images from the web based on a given context.

It uses **OpenSERP** for image search and the **Vercel AI SDK** with a Multimodal LLM (`gemini-3.5-flash`) to process and evaluate the actual visual content of the images.

## Core Features

1. **Exact Count Fulfillment:** You can request exactly $N$ images. The agent will iteratively paginate through search engine results in a `while` loop until it finds the requested amount or hits a retry limit.
2. **URL Deduplication:** Search engines often return the same image URL across different pages or ranks. The agent automatically maintains a memory of `seenUrls` to prevent processing the same image twice.
3. **Visual Deduplication (Multimodal Memory):** An image might have two different URLs (e.g., one full size, one slightly cropped). Because the agent downloads thumbnails and feeds them into the Multimodal LLM, it actively compares new candidates against **already approved images from previous loops**. The LLM is instructed to reject cropped, zoomed, or slightly altered versions of what it has already curated.

## Output Structure

By default, the function returns an array of curated images:

```typescript
[
  {
    "originalUrl": "https://example.com/high-res-image.jpg",
    "relevanceScore": 10,
    "description": "An excellent depiction of a cyberpunk city street at night..."
  }
]
```

If `detailedOutput` is set to `true`, the object will also include:
* `thumbnailUrl` (string, optional)
* `sourceUrl` (string, optional) - the webpage where the image was found
* `title` (string, optional) - the alt text or title from the search engine

## Architecture Flow

1. **Pre-Evaluate Existing URLs:** If `existingImageUrls` is provided, download and visually evaluate them first. If `targetCount` is met, return early.
2. **Search:** Query OpenSERP (`bing` engine default) and request `N` results with a pagination `offset`.
3. **Filter:** Remove already `seenUrls`.
4. **Download:** Fetch image thumbnails into a memory `Buffer`, safely handling Base64 Data URIs and stripping out invalid MIME types (like SVGs or HTML masquerading as images).
5. **Evaluate:** Construct a multimodal prompt including:
   * The User Context.
   * `ALREADY SELECTED IMAGES` to establish visual memory.
   * `NEW CANDIDATES` to be evaluated.
6. **Decide:** Use `generateObject` and `zod` to force the LLM to output a strictly typed array of selected Candidate IDs, Relevance Scores (1-10), and descriptions.
7. **Iterate:** If the target count is not met, increase the `offset`, fetch the next page, and repeat the process.

## Inputs / Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | `string` | **Required** | The search query used to find images on the web via OpenSERP. |
| `context` | `string` | **Required** | The context/topic the visual AI uses to evaluate whether the image is actually a good fit. |
| `targetCount` | `number` | `1` | The exact number of images the agent will attempt to curate. |
| `maxAttempts` | `number` | `3` | Maximum pagination/retry attempts to reach `targetCount`. |
| `engine` | `string` | `'bing'` | OpenSERP engine (`'bing'`, `'google'`, `'yandex'`, `'duckduckgo'`). |
| `existingImageUrls` | `string[]` | `undefined` | Optional array of direct image URLs to evaluate *before* falling back to search engine curation. Great for validating images scraped from an article. |
| `detailedOutput` | `boolean` | `false` | If `true`, includes extra metadata (`title`, `thumbnailUrl`, `sourceUrl`) in the output array. Defaults to `false` to save context tokens. |

## Usage

This module is designed to be used in two different ways:

### 1. As a Standalone Function

You can use it directly in your backend code (e.g., an Express route, cron job, or worker).

```typescript
import { curateImages } from './src/agents/image-curator';

async function main() {
  const images = await curateImages({
    query: "SpaceX Super Heavy catch",
    context: "News post about the mechazilla catch during Flight 5.",
    targetCount: 3
  });

  console.log(images);
  // Returns exactly 3 visually distinct, highly relevant images with their original high-res URLs.
}
```

### 2. As an AI Agent Tool

You can inject this capability into *another* AI agent (like a Researcher or News Writer) by passing `imageCuratorTool` into the Vercel AI SDK `tools` array. The parent agent will autonomously call this tool when it realizes it needs visuals for its task.

```typescript
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { imageCuratorTool } from './src/agents/image-curator';

const result = await generateText({
  model: google('gemini-3.1-pro-preview'),
  messages: [...], 
  tools: {
    curateImages: imageCuratorTool 
  }
});

// The parent agent will pause, trigger the tool, wait for the curated image URLs to return, and continue generating its response.
```

## Requirements

- `process.env.OPENSERP_BASE_URL` (Optional, defaults to `http://127.0.0.1:7000`)
- `process.env.MIDDLE_MODEL` (Optional, defaults to `gemini-3.5-flash`. The model must be multimodal and support `generateObject`.)

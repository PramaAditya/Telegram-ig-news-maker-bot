# Image Editor Utility (`imageEditor`)

Unified image editing & generation utility powered by Google Gemini multimodal image models (`gemini-3.1-flash-image-preview` / `IMAGE_GENERATION_MODEL`) and AWS S3 storage.

Provides two specialized editing modes:
1. **`4K-Enhance`**: Ultra-high-resolution 4K remastering, noise removal, pixelation recovery, and texture enhancement while strictly preserving composition and facial features.
2. **`Dark-Dramatize`**: Dramatic editorial lighting, heavy chiaroscuro, intense rim lighting from behind, deep subject shadows, and pitch-black void edges (standard cover style for breaking news carousels).

---

## Installation & Import

```ts
import { imageEditor, enhance4K, darkDramatize } from '@/utils/imageEditor/index.js';
```

---

## Modes & Features

### 1. `Dark-Dramatize` Mode
Ideal for Instagram carousel and single-page breaking news covers.

Features:
- **Intelligent Multimodal Sourcing**:
  1. Uses direct `image` (Buffer, URL, or Base64) if available.
  2. Falls back to downloading `scrapedImageUrl`.
  3. Falls back to searching the web via Firecrawl using `searchQuery`.
  4. Falls back to pure text-to-image prompt if no base image can be found.
- **Dramatic Prompt Injection**: Automatically applies chiaroscuro, rim light, and low-key negative constraints.
- **Safe Fallback**: If AI generation fails after retries, safely falls back to the original base image or a transparent 1x1 black pixel.
- **S3 Pipe**: Automatically uploads to S3 and returns a public CDN URL.

```ts
// Example: Generating a dark dramatic cover
const result = await darkDramatize({
  image: uploadedBuffer,
  scrapedImageUrl: 'https://news.com/article/hero.jpg',
  searchQuery: 'Presidential Speech Bandung',
  prompt: 'A formal political podium speech',
  aspectRatio: '1:1',
  uploadToS3: true,
});

console.log(result.url); // S3 URL
```

### 2. `4K-Enhance` Mode
Ideal for upscaling, de-noising, and remastering photos.

```ts
// Example: Enhancing an image to 4K
const result = await enhance4K({
  image: 'https://example.com/source.jpg',
  size: '4K',
  aspectRatio: '16:9',
  uploadToS3: true,
});

console.log(result.url);
```

### 3. Unified Dispatcher (`imageEditor`)
You can also use the unified entrypoint:

```ts
const cover = await imageEditor({
  mode: 'Dark-Dramatize',
  image: inputBuffer,
  prompt: contentParams.image_prompt,
});

const enhanced = await imageEditor({
  mode: '4K-Enhance',
  image: inputBuffer,
});
```

---

## Options Reference (`ImageEditorOptions`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | `'4K-Enhance' \| 'Dark-Dramatize'` | *Required* | Active editing mode |
| `image` | `Buffer \| string \| null` | `undefined` | Input image (Buffer, HTTP/HTTPS URL, or Data URI) |
| `prompt` | `string` | `undefined` | Text prompt (used as fallback or additional direction) |
| `scrapedImageUrl` | `string \| null` | `undefined` | Scraped article image URL (Dark-Dramatize fallback) |
| `searchQuery` | `string \| null` | `undefined` | Web search query for Firecrawl (Dark-Dramatize fallback) |
| `aspectRatio` | `AspectRatio` | `'1:1'` (Dark) / `'auto'` (4K) | Output aspect ratio |
| `size` | `'1K' \| '2K' \| '4K'` | `'1K'` | Output resolution |
| `uploadToS3` | `boolean` | `true` | Upload output to S3 and populate `result.url` |
| `maxRetries` | `number` | `3` | Maximum retry attempts with exponential backoff |

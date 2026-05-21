# Image Enhancer Utility

This utility provides a wrapper around the Vercel AI SDK and Google Gemini image models to enhance, layout, and expand images.

It uses `gemini-3.1-flash-image-preview` (configurable via `IMAGE_GENERATION_MODEL` environment variable) for high-fidelity image enhancement, scaling, and aspect ratio adjustment. 

Features:
- Handles retries gracefully with exponential backoff (Gemini image models occasionally refuse generation).
- Allows specifying `aspectRatio` and `size` (`1K`, `2K`, `4K`).
- Supports an optional `uploadToS3` flag which pipes the generated image Buffer to our S3 upload utility and returns the S3 URL.

## Example usage:
```ts
import { enhanceImage } from '@/utils/image-enhancer';

const { buffer, base64 } = await enhanceImage({
  image: 'https://example.com/source.jpg',
  aspectRatio: '16:9',
  size: '4K'
});

const { url } = await enhanceImage({
  image: sourceBuffer,
  aspectRatio: '4:5',
  size: '2K',
  uploadToS3: true,
});
```

import { generateImage } from 'ai';
import { google } from '@ai-sdk/google';
import { uploadToS3 } from '../../s3.js';

export type ImageEditorMode = '4K-Enhance' | 'Dark-Dramatize';
export type AspectRatio = 'auto' | '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
export type ImageSize = '1K' | '2K' | '4K';

export interface ImageEditorOptions {
  /**
   * Editing mode:
   * - '4K-Enhance': Ultra-high-resolution 4K remastering, preserving composition, removing noise/pixelation.
   * - 'Dark-Dramatize': Dramatic backlighting, strong rim lighting, heavy chiaroscuro, extreme low-key, pitch black void edges.
   */
  mode: ImageEditorMode;
  /**
   * Source image input: Buffer, HTTP(S) URL, or base64 data URI.
   * Optional for 'Dark-Dramatize' (falls back to text prompt or web search).
   */
  image?: Buffer | string | null;
  /**
   * Prompt string:
   * - For 'Dark-Dramatize': Text prompt used when no image is available (or combined with base image).
   * - For '4K-Enhance': Optional custom prompt override.
   */
  prompt?: string;
  /**
   * Scraped image URL fallback (used if `image` is not provided).
   */
  scrapedImageUrl?: string | null;
  /**
   * Search query to find an image via Firecrawl fallback (used if neither `image` nor `scrapedImageUrl` is available).
   */
  searchQuery?: string | null;
  /**
   * Aspect ratio of generated image. Defaults to '1:1' for Dark-Dramatize, 'auto' for 4K-Enhance.
   */
  aspectRatio?: AspectRatio;
  /**
   * Output size resolution. Defaults to '1K'.
   */
  size?: ImageSize;
  /**
   * Whether to automatically upload to S3 and return `url`. Defaults to true.
   */
  uploadToS3?: boolean;
  /**
   * Maximum number of retry attempts with exponential backoff. Defaults to 3.
   */
  maxRetries?: number;
}

export interface ImageEditorResult {
  buffer: Buffer;
  base64?: string;
  url?: string;
  mediaType: string;
}

export const DARK_DRAMATIZE_SUFFIX =
  'analyze input image, focus on main subject, masterpiece professional photography, dramatic backlighting, strong rim lighting from behind, intense edge light, front of subject in deep shadow, heavy chiaroscuro photography, extreme low key, edges fading completely into pitch black void. 4K ultra HD. Render in extreme detail with high-end remastering, sharp focus, accurate textures. Ensure it is strictly in 1:1 aspect ratio. NO TEXT whatsoever. DO NOT INCLUDE: front lighting, direct lighting, top lighting, overhead light, painting, bright background, daylight, flat lighting, overexposed, visible room edges, cutout, text, logo, signature.';

export const ENHANCE_4K_DEFAULT_PROMPT =
  'Ultra-high-resolution 4K enhancement. Render in extreme detail, sharp focus, and high-fidelity textures. Strictly preserve the pose, composition, and subjects captured. Recover hidden details, remove pixelation and noise, and add realistic, lifelike clarity without altering the original style or morphing facial features.';

// 1x1 black transparent PNG as ultimate safe fallback
const BLACK_FALLBACK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Downloads or parses an image source into a Buffer with detected mime type.
 */
async function resolveImageBuffer(
  source?: Buffer | string | null,
  timeoutMs = 10000
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!source) return null;

  if (Buffer.isBuffer(source)) {
    return { buffer: source, mimeType: 'image/jpeg' };
  }

  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      const match = source.match(/^data:(.*?);base64,(.*)$/);
      if (match) {
        return {
          buffer: Buffer.from(match[2], 'base64'),
          mimeType: match[1] || 'image/jpeg',
        };
      }
    }

    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      return { buffer: Buffer.from(arrayBuffer), mimeType };
    } catch (err: any) {
      console.warn(`[imageEditor] Failed to fetch image from URL (${source}):`, err.message);
      return null;
    }
  }

  return null;
}

/**
 * Searches the web for an image using Firecrawl as a fallback.
 */
async function searchWebImage(query: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    console.log(`[imageEditor] Searching web image for query: "${query}"`);
    const { firecrawlService } = await import('../firecrawl.js');
    const searchRes = await firecrawlService.search(`${query} image`, { limit: 1 });

    let foundImageUrl: string | null = null;
    if ((searchRes as any)?.data?.length > 0) {
      for (const item of (searchRes as any).data) {
        if (item.metadata?.ogImage || item.metadata?.image) {
          foundImageUrl = item.metadata.ogImage || item.metadata.image;
          break;
        }
      }
    }

    if (foundImageUrl) {
      console.log(`[imageEditor] Found fallback image via web search: ${foundImageUrl}`);
      return await resolveImageBuffer(foundImageUrl);
    }
  } catch (err: any) {
    console.warn(`[imageEditor] Web search fallback failed for "${query}":`, err.message);
  }
  return null;
}

/**
 * Executes a '4K-Enhance' edit on an input image.
 */
export async function enhance4K(options: Omit<ImageEditorOptions, 'mode'>): Promise<ImageEditorResult> {
  const {
    image,
    prompt = ENHANCE_4K_DEFAULT_PROMPT,
    aspectRatio = 'auto',
    size = '1K',
    uploadToS3: shouldUploadToS3 = true,
    maxRetries = 3,
  } = options;

  const resolved = await resolveImageBuffer(image);
  if (!resolved) {
    throw new Error('[imageEditor:4K-Enhance] An image buffer or valid image URL is required for 4K enhancement.');
  }

  const modelName = process.env.IMAGE_GENERATION_MODEL || 'gemini-3.1-flash-image-preview';
  let outputBuffer: Buffer | undefined;
  let base64Output: string | undefined;
  let mediaType: string = 'image/jpeg';
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[imageEditor:4K-Enhance] Generation attempt ${attempt}/${maxRetries}...`);
      const result = await generateImage({
        model: google.image(modelName),
        prompt: {
          text: prompt,
          images: [resolved.buffer],
        },
        aspectRatio: aspectRatio === 'auto' ? undefined : aspectRatio,
        providerOptions: {
          google: {
            imageConfig: {
              imageSize: size,
            },
          },
        },
      });

      if (result.image?.base64) {
        base64Output = result.image.base64;
        outputBuffer = Buffer.from(base64Output, 'base64');
        mediaType = result.image.mediaType || 'image/jpeg';
        break;
      }
    } catch (error) {
      lastError = error;
      console.warn(`[imageEditor:4K-Enhance] Attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await wait(delay);
      }
    }
  }

  if (!outputBuffer) {
    console.warn(`[imageEditor:4K-Enhance] Failed to enhance image after ${maxRetries} attempts. Falling back to original image buffer.`);
    outputBuffer = resolved.buffer;
    mediaType = resolved.mimeType;
  }

  let url: string | undefined;
  if (shouldUploadToS3) {
    const ext = mediaType === 'image/png' ? '.png' : '.jpg';
    url = (await uploadToS3(outputBuffer, mediaType, ext)) || undefined;
  }

  return {
    buffer: outputBuffer,
    base64: base64Output,
    url,
    mediaType,
  };
}

/**
 * Executes a 'Dark-Dramatize' edit (dramatic backlighting, heavy chiaroscuro, extreme low key).
 * Handles input image, scraped image fallback, web search fallback, and pure text-to-image.
 */
export async function darkDramatize(options: Omit<ImageEditorOptions, 'mode'>): Promise<ImageEditorResult> {
  const {
    image,
    prompt = '',
    scrapedImageUrl,
    searchQuery,
    aspectRatio = '1:1',
    size = '1K',
    uploadToS3: shouldUploadToS3 = true,
    maxRetries = 3,
  } = options;

  // Step 1: Sourcing base image
  let baseResolved = await resolveImageBuffer(image);

  if (!baseResolved && scrapedImageUrl) {
    console.log(`[imageEditor:Dark-Dramatize] Sourcing base image from scraped URL: ${scrapedImageUrl}`);
    baseResolved = await resolveImageBuffer(scrapedImageUrl);
  }

  if (!baseResolved && searchQuery) {
    console.log(`[imageEditor:Dark-Dramatize] Sourcing base image via web search for: "${searchQuery}"`);
    baseResolved = await searchWebImage(searchQuery);
  }

  const baseBuffer = baseResolved?.buffer || null;

  // Step 2: Build dramatic prompt
  let finalPrompt = '';
  if (baseBuffer) {
    console.log(`[imageEditor:Dark-Dramatize] Enhancing base image with dramatic chiaroscuro style...`);
    finalPrompt = `Based on the provided image, ${DARK_DRAMATIZE_SUFFIX}`;
  } else {
    console.log(`[imageEditor:Dark-Dramatize] Generating from text prompt: "${prompt || 'breaking news cover'}"`);
    finalPrompt = `${prompt || 'breaking news cover'}. ${DARK_DRAMATIZE_SUFFIX}`;
  }

  // Step 3: Generation with retry & backoff
  const modelName = process.env.IMAGE_GENERATION_MODEL || 'gemini-3.1-flash-image-preview';
  let outputBuffer: Buffer | null = null;
  let base64Output: string | undefined;
  let mediaType = 'image/jpeg';
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[imageEditor:Dark-Dramatize] Generation attempt ${attempt}/${maxRetries}...`);
      const result = await generateImage({
        model: google.image(modelName),
        prompt: {
          text: finalPrompt,
          images: baseBuffer ? [baseBuffer] : [],
        },
        aspectRatio: aspectRatio === 'auto' ? undefined : aspectRatio,
        providerOptions: {
          google: {
            imageConfig: {
              imageSize: size,
            },
          },
        },
      });

      if (result.image?.base64) {
        base64Output = result.image.base64;
        outputBuffer = Buffer.from(base64Output, 'base64');
        mediaType = result.image.mediaType || 'image/jpeg';
        break;
      }
    } catch (error) {
      lastError = error;
      console.warn(`[imageEditor:Dark-Dramatize] Attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await wait(delay);
      }
    }
  }

  // Step 4: Fallback if generation failed
  if (!outputBuffer) {
    console.warn(`[imageEditor:Dark-Dramatize] Failed after ${maxRetries} attempts. Falling back to base image or transparent pixel.`);
    if (baseBuffer) {
      outputBuffer = baseBuffer;
      mediaType = baseResolved?.mimeType || 'image/jpeg';
    } else {
      outputBuffer = BLACK_FALLBACK_PNG;
      mediaType = 'image/png';
    }
  }

  // Step 5: Upload to S3
  let url: string | undefined;
  if (shouldUploadToS3) {
    console.log(`[imageEditor:Dark-Dramatize] Uploading result to S3...`);
    const ext = mediaType === 'image/png' ? '.png' : '.jpg';
    url = (await uploadToS3(outputBuffer, mediaType, ext)) || undefined;
  }

  return {
    buffer: outputBuffer,
    base64: base64Output,
    url,
    mediaType,
  };
}

/**
 * Unified Image Editor entrypoint supporting '4K-Enhance' and 'Dark-Dramatize' modes.
 */
export async function imageEditor(options: ImageEditorOptions): Promise<ImageEditorResult> {
  const { mode, ...rest } = options;

  switch (mode) {
    case '4K-Enhance':
      return enhance4K(rest);
    case 'Dark-Dramatize':
      return darkDramatize(rest);
    default:
      throw new Error(`[imageEditor] Unsupported mode: ${mode}`);
  }
}

/**
 * Backward compatibility alias for the previous `enhanceImage` function.
 */
export async function enhanceImage(
  options: Omit<ImageEditorOptions, 'mode'> & { mode?: ImageEditorMode }
): Promise<ImageEditorResult> {
  return imageEditor({ mode: options.mode || '4K-Enhance', ...options });
}

export default imageEditor;

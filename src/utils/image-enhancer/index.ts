import { generateImage } from 'ai';
import { google } from '@ai-sdk/google';
import { uploadToS3 } from '../../s3.js';

export type AspectRatio = 'auto' | '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
export type ImageSize = '1K' | '2K' | '4K';

export interface EnhanceImageOptions {
  /**
   * The source image to enhance. Can be a URL, base64 string, or Buffer.
   */
  image: string | Buffer;
  /**
   * The aspect ratio of the generated image.
   */
  aspectRatio?: AspectRatio;
  /**
   * The output size resolution. Defaults to '1K'.
   */
  size?: ImageSize;
  /**
   * Whether to upload the output image directly to S3 and return a URL.
   */
  uploadToS3?: boolean;
}

export interface EnhanceImageResponse {
  buffer?: Buffer;
  base64?: string;
  url?: string;
}

const DEFAULT_PROMPT = `Ultra-high-resolution 4K enhancement. Render in extreme detail, sharp focus, and high-fidelity textures. Strictly preserve the pose, composition, and subjects captured. Recover hidden details, remove pixelation and noise, and add realistic, lifelike clarity without altering the original style or morphing facial features.`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Enhances, expands, or alters the aspect ratio of an image using Gemini's image model.
 * Includes a built-in retry mechanism for API instability.
 */
export async function enhanceImage(options: EnhanceImageOptions): Promise<EnhanceImageResponse> {
  const { image, aspectRatio = 'auto', size = '1K', uploadToS3: shouldUploadToS3 = false } = options;
  const maxRetries = 3;
  let lastError: unknown;
  
  let outputBuffer: Buffer | undefined;
  let base64Output: string | undefined;
  let mediaType: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const modelName = process.env.IMAGE_GENERATION_MODEL || 'gemini-3.1-flash-image-preview';

      // Type cast google provider configuration because providerOptions types
      // might be stricter than `any` depending on the current ai-sdk version.
      const result = await generateImage({
        model: google.image(modelName),
        prompt: {
          text: DEFAULT_PROMPT,
          images: [image], // URL, base64 or Buffer are supported
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

      base64Output = result.image.base64;
      outputBuffer = Buffer.from(base64Output, 'base64');
      mediaType = result.image.mediaType;
      
      // Successfully generated the image, break out of the retry loop
      break;
    } catch (error) {
      lastError = error;
      console.warn(`[enhanceImage] Attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
      
      if (attempt < maxRetries) {
        // Exponential backoff: 2s, 4s, etc.
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[enhanceImage] Retrying in ${delay}ms...`);
        await wait(delay);
      }
    }
  }

  if (!outputBuffer || !base64Output) {
    throw new Error(`Failed to enhance image after ${maxRetries} attempts. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  if (shouldUploadToS3) {
    const ext = mediaType === 'image/png' ? '.png' : '.jpg';
    const mime = mediaType || 'image/jpeg';
    const url = await uploadToS3(outputBuffer, mime, ext);
    return { url, buffer: outputBuffer, base64: base64Output };
  }

  return {
    buffer: outputBuffer,
    base64: base64Output,
  };
}

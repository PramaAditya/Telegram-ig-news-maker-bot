import { generateObject, tool } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { openserp } from '../../openserp.js';

export interface CuratedImage {
  originalUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title: string;
  relevanceScore: number;
  description: string;
}

interface ImageCandidate {
  id: number;
  originalUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title: string;
  buffer: Buffer;
}

/**
 * Helper to download an image as a Buffer with a timeout.
 */
async function downloadImageAsBuffer(url: string, timeoutMs = 5000): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    return null;
  }
}

export interface CurateImagesParams {
  /** The search query to find images on the web */
  query: string;
  /** The context or topic to evaluate the images against */
  context: string;
  /** The exact number of images to curate (default: 1) */
  targetCount?: number;
  /** The maximum number of pagination attempts (default: 3) */
  maxAttempts?: number;
  /** OpenSERP search engine to use (default: bing) */
  engine?: 'bing' | 'google' | 'yandex' | 'duckduckgo';
  /** Optional list of existing image URLs to evaluate before falling back to OpenSERP */
  existingImageUrls?: string[];
}

/**
 * Standalone Agent Function:
 * Iteratively searches for images via OpenSERP, downloads thumbnails, and uses 
 * a multimodal LLM to visually evaluate and deduplicate until the target count is reached.
 */
export async function curateImages({
  query,
  context,
  targetCount = 1,
  maxAttempts = 3,
  engine = 'bing',
  existingImageUrls
}: CurateImagesParams): Promise<CuratedImage[]> {
  console.log(`[ImageCurator] Starting curation for: "${query}" (Target: ${targetCount})`);

  const approvedImages: (CuratedImage & { buffer: Buffer })[] = [];
  const seenUrls = new Set<string>();
  
  let attempt = 0;
  let offset = 0;
  const pageSize = 20; // Fetch more to increase chances of finding good images per batch

  const evaluateBatch = async (candidatesRaw: any[], neededCount: number, batchName: string) => {
    const downloadedCandidates: ImageCandidate[] = [];
    const fetchPromises = candidatesRaw.map(async (res: any, idx: number) => {
      const urlToFetch = res.image.thumbnail || res.image.url;
      const buffer = await downloadImageAsBuffer(urlToFetch);
      if (buffer) {
        downloadedCandidates.push({
          id: idx,
          originalUrl: res.image.url,
          thumbnailUrl: res.image.thumbnail,
          sourceUrl: res.source.page_url,
          title: res.title,
          buffer
        });
      }
    });

    await Promise.all(fetchPromises);

    if (downloadedCandidates.length === 0) {
      console.log(`[ImageCurator] Failed to download any candidates in batch ${batchName}.`);
      return;
    }

    console.log(`[ImageCurator] Successfully downloaded ${downloadedCandidates.length} candidate thumbnails. Evaluating...`);

    const content: any[] = [
      { type: 'text', text: `You are an expert image curator. Your task is to select the most highly relevant images based on the following context.` },
      { type: 'text', text: `Context:\n${context}` },
      { type: 'text', text: `\nGoal: We need exactly ${neededCount} more image(s). Select up to ${neededCount} best images from the new candidates.` },
      { type: 'text', text: `CRITICAL RULES:\n1. Ensure selected images are highly relevant to the context.\n2. Ensure selected images are VISUALLY DISTINCT.\n3. DO NOT select images that are cropped, zoomed-in, heavily watermarked, or slightly color-altered versions of each other or the Already Selected list.` }
    ];

    if (approvedImages.length > 0) {
      content.push({ type: 'text', text: `\n--- ALREADY SELECTED IMAGES (DO NOT DUPLICATE THESE, NOT EVEN CROPS) ---` });
      approvedImages.forEach((img, idx) => {
        content.push({ type: 'text', text: `Already Selected [${idx}]` });
        content.push({ type: 'image', image: img.buffer });
      });
    }

    content.push({ type: 'text', text: `\n--- NEW CANDIDATES ---` });
    downloadedCandidates.forEach(candidate => {
      content.push({ type: 'text', text: `Candidate ID: ${candidate.id}` });
      content.push({ type: 'image', image: candidate.buffer });
    });

    const modelName = process.env.MIDDLE_MODEL || 'gemini-3.5-flash';
    
    try {
      const { object } = await generateObject({
        model: google(modelName),
        schema: z.object({
          selected: z.array(z.object({
            candidateId: z.number().describe('The ID of the new candidate image you are selecting.'),
            relevanceScore: z.number().min(1).max(10).describe('How relevant the image is to the context (1-10)'),
            description: z.string().describe('A brief explanation of why this image is great and how it visually differs from others.'),
          })).max(neededCount).describe('Pick visually distinct, high-quality images matching the exact needed amount (or fewer if not enough good ones exist).')
        }),
        messages: [{ role: 'user', content }]
      });

      const newlyApproved = object.selected
        .map((sel: any) => {
          const candidate = downloadedCandidates.find(c => c.id === sel.candidateId);
          if (!candidate) return null;
          const result: CuratedImage & { buffer: Buffer } = {
            originalUrl: candidate.originalUrl,
            thumbnailUrl: candidate.thumbnailUrl,
            sourceUrl: candidate.sourceUrl,
            title: candidate.title,
            relevanceScore: sel.relevanceScore,
            description: sel.description,
            buffer: candidate.buffer
          };
          return result;
        })
        .filter((c): c is (CuratedImage & { buffer: Buffer }) => c !== null)
        .sort((a, b) => b.relevanceScore - a.relevanceScore);

      console.log(`[ImageCurator] LLM approved ${newlyApproved.length} images from batch ${batchName}.`);
      approvedImages.push(...newlyApproved);

    } catch (error) {
      console.error(`[ImageCurator] LLM evaluation failed on batch ${batchName}:`, error);
    }
  };

  // 0. Process existingImageUrls first
  if (existingImageUrls && existingImageUrls.length > 0) {
    const uniqueExisting = existingImageUrls.filter(url => {
      if (seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    }).map(url => ({
      image: { url: url, thumbnail: url },
      source: { page_url: url },
      title: 'Existing Source Image'
    }));

    if (uniqueExisting.length > 0) {
      console.log(`[ImageCurator] Processing ${uniqueExisting.length} existing image URLs...`);
      await evaluateBatch(uniqueExisting, targetCount, 'existing');
    }
  }

  while (approvedImages.length < targetCount && attempt < maxAttempts) {
    attempt++;
    const needed = targetCount - approvedImages.length;
    console.log(`[ImageCurator] Attempt ${attempt}/${maxAttempts} - Need ${needed} more images. Offset: ${offset}`);

    // 1. Fetch from OpenSERP
    const searchResult = await openserp.searchImage(engine, { text: query, limit: pageSize, start: offset });
    offset += pageSize; // Advance offset for the next potential iteration

    if (!searchResult.results || searchResult.results.length === 0) {
      console.log(`[ImageCurator] No images found on attempt ${attempt}.`);
      continue;
    }

    // 2. Strict URL Deduplication
    const uniqueCandidatesRaw = searchResult.results.filter((res: any) => {
      const url = res.image.url;
      if (seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });

    console.log(`[ImageCurator] Found ${uniqueCandidatesRaw.length} unique URLs in this batch.`);
    if (uniqueCandidatesRaw.length > 0) {
      await evaluateBatch(uniqueCandidatesRaw, needed, String(attempt));
    }
  }

  // 7. Cleanup and Return
  const finalSelection = approvedImages.slice(0, targetCount).map(img => {
    // Remove buffer from final output to save memory
    const { buffer, ...rest } = img;
    return rest;
  });

  console.log(`[ImageCurator] Finished. Curated ${finalSelection.length}/${targetCount} images.`);
  return finalSelection;
}

/**
 * AI SDK Tool Definition:
 * Can be passed directly into the `tools` array of other agents,
 * allowing them to autonomously search and curate images.
 */
const inputSchema = z.object({
  query: z.string().describe('The search query to find images on the web'),
  context: z.string().describe('The context or topic to evaluate the images against. The visual AI uses this to pick the best matching visual.'),
  targetCount: z.number().min(1).max(10).optional().describe('How many images to curate. Defaults to 1.'),
  existingImageUrls: z.array(z.string()).optional().describe('Optional list of existing image URLs to evaluate before falling back to OpenSERP.'),
});

export const imageCuratorTool = tool({
  description: 'Searches for images and uses a visual AI to curate and select the most relevant ones based on the given context. It automatically deduplicates and iterates until the target count is met. Returns the selected high-res image URLs along with descriptions.',
  inputSchema,
  execute: async (args) => {
    const images = await curateImages({ 
      query: args.query, 
      context: args.context, 
      targetCount: args.targetCount || 1,
      existingImageUrls: args.existingImageUrls
    });
    return {
      success: images.length > 0,
      targetReached: images.length === (args.targetCount || 1),
      count: images.length,
      images
    };
  }
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  imageEditor,
  darkDramatize,
  enhance4K,
  enhanceImage,
  DARK_DRAMATIZE_SUFFIX,
  ENHANCE_4K_DEFAULT_PROMPT,
} from '../../src/utils/imageEditor/index.js';
import { generateImage } from 'ai';
import * as s3 from '../../src/s3.js';

// Mock the AI SDK generateImage
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateImage: vi.fn(),
  };
});

// Mock S3 upload
vi.mock('../../src/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue('https://mock-s3.pelita.tech/output.jpg'),
}));

// Mock Firecrawl service
vi.mock('../../src/utils/firecrawl.js', () => ({
  firecrawlService: {
    search: vi.fn(),
    scrape: vi.fn(),
  },
}));

describe('imageEditor utility', () => {
  const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const mockInputBuffer = Buffer.from('mock-input-image-data');

  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful image generation mock
    vi.mocked(generateImage).mockResolvedValue({
      image: {
        base64: mockBase64,
        mediaType: 'image/jpeg',
      },
    } as any);
  });

  describe('Dark-Dramatize mode', () => {
    it('generates dramatic image with base image buffer and uploads to S3', async () => {
      const result = await darkDramatize({
        image: mockInputBuffer,
        uploadToS3: true,
      });

      expect(generateImage).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(generateImage).mock.calls[0][0];

      // Prompt should contain dramatic suffix
      expect(callArgs.prompt.text).toContain(DARK_DRAMATIZE_SUFFIX);
      expect(callArgs.prompt.text).toContain('Based on the provided image');
      // Passed base image buffer to multimodal model
      expect(callArgs.prompt.images).toEqual([mockInputBuffer]);
      expect(callArgs.aspectRatio).toBe('1:1');

      // Uploads to S3
      expect(s3.uploadToS3).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg', '.jpg');
      expect(result.url).toBe('https://mock-s3.pelita.tech/output.jpg');
      expect(result.buffer).toEqual(Buffer.from(mockBase64, 'base64'));
    });

    it('falls back to pure text-to-image if no image is provided', async () => {
      const result = await darkDramatize({
        prompt: 'Volcanic eruption in Java',
        uploadToS3: true,
      });

      expect(generateImage).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(generateImage).mock.calls[0][0];

      expect(callArgs.prompt.text).toContain('Volcanic eruption in Java');
      expect(callArgs.prompt.text).toContain(DARK_DRAMATIZE_SUFFIX);
      expect(callArgs.prompt.images).toEqual([]);
      expect(result.url).toBe('https://mock-s3.pelita.tech/output.jpg');
    });

    it('sources image from scrapedImageUrl if no buffer is provided', async () => {
      const mockScrapedImageBuffer = Buffer.from('scraped-image-bytes');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array(mockScrapedImageBuffer).buffer,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      } as any);

      const result = await darkDramatize({
        scrapedImageUrl: 'https://news.com/article/hero.jpg',
      });

      expect(fetchSpy).toHaveBeenCalledWith('https://news.com/article/hero.jpg', expect.any(Object));
      expect(generateImage).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(generateImage).mock.calls[0][0];
      expect(callArgs.prompt.images).toEqual([mockScrapedImageBuffer]);
      expect(result.url).toBe('https://mock-s3.pelita.tech/output.jpg');

      fetchSpy.mockRestore();
    });

    it('sources image via Firecrawl search fallback when no image or scraped URL exists', async () => {
      const { firecrawlService } = await import('../../src/utils/firecrawl.js');
      vi.mocked(firecrawlService.search).mockResolvedValueOnce({
        data: [{ metadata: { ogImage: 'https://cdn.example.com/found.jpg' } }],
      } as any);

      const mockFoundImageBuffer = Buffer.from('found-image-bytes');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array(mockFoundImageBuffer).buffer,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      } as any);

      const result = await darkDramatize({
        searchQuery: 'Presidential Speech',
      });

      expect(firecrawlService.search).toHaveBeenCalledWith('Presidential Speech image', { limit: 1 });
      expect(fetchSpy).toHaveBeenCalledWith('https://cdn.example.com/found.jpg', expect.any(Object));
      expect(generateImage).toHaveBeenCalledOnce();
      expect(result.url).toBe('https://mock-s3.pelita.tech/output.jpg');

      fetchSpy.mockRestore();
    });

    it('retries on failure and falls back safely if all retries fail', async () => {
      vi.mocked(generateImage)
        .mockRejectedValueOnce(new Error('Rate limit'))
        .mockRejectedValueOnce(new Error('Rate limit'))
        .mockRejectedValueOnce(new Error('Rate limit'));

      // Fast timer for tests
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: Function) => fn()) as any;

      const result = await darkDramatize({
        image: mockInputBuffer,
        maxRetries: 3,
      });

      // Called 3 times
      expect(generateImage).toHaveBeenCalledTimes(3);
      // Safe fallback to input buffer
      expect(result.buffer).toEqual(mockInputBuffer);
      expect(s3.uploadToS3).toHaveBeenCalled();

      global.setTimeout = originalSetTimeout;
    });

    it('falls back to 1x1 black pixel when all retries fail and no base image existed', async () => {
      vi.mocked(generateImage)
        .mockRejectedValueOnce(new Error('Model overloaded'))
        .mockRejectedValueOnce(new Error('Model overloaded'))
        .mockRejectedValueOnce(new Error('Model overloaded'));

      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: Function) => fn()) as any;

      const result = await darkDramatize({
        prompt: 'Some news topic',
        maxRetries: 3,
      });

      expect(generateImage).toHaveBeenCalledTimes(3);
      // 1x1 pixel fallback
      expect(result.mediaType).toBe('image/png');
      expect(s3.uploadToS3).toHaveBeenCalledWith(expect.any(Buffer), 'image/png', '.png');

      global.setTimeout = originalSetTimeout;
    });
  });

  describe('4K-Enhance mode', () => {
    it('enhances an image buffer using 4K prompt and uploads to S3', async () => {
      const result = await enhance4K({
        image: mockInputBuffer,
        size: '4K',
        uploadToS3: true,
      });

      expect(generateImage).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(generateImage).mock.calls[0][0];

      expect(callArgs.prompt.text).toBe(ENHANCE_4K_DEFAULT_PROMPT);
      expect(callArgs.prompt.images).toEqual([mockInputBuffer]);
      expect(callArgs.providerOptions?.google?.imageConfig?.imageSize).toBe('4K');
      expect(result.url).toBe('https://mock-s3.pelita.tech/output.jpg');
    });

    it('throws an error if no image input is provided for 4K-Enhance', async () => {
      await expect(enhance4K({ image: null })).rejects.toThrow(
        '[imageEditor:4K-Enhance] An image buffer or valid image URL is required'
      );
    });

    it('allows overriding the prompt in 4K-Enhance', async () => {
      await enhance4K({
        image: mockInputBuffer,
        prompt: 'Custom remaster with enhanced lighting',
      });

      const callArgs = vi.mocked(generateImage).mock.calls[0][0];
      expect(callArgs.prompt.text).toBe('Custom remaster with enhanced lighting');
    });
  });

  describe('Unified dispatcher and backward compatibility', () => {
    it('dispatches to Dark-Dramatize via imageEditor({ mode: "Dark-Dramatize" })', async () => {
      const result = await imageEditor({
        mode: 'Dark-Dramatize',
        image: mockInputBuffer,
      });

      expect(generateImage).toHaveBeenCalledOnce();
      expect(result.url).toBe('https://mock-s3.pelita.tech/output.jpg');
    });

    it('dispatches to 4K-Enhance via imageEditor({ mode: "4K-Enhance" })', async () => {
      const result = await imageEditor({
        mode: '4K-Enhance',
        image: mockInputBuffer,
      });

      expect(generateImage).toHaveBeenCalledOnce();
      expect(result.url).toBe('https://mock-s3.pelita.tech/output.jpg');
    });

    it('throws for unsupported mode in imageEditor', async () => {
      await expect(
        imageEditor({
          mode: 'unsupported-mode' as any,
        })
      ).rejects.toThrow('[imageEditor] Unsupported mode');
    });

    it('works with backward-compatible enhanceImage() alias', async () => {
      const result = await enhanceImage({
        image: mockInputBuffer,
      });

      expect(generateImage).toHaveBeenCalledOnce();
      expect(result.url).toBe('https://mock-s3.pelita.tech/output.jpg');
    });
  });
});

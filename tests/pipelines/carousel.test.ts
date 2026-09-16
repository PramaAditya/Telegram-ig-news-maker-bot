import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runCarouselDarkPipeline,
  generateCarouselDarkMedia,
  carouselDarkTemplateConfig,
} from '../../src/agents/pipelines/image/poros.perjuangan/carousel_dark.js';
import {
  runCarouselMultiImagesPipeline,
  generateCarouselMultiImagesMedia,
  carouselMultiImagesTemplateConfig,
} from '../../src/agents/pipelines/image/poros.perjuangan/carousel_multi_images.js';
import { generateObject, generateText } from 'ai';
import { imageEditor } from '../../src/utils/imageEditor/index.js';
import {
  runSinglePagePipeline,
  generateSinglePageMedia,
  singlePageTemplateConfig,
} from '../../src/agents/pipelines/image/poros.perjuangan/single_page.js';
import * as media from '../../src/media.js';
import * as queue from '../../src/db/queue.js';
import * as curator from '../../src/agents/image-curator/index.js';
import * as s3 from '../../src/s3.js';

// Mock AI SDK
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateObject: vi.fn(),
    generateText: vi.fn(),
  };
});

// Mock imageEditor & imageGenerator
vi.mock('../../src/utils/imageEditor/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/imageEditor/index.js')>();
  return {
    ...actual,
    imageEditor: vi.fn().mockResolvedValue({
      url: 'https://mock-s3.pelita.tech/cover-dramatic.jpg',
      buffer: Buffer.from('mock-dramatic-cover'),
      mediaType: 'image/jpeg',
    }),
    darkDramatize: vi.fn().mockResolvedValue({
      url: 'https://mock-s3.pelita.tech/cover-dramatic.jpg',
      buffer: Buffer.from('mock-dramatic-cover'),
      mediaType: 'image/jpeg',
    }),
    imageGenerator: vi.fn().mockResolvedValue({
      url: 'https://mock-s3.pelita.tech/generated-slide.jpg',
      buffer: Buffer.from('mock-generated-slide'),
      mediaType: 'image/jpeg',
    }),
  };
});

// Mock Media Renderer API
vi.mock('../../src/media.js', () => ({
  generateMedia: vi.fn(),
}));

// Mock Database Queue
vi.mock('../../src/db/queue.js', () => ({
  insertQueueItem: vi.fn(),
}));

// Mock Image Curator
vi.mock('../../src/agents/image-curator/index.js', () => ({
  curateImages: vi.fn(),
}));
// Mock S3 Upload
vi.mock('../../src/s3.js', () => ({
  uploadToS3: vi.fn().mockResolvedValue('https://mock-s3.pelita.tech/uploaded-slide.jpg'),
}));


describe('Carousel Pipelines Workflow Tests', () => {
  let mockContext: any;
  let mockResearch: any;
  let mockTelegram: any;
  let mockStatusMsg: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(media.generateMedia).mockReset();

    mockTelegram = {
      editMessageText: vi.fn().mockResolvedValue(true),
      sendPhoto: vi.fn().mockResolvedValue(true),
      sendMessage: vi.fn().mockResolvedValue(true),
    };

    mockStatusMsg = {
      chat: { id: 999 },
      message_id: 111,
    };

    mockContext = {
      chatId: '999',
      messageId: 111,
      userInput: 'Breaking news on climate tech',
      currentYear: 2026,
      currentDateStr: '16 September 2026',
      baseSystemPrompt: 'Mock Base System Prompt',
      telegram: mockTelegram,
      statusMsg: mockStatusMsg,
      uploadedMedia: [],
      connectionId: 1,
      settings: {
        id: 1,
        logoImageUrl: 'https://storage.pelita.tech/logo.png',
      },
    };

    mockResearch = {
      researchText: 'Significant breakthrough in clean solar technology announced today.',
      scrapedImageUrl: 'https://news.com/article/hero.jpg',
      processedMedia: [],
    };
    // Mock fetch for preview and curated image downloads
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
    } as any);

    // Mock insertQueueItem
    vi.mocked(queue.insertQueueItem).mockResolvedValue([
      { id: 42, connectionId: 1, templateId: 'test', status: 'pending' },
    ] as any);
  });

  describe('Carousel Dark Workflow', () => {
    it('generates media payload correctly with generateCarouselDarkMedia', async () => {
      vi.mocked(media.generateMedia).mockResolvedValueOnce([
        'https://renderer.pelita.tech/output_cover.png',
        'https://renderer.pelita.tech/output_slide1.png',
        'https://renderer.pelita.tech/output_slide2.png',
      ]);

      const templateData = {
        title: 'Sensational **Headline**',
        coverImageUrl: 'https://mock-s3.pelita.tech/cover.jpg',
        slides: ['First explanation paragraph.', 'Second explanation paragraph.'],
      };

      const result = await generateCarouselDarkMedia(templateData, mockContext.settings);

      expect(media.generateMedia).toHaveBeenCalledWith(
        '/render/image/poros.perjuangan/carousel_dark',
        expect.objectContaining({
          viewport: { width: 1080, height: 1350 },
          pages: expect.arrayContaining([
            expect.objectContaining({ file: 'cover' }),
            expect.objectContaining({ file: 'slide' }),
          ]),
        })
      );

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'image', url: 'https://renderer.pelita.tech/output_cover.png' });
    });

    it('executes full runCarouselDarkPipeline end-to-end orchestration', async () => {
      // 1. Mock Content Generation (generateObject)
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          title: 'Solar Breakthrough Announced Today',
          slides: [
            'Scientists have created a high-efficiency cell.',
            'Mass production will begin next year.',
          ],
          source_name: 'Reuters',
          image_prompt: 'High-tech clean energy laboratory',
        },
      } as any);

      // 2. Mock Slide text bolding (generateText)
      vi.mocked(generateText)
        .mockResolvedValueOnce({ text: 'Scientists have created a **high-efficiency cell**.' } as any)
        .mockResolvedValueOnce({ text: 'Mass production will begin **next year**.' } as any);

      // 3. Mock Renderer API
      vi.mocked(media.generateMedia).mockResolvedValueOnce([
        'https://renderer.pelita.tech/dark_cover.jpg',
        'https://renderer.pelita.tech/dark_slide_1.jpg',
        'https://renderer.pelita.tech/dark_slide_2.jpg',
      ]);

      await runCarouselDarkPipeline(mockContext, mockResearch);

      // Phase 2: Content generation verified
      expect(generateObject).toHaveBeenCalledOnce();

      // Phase 3: darkDramatize verified with correct parameters
      // Phase 3: imageEditor verified with correct parameters
      expect(imageEditor).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'Dark-Dramatize',
        image: null,
        scrapedImageUrl: 'https://news.com/article/hero.jpg',
        searchQuery: 'Solar Breakthrough Announced Today',
        prompt: 'High-tech clean energy laboratory',
        uploadToS3: true,
      }));

      // Phase 4: Slide markdown bolding verified
      expect(generateText).toHaveBeenCalledTimes(2);

      // Phase 4: Renderer API called with 3 pages (cover + 2 slides)
      expect(media.generateMedia).toHaveBeenCalledWith(
        '/render/image/poros.perjuangan/carousel_dark',
        expect.objectContaining({
          pages: expect.arrayContaining([
            expect.objectContaining({ file: 'cover' }),
            expect.objectContaining({ file: 'slide' }),
          ]),
        })
      );

      // Phase 5: Queue item inserted with proper status & media URLs
      expect(queue.insertQueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: carouselDarkTemplateConfig.id,
          status: 'pending',
          media: [
            { type: 'image', url: 'https://renderer.pelita.tech/dark_cover.jpg' },
            { type: 'image', url: 'https://renderer.pelita.tech/dark_slide_1.jpg' },
            { type: 'image', url: 'https://renderer.pelita.tech/dark_slide_2.jpg' },
          ],
        })
      );

      // Phase 5: Telegram notifications sent to user
      expect(mockTelegram.sendPhoto).toHaveBeenCalled();
      expect(mockTelegram.editMessageText).toHaveBeenCalledWith(
        999,
        111,
        undefined,
        expect.stringContaining('Berhasil diselesaikan')
      );
    });
  });

  describe('Carousel Multi Images Workflow', () => {
    it('generates media payload correctly with generateCarouselMultiImagesMedia', async () => {
      vi.mocked(media.generateMedia).mockResolvedValueOnce([
        'https://renderer.pelita.tech/multi_cover.png',
        'https://renderer.pelita.tech/multi_slide1.png',
        'https://renderer.pelita.tech/multi_slide2.png',
        'https://renderer.pelita.tech/multi_slide3.png',
      ]);

      const templateData = {
        title: 'Multi Image Title',
        coverImageUrl: 'https://mock-s3.pelita.tech/cover.jpg',
        slides: [
          { text: 'Slide 1 text', slide_image: 'https://cdn.com/slide1.jpg' },
          { text: 'Slide 2 text', slide_image: 'https://cdn.com/slide2.jpg' },
          { text: 'Slide 3 text', slide_image: 'https://cdn.com/slide3.jpg' },
        ],
      };

      const result = await generateCarouselMultiImagesMedia(templateData, mockContext.settings);

      expect(media.generateMedia).toHaveBeenCalledWith(
        '/render/image/poros.perjuangan/carousel_multi_images',
        expect.objectContaining({
          viewport: { width: 1080, height: 1350 },
          pages: expect.arrayContaining([
            expect.objectContaining({ file: 'cover' }),
            expect.objectContaining({ file: 'slide' }),
          ]),
        })
      );

      expect(result).toHaveLength(4);
    });

    it('executes full runCarouselMultiImagesPipeline end-to-end orchestration', async () => {
      // 1. Mock Content Generation with 3 slides & search queries
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          title: 'Global Tech Summit Highlights',
          slides: [
            { text: 'Opening keynote revealed quantum chips.', image_search_query: 'quantum chip computer' },
            { text: 'Second day focused on AI robotics.', image_search_query: 'humanoid robot factory' },
            { text: 'Closing session signed ethical agreements.', image_search_query: 'diplomats signing agreement' },
          ],
          source_name: 'TechCrunch',
          image_prompt: 'Futuristic technology summit stage',
        },
      } as any);

      // 2. Mock Image Curator for each slide
      vi.mocked(curator.curateImages)
        .mockResolvedValueOnce([{ originalUrl: 'https://cdn.com/curated1.jpg', relevanceScore: 90, description: 'quantum' }])
        .mockResolvedValueOnce([{ originalUrl: 'https://cdn.com/curated2.jpg', relevanceScore: 85, description: 'robot' }])
        .mockResolvedValueOnce([{ originalUrl: 'https://cdn.com/curated3.jpg', relevanceScore: 95, description: 'signing' }]);

      // 3. Mock Slide text bolding
      vi.mocked(generateText)
        .mockResolvedValueOnce({ text: 'Opening keynote revealed **quantum chips**.' } as any)
        .mockResolvedValueOnce({ text: 'Second day focused on **AI robotics**.' } as any)
        .mockResolvedValueOnce({ text: 'Closing session signed **ethical agreements**.' } as any);

      // 4. Mock Renderer API (4 slides: 1 cover + 3 slide pages)
      vi.mocked(media.generateMedia).mockResolvedValueOnce([
        'https://renderer.pelita.tech/mi_cover.jpg',
        'https://renderer.pelita.tech/mi_slide_1.jpg',
        'https://renderer.pelita.tech/mi_slide_2.jpg',
        'https://renderer.pelita.tech/mi_slide_3.jpg',
      ]);

      await runCarouselMultiImagesPipeline(mockContext, mockResearch);

      // Content generation verified
      expect(generateObject).toHaveBeenCalledOnce();

      // Cover dramatic generation verified
      expect(imageEditor).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'Dark-Dramatize',
        image: null,
        scrapedImageUrl: 'https://news.com/article/hero.jpg',
        searchQuery: 'Global Tech Summit Highlights',
        prompt: 'Futuristic technology summit stage',
        uploadToS3: true,
      }));

      // 3 slides curated
      expect(curator.curateImages).toHaveBeenCalledTimes(3);

      // Renderer called
      expect(media.generateMedia).toHaveBeenCalledWith(
        '/render/image/poros.perjuangan/carousel_multi_images',
        expect.any(Object)
      );

      // Queue inserted
      expect(queue.insertQueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: carouselMultiImagesTemplateConfig.id,
          status: 'pending',
          media: expect.arrayContaining([
            { type: 'image', url: 'https://renderer.pelita.tech/mi_cover.jpg' },
          ]),
        })
      );

      // Telegram notified
      expect(mockTelegram.sendPhoto).toHaveBeenCalled();
    });
  });

  describe('Single Page Post Workflow', () => {
    it('generates media payload correctly with generateSinglePageMedia', async () => {
      vi.mocked(media.generateMedia).mockResolvedValueOnce([
        'https://renderer.pelita.tech/single_page.png',
      ]);

      const templateData = {
        title: 'Sensational Single Page Headline',
        description: 'Paragraph one.\n\nParagraph two.',
        coverImageUrl: 'https://mock-s3.pelita.tech/cover.jpg',
      };

      const result = await generateSinglePageMedia(templateData, mockContext.settings);

      expect(media.generateMedia).toHaveBeenCalledWith(
        '/render/image/poros.perjuangan/single_page',
        expect.objectContaining({
          viewport: { width: 1080, height: 1350 },
          pages: [
            expect.objectContaining({ file: 'cover' }),
          ],
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: 'image', url: 'https://renderer.pelita.tech/single_page.png' });
    });

    it('executes full runSinglePagePipeline end-to-end orchestration', async () => {
      // 1. Mock Content Generation
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          title: 'Single Page Headline Title',
          description: 'This is the first paragraph.\n\nThis is the second paragraph.',
          source_name: 'Al Jazeera',
          image_prompt: 'Dramatic political summit scene',
        },
      } as any);

      // 2. Mock Paragraph text bolding (2 paragraphs)
      vi.mocked(generateText)
        .mockResolvedValueOnce({ text: 'This is the **first paragraph**.' } as any)
        .mockResolvedValueOnce({ text: 'This is the **second paragraph**.' } as any);

      // 3. Mock Renderer API
      vi.mocked(media.generateMedia).mockResolvedValueOnce([
        'https://renderer.pelita.tech/single_page_output.jpg',
      ]);

      await runSinglePagePipeline(mockContext, mockResearch);

      // Content generation verified
      expect(generateObject).toHaveBeenCalledOnce();

      // Phase 3: darkDramatize verified
      // Phase 3: imageEditor verified
      expect(imageEditor).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'Dark-Dramatize',
        image: null,
        scrapedImageUrl: 'https://news.com/article/hero.jpg',
        searchQuery: 'Single Page Headline Title',
        prompt: 'Dramatic political summit scene',
        uploadToS3: true,
      }));

      // Paragraph bolding verified (2 calls for 2 paragraphs)
      expect(generateText).toHaveBeenCalledTimes(2);

      // Queue inserted
      expect(queue.insertQueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: singlePageTemplateConfig.id,
          status: 'pending',
          media: [{ type: 'image', url: 'https://renderer.pelita.tech/single_page_output.jpg' }],
        })
      );

      // Telegram notified
      expect(mockTelegram.sendPhoto).toHaveBeenCalled();
    });
  });
});

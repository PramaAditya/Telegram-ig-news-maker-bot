import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runResearchPhase } from '../../src/agents/research.js';
import { exaService } from '../../src/utils/exa.js';
import { firecrawlService } from '../../src/utils/firecrawl.js';
import * as s3 from '../../src/s3.js';
import { generateText } from 'ai';

// We mock the AI generation, Exa, and Firecrawl APIs to test the orchestration.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});
vi.mock('../../src/utils/exa', () => ({
  exaService: {
    search: vi.fn(),
    getContents: vi.fn(),
  },
}));

vi.mock('../../src/utils/firecrawl', () => ({
  firecrawlService: {
    search: vi.fn(),
    scrape: vi.fn(),
  },
}));

vi.mock('../../src/s3', () => ({
  uploadToS3: vi.fn().mockResolvedValue('https://mock-s3-url.com/image.jpg'),
}));

describe('runResearchPhase', () => {
  let mockContext: any;
  let mockTelegram: any;
  let mockStatusMsg: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTelegram = {
      editMessageText: vi.fn().mockResolvedValue(true),
    };
    mockStatusMsg = {
      chat: { id: 123 },
      message_id: 456,
    };

    mockContext = {
      chatId: '123',
      messageId: 456,
      userInput: 'Test search about AI',
      currentYear: 2026,
      currentDateStr: '2026-06-18',
      baseSystemPrompt: 'Mock Prompt',
      telegram: mockTelegram,
      statusMsg: mockStatusMsg,
      uploadedMedia: [],
      connectionId: 1,
      settings: {},
    };

    // Default mock response from `generateText`
    // We are simulating the AI returning a research text with an image markdown
    vi.mocked(generateText).mockResolvedValue({
      text: 'Here is some research.\n\n### Relevant Images\n![A cool AI graphic](https://example.com/ai.jpg)',
    } as any);
  });

  it('calls generateText and returns the parsed output with extracted images', async () => {
    const result = await runResearchPhase(mockContext);

    expect(generateText).toHaveBeenCalledOnce();
    expect(result.researchText).toContain('Here is some research');
    
    // The markdown extractor should find this URL
    expect(result.scrapedImageUrls).toContain('https://example.com/ai.jpg');
    
    // Processed media array should be passed through
    expect(result.processedMedia).toEqual([]);
    
    // Should update telegram message at the end
    expect(mockTelegram.editMessageText).toHaveBeenCalledWith(
      123, 456, undefined, '✍️ Menyusun konten...'
    );
  });

  it('retries when generateText fails and eventually falls back', async () => {
    // Mock the AI throwing 3 times to exhaust retries
    vi.mocked(generateText)
      .mockRejectedValueOnce(new Error('API Down'))
      .mockRejectedValueOnce(new Error('API Down'))
      .mockRejectedValueOnce(new Error('API Down'));

    // Set timeout to 0 for tests to run quickly despite retry delay logic
    const _originalSetTimeout = global.setTimeout;
    global.setTimeout = ((fn: Function) => fn()) as any;

    const result = await runResearchPhase(mockContext);

    // AI should be called 3 times (maxRetries)
    expect(generateText).toHaveBeenCalledTimes(3);
    
    // Fallback text should include original user input
    expect(result.researchText).toContain('Raw Input:');
    expect(result.researchText).toContain('Test search about AI');
    
    global.setTimeout = _originalSetTimeout;
  });

  it('runs tool searchWeb correctly prioritizing Exa and parsing images', async () => {
    // First, we need to extract the searchWeb tool that gets passed into generateText
    await runResearchPhase(mockContext);
    
    const generateTextArgs = vi.mocked(generateText).mock.calls[0][0];
    const tools = generateTextArgs.tools as any;
    
    expect(tools.searchWeb).toBeDefined();
    
    // Mock Exa to succeed and return an image
    vi.mocked(exaService.search).mockResolvedValueOnce({
      results: [
        { title: 'Result 1', url: 'https://foo.com', image: 'https://foo.com/img.jpg' }
      ]
    });

    // Execute the tool as the AI would
    const toolResultJSON = await tools.searchWeb.execute({ query: 'AI advancements' }, { toolCallId: '123', messages: [] });
    
    expect(exaService.search).toHaveBeenCalledWith('AI advancements', expect.any(Object));
    expect(firecrawlService.search).not.toHaveBeenCalled();
    expect(toolResultJSON).toContain('https://foo.com/img.jpg');
  });

  it('falls back to firecrawl if Exa search fails', async () => {
    await runResearchPhase(mockContext);
    
    const generateTextArgs = vi.mocked(generateText).mock.calls[0][0];
    const tools = generateTextArgs.tools as any;
    
    // Mock Exa to fail
    vi.mocked(exaService.search).mockRejectedValueOnce(new Error('Exa out of credits'));
    
    // Mock Firecrawl to succeed
    vi.mocked(firecrawlService.search).mockResolvedValueOnce({
      data: [
        { metadata: { ogImage: 'https://firecrawl.com/og.jpg' } }
      ]
    });

    const toolResultJSON = await tools.searchWeb.execute({ query: 'AI advancements' }, { toolCallId: '123', messages: [] });
    
    expect(exaService.search).toHaveBeenCalled();
    expect(firecrawlService.search).toHaveBeenCalledWith('AI advancements', expect.any(Object));
    expect(toolResultJSON).toContain('firecrawl.com/og.jpg');
  });

  it('runs tool scrapeUrl correctly prioritizing Exa getContents', async () => {
    await runResearchPhase(mockContext);
    
    const generateTextArgs = vi.mocked(generateText).mock.calls[0][0];
    const tools = generateTextArgs.tools as any;
    
    expect(tools.scrapeUrl).toBeDefined();
    
    // Mock Exa to succeed
    vi.mocked(exaService.getContents).mockResolvedValueOnce({
      results: [
        { text: '# Hello World Markdown', image: 'https://exa.ai/hero.jpg' }
      ]
    });

    const toolResultMd = await tools.scrapeUrl.execute({ url: 'https://exa.ai' }, { toolCallId: '123', messages: [] });
    
    expect(exaService.getContents).toHaveBeenCalledWith('https://exa.ai', expect.any(Object));
    expect(firecrawlService.scrape).not.toHaveBeenCalled();
    expect(toolResultMd).toBe('# Hello World Markdown');
  });

  it('falls back to firecrawl scrape if Exa getContents fails', async () => {
    await runResearchPhase(mockContext);
    
    const generateTextArgs = vi.mocked(generateText).mock.calls[0][0];
    const tools = generateTextArgs.tools as any;
    
    // Mock Exa to fail
    vi.mocked(exaService.getContents).mockRejectedValueOnce(new Error('Exa error'));
    
    // Mock Firecrawl to succeed
    vi.mocked(firecrawlService.scrape).mockResolvedValueOnce({
      metadata: { image: 'https://fire.com/hero.jpg' },
      markdown: 'Firecrawl Markdown Content'
    });

    const toolResultMd = await tools.scrapeUrl.execute({ url: 'https://fire.com' }, { toolCallId: '123', messages: [] });
    
    expect(exaService.getContents).toHaveBeenCalled();
    expect(firecrawlService.scrape).toHaveBeenCalledWith('https://fire.com', expect.any(Object));
    expect(toolResultMd).toBe('Firecrawl Markdown Content');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runOpinionPhase } from '../../src/agents/editorial/opinion.js';
import {
  getEditorialAgentConfigs,
  buildPromptContextFromInsights,
} from '../../src/agents/editorial/registry.js';
import { generateText } from 'ai';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

describe('Editorial Agents & Registry', () => {
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      chatId: '123',
      messageId: 456,
      userInput: 'Kebijakan Subsidi BBM Baru',
      currentYear: 2026,
      currentDateStr: '18 September 2026',
      baseSystemPrompt: 'Base Prompt',
      telegram: null,
      statusMsg: null,
      settings: {
        editorialGuidelines: 'Fokus pada kritik subsidi yang tidak tepat sasaran.',
        bannedWords: [{ word: 'subsidi', replacement: 'sub$idi', type: 'exact' }],
      },
    };
  });

  describe('runOpinionPhase', () => {
    it('generates opinion text based on research and applies banned words', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Ini adalah opini kritis mengenai subsidi.',
      } as any);

      const opinion = await runOpinionPhase(mockContext, 'Fakta 5W1H tentang subsidi BBM...');

      expect(generateText).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(generateText).mock.calls[0][0];
      expect(callArgs.system).toContain('Fokus pada kritik subsidi yang tidak tepat sasaran.');
      expect(callArgs.system).toContain('CRITICAL MODERATION RULE');
      expect(callArgs.messages?.[0]?.content).toContain('Fakta 5W1H tentang subsidi BBM...');

      // Banned word 'subsidi' should be censored to 'sub$idi'
      expect(opinion).toBe('Ini adalah opini kritis mengenai sub$idi.');
    });

    it('falls back to default structure when generateText returns empty', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: '',
      } as any);

      const _originalSetTimeout = global.setTimeout;
      global.setTimeout = ((fn: Function) => fn()) as any;

      const opinion = await runOpinionPhase(mockContext, 'Fakta...');
      expect(opinion).toContain('Tesis Utama');
      expect(opinion).toContain('Poin Kritis');

      global.setTimeout = _originalSetTimeout;
    });
  });

  describe('Registry helpers', () => {
    it('returns all registered agent configs', () => {
      const configs = getEditorialAgentConfigs();
      expect(configs.map(c => c.id)).toEqual(['research', 'opinion']);
    });

    it('builds prompt context filtering by requiredInsights', () => {
      const insights = {
        research: 'Fakta A, Fakta B',
        opinion: 'Argumen X, Argumen Y',
      };

      const researchOnly = buildPromptContextFromInsights(insights, ['research']);
      expect(researchOnly).toContain('BACKGROUND RESEARCH / FACTS TO USE');
      expect(researchOnly).toContain('Fakta A, Fakta B');
      expect(researchOnly).not.toContain('EDITORIAL OPINION');

      const both = buildPromptContextFromInsights(insights, ['research', 'opinion']);
      expect(both).toContain('BACKGROUND RESEARCH / FACTS TO USE');
      expect(both).toContain('EDITORIAL OPINION & CORE ARGUMENT');
      expect(both).toContain('Argumen X, Argumen Y');
    });

    it('returns empty string when insights is empty', () => {
      expect(buildPromptContextFromInsights(null)).toBe('');
      expect(buildPromptContextFromInsights({})).toBe('');
    });
  });
});

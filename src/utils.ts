import { createGoogleGenerativeAI } from '@ai-sdk/google';
import dotenv from 'dotenv';

dotenv.config();

export const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      console.warn(`[Telegram API Retry ${i + 1}/${retries}] Failed: ${error.message}`);
      if (i === retries - 1) throw error;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  throw new Error("Unreachable");
};

export const getBaseSystemPrompt = (currentDateStr: string, currentYear: number) => `You are a strict, automated editorial assistant crafting news based content for social media.
You operate entirely in BAHASA INDONESIA. Your tone should be highly informative, objective, and strictly journalistic.

CRITICAL CONTEXT REGARDING TIME:
Today's date is: ${currentDateStr}.
The current year is: ${currentYear}.
You MUST use the year ${currentYear} (and the current month if needed) in your web searches. Completely ignore any internal knowledge cutoff dates that suggest we are in the past.
`;

export interface MediaItem {
  type: 'image' | 'video';
  url: string;
  mimeType?: string;
  buffer?: Buffer;
  s3Url?: string;
}

export interface PipelineContext {
  chatId: string;
  messageId: number;
  userInput: string;
  uploadedMedia?: MediaItem[];
  telegram: any;
  statusMsg: any;
  settings: any;
  currentDateStr: string;
  currentYear: number;
  baseSystemPrompt: string;
}

export interface ResearchResult {
  researchText: string;
  scrapedImageUrl: string | null;
  scrapedImageUrls?: string[];
  processedMedia: MediaItem[];
}

export const googleAI = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

import { db } from './index.js';
import { settingsTable } from './schema.js';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';
import seedData from '../config/banned-words.json' with { type: 'json' };

dotenv.config();

export async function getSettings() {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  
  if (rows.length === 0) {
    // Load seed data for banned words
    let seedBannedWords = seedData || [];

    // Ensure we create a default row if it doesn't exist
    const defaultSettings = { 
      id: 1, 
      postingSlots: [],
      bannedWords: seedBannedWords as { word: string, replacement: string, type: 'exact' | 'partial' }[],
      cronIntervalMinutes: 30, 
      cronStartHour: 6, 
      cronEndHour: 23,
      editorialGuidelines: process.env.EDITORIAL_GUIDELINES || null,
      lastAutoPublishAt: null,
      logoImageUrl: process.env.LOGO_IMAGE_URL || null,
      ctaImageUrl: process.env.CTA_IMAGE_URL || null,
      bufferApiKey: process.env.BUFFER_API_KEY || null,
      bufferChannelId: process.env.BUFFER_CHANNEL_ID || null,
      bufferChannelNetwork: 'instagram', // Default fallback
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null
    };
    await db.insert(settingsTable).values(defaultSettings);
    return defaultSettings;
  }
  
  const settings = rows[0];
  
  // Provide fallback to env vars if database column is empty
  return {
    ...settings,
    postingSlots: settings.postingSlots || [],
    bannedWords: settings.bannedWords || [],
    editorialGuidelines: settings.editorialGuidelines || process.env.EDITORIAL_GUIDELINES || null,
    logoImageUrl: settings.logoImageUrl || process.env.LOGO_IMAGE_URL || null,
    ctaImageUrl: settings.ctaImageUrl || process.env.CTA_IMAGE_URL || null,
    bufferApiKey: settings.bufferApiKey || process.env.BUFFER_API_KEY || null,
    bufferChannelId: settings.bufferChannelId || process.env.BUFFER_CHANNEL_ID || null,
    bufferChannelNetwork: settings.bufferChannelNetwork || 'instagram',
    telegramBotToken: settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || null
  };
}
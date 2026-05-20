import { db } from './index.js';
import { settingsTable } from './schema.js';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

export async function getSettings() {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  
  if (rows.length === 0) {
    // Ensure we create a default row if it doesn't exist
    const defaultSettings = { 
      id: 1, 
      postingSlots: [],
      cronIntervalMinutes: 30, 
      cronStartHour: 6, 
      cronEndHour: 23,
      logoImageUrl: process.env.LOGO_IMAGE_URL || null,
      ctaImageUrl: process.env.CTA_IMAGE_URL || null,
      bufferApiKey: process.env.BUFFER_API_KEY || null,
      bufferInstagramChannelId: process.env.BUFFER_INSTAGRAM_CHANNEL_ID || null,
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
    logoImageUrl: settings.logoImageUrl || process.env.LOGO_IMAGE_URL || null,
    ctaImageUrl: settings.ctaImageUrl || process.env.CTA_IMAGE_URL || null,
    bufferApiKey: settings.bufferApiKey || process.env.BUFFER_API_KEY || null,
    bufferInstagramChannelId: settings.bufferInstagramChannelId || process.env.BUFFER_INSTAGRAM_CHANNEL_ID || null,
    telegramBotToken: settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || null
  };
}
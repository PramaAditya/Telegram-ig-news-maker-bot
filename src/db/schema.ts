import { pgTable, text, serial, timestamp, jsonb, bigint, integer } from 'drizzle-orm/pg-core';

export const queueTable = pgTable('queue', {
  id: serial('id').primaryKey(),
  sortOrder: serial('sort_order'),
  templateId: text('template_id').notNull().default('image-multiple:interval'),
  templateData: jsonb('template_data').$type<any>().notNull().default({}),
  text: text('text').notNull(),
  media: jsonb('media').$type<{ type: 'image' | 'video', url: string }[]>().notNull(),
  status: text('status').notNull().default('pending'), // pending, published, error
  errorLog: text('error_log'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
});

export const jobsTable = pgTable('jobs', {
  id: serial('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  messageId: bigint('message_id', { mode: 'number' }).notNull(),
  templateId: text('template_id').notNull().default('image-multiple:interval'),
  text: text('text').notNull(),
  media: jsonb('media').$type<{ type: 'image' | 'video', url: string, mimeType?: string }[]>().default([]).notNull(),
  status: text('status').notNull().default('pending'), // pending, processing, completed, error
  errorLog: text('error_log'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const settingsTable = pgTable('settings', {
  id: integer('id').primaryKey(), // Always 1
  logoImageUrl: text('logo_image_url'),
  ctaImageUrl: text('cta_image_url'),
  bufferApiKey: text('buffer_api_key'),
  bufferInstagramChannelId: text('buffer_instagram_channel_id'),
  telegramBotToken: text('telegram_bot_token'),
  postingSlots: jsonb('posting_slots').$type<{ day: string, time: string }[]>().default([]).notNull(),
  bannedWords: jsonb('banned_words').$type<{ word: string, replacement: string, type: 'exact' | 'partial' }[]>().default([]).notNull(),
  cronIntervalMinutes: integer('cron_interval_minutes').default(30).notNull(),
  cronStartHour: integer('cron_start_hour').default(6).notNull(),
  cronEndHour: integer('cron_end_hour').default(23).notNull(),
  lastAutoPublishAt: timestamp('last_auto_publish_at'),
});

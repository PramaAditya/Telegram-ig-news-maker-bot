import { pgTable, text, serial, timestamp, jsonb, bigint } from 'drizzle-orm/pg-core';

export const queueTable = pgTable('queue', {
  id: serial('id').primaryKey(),
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
  text: text('text').notNull(),
  media: jsonb('media').$type<{ type: 'image' | 'video', url: string, mimeType?: string }[]>().default([]).notNull(),
  status: text('status').notNull().default('pending'), // pending, processing, completed, error
  errorLog: text('error_log'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

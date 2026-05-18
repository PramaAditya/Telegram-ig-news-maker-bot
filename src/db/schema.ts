import { pgTable, text, serial, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const queueTable = pgTable('queue', {
  id: serial('id').primaryKey(),
  text: text('text').notNull(),
  media: jsonb('media').$type<{ type: 'image' | 'video', url: string }[]>().notNull(),
  status: text('status').notNull().default('pending'), // pending, published, error
  errorLog: text('error_log'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
});

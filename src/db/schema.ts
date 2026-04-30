import { pgTable, serial, text, timestamp, varchar, jsonb } from 'drizzle-orm/pg-core';

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  chatId: varchar('chat_id', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(), // 'user', 'assistant', 'system'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

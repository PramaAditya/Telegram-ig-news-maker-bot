import { db } from './index.js';
import { queueTable } from './schema.js';
import { sql } from 'drizzle-orm';

export async function insertQueueItem(data: {
  templateId: string;
  templateData: any;
  text: string;
  media: { type: 'image' | 'video', url: string }[];
  researchResult?: string;
  status?: string; // e.g., 'pending', 'draft', 'published', 'error'
}) {
  // Explicitly calculate the next sort order so it appears at the end of the queue
  const [maxRecord] = await db.select({ maxSort: sql<number>`MAX(${queueTable.sortOrder})` }).from(queueTable);
  const nextSortOrder = (maxRecord?.maxSort || 0) + 10;
  
  return await db.insert(queueTable).values({
    sortOrder: nextSortOrder,
    templateId: data.templateId,
    templateData: data.templateData,
    text: data.text,
    media: data.media,
    status: data.status || 'pending',
    researchResult: data.researchResult
  }).returning();
}

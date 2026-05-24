import express from 'express';
import cors from 'cors';
import { db } from './db/index.js';
import { jobsTable, queueTable, settingsTable, ideasTable } from './db/schema.js';
import { getSettings } from './db/settings.js';
import { eq, asc, desc, sql } from 'drizzle-orm';
import { TEMPLATES } from './templates.js';
import { generateMedia } from './media.js';
import { publishToBuffer, fetchBufferChannelNetwork } from './buffer.js';
import { runAutomatedPipeline } from './agent.js';
import multer from 'multer';
import { uploadToS3 } from './s3.js';
import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files for the dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Middleware to protect trigger API routes
const requireTriggerAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const triggerKey = process.env.TRIGGER_API_KEY;
  const authHeader = req.headers.authorization;
  if (!triggerKey || authHeader !== `Bearer ${triggerKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Middleware to protect dashboard CRUD API routes
const requireDashboardAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const dashboardPassword = process.env.DASHBOARD_PASSWORD;
  const authHeader = req.headers.authorization;
  if (!dashboardPassword || authHeader !== `Bearer ${dashboardPassword}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.post('/api/trigger-publish', requireTriggerAuth, async (req, res) => {
  try {
    // Find the oldest pending post
    const pendingPosts = await db.select()
      .from(queueTable)
      .where(eq(queueTable.status, 'pending'))
      .orderBy(asc(queueTable.sortOrder))
      .limit(1);

    if (pendingPosts.length === 0) {
      return res.status(200).json({ message: 'No pending posts to publish.' });
    }

    const post = pendingPosts[0];
    console.log(`[API] Triggering publish for post ID ${post.id}`);

      try {
      const settings = await getSettings();
      let mediaToPublish = [...post.media];
      const ctaUrl = settings.ctaImageUrl;
      if (ctaUrl && !mediaToPublish.some(m => m.url === ctaUrl)) {
        mediaToPublish.push({ type: 'image', url: ctaUrl });
      }

      // Publish to buffer (using shareNow in buffer.ts)
      const result = await publishToBuffer(mediaToPublish, post.text, post.publishMetadata);
      
      // Update DB
      await db.update(queueTable)
        .set({
          status: 'published',
          publishedAt: new Date()
        })
        .where(eq(queueTable.id, post.id));

      console.log(`[API] Successfully published post ID ${post.id}`);
      return res.status(200).json({ message: 'Published successfully', postId: post.id, bufferResult: result });
    } catch (publishError: any) {
      console.error(`[API] Failed to publish post ID ${post.id}:`, publishError);
      
      // Update DB with error
      await db.update(queueTable)
        .set({
          status: 'error',
          errorLog: publishError.message || String(publishError)
        })
        .where(eq(queueTable.id, post.id));

      return res.status(500).json({ error: 'Failed to publish to Buffer', details: publishError.message });
    }

  } catch (error: any) {
    console.error('[API] Error in trigger-publish endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- CRUD API Endpoints for Dashboard ---

// POST /api/upload - Upload media to S3
app.post('/api/upload', requireDashboardAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    
    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      return res.status(400).json({ error: 'Only image and video files are allowed' });
    }

    let ext = '.jpg';
    if (mimeType === 'image/png') ext = '.png';
    else if (mimeType === 'image/webp') ext = '.webp';
    else if (mimeType === 'video/mp4') ext = '.mp4';
    else if (mimeType === 'video/quicktime') ext = '.mov';
    else if (mimeType === 'video/webm') ext = '.webm';
    
    const s3Url = await uploadToS3(buffer, mimeType, ext);
    if (!s3Url) throw new Error('Failed to upload to S3');

    res.json({ url: s3Url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/generate-content - Enqueue a new generation job from dashboard
app.post('/api/generate-content', requireDashboardAuth, async (req, res) => {
  try {
    const { text, mediaUrl, mediaUrls, templateId } = req.body;
    if (!text) return res.status(400).json({ error: 'Text input is required' });

    let media: { type: 'image' | 'video', url: string }[] = [];
    if (mediaUrls && Array.isArray(mediaUrls)) {
      media = mediaUrls.map((url: string) => ({ 
        type: url.match(/\.(mp4|mov|webm)$/i) ? 'video' : 'image', 
        url 
      }));
    } else if (mediaUrl) {
      media = [{ type: 'image' as const, url: mediaUrl }];
    }

    const result = await db.insert(jobsTable).values({
      chatId: 'DASHBOARD',
      messageId: Date.now(),
      templateId: templateId || 'image:kabar.perjuangan:carousel_dark',
      text,
      media,
      status: 'pending'
    }).returning();

    res.json({ message: 'Job enqueued successfully', job: result[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/templates - List available templates
app.get('/api/templates', requireDashboardAuth, (req, res) => {
  const templatesList = Object.values(TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description
  }));
  res.json(templatesList);
});

// GET /api/ideas - Get ideas
app.get('/api/ideas', requireDashboardAuth, async (req, res) => {
  try {
    const status = req.query.status as string;
    
    const allIdeas = await db.select()
      .from(ideasTable)
      .where(status ? eq(ideasTable.status, status) : undefined)
      .orderBy(desc(ideasTable.createdAt))
      .limit(100);
      
    res.json(allIdeas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ideas/:id/convert - Convert idea to job
app.post('/api/ideas/:id/convert', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [idea] = await db.select().from(ideasTable).where(eq(ideasTable.id, id));
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    
    if (idea.status === 'converted') {
      return res.status(400).json({ error: 'Idea already converted' });
    }

    const { templateId } = req.body;

    await db.insert(jobsTable).values({
      chatId: idea.chatId,
      messageId: idea.messageId,
      text: idea.text,
      media: idea.media,
      templateId: templateId || 'image:kabar.perjuangan:carousel_dark',
      status: 'pending'
    });

    await db.update(ideasTable).set({ status: 'converted' }).where(eq(ideasTable.id, id));
    
    res.json({ message: 'Idea converted to job successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/ideas/:id/status - Update idea status
app.put('/api/ideas/:id/status', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { status } = req.body;
    
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!status || !['pending', 'converted', 'rejected'].includes(status)) {
       return res.status(400).json({ error: 'Invalid status' });
    }

    await db.update(ideasTable).set({ status }).where(eq(ideasTable.id, id));
    res.json({ message: 'Status updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/jobs - Get all jobs (for the jobs page)
app.get('/api/jobs', requireDashboardAuth, async (req, res) => {
  try {
    const allJobs = await db.select()
      .from(jobsTable)
      .orderBy(desc(jobsTable.createdAt))
      .limit(100);
    res.json(allJobs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/jobs/:id/retry - Retry a failed job
app.post('/api/jobs/:id/retry', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid job ID' });

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    if (job.status !== 'error') {
      return res.status(400).json({ error: 'Job is not in an error state' });
    }

    await db.update(jobsTable)
      .set({ 
        status: 'pending', 
        errorLog: null,
        updatedAt: new Date() 
      })
      .where(eq(jobsTable.id, id));
      
    res.json({ success: true, message: 'Job queued for retry' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retry job: ' + error.message });
  }
});

// GET /api/jobs/dashboard - Get active dashboard jobs
app.get('/api/jobs/dashboard', requireDashboardAuth, async (req, res) => {
  try {
    const activeJobs = await db.select()
      .from(jobsTable)
      .where(sql`chat_id = 'DASHBOARD' AND status IN ('pending', 'processing', 'error')`)
      .orderBy(desc(jobsTable.createdAt));
    res.json(activeJobs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

import { generateText } from 'ai';

// POST /api/ai/refine-text - Refine text using AI
app.post('/api/ai/refine-text', requireDashboardAuth, async (req, res) => {
  try {
    const { text, instruction, context } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    if (!process.env.LIGHT_MODEL) return res.status(500).json({ error: 'LIGHT_MODEL is not configured' });

    let prompt = `You are a helpful AI editor. I will provide you with some original text. Your job is to strictly improve and refine the text based on the provided instructions. Output ONLY the finalized refined text. Do not add any conversational filler like "Here is the refined text:". If no specific instruction is provided, just improve the grammar, spelling, and general flow while maintaining the original meaning and tone.\n\n`;
    
    if (context && context.trim()) {
      prompt += `CONTEXT ABOUT THIS TEXT:\n${context}\n\n`;
    }

    if (instruction && instruction.trim()) {
      prompt += `USER INSTRUCTIONS:\n${instruction}\n\n`;
    }

    prompt += `ORIGINAL TEXT:\n${text}`;

    const { text: refinedText } = await generateText({
      model: google(process.env.LIGHT_MODEL),
      prompt: prompt
    });

    res.json({ refinedText });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/slots/generate - Generate posting slots using AI
app.post('/api/settings/slots/generate', requireDashboardAuth, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (!process.env.LIGHT_MODEL) return res.status(500).json({ error: 'LIGHT_MODEL is not configured' });

    // Get current settings to provide context to the LLM
    const settings = await getSettings();
    const currentSlots = settings.postingSlots || [];

    const result = await generateObject({
      model: google(process.env.LIGHT_MODEL),
      system: 'You are an intelligent assistant that manages posting schedules. You will be given the CURRENT posting slots and a user PROMPT. Based on the prompt, you must return the FINAL complete list of posting slots. You can add new slots, remove specific ones, or completely overwrite them depending on what the user asks. Valid days: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. Times MUST be in 24-hour HH:mm format (e.g. 08:12, 19:30). "Everyday" means all 7 days.',
      prompt: `CURRENT SLOTS:\n${JSON.stringify(currentSlots, null, 2)}\n\nUSER PROMPT: "${prompt}"\n\nPlease output the final complete list of slots after applying the user's request.`,
      schema: z.object({
        slots: z.array(z.object({
          day: z.string().describe('Day of the week (e.g., Monday)'),
          time: z.string().describe('24-hour time string in HH:mm format (e.g. "08:12" or "19:30")')
        }))
      })
    });

    const finalSlots = result.object.slots;

    // Save back to DB
    await db.update(settingsTable)
      .set({ postingSlots: finalSlots })
      .where(eq(settingsTable.id, 1));

    res.json({ message: 'Slots generated successfully', slots: finalSlots });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/settings - Get dynamic settings
app.get('/api/settings', requireDashboardAuth, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings - Update settings
app.put('/api/settings', requireDashboardAuth, async (req, res) => {
  try {
    const { 
      logoImageUrl, 
      ctaImageUrl, 
      bufferApiKey, 
      bufferChannelId, 
      telegramBotToken, 
      editorialGuidelines,
      cronIntervalMinutes, 
      cronStartHour, 
      cronEndHour 
    } = req.body;

    const updateData: any = {};
    if (logoImageUrl !== undefined) updateData.logoImageUrl = logoImageUrl;
    if (ctaImageUrl !== undefined) updateData.ctaImageUrl = ctaImageUrl;
    if (bufferApiKey !== undefined) updateData.bufferApiKey = bufferApiKey;
    if (bufferChannelId !== undefined) updateData.bufferChannelId = bufferChannelId;
    if (telegramBotToken !== undefined) updateData.telegramBotToken = telegramBotToken;
    if (editorialGuidelines !== undefined) updateData.editorialGuidelines = editorialGuidelines;
    if (cronIntervalMinutes !== undefined) updateData.cronIntervalMinutes = parseInt(cronIntervalMinutes, 10);
    if (cronStartHour !== undefined) updateData.cronStartHour = parseInt(cronStartHour, 10);
    if (cronEndHour !== undefined) updateData.cronEndHour = parseInt(cronEndHour, 10);
    if (req.body.postingSlots !== undefined) updateData.postingSlots = req.body.postingSlots;
    if (req.body.bannedWords !== undefined) updateData.bannedWords = req.body.bannedWords;

    // Make sure the row exists first
    const currentSettings = await getSettings();

    // Fetch network if buffer API key or channel ID is being updated
    if (
      (bufferApiKey !== undefined || bufferChannelId !== undefined) &&
      (updateData.bufferApiKey || currentSettings.bufferApiKey) &&
      (updateData.bufferChannelId || currentSettings.bufferChannelId)
    ) {
      try {
        const apiKey = updateData.bufferApiKey || currentSettings.bufferApiKey;
        const channelId = updateData.bufferChannelId || currentSettings.bufferChannelId;
        const network = await fetchBufferChannelNetwork(apiKey, channelId);
        updateData.bufferChannelNetwork = network;
      } catch (err: any) {
        console.error("Failed to fetch Buffer channel network:", err);
        // Optionally fail the request or just let it pass with an error log
        // return res.status(400).json({ error: "Failed to validate Buffer Channel ID. Make sure API key and Channel ID are correct." });
      }
    }
    
    await db.update(settingsTable).set(updateData).where(eq(settingsTable.id, 1));
    
    res.json({ message: 'Settings updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/queue - List queue items (filtered by status)
app.get('/api/queue', requireDashboardAuth, async (req, res) => {
  try {
    const status = req.query.status as string || 'pending';
    
    let items;
    if (status === 'pending') {
      items = await db.select().from(queueTable).where(eq(queueTable.status, status)).orderBy(asc(queueTable.sortOrder));
    } else {
      // For published and error, show most recent first
      items = await db.select().from(queueTable).where(eq(queueTable.status, status)).orderBy(desc(queueTable.createdAt));
    }
    
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/queue/:id - Update queue item (e.g. edit text or retry a failed post)
app.put('/api/queue/:id', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { text, templateData } = req.body;
    
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const updateData: any = {};
    if (text !== undefined) updateData.text = text;
    if (templateData !== undefined) updateData.templateData = templateData;

    if (Object.keys(updateData).length > 0) {
      await db.update(queueTable)
        .set(updateData)
        .where(eq(queueTable.id, id));
    }

    res.json({ message: 'Updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/queue/:id/regenerate-media - Re-render media using current draft data
app.post('/api/queue/:id/regenerate-media', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const items = await db.select().from(queueTable).where(eq(queueTable.id, id));
    if (items.length === 0) return res.status(404).json({ error: 'Post not found in queue' });
    
    const post = items[0];
    
    const template = TEMPLATES[post.templateId];
    if (!template) return res.status(400).json({ error: `Template ${post.templateId} not found` });

    try {
      const settings = await getSettings();
      // Re-render the images
      const allPublishUrls = await template.regenerateMedia(post.templateData, settings);

      // Update the DB with the newly generated media URLs
      await db.update(queueTable)
        .set({ media: allPublishUrls })
        .where(eq(queueTable.id, post.id));

      return res.json({ message: 'Media regenerated successfully', media: allPublishUrls });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to regenerate media', details: err.message });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/queue/:id/publish - Publish immediately from dashboard
app.post('/api/queue/:id/publish', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const items = await db.select().from(queueTable).where(eq(queueTable.id, id));
    if (items.length === 0) return res.status(404).json({ error: 'Post not found in queue' });
    
    const post = items[0];
    
      try {
      const settings = await getSettings();
      let mediaToPublish = [...post.media];
      const ctaUrl = settings.ctaImageUrl;
      if (ctaUrl && !mediaToPublish.some(m => m.url === ctaUrl)) {
        mediaToPublish.push({ type: 'image', url: ctaUrl });
      }

      const result = await publishToBuffer(mediaToPublish, post.text, post.publishMetadata);
      
      await db.update(queueTable)
        .set({
          status: 'published',
          publishedAt: new Date()
        })
        .where(eq(queueTable.id, id));
        
      res.json({ message: 'Published successfully', result });
    } catch (publishError: any) {
      await db.update(queueTable)
        .set({
          status: 'error',
          errorLog: publishError.message || String(publishError)
        })
        .where(eq(queueTable.id, post.id));

      return res.status(500).json({ error: 'Failed to publish to Buffer', details: publishError.message });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/queue/:id/retry-error - Move an errored queue item back to pending
app.post('/api/queue/:id/retry-error', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const items = await db.select().from(queueTable).where(eq(queueTable.id, id));
    if (items.length === 0) return res.status(404).json({ error: 'Post not found' });
    
    if (items[0].status !== 'error') {
      return res.status(400).json({ error: 'Only failed posts can be retried' });
    }

    await db.update(queueTable)
      .set({ 
        status: 'pending',
        errorLog: null
      })
      .where(eq(queueTable.id, id));

    res.json({ message: 'Post moved back to pending queue successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/queue/reorder - Reorder entire queue
app.post('/api/queue/reorder', requireDashboardAuth, async (req, res) => {
  try {
    const { orderedIds } = req.body; // Array of IDs in the new order
    if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });

    // Fetch all pending
    const pending = await db.select().from(queueTable)
      .where(eq(queueTable.status, 'pending'))
      .orderBy(asc(queueTable.sortOrder));

    // Create a set of pending IDs for quick validation
    const pendingIds = new Set(pending.map(p => p.id));
    
    // Assign new sortOrders based on index
    // Note: To be safe, we can just use 10 * index
    let sortOrder = 10;
    for (const id of orderedIds) {
      if (pendingIds.has(id)) {
        await db.update(queueTable).set({ sortOrder }).where(eq(queueTable.id, id));
        sortOrder += 10;
      }
    }

    res.json({ message: 'Reordered successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/queue/:id/move - Move item up, down, or to top
app.post('/api/queue/:id/move', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { direction } = req.body; // 'up', 'down', 'top'
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    // Fetch all pending to determine neighbors
    const pending = await db.select().from(queueTable)
      .where(eq(queueTable.status, 'pending'))
      .orderBy(asc(queueTable.sortOrder));
      
    const index = pending.findIndex(p => p.id === id);
    if (index === -1) return res.status(404).json({ error: 'Post not found in pending queue' });

    if (direction === 'top' && index > 0) {
      const firstItem = pending[0];
      const newSortOrder = firstItem.sortOrder - 1; // 1 less than the top item
      await db.update(queueTable).set({ sortOrder: newSortOrder }).where(eq(queueTable.id, id));
    } else if (direction === 'up' && index > 0) {
      const prevItem = pending[index - 1];
      const currentItem = pending[index];
      // Swap sortOrder to swap order
      await db.update(queueTable).set({ sortOrder: prevItem.sortOrder }).where(eq(queueTable.id, currentItem.id));
      await db.update(queueTable).set({ sortOrder: currentItem.sortOrder }).where(eq(queueTable.id, prevItem.id));
    } else if (direction === 'down' && index < pending.length - 1) {
      const nextItem = pending[index + 1];
      const currentItem = pending[index];
      // Swap sortOrder to swap order
      await db.update(queueTable).set({ sortOrder: nextItem.sortOrder }).where(eq(queueTable.id, currentItem.id));
      await db.update(queueTable).set({ sortOrder: currentItem.sortOrder }).where(eq(queueTable.id, nextItem.id));
    }

    res.json({ message: 'Moved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/queue/:id - Delete a queue item
app.delete('/api/queue/:id', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    await db.delete(queueTable).where(eq(queueTable.id, id));
    res.json({ message: 'Deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get(['/', '/*path'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

export const startServer = (port: number = 3000) => {
  if (!process.env.TRIGGER_API_KEY) console.warn('WARNING: TRIGGER_API_KEY is not set in env.');
  if (!process.env.DASHBOARD_PASSWORD) console.warn('WARNING: DASHBOARD_PASSWORD is not set in env. Dashboard will be inaccessible.');
  
  app.listen(port, () => {
    console.log(`API Server is running on port ${port}`);
  });
};


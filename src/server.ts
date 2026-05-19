import express from 'express';
import cors from 'cors';
import { db } from './db/index.js';
import { jobsTable, queueTable, settingsTable } from './db/schema.js';
import { getSettings } from './db/settings.js';
import { eq, asc, desc, sql } from 'drizzle-orm';
import { generateImageSequence } from './image.js';
import { publishToBuffer } from './buffer.js';
import { runAutomatedPipeline } from './agent.js';
import multer from 'multer';
import { uploadToS3 } from './s3.js';

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
      const result = await publishToBuffer(mediaToPublish, post.text);
      
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

// POST /api/upload - Upload image to S3
app.post('/api/upload', requireDashboardAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    
    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    
    if (!mimeType.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }

    const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    
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
    const { text, mediaUrl } = req.body;
    if (!text) return res.status(400).json({ error: 'Text input is required' });

    const media = mediaUrl ? [{ type: 'image' as const, url: mediaUrl }] : [];

    const result = await db.insert(jobsTable).values({
      chatId: 'DASHBOARD',
      messageId: Date.now(),
      text,
      media,
      status: 'pending'
    }).returning();

    res.json({ message: 'Job enqueued successfully', job: result[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
      bufferInstagramChannelId, 
      telegramBotToken, 
      cronIntervalMinutes, 
      cronStartHour, 
      cronEndHour 
    } = req.body;

    const updateData: any = {};
    if (logoImageUrl !== undefined) updateData.logoImageUrl = logoImageUrl;
    if (ctaImageUrl !== undefined) updateData.ctaImageUrl = ctaImageUrl;
    if (bufferApiKey !== undefined) updateData.bufferApiKey = bufferApiKey;
    if (bufferInstagramChannelId !== undefined) updateData.bufferInstagramChannelId = bufferInstagramChannelId;
    if (telegramBotToken !== undefined) updateData.telegramBotToken = telegramBotToken;
    if (cronIntervalMinutes !== undefined) updateData.cronIntervalMinutes = parseInt(cronIntervalMinutes, 10);
    if (cronStartHour !== undefined) updateData.cronStartHour = parseInt(cronStartHour, 10);
    if (cronEndHour !== undefined) updateData.cronEndHour = parseInt(cronEndHour, 10);

    // Make sure the row exists first
    await getSettings();
    
    await db.update(settingsTable).set(updateData).where(eq(settingsTable.id, 1));
    
    res.json({ message: 'Settings updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/queue - List all queue items
app.get('/api/queue', requireDashboardAuth, async (req, res) => {
  try {
    const items = await db.select()
      .from(queueTable)
      .where(eq(queueTable.status, 'pending'))
      .orderBy(asc(queueTable.sortOrder)); // Smallest sort_order first = top of queue
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/queue/:id - Update queue item (e.g. edit text or retry a failed post)
app.put('/api/queue/:id', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { text, title, coverImageUrl, slides } = req.body;
    
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const updateData: any = {};
    if (text !== undefined) updateData.text = text;
    if (title !== undefined) updateData.title = title;
    if (coverImageUrl !== undefined) updateData.coverImageUrl = coverImageUrl;
    if (slides !== undefined) updateData.slides = slides;

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

    if (!post.title || !post.coverImageUrl || !post.slides) {
       return res.status(400).json({ error: 'Missing required data (title, cover image, or slides) to regenerate media.' });
    }

    try {
      const settings = await getSettings();
      // Re-render the images
      const renderedUrls = await generateImageSequence({
        logo: settings.logoImageUrl || 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
        cover_image: post.coverImageUrl,
        title: post.title,
        slides: post.slides.map((text: string) => ({ text }))
      });

      if (!renderedUrls || renderedUrls.length === 0) {
        throw new Error('Failed to render images from external API.');
      }

      const allPublishUrls = renderedUrls.map((url: string) => ({
        type: 'image' as const,
        url
      }));

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

      const result = await publishToBuffer(mediaToPublish, post.text);
      
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


import express from 'express';
import cors from 'cors';
import { db } from './db/index.js';
import { queueTable } from './db/schema.js';
import { eq, asc, desc } from 'drizzle-orm';
import { publishToBuffer } from './buffer.js';
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

const TRIGGER_API_KEY = process.env.TRIGGER_API_KEY;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

if (!TRIGGER_API_KEY) {
  console.warn('WARNING: TRIGGER_API_KEY is not set in environment variables.');
}
if (!DASHBOARD_PASSWORD) {
  console.warn('WARNING: DASHBOARD_PASSWORD is not set in environment variables. Dashboard will be inaccessible.');
}

// Middleware to protect trigger API routes
const requireTriggerAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!TRIGGER_API_KEY || authHeader !== `Bearer ${TRIGGER_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Middleware to protect dashboard CRUD API routes
const requireDashboardAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!DASHBOARD_PASSWORD || authHeader !== `Bearer ${DASHBOARD_PASSWORD}`) {
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
      .orderBy(asc(queueTable.createdAt))
      .limit(1);

    if (pendingPosts.length === 0) {
      return res.status(200).json({ message: 'No pending posts to publish.' });
    }

    const post = pendingPosts[0];
    console.log(`[API] Triggering publish for post ID ${post.id}`);

    try {
      let mediaToPublish = [...post.media];
      const ctaUrl = process.env.CTA_IMAGE_URL;
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

// GET /api/queue - List all queue items
app.get('/api/queue', requireDashboardAuth, async (req, res) => {
  try {
    const items = await db.select()
      .from(queueTable)
      .where(eq(queueTable.status, 'pending'))
      .orderBy(asc(queueTable.createdAt)); // Oldest first = top of queue
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/queue/:id - Update queue item (e.g. edit text or retry a failed post)
app.put('/api/queue/:id', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { text } = req.body;
    
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    if (text !== undefined) {
      await db.update(queueTable)
        .set({ text })
        .where(eq(queueTable.id, id));
    }

    res.json({ message: 'Updated successfully' });
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
      let mediaToPublish = [...post.media];
      const ctaUrl = process.env.CTA_IMAGE_URL;
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
      .orderBy(asc(queueTable.createdAt));
      
    const index = pending.findIndex(p => p.id === id);
    if (index === -1) return res.status(404).json({ error: 'Post not found in pending queue' });

    if (direction === 'top' && index > 0) {
      const firstItem = pending[0];
      const newDate = new Date(firstItem.createdAt.getTime() - 1000); // 1 second before the first item
      await db.update(queueTable).set({ createdAt: newDate }).where(eq(queueTable.id, id));
    } else if (direction === 'up' && index > 0) {
      const prevItem = pending[index - 1];
      const currentItem = pending[index];
      // Swap createdAt timestamps to swap order
      await db.update(queueTable).set({ createdAt: prevItem.createdAt }).where(eq(queueTable.id, currentItem.id));
      await db.update(queueTable).set({ createdAt: currentItem.createdAt }).where(eq(queueTable.id, prevItem.id));
    } else if (direction === 'down' && index < pending.length - 1) {
      const nextItem = pending[index + 1];
      const currentItem = pending[index];
      // Swap createdAt timestamps to swap order
      await db.update(queueTable).set({ createdAt: nextItem.createdAt }).where(eq(queueTable.id, currentItem.id));
      await db.update(queueTable).set({ createdAt: currentItem.createdAt }).where(eq(queueTable.id, nextItem.id));
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

export const startServer = (port: number = 3000) => {
  app.listen(port, () => {
    console.log(`API Server is running on port ${port}`);
  });
};

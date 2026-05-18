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
      // Publish to buffer (using shareNow in buffer.ts)
      const result = await publishToBuffer(post.media, post.text);
      
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
    const items = await db.select().from(queueTable).orderBy(desc(queueTable.createdAt));
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/queue/:id - Update queue item (e.g. edit text or retry a failed post)
app.put('/api/queue/:id', requireDashboardAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { text, status } = req.body;
    
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    await db.update(queueTable)
      .set({
        ...(text !== undefined && { text }),
        ...(status !== undefined && { status }),
      })
      .where(eq(queueTable.id, id));

    res.json({ message: 'Updated successfully' });
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

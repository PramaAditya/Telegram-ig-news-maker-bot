import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { startServer } from './server.js';
import { db } from './db/index.js';
import { jobsTable, ideasTable } from './db/schema.js';
import { getSettings } from './db/settings.js';
import { eq } from 'drizzle-orm';
import dns from 'dns';

// Fix for ECONNRESET issues in Docker (Node.js 17+ prefers IPv6 by default, which can break in some Docker networks)
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

// Start the Express API server
const PORT = parseInt(process.env.PORT || '3000', 10);
startServer(PORT);

const settings = await getSettings();
const botToken = settings.telegramBotToken;
if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN must be provided in Settings (Database) or .env');
  process.exit(1);
}

const telegramApiRoot = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';

const bot = new Telegraf(botToken, {
  telegram: {
    apiRoot: telegramApiRoot
  }
});

const mediaGroupAccumulator = new Map<string, { timer: NodeJS.Timeout, items: { fileId: string, caption?: string, msgId: number, type: 'image' | 'video', mimeType?: string }[] }>();

bot.on(message('text'), async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  // Reconstruct text with original URLs using message entities
  let text = ctx.message.text;
  if (ctx.message.entities) {
    let offset = 0;
    const entities = ctx.message.entities;
    for (const entity of entities) {
      if (entity.type === 'text_link') {
        const linkText = text.substring(entity.offset + offset, entity.offset + entity.length + offset);
        const url = entity.url;
        const replacement = `${linkText} (${url})`;
        text = text.substring(0, entity.offset + offset) + replacement + text.substring(entity.offset + entity.length + offset);
        offset += replacement.length - linkText.length;
      }
    }
  }
  
  try {
    const [idea] = await db.insert(ideasTable).values({
      chatId,
      messageId: ctx.message.message_id,
      text,
      media: [],
      status: 'pending'
    }).returning();
    
    await ctx.reply('Ide tersimpan. Apakah Anda ingin membuat konten dari ide ini?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Ya, Buat Konten', callback_data: `make_post_${idea.id}` }],
          [{ text: '❌ Batal', callback_data: `cancel_idea_${idea.id}` }]
        ]
      }
    });
  } catch (err: any) {
    console.error('[Bot] Error saving text idea:', err);
    await ctx.reply('Terjadi kesalahan sistem saat menyimpan antrean.');
  }
});

async function handleMediaMessage(ctx: any, isVideo: boolean) {
  const chatId = ctx.chat.id.toString();

  const baseCaption = ctx.message.caption || '';
  let caption = baseCaption;
  
  if (ctx.message.caption_entities) {
    let offset = 0;
    const entities = ctx.message.caption_entities;
    for (const entity of entities) {
      if (entity.type === 'text_link') {
        const linkText = caption.substring(entity.offset + offset, entity.offset + entity.length + offset);
        const url = entity.url;
        const replacement = `${linkText} (${url})`;
        caption = caption.substring(0, entity.offset + offset) + replacement + caption.substring(entity.offset + entity.length + offset);
        offset += replacement.length - linkText.length;
      }
    }
  }
  let fileId = '';
  let mimeType: string | undefined;

  if (isVideo) {
    fileId = ctx.message.video.file_id;
    mimeType = ctx.message.video.mime_type;
  } else {
    const photos = ctx.message.photo;
    fileId = photos[photos.length - 1].file_id;
    mimeType = 'image/jpeg';
  }
  
  const mediaGroupId = ctx.message.media_group_id;
  
  if (mediaGroupId) {
    console.log(`[Bot] Received ${isVideo ? 'video' : 'photo'} part of media group ${mediaGroupId}`);
    if (!mediaGroupAccumulator.has(mediaGroupId)) {
      mediaGroupAccumulator.set(mediaGroupId, {
        items: [],
        timer: setTimeout(async () => {
          const groupData = mediaGroupAccumulator.get(mediaGroupId);
          mediaGroupAccumulator.delete(mediaGroupId);
          if (!groupData) return;
          
          console.log(`[Bot] Processing accumulated media group ${mediaGroupId} with ${groupData.items.length} items`);
          
          try {
            // Sort by message ID to preserve original order
            groupData.items.sort((a, b) => a.msgId - b.msgId);
            
            const mediaItems = [];
            for (const item of groupData.items) {
              let url = '';
              let retries = 3;
              while (retries > 0) {
                try {
                  const fileUrl = await ctx.telegram.getFileLink(item.fileId);
                  url = fileUrl.toString();
                  // When using the local Bot API, it returns http://botapi:8081/... 
                  // If we are mapping ports or using the local bot API in production, axios can reach this url natively
                  // because our bot and worker containers are in the same docker network as 'botapi'.
                  break;
                } catch (e: any) {
                  retries--;
                  console.warn(`[Bot] Failed to getFileLink for ${item.fileId}, retries left: ${retries}. Error: ${e.message}`);
                  if (retries === 0) throw e;
                  await new Promise(res => setTimeout(res, 1000)); // wait 1s before retrying
                }
              }
              mediaItems.push({ type: item.type, url, mimeType: item.mimeType });
            }
            
            // Find the first caption in the group to use as the text prompt
            const groupCaption = groupData.items.find(item => item.caption)?.caption || 'No specific text provided, analyze the media context if possible.';
            
            const [idea] = await db.insert(ideasTable).values({
              chatId,
              messageId: groupData.items[0].msgId,
              text: groupCaption,
              media: mediaItems,
              status: 'pending'
            }).returning();
            
            await ctx.reply('Ide (album) tersimpan. Apakah Anda ingin membuat konten dari ide ini?', {
              reply_to_message_id: groupData.items[0].msgId,
              reply_markup: {
                inline_keyboard: [
                  [{ text: '✅ Ya, Buat Konten', callback_data: `make_post_${idea.id}` }],
                  [{ text: '❌ Batal', callback_data: `cancel_idea_${idea.id}` }]
                ]
              }
            });
            
          } catch (error) {
            console.error('[Bot] Error saving media group idea:', error);
            try { await ctx.reply('Terjadi kesalahan sistem saat menyimpan antrean album.'); } catch (e) {}
          }
        }, 2000) // Wait 2 seconds for all parts of the album to arrive
      });
    }
    
    // Add this media to the accumulator
    const group = mediaGroupAccumulator.get(mediaGroupId)!;
    group.items.push({
      fileId,
      caption: caption,
      msgId: ctx.message.message_id,
      type: isVideo ? 'video' : 'image',
      mimeType
    });
    
    return; // Don't process immediately, wait for the timer
  }

  // Single media case (no media_group_id)
  console.log(`[Bot] Received single ${isVideo ? 'video' : 'photo'} message from ${ctx.chat.id}`);
  let fileLink: URL | undefined = undefined;
  let retries = 3;
  while (retries > 0) {
    try {
      const fileUrl = await ctx.telegram.getFileLink(fileId);
      fileLink = fileUrl;
      // Similar to above, this will return an internal docker URL (http://botapi:8081/...)
      // which axios in agent.ts can resolve directly.
      break;
    } catch (e: any) {
      retries--;
      console.warn(`[Bot] Failed to getFileLink for ${fileId}, retries left: ${retries}. Error: ${e.message}`);
      if (retries === 0) throw e;
      await new Promise(res => setTimeout(res, 1000));
    }
  }
  
  if (!fileLink) return;
  const text = caption ? caption : 'No specific text provided, analyze the media context if possible.';
  
  try {
    const [idea] = await db.insert(ideasTable).values({
      chatId,
      messageId: ctx.message.message_id,
      text,
      media: [{ type: isVideo ? 'video' : 'image', url: fileLink.toString(), mimeType }],
      status: 'pending'
    }).returning();
    
    await ctx.reply('Ide media tersimpan. Apakah Anda ingin membuat konten dari ide ini?', {
      reply_to_message_id: ctx.message.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Ya, Buat Konten', callback_data: `make_post_${idea.id}` }],
          [{ text: '❌ Batal', callback_data: `cancel_idea_${idea.id}` }]
        ]
      }
    });
  } catch (error) {
    console.error(`[Bot] Error saving single media idea:`, error);
    try { await ctx.reply('Terjadi kesalahan sistem saat menyimpan antrean media.'); } catch (e) {}
  }
}

bot.on('callback_query', async (ctx: any) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    
    if (callbackData.startsWith('make_post_')) {
      const ideaId = parseInt(callbackData.replace('make_post_', ''), 10);
      
      const [idea] = await db.select().from(ideasTable).where(eq(ideasTable.id, ideaId));
      if (!idea) {
        return ctx.answerCbQuery('Ide tidak ditemukan.');
      }
      if (idea.status !== 'pending') {
         return ctx.answerCbQuery('Ide ini sudah diproses.');
      }

      await db.insert(jobsTable).values({
        chatId: idea.chatId,
        messageId: idea.messageId,
        text: idea.text,
        media: idea.media,
        templateId: 'image:kabar.perjuangan:carousel_dark',
        status: 'pending'
      });

      await db.update(ideasTable).set({ status: 'converted' }).where(eq(ideasTable.id, ideaId));

      await ctx.editMessageText('✅ Masuk antrean sistem');
      await ctx.answerCbQuery('Ide akan diproses.');
      
    } else if (callbackData.startsWith('cancel_idea_')) {
      const ideaId = parseInt(callbackData.replace('cancel_idea_', ''), 10);
      
      // Kept pending to show in dashboard, just update message
      await ctx.editMessageText('⏳ Ide disimpan. Bisa diproses nanti di dashboard.');
      await ctx.answerCbQuery('Disimpan ke dashboard.');
    }
  } catch (error) {
    console.error('[Bot] Error in callback_query:', error);
    try { await ctx.answerCbQuery('Terjadi kesalahan.'); } catch (e) {}
  }
});

bot.on(message('photo'), (ctx) => handleMediaMessage(ctx, false));
bot.on(message('video'), (ctx) => handleMediaMessage(ctx, true));

const startBotWithRetry = async (retries = 10, delayMs = 3000) => {
  for (let i = 0; i < retries; i++) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      console.log('Bot is running in automated mode...');
      return;
    } catch (err: any) {
      console.error(`[Bot] Failed to launch bot (Attempt ${i + 1}/${retries}): ${err.message}`);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
};

startBotWithRetry().catch(err => {
  console.error('[Bot] Failed to start after multiple retries', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

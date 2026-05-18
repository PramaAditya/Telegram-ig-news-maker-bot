import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { runAutomatedPipeline } from './agent.js';
import { startServer } from './server.js';

dotenv.config();

// Start the Express API server
const PORT = parseInt(process.env.PORT || '3000', 10);
startServer(PORT);

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN must be provided!');
}

const bot = new Telegraf(botToken);

const activeProcessing = new Set<string>();
const mediaGroupAccumulator = new Map<string, { timer: NodeJS.Timeout, items: { fileId: string, caption?: string, msgId: number, type: 'image' | 'video', mimeType?: string }[] }>();

bot.on(message('text'), async (ctx) => {
  const chatId = ctx.chat.id.toString();
  if (activeProcessing.has(chatId)) {
    return; // Ignore if already processing
  }
  
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
  
  activeProcessing.add(chatId);
  // Do not await to prevent Telegraf 90s timeout
  runAutomatedPipeline(ctx, text, undefined)
    .catch(async (error) => {
      console.error('[Bot] Error processing text:', error);
      try { await ctx.reply('Terjadi kesalahan sistem.'); } catch (e) {}
    })
    .finally(() => {
      activeProcessing.delete(chatId);
    });
});

async function handleMediaMessage(ctx: any, isVideo: boolean) {
  const chatId = ctx.chat.id.toString();
  
  if (activeProcessing.has(chatId)) {
    return; // Ignore if already processing
  }

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
          
          activeProcessing.add(chatId);
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
                  url = (await ctx.telegram.getFileLink(item.fileId)).toString();
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
            
            await runAutomatedPipeline(ctx, groupCaption, mediaItems);
          } catch (error) {
            console.error('[Bot] Error processing media group:', error);
            try { await ctx.reply('Terjadi kesalahan sistem saat memproses album.'); } catch (e) {}
          } finally {
            activeProcessing.delete(chatId);
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
      fileLink = await ctx.telegram.getFileLink(fileId);
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
  
  activeProcessing.add(chatId);
  // Do not await to prevent Telegraf 90s timeout
  runAutomatedPipeline(ctx, text, [{ type: isVideo ? 'video' : 'image', url: fileLink.toString(), mimeType }])
    .catch(async (error) => {
      console.error(`[Bot] Error processing single media:`, error);
      try { await ctx.reply('Terjadi kesalahan sistem saat memproses media.'); } catch (e) {}
    })
    .finally(() => {
      activeProcessing.delete(chatId);
    });
}

bot.on(message('photo'), (ctx) => handleMediaMessage(ctx, false));
bot.on(message('video'), (ctx) => handleMediaMessage(ctx, true));

bot.launch();
console.log('Bot is running in automated mode...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

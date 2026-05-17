import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import dotenv from 'dotenv';
import { runAutomatedPipeline } from './agent.js';

dotenv.config();

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
  
  const text = ctx.message.text;
  
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

  const caption = ctx.message.caption || '';
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
            
            const mediaItems = await Promise.all(groupData.items.map(async item => {
              const url = (await ctx.telegram.getFileLink(item.fileId)).toString();
              return { type: item.type, url, mimeType: item.mimeType };
            }));
            
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
      caption: ctx.message.caption,
      msgId: ctx.message.message_id,
      type: isVideo ? 'video' : 'image',
      mimeType
    });
    
    return; // Don't process immediately, wait for the timer
  }

  // Single media case (no media_group_id)
  console.log(`[Bot] Received single ${isVideo ? 'video' : 'photo'} message from ${ctx.chat.id}`);
  const fileLink = await ctx.telegram.getFileLink(fileId);
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

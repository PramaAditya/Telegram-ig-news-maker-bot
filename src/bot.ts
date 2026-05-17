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
const mediaGroupAccumulator = new Map<string, { timer: NodeJS.Timeout, items: { fileId: string, caption?: string, msgId: number }[] }>();

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

bot.on(message('photo'), async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  if (activeProcessing.has(chatId)) {
    return; // Ignore if already processing
  }

  const caption = ctx.message.caption || '';
  const photos = ctx.message.photo;
  const highestResPhoto = photos[photos.length - 1];
  
  const mediaGroupId = ctx.message.media_group_id;
  
  if (mediaGroupId) {
    console.log(`[Bot] Received photo part of media group ${mediaGroupId}`);
    if (!mediaGroupAccumulator.has(mediaGroupId)) {
      mediaGroupAccumulator.set(mediaGroupId, {
        items: [],
        timer: setTimeout(async () => {
          const groupData = mediaGroupAccumulator.get(mediaGroupId);
          mediaGroupAccumulator.delete(mediaGroupId);
          if (!groupData) return;
          
          activeProcessing.add(chatId);
          console.log(`[Bot] Processing accumulated media group ${mediaGroupId} with ${groupData.items.length} photos`);
          
          try {
            // Sort by message ID to preserve original order
            groupData.items.sort((a, b) => a.msgId - b.msgId);
            
            const fileLinks = await Promise.all(groupData.items.map(async item => {
              return (await ctx.telegram.getFileLink(item.fileId)).toString();
            }));
            
            // Find the first caption in the group to use as the text prompt
            const groupCaption = groupData.items.find(item => item.caption)?.caption || 'No specific text provided, analyze the image context if possible.';
            
            await runAutomatedPipeline(ctx, groupCaption, fileLinks);
          } catch (error) {
            console.error('[Bot] Error processing media group:', error);
            try { await ctx.reply('Terjadi kesalahan sistem saat memproses album foto.'); } catch (e) {}
          } finally {
            activeProcessing.delete(chatId);
          }
        }, 2000) // Wait 2 seconds for all parts of the album to arrive
      });
    }
    
    // Add this photo to the accumulator
    const group = mediaGroupAccumulator.get(mediaGroupId)!;
    group.items.push({
      fileId: highestResPhoto.file_id,
      caption: ctx.message.caption,
      msgId: ctx.message.message_id
    });
    
    return; // Don't process immediately, wait for the timer
  }

  // Single photo case (no media_group_id)
  console.log(`[Bot] Received single photo message from ${ctx.chat.id}`);
  const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);
  const text = caption ? caption : 'No specific text provided, analyze the image context if possible.';
  
  activeProcessing.add(chatId);
  // Do not await to prevent Telegraf 90s timeout
  runAutomatedPipeline(ctx, text, [fileLink.toString()])
    .catch(async (error) => {
      console.error('[Bot] Error processing photo:', error);
      try { await ctx.reply('Terjadi kesalahan sistem saat memproses foto.'); } catch (e) {}
    })
    .finally(() => {
      activeProcessing.delete(chatId);
    });
});

bot.launch();
console.log('Bot is running in automated mode...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

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

const processedMediaGroups = new Set<string>();
const activeProcessing = new Set<string>();

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
  
  const mediaGroupId = ctx.message.media_group_id;
  if (mediaGroupId) {
    if (processedMediaGroups.has(mediaGroupId)) {
      console.log(`[Bot] Ignoring duplicate photo in media group ${mediaGroupId}`);
      return;
    }
    processedMediaGroups.add(mediaGroupId);
    setTimeout(() => processedMediaGroups.delete(mediaGroupId), 60000); // Clear after 1 min
  }

  if (activeProcessing.has(chatId)) {
    return; // Ignore if already processing
  }
  
  console.log(`[Bot] Received photo message from ${ctx.chat.id}`);
  const caption = ctx.message.caption || '';
  const photos = ctx.message.photo;
  
  const highestResPhoto = photos[photos.length - 1];
  const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);
  
  const text = caption ? caption : 'No specific text provided, analyze the image context if possible.';
  
  activeProcessing.add(chatId);
  // Do not await to prevent Telegraf 90s timeout
  runAutomatedPipeline(ctx, text, fileLink.toString())
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

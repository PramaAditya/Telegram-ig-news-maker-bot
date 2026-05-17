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

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  
  // Do not await to prevent Telegraf 90s timeout
  runAutomatedPipeline(ctx, text, undefined).catch(async (error) => {
    console.error('[Bot] Error processing text:', error);
    try { await ctx.reply('Terjadi kesalahan sistem.'); } catch (e) {}
  });
});

bot.on(message('photo'), async (ctx) => {
  console.log(`[Bot] Received photo message from ${ctx.chat.id}`);
  const caption = ctx.message.caption || '';
  const photos = ctx.message.photo;
  
  const highestResPhoto = photos[photos.length - 1];
  const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);
  
  const text = caption ? caption : 'No specific text provided, analyze the image context if possible.';
  
  // Do not await to prevent Telegraf 90s timeout
  runAutomatedPipeline(ctx, text, fileLink.toString()).catch(async (error) => {
    console.error('[Bot] Error processing photo:', error);
    try { await ctx.reply('Terjadi kesalahan sistem saat memproses foto.'); } catch (e) {}
  });
});

bot.launch();
console.log('Bot is running in automated mode...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

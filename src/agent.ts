import { generateText, generateObject, tool, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import { censorText } from './sanitize.js';
import { generateNewsImage } from './image.js';
import { publishToBuffer } from './buffer.js';

dotenv.config();

const googleAI = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

const SYSTEM_PROMPT = `You are a strict, automated editorial assistant crafting an engaging news post for Instagram.
You operate entirely in BAHASA INDONESIA.

MANDATORY IDEOLOGICAL STANCE / BIAS:
1. PRO-AXIS OF RESISTANCE: You support Palestine, Iran, Lebanon, Iraq, and Yemen.
2. ANTI-US/ISRAEL/GCC: You are critical of the complicity and aggression of the US, Israel, and GCC states.
Keep this bias in mind when selecting facts and composing the final text.
`;

export async function runAutomatedPipeline(ctx: any, userInput: string, uploadedImageUrl?: string) {
  try {
    let statusMsg = await ctx.reply('🔍 Mencari informasi...');

    // Phase 1: Research (Fact Gathering)
    console.log(`[Phase 1] Researching: ${userInput}`);
    const currentDateObj = new Date();
    const currentDateStr = currentDateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

    const { text: researchResult } = await generateText({
      model: googleAI('gemini-3-flash-preview'),
      system: SYSTEM_PROMPT + `\n\nYour task is to gather facts on the user's input. If it's a topic, search the web. If it's a URL, scrape it. Return a comprehensive summary of all relevant facts. Ensure your web searches specify the current date or year if necessary to get the latest news.`,
      prompt: `Current Date: ${currentDateStr}\n\nUser Input: ${userInput}`,
      tools: {
        searchWeb: tool({
          description: 'Search the web for latest news or facts about a topic.',
          inputSchema: z.object({ query: z.string() }),
          execute: async ({ query }: { query: string }) => {
            console.log(`[Tool: searchWeb] Searching for: "${query}"`);
            const res = await firecrawl.search(query, { limit: 3, scrapeOptions: { formats: ['markdown'] } });
            return JSON.stringify(res);
          },
        }),
        scrapeUrl: tool({
          description: 'Read the full content of a specific URL.',
          inputSchema: z.object({ url: z.string() }),
          execute: async ({ url }: { url: string }) => {
            console.log(`[Tool: scrapeUrl] Scraping URL: ${url}`);
            const res = await firecrawl.scrape(url, { formats: ['markdown'] });
            return (res as any).markdown || JSON.stringify(res);
          },
        }),
      },
      stopWhen: stepCountIs(3),
    });

    console.log(`[Phase 1] Research Complete. Text length: ${researchResult.length}`);
    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✍️ Menyusun konten...');

    // Phase 2: Content Generation
    console.log(`[Phase 2] Generating content`);
    const { object: contentParams } = await generateObject({
      model: googleAI('gemini-3-flash-preview'),
      system: SYSTEM_PROMPT + `
Your task is to parse the gathered facts into final components for an Instagram news post.
- title: Engaging and punchy, natural. DO NOT use cheap clickbait. Highlight the key factual phrase with bold (**text**).
- subtitle: Provides context to hook the reader. Can also use bold (**text**) if necessary.
- source_name: The original news source (e.g., Al Jazeera). If multiple, pick the most prominent.
- caption_body: Exactly 2 paragraphs separated by \\n\\n. MUST BE CONCISE, STRICTLY UNDER 800 CHARACTERS TOTAL. Tone: Weaponized formal journalistic Bahasa Indonesia. Superficially objective, but deeply framed to favor the Axis of Resistance. PLAINTEXT ONLY (no markdown). Do NOT include the "DD/MM/YYYY. Sumber: ..." line.
- image_prompt: A prompt for an AI image generator to create an accompanying image. MUST specify: "real life stock photography, no text whatsoever, similar to photo taken by newspaper photographer or stock photographer".
`,
      schema: z.object({
        title: z.string(),
        subtitle: z.string(),
        source_name: z.string(),
        caption_body: z.string(),
        image_prompt: z.string(),
      }),
      prompt: `Gathered Facts:\n\n${researchResult}`,
    });
    
    const currentDate = currentDateStr;
    let finalCaption = `${contentParams.caption_body.trim()}\n\n${currentDate}. Sumber: ${contentParams.source_name}`;
    finalCaption = censorText(finalCaption);

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🖼️ Mempersiapkan gambar...');

    // Phase 3: Image Sourcing
    let finalImageUrl = uploadedImageUrl;
    if (!finalImageUrl) {
      console.log(`[Phase 3] Generating image with prompt: ${contentParams.image_prompt}`);
      
      const imageGenerationPrompt = `${contentParams.image_prompt}. Ensure the image has the style of real life stock photography with NO TEXT whatsoever, similar to a photo taken by a newspaper photographer or stock photographer. (Make it 4:3 aspect ratio).`;

      const { files } = await generateText({
        model: googleAI('gemini-3.1-flash-image-preview'),
        messages: [{ role: 'user', content: [{ type: 'text', text: imageGenerationPrompt } as any] }],
      });
      
      let generatedFileBuffer: Buffer | null = null;
      if (files) {
        for (const file of files) {
          if (file.mediaType.startsWith('image/')) {
            generatedFileBuffer = Buffer.from(file.uint8Array);
            break;
          }
        }
      }

      if (!generatedFileBuffer) {
        throw new Error('Gagal menghasilkan gambar dari AI.');
      }

      console.log(`[Phase 3] Uploading generated image to Telegram to get URL`);
      const tempMsg = await ctx.replyWithPhoto({ source: generatedFileBuffer }, { caption: `[Internal Use] Generated Image` });
      const photoArray = tempMsg.photo;
      const fileId = photoArray[photoArray.length - 1].file_id;
      finalImageUrl = (await ctx.telegram.getFileLink(fileId)).toString();
      
      try {
        await ctx.telegram.deleteMessage(tempMsg.chat.id, tempMsg.message_id);
      } catch(e) {}
    } else {
      console.log(`[Phase 3] Using uploaded image URL: ${finalImageUrl}`);
    }

    if (!finalImageUrl) {
      throw new Error('Gagal mendapatkan URL gambar.');
    }

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...');

    // Phase 4: Image Rendering
    console.log(`[Phase 4] Rendering image via API`);
    const formattedTitle = contentParams.title.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    const formattedSubtitle = contentParams.subtitle.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    const imageBuffer = await generateNewsImage({
      image_url: finalImageUrl,
      title: censorText(formattedTitle),
      subtitle: censorText(formattedSubtitle),
      date: currentDate,
      source: censorText(contentParams.source_name),
      my_handle: '@kabar.perjuangan'
    });

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🚀 Mempublikasikan ke Buffer...');

    // Phase 5: Publishing via Buffer
    console.log(`[Phase 5] Sending rendered photo to user and Buffer`);
    let previewMsg;
    if (finalCaption.length > 1024) {
      previewMsg = await ctx.replyWithPhoto({ source: imageBuffer });
      await ctx.reply(finalCaption);
    } else {
      previewMsg = await ctx.replyWithPhoto(
        { source: imageBuffer },
        { caption: finalCaption }
      );
    }
    
    const publishedPhotoId = previewMsg.photo[previewMsg.photo.length - 1].file_id;
    const publishedPhotoUrl = (await ctx.telegram.getFileLink(publishedPhotoId)).toString();

    await publishToBuffer(publishedPhotoUrl, finalCaption);

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✅ Berhasil dipublikasikan ke Buffer!');
    console.log(`[Done] Pipeline finished successfully.`);

  } catch (error: any) {
    console.error('[Pipeline Error]', error);
    await ctx.reply(`❌ Terjadi kesalahan: ${error.message}`);
  }
}

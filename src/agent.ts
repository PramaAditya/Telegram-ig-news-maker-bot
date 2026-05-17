import { generateText, generateObject, tool, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import axios from 'axios';
import { censorText } from './sanitize.js';
import { uploadToS3 } from './s3.js';
import { generateImageSequence } from './image.js';
import { publishToBuffer } from './buffer.js';

dotenv.config();

const googleAI = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

const getSystemPrompt = (currentDateStr: string, currentYear: number) => `You are a strict, automated editorial assistant crafting a news carousel for Instagram.
You operate entirely in BAHASA INDONESIA. Your tone should be more neutral journalistic, but still retaining a subtle bias.

CRITICAL CONTEXT REGARDING TIME:
Today's date is: ${currentDateStr}.
The current year is: ${currentYear}.
You MUST use the year ${currentYear} (and the current month if needed) in your web searches. Completely ignore any internal knowledge cutoff dates that suggest we are in the past.

MANDATORY IDEOLOGICAL STANCE / BIAS:
1. PRO-AXIS OF RESISTANCE: You support Palestine, Iran, Lebanon, Iraq, and Yemen.
2. ANTI-US/ISRAEL/GCC: You are critical of the complicity and aggression of the US, Israel, and GCC states.
Keep this bias in mind when selecting facts and composing the final text, but maintain a seemingly objective, professional news tone rather than blatant propaganda.
`;

export interface MediaItem {
  type: 'image' | 'video';
  url: string;
  mimeType?: string;
  buffer?: Buffer;
  s3Url?: string;
}

export async function runAutomatedPipeline(ctx: any, userInput: string, uploadedMedia?: MediaItem[]) {
  try {
    let statusMsg = await ctx.reply('🔍 Mencari informasi...');

    // Phase 1: Research (Fact Gathering)
    console.log(`[Phase 1] Researching: ${userInput}`);
    const currentDateObj = new Date();
    const currentYear = currentDateObj.getFullYear();
    const currentDateStr = currentDateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
    const currentDate = currentDateStr;
    
    const SYSTEM_PROMPT = getSystemPrompt(currentDateStr, currentYear);

    const messageContent: any[] = [
      { type: 'text', text: `User Input: ${userInput}` }
    ];

      if (uploadedMedia && uploadedMedia.length > 0) {
          for (const media of uploadedMedia) {
            console.log(`[Phase 1] Downloading media for Gemini: ${media.url}`);
            try {
                let response;
                let retries = 3;
                while (retries > 0) {
                  try {
                    response = await axios.get(media.url, { responseType: 'arraybuffer' });
                    break;
                  } catch (e: any) {
                    retries--;
                    console.warn(`[Phase 1] Download failed, retries left: ${retries}. Error: ${e.message}`);
                    if (retries === 0) throw e;
                    await new Promise(res => setTimeout(res, 2000));
                  }
                }
                
                let buffer = Buffer.from(response!.data);
              
              if (media.type === 'video') {
                console.log(`[Phase 1] Saving original video...`);
                media.buffer = buffer;
                
                console.log(`[Phase 1] Uploading video to S3...`);
                const s3Url = await uploadToS3(buffer, media.mimeType || 'video/mp4', '.mp4');
                media.s3Url = s3Url;
                console.log(`[Phase 1] S3 URL: ${s3Url}`);
                
                messageContent.push({
                  type: 'file',
                  data: s3Url,
                  mediaType: media.mimeType || 'video/mp4'
                });
              } else {
                console.log(`[Phase 1] Saving original image...`);
                media.buffer = buffer;
                
                console.log(`[Phase 1] Uploading image to S3...`);
                media.s3Url = await uploadToS3(buffer, 'image/jpeg', '.jpg');

                messageContent.push({
                  type: 'image',
                  image: buffer
                });
            }
          } catch (err: any) {
            console.error(`[Phase 1] Failed to process media:`, err.message);
          }
        }
      }

    const { text: researchResult } = await generateText({
      model: googleAI('gemini-3.1-pro-preview'),
      system: SYSTEM_PROMPT + `\n\nYour task is to gather facts on the user's input. If it's a topic, search the web. If it's a URL, scrape it. If there are media attachments, analyze them to gather context. Return a comprehensive summary of all relevant facts. Ensure your web searches specify the current date (especially the year ${currentYear}) to get the latest news.`,
      messages: [
        {
          role: 'user',
          content: messageContent
        }
      ],
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
      model: googleAI('gemini-3.1-pro-preview'),
      system: SYSTEM_PROMPT + `
Your task is to parse the gathered facts into final components for an Instagram news carousel.
- title: A professional, clear, and engaging headline for the cover. PLAINTEXT ONLY. NO markdown or HTML tags.
- slide_text: A single string of text for the slide explaining the news. IT MUST CONTAIN MAXIMUM 3 SENTENCES. Separate the sentences/ideas with double newlines (\\n\\n) for readability.
- source_name: The original news source (e.g., Al Jazeera). If multiple, pick the most prominent.
- image_prompt: A prompt for an AI image generator to create an accompanying cover background image. MUST specify: "real life stock photography, no text whatsoever, similar to photo taken by newspaper photographer or stock photographer".
`,
      schema: z.object({
        title: z.string(),
        slide_text: z.string(),
        source_name: z.string(),
        image_prompt: z.string(),
      }),
      prompt: `Original User Input/Caption:\n${userInput}\n\nGathered Facts:\n\n${researchResult}`,
    });
    
    let finalCaption = `${contentParams.slide_text.trim()}\n\n${currentDate}. Sumber: ${contentParams.source_name}`;
    finalCaption = censorText(finalCaption);

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🖼️ Mempersiapkan gambar...');

    // Phase 3: Image Sourcing
    let coverImageUrl: string | undefined = undefined;

    if (uploadedMedia && uploadedMedia.length > 0) {
      const firstMedia = uploadedMedia[0];
      if (firstMedia.type === 'image') {
        coverImageUrl = firstMedia.s3Url || firstMedia.url;
        console.log(`[Phase 3] Using uploaded cover image URL: ${coverImageUrl}`);
      }
    }

    if (!coverImageUrl) {
      console.log(`[Phase 3] Generating cover image with prompt: ${contentParams.image_prompt}`);
      
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

      console.log(`[Phase 3] Uploading generated image to S3...`);
      coverImageUrl = await uploadToS3(generatedFileBuffer, 'image/jpeg', '.jpg');
      
    }

    if (!coverImageUrl) {
      throw new Error('Gagal mendapatkan URL gambar.');
    }

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...');

    // Phase 4: Image Rendering
    console.log(`[Phase 4] Rendering carousel via API`);
    
    // Remove emojis from title
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu;
    const cleanTitle = contentParams.title.replace(emojiRegex, '');

    const renderedUrls = await generateImageSequence({
      logo: 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
      cover_image: coverImageUrl,
      title: censorText(cleanTitle),
      slides: [{
        text: censorText(contentParams.slide_text)
      }]
    });

    if (!renderedUrls || renderedUrls.length === 0) {
      throw new Error('Gagal merender carousel dari API.');
    }

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🚀 Mempublikasikan ke Buffer...');

    // Phase 5: Publishing via Buffer
    console.log(`[Phase 5] Sending rendered photo to user and preparing Buffer URLs`);
    
    // Fetch the first image (cover) to send back as preview
    let previewBuffer: Buffer | undefined;
    try {
      const response = await axios.get(renderedUrls[0], { responseType: 'arraybuffer' });
      previewBuffer = Buffer.from(response.data);
    } catch (e) {
      console.warn('Failed to fetch preview cover image:', e);
    }

    if (previewBuffer) {
      if (finalCaption.length > 1024) {
        await ctx.replyWithPhoto({ source: previewBuffer });
        await ctx.reply(finalCaption);
      } else {
        await ctx.replyWithPhoto(
          { source: previewBuffer },
          { caption: finalCaption }
        );
      }
    } else {
      await ctx.reply(finalCaption + `\n\nCover URL: ${renderedUrls[0]}`);
    }

    // Prepare array of media for Buffer
    let allPublishUrls: { type: 'image' | 'video', url: string }[] = renderedUrls.map(url => ({
      type: 'image',
      url
    }));

    console.log(`[Phase 5] Publishing to Buffer with ${allPublishUrls.length} media items`);
    await publishToBuffer(allPublishUrls, finalCaption);

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✅ Berhasil dipublikasikan ke Buffer!');
    console.log(`[Done] Pipeline finished successfully.`);

  } catch (error: any) {
    console.error('[Pipeline Error]', error);
    await ctx.reply(`❌ Terjadi kesalahan: ${error.message}`);
  }
}

import { generateText, generateObject, tool, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import FirecrawlApp from '@mendable/firecrawl-js';
import dotenv from 'dotenv';
import axios from 'axios';
import { censorText } from './sanitize.js';
import { processImageTo4x5, processVideoTo4x5 } from './media-processor.js';
import { uploadToS3 } from './s3.js';
import { generateNewsImage } from './image.js';
import { publishToBuffer } from './buffer.js';

dotenv.config();

const googleAI = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

const getSystemPrompt = (currentDateStr: string, currentYear: number) => `You are a strict, automated editorial assistant crafting an engaging news post for Instagram.
You operate entirely in BAHASA INDONESIA. Your target audience is Gen Z Indonesians, so your headlines should be viral, edgy, and scroll-stopping.

CRITICAL CONTEXT REGARDING TIME:
Today's date is: ${currentDateStr}.
The current year is: ${currentYear}.
You MUST use the year ${currentYear} (and the current month if needed) in your web searches. Completely ignore any internal knowledge cutoff dates that suggest we are in the past.

MANDATORY IDEOLOGICAL STANCE / BIAS:
1. PRO-AXIS OF RESISTANCE: You support Palestine, Iran, Lebanon, Iraq, and Yemen.
2. ANTI-US/ISRAEL/GCC: You are critical of the complicity and aggression of the US, Israel, and GCC states.
Keep this bias in mind when selecting facts and composing the final text.
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
              const response = await axios.get(media.url, { responseType: 'arraybuffer' });
              let buffer = Buffer.from(response.data);
              
              if (media.type === 'video') {
                console.log(`[Phase 1] Resizing video to 4:5 aspect ratio...`);
                buffer = await processVideoTo4x5(buffer);
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
                console.log(`[Phase 1] Resizing image to 4:5 aspect ratio...`);
                buffer = await processImageTo4x5(buffer);
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
Your task is to parse the gathered facts into final components for an Instagram news post.
- title: Scroll-stopping, highly sensational, and provocative (but factual) breaking news style. Target audience is Gen Z Indonesians. Use natural, modern, and impactful Indonesian phrasing. AVOID sounding repetitive, robotic, or overusing cliché slang like "Kena Mental" or "Skakmat". Make it sound like an authentic viral news alert on social media. Highlight the key factual phrase with bold (**text**).
- subtitle: Sarcastic, sharp, or mind-blowing context that hooks the reader instantly. Connect with Gen Z energy. Can also use bold (**text**) if necessary.
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
    
    let finalCaption = `${contentParams.caption_body.trim()}\n\n${currentDate}. Sumber: ${contentParams.source_name}`;
    finalCaption = censorText(finalCaption);

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🖼️ Mempersiapkan gambar...');

    // Phase 3: Image Sourcing
    let coverImageUrl = uploadedMedia && uploadedMedia.length > 0 && uploadedMedia[0].type === 'image' ? uploadedMedia[0].s3Url || uploadedMedia[0].url : undefined;
    let coverWasGenerated = false;

    if (!coverImageUrl) {
      coverWasGenerated = true;
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

      console.log(`[Phase 3] Uploading generated image to Telegram to get URL`);
      const tempMsg = await ctx.replyWithPhoto({ source: generatedFileBuffer }, { caption: `[Internal Use] Generated Image` });
      const photoArray = tempMsg.photo;
      const fileId = photoArray[photoArray.length - 1].file_id;
      coverImageUrl = (await ctx.telegram.getFileLink(fileId)).toString();
      
      try {
        await ctx.telegram.deleteMessage(tempMsg.chat.id, tempMsg.message_id);
      } catch(e) {}
    } else {
      console.log(`[Phase 3] Using uploaded cover image URL: ${coverImageUrl}`);
    }

    if (!coverImageUrl) {
      throw new Error('Gagal mendapatkan URL gambar.');
    }

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...');

    // Phase 4: Image Rendering
    console.log(`[Phase 4] Rendering cover image via API`);
    
    // Remove emojis from title and subtitle using a robust regex
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu;
    const cleanTitle = contentParams.title.replace(emojiRegex, '');
    const cleanSubtitle = contentParams.subtitle.replace(emojiRegex, '');

    const formattedTitle = cleanTitle.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    const formattedSubtitle = cleanSubtitle.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    let imageBuffer = await generateNewsImage({
      image_url: coverImageUrl,
      title: censorText(formattedTitle),
      subtitle: censorText(formattedSubtitle),
      date: currentDate,
      source: censorText(contentParams.source_name),
      my_handle: '@poros.perjuangan'
    });

    console.log(`[Phase 4] Processing cover image to 4:5 aspect ratio`);
    imageBuffer = await processImageTo4x5(imageBuffer);

    console.log(`[Phase 4] Uploading cover image to S3`);
    const coverS3Url = await uploadToS3(imageBuffer, 'image/jpeg', '.jpg');

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🚀 Mempublikasikan ke Buffer...');

    // Phase 5: Publishing via Buffer
    console.log(`[Phase 5] Sending rendered photo to user and preparing Buffer URLs`);
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

    // Prepare array of media for Buffer
    const allPublishUrls: { type: 'image' | 'video', url: string }[] = [{ type: 'image', url: coverS3Url }];
    
      if (uploadedMedia && uploadedMedia.length > 0) {
        // If we used the user's first image as cover (coverWasGenerated = false), 
        // we still want to include it AGAIN as the second slide (so it acts as both cover and slide 2).
        // If coverWasGenerated is true, it means all uploadedMedia are just additional slides (like videos).
        // In both cases, we process the entirety of uploadedMedia.
        for (const m of uploadedMedia) {
          if (!m.s3Url) continue; // Skip if processing failed in Phase 1
          allPublishUrls.push({ type: m.type, url: m.s3Url });
        }
      }

    console.log(`[Phase 5] Publishing to Buffer with ${allPublishUrls.length} media items`);
    await publishToBuffer(allPublishUrls, finalCaption);

    await ctx.telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✅ Berhasil dipublikasikan ke Buffer!');
    console.log(`[Done] Pipeline finished successfully.`);

  } catch (error: any) {
    console.error('[Pipeline Error]', error);
    await ctx.reply(`❌ Terjadi kesalahan: ${error.message}`);
  }
}

import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import axios from 'axios';
import { PipelineContext, ResearchResult, googleAI, withRetry } from '../../../utils.js';
import { censorText } from '../../../sanitize.js';
import { uploadToS3 } from '../../../s3.js';
import { generateMedia } from '../../../media.js';
import { insertQueueItem } from '../../../db/queue.js';

export const intervalTemplateConfig = {
  id: 'image-multiple:interval',
  name: 'Interval News (Carousel)',
  description: 'A 2-slide breaking news carousel with a cover image.',
};

const systemPromptAdditions = `
Your task is to parse the gathered facts into final components for an Instagram news carousel.
- title: Scroll-stopping, casual, highly sensational, and provocative (but factual) breaking news style. Target audience is Gen Z Indonesians. Use natural, modern, and impactful Indonesian phrasing. AVOID sounding repetitive, robotic, or overusing cliché slang like "Kena Mental" or "Skakmat". Make it sound like an authentic viral news alert on social media. Highlight the key factual phrase with HTML tags (<strong>text</strong>). Do NOT use markdown. IT MUST BE PROPER TITLE CASING (Capitalize the first letter of each major word, including inside the tags).
- slides: An array of exactly 2 strings, representing two slides explaining the news. Write in clear, accessible, and easily understood Indonesian (Bahasa Indonesia yang membumi). Keep it PUNCHY, CONCISE, and FAST-PACED (singkat, padat, jelas) for a Gen-Z audience with a short attention span. AVOID complex political or academic jargon (e.g. use "hak penuh sebagai negara merdeka" instead of "hak kedaulatan"). Each slide MUST be exactly 1 short paragraph containing at most 2 sentences. Get straight to the point without unnecessary fluff. Answer the 5W1H comprehensively across the two slides. Do NOT repeat information already stated in the title.
- source_name: The original news source (e.g., Al Jazeera). If multiple, pick the most prominent.
- image_prompt: A prompt for an AI image generator to create an accompanying cover background image. MUST specify: "masterpiece professional photography, dramatic backlighting, heavy chiaroscuro, extreme low key".
`;

const schema = z.object({
  title: z.string(),
  slides: z.array(z.string()).length(2),
  source_name: z.string(),
  image_prompt: z.string(),
});

export async function generateIntervalMedia(templateData: any, settings: any): Promise<{ type: 'image' | 'video', url: string }[]> {
  const renderPayload = {
    logo: settings.logoImageUrl || 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
    cover_image: templateData.coverImageUrl,
    title: templateData.title,
    slides: templateData.slides.map((text: string) => ({ text })),
    input_images: templateData.inputImages || []
  };

  const renderedUrls = await generateMedia('/render/image-multiple/interval', renderPayload);

  if (!renderedUrls || renderedUrls.length === 0) {
    throw new Error('Failed to render images from external API.');
  }

  return renderedUrls.map((url: string) => ({
    type: 'image' as const,
    url
  }));
}

export async function runIntervalPipeline(context: PipelineContext, research: ResearchResult) {
  const { chatId, messageId, telegram, statusMsg, userInput, settings, currentDateStr, baseSystemPrompt } = context;
  const { researchText, scrapedImageUrl, processedMedia } = research;

  const defaultGuidelines = process.env.EDITORIAL_GUIDELINES || `Your reporting should maintain a professional and highly informative journalistic tone. Focus on delivering factual news while highlighting perspectives from the Global South, particularly Palestine, Lebanon, Iran, Iraq, and Yemen. When covering conflicts or international relations, critically examine the roles, policies, and actions of the US, Israel, and their allies.\n\nCrucially, avoid emotive language, sensationalism, or blatant propaganda. Let the facts, context, and a comprehensive delivery of the 5W1H (Who, What, When, Where, Why, How) drive the narrative. Your goal is to inform the audience thoroughly and objectively within the constraints of a short format.`;
  const editorialGuidelines = settings.editorialGuidelines || defaultGuidelines;
  const bannedWords = settings.bannedWords || [];
  
  const bannedWordsPrompt = bannedWords.length > 0 
    ? `\n\nCRITICAL MODERATION RULE:\nYou MUST NOT use the following words in your output: ${bannedWords.map((w: any) => w.word).join(', ')}. Use safe synonyms instead, or if you absolutely must convey the exact concept, use the provided safe replacements: ${bannedWords.map((w: any) => `${w.word}->${w.replacement}`).join(', ')}.`
    : '';

  const imageMediaItems = processedMedia ? processedMedia.filter(m => m.type === 'image' && m.buffer) : [];
  const isAlbum = imageMediaItems.length > 1;
  const slideCount = isAlbum ? 1 : 2;

  const dynamicSystemPromptAdditions = `
Your task is to parse the gathered facts into final components for an Instagram news carousel.
- title: Scroll-stopping, casual, highly sensational, and provocative (but factual) breaking news style. Target audience is Gen Z Indonesians. Use natural, modern, and impactful Indonesian phrasing. AVOID sounding repetitive, robotic, or overusing clichAc slang like "Kena Mental" or "Skakmat". Make it sound like an authentic viral news alert on social media. Highlight the key factual phrase with HTML tags (<strong>text</strong>). Do NOT use markdown. IT MUST BE PROPER TITLE CASING (Capitalize the first letter of each major word, including inside the tags).
- slides: An array of exactly ${slideCount} string${slideCount > 1 ? 's' : ''}, representing ${slideCount} slide${slideCount > 1 ? 's' : ''} explaining the news. Write in clear, accessible, and easily understood Indonesian (Bahasa Indonesia yang membumi). Keep it PUNCHY, CONCISE, and FAST-PACED (singkat, padat, jelas) for a Gen-Z audience with a short attention span. AVOID complex political or academic jargon (e.g. use "hak penuh sebagai negara merdeka" instead of "hak kedaulatan"). Each slide MUST be exactly 1 short paragraph containing at most 2 sentences. Get straight to the point without unnecessary fluff. Answer the 5W1H comprehensively across the ${slideCount} slide${slideCount > 1 ? 's' : ''}. Do NOT repeat information already stated in the title.
- source_name: The original news source (e.g., Al Jazeera). If multiple, pick the most prominent.
- image_prompt: A prompt for an AI image generator to create an accompanying cover background image. MUST specify: "masterpiece professional photography, dramatic backlighting, heavy chiaroscuro, extreme low key".
`;

  const dynamicSchema = z.object({
    title: z.string(),
    slides: z.array(z.string()).length(slideCount),
    source_name: z.string(),
    image_prompt: z.string(),
  });

  // Phase 2: Content Generation
  console.log(`[Phase 2] Generating content using template schema`);
  const writerSystemPrompt = baseSystemPrompt + `\n\nEDITORIAL GUIDELINES & FRAMING:\n${editorialGuidelines}\n\n${dynamicSystemPromptAdditions}` + bannedWordsPrompt;
  
  const { object: contentParams } = await generateObject({
    model: googleAI(process.env.CONTENT_WRITER_MODEL || 'gemini-3.1-pro-preview'),
    system: writerSystemPrompt,
    schema: dynamicSchema,
    prompt: `Original User Input/Caption:\n${userInput}\n\nGathered Facts:\n\n${researchText}`,
  });
  
  let finalCaption = '';
  if (contentParams.slides && contentParams.source_name) {
    finalCaption = `${contentParams.slides.join('\n\n')}\n\n${currentDateStr}. Sumber: ${contentParams.source_name}`;
  } else {
    finalCaption = `${currentDateStr}.`; // Generic fallback
  }
  
  finalCaption = censorText(finalCaption, bannedWords);

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🖼️ Mempersiapkan gambar...'));

  // Phase 3: Image Sourcing
  let baseImageBuffer: Buffer | null = null;

  if (imageMediaItems.length > 0) {
    baseImageBuffer = imageMediaItems[0].buffer!;
    console.log(`[Phase 3] Using uploaded cover image for enhancement`);
  } 
  
  if (!baseImageBuffer && scrapedImageUrl) {
    console.log(`[Phase 3] Using scraped image URL as base: ${scrapedImageUrl}`);
    try {
      const response = await axios.get(scrapedImageUrl, { responseType: 'arraybuffer' });
      baseImageBuffer = Buffer.from(response.data);
    } catch (err: any) {
      console.warn(`[Phase 3] Failed to download scraped image: ${err.message}`);
    }
  }

  // Fallback: search for an image using Firecrawl based on the topic
  if (!baseImageBuffer) {
    console.log(`[Phase 3] No image found so far. Searching the web for an image related to: ${contentParams.title}`);
    try {
      const { firecrawlService } = await import('../../../utils/firecrawl.js');
      const searchRes = await firecrawlService.search(`${contentParams.title} image`, { limit: 1 });
      
      // Look through search results to see if any have an image
      let foundImageUrl: string | null = null;
      if ((searchRes as any).data && (searchRes as any).data.length > 0) {
        for (const item of (searchRes as any).data) {
          if (item.metadata && (item.metadata.ogImage || item.metadata.image)) {
            foundImageUrl = item.metadata.ogImage || item.metadata.image;
            break;
          }
        }
      }

      if (foundImageUrl) {
         console.log(`[Phase 3] Found image URL via web search: ${foundImageUrl}`);
         const response = await axios.get(foundImageUrl, { responseType: 'arraybuffer' });
         baseImageBuffer = Buffer.from(response.data);
      } else {
         console.log(`[Phase 3] Web search didn't yield a usable image URL.`);
      }
    } catch (err: any) {
      console.warn(`[Phase 3] Web search for image failed: ${err.message}`);
    }
  }

  let imageGenerationPrompt = "";
  const promptSuffix = "analyze input image, focus on main subject, masterpiece professional photography, dramatic backlighting, strong rim lighting from behind, intense edge light, front of subject in deep shadow, heavy chiaroscuro photohraphy, extreme low key, edges fading completely into pitch black void. 4K ultra HD. Render in extreme detail with high-end remastering, sharp focus, accurate textures. Ensure it is strictly in 1:1 aspect ratio. NO TEXT whatsoever. DO NOT INCLUDE: front lighting, direct lighting, top lighting, overhead light, painting, bright background, daylight, flat lighting, overexposed, visible room edges, cutout, text, logo, signature.";

  if (baseImageBuffer) {
    console.log(`[Phase 3] Enhancing cover image with Gemini...`);
    imageGenerationPrompt = `Based on the provided image, ${promptSuffix}`;
  } else {
    console.log(`[Phase 3] Generating cover image with prompt: ${contentParams.image_prompt}`);
    imageGenerationPrompt = `${contentParams.image_prompt}. ${promptSuffix}`;
  }

  const imageGenMessageContent: any[] = [];
  if (baseImageBuffer) {
    imageGenMessageContent.push({ type: 'image', image: baseImageBuffer });
  }
  imageGenMessageContent.push({ type: 'text', text: imageGenerationPrompt });

  const { files } = await generateText({
    model: googleAI('gemini-3.1-flash-image-preview'),
    messages: [{ role: 'user', content: imageGenMessageContent as any }],
    providerOptions: {
      google: {
        imageConfig: {
          aspectRatio: '1:1'
        }
      }
    }
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
    throw new Error('Gagal menghasilkan atau memproses gambar dari AI.');
  }

  console.log(`[Phase 3] Uploading generated/enhanced image to S3...`);
  const coverImageUrl = await uploadToS3(generatedFileBuffer, 'image/jpeg', '.jpg');

  if (!coverImageUrl) {
    throw new Error('Gagal mendapatkan URL gambar.');
  }

  let extraImageUrls: string[] = [];
  if (isAlbum) {
    console.log(`[Phase 3] Uploading raw input images for album...`);
    for (const item of imageMediaItems) {
      if (item.buffer) {
         const url = await uploadToS3(item.buffer, item.mimeType || 'image/jpeg', item.mimeType === 'image/png' ? '.png' : '.jpg');
         if (url) extraImageUrls.push(url);
      }
    }
  }

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...'));

  // Phase 4: Image Rendering
  console.log(`[Phase 4] Rendering media via API for template ${intervalTemplateConfig.id}`);
  
  let cleanTitle = contentParams.title || '';
  if (cleanTitle) {
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu;
    cleanTitle = censorText(cleanTitle.replace(emojiRegex, ''), bannedWords);
  }

  let templateData: any = { ...contentParams, title: cleanTitle };

  if (contentParams.slides) {
    await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✨ Menambahkan highlight teks...'));
    console.log(`[Phase 4] Enhancing slides with markdown bolding via gemini-3.1-flash-lite...`);
    
    const highlightText = async (text: string) => {
      try {
        const { text: boldedText } = await generateText({
          model: googleAI('gemini-3.1-flash-lite-preview'),
          system: `You are an editor for an news based social media. Your task is to add bold markdown (using **text**) to the most important or shocking words, phrases, or clauses in the provided text. 
This helps readers scan the text and prevents it from being monotonous.
RULES:
1. Do not change any original words, only add ** around the important parts.
2. Output ONLY the modified text, nothing else.
3. Don't bold everything, just the key highlights (maximum 20-30% of the text).`,
          prompt: text
        });
        return boldedText.trim() || text;
      } catch (err) {
        console.warn('Failed to add bolding to text, falling back to original text:', err);
        return text;
      }
    };

    templateData.slides = await Promise.all(contentParams.slides.map((text: string) => highlightText(text)));
    templateData.slides = templateData.slides.map((text: string) => censorText(text, bannedWords));
  }

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...'));

  const renderPayload = {
    logo: settings.logoImageUrl || 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
    cover_image: coverImageUrl,
    title: templateData.title,
    slides: templateData.slides.map((text: string) => ({ text })),
    input_images: extraImageUrls
  };

  const renderedUrls = await generateMedia('/render/image-multiple/interval', renderPayload);

  if (!renderedUrls || renderedUrls.length === 0) {
    throw new Error('Gagal merender carousel dari API.');
  }

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🚀 Mempublikasikan ke Queue...'));

  // Phase 5: Publishing via Queue
  console.log(`[Phase 5] Sending rendered photo to user and preparing Buffer URLs`);
  
  let previewBuffer: Buffer | undefined;
  try {
    const response = await axios.get(renderedUrls[0], { responseType: 'arraybuffer' });
    previewBuffer = Buffer.from(response.data);
  } catch (e) {
    console.warn('Failed to fetch preview cover image:', e);
  }

  if (previewBuffer) {
    if (finalCaption.length > 1024) {
      await withRetry(() => telegram.sendPhoto(chatId, { source: previewBuffer }, { reply_to_message_id: messageId }));
      await withRetry(() => telegram.sendMessage(chatId, finalCaption, { reply_to_message_id: messageId }));
    } else {
      await withRetry(() => telegram.sendPhoto(chatId, 
        { source: previewBuffer },
        { caption: finalCaption, reply_to_message_id: messageId }
      ));
    }
  } else {
    await withRetry(() => telegram.sendMessage(chatId, finalCaption + `\n\nCover URL: ${renderedUrls[0]}`, { reply_to_message_id: messageId }));
  }

  let allPublishUrls: { type: 'image' | 'video', url: string }[] = renderedUrls.map(url => ({
    type: 'image',
    url
  }));

  console.log(`[Phase 5] Saving to Queue with ${allPublishUrls.length} media items`);
  
  templateData.coverImageUrl = coverImageUrl; 
  templateData.inputImages = extraImageUrls;
  
  await insertQueueItem({
    templateId: intervalTemplateConfig.id,
    templateData: templateData,
    text: finalCaption,
    media: allPublishUrls,
    status: 'pending', // Allows passing 'draft' or other statuses in the future
    researchResult: researchText
  });

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✅ Berhasil diselesaikan dan masuk Queue untuk di-publish!'));
  console.log(`[Done] Pipeline finished successfully.`);
}
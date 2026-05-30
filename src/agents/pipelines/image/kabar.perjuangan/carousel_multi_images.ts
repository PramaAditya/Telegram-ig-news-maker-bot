import { generateObject, generateText, generateImage } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { PipelineContext, ResearchResult, googleAI, withRetry } from '../../../../utils.js';
import { censorText } from '../../../../sanitize.js';
import { uploadToS3 } from '../../../../s3.js';
import { generateMedia } from '../../../../media.js';
import { insertQueueItem } from '../../../../db/queue.js';
import { curateImages } from '../../../image-curator/index.js';
import { marked } from 'marked';

// Helper for Roman numerals
const toRoman = (num: number) => {
  const roman: Record<string, number> = {
    M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1
  };
  let str = '';
  for (let i of Object.keys(roman)) {
    let q = Math.floor(num / roman[i]);
    num -= q * roman[i];
    str += i.repeat(q);
  }
  return str;
};

export const carouselMultiImagesTemplateConfig = {
  id: 'image:kabar.perjuangan:carousel_multi_images',
  name: 'Carousel Multi Images (kabar.perjuangan)',
  description: 'A 4-slide breaking news carousel with a cover image and 3 content slides each with its own curated image.',
  uiSchema: [
    { name: 'title', type: 'text', label: 'Title (supports **bold**)', aiContext: 'This is the title of a sensational news post. It should be scroll-stopping, casual, highly sensational, and provocative (but factual) breaking news style targeted at Gen Z Indonesians.' },
    { name: 'coverImageUrl', type: 'image', label: 'Cover Image' },
    { name: 'slides', type: 'array', label: 'Slides', itemType: 'object', itemSchema: [
      { name: 'text', type: 'text', label: 'Slide Text (supports **bold**)', aiContext: 'This is one slide out of a multi-slide news carousel. It should be written in clear, accessible, and easily understood Indonesian (Bahasa Indonesia yang membumi). Keep it PUNCHY, CONCISE, and FAST-PACED (singkat, padat, jelas) for a Gen-Z audience with a short attention span.' },
      { name: 'slide_image', type: 'image', label: 'Slide Background Image' }
    ]}
  ] as any[]
};

export async function generateCarouselMultiImagesMedia(templateData: any, settings: any): Promise<{ type: 'image' | 'video', url: string }[]> {
  const pages: any[] = [];
  
  pages.push({
    file: 'cover',
    context: {
      logo: settings.logoImageUrl || 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
      cover_image: templateData.coverImageUrl,
      title: marked.parseInline(templateData.title || '')
    }
  });

  if (templateData.slides) {
    templateData.slides.forEach((slide: any, i: number) => {
      pages.push({
        file: 'slide',
        context: {
          cover_image: templateData.coverImageUrl,
          slide_image: slide.slide_image,
          text: marked.parse(slide.text || ''),
          roman_number: toRoman(i + 1)
        }
      });
    });
  }

  if (templateData.inputImages) {
    templateData.inputImages.forEach((url: string) => {
      pages.push({
        file: 'image',
        context: {
          logo: settings.logoImageUrl || 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
          image_url: url
        }
      });
    });
  }

  const renderPayload = {
    viewport: { width: 1080, height: 1350 },
    pages
  };

  const renderedUrls = await generateMedia('/render/image/kabar.perjuangan/carousel_multi_images', renderPayload);

  if (!renderedUrls || renderedUrls.length === 0) {
    throw new Error('Failed to render images from external API.');
  }

  return renderedUrls.map((url: string) => ({
    type: 'image' as const,
    url
  }));
}

export async function runCarouselMultiImagesPipeline(context: PipelineContext, research: ResearchResult) {
  const { chatId, messageId, telegram, statusMsg, userInput, settings, currentDateStr, baseSystemPrompt } = context;
  const { researchText, scrapedImageUrl, processedMedia } = research;

  const defaultGuidelines = process.env.EDITORIAL_GUIDELINES || `Your reporting should maintain a professional and highly informative journalistic tone. Focus on delivering factual news while highlighting perspectives from the Global South, particularly Palestine, Lebanon, Iran, Iraq, and Yemen. When covering conflicts or international relations, critically examine the roles, policies, and actions of the US, Israel, and their allies.\n\nCrucially, avoid emotive language, sensationalism, or blatant propaganda. Let the facts, context, and a comprehensive delivery of the 5W1H (Who, What, When, Where, Why, How) drive the narrative. Your goal is to inform the audience thoroughly and objectively within the constraints of a short format.`;
  const editorialGuidelines = settings.editorialGuidelines || defaultGuidelines;
  const bannedWords = settings.bannedWords || [];
  
  const bannedWordsPrompt = bannedWords.length > 0 
    ? `\n\nCRITICAL MODERATION RULE:\nYou are allowed to discuss sensitive topics, but you MUST replace specific words with their safe alternatives for spelling. Whenever you would normally write one of the following words, you MUST use its exact replacement instead:\n${bannedWords.map((w: any) => `- Replace "${w.word}" with "${w.replacement}"`).join('\n')}`
    : '';

  const imageMediaItems = processedMedia ? processedMedia.filter(m => m.type === 'image' && m.buffer) : [];
  
  const slideCount = 3;

  const dynamicSystemPromptAdditions = `
Your task is to parse the gathered facts into final components for an Instagram news carousel.
- title: Scroll-stopping, casual, highly sensational, and provocative (but factual) breaking news style. Target audience is Gen Z Indonesians. Use natural, modern, and impactful Indonesian phrasing. AVOID sounding repetitive, robotic, or overusing cliché slang like "Kena Mental" or "Skakmat". Make it sound like an authentic viral news alert on social media. Highlight the key factual phrase with HTML tags (<strong>text</strong>). Do NOT use markdown. IT MUST BE PROPER TITLE CASING (Capitalize the first letter of each major word, including inside the tags).
- slides: An array of exactly ${slideCount} objects, representing ${slideCount} slides explaining the news. Write in clear, accessible, and easily understood Indonesian (Bahasa Indonesia yang membumi). Keep it PUNCHY, CONCISE, and FAST-PACED (singkat, padat, jelas) for a Gen-Z audience with a short attention span. AVOID complex political or academic jargon. Each slide MUST be exactly 1 short paragraph containing at most 2 sentences. Get straight to the point without unnecessary fluff. Answer the 5W1H comprehensively across the ${slideCount} slides. Do NOT repeat information already stated in the title.
  For each slide, you must also provide an \`image_search_query\` which is a concrete, real-world noun search query in English to find a relevant background image for that specific slide's content.
- source_name: The original news source (e.g., Al Jazeera). If multiple, pick the most prominent.
- image_prompt: A prompt for an AI image generator to create an accompanying cover background image. MUST specify: "masterpiece professional photography, dramatic backlighting, heavy chiaroscuro, extreme low key".
`;

  const dynamicSchema = z.object({
    title: z.string(),
    slides: z.array(z.object({
      text: z.string().describe('Max 2 sentences.'),
      image_search_query: z.string().describe('Search query in English for a relevant background image.')
    })).length(slideCount),
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
    finalCaption = `${contentParams.slides.map(s => s.text).join('\n\n')}\n\n${currentDateStr}. Sumber: ${contentParams.source_name}`;
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
        const response = await fetch(scrapedImageUrl, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        baseImageBuffer = Buffer.from(arrayBuffer);
      } catch (err: any) {
      console.warn(`[Phase 3] Failed to download scraped image: ${err.message}`);
    }
  }

  // Fallback: search for an image using Firecrawl based on the topic
  if (!baseImageBuffer) {
    console.log(`[Phase 3] No image found so far. Searching the web for an image related to: ${contentParams.title}`);
    try {
      const { firecrawlService } = await import('../../../../utils/firecrawl.js');
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
           const response = await fetch(foundImageUrl, { signal: AbortSignal.timeout(10000) });
           if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
           const arrayBuffer = await response.arrayBuffer();
           baseImageBuffer = Buffer.from(arrayBuffer);
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

  let generatedFileBuffer: Buffer | null = null;
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Phase 3] AI Image generation attempt ${attempt}...`);
      const { image } = await generateImage({
        model: google.image('gemini-3.1-flash-image-preview'),
        prompt: {
          text: imageGenerationPrompt,
          images: baseImageBuffer ? [baseImageBuffer] : [],
        },
        aspectRatio: '1:1'
      });
      
      if (image && image.base64) {
        generatedFileBuffer = Buffer.from(image.base64, 'base64');
        break; // Success, exit retry loop
      }
    } catch (error) {
      console.warn(`[Phase 3] AI Image generation failed on attempt ${attempt}:`, error);
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }

  if (!generatedFileBuffer) {
    console.warn(`[Phase 3] Failed to generate AI image after ${maxRetries} attempts. Falling back to base image or empty.`);
    if (baseImageBuffer) {
      generatedFileBuffer = baseImageBuffer;
    } else {
      // Create a 1x1 black transparent PNG as a safe fallback if absolutely no image exists
      generatedFileBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    }
  }

  console.log(`[Phase 3] Uploading generated/enhanced image to S3...`);
  const coverImageUrl = await uploadToS3(generatedFileBuffer, 'image/jpeg', '.jpg');

  if (!coverImageUrl) {
    throw new Error('Gagal mendapatkan URL gambar.');
  }

  // Phase 3.5: Curate Images for Slides
  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🔍 Mencari gambar untuk setiap slide...'));
  
  const curatedSlides = [];
  
  for (let i = 0; i < contentParams.slides.length; i++) {
    const slide = contentParams.slides[i];
    console.log(`[Phase 3.5] Curating image for slide ${i + 1}: ${slide.image_search_query}`);
    let slide_image = '';
    try {
      const curated = await curateImages({
        query: slide.image_search_query,
        context: slide.text,
        targetCount: 1
      });
      
      if (curated && curated.length > 0 && curated[0].originalUrl) {
         console.log(`[Phase 3.5] Downloading curated image for slide ${i+1}: ${curated[0].originalUrl}`);
         const res = await fetch(curated[0].originalUrl, { signal: AbortSignal.timeout(10000) });
         if (res.ok) {
           let mimeType = res.headers.get('content-type') || 'image/jpeg';
           if (!mimeType.startsWith('image/')) {
             mimeType = 'image/jpeg';
           }
           const ext = mimeType === 'image/png' ? '.png' : '.jpg';
           const arrayBuffer = await res.arrayBuffer();
           slide_image = await uploadToS3(Buffer.from(arrayBuffer), mimeType, ext) || '';
         }
      }
    } catch (e: any) {
      console.warn(`[Phase 3.5] Failed to curate or upload image for slide ${i+1}:`, e.message);
    }
    
    if (!slide_image) {
      console.log(`[Phase 3.5] No image found for slide ${i + 1}. Falling back to AI image generation...`);
      let generatedFileBuffer: Buffer | null = null;
      const maxRetries = 3;
      const slidePromptSuffix = "masterpiece professional photography, realistic, photorealistic, documentary style, highly detailed, sharp focus, 4k resolution. NO cartoon, NO drawing, NO illustration, NO text.";
      const imageGenerationPrompt = `${slide.image_search_query}, ${slidePromptSuffix}`;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[Phase 3.5] Slide ${i + 1} AI Image generation attempt ${attempt}...`);
          const { image } = await generateImage({
            model: google.image('gemini-3.1-flash-image-preview'),
            prompt: imageGenerationPrompt,
            aspectRatio: '1:1'
          });
          
          if (image && image.base64) {
            generatedFileBuffer = Buffer.from(image.base64, 'base64');
            break;
          }
        } catch (error: any) {
          console.warn(`[Phase 3.5] Slide ${i + 1} AI Image generation failed on attempt ${attempt}:`, error.message);
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(res => setTimeout(res, delay));
          }
        }
      }

      if (generatedFileBuffer) {
        console.log(`[Phase 3.5] Uploading generated image for slide ${i + 1}...`);
        try {
          slide_image = await uploadToS3(generatedFileBuffer, 'image/jpeg', '.jpg') || '';
        } catch (uploadError: any) {
          console.warn(`[Phase 3.5] Failed to upload generated image for slide ${i + 1}:`, uploadError.message);
        }
      }
    }

    curatedSlides.push({
      text: slide.text,
      slide_image
    });
  }

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...'));

  // Phase 4: Image Rendering
  console.log(`[Phase 4] Rendering media via API for template ${carouselMultiImagesTemplateConfig.id}`);
  
  let cleanTitle = contentParams.title || '';
  if (cleanTitle) {
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu;
    cleanTitle = censorText(cleanTitle.replace(emojiRegex, ''), bannedWords);
  }

  let templateData: any = { title: cleanTitle, coverImageUrl };

  if (curatedSlides.length > 0) {
    await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✨ Menambahkan highlight teks...'));
    console.log(`[Phase 4] Enhancing slides with markdown bolding via gemini-3.1-flash-lite...`);
    
    const highlightText = async (text: string) => {
      try {
        const { text: boldedText } = await generateText({
          model: googleAI('gemini-3.1-flash-lite'),
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

    const enhancedSlides = await Promise.all(curatedSlides.map(async (slide: any) => {
      const boldedText = await highlightText(slide.text);
      return {
        text: censorText(boldedText, bannedWords),
        slide_image: slide.slide_image
      };
    }));
    templateData.slides = enhancedSlides;
  } else {
    templateData.slides = [];
  }

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Merender desain post...'));

  const pages: any[] = [];
  
  pages.push({
    file: 'cover',
    context: {
      logo: settings.logoImageUrl || 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
      cover_image: coverImageUrl,
      title: marked.parseInline(templateData.title || '')
    }
  });

  if (templateData.slides) {
    templateData.slides.forEach((slide: any, i: number) => {
      pages.push({
        file: 'slide',
        context: {
          cover_image: coverImageUrl,
          slide_image: slide.slide_image,
          text: marked.parse(slide.text || ''),
          roman_number: toRoman(i + 1)
        }
      });
    });
  }

  const renderPayload = {
    viewport: { width: 1080, height: 1350 },
    pages
  };

  const renderedUrls = await generateMedia('/render/image/kabar.perjuangan/carousel_multi_images', renderPayload);

  if (!renderedUrls || renderedUrls.length === 0) {
    throw new Error('Gagal merender carousel dari API.');
  }

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🚀 Mempublikasikan ke Queue...'));

  // Phase 5: Publishing via Queue
  console.log(`[Phase 5] Sending rendered photo to user and preparing Buffer URLs`);
  
  let previewBuffer: Buffer | undefined;
    try {
      const response = await fetch(renderedUrls[0]);
      if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      previewBuffer = Buffer.from(arrayBuffer);
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
  templateData.inputImages = [];
  
  await insertQueueItem({
    connectionId: settings.id,
    templateId: carouselMultiImagesTemplateConfig.id,
    templateData: templateData,
    text: finalCaption,
    media: allPublishUrls,
    status: 'pending', // Allows passing 'draft' or other statuses in the future
    researchResult: researchText
  });

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✅ Berhasil diselesaikan dan masuk Queue untuk di-publish!'));
  console.log(`[Done] Pipeline finished successfully.`);
}
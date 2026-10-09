import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { PipelineContext, ResearchResult, googleAI, withRetry } from '../../../../utils.js';
import { censorText } from '../../../../sanitize.js';
import { uploadToS3 } from '../../../../s3.js';
import { generateMedia } from '../../../../media.js';
import { insertQueueItem } from '../../../../db/queue.js';
import { marked } from 'marked';
import { imageEditor } from '../../../../utils/imageEditor/index.js';
import { buildPromptContextFromInsights } from '../../../editorial/registry.js';

export const carouselAnalysisTemplateConfig = {
  id: 'image:aa.geopolitik:carousel_analysis',
  name: 'Carousel Analysis (AA Geopolitik)',
  description: 'An in-depth geopolitical analysis carousel featuring impactful Bebas Neue headlines, Alumni Sans analytical body copy, and amber contrast highlights.',
  albumStrategy: 'all_as_slides' as const,
  reduceTextOnAlbum: true,
  slidesComposition: { news: 2, opinion: 2 },
  requiredEditorialAgents: ['research', 'opinion'],
  regenerateContent: async (templateData: any, settings: any, insights: Record<string, string>, context: PipelineContext) => {
    const { title, subtitle, slides, source_name, source_url, finalCaption } = await generateCarouselAnalysisContent(context, insights);
    return {
      text: finalCaption,
      templateData: {
        ...templateData,
        title,
        subtitle,
        slides,
        source_name,
        source_url: source_url || templateData.source_url,
      }
    };
  },
  uiSchema: [
    { 
      name: 'title', 
      type: 'text', 
      label: 'Main Headline (Bebas Neue, supports **bold** / <strong> for amber)', 
      aiContext: 'Scroll-stopping headline for geopolitical analysis in Bahasa Indonesia. Bold important keywords with **text** or <strong>text</strong> to turn them amber.' 
    },
    { 
      name: 'subtitle', 
      type: 'text', 
      label: 'Cover Subtitle (Alumni Sans)', 
      aiContext: 'A punchy, intriguing subtitle framing the problem or misconception, e.g. "Banyak yang Masih Salah Paham".' 
    },
    { name: 'source_name', type: 'string', label: 'Source Media Name' },
    { name: 'source_url', type: 'string', label: 'Source Article URL' },
    { name: 'coverImageUrl', type: 'image', label: 'Cover Image' },
    {
      name: 'slides',
      type: 'array',
      label: 'Analysis Slides',
      itemType: 'polymorphic',
      slideTypes: [
        {
          type: 'opinion',
          label: 'Analisis Opini',
          icon: 'Lightbulb',
          requiredInsights: ['research', 'opinion'],
          promptInstruction: 'Sintesis fakta geopolitik dengan sudut pandang analitis tajam. Berikan judul pertanyaan/tesis di title dan analisis di text.',
          fields: [
            {
              name: 'title',
              type: 'text',
              label: 'Slide Question / Heading (Bebas Neue, **bold** = amber)',
              aiContext: 'A bold question or key thesis heading for this analysis slide. Bold the highlight word.'
            },
            {
              name: 'text',
              type: 'text',
              label: 'Analytical Paragraph (Alumni Sans, supports **bold**)',
              aiContext: 'Detailed geopolitical insight in accessible Bahasa Indonesia. Use **bold** on pivotal keywords and power verbs.'
            },
            {
              name: 'slide_image',
              type: 'image',
              label: 'Slide Background Image (Optional)'
            }
          ]
        },
        {
          type: 'news',
          label: 'Fakta Geopolitik',
          icon: 'Newspaper',
          requiredInsights: ['research'],
          promptInstruction: 'Fokus murni pada fakta 5W1H peristiwa internasional/geopolitik yang terjadi.',
          fields: [
            {
              name: 'title',
              type: 'text',
              label: 'Slide Heading (Bebas Neue, **bold** = amber)'
            },
            {
              name: 'text',
              type: 'text',
              label: 'Factual Paragraph (Alumni Sans, supports **bold**)'
            },
            {
              name: 'slide_image',
              type: 'image',
              label: 'Slide Background Image (Optional)'
            }
          ]
        },
        {
          type: 'text',
          label: 'Text Slide',
          icon: 'FileText',
          requiredInsights: ['research'],
          fields: [
            {
              name: 'title',
              type: 'text',
              label: 'Slide Heading (Bebas Neue)'
            },
            {
              name: 'text',
              type: 'text',
              label: 'Slide Text (Alumni Sans)'
            }
          ]
        },
        {
          type: 'image',
          label: 'Full Image / Map',
          icon: 'Image',
          requiredInsights: [],
          fields: [
            {
              name: 'imageUrl',
              type: 'image',
              label: 'Full Slide Image'
            }
          ]
        }
      ]
    }
  ] as any[]
};

export async function generateCarouselAnalysisMedia(templateData: any, settings: any): Promise<{ type: 'image' | 'video', url: string }[]> {
  const pages: any[] = [];
  
  pages.push({
    file: 'cover',
    context: {
      logo: settings?.logoImageUrl || '',
      cover_image: templateData.coverImageUrl,
      title: marked.parseInline(templateData.title || ''),
      subtitle: templateData.subtitle || '',
      cta_text: templateData.cta_text || 'Read More'
    }
  });

  const totalSlides = templateData.slides?.length || 0;
  if (templateData.slides && Array.isArray(templateData.slides)) {
    templateData.slides.forEach((slide: any, index: number) => {
      if (slide && typeof slide === 'object' && (slide.type === 'image' || (!slide.type && slide.imageUrl))) {
        pages.push({
          file: 'image',
          context: {
            logo: settings?.logoImageUrl || '',
            image_url: slide.imageUrl
          }
        });
      } else {
        const rawTitle = slide?.title ? marked.parseInline(slide.title) : '';
        const rawText = typeof slide === 'string' ? slide : (slide?.text || '');
        pages.push({
          file: 'slide',
          context: {
            logo: settings?.logoImageUrl || '',
            cover_image: templateData.coverImageUrl,
            slide_image: slide?.slide_image || templateData.coverImageUrl,
            title: rawTitle,
            text: marked.parse(rawText),
            slide_number: `${index + 1}/${totalSlides}`
          }
        });
      }
    });
  }

  if (templateData.inputImages) {
    templateData.inputImages.forEach((url: string) => {
      pages.push({
        file: 'image',
        context: {
          logo: settings?.logoImageUrl || '',
          image_url: url
        }
      });
    });
  }


  const renderPayload = {
    viewport: { width: 1080, height: 1350 },
    pages
  };

  const renderedUrls = await generateMedia('/render/image/aa.geopolitik/carousel_analysis', renderPayload);

  if (!renderedUrls || renderedUrls.length === 0) {
    throw new Error('Failed to render carousel from external API.');
  }

  return renderedUrls.map((url: string) => ({
    type: 'image' as const,
    url
  }));
}

export async function runCarouselAnalysisPipeline(
  context: PipelineContext,
  research: ResearchResult,
  agentInsights?: Record<string, string>
) {
  const { userInput, telegram, statusMsg, chatId, messageId, settings, candidateSources } = context;
  const bannedWords = settings?.bannedWords || [];
  const insights = agentInsights || { research: research.text };

  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✍️ Menulis analisis geopolitik...'));

  // Phase 1: Content Synthesis
  console.log(`[Phase 1] Synthesizing Geopolitical Analysis via Gemini...`);
  const contentParams = await generateCarouselAnalysisContent(context, insights, candidateSources, research.primarySourceUrl);

  // Phase 2: Cover Visual Curation / Generation
  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🎨 Menyiapkan visual cover...'));
  let coverImageUrl = '';

  const isAlbum = context.mediaItems && context.mediaItems.length > 0;
  const imageMediaItems = isAlbum ? context.mediaItems.filter(item => item.type === 'image') : [];

  if (imageMediaItems.length > 0 && imageMediaItems[0].buffer) {
    console.log(`[Phase 2] Using user uploaded image for cover...`);
    const uploadedUrl = await uploadToS3(
      imageMediaItems[0].buffer, 
      imageMediaItems[0].mimeType || 'image/jpeg', 
      imageMediaItems[0].mimeType === 'image/png' ? '.png' : '.jpg'
    );
    if (uploadedUrl) coverImageUrl = uploadedUrl;
  }

  if (!coverImageUrl) {
    console.log(`[Phase 2] Generating cover visual with prompt: "${contentParams.image_prompt}"...`);
    try {
      const generatedBuffer = await imageEditor.generateImage(contentParams.image_prompt);
      const uploadedUrl = await uploadToS3(generatedBuffer, 'image/jpeg', '.jpg');
      if (uploadedUrl) coverImageUrl = uploadedUrl;
    } catch (imgErr) {
      console.warn('Failed to generate image via imageEditor, falling back to placeholder:', imgErr);
      coverImageUrl = 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=1080&auto=format&fit=crop';
    }
  }

  let extraImageUrls: string[] = [];
  if (isAlbum && carouselAnalysisTemplateConfig.albumStrategy === 'all_as_slides') {
    for (const item of imageMediaItems.slice(1)) {
      if (item.buffer) {
        const url = await uploadToS3(item.buffer, item.mimeType || 'image/jpeg', item.mimeType === 'image/png' ? '.png' : '.jpg');
        if (url) extraImageUrls.push(url);
      }
    }
  }

  // Phase 3: Highlight Enhancement
  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '✨ Menambahkan highlight teks...'));
  
  const highlightText = async (text: string) => {
    try {
      const { text: boldedText } = await generateText({
        model: googleAI('gemini-3.1-flash-lite'),
        system: `You are an editor for an analytical geopolitical Instagram carousel. Add bold markdown (using **text**) to the most critical words, clauses, or territorial concepts.
RULES:
1. Do not change words, only add ** around key highlights.
2. Bold around 20-30% of key phrases to maintain high visual impact.
3. Output ONLY the modified text.`,
        prompt: text
      });
      return boldedText.trim() || text;
    } catch (err) {
      return text;
    }
  };

  const enhancedSlides = await Promise.all(contentParams.slides.map(async (slide) => {
    const bolded = await highlightText(slide.text);
    return {
      ...slide,
      text: censorText(bolded, bannedWords)
    };
  }));

  const templateData: any = {
    title: censorText(contentParams.title, bannedWords),
    subtitle: censorText(contentParams.subtitle, bannedWords),
    slides: enhancedSlides,
    source_name: contentParams.source_name,
    source_url: contentParams.source_url,
    coverImageUrl,
    inputImages: extraImageUrls
  };

  // Phase 4: Media Rendering
  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🖼️ Merender desain carousel...'));
  const renderedMedia = await generateCarouselAnalysisMedia(templateData, settings);

  // Phase 5: Queue Insertion
  await withRetry(() => telegram.editMessageText(statusMsg.chat.id, statusMsg.message_id, undefined, '🚀 Menyimpan ke Queue...'));
  const [inserted] = await insertQueueItem({
    connectionId: settings.id,
    templateId: carouselAnalysisTemplateConfig.id,
    templateData,
    text: contentParams.finalCaption,
    media: renderedMedia,
    status: 'pending',
    chatId,
    messageId,
    researchResult: research.text,
    agentInsights: insights,
    rawInput: userInput
  });

  const postButton = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✏️ Edit Queued Post', url: `${process.env.APP_URL}/post/${inserted.id}` }]
      ]
    }
  };

  if (renderedMedia.length > 0) {
    try {
      const response = await fetch(renderedMedia[0].url);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const previewBuffer = Buffer.from(arrayBuffer);
        await withRetry(() => telegram.sendPhoto(chatId, { source: previewBuffer }, {
          caption: contentParams.finalCaption,
          reply_to_message_id: messageId,
          ...postButton
        }));
      }
    } catch (e) {
      await withRetry(() => telegram.sendMessage(chatId, contentParams.finalCaption, { reply_to_message_id: messageId, ...postButton }));
    }
  }

  await withRetry(() => telegram.deleteMessage(statusMsg.chat.id, statusMsg.message_id)).catch(() => {});
  console.log(`[Done] Geopolitical Analysis Pipeline finished.`);
}

export async function generateCarouselAnalysisContent(
  context: PipelineContext,
  insights: Record<string, string>,
  candidateSources?: any[],
  primarySourceUrl?: string | null
): Promise<{
  title: string;
  subtitle: string;
  slides: { type: string; title?: string; text: string }[];
  source_name: string;
  source_url?: string;
  image_prompt: string;
  finalCaption: string;
}> {
  const { userInput, settings, currentDateStr, baseSystemPrompt } = context;
  const defaultGuidelines = `Fokus pada analisis geopolitik realistis: kepentingan wilayah (teritori), sumber daya alam/energi, aliansi militer, rute dagang, dan kalkulasi strategis negara-negara. Hindari narasi simplistik (seperti menganggap konflik geopolitik semata-mata soal sentimen agama atau emosi moral). Buka tabir di balik motif kekuatan besar dengan lugas dan mendalam.`;
  const editorialGuidelines = settings?.editorialGuidelines || defaultGuidelines;
  const bannedWords = settings?.bannedWords || [];

  const bannedWordsPrompt = bannedWords.length > 0 
    ? `\n\nCRITICAL MODERATION RULE:\nReplace sensitive words with safe alternatives:\n${bannedWords.map((w: any) => `- Replace "${w.word}" with "${w.replacement}"`).join('\n')}`
    : '';

  const dynamicSystemPromptAdditions = `
Your task is to craft an in-depth geopolitical analysis carousel for Instagram.
1. title: The main cover headline in proper Title Casing. Highlight the most punchy/controversial phrase with <strong>...</strong> (this turns amber in the Bebas Neue font). Example: "Geopolitik Itu <strong>BUKAN Cuma Perang Agama!</strong>"
2. subtitle: A punchy cover subtitle in Alumni Sans explaining the angle or misconception. Example: "Banyak yang Masih Salah Paham" or "Membongkar Motif Tersembunyi di Balik Perebutan Wilayah".
3. slides: Exactly 4 slides structuring a compelling story arc:
   - Slide 1 (news): Context/Trigger — what event just happened or what reality are people talking about? Heading should be a clear question or statement.
   - Slide 2 (opinion): The Core Interest — what resource, territory, or strategic chokepoint is actually at stake?
   - Slide 3 (opinion): The Power Play — how are major powers maneuvering or using proxies to secure advantage?
   - Slide 4 (opinion): Reflection/Punchline — realistic takeaway for readers on what to watch next.
   Each slide text must be 1 concise paragraph (2-3 sentences max) in lucid, powerful Indonesian.
4. source_name: Reputable primary news/analysis source (e.g. Foreign Policy, Al Jazeera, Reuters, Antara).
5. source_url: Direct article URL.
6. image_prompt: AI prompt for a dramatic geopolitical cover background image. Specify: "dramatic cinematic lighting, high-contrast chiaroscuro, global conflict geopolitics concept, strategic maps or embassy summit silhouette".
`;

  const slideSchema = z.object({
    type: z.enum(['news', 'opinion']),
    title: z.string().describe('Slide heading in Bebas Neue. Bold words with <strong> for amber accent.'),
    text: z.string().describe('Analytical body paragraph in Alumni Sans.')
  });

  const schema = z.object({
    title: z.string(),
    subtitle: z.string(),
    slides: z.array(slideSchema).length(4),
    source_name: z.string(),
    source_url: z.string().optional(),
    image_prompt: z.string()
  });

  const writerSystemPrompt = baseSystemPrompt + `\n\nEDITORIAL GUIDELINES & FRAMING:\n${editorialGuidelines}\n\n${dynamicSystemPromptAdditions}` + bannedWordsPrompt;
  const insightsPrompt = buildPromptContextFromInsights(insights);

  const { object: contentParams } = await generateObject({
    model: googleAI(process.env.CONTENT_WRITER_MODEL || 'gemini-3.1-pro-preview'),
    system: writerSystemPrompt,
    schema,
    prompt: `Original User Input/Topic:\n${userInput}\n\nGathered Insights:\n${insightsPrompt || ''}${candidateSources && candidateSources.length > 0 ? '\n\nCandidate Source URLs:\n' + candidateSources.map((c: any) => `- ${c.title || c.domain || ''}: ${c.url}`).join('\n') : ''}`,
  });

  let finalCaption = `${contentParams.title.replace(/<[^>]+>/g, '')}\n\n${contentParams.subtitle}\n\n` +
    contentParams.slides.map((s, idx) => `[${idx + 1}] ${s.title.replace(/<[^>]+>/g, '')}\n${s.text}`).join('\n\n') +
    `\n\n${currentDateStr}. Sumber: ${contentParams.source_name}`;
  finalCaption = censorText(finalCaption, bannedWords);

  return {
    title: contentParams.title,
    subtitle: contentParams.subtitle,
    slides: contentParams.slides,
    source_name: contentParams.source_name,
    source_url: contentParams.source_url || primarySourceUrl || undefined,
    image_prompt: contentParams.image_prompt,
    finalCaption
  };
}

import { z } from 'zod';

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  systemPromptAdditions: string;
  schema: z.ZodType<any>;
  renderEndpoint: string;
  prepareRenderPayload: (templateData: any, settings: any, coverImageUrl?: string) => any;
}

export const TEMPLATES: Record<string, TemplateConfig> = {
  'image-multiple:interval': {
    id: 'image-multiple:interval',
    name: 'Interval News (Carousel)',
    description: 'A 2-slide breaking news carousel with a cover image.',
    systemPromptAdditions: `
Your task is to parse the gathered facts into final components for an Instagram news carousel.
- title: Scroll-stopping, casual, highly sensational, and provocative (but factual) breaking news style. Target audience is Gen Z Indonesians. Use natural, modern, and impactful Indonesian phrasing. AVOID sounding repetitive, robotic, or overusing cliché slang like "Kena Mental" or "Skakmat". Make it sound like an authentic viral news alert on social media. Highlight the key factual phrase with HTML tags (<strong>text</strong>). Do NOT use markdown. IT MUST BE PROPER TITLE CASING (Capitalize the first letter of each major word, including inside the tags).
- slides: An array of exactly 2 strings, representing two slides explaining the news. Write in clear, accessible, and easily understood Indonesian (Bahasa Indonesia yang membumi). Keep it PUNCHY, CONCISE, and FAST-PACED (singkat, padat, jelas) for a Gen-Z audience with a short attention span. AVOID complex political or academic jargon (e.g. use "hak penuh sebagai negara merdeka" instead of "hak kedaulatan"). Each slide MUST be exactly 1 short paragraph containing at most 2 sentences. Get straight to the point without unnecessary fluff. Answer the 5W1H comprehensively across the two slides. Do NOT repeat information already stated in the title.
- source_name: The original news source (e.g., Al Jazeera). If multiple, pick the most prominent.
- image_prompt: A prompt for an AI image generator to create an accompanying cover background image. MUST specify: "masterpiece professional photography, dramatic backlighting, heavy chiaroscuro, extreme low key".
`,
    schema: z.object({
      title: z.string(),
      slides: z.array(z.string()).length(2),
      source_name: z.string(),
      image_prompt: z.string(),
    }),
    renderEndpoint: '/render-template-multiple',
    prepareRenderPayload: (data, settings, coverImageUrl) => ({
      logo: settings.logoImageUrl || 'https://storage.pelita.tech/logo_kabar_perjuangan_white.png',
      cover_image: coverImageUrl || data.coverImageUrl,
      title: data.title,
      slides: data.slides.map((text: string) => ({ text }))
    })
  }
};

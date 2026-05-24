import { PipelineContext, ResearchResult } from './utils.js';
import { runCarouselDarkPipeline, carouselDarkTemplateConfig, generateCarouselDarkMedia } from './agents/pipelines/image/kabar.perjuangan/carousel_dark.js';

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  runPipeline: (context: PipelineContext, research: ResearchResult) => Promise<void>;
  regenerateMedia: (templateData: any, settings: any) => Promise<{ type: 'image' | 'video', url: string }[]>;
}

export const TEMPLATES: Record<string, TemplateConfig> = {
  [carouselDarkTemplateConfig.id]: {
    ...carouselDarkTemplateConfig,
    runPipeline: runCarouselDarkPipeline,
    regenerateMedia: generateCarouselDarkMedia
  }
};

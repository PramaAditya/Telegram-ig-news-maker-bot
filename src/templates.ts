import { PipelineContext, ResearchResult } from './utils.js';
import { runCarouselDarkPipeline, carouselDarkTemplateConfig, generateCarouselDarkMedia } from './agents/pipelines/image/kabar.perjuangan/carousel_dark.js';
import { runCarouselMultiImagesPipeline, carouselMultiImagesTemplateConfig, generateCarouselMultiImagesMedia } from './agents/pipelines/image/kabar.perjuangan/carousel_multi_images.js';
import { runTitleOnlyPipeline, titleOnlyTemplateConfig, generateTitleOnlyMedia } from './agents/pipelines/video/kabar.perjuangan/title_only.js';

export interface TemplateField {
  name: string;
  type: 'text' | 'image' | 'array' | string;
  label: string;
  aiContext?: string;
  itemType?: 'text' | 'object';
  itemSchema?: TemplateField[];
}

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  uiSchema?: TemplateField[];
  skipResearch?: boolean;
  runPipeline: (context: PipelineContext, research: ResearchResult) => Promise<void>;
  regenerateMedia: (templateData: any, settings: any) => Promise<{ type: 'image' | 'video', url: string }[]>;
}

export const TEMPLATES: Record<string, TemplateConfig> = {
  [carouselDarkTemplateConfig.id]: {
    ...carouselDarkTemplateConfig,
    runPipeline: runCarouselDarkPipeline,
    regenerateMedia: generateCarouselDarkMedia
  },
  [carouselMultiImagesTemplateConfig.id]: {
    ...carouselMultiImagesTemplateConfig,
    runPipeline: runCarouselMultiImagesPipeline,
    regenerateMedia: generateCarouselMultiImagesMedia
  },
  [titleOnlyTemplateConfig.id]: {
    ...titleOnlyTemplateConfig,
    runPipeline: runTitleOnlyPipeline,
    regenerateMedia: generateTitleOnlyMedia
  }
};

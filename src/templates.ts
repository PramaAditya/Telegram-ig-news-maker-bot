import { PipelineContext, ResearchResult } from './utils.js';
import { runCarouselDarkPipeline, carouselDarkTemplateConfig, generateCarouselDarkMedia } from './agents/pipelines/image/poros.perjuangan/carousel_dark.js';
import { runCarouselMultiImagesPipeline, carouselMultiImagesTemplateConfig, generateCarouselMultiImagesMedia } from './agents/pipelines/image/poros.perjuangan/carousel_multi_images.js';
import { runSinglePagePipeline, singlePageTemplateConfig, generateSinglePageMedia } from './agents/pipelines/image/poros.perjuangan/single_page.js';
import { runTitleOnlyPipeline, titleOnlyTemplateConfig, generateTitleOnlyMedia } from './agents/pipelines/video/poros.perjuangan/title_only.js';

export type AlbumStrategy = 'first_only' | 'all_as_slides' | 'distribute_to_slides' | 'first_video_only' | 'ignore';

export interface SlideTypeDefinition {
  type: string;
  label: string;
  icon?: string;
  fields: TemplateField[];
}

export interface TemplateField {
  name: string;
  type: 'text' | 'image' | 'array' | 'string' | 'input' | string;
  label: string;
  aiContext?: string;
  itemType?: 'text' | 'object' | 'polymorphic';
  itemSchema?: TemplateField[];
  slideTypes?: SlideTypeDefinition[];
}

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  uiSchema?: TemplateField[];
  skipResearch?: boolean;
  albumStrategy?: AlbumStrategy;
  reduceTextOnAlbum?: boolean;
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
  [singlePageTemplateConfig.id]: {
    ...singlePageTemplateConfig,
    runPipeline: runSinglePagePipeline,
    regenerateMedia: generateSinglePageMedia
  },
  [titleOnlyTemplateConfig.id]: {
    ...titleOnlyTemplateConfig,
    runPipeline: runTitleOnlyPipeline,
    regenerateMedia: generateTitleOnlyMedia
  }
};

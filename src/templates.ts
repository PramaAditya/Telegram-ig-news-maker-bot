import { PipelineContext, ResearchResult } from './utils.js';
import { runIntervalPipeline, intervalTemplateConfig, generateIntervalMedia } from './agents/pipelines/image-multiple/interval.js';

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  runPipeline: (context: PipelineContext, research: ResearchResult) => Promise<void>;
  regenerateMedia: (templateData: any, settings: any) => Promise<{ type: 'image' | 'video', url: string }[]>;
}

export const TEMPLATES: Record<string, TemplateConfig> = {
  [intervalTemplateConfig.id]: {
    ...intervalTemplateConfig,
    runPipeline: runIntervalPipeline,
    regenerateMedia: generateIntervalMedia
  }
};

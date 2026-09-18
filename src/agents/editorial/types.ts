import { PipelineContext } from '../../utils.js';

export interface AgentStepConfig {
  id: string;
  name: string;
  label: string;
  description?: string;
  icon?: string;
  badgeColor?: 'blue' | 'amber' | 'emerald' | 'purple' | 'rose' | 'gray';
  displayOrder?: number;
  ui?: {
    format?: 'markdown' | 'text' | 'json';
    collapsible?: boolean;
    defaultExpanded?: boolean;
    editable?: boolean;
  };
  promptContext?: {
    header: string;
  };
}

export type AgentInsights = Record<string, string>;

export interface EditorialAgent {
  config: AgentStepConfig;
  run: (context: PipelineContext, previousInsights?: AgentInsights) => Promise<string>;
}

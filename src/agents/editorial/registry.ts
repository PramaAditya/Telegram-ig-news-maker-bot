import { AgentStepConfig, AgentInsights, EditorialAgent } from './types.js';
import { researchAgentConfig, runResearchPhase } from './research.js';
import { opinionAgentConfig, runOpinionPhase } from './opinion.js';

export const EDITORIAL_AGENTS: Record<string, EditorialAgent> = {
  [researchAgentConfig.id]: {
    config: researchAgentConfig,
    run: async (context) => {
      const res = await runResearchPhase(context);
      return res.researchText;
    },
  },
  [opinionAgentConfig.id]: {
    config: opinionAgentConfig,
    run: async (context, previousInsights) => {
      const researchText = previousInsights?.research || '';
      return runOpinionPhase(context, researchText);
    },
  },
};

export function getEditorialAgentConfigs(): AgentStepConfig[] {
  return [researchAgentConfig, opinionAgentConfig].sort(
    (a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)
  );
}

export function buildPromptContextFromInsights(
  insights?: AgentInsights | null,
  requiredInsights?: string[]
): string {
  if (!insights || typeof insights !== 'object') return '';

  const configs = getEditorialAgentConfigs();
  const keysToInclude = requiredInsights && requiredInsights.length > 0
    ? requiredInsights
    : configs.map(c => c.id);

  const sections: string[] = [];

  for (const key of keysToInclude) {
    const text = insights[key];
    if (text && text.trim().length > 0) {
      const config = configs.find(c => c.id === key);
      const header = config?.promptContext?.header || `${key.toUpperCase()} NOTES`;
      sections.push(`=== ${header} ===\n${text.trim()}`);
    }
  }

  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
}

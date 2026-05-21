import { env } from 'process';

export type Engine = 'google' | 'yandex' | 'baidu' | 'bing' | 'duckduckgo' | 'ecosia';

export interface OpenSerpCommonParams {
  /** Search query */
  text: string;
  /** Language code, e.g., 'EN', 'DE', 'RU', 'ES' */
  lang?: string;
  /** Date range, e.g., '20250101..20251231' */
  date?: string;
  /** File extension, e.g., 'pdf', 'doc', 'xls' */
  file?: string;
  /** Site-specific search, e.g., 'github.com' */
  site?: string;
  /** Number of organic results, max 100. Ads may be returned in addition. */
  limit?: number;
  /** Pagination offset */
  start?: number;
  /** Output format */
  format?: 'json' | 'markdown' | 'text' | 'ndjson';
}

export interface OpenSerpEngineParams extends OpenSerpCommonParams {
  /** Google only: Duplicate filter. `true` hides similar results, `false` includes them. */
  filter?: boolean;
  /** Google only: Include Google answer boxes in output. */
  answers?: boolean;
}

export interface OpenSerpMegaParams extends OpenSerpCommonParams {
  /** Comma separated engines, e.g., 'google,bing' */
  engines?: string;
  /**
   * Mega mode:
   * - 'fast': only one fastest engine is queried
   * - 'any': sequential fallback in provided order
   * - 'balanced' (default): parallel all engines with aggregation controls
   */
  mode?: 'fast' | 'any' | 'balanced';
  /** Deduplicate results by URL */
  dedupe?: boolean;
  /** Merge results into clusters based on URL */
  merge?: boolean;
}

export interface OpenSerpSearchResult {
  id: string;
  rank: number;
  type: string; // e.g., 'organic'
  title: string;
  url: string;
  display_url: string;
  snippet: string;
  domain: string;
  favicon: string;
  position: { absolute: number };
  engine: string;
  domain_info?: { tld: string; sld: string; category: string };
}

export interface OpenSerpMegaCluster {
  id: string;
  canonical_url: string;
  domain: string;
  title: string;
  occurrences: Array<{ engine: string; rank: number; result_id: string }>;
  engines_count: number;
  best_rank: number;
  score: number;
}

export interface OpenSerpResponse {
  query: {
    text: string;
    engines_requested: string[];
    [key: string]: any;
  };
  meta: {
    request_id: string;
    requested_at: string;
    took_ms: number;
    engines_failed: string[];
    version: string;
    [key: string]: any;
  };
  results?: OpenSerpSearchResult[];
  clusters?: OpenSerpMegaCluster[];
  pagination?: {
    page: number;
    has_more: boolean;
    next_start: number;
  };
}

export interface OpenSerpImageResult {
  id: string;
  rank: number;
  type: 'image';
  title: string;
  image: {
    url: string;
    thumbnail: string;
    width: number;
    height: number;
  };
  source: {
    page_url: string;
    domain: string;
  };
  engine: string;
}

export interface OpenSerpImageResponse {
  query: {
    text: string;
    engines_requested: string[];
    [key: string]: any;
  };
  meta: {
    request_id: string;
    requested_at: string;
    took_ms: number;
    engines_failed: string[];
    version: string;
    [key: string]: any;
  };
  results?: OpenSerpImageResult[];
  pagination?: {
    page: number;
    has_more: boolean;
    next_start: number;
  };
}

export class OpenSerp {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.OPENSERP_BASE_URL || 'http://127.0.0.1:7000';
  }

  private buildQueryString(params: Record<string, any>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    }
    return searchParams.toString();
  }

  private async fetch<T>(path: string, params: Record<string, any>, fallback: T): Promise<T> {
    const qs = this.buildQueryString(params);
    const url = `${this.baseUrl}${path}?${qs}`;
    
    try {
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'No response body');
        console.error(`OpenSerp API error: ${response.status} ${response.statusText} for ${url} - ${errorText}`);
        return fallback;
      }

      return (await response.json()) as T;
    } catch (error) {
      console.error(`OpenSerp microservice unreachable or failed: ${error} - URL: ${url}`);
      return fallback;
    }
  }

  private getFallbackResponse(text: string): OpenSerpResponse {
    return {
      query: { text, engines_requested: [] },
      meta: {
        request_id: '',
        requested_at: new Date().toISOString(),
        took_ms: 0,
        engines_failed: ['all'],
        version: 'fallback'
      },
      results: [],
      clusters: [],
      pagination: { page: 1, has_more: false, next_start: 0 }
    };
  }

  private getFallbackImageResponse(text: string): OpenSerpImageResponse {
    return {
      query: { text, engines_requested: [] },
      meta: {
        request_id: '',
        requested_at: new Date().toISOString(),
        took_ms: 0,
        engines_failed: ['all'],
        version: 'fallback'
      },
      results: [],
      pagination: { page: 1, has_more: false, next_start: 0 }
    };
  }

  /**
   * Search a specific engine (e.g., google, bing, yandex).
   * 
   * @param engine The search engine to use
   * @param params Query parameters including `text`, `limit`, `lang`, etc.
   * @returns A promise resolving to the search results. If the OpenSerp microservice is down, returns an empty fallback response.
   */
  async search(engine: Engine, params: OpenSerpEngineParams): Promise<OpenSerpResponse> {
    const fallback = this.getFallbackResponse(params.text);
    return this.fetch<OpenSerpResponse>(`/${engine}/search`, params, fallback);
  }

  /**
   * Search for images using a specific engine (e.g., bing).
   * 
   * @param engine The search engine to use
   * @param params Query parameters including `text`, `limit`, etc.
   * @returns A promise resolving to the image search results. If the OpenSerp microservice is down, returns an empty fallback response.
   */
  async searchImage(engine: Engine, params: OpenSerpCommonParams): Promise<OpenSerpImageResponse> {
    const fallback = this.getFallbackImageResponse(params.text);
    return this.fetch<OpenSerpImageResponse>(`/${engine}/image`, params, fallback);
  }

  /**
   * Megasearch across multiple engines at once.
   * 
   * You can configure the `mode` parameter:
   * - 'balanced' (default): parallel all engines with aggregation controls
   * - 'fast': only one fastest engine is queried
   * - 'any': sequential fallback in provided order
   * 
   * @param params Query parameters including `text`, `engines`, `limit`, `mode`, etc.
   * @returns A promise resolving to the aggregated search results. If the OpenSerp microservice is down, returns an empty fallback response.
   */
  async megaSearch(params: OpenSerpMegaParams): Promise<OpenSerpResponse> {
    const fallback = this.getFallbackResponse(params.text);
    return this.fetch<OpenSerpResponse>('/mega/search', params, fallback);
  }

  /**
   * Image Megasearch across multiple engines.
   * 
   * @param params Query parameters including `text`, `engines`, `limit`, etc.
   * @returns A promise resolving to the aggregated image search results. If the OpenSerp microservice is down, returns an empty fallback response.
   */
  async megaSearchImage(params: OpenSerpMegaParams): Promise<OpenSerpImageResponse> {
    const fallback = this.getFallbackImageResponse(params.text);
    return this.fetch<OpenSerpImageResponse>('/mega/image', params, fallback);
  }

  /**
   * List available engines in Megasearch.
   * 
   * @returns A promise resolving to an array of engine names. If the OpenSerp microservice is down, returns an empty array.
   */
  async listEngines(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/mega/engines`);
      if (!response.ok) {
        console.error(`Failed to fetch engines: ${response.status} ${response.statusText}`);
        return [];
      }
      return await response.json();
    } catch (error) {
      console.error(`OpenSerp microservice unreachable or failed when listing engines: ${error}`);
      return [];
    }
  }
}

export const openserp = new OpenSerp();

import FirecrawlApp from '@mendable/firecrawl-js';

class FirecrawlService {
  private keys: string[];
  private currentKeyIndex: number = 0;
  private app: FirecrawlApp;

  constructor() {
    // Parse FIRECRAWL_API_KEYS (comma separated) or fallback to singular FIRECRAWL_API_KEY
    const keysEnv = process.env.FIRECRAWL_API_KEYS || process.env.FIRECRAWL_API_KEY || '';
    this.keys = keysEnv
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (this.keys.length === 0) {
      console.warn('[FirecrawlService] No Firecrawl API keys provided in environment.');
    } else {
      console.log(`[FirecrawlService] Initialized with ${this.keys.length} keys.`);
    }

    this.app = this.createAppInstance();
  }

  private createAppInstance(): FirecrawlApp {
    const apiKey = this.keys[this.currentKeyIndex] || '';
    return new FirecrawlApp({ apiKey });
  }

  private rotateKey(): boolean {
    if (this.currentKeyIndex < this.keys.length - 1) {
      this.currentKeyIndex++;
      console.log(`[FirecrawlService] Rotating to API key index ${this.currentKeyIndex}`);
      this.app = this.createAppInstance();
      return true;
    }
    return false;
  }

  private isCreditOrQuotaError(error: any): boolean {
    // Firecrawl uses axios under the hood. Check for standard HTTP status codes.
    const status = error?.response?.status || error?.statusCode || error?.status;
    
    // 402: Payment Required (Out of credits)
    // 429: Too Many Requests (Rate limited)
    // 401/403: Unauthorized/Forbidden (Key revoked or invalid)
    return status === 402 || status === 429 || status === 401 || status === 403;
  }

  /**
   * Wrapper for FirecrawlApp.search with automatic key rotation
   */
  public async search(query: string, params?: any): Promise<any> {
    try {
      return await this.app.search(query, params);
    } catch (error: any) {
      if (this.isCreditOrQuotaError(error)) {
        const status = error?.response?.status || error?.statusCode || error?.status;
        console.warn(`[FirecrawlService] Search failed with status ${status}. Key index: ${this.currentKeyIndex}`);
        
        if (this.rotateKey()) {
          console.log(`[FirecrawlService] Retrying search with new key...`);
          return this.search(query, params); // Recursively retry with the next key
        } else {
          console.error('[FirecrawlService] All Firecrawl API keys exhausted.');
          throw new Error('All Firecrawl API keys exhausted or rate-limited.');
        }
      }
      throw error;
    }
  }

  /**
   * Wrapper for FirecrawlApp.scrape with automatic key rotation
   */
  public async scrape(url: string, params?: any): Promise<any> {
    try {
      return await this.app.scrape(url, params);
    } catch (error: any) {
      if (this.isCreditOrQuotaError(error)) {
        const status = error?.response?.status || error?.statusCode || error?.status;
        console.warn(`[FirecrawlService] Scrape failed with status ${status}. Key index: ${this.currentKeyIndex}`);
        
        if (this.rotateKey()) {
          console.log(`[FirecrawlService] Retrying scrape with new key...`);
          return this.scrape(url, params); // Recursively retry with the next key
        } else {
          console.error('[FirecrawlService] All Firecrawl API keys exhausted.');
          throw new Error('All Firecrawl API keys exhausted or rate-limited.');
        }
      }
      throw error;
    }
  }
}

// Export a singleton instance
export const firecrawlService = new FirecrawlService();

import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import axios from 'axios';

@Injectable()
export class ProxyProvider {
  private readonly logger = new Logger(ProxyProvider.name);
  private proxies: string[] = [];
  private idx = 0;

  constructor() {
    // initialize from config
    this.proxies = Array.from(config.proxyList || []);
  }

  /**
   * Get next proxy (rotating). If no proxies configured, returns null.
   */
  getNext(): string | null {
    if (!this.proxies || this.proxies.length === 0) return null;
    if (!config.proxyRotation) {
      return this.proxies[0];
    }
    const p = this.proxies[this.idx % this.proxies.length];
    this.idx = (this.idx + 1) % this.proxies.length;
    return p;
  }

  /**
   * Optionally allow refreshing proxy list from a provider (not used by default).
   * This method is safe to call; if PROXY_PROVIDER_API_URL is not set it does nothing.
   */
  async refreshFromProvider(providerUrl?: string) {
    const url = providerUrl || process.env.PROXY_PROVIDER_API_URL;
    if (!url) return;
    try {
      const resp = await axios.get(url, {
        headers: {
          Authorization: process.env.PROXY_PROVIDER_API_KEY
            ? `Bearer ${process.env.PROXY_PROVIDER_API_KEY}`
            : undefined,
        },
        timeout: 5000,
      });
      const list = Array.isArray(resp.data) ? resp.data : resp.data?.proxies;
      if (Array.isArray(list)) {
        this.proxies = list.map((p: any) => String(p).trim()).filter(Boolean);
        this.idx = 0;
      }
    } catch (err) {
      this.logger.warn('Failed to refresh proxy list', err);
    }
  }
}

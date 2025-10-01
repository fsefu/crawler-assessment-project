import { Injectable } from '@nestjs/common';
import { config } from '../config';

@Injectable()
export class UserAgentProvider {
  private uas: string[] = [];
  private idx = 0;

  constructor() {
    // build list: environment userAgents, fallback to single UA
    this.uas = Array.from(config.userAgents || []);
    if (this.uas.length === 0 && config.userAgent) {
      this.uas = [config.userAgent];
    }
  }

  next(): string {
    if (!this.uas || this.uas.length === 0) return config.userAgent;
    // rotate round-robin
    const ua = this.uas[this.idx % this.uas.length];
    this.idx = (this.idx + 1) % this.uas.length;
    return ua;
  }
}

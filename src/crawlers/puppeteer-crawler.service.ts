
import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { config } from '../config';
import { ProxyProvider } from './proxy.provider';
import { UserAgentProvider } from './user-agent.provider';

@Injectable()
export class PuppeteerCrawlerService {
  private readonly logger = new Logger(PuppeteerCrawlerService.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly proxyProvider: ProxyProvider,
    private readonly uaProvider: UserAgentProvider,
  ) {}

  async crawl(jobId: string, url: string) {
    // lazy require
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteerExtra = require('puppeteer-extra');

    let StealthPlugin: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      StealthPlugin = require('puppeteer-extra-plugin-stealth');
    } catch (e) {
      this.logger.warn(
        'puppeteer-extra-plugin-stealth not installed — continuing without stealth plugin.',
      );
    }
    if (StealthPlugin) {
      try {
        puppeteerExtra.use(StealthPlugin());
      } catch (err) {
        this.logger.warn(
          'Failed to apply stealth plugin, continuing without it.',
          err,
        );
      }
    }

    let ProxyChain: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ProxyChain = require('proxy-chain');
    } catch (e) {
      this.logger.warn(
        'proxy-chain not installed — proxy auth/anonymize may not be available.',
      );
    }

    let Bottleneck: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Bottleneck = require('bottleneck');
    } catch (e) {
      this.logger.warn('bottleneck not installed — rate limiting disabled.');
    }

    // limiter
    let run: (fn: () => Promise<any>) => Promise<any>;
    if (Bottleneck) {
      const limiter = new Bottleneck({
        maxConcurrent: config.maxConcurrency,
        minTime: Math.ceil(
          config.rateLimitIntervalMs / Math.max(1, config.rateLimitRequests),
        ),
      });
      run = (fn: () => Promise<any>) => limiter.schedule(fn);
    } else {
      run = (fn: () => Promise<any>) => fn();
    }

    const originalProxy = this.proxyProvider.getNext();
    let proxiedUrl: string | null = null;
    if (originalProxy && ProxyChain) {
      try {
        proxiedUrl = await ProxyChain.anonymizeProxy(originalProxy);
        this.logger.debug(`Using anonymized proxy URL: ${proxiedUrl}`); // <--- ADD THIS LINE
      } catch (err) {
        this.logger.warn(
          'Proxy anonymize failed, continuing without proxied url',
          err,
        );
        proxiedUrl = null;
      }
    } else if (originalProxy) {
      // ProxyChain not present — try using raw proxy string (may not work with auth)
      proxiedUrl = originalProxy;
      this.logger.warn(
        'proxy-chain not present; using raw proxy string — auth may fail for proxy servers requiring auth.',
      );
    }

    return run(async () => {
      // Build launch options, allow overriding executable path with env var
      const launchOptions: any = {
        headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : true,
        ignoreHTTPSErrors: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
        ],
      };

      if (process.env.CHROME_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.CHROME_EXECUTABLE_PATH;
      }

      if (proxiedUrl) launchOptions.args.push(`--proxy-server=${proxiedUrl}`);

      const browser = await puppeteerExtra.launch(launchOptions);
      let page: any = null;
      try {
        page = await browser.newPage();

        const ua =
          (this.uaProvider && this.uaProvider.next && this.uaProvider.next()) ||
          config.userAgent;
        await page.setUserAgent(ua);
        await page.setViewport({ width: 1366, height: 768 });
        await page.setDefaultNavigationTimeout(config.jobTimeoutMs);

        // try networkidle2 first; if it times out we fallback to domcontentloaded
        try {
          await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: config.jobTimeoutMs,
          });
        } catch (err) {
          this.logger.warn(
            'page.goto(networkidle2) timed out or failed; retrying with domcontentloaded',
            err,
          );
          try {
            await page.goto(url, {
              waitUntil: 'domcontentloaded',
              timeout: config.jobTimeoutMs,
            });
          } catch (err2) {
            this.logger.warn(
              'page.goto(domcontentloaded) also failed — rethrowing',
              err2,
            );
            throw err2;
          }
        }

        // check cancel flag
        if (jobId && (await this.queueService.isCancelled(jobId))) {
          throw new Error('Job cancelled');
        }

        // extract DOM
        const result = await page.evaluate(() => {
          const title = (
            document.querySelector('title')?.innerText || ''
          ).trim();
          const metaDescription = (
            document
              .querySelector('meta[name="description"]')
              ?.getAttribute('content') ||
            (
              document.querySelector('meta[property="og:description"]') as any
            )?.getAttribute('content') ||
            ''
          ).trim();

          const getFavicon = () => {
            const selectors = [
              'link[rel~="icon"]',
              'link[rel="shortcut icon"]',
              'link[rel="apple-touch-icon"]',
              'link[rel="mask-icon"]',
              'link[rel="manifest"]',
            ];
            for (const s of selectors) {
              const el = document.querySelector(s) as HTMLLinkElement;
              if (el && (el as any).href) return (el as any).href;
            }
            try {
              return new URL('/favicon.ico', location.href).toString();
            } catch {
              return '/favicon.ico';
            }
          };

          const favicon = getFavicon();
          const scripts = Array.from(document.querySelectorAll('script[src]'))
            .map((s) => (s as HTMLScriptElement).src)
            .filter(Boolean);
          const styles = Array.from(
            document.querySelectorAll('link[rel="stylesheet"]'),
          )
            .map((l) => (l as HTMLLinkElement).href)
            .filter(Boolean);
          const images = Array.from(document.images)
            .map(
              (img) =>
                (img as HTMLImageElement).src || (img as any).dataset?.src,
            )
            .filter(Boolean);

          return { title, metaDescription, favicon, scripts, styles, images };
        });

        const resolved = this._makeAbsoluteForResult(url, result);

        // optional: probe external IP (non-fatal)
        let externalIp: string | null = null;
        try {
          const ipText = await page.evaluate(async () => {
            try {
              const r = await fetch('https://api.ipify.org?format=json', {
                cache: 'no-store',
              });
              if (!r.ok) return null;
              return await r.text();
            } catch {
              return null;
            }
          });
          if (ipText) {
            try {
              const p = JSON.parse(ipText);
              externalIp = p?.ip || null;
            } catch {
              externalIp = ipText;
            }
          }
        } catch (err) {
          this.logger.debug('external IP probe failed (non-fatal)', err);
        }

        return { ...resolved, url, externalIp };
      } finally {
        try {
          if (page) await page.close();
        } catch {}
        try {
          await browser.close();
        } catch (err) {
          this.logger.warn('Failed to close browser', err);
        }
        if (proxiedUrl && ProxyChain && ProxyChain.closeAnonymizedProxy) {
          try {
            await ProxyChain.closeAnonymizedProxy(proxiedUrl);
          } catch {}
        }
      }
    });
  }

  private _makeAbsoluteForResult(base: string, result: any) {
    const makeAbsolute = (link?: string | null) => {
      if (!link) return null;
      try {
        return new URL(link, base).toString();
      } catch {
        return link;
      }
    };

    return {
      title: result.title,
      metaDescription: result.metaDescription,
      favicon: makeAbsolute(result.favicon),
      scripts: Array.from(
        new Set(
          (result.scripts || [])
            .map((s: string) => makeAbsolute(s))
            .filter(Boolean),
        ),
      ).slice(0, 500),
      styles: Array.from(
        new Set(
          (result.styles || [])
            .map((s: string) => makeAbsolute(s))
            .filter(Boolean),
        ),
      ).slice(0, 500),
      images: Array.from(
        new Set(
          (result.images || [])
            .map((s: string) => makeAbsolute(s))
            .filter(Boolean),
        ),
      ).slice(0, 2000),
    };
  }
}

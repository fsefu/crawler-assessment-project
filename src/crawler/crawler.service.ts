import { Injectable, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { QueueService } from '../queue/queue.service';
import { Job } from 'bullmq';
import config from '../config';
import { PuppeteerCrawlerService } from '../crawlers/puppeteer-crawler.service';
import { UserAgentProvider } from '../crawlers/user-agent.provider';

function makeAbsolute(base: string, link?: string | null) {
  if (!link) return null;
  try {
    return new URL(link, base).toString();
  } catch {
    return link; // if malformed, return original
  }
}

function uniqAndLimit(arr: string[], max = 200) {
  const out = Array.from(new Set(arr.filter(Boolean)));
  return out.slice(0, max);
}

@Injectable()
export class CrawlerService implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    // optional - so tests can instantiate CrawlerService with only queueService
    private readonly puppeteerCrawler?: PuppeteerCrawlerService,
    private readonly uaProvider?: UserAgentProvider,
  ) {}

  onModuleInit() {
    // create the worker - QueueService will read concurrency from config
    this.queueService.createWorker(async (job: Job) => {
      return this.processJob(job);
    });
  }

  async enqueueCrawl(url: string) {
    const job = await this.queueService.addJob('crawl', { url });
    return job;
  }
  async getStatus(id: string) {
    const job = await this.queueService.getJob(id);
    if (!job) {
      // job record might have been removed (removeOnComplete = true)
      // try to read stored result
      const stored = await this.queueService.getStoredResult(id);
      if (!stored) return null;
      // craft a synthetic finished job response
      return {
        id,
        name: 'crawl',
        data: { url: stored?.url || null },
        state: 'completed',
        attemptsMade: 0,
        finishedOn: Date.now(),
        processedOn: Date.now(),
        result: stored,
      };
    }
    const state = await job.getState();
    const result = {
      id: job.id,
      name: job.name,
      data: job.data,
      state,
      attemptsMade: job.attemptsMade,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    };
    if (state === 'completed') result['result'] = job.returnvalue;
    return result;
  }

  async cancel(id: string) {
    // flag cancellation (so running job can pick it up), then try to remove job
    await this.queueService.setCancelFlag(id);
    const removed = await this.queueService.removeJob(id);
    // we return true if either we set flag or removed job
    return removed || true;
  }

  // main crawler logic using axios + cheerio OR puppeteer if enabled
  async processJob(job: Job) {
    const { url } = job.data;
    if (!url) throw new Error('Missing URL');

    // Normalize job id to string if present (tests may call processJob without id)
    const jobId: string | undefined =
      job && typeof job.id !== 'undefined' && job.id !== null
        ? String(job.id)
        : undefined;

    // check cancel flag before starting heavy work (only if we have an id)
    if (jobId && (await this.queueService.isCancelled(jobId))) {
      throw new Error('Job cancelled');
    }

    // if Puppeteer is enabled and service available -> use it
    if (config.usePuppeteer && this.puppeteerCrawler) {
      // pass jobId (string) - if it's undefined, pass an empty string
      return this.puppeteerCrawler.crawl(jobId ?? '', url);
    }

    // fallback to axios + cheerio (existing behavior)
    const resp = await axios.get(url, {
      timeout: config.axiosTimeout,
      headers: { 'User-Agent': config.userAgent },
    });

    const contentType = resp.headers?.['content-type'] || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }

    const html = resp.data;
    const $ = cheerio.load(html);

    const title = ($('title').first().text() || '').trim();
    const metaDescription = (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''
    ).trim();

    const favicon =
      makeAbsolute(
        url,
        $('link[rel~="icon"]').attr('href') ||
          $('link[rel="shortcut icon"]').attr('href') ||
          $('link[rel="apple-touch-icon"]').attr('href') ||
          $('link[rel="mask-icon"]').attr('href') ||
          $('link[rel="icon shortcut"]').attr('href') ||
          $('link[rel="manifest"]').attr('href') ||
          $('meta[name="msapplication-TileImage"]').attr('content') ||
          null,
      ) || null;

    const scripts: string[] = [];
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      const abs = makeAbsolute(url, src);
      if (abs) scripts.push(abs);
    });

    const styles: string[] = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = makeAbsolute(url, href);
      if (abs) styles.push(abs);
    });

    const images: string[] = [];
    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      const abs = makeAbsolute(url, src);
      if (abs) images.push(abs);
    });

    const result = {
      title,
      metaDescription,
      favicon,
      scripts: uniqAndLimit(scripts, 500),
      styles: uniqAndLimit(styles, 500),
      images: uniqAndLimit(images, 2000),
      url,
    };

    return result;
  }
}

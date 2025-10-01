import { Injectable, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { QueueService } from '../queue/queue.service';
import { Job } from 'bullmq';
import config from '../config';

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
  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
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
    if (!job) return null;
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
    return this.queueService.removeJob(id);
  }

  // main crawler logic using axios + cheerio
  async processJob(job: Job) {
    const { url } = job.data;
    if (!url) throw new Error('Missing URL');

    // use config values
    const resp = await axios.get(url, {
      timeout: config.axiosTimeout,
      headers: { 'User-Agent': config.userAgent },
      // optionally: maxRedirects: 5
    });

    const contentType = resp.headers?.['content-type'] || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }

    const html = resp.data;
    const $ = cheerio.load(html);

    const title = ($('title').first().text() || '').trim();
    const metaDescription =
      ($('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        ''
      ).trim();

    // improved favicon detection
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
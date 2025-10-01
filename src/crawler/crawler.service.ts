import { Injectable, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { QueueService } from '../queue/queue.service';
import { Job } from 'bullmq';

@Injectable()
export class CrawlerService implements OnModuleInit {
  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    // register worker processor
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

    const resp = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NestCrawler/1.0)' },
    });
    const html = resp.data;
    const $ = cheerio.load(html);

    const title = ($('title').first().text() || '').trim();
    const metaDescription = (
      $('meta[name="description"]').attr('content') || ''
    ).trim();
    const favicon =
      $('link[rel~="icon"]').attr('href') ||
      $('link[rel="shortcut icon"]').attr('href') ||
      null;

    const scripts: string[] = [];
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) scripts.push(src);
    });

    const styles: string[] = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) styles.push(href);
    });

    const images: string[] = [];
    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) images.push(src);
    });

    const result = {
      title,
      metaDescription,
      favicon,
      scripts,
      styles,
      images,
      url,
    };

    // Return value stored as job result
    return result;
  }
}

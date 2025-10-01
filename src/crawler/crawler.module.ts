import { Module } from '@nestjs/common';
import { CrawlerController } from './crawler.controller';
import { CrawlerService } from './crawler.service';
import { QueueService } from '../queue/queue.service';
import { PuppeteerCrawlerService } from '../crawlers/puppeteer-crawler.service';
import { ProxyProvider } from '../crawlers/proxy.provider';
import { UserAgentProvider } from '../crawlers/user-agent.provider';

@Module({
  controllers: [CrawlerController],
  providers: [
    CrawlerService,
    QueueService,
    PuppeteerCrawlerService,
    ProxyProvider,
    UserAgentProvider,
  ],
})
export class CrawlerModule {}

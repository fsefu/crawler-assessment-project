import { Module } from '@nestjs/common';
import { CrawlerController } from './crawler.controller';
import { CrawlerService } from './crawler.service';
import { QueueService } from '../queue/queue.service';

@Module({
  controllers: [CrawlerController],
  providers: [CrawlerService, QueueService],
})
export class CrawlerModule {}

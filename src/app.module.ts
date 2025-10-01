import { Module } from '@nestjs/common';
import { CrawlerModule } from './crawler/crawler.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [QueueModule, CrawlerModule],
})
export class AppModule {}

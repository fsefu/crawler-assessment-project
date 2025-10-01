import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CrawlerModule } from './crawler/crawler.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [QueueModule, CrawlerModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

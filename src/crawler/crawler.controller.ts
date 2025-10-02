import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { CrawlDto } from '../common/dto/crawl.dto';
import { CrawlerService } from './crawler.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('crawler')
@Controller()
export class CrawlerController {
  constructor(private readonly crawlerService: CrawlerService) {}

  @Post('crawl')
  @ApiOperation({ summary: 'Enqueue crawl job' })
  async enqueue(@Body() dto: CrawlDto) {
    const job = await this.crawlerService.enqueueCrawl(dto.url);
    return {
      id: job.id,
      status: job.getState ? await job.getState() : 'queued',
    };
  }

  @Get('status/:id')
  @ApiOperation({ summary: 'Get job status' })
  async status(@Param('id') id: string) {
    const status = await this.crawlerService.getStatus(id);
    if (!status) throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    return status;
  }
  

  @Delete('cancel/:id')
  @ApiOperation({ summary: 'Cancel job' })
  async cancel(@Param('id') id: string) {
    const ok = await this.crawlerService.cancel(id);
    if (!ok)
      throw new HttpException('Unable to cancel job', HttpStatus.BAD_REQUEST);
    return { id, cancelled: true };
  }
}

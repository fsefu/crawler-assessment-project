import { IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CrawlDto {
  @ApiProperty({ example: 'https://example.com' })
  @IsUrl()
  url: string;
}

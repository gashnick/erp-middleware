import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export class ChatQueryDto {
  @IsString()
  @IsNotEmpty()
  query: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsEnum(['text', 'chart', 'table', 'csv'])
  preferredFormat?: 'text' | 'chart' | 'table' | 'csv';
}

export class ChatResponseDto {
  sessionId: string;
  response: string;
  format: 'text' | 'chart' | 'table' | 'csv';
  data?: any;
  charts?: ChartData[];
  tables?: TableData[];
  links?: LinkData[];
  confidence: number;
  timestamp: Date;
}

export class ChartData {
  type: 'line' | 'bar' | 'pie' | 'area';
  title: string;
  data: any[];
  xAxis?: string;
  yAxis?: string;
}

export class TableData {
  headers: string[];
  rows: any[][];
  title?: string;
}

export class LinkData {
  text: string;
  url: string;
  type: 'dashboard' | 'report' | 'entity';
}

export class FeedbackDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  messageId: string;

  @IsEnum(['helpful', 'not_helpful'])
  rating: 'helpful' | 'not_helpful';

  @IsOptional()
  @IsString()
  comment?: string;
}

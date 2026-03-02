import { Injectable } from '@nestjs/common';
import { MessageContent } from './chat.types';

const CHART_KW = ['chart', 'graph', 'trend', 'plot', 'visualise', 'visualize'];
const TABLE_KW = ['table', 'list', 'breakdown', 'compare', 'show me'];
const EXPORT_KW = ['export', 'csv', 'download', 'spreadsheet'];

@Injectable()
export class ResponseFormatterService {
  format(
    llmText: string,
    userQuestion: string,
    rawData?: unknown[][],
    columns?: string[],
  ): MessageContent {
    const lower = userQuestion.toLowerCase();
    if (EXPORT_KW.some((kw) => lower.includes(kw)) && rawData)
      return { type: 'csv', url: '', filename: 'export.csv' };
    if (TABLE_KW.some((kw) => lower.includes(kw)) && rawData && columns)
      return { type: 'table', columns, rows: rawData };
    if (CHART_KW.some((kw) => lower.includes(kw)) && rawData)
      return {
        type: 'chart',
        spec: {
          $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
          mark: 'bar',
          data: { values: rawData },
          encoding: { x: { field: 'x', type: 'ordinal' }, y: { field: 'y', type: 'quantitative' } },
        },
      };
    return { type: 'text', text: llmText };
  }
}

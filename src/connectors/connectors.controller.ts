import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { EtlService } from '../etl/etl.service';

@Controller('connectors')
@UseGuards(JwtAuthGuard)
export class ConnectorsController {
  constructor(private readonly etlService: EtlService) {}

  @Post('csv-upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadCsv(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('No file provided');

    try {
      const csvString = file.buffer.toString('utf-8');
      const rows = this.parseCsv(csvString);

      if (rows.length === 0) {
        throw new BadRequestException('CSV file is empty or invalid');
      }

      return await this.etlService.runInvoiceEtl(req.user.tenantId, rows);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(`ETL Processing Failed: ${error.message}`);
    }
  }

  /**
   * Robust CSV Parser following "Code Complete" principles:
   * 1. Handles different line endings (\n vs \r\n)
   * 2. Filters out empty rows to prevent database null-constraint errors
   * 3. Trims whitespace from keys and values
   */
  private parseCsv(csv: string): Record<string, string>[] {
    const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');

    if (lines.length < 2) return [];

    const header = lines[0].split(',');
    const dataLines = lines.slice(1);

    return dataLines.map((line) => {
      const values = line.split(',');
      return header.reduce((obj, key, i) => {
        const cleanKey = key.trim();
        const cleanValue = values[i] ? values[i].trim() : '';
        return { ...obj, [cleanKey]: cleanValue };
      }, {});
    });
  }
}

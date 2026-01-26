import { Controller, Post, UploadedFile, UseInterceptors, UseGuards, Req } from '@nestjs/common';
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
    // For the test, we parse the buffer.
    // In production, we'd use the CsvConnector class we designed in Step 2.
    const csvString = file.buffer.toString();
    const rows = this.parseCsv(csvString);

    return this.etlService.runInvoiceEtl(req.user.tenantId, rows);
  }

  private parseCsv(csv: string) {
    const [header, ...lines] = csv.split('\n');
    const keys = header.split(',');
    return lines.map((line) => {
      const values = line.split(',');
      return keys.reduce((obj, key, i) => ({ ...obj, [key.trim()]: values[i]?.trim() }), {});
    });
  }
}

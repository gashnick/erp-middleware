import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigService } from './config/config.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
  @Get('config-test')
  testConfig() {
    return {
      nodeEnv: this.config.nodeEnv,
      port: this.config.port,
      dbhost: this.config.databaseHost,
      dbname: this.config.databaseName,
      jwtConfigured: this.config.jwtSecret !== 'change-me-in-production',
    };
  }
}

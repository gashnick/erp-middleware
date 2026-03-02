import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProfanityFilterService {
  private readonly patterns: RegExp[];

  constructor(config: ConfigService) {
    this.patterns = (config.get<string>('PROFANITY_LIST') ?? '')
      .split(',')
      .filter(Boolean)
      .map((t) => new RegExp(`\\b${t.trim()}\\b`, 'gi'));
  }

  contains(text: string): boolean {
    return this.patterns.some((re) => re.test(text));
  }
}

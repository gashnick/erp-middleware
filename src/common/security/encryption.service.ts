// src/common/security/encryption.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly masterKey: string;

  constructor(private configService: ConfigService) {
    const key = this.configService.get<string>('GLOBAL_MASTER_KEY');

    if (!key || key.length < 32) {
      throw new Error('GLOBAL_MASTER_KEY must be at least 32 characters');
    }
    this.masterKey = key;
  }

  generateTenantSecret(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Encrypts data using the internal Master Key.
   * Removed 'tenantSecret' parameter to prevent 'undefined' injection.
   */
  encrypt(text: string): string {
    if (!text) return text;

    const iv = randomBytes(12);
    // Fixed: Always uses validated internal masterKey
    const key = scryptSync(this.masterKey, 'salt-is-internal', 32);
    const cipher = createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(hash: string): string {
    if (!hash || !hash.includes(':')) return hash;

    try {
      const [ivHex, tagHex, contentHex] = hash.split(':');
      const key = scryptSync(this.masterKey, 'salt-is-internal', 32);
      const decipher = createDecipheriv(this.algorithm, key, Buffer.from(ivHex, 'hex'));

      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(contentHex, 'hex')),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (err) {
      throw new InternalServerErrorException('Decryption failed: Integrity check failed');
    }
  }
}

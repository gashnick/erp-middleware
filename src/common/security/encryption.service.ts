// src/common/security/encryption.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly masterKey: string;

  constructor(private configService: ConfigService) {
    // Adding '!' tells TS "I promise this won't be undefined by the time I use it"
    this.masterKey = this.configService.get<string>('GLOBAL_MASTER_KEY')!;

    // Your validation remains crucial for runtime safety
    if (!this.masterKey || this.masterKey.length < 32) {
      throw new Error('GLOBAL_MASTER_KEY must be at least 32 characters');
    }
  }

  generateTenantSecret(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Encrypts a string using a provided secret (like a tenant_secret)
   * grounded by the GLOBAL_MASTER_KEY
   */
  encrypt(text: string, tenantSecret: string): string {
    const iv = randomBytes(12);
    // Combine Master Key + Tenant Secret for maximum security
    const key = scryptSync(tenantSecret, this.masterKey, 32);
    const cipher = createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(hash: string, tenantSecret: string): string {
    const [ivHex, tagHex, contentHex] = hash.split(':');
    const key = scryptSync(tenantSecret, this.masterKey, 32);
    const decipher = createDecipheriv(this.algorithm, key, Buffer.from(ivHex, 'hex'));

    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(contentHex, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}

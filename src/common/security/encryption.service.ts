// src/common/security/encryption.service.ts

import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-ctr';

  // This would come from your .env file
  private readonly globalMasterKey = process.env.GLOBAL_MASTER_KEY;

  encrypt(text: string, tenantSecret: string): string {
    const iv = randomBytes(16);
    const key = scryptSync(tenantSecret, 'salt', 32); // Derive key from tenant secret
    const cipher = createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(hash: string, tenantSecret: string): string {
    const [ivHex, contentHex] = hash.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = scryptSync(tenantSecret, 'salt', 32);
    const decipher = createDecipheriv(this.algorithm, key, iv);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(contentHex, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString();
  }

  generateTenantSecret(): string {
    return randomBytes(32).toString('hex');
  }
}

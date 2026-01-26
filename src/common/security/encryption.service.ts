// src/common/security/encryption.service.ts
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';

  // This is the missing method!
  generateTenantSecret(): string {
    // 32 bytes (256 bits) is the standard for AES-256
    return randomBytes(32).toString('hex');
  }

  encrypt(text: string, secret: string): string {
    const iv = randomBytes(12); // GCM standard
    const key = scryptSync(secret, 'static-salt', 32);
    const cipher = createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(hash: string, secret: string): string {
    const [ivHex, tagHex, contentHex] = hash.split(':');
    const key = scryptSync(secret, 'static-salt', 32);
    const decipher = createDecipheriv(this.algorithm, key, Buffer.from(ivHex, 'hex'));

    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(contentHex, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}

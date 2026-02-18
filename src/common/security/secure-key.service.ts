import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

@Injectable()
export class SecureKeyService implements OnModuleInit {
  private readonly logger = new Logger(SecureKeyService.name);
  private readonly algorithm = 'aes-256-gcm';
  private masterKey: Buffer;
  private readonly useKMS: boolean;

  constructor(private configService: ConfigService) {
    this.useKMS = this.configService.get('USE_KMS', 'false') === 'true';
  }

  async onModuleInit() {
    await this.initializeMasterKey();
  }

  private async initializeMasterKey(): Promise<void> {
    if (this.useKMS) {
      // KMS integration (AWS/GCP/Azure)
      this.logger.log('Initializing KMS-backed encryption');
      await this.loadFromKMS();
    } else {
      // Fallback: Environment variable (must be 32 bytes hex)
      const keyHex = this.configService.get<string>('MASTER_ENCRYPTION_KEY');
      
      if (!keyHex || keyHex.length !== 64) {
        throw new Error(
          'MASTER_ENCRYPTION_KEY must be 64 hex characters (32 bytes). ' +
          'Generate with: openssl rand -hex 32'
        );
      }

      this.masterKey = Buffer.from(keyHex, 'hex');
      this.logger.warn('Using environment-based master key. Enable KMS for production.');
    }
  }

  private async loadFromKMS(): Promise<void> {
    // TODO: Implement KMS integration
    // For now, throw to prevent accidental production use
    throw new Error('KMS integration not yet implemented. Set USE_KMS=false');
  }

  /**
   * Generate cryptographically secure tenant-specific encryption key
   */
  generateTenantKey(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Encrypt data using tenant-specific key
   */
  encrypt(plaintext: string, tenantKey: string): string {
    if (!plaintext) return plaintext;

    const iv = randomBytes(12);
    const key = this.deriveTenantKey(tenantKey);
    const cipher = createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    
    const tag = cipher.getAuthTag();

    // Format: iv:tag:ciphertext (all hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypt data using tenant-specific key
   */
  decrypt(ciphertext: string, tenantKey: string): string {
    if (!ciphertext || !ciphertext.includes(':')) return ciphertext;

    try {
      const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
      
      if (!ivHex || !tagHex || !encryptedHex) {
        throw new Error('Invalid ciphertext format');
      }

      const key = this.deriveTenantKey(tenantKey);
      const decipher = createDecipheriv(
        this.algorithm,
        key,
        Buffer.from(ivHex, 'hex')
      );

      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      this.logger.error(`Decryption failed: ${error.message}`);
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
  }

  /**
   * Derive tenant-specific key from tenant key + master key
   * Uses scrypt for key derivation (CPU-hard, memory-hard)
   */
  private deriveTenantKey(tenantKey: string): Buffer {
    if (!tenantKey || tenantKey.length !== 64) {
      throw new Error('Invalid tenant key format');
    }

    // Combine tenant key with master key using scrypt
    return scryptSync(
      Buffer.from(tenantKey, 'hex'),
      this.masterKey,
      32, // 256 bits
      { N: 16384, r: 8, p: 1 } // Standard scrypt parameters
    );
  }

  /**
   * Rotate tenant encryption key (for key rotation policies)
   */
  async rotateTenantKey(
    oldKey: string,
    encryptedData: string[]
  ): Promise<{ newKey: string; reencryptedData: string[] }> {
    const newKey = this.generateTenantKey();
    
    const reencryptedData = encryptedData.map(data => {
      const plaintext = this.decrypt(data, oldKey);
      return this.encrypt(plaintext, newKey);
    });

    this.logger.log('Tenant key rotated successfully');
    
    return { newKey, reencryptedData };
  }
}

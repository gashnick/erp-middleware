import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KMSClient, DecryptCommand, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

interface EncryptedDEK {
  encryptedKey: string; // Base64 encrypted DEK
  plainKey: Buffer; // Plaintext DEK (never persisted)
}

@Injectable()
export class KMSService implements OnModuleInit {
  private readonly logger = new Logger(KMSService.name);
  private kmsClient: KMSClient;
  private readonly cmkId: string;
  private readonly algorithm = 'aes-256-gcm';
  private readonly useKMS: boolean;

  constructor(private configService: ConfigService) {
    this.useKMS = this.configService.get('USE_KMS', 'false') === 'true';
    this.cmkId = this.configService.get('AWS_KMS_KEY_ID', '');
  }

  async onModuleInit() {
    if (this.useKMS) {
      this.kmsClient = new KMSClient({
        region: this.configService.get('AWS_REGION', 'us-east-1'),
      });
      this.logger.log('✅ KMS client initialized');
    } else {
      this.logger.warn('⚠️  KMS disabled - using fallback encryption (NOT FOR PRODUCTION)');
    }
  }

  /**
   * Generate new Data Encryption Key (DEK) for tenant
   * Returns encrypted DEK (store in DB) and plaintext DEK (use immediately, then discard)
   */
  async generateDataKey(): Promise<EncryptedDEK> {
    if (!this.useKMS) {
      // Fallback for development
      const plainKey = randomBytes(32);
      return {
        encryptedKey: plainKey.toString('base64'),
        plainKey,
      };
    }

    try {
      const command = new GenerateDataKeyCommand({
        KeyId: this.cmkId,
        KeySpec: 'AES_256',
      });

      const response = await this.kmsClient.send(command);

      return {
        encryptedKey: Buffer.from(response.CiphertextBlob!).toString('base64'),
        plainKey: Buffer.from(response.Plaintext!),
      };
    } catch (error) {
      this.logger.error(`KMS GenerateDataKey failed: ${error.message}`);
      throw new Error('Failed to generate encryption key');
    }
  }

  /**
   * Decrypt Data Encryption Key (DEK) using KMS
   * Called when tenant data needs to be encrypted/decrypted
   */
  async decryptDataKey(encryptedDEK: string): Promise<Buffer> {
    if (!this.useKMS) {
      // Fallback for development
      return Buffer.from(encryptedDEK, 'base64');
    }

    try {
      const command = new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedDEK, 'base64'),
      });

      const response = await this.kmsClient.send(command);
      return Buffer.from(response.Plaintext!);
    } catch (error) {
      this.logger.error(`KMS Decrypt failed: ${error.message}`);
      throw new Error('Failed to decrypt encryption key');
    }
  }

  /**
   * Encrypt data using DEK (envelope encryption)
   */
  encrypt(plaintext: string, dek: Buffer): string {
    if (!plaintext) return plaintext;

    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, dek, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypt data using DEK (envelope encryption)
   */
  decrypt(ciphertext: string, dek: Buffer): string {
    if (!ciphertext || !ciphertext.includes(':')) return ciphertext;

    try {
      const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');

      const decipher = createDecipheriv(
        this.algorithm,
        dek,
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
      throw new Error('Decryption failed');
    }
  }
}

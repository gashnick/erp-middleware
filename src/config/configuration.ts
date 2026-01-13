/**
 * Configuration Factory
 *
 * Loads and validates environment variables.
 * Returns typed configuration object for the application.
 *
 * Code Complete Principle: Centralize configuration to avoid magic strings
 */

export default () => ({
  // Application
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'erp_middleware',

    // Connection pool settings
    poolSize: parseInt(process.env.DB_POOL_SIZE || '20', 10),
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '5000', 10),

    // Synchronize (NEVER true in production)
    synchronize: process.env.DB_SYNCHRONIZE === 'true' ? true : false,

    // Logging
    logging: process.env.DB_LOGGING === 'true' ? true : false,
  },

  // JWT Authentication
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4',
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '1000', 10),
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
  },

  // Redis Configuration (for caching and queues)
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  // File Upload Configuration
  upload: {
    maxFileSize: parseInt(process.env.UPLOAD_MAX_FILE_SIZE || '10485760', 10), // 10MB default
    allowedMimeTypes: (
      process.env.UPLOAD_ALLOWED_TYPES ||
      'text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ).split(','),
    destination: process.env.UPLOAD_DESTINATION || './uploads',
  },

  // Rate Limiting
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10), // seconds
    limit: parseInt(process.env.RATE_LIMIT_MAX || '100', 10), // requests per TTL
  },

  // CORS Configuration
  cors: {
    enabled: process.env.CORS_ENABLED === 'true' ? true : true, // Default enabled
    origin: process.env.CORS_ORIGIN || '*',
    credentials: process.env.CORS_CREDENTIALS === 'true' ? true : false,
  },

  // Security
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
    sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    prettyPrint: process.env.LOG_PRETTY_PRINT === 'true' ? true : false,
  },

  // Feature Flags (for MVP)
  features: {
    chatEnabled: process.env.FEATURE_CHAT_ENABLED === 'true' ? true : true,
    aiEnabled: process.env.FEATURE_AI_ENABLED === 'true' ? true : true,
    fileUploadEnabled: process.env.FEATURE_FILE_UPLOAD_ENABLED === 'true' ? true : true,
  },
});

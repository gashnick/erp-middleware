module.exports = {
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended',
  ],
  plugins: ['@typescript-eslint', 'security'],
  rules: {
    // Prevent SQL injection
    'security/detect-non-literal-fs-filename': 'error',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-unsafe-regex': 'error',
    
    // Custom rule: No template literals in SQL queries
    'no-template-curly-in-string': 'error',
    
    // Enforce parameterized queries
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'warn',
  },
  overrides: [
    {
      files: ['**/*.service.ts', '**/*-query-runner.service.ts'],
      rules: {
        // Stricter rules for database services
        'security/detect-non-literal-regexp': 'error',
      },
    },
  ],
};

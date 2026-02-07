/**
 * Factory for generating test user data - No Faker dependency
 */
export const userFactory = {
  validRegistration: (overrides = {}) => ({
    // Use UUIDs for test emails to avoid collisions between parallel workers
    email: `test-${crypto.randomUUID()}@test.com`,
    password: 'Password123!',
    fullName: `Test User ${Math.floor(Math.random() * 10000)}`,
    role: 'STAFF', // Add default role
    ...overrides,
  }),

  adminUser: (overrides = {}) => ({
    ...userFactory.validRegistration(),
    role: 'ADMIN',
    ...overrides,
  }),

  staffUser: (overrides = {}) => ({
    ...userFactory.validRegistration(),
    role: 'STAFF',
    ...overrides,
  }),
};

export const organizationFactory = {
  validOrganization: (overrides = {}) => ({
    companyName: `Test Company ${Math.floor(Math.random() * 10000)}`,
    subscriptionPlan: 'enterprise',
    dataSourceType: 'external',
    ...overrides,
  }),
};

export const connectorFactory = {
  quickbooks: (overrides = {}) => ({
    type: 'quickbooks',
    name: 'QuickBooks Production',
    credentials: {
      clientId: crypto.randomUUID(),
      clientSecret:
        Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2),
      realmId: Math.floor(Math.random() * 9000000000 + 1000000000).toString(),
    },
    config: {
      syncFrequency: 'hourly',
      autoRetry: true,
      maxRetries: 5,
    },
    ...overrides,
  }),

  csvUpload: (filename = 'test-data.csv', overrides = {}) => ({
    type: 'csv',
    name: `CSV Upload - ${filename}`,
    mapping: {
      'Invoice Number': 'invoice_id',
      Date: 'invoice_date',
      Amount: 'total_amount',
    },
    ...overrides,
  }),
};

export const financialRecordFactory = {
  invoice: (overrides = {}) => ({
    invoice_id: `INV-${Math.floor(Math.random() * 1000000)}`,
    invoice_date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    customer_name: `Customer ${Math.floor(Math.random() * 1000)}`,
    total_amount: parseFloat((Math.random() * 10000).toFixed(2)),
    status: 'pending',
    due_date: new Date(Date.now() + Math.random() * 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    ...overrides,
  }),

  payment: (overrides = {}) => ({
    payment_id: `PAY-${Math.floor(Math.random() * 1000000)}`,
    payment_date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    amount: parseFloat((Math.random() * 5000).toFixed(2)),
    method: ['credit_card', 'bank_transfer', 'check'][Math.floor(Math.random() * 3)],
    ...overrides,
  }),

  order: (overrides = {}) => ({
    order_id: `ORD-${Math.floor(Math.random() * 1000000)}`,
    order_date: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    customer_name: `Customer ${Math.floor(Math.random() * 1000)}`,
    total_amount: parseFloat((Math.random() * 15000).toFixed(2)),
    status: ['pending', 'confirmed', 'shipped', 'delivered'][Math.floor(Math.random() * 4)],
    items_count: Math.floor(Math.random() * 10) + 1,
    ...overrides,
  }),

  contact: (overrides = {}) => ({
    contact_id: `CNT-${Math.floor(Math.random() * 1000000)}`,
    name: `Contact ${Math.floor(Math.random() * 1000)}`,
    email: `contact${Math.floor(Math.random() * 1000)}@example.com`,
    phone: `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,
    company: `Company ${Math.floor(Math.random() * 500)}`,
    created_date: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0],
    ...overrides,
  }),

  product: (overrides = {}) => ({
    product_id: `PRD-${Math.floor(Math.random() * 1000000)}`,
    name: `Product ${Math.floor(Math.random() * 1000)}`,
    sku: `SKU-${Math.floor(Math.random() * 100000)}`,
    price: parseFloat((Math.random() * 1000).toFixed(2)),
    quantity: Math.floor(Math.random() * 100),
    category: ['Electronics', 'Clothing', 'Food', 'Books'][Math.floor(Math.random() * 4)],
    ...overrides,
  }),
};

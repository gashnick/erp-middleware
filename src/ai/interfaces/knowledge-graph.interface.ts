export interface KnowledgeGraphEntity {
  id: string;
  type: EntityType;
  properties: Record<string, any>;
  relationships: Relationship[];
}

export enum EntityType {
  CUSTOMER = 'customer',
  INVOICE = 'invoice',
  PAYMENT = 'payment',
  ASSET = 'asset',
  VENDOR = 'vendor',
  PRODUCT = 'product',
}

export interface Relationship {
  type: RelationType;
  targetEntityId: string;
  targetEntityType: EntityType;
  properties?: Record<string, any>;
}

export enum RelationType {
  HAS_INVOICE = 'has_invoice',
  MADE_PAYMENT = 'made_payment',
  OWNS_ASSET = 'owns_asset',
  PURCHASED_FROM = 'purchased_from',
  RELATED_TO = 'related_to',
}

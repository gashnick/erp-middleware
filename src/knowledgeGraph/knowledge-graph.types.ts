export type EntityType = 'CUSTOMER' | 'INVOICE' | 'PAYMENT' | 'ASSET' | 'SUPPLIER';

export type RelationshipType =
  | 'ISSUED_TO' // invoice → customer
  | 'PAID_BY' // invoice → payment
  | 'OWNED_BY' // asset   → customer
  | 'SUPPLIED_BY'; // invoice → supplier

export interface KGEntity {
  id: string;
  tenantId: string;
  type: EntityType;
  externalId: string;
  label: string;
  meta: Record<string, unknown>;
}

export interface KGRelationship {
  id: string;
  tenantId: string;
  fromEntityId: string;
  toEntityId: string;
  type: RelationshipType;
}

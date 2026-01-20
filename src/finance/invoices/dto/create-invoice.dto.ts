export class CreateInvoiceDto {
  amount: number;
  currency?: string;
  customer_name?: string;
  invoice_number?: string;
  status?: string;
}

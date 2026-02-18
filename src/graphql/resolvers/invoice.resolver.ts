// @ts-ignore
import { Resolver, Query, Mutation, Args, Context, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { InvoicesService } from '@finance/invoices/invoices.service';
import { Invoice } from '../types/invoice.type';
import { CreateInvoiceInput } from '../types/create-invoice.input';
import { UpdateInvoiceInput } from '../types/update-invoice.input';

@Resolver(() => Invoice)
@UseGuards(JwtAuthGuard)
export class InvoiceResolver {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Query(() => [Invoice], { name: 'invoices' })
  async getInvoices(
    @Args('limit', { type: () => Int, nullable: true }) limit = 10,
    @Args('offset', { type: () => Int, nullable: true }) offset = 0,
    @Context() context: any,
  ) {
    const tenantId = context.req?.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant context required');
    }
    const invoices = await this.invoicesService.findAll(tenantId);
    const start = Math.max(0, offset);
    return invoices.slice(start, start + limit);
  }

  @Query(() => Invoice, { name: 'invoice', nullable: true })
  async getInvoice(@Args('id', { type: () => ID }) id: string, @Context() context: any) {
    const tenantId = context.req?.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant context required');
    }
    return this.invoicesService.findOne(id, tenantId);
  }

  @Mutation(() => Invoice)
  async createInvoice(@Args('input') input: CreateInvoiceInput, @Context() context: any) {
    const tenantId = context.req?.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant context required');
    }
    return this.invoicesService.create(tenantId, input as any);
  }

  @Mutation(() => Invoice)
  async updateInvoice(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateInvoiceInput,
    @Context() context: any,
  ) {
    const tenantId = context.req?.user?.tenantId;
    if (!tenantId) {
      throw new Error('Tenant context required');
    }
    return this.invoicesService.update(id, tenantId, input as any);
  }
}

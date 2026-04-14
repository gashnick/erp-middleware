// src/whatsapp/whatsapp.resolver.ts
//
// GraphQL resolver for the WhatsApp channel.
// Config and session queries only — webhook handling is REST-only
// because Meta cannot call GraphQL endpoints.

import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { TenantGuard } from '@common/guards/tenant.guard';
import { runWithTenantContext } from '@common/context/tenant-context';
import { GraphQLContext } from '@common/graphql/graphql-context.interface';
import { WhatsAppService } from './whatsapp.service';

@Resolver()
@UseGuards(JwtAuthGuard, TenantGuard)
export class WhatsAppResolver {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  // ── Queries ────────────────────────────────────────────────────────────────

  @Query(() => String, { name: 'whatsappConfig' })
  async whatsappConfig(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.whatsAppService.getConfig()),
    );
  }

  @Query(() => String, { name: 'whatsappSessions' })
  async whatsappSessions(
    @Args('limit', { nullable: true, defaultValue: 20 }) limit: number,
    @Args('offset', { nullable: true, defaultValue: 0 }) offset: number,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.whatsAppService.listSessions(limit, offset)),
    );
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  @Mutation(() => String, { name: 'createWhatsAppConfig' })
  async createWhatsAppConfig(
    @Args('phoneNumber') phoneNumber: string,
    @Args('wabaId') wabaId: string,
    @Args('accessToken') accessToken: string,
    @Args('appSecret') appSecret: string,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () =>
        JSON.stringify(
          await this.whatsAppService.createConfig({
            phoneNumber,
            wabaId,
            accessToken,
            appSecret,
          }),
        ),
    );
  }

  @Mutation(() => String, { name: 'updateWhatsAppConfig' })
  async updateWhatsAppConfig(
    @Args('accessToken', { nullable: true }) accessToken?: string,
    @Args('appSecret', { nullable: true }) appSecret?: string,
    @Args('isActive', { nullable: true }) isActive?: boolean,
    @Context() ctx?: GraphQLContext,
  ) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () =>
        JSON.stringify(
          await this.whatsAppService.updateConfig({ accessToken, appSecret, isActive }),
        ),
    );
  }

  @Query(() => String, { name: 'whatsappLinkStatus' })
  async whatsappLinkStatus(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.whatsAppService.getLinkStatus(user.id)),
    );
  }

  @Mutation(() => String, { name: 'generateWhatsAppOtp' })
  async generateWhatsAppOtp(@Context() ctx?: GraphQLContext) {
    const user = this.getUser(ctx);
    return runWithTenantContext(
      {
        tenantId: user.tenantId,
        schemaName: user.schemaName,
        userId: user.id,
        userRole: user.role,
        userEmail: user.email,
      },
      async () => JSON.stringify(await this.whatsAppService.generateOtp(user.id)),
    );
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private getUser(ctx: GraphQLContext | undefined) {
    const user = ctx?.req?.user;
    if (!user) throw new BadRequestException('Unauthorized');
    return user;
  }
}

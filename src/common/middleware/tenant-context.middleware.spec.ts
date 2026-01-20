import { TenantContextMiddleware } from './tenant-context.middleware';
import { TenantProvisioningService } from '@tenants/tenant-provisioning.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';

describe('TenantContextMiddleware', () => {
  let middleware: TenantContextMiddleware;
  let tenantsService: jest.Mocked<TenantProvisioningService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockResponse = {} as Response;
  const mockNext = jest.fn();

  beforeEach(() => {
    tenantsService = { findById: jest.fn() } as any;
    jwtService = { decode: jest.fn() } as any;
    middleware = new TenantContextMiddleware(tenantsService, jwtService);
    jest.clearAllMocks();
  });

  it('should allow public auth routes without a tenant context', async () => {
    const mockRequest = {
      originalUrl: '/api/auth/login',
      method: 'POST',
      headers: {},
    } as Request;

    await middleware.use(mockRequest, mockResponse, mockNext);

    expect(mockNext).toHaveBeenCalled();
    // Verify it defaults to public schema
  });

  it('should throw UnauthorizedException if a private route is accessed without tenant context', async () => {
    const mockRequest = {
      originalUrl: '/api/invoices',
      method: 'GET',
      headers: {},
    } as Request;

    await middleware.use(mockRequest, mockResponse, mockNext);

    // The middleware calls next(error) in the catch block
    expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedException));
  });

  it('should use schemaName from JWT (Optimization) to avoid DB lookup', async () => {
    const mockRequest = {
      originalUrl: '/api/invoices',
      method: 'GET',
      headers: { authorization: 'Bearer valid-token' },
    } as Request;

    jwtService.decode.mockReturnValue({
      tenantId: 'uuid-123',
      schemaName: 'tenant_acme_corp',
      sub: 'user-1',
    });

    await middleware.use(mockRequest, mockResponse, mockNext);

    expect(tenantsService.findById).not.toHaveBeenCalled(); // Optimization check
    expect(mockNext).toHaveBeenCalled();
  });

  it('should fallback to DB lookup if schemaName is missing from JWT', async () => {
    const mockRequest = {
      originalUrl: '/api/invoices',
      method: 'GET',
      headers: { authorization: 'Bearer token-without-schema' },
    } as Request;

    jwtService.decode.mockReturnValue({ tenantId: 'uuid-123' });
    tenantsService.findById.mockResolvedValue({
      schema_name: 'tenant_from_db',
      status: 'ACTIVE',
    });

    await middleware.use(mockRequest, mockResponse, mockNext);

    expect(tenantsService.findById).toHaveBeenCalledWith('uuid-123');
    expect(mockNext).toHaveBeenCalled();
  });

  it('should throw UnauthorizedException if tenant is found but INACTIVE', async () => {
    const mockRequest = {
      originalUrl: '/api/invoices',
      method: 'GET',
      headers: { authorization: 'Bearer some-token' },
    } as Request;

    jwtService.decode.mockReturnValue({ tenantId: 'uuid-inactive' });
    tenantsService.findById.mockResolvedValue({
      schema_name: 'old_schema',
      status: 'INACTIVE',
    });

    await middleware.use(mockRequest, mockResponse, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Organization is inactive or does not exist.' }),
    );
  });
});

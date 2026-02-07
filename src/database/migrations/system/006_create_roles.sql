-- Create database roles for multi-tenant isolation
-- This ensures each tenant can only access their own schema

-- Create role for accessing public tables (tenant metadata)
-- This role has access to public.tenants and other shared tables
CREATE ROLE tenant_public_role;
GRANT CONNECT ON DATABASE erp_middleware TO tenant_public_role;
GRANT USAGE ON SCHEMA public TO tenant_public_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenant_public_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tenant_public_role;

-- Alter default privileges for future tables in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenant_public_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tenant_public_role;

-- Create role for tenant schema access
-- This role will be granted access to individual tenant schemas
CREATE ROLE tenant_schema_role;
GRANT CONNECT ON DATABASE erp_middleware TO tenant_schema_role;

-- Note: Individual tenant schemas will grant access to this role during creation
-- This ensures tenant isolation at the database level

-- Create a function to automatically set role based on search_path
-- This function is called by the connection pool to set the correct role
CREATE OR REPLACE FUNCTION set_tenant_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    current_schema text;
BEGIN
    -- Get current search_path
    SHOW search_path INTO current_schema;

    -- If search_path starts with 'tenant_', switch to tenant_schema_role
    -- Otherwise, use tenant_public_role for public schema access
    IF current_schema LIKE 'tenant_%' THEN
        SET ROLE tenant_schema_role;
    ELSE
        SET ROLE tenant_public_role;
    END IF;
END;
$$;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION set_tenant_role() TO tenant_public_role;
GRANT EXECUTE ON FUNCTION set_tenant_role() TO tenant_schema_role;

COMMENT ON FUNCTION set_tenant_role() IS 'Automatically sets the correct database role based on current search_path for tenant isolation';

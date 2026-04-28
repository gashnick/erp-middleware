import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeaveRequests1705000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employee_name VARCHAR(255) NOT NULL,
        leave_type VARCHAR(50) NOT NULL CHECK (leave_type IN ('annual', 'sick', 'personal', 'unpaid', 'maternity', 'paternity')),
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        days INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        reason TEXT,
        approved_by UUID,
        approved_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_leave_requests_employee_id ON leave_requests(employee_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_leave_requests_status ON leave_requests(status);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_leave_requests_start_date ON leave_requests(start_date);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF NOT EXISTS leave_requests CASCADE;`);
  }
}

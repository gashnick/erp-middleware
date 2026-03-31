// src/hr/hr.types.ts

export type EmployeeStatus = 'active' | 'on_leave' | 'terminated';

export interface Employee {
  id: string;
  externalId?: string;
  name: string;
  department: string;
  role: string;
  status: EmployeeStatus;
  startDate: Date;
  endDate?: Date;
  salary?: number;
  currency: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface HeadcountByDept {
  department: string;
  total: number;
  active: number;
  onLeave: number;
  terminated: number;
}

export interface HeadcountSummary {
  total: number;
  active: number;
  onLeave: number;
  terminated: number;
  byDepartment: HeadcountByDept[];
}

export interface HeadcountTrendPoint {
  period: string; // 'YYYY-MM'
  total: number;
  active: number;
  terminated: number;
}

export interface AttritionRisk {
  employeeId: string;
  name: string;
  department: string;
  role: string;
  tenureMonths: number;
  riskReason: string;
}

export interface AttritionSummary {
  period: string;
  terminations: number;
  avgHeadcount: number;
  rate: number; // terminations / avgHeadcount * 100
  riskFlags: AttritionRisk[];
}

export interface DeptPayroll {
  department: string;
  headcount: number;
  total: number;
  currency: string;
  avgSalary: number;
}

export interface PayrollSummary {
  total: number;
  currency: string;
  headcount: number;
  avgSalary: number;
  byDepartment: DeptPayroll[];
}

export interface EmployeeFilters {
  department?: string;
  status?: EmployeeStatus;
  from?: string;
  to?: string;
}

export interface CreateEmployeeDto {
  externalId?: string;
  name: string;
  department: string;
  role: string;
  status?: EmployeeStatus;
  startDate: string;
  endDate?: string;
  salary?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

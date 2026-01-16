import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { Tenant } from '../tenants/entities/tenant.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantsRepository: Repository<Tenant>,
  ) {}

  async create(tenantId: string, dto: CreateUserDto): Promise<User> {
    // Verify tenant exists
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new ConflictException(`Tenant with ID ${tenantId} not found`);
    }

    // Check if user already exists
    const existingUser = await this.usersRepository.findOne({
      where: { tenant: { id: tenantId }, email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException(`User with email ${dto.email} already exists for this tenant`);
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    // Create user
    const user = this.usersRepository.create({
      tenant,
      tenantId,
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role,
      status: 'active',
    });

    return this.usersRepository.save(user);
  }
}

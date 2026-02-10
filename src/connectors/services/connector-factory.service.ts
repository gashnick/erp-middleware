import { Injectable } from '@nestjs/common';
import { IConnector, ConnectorType } from '../interfaces/connector.interface';
import { QuickBooksConnector } from '../implementations/quickbooks.connector';
import { OdooConnector } from '../implementations/odoo.connector';
import { PostgreSQLConnector } from '../implementations/postgresql.connector';
import { MySQLConnector } from '../implementations/mysql.connector';
import { XLSXConnector } from '../implementations/xlsx.connector';
import { EtlService } from '../../etl/services/etl.service';

@Injectable()
export class ConnectorFactory {
  private connectors: Map<ConnectorType, IConnector>;

  constructor(private readonly etlService: EtlService) {
    this.connectors = new Map();
    this.registerConnectors();
  }

  private registerConnectors() {
    this.register(new QuickBooksConnector(this.etlService));
    this.register(new OdooConnector(this.etlService));
    this.register(new PostgreSQLConnector(this.etlService));
    this.register(new MySQLConnector(this.etlService));
    this.register(new XLSXConnector(this.etlService));
  }

  register(connector: IConnector) {
    this.connectors.set(connector.type, connector);
  }

  get(type: ConnectorType): IConnector {
    const connector = this.connectors.get(type);
    if (!connector) {
      throw new Error(`Connector type ${type} not found`);
    }
    return connector;
  }

  getAll(): IConnector[] {
    return Array.from(this.connectors.values());
  }

  getAvailableTypes(): ConnectorType[] {
    return Array.from(this.connectors.keys());
  }
}

export class QueryHelper {
  /**
   * Generates a parameterized PostgreSQL UPSERT query.
   * This allows batch inserts/updates without needing TypeORM Entities.
   */
  static buildUpsert(
    tableName: string,
    data: any[],
    conflictPaths: string[],
    updateColumns: string[],
  ) {
    if (!data || data.length === 0) {
      return { query: '', parameters: [] };
    }

    // 1. Extract columns from the first object
    const columns = Object.keys(data[0]);
    const columnNames = columns.map((c) => `"${c}"`).join(', ');

    // 2. Build value placeholders: ($1, $2, $3), ($4, $5, $6)...
    const placeholders = data
      .map((_, rowIndex) => {
        const rowOffset = rowIndex * columns.length;
        return `(${columns.map((_, colIndex) => `$${rowOffset + colIndex + 1}`).join(', ')})`;
      })
      .join(', ');

    // 3. Build ON CONFLICT clause
    const conflictClause = conflictPaths.map((c) => `"${c}"`).join(', ');
    const updateClause = updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');

    const query = `
      INSERT INTO "${tableName}" (${columnNames})
      VALUES ${placeholders}
      ON CONFLICT (${conflictClause})
      DO UPDATE SET ${updateClause}
      RETURNING id;
    `;

    // 4. Flatten all object values into a single array for the driver
    const parameters = data.flatMap((row) => columns.map((col) => row[col]));

    return { query, parameters };
  }
}

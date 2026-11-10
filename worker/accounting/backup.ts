interface BackupSql {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): Iterable<T> & { toArray(): T[] };
}
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

// Synchronous reads keep every table at one DO snapshot. No writes, transactions,
// claim execution or arbitrary caller-supplied SQL are exposed by this export.
export function exportLedgerSql(sql: BackupSql) {
  const schema = sql
    .exec<{ type: string; name: string; sql: string }>(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name",
    )
    .toArray();
  const tables = schema.filter((item) => item.type === "table");
  const statements = [
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
    ...tables.map((table) => `${table.sql};`),
  ];
  const counts: Record<string, number> = {};
  let size = statements.join("\n").length;
  for (const table of tables) {
    const columns = sql
      .exec<{ name: string; hidden: number }>(
        "SELECT name, hidden FROM pragma_table_xinfo(?)",
        table.name,
      )
      .toArray()
      .filter((column) => column.hidden === 0);
    const names = columns.map((column) => quoteIdentifier(column.name));
    const prefix = `INSERT INTO ${quoteIdentifier(table.name)} (${names.join(",")}) VALUES (`;
    const rows = sql.exec<{ statement: string }>(
      `SELECT ? || ${names.map((name) => `CASE WHEN typeof(${name}) = 'text' THEN 'CAST(X''' || hex(CAST(${name} AS BLOB)) || ''' AS TEXT)' ELSE quote(${name}) END`).join(" || ',' || ")} || ');' AS statement FROM ${quoteIdentifier(table.name)}`,
      prefix,
    );
    counts[table.name] = 0;
    for (const row of rows) {
      counts[table.name] = (counts[table.name] ?? 0) + 1;
      size += row.statement.length;
      if (size > 16 * 1024 * 1024)
        throw new Error(
          "Ledger export exceeds the synchronous backup size limit; use a paged snapshot backup before retrying.",
        );
      statements.push(row.statement);
    }
  }
  statements.push(
    ...schema
      .filter((item) => item.type !== "table")
      .map((item) => `${item.sql};`),
    "COMMIT;",
  );
  return {
    format: "walletor-ledger-sql-v1",
    sql: statements.join("\n"),
    counts,
    createdAt: new Date().toISOString(),
  };
}

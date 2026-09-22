import { z } from "zod";
import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { createComponentImplementation } from "@a2ui/react/v0_9";
import { WeightSchema, asArray, asNumber, asRecord, asString, formatNumberValue, orBinding, resolveDeep, weightStyle } from "../shared";

const ColumnSchema = z.object({
  key: z.string(),
  label: CommonSchemas.DynamicString,
  align: z.enum(["start", "end"]).optional(),
  format: z.enum(["number", "percent", "currency"]).optional(),
});

export const TableApi = {
  name: "Table",
  schema: z.object({
    columns: z.array(ColumnSchema).min(2).max(5),
    rows: orBinding(z.array(z.record(z.any())).min(1).max(20)),
    compact: z.boolean().optional(),
    weight: WeightSchema,
  }),
};

/** Tabular numbers: muted 12/600 header, hairline between rows only,
 *  numeric columns right-aligned tabular-nums, first column sticky when the
 *  table scrolls sideways on a phone. */
export const Table = createComponentImplementation(TableApi, ({ props, context }) => {
  const columns = asArray<unknown>(resolveDeep(props.columns, context.dataContext))
    .map((raw) => {
      const col = asRecord(raw);
      const key = col ? asString(col.key) : undefined;
      if (!col || !key) return null;
      const format: "number" | "percent" | "currency" | undefined =
        col.format === "number" || col.format === "percent" || col.format === "currency" ? col.format : undefined;
      return { key, label: asString(col.label) ?? key, numeric: col.align === "end" || format !== undefined, format };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const rows = asArray<unknown>(resolveDeep(props.rows, context.dataContext)).map(asRecord).filter(
    (r): r is Record<string, unknown> => r !== undefined
  );
  if (columns.length === 0 || rows.length === 0) return null;

  return (
    <div className="a2ui-table-wrap" style={weightStyle(props.weight)}>
      <table className={`a2ui-table${props.compact ? " a2ui-table--compact" : ""}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.numeric ? "a2ui-table__num" : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => {
                const cell = row[col.key];
                const n = asNumber(cell);
                const text =
                  col.format && n !== undefined
                    ? formatNumberValue(n, col.format, asString(row.currency))
                    : asString(cell) ?? "";
                return (
                  <td key={col.key} className={col.numeric ? "a2ui-table__num" : undefined}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

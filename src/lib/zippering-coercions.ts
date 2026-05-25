import type { ZipperingDataType } from "./zippering-types";

export class UnsafeCoercion extends Error {
  constructor(from: ZipperingDataType, to: ZipperingDataType, value: unknown) {
    super(`Unsafe coercion ${from}→${to} for value ${JSON.stringify(value)}`);
    this.name = "UnsafeCoercion";
  }
}

type Coercer = (v: unknown) => unknown;

const COERCERS: Partial<Record<`${ZipperingDataType}→${ZipperingDataType}`, Coercer>> = {
  // Identity coercions handled separately (see normalize()).
  "integer→text":      (v) => String(v),
  "numeric→text":      (v) => String(v),
  "text→integer":      (v) => {
    if (typeof v !== "string") throw new UnsafeCoercion("text", "integer", v);
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) throw new UnsafeCoercion("text", "integer", v);
    return n;
  },
  "integer→timestamp": (v) => new Date(v as number).toISOString(),
  "timestamp→integer": (v) => new Date(v as string).getTime(),
  "text→timestamp":    (v) => {
    const d = new Date(v as string);
    if (Number.isNaN(d.getTime())) throw new UnsafeCoercion("text", "timestamp", v);
    return d.toISOString();
  },
  "text→string[]":     (v) => [v],
  "string[]→jsonb":    (v) => v,
  "text→jsonb":        (v) => v,
};

export function normalize(
  value: unknown,
  from: ZipperingDataType,
  to: ZipperingDataType,
): unknown {
  if (from === to) return value;
  const key = `${from}→${to}` as const;
  const coercer = COERCERS[key];
  if (!coercer) throw new UnsafeCoercion(from, to, value);
  return coercer(value);
}

import { useEffect, useState } from "react";
import { request } from "./api";

export interface FieldLimits {
  agent: { displayName: number; description: number; creationBrief: number };
  profile: { displayName: number; description: number };
}

const FALLBACK: FieldLimits = {
  agent: { displayName: 100, description: 1000, creationBrief: 1000 },
  profile: { displayName: 100, description: 500 },
};

let cache: FieldLimits | null = null;
let pending: Promise<FieldLimits> | null = null;

export async function getFieldLimits(): Promise<FieldLimits> {
  if (cache) return cache;
  if (pending) return pending;

  pending = request<FieldLimits>("/api/field-limits")
    .then((limits) => {
      cache = limits;
      return limits;
    })
    .catch(() => {
      cache = FALLBACK;
      return FALLBACK;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function resetFieldLimitsCache(): void {
  cache = null;
  pending = null;
}

export function useFieldLimits(): FieldLimits {
  const [limits, setLimits] = useState<FieldLimits>(cache ?? FALLBACK);

  useEffect(() => {
    if (cache) return;
    getFieldLimits().then(setLimits);
  }, []);

  return limits;
}

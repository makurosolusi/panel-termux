import { useCallback } from "react";
import { useSearchParams } from "react-router";

/** `?page=` value → 1-based page; missing, non-integer or < 1 → 1. */
export const parsePageParam = (raw: string | null): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

/** `[page, setPage]` bound to `?page=` (page 1 removes the param; other params are kept). */
export function usePageParam(): [number, (page: number) => void] {
  const [params, setParams] = useSearchParams();
  const page = parsePageParam(params.get("page"));
  const setPage = useCallback(
    (next: number) =>
      setParams((prev) => {
        const out = new URLSearchParams(prev);
        if (next <= 1) out.delete("page");
        else out.set("page", String(Math.floor(next)));
        return out;
      }),
    [setParams],
  );
  return [page, setPage];
}

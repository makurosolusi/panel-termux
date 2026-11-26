import { useCallback, useEffect, useState } from "react";
import { CHUNK_RELOAD_KEY, type ChunkRecovery, recoverChunk, serverReachable } from "./chunk.error";

/** UI state of a chunk failure: checking the server, reloading, server down, or reload already tried. */
export type ChunkState = ChunkRecovery | "checking";

/**
 * Runs chunk recovery when `active` (reload once only if the server answers). `retry` re-checks the server and
 * reloads when it is back, else stays "offline" so the in-app message remains.
 */
export function useChunkRecovery(active: boolean): { state: ChunkState; retry: () => void } {
  const [state, setState] = useState<ChunkState>("checking");
  useEffect(() => {
    if (!active) return;
    let live = true;
    void recoverChunk(CHUNK_RELOAD_KEY).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [active]);
  const retry = useCallback(() => {
    setState("checking");
    void serverReachable().then((up) => {
      if (up) window.location.reload();
      else setState("offline");
    });
  }, []);
  return { state, retry };
}

import { createContext, useContext, useEffect } from "react";

/** Counter setter from the shell: +1 while a component holds task mode, −1 when it lets go. */
export const TaskModeContext = createContext<((delta: 1 | -1) => void) | null>(null);

/** While `on` (e.g. unsaved changes), the phone bottom bar is hidden so the page's ActionBar owns the bottom. */
export function useTaskMode(on: boolean) {
  const change = useContext(TaskModeContext);
  useEffect(() => {
    if (!on || !change) return;
    change(1);
    return () => change(-1);
  }, [on, change]);
}

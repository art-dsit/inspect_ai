import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../../state/store";
import { logsUrl, logsUrlRaw } from "./url";

export const useLogNavigation = () => {
  const navigate = useNavigate();
  const { logPath } = useParams<{ logPath: string }>();
  const logDir = useStore((state) => state.logs.logDir);
  const loadedLog = useStore((state) => state.log.loadedLog);
  const singleFileMode = useStore((state) => state.app.singleFileMode);

  const selectTab = useCallback(
    (tabId: string) => {
      // In single-file mode (e.g. Pyodide iframe with blob URL), skip URL
      // navigation — the blob URL gets mangled when embedded in a route path.
      // The tab state is already updated via setWorkspaceTab in the caller.
      if (singleFileMode) {
        return;
      }

      // Only update URL if we have a loaded log
      if (loadedLog && logPath) {
        // We already have the logPath from params, just navigate to the tab
        const url = logsUrlRaw(logPath, tabId);
        navigate(url);
      } else if (loadedLog) {
        // Fallback to constructing the path if needed
        const url = logsUrl(loadedLog, logDir, tabId);
        navigate(url);
      }
    },
    [loadedLog, logPath, logDir, navigate, singleFileMode],
  );

  return {
    selectTab,
  };
};

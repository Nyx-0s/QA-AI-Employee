import { useEffect, useState } from "react";
import { api } from "../api.js";

/**
 * Screenshot — fetches an auth-required image via the API client and renders
 * a thumbnail; click opens a full-size overlay. Blob URLs are revoked on
 * unmount so evidence never leaks past the component lifetime.
 */
export function Screenshot(props: {
  taskId: string;
  refPath?: string;
  /** Newer approvals API passes the whole entry; we use its task's first shot. */
  entry?: unknown;
}): React.JSX.Element | null {
  const { taskId, refPath } = props;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!refPath) return;
    let alive = true;
    let objectUrl: string | null = null;
    api
      .fetchScreenshot(taskId, refPath)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [taskId, refPath]);

  if (!refPath) return null;

  if (failed) {
    return <div className="text-xs text-zinc-600">screenshot unavailable</div>;
  }
  if (!url) {
    return <div className="h-24 w-40 animate-pulse rounded-lg bg-zinc-800" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="shrink-0 rounded-lg border border-zinc-800 overflow-hidden hover:border-zinc-600"
        title="View full size"
      >
        <img src={url} alt="Task evidence" className="h-24 w-40 object-cover" />
      </button>
      {zoom && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-8"
          onClick={() => setZoom(false)}
          role="presentation"
        >
          <img
            src={url}
            alt="Task evidence, full size"
            className="max-h-full max-w-full rounded-lg"
          />
        </div>
      )}
    </>
  );
}

import type { UploadQueueItem } from "../../hooks/useUpload";
import { UploadItem } from "./UploadItem";

interface UploadQueueProps {
  queue: UploadQueueItem[];
  orgId: string;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
}

/**
 * Cola de upload (F5, S4). Cola vacía: no renderiza nada (solo el
 * dropzone queda visible en la página).
 */
export function UploadQueue({
  queue,
  orgId,
  onRetry,
  onRemove,
  onCancel,
}: UploadQueueProps) {
  if (queue.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-2">
      {queue.map((item) => (
        <li key={item.id}>
          <UploadItem
            item={item}
            orgId={orgId}
            onRetry={onRetry}
            onRemove={onRemove}
            onCancel={onCancel}
          />
        </li>
      ))}
    </ul>
  );
}

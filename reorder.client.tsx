import { useCallback, useRef, useState } from "react";

type DragState = {
  id: string;
  from: number;
  over: number;
};

export function useWebReorder(enabled: boolean, orderedIds: string[], onCommit: (ids: string[]) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const idsRef = useRef(orderedIds);
  idsRef.current = orderedIds;

  const previewIds = drag
    ? moveId(orderedIds, drag.from, drag.over)
    : orderedIds;

  const start = useCallback(
    (id: string) => {
      if (!enabled) return;
      const from = idsRef.current.indexOf(id);
      if (from < 0) return;
      setDrag({ id, from, over: from });
    },
    [enabled],
  );

  const over = useCallback((id: string) => {
    setDrag((current) => {
      if (!current) return current;
      const next = idsRef.current.indexOf(id);
      if (next < 0 || next === current.over) return current;
      return { ...current, over: next };
    });
  }, []);

  const end = useCallback(() => {
    setDrag((current) => {
      if (!current) return null;
      const next = moveId(idsRef.current, current.from, current.over);
      if (next.some((id, index) => id !== idsRef.current[index])) onCommit(next);
      return null;
    });
  }, [onCommit]);

  return { previewIds, draggingId: drag?.id ?? null, start, over, end };
}

function moveId(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0) return ids;
  const next = ids.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

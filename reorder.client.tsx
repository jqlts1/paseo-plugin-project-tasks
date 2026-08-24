import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const SHIFT_MS = 180;
const DROP_MS = 160;
const CLICK_LOCK_MS = 280;
const EDGE_PX = 40;
const SCROLL_PX = 8;

type Geom = { id: string; offset: number; height: number };

type Session = {
  from: number;
  over: number;
  ids: string[];
  geoms: Geom[];
  gap: number;
  parent: HTMLElement;
  rows: HTMLElement[];
  clone: HTMLElement;
  startTop: number;
  grabY: number;
  lastY: number;
  scrollEl: HTMLElement | null;
  raf: number;
  dropping: boolean;
  prevUserSelect: string;
  prevCursor: string;
  onMove: (event: PointerEvent) => void;
  onUp: () => void;
  onKey: (event: KeyboardEvent) => void;
  onSelectStart: (event: Event) => void;
};

export function useWebReorder(enabled: boolean, orderedIds: string[], onCommit: (ids: string[]) => void) {
  const uid = useId().replace(/:/g, "");
  const listNativeId = `pt-open-${uid}`;
  const rowNativeId = useCallback((id: string) => `pt-row-${uid}-${id}`, [uid]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [overrideIds, setOverrideIds] = useState<string[] | null>(null);

  const idsRef = useRef(orderedIds);
  idsRef.current = orderedIds;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const sessionRef = useRef<Session | null>(null);
  const listNativeIdRef = useRef(listNativeId);
  listNativeIdRef.current = listNativeId;
  const rowNativeIdRef = useRef(rowNativeId);
  rowNativeIdRef.current = rowNativeId;
  const pendingTeardownRef = useRef<Session | null>(null);
  const unlockTimerRef = useRef(0);

  const previewIds = overrideIds ?? orderedIds;

  useEffect(() => {
    if (overrideIds && sameIds(overrideIds, orderedIds)) setOverrideIds(null);
  }, [orderedIds, overrideIds]);

  const finish = useCallback((commit: boolean) => {
    const session = sessionRef.current;
    if (!session || session.dropping) return;
    session.dropping = true;
    if (session.raf) cancelAnimationFrame(session.raf);
    session.raf = 0;

    const next = moveId(session.ids, session.from, session.over);
    const changed = commit && !sameIds(next, session.ids);
    const parentTop = session.parent.getBoundingClientRect().top;
    const destTop = commit
      ? parentTop + session.geoms[session.from].offset + rowShifts(session)[session.from]
      : parentTop + session.geoms[session.from].offset;

    session.clone.style.transition = `top ${DROP_MS}ms ease, transform ${DROP_MS}ms ease, box-shadow ${DROP_MS}ms ease`;
    session.clone.style.top = `${destTop}px`;
    session.clone.style.transform = "none";
    session.clone.style.boxShadow = "none";
    if (!commit) paintRowShifts(session, true);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      pendingTeardownRef.current = session;
      sessionRef.current = null;
      if (changed) {
        setOverrideIds(next);
        onCommitRef.current(next);
      }
      setDraggingId(null);
      if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = window.setTimeout(() => setBlocked(false), CLICK_LOCK_MS);
    };
    session.clone.addEventListener("transitionend", settle, { once: true });
    window.setTimeout(settle, DROP_MS + 40);
  }, []);

  const start = useCallback(
    (id: string, event?: unknown) => {
      if (!enabledRef.current || sessionRef.current || typeof document === "undefined") return;
      const ids = idsRef.current;
      const from = ids.indexOf(id);
      if (from < 0) return;

      const pointer = pointerOf(event);
      pointer.preventDefault();
      pointer.stopPropagation();

      const parent = document.getElementById(listNativeIdRef.current);
      if (!parent) return;

      const parentTop = parent.getBoundingClientRect().top;
      const rows: HTMLElement[] = [];
      const geoms: Geom[] = [];
      for (const rowId of ids) {
        const row = document.getElementById(rowNativeIdRef.current(rowId));
        if (!row) return;
        rows.push(row);
        const rect = row.getBoundingClientRect();
        geoms.push({ id: rowId, offset: rect.top - parentTop, height: rect.height });
      }

      const source = rows[from];
      const sourceRect = source.getBoundingClientRect();
      const grabY = pointer.clientY ?? sourceRect.top + sourceRect.height / 2;
      const clone = createClone(source, sourceRect);

      const session: Session = {
        from,
        over: from,
        ids,
        geoms,
        gap: geoms.length >= 2 ? Math.max(0, geoms[1].offset - geoms[0].offset - geoms[0].height) : 0,
        parent,
        rows,
        clone,
        startTop: sourceRect.top,
        grabY,
        lastY: grabY,
        scrollEl: nearestScroller(parent),
        raf: 0,
        dropping: false,
        prevUserSelect: document.body.style.userSelect,
        prevCursor: document.body.style.cursor,
        onMove: (ev) => {
          const live = sessionRef.current;
          if (live && !live.dropping) followPointer(live, ev.clientY);
        },
        onUp: () => finish(true),
        onKey: (ev) => {
          if (ev.key === "Escape") {
            ev.preventDefault();
            finish(false);
          }
        },
        onSelectStart: (ev) => ev.preventDefault(),
      };

      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      parent.style.pointerEvents = "none";
      for (const row of rows) {
        row.style.transition = `transform ${SHIFT_MS}ms ease`;
        row.style.willChange = "transform";
      }
      source.style.zIndex = "1";

      window.addEventListener("pointermove", session.onMove);
      window.addEventListener("pointerup", session.onUp);
      window.addEventListener("pointercancel", session.onUp);
      window.addEventListener("keydown", session.onKey);
      document.addEventListener("selectstart", session.onSelectStart);

      sessionRef.current = session;
      setBlocked(true);
      setDraggingId(id);
      followPointer(session, grabY);
      const tick = () => {
        const live = sessionRef.current;
        if (!live || live.dropping) return;
        live.raf = requestAnimationFrame(tick);
        const scroller = live.scrollEl;
        if (!scroller) return;
        const edge = scroller.getBoundingClientRect();
        const dy = live.lastY < edge.top + EDGE_PX ? -SCROLL_PX : live.lastY > edge.bottom - EDGE_PX ? SCROLL_PX : 0;
        if (dy === 0) return;
        const prev = scroller.scrollTop;
        scroller.scrollTop = prev + dy;
        if (scroller.scrollTop !== prev) followPointer(live, live.lastY);
      };
      session.raf = requestAnimationFrame(tick);
    },
    [finish],
  );

  useLayoutEffect(() => {
    const session = pendingTeardownRef.current;
    if (!session) return;
    pendingTeardownRef.current = null;
    teardown(session);
  });

  useEffect(() => {
    return () => {
      if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
      const live = sessionRef.current;
      sessionRef.current = null;
      if (live) teardown(live);
      const pending = pendingTeardownRef.current;
      pendingTeardownRef.current = null;
      if (pending) teardown(pending);
    };
  }, []);

  useEffect(() => {
    if (!enabled && sessionRef.current) finish(false);
  }, [enabled, finish]);

  return { previewIds, draggingId, blocked, start, listNativeId, rowNativeId };
}

function followPointer(session: Session, clientY: number) {
  session.lastY = clientY;
  session.clone.style.top = `${session.startTop + (clientY - session.grabY)}px`;
  session.clone.style.transform = "scale(1.02) rotate(0.5deg)";
  const parentTop = session.parent.getBoundingClientRect().top;
  let over = session.from;
  for (let i = 0; i < session.geoms.length; i++) {
    if (i === session.from) continue;
    const mid = parentTop + session.geoms[i].offset + session.geoms[i].height / 2;
    if (i < session.from && clientY < mid) over = Math.min(over, i);
    if (i > session.from && clientY > mid) over = Math.max(over, i);
  }
  if (over === session.over) return;
  session.over = over;
  paintRowShifts(session, false);
}

function rowShifts(session: Session): number[] {
  const { from, over, geoms, gap } = session;
  const order = Array.from({ length: geoms.length }, (_, i) => i);
  if (from !== over && from >= 0 && over >= 0) {
    const [item] = order.splice(from, 1);
    order.splice(over, 0, item);
  }
  const dest = new Array<number>(geoms.length);
  let y = geoms[0]?.offset ?? 0;
  for (let k = 0; k < order.length; k++) {
    dest[order[k]] = y;
    y += geoms[order[k]].height + (k < order.length - 1 ? gap : 0);
  }
  return geoms.map((geom, i) => dest[i] - geom.offset);
}

function paintRowShifts(session: Session, reset: boolean) {
  const shifts = reset ? session.geoms.map(() => 0) : rowShifts(session);
  for (let i = 0; i < session.rows.length; i++) {
    const y = shifts[i] ?? 0;
    session.rows[i].style.transform = y === 0 ? "none" : `translate3d(0, ${y}px, 0)`;
  }
}

function createClone(row: HTMLElement, rect: DOMRect): HTMLElement {
  const clone = row.cloneNode(true) as HTMLElement;
  clone.id = "";
  clone.setAttribute("data-reorder-clone", "1");
  clone.style.position = "fixed";
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = "0";
  clone.style.zIndex = "2147483646";
  clone.style.pointerEvents = "none";
  clone.style.boxSizing = "border-box";
  clone.style.boxShadow = "0 12px 28px rgba(0,0,0,0.22)";
  clone.style.borderRadius = getComputedStyle(row).borderRadius || "8px";
  clone.style.transform = "scale(1.02) rotate(0.5deg)";
  clone.style.transformOrigin = "50% 50%";
  clone.style.transition = "none";
  clone.style.opacity = "1";
  clone.style.userSelect = "none";
  let node: HTMLElement | null = row;
  let background = "#fff";
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
      background = bg;
      break;
    }
    node = node.parentElement;
  }
  clone.style.backgroundColor = background;
  document.body.appendChild(clone);
  return clone;
}

function nearestScroller(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
    node = node.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

function teardown(session: Session) {
  window.removeEventListener("pointermove", session.onMove);
  window.removeEventListener("pointerup", session.onUp);
  window.removeEventListener("pointercancel", session.onUp);
  window.removeEventListener("keydown", session.onKey);
  document.removeEventListener("selectstart", session.onSelectStart);
  if (session.raf) cancelAnimationFrame(session.raf);
  session.clone.remove();
  document.body.style.userSelect = session.prevUserSelect;
  document.body.style.cursor = session.prevCursor;
  session.parent.style.pointerEvents = "";
  for (const row of session.rows) {
    row.style.transition = "none";
    row.style.transform = "";
    row.style.willChange = "";
    row.style.zIndex = "";
  }
}

function pointerOf(event: unknown): {
  clientY: number | null;
  preventDefault(): void;
  stopPropagation(): void;
} {
  const value = event as
    | {
        clientY?: number;
        preventDefault?: () => void;
        stopPropagation?: () => void;
        nativeEvent?: {
          clientY?: number;
          preventDefault?: () => void;
          stopPropagation?: () => void;
        };
      }
    | null
    | undefined;
  const native = value?.nativeEvent;
  const clientY =
    typeof value?.clientY === "number" ? value.clientY : typeof native?.clientY === "number" ? native.clientY : null;
  return {
    clientY,
    preventDefault() {
      value?.preventDefault?.();
      native?.preventDefault?.();
    },
    stopPropagation() {
      value?.stopPropagation?.();
      native?.stopPropagation?.();
    },
  };
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function moveId(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0) return ids;
  const next = ids.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

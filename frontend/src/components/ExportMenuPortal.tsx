import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_W = 224; // 14rem

type ExportMenuPortalProps = {
  open: boolean;
  onRequestClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  align?: "end" | "start";
  menuWidthPx?: number;
  children: React.ReactNode;
};

/**
 * Renders a dropdown-style menu in a portal with fixed positioning so parent
 * overflow/stacking contexts cannot clip or hide it.
 */
export function ExportMenuPortal({
  open,
  onRequestClose,
  anchorRef,
  align = "end",
  menuWidthPx = DEFAULT_W,
  children,
}: ExportMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margin = 8;
      const w = menuWidthPx;
      let left = align === "end" ? r.right - w : r.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
      const top = Math.min(r.bottom + 6, window.innerHeight - margin);
      setPos({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, align, menuWidthPx]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onRequestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onRequestClose]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onRequestClose();
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open, onRequestClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed max-h-[min(70vh,28rem)] min-w-[14rem] overflow-y-auto rounded-md border border-[#30363d] bg-[#161b22] p-1 shadow-xl"
      style={{
        top: pos.top,
        left: pos.left,
        zIndex: 99999,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

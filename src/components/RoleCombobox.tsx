import { useState, useEffect, useRef, useMemo, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { ROLE_SUGGESTIONS, ROLE_DROPDOWN_MAX, ROLE_MATCHES_EMPTY } from "../lib/roleSuggestions";

export function RoleCombobox({
  value,
  onChange,
  inputId = "role-combobox",
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  inputId?: string;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ROLE_MATCHES_EMPTY;
    return ROLE_SUGGESTIONS
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && r.toLowerCase().includes(q))
      .slice(0, ROLE_DROPDOWN_MAX);
  }, [query]);

  useEffect(() => {
    setHighlightIndex(matches.length > 0 ? 0 : -1);
  }, [matches]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!value) {
      setQuery("");
      setMenuOpen(false);
      setHighlightIndex(-1);
    }
  }, [value]);

  function commitSelection(next: string) {
    const v = next.trim();
    if (!v) return;
    onChange(v);
    setQuery("");
    setMenuOpen(false);
    setHighlightIndex(-1);
  }

  function openMenu() {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setMenuOpen(true);
  }

  function scheduleCloseMenu() {
    blurTimeoutRef.current = setTimeout(() => {
      setMenuOpen(false);
      blurTimeoutRef.current = null;
    }, 120);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const q = query.trim();
    if (e.key === "Escape") {
      e.preventDefault();
      setMenuOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      if (matches.length === 0) return;
      e.preventDefault();
      setHighlightIndex((i) => (i < 0 ? 0 : (i + 1) % matches.length));
      return;
    }
    if (e.key === "ArrowUp") {
      if (matches.length === 0) return;
      e.preventDefault();
      setHighlightIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
      return;
    }
    if (e.key === "Enter") {
      if (!q) return;
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < matches.length) {
        commitSelection(matches[highlightIndex]);
      } else {
        commitSelection(q);
      }
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            openMenu();
          }}
          onFocus={() => openMenu()}
          onBlur={scheduleCloseMenu}
          onKeyDown={handleKeyDown}
          placeholder={value ? "Search to replace role…" : "Search roles or type your own…"}
          autoComplete="off"
          role="combobox"
          aria-expanded={menuOpen && query.trim().length > 0}
          aria-autocomplete="list"
          className="w-full rounded-xl border border-gray-200/80 bg-white/70 px-3 py-2 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-sm focus:outline-none focus-visible:shadow-focus dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-100"
        />
        {menuOpen && query.trim().length > 0 && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 z-[60] mt-1 max-h-48 overflow-auto rounded-xl border border-gray-200/90 bg-white/95 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-gray-900/95"
          >
            {matches.map((r, idx) => (
              <li key={r} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === highlightIndex}
                  tabIndex={-1}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => commitSelection(r)}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                    idx === highlightIndex
                      ? "bg-brand-100 text-gray-900 dark:bg-brand-700/30 dark:text-gray-100"
                      : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  {r}
                </button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                No preset match. Press{" "}
                <kbd className="rounded border border-gray-300 bg-gray-100 px-1 font-mono text-[10px] dark:border-gray-600 dark:bg-gray-800">
                  Enter
                </kbd>{" "}
                to use “{query.trim()}”
              </li>
            )}
          </ul>
        )}
      </div>
      {value ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="inline-flex max-w-full items-center gap-1 rounded-lg border border-gray-300/90 bg-white/95 py-1 pl-2.5 pr-1 text-sm font-medium text-gray-900 shadow-sm dark:border-white/20 dark:bg-white/[0.12] dark:text-gray-100">
            <span className="min-w-0 truncate">{value}</span>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setQuery("");
                setMenuOpen(false);
                setHighlightIndex(-1);
              }}
              className="shrink-0 rounded-md p-0.5 text-gray-600 hover:bg-black/5 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-gray-100"
              aria-label="Remove role"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

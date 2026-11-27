"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { ASTOCK_THEMES } from "./theme-config";

export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div className="theme-control" aria-label="外观主题">
      <Palette aria-hidden="true" className="h-4 w-4 shrink-0" />
      <label className="sr-only" htmlFor="astock-theme-select">选择界面主题</label>
      <select
        id="astock-theme-select"
        value={mounted ? theme ?? "dark" : "dark"}
        onChange={(event) => setTheme(event.target.value)}
        disabled={!mounted}
      >
        {ASTOCK_THEMES.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
    </div>
  );
}

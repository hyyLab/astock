"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";
import { ASTOCK_THEME_IDS } from "./theme-config";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      themes={[...ASTOCK_THEME_IDS]}
      defaultTheme="dark"
      enableSystem={false}
      enableColorScheme={false}
      storageKey="astock-theme"
    >
      {children}
    </NextThemesProvider>
  );
}

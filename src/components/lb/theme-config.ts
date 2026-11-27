export const ASTOCK_THEMES = [
  { id: "dark", label: "Teal Terminal · Dark", family: "Teal", mode: "Dark" },
  { id: "light", label: "Teal Terminal · Light", family: "Teal", mode: "Light" },
  { id: "cyberpunk-dark", label: "Cyberpunk Neon · Dark", family: "Cyberpunk", mode: "Dark" },
  { id: "cyberpunk-light", label: "Cyberpunk Neon · Light", family: "Cyberpunk", mode: "Light" },
  { id: "aurora-dark", label: "Aurora Flow · Dark", family: "Aurora", mode: "Dark" },
  { id: "aurora-light", label: "Aurora Flow · Light", family: "Aurora", mode: "Light" },
  { id: "glass-dark", label: "Glass Atelier · Dark", family: "Glass", mode: "Dark" },
  { id: "glass-light", label: "Glass Atelier · Light", family: "Glass", mode: "Light" },
  { id: "holo-dark", label: "Holographic · Dark", family: "Holographic", mode: "Dark" },
  { id: "holo-light", label: "Holographic · Light", family: "Holographic", mode: "Light" },
] as const;

export type AstockThemeId = (typeof ASTOCK_THEMES)[number]["id"];

export const ASTOCK_THEME_IDS = ASTOCK_THEMES.map((theme) => theme.id);

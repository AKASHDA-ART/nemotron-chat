import { useEffect, useState } from "react";

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.add("dark");
    setTheme("dark");
  }, []);

  return { theme, setTheme: () => {} }; // Fixed to dark mode for this app
}

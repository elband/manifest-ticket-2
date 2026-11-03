"use client";

import * as React from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { ThemeProvider } from "./ThemeProvider";
import { startAutoFlush } from "@/lib/sikerenOutbox";
import { startApiAutoFlush } from "@/lib/api/outbox";
import { startSettingsSync } from "@/lib/settingsSync";

export function Providers({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const stop = startAutoFlush();
    const stopApi = startApiAutoFlush();
    const stopSettings = startSettingsSync();
    return () => {
      stop();
      stopApi();
      stopSettings();
    };
  }, []);
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

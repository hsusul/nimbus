"use client";

import type { MeResponse } from "@nimbus/contracts";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { NimbusApiClient, type ApiClientConfig } from "../lib/api-client";
import { ConsoleShell } from "./console-shell";
import { ErrorNotice, TableSkeleton } from "./ui/feedback";
import { ToastProvider } from "./ui/toast";
import { UploadProvider } from "./uploads/upload-provider";

interface ConsoleRuntimeValue {
  api: NimbusApiClient;
  user: MeResponse["data"];
}

const ConsoleRuntimeContext = createContext<ConsoleRuntimeValue | null>(null);

export function ConsoleRuntime({
  config,
  children,
}: {
  config: ApiClientConfig;
  children: ReactNode;
}) {
  const api = useMemo(() => new NimbusApiClient(config), [config]);
  const [user, setUser] = useState<MeResponse["data"] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    api.me
      .then((result) => active && setUser(result.data))
      .catch((reason) => active && setError(reason));
    return () => {
      active = false;
    };
  }, [api]);

  if (error) {
    return (
      <main className="standalone-state">
        <ErrorNotice error={error} onRetry={() => window.location.reload()} />
      </main>
    );
  }
  if (!user) {
    return (
      <main className="standalone-state">
        <TableSkeleton rows={4} />
      </main>
    );
  }

  return (
    <ConsoleRuntimeContext.Provider value={{ api, user }}>
      <ToastProvider>
        <UploadProvider>
          <ConsoleShell config={config} user={user}>
            {children}
          </ConsoleShell>
        </UploadProvider>
      </ToastProvider>
    </ConsoleRuntimeContext.Provider>
  );
}

export function useConsole() {
  const value = useContext(ConsoleRuntimeContext);
  if (!value) throw new Error("useConsole must be used within ConsoleRuntime.");
  return value;
}

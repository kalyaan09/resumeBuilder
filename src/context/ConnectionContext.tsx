import { createContext, useContext } from "react";

export type ConnectionValue = {
  backendReady: boolean;
  backendConnecting: boolean;
  backendError: string | null;
  retry: () => void;
};

export const ConnectionContext = createContext<ConnectionValue>({
  backendReady: false,
  backendConnecting: true,
  backendError: null,
  retry: () => {},
});

export function useConnection() {
  return useContext(ConnectionContext);
}

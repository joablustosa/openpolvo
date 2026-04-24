import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const TOKEN_KEY = "smartagent_auth_token";
const TARGET_URL_KEY = "smartagent_target_url";

function normalizeStoredToken(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

type AuthContextValue = {
  token: string | null;
  targetUrl: string;
  setSession: (token: string, targetUrl?: string) => void;
  logout: () => void;
  setTargetUrl: (url: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    typeof localStorage !== "undefined"
      ? normalizeStoredToken(localStorage.getItem(TOKEN_KEY))
      : null,
  );
  const [targetUrl, setTargetUrlState] = useState(() => {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(TARGET_URL_KEY) ?? "";
  });

  const setSession = useCallback((newToken: string, url?: string) => {
    const t = newToken.trim();
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    if (url !== undefined) {
      localStorage.setItem(TARGET_URL_KEY, url);
      setTargetUrlState(url);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TARGET_URL_KEY);
    setToken(null);
    setTargetUrlState("");
  }, []);

  const setTargetUrl = useCallback((url: string) => {
    localStorage.setItem(TARGET_URL_KEY, url);
    setTargetUrlState(url);
  }, []);

  const value = useMemo(
    () => ({
      token,
      targetUrl,
      setSession,
      logout,
      setTargetUrl,
    }),
    [token, targetUrl, setSession, logout, setTargetUrl],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve estar dentro de AuthProvider");
  return ctx;
}

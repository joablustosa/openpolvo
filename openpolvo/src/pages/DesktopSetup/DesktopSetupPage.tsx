import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import { desktopLogs, desktopSetup } from "@/lib/desktopApi";
import { isElectronShell } from "@/lib/electronCredentials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AppLogo } from "@/components/brand/AppLogo";
import { PasswordFieldWithToggle } from "@/components/auth/PasswordFieldWithToggle";
import { saveAs } from "file-saver";

async function waitForHealth(maxMs = 120_000, intervalMs = 600): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch(apiUrl("/health"), { method: "GET" });
      if (res.ok) {
        const t = await res.text();
        if (t.trim() === "ok") return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export function DesktopSetupPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [needs, setNeeds] = useState(false);

  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [adminEmail, setAdminEmail] = useState("admin@openpolvo.local");

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("Open Polvo");
  const [smtpUseTls, setSmtpUseTls] = useState(true);
  const [configureSmtp, setConfigureSmtp] = useState(false);

  const [step, setStep] = useState<"form" | "working" | "done" | "error">("form");
  const [error, setError] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState<string | null>(null);
  const [savedAdminEmail, setSavedAdminEmail] = useState<string | null>(null);

  async function downloadLogsTxt() {
    try {
      const tail = await desktopLogs.readTail(256_000);
      const paths = await desktopLogs.getPaths();
      const header =
        `Open Polvo — logs (tail)\n` +
        `Gerado em: ${new Date().toISOString()}\n` +
        `Arquivo: ${paths.ok ? paths.file : "(indisponível)"}\n\n`;
      const text = header + (tail.ok ? tail.text : `Erro ao ler logs: ${tail.error}`);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      saveAs(blob, "openpolvo-logs.txt");
    } catch (e) {
      setError(`Não foi possível gerar o ficheiro de logs.\n\n${String((e as any)?.message ?? e)}`);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isElectronShell()) {
        if (!cancelled) {
          setNeeds(false);
          setChecking(false);
        }
        return;
      }
      const n = await desktopSetup.needsFirstRunSetup();
      if (cancelled) return;
      setNeeds(n);
      setChecking(false);
      if (!n) navigate("/", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const o = openaiApiKey.trim();
    const g = googleApiKey.trim();
    // Chaves de LLM são opcionais — podem ser configuradas mais tarde em Definições > LLM.

    if (configureSmtp) {
      const host = smtpHost.trim();
      const portN = Number(smtpPort);
      const user = smtpUser.trim();
      const fromE = smtpFromEmail.trim();
      if (!host || !Number.isFinite(portN) || portN < 1 || !user || !fromE) {
        setError("Para SMTP, preencha servidor, porta, utilizador e e-mail remetente.");
        return;
      }
    }

    setStep("working");
    const wr = await desktopSetup.writeFirstRunSetup({
      openaiApiKey: o,
      googleApiKey: g,
      adminEmail: adminEmail.trim() || "admin@openpolvo.local",
    });
    if (!wr.ok || !wr.adminEmail || !wr.adminPassword) {
      setStep("error");
      setError(wr.error ?? "Não foi possível gravar a configuração.");
      return;
    }

    const okHealth = await waitForHealth();
    if (!okHealth) {
      void desktopLogs.append("desktop-setup", "healthcheck timeout: /health não ficou ok em 120s");
      setStep("error");
      setError("A API não respondeu a tempo. Verifique os serviços na bandeja do sistema.");
      return;
    }

    let token: string | null = null;
    try {
      const loginRes = await fetch(apiUrl("/v1/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: wr.adminEmail, password: wr.adminPassword }),
      });
      const loginJson = (await loginRes.json().catch(() => ({}))) as {
        access_token?: string;
        error?: string;
      };
      if (!loginRes.ok || !loginJson.access_token) {
        void desktopLogs.append(
          "desktop-setup",
          `bootstrap login failed status=${loginRes.status} error=${loginJson.error ?? "(none)"}`,
        );
        setStep("error");
        setError(loginJson.error ?? "Login inicial falhou após configurar a API.");
        return;
      }
      token = loginJson.access_token;
    } catch (e) {
      void desktopLogs.append("desktop-setup", `bootstrap login exception: ${String((e as any)?.message ?? e)}`);
      setStep("error");
      setError("Não foi possível ligar à API após o arranque.");
      return;
    }

    // Aviso SMTP acumulado — não bloqueia a instalação; pode corrigir em Definições > E-mail.
    let smtpWarning: string | null = null;

    if (configureSmtp && token) {
      const host = smtpHost.trim();
      const portN = Number(smtpPort);
      const user = smtpUser.trim();
      const fromE = smtpFromEmail.trim();
      const fromN = smtpFromName.trim() || "Open Polvo";
      try {
        const putRes = await fetch(apiUrl("/v1/me/smtp"), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            host,
            port: portN,
            username: user,
            password: smtpPass,
            from_email: fromE,
            from_name: fromN,
            use_tls: smtpUseTls,
          }),
        });
        if (!putRes.ok) {
          const errBody = (await putRes.json().catch(() => ({}))) as { error?: string };
          smtpWarning = errBody.error ?? "Não foi possível guardar as definições SMTP. Pode ajustar em Definições > E-mail.";
        } else {
          const testRes = await fetch(apiUrl("/v1/me/smtp/test"), {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
          });
          if (!testRes.ok) {
            const errBody = (await testRes.json().catch(() => ({}))) as { error?: string };
            smtpWarning =
              errBody.error ??
                "SMTP guardado mas o teste de ligação falhou. Pode ajustar em Definições > E-mail.";
          }
        }
      } catch {
        smtpWarning = "Erro de rede ao configurar SMTP. Pode ajustar em Definições > E-mail.";
      }
    }

    setSavedAdminEmail(wr.adminEmail);
    setAdminPassword(wr.adminPassword);
    if (smtpWarning) setError(smtpWarning);
    setStep("done");
  }

  if (checking) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">A verificar configuração…</p>
      </div>
    );
  }

  if (!needs) return null;

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg border-border/80 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <AppLogo className="size-11 rounded-lg" />
          </div>
          <CardTitle className="text-xl">Configurar Open Polvo</CardTitle>
          <CardDescription>
            Primeira execução: defina o e-mail do administrador. As chaves de LLM e o SMTP são
            opcionais — podem ser configurados mais tarde em Definições.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "done" && savedAdminEmail && adminPassword ? (
            <div className="space-y-4">
              <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                Configuração concluída. Guarde a senha do administrador — não será mostrada de
                novo.
              </p>
              {error ? (
                <p className="whitespace-pre-wrap break-words rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                  ⚠️ {error}
                </p>
              ) : null}
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
                <div>
                  <span className="text-muted-foreground">E-mail:</span> {savedAdminEmail}
                </div>
                <div className="mt-1 break-all">
                  <span className="text-muted-foreground">Senha:</span> {adminPassword}
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() =>
                  navigate("/login", {
                    replace: true,
                    state: { prefillEmail: savedAdminEmail, prefillPassword: adminPassword },
                  })
                }
              >
                Ir para o login
              </Button>
            </div>
          ) : null}

          {step === "form" || step === "working" || step === "error" ? (
            <form className="space-y-4" onSubmit={onSubmit}>
              {error ? (
                <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => void downloadLogsTxt()}
                  disabled={step === "working"}
                >
                  Baixar logs (.txt)
                </button>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground" htmlFor="openai">
                  OpenAI API key <span className="text-xs">(opcional — configura em Definições &gt; LLM)</span>
                </label>
                <PasswordFieldWithToggle
                  id="openai"
                  label=""
                  value={openaiApiKey}
                  onChange={setOpenaiApiKey}
                  autoComplete="off"
                  disabled={step === "working"}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground" htmlFor="google">
                  Google API key <span className="text-xs">(opcional — configura em Definições &gt; LLM)</span>
                </label>
                <PasswordFieldWithToggle
                  id="google"
                  label=""
                  value={googleApiKey}
                  onChange={setGoogleApiKey}
                  autoComplete="off"
                  disabled={step === "working"}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground" htmlFor="adminEmail">
                  E-mail do administrador inicial
                </label>
                <Input
                  id="adminEmail"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  disabled={step === "working"}
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 rounded border-border accent-primary"
                  checked={configureSmtp}
                  disabled={step === "working"}
                  onChange={(e) => setConfigureSmtp(e.target.checked)}
                />
                <span>Configurar servidor SMTP agora <span className="text-xs">(opcional — pode fazer em Definições &gt; E-mail)</span></span>
              </label>

              {configureSmtp ? (
                <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs text-muted-foreground" htmlFor="smtpHost">
                        Servidor SMTP
                      </label>
                      <Input
                        id="smtpHost"
                        placeholder="smtp.exemplo.com"
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        disabled={step === "working"}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground" htmlFor="smtpPort">
                        Porta
                      </label>
                      <Input
                        id="smtpPort"
                        type="number"
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(e.target.value)}
                        disabled={step === "working"}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground" htmlFor="smtpUser">
                        Utilizador
                      </label>
                      <Input
                        id="smtpUser"
                        value={smtpUser}
                        onChange={(e) => setSmtpUser(e.target.value)}
                        disabled={step === "working"}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs text-muted-foreground" htmlFor="smtpPass">
                        Senha SMTP
                      </label>
                      <PasswordFieldWithToggle
                        id="smtpPass"
                        label=""
                        value={smtpPass}
                        onChange={setSmtpPass}
                        autoComplete="new-password"
                        disabled={step === "working"}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs text-muted-foreground" htmlFor="smtpFrom">
                        E-mail remetente (From)
                      </label>
                      <Input
                        id="smtpFrom"
                        type="email"
                        value={smtpFromEmail}
                        onChange={(e) => setSmtpFromEmail(e.target.value)}
                        disabled={step === "working"}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs text-muted-foreground" htmlFor="smtpName">
                        Nome remetente
                      </label>
                      <Input
                        id="smtpName"
                        value={smtpFromName}
                        onChange={(e) => setSmtpFromName(e.target.value)}
                        disabled={step === "working"}
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-border accent-primary"
                        checked={smtpUseTls}
                        disabled={step === "working"}
                        onChange={(e) => setSmtpUseTls(e.target.checked)}
                      />
                      Usar TLS
                    </label>
                  </div>
                </div>
              ) : null}

              <Button type="submit" className="w-full" disabled={step === "working"}>
                {step === "working" ? "A configurar…" : "Guardar e continuar"}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

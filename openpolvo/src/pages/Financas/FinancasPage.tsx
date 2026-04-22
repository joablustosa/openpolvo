import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Wallet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as fin from "@/lib/financeApi";

function monthUtcRange(y: number, m0: number): { from: string; to: string } {
  const from = new Date(Date.UTC(y, m0, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y, m0 + 1, 1, 0, 0, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

function toRFC3339Local(d: Date): string {
  return d.toISOString();
}

export function FinancasPage() {
  const { token } = useAuth();
  const now = new Date();
  const [y, setY] = useState(now.getUTCFullYear());
  const [m0, setM0] = useState(now.getUTCMonth());
  const { from, to } = useMemo(() => monthUtcRange(y, m0), [y, m0]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [categories, setCategories] = useState<fin.CategoryDTO[]>([]);
  const [txs, setTxs] = useState<fin.TransactionDTO[]>([]);
  const [subs, setSubs] = useState<fin.SubscriptionDTO[]>([]);

  const [newCat, setNewCat] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txDir, setTxDir] = useState<"in" | "out">("out");
  const [txDesc, setTxDesc] = useState("");
  const [txWhen, setTxWhen] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [txCat, setTxCat] = useState<string>("");

  const [subName, setSubName] = useState("");
  const [subAmount, setSubAmount] = useState("");
  const [subCadence, setSubCadence] = useState("monthly");
  const [subNext, setSubNext] = useState(() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCHours(12, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const [c, t, s] = await Promise.all([
        fin.getCategories(token),
        fin.getTransactions(token, from, to),
        fin.getSubscriptions(token),
      ]);
      setCategories(c);
      setTxs(t);
      setSubs(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token, from, to]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  );

  async function addCategory() {
    if (!token || !newCat.trim()) return;
    setErr(null);
    try {
      await fin.postCategory(token, { name: newCat.trim(), sort_order: 0 });
      setNewCat("");
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    }
  }

  async function removeCategory(id: string) {
    if (!token) return;
    if (!window.confirm("Apagar esta categoria?")) return;
    setErr(null);
    try {
      await fin.deleteCategory(token, id);
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    }
  }

  async function addTransaction() {
    if (!token) return;
    const euros = Number(String(txAmount).replace(",", "."));
    if (!Number.isFinite(euros) || euros <= 0) {
      setErr("Indique um valor válido (ex.: 12,50).");
      return;
    }
    const amountMinor = Math.round(euros * 100);
    const occurred = toRFC3339Local(new Date(txWhen));
    setErr(null);
    try {
      await fin.postTransaction(token, {
        amount_minor: amountMinor,
        direction: txDir,
        occurred_at: occurred,
        description: txDesc.trim(),
        category_id: txCat || null,
        source: "manual",
      });
      setTxAmount("");
      setTxDesc("");
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    }
  }

  async function addSubscription() {
    if (!token || !subName.trim()) return;
    const euros = Number(String(subAmount).replace(",", "."));
    if (!Number.isFinite(euros) || euros < 0) {
      setErr("Indique um valor válido para a assinatura.");
      return;
    }
    setErr(null);
    try {
      await fin.postSubscription(token, {
        name: subName.trim(),
        amount_minor: Math.round(euros * 100),
        cadence: subCadence,
        next_due_at: toRFC3339Local(new Date(subNext)),
      });
      setSubName("");
      setSubAmount("");
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    }
  }

  async function markPaid(id: string) {
    if (!token) return;
    setErr(null);
    try {
      await fin.postSubscriptionPaid(token, id);
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    }
  }

  async function toggleReminder(s: fin.SubscriptionDTO) {
    if (!token) return;
    setErr(null);
    try {
      await fin.patchSubscription(token, s.id, { reminder_active: !s.reminder_active });
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    }
  }

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para ver finanças.</p>
        <Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}>
          <ArrowLeft className="size-4" />
          Chat
        </Link>
        <div className="h-4 w-px bg-border" />
        <Wallet className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Finanças</h1>
      </header>

      <div className="mx-auto w-full max-w-4xl flex-1 space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Mês (transacções):</span>
          <Input
            type="month"
            className="h-8 w-40"
            value={`${y}-${String(m0 + 1).padStart(2, "0")}`}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [yy, mm] = v.split("-").map(Number);
              setY(yy);
              setM0(mm - 1);
            }}
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : null}
        {err ? (
          <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{err}</p>
        ) : null}

        <Tabs defaultValue="tx" className="w-full">
          <TabsList className="flex w-full flex-wrap">
            <TabsTrigger value="tx">Transacções</TabsTrigger>
            <TabsTrigger value="sub">Assinaturas</TabsTrigger>
            <TabsTrigger value="cat">Categorias</TabsTrigger>
          </TabsList>

          <TabsContent value="tx" className="mt-4 space-y-4">
            <div className="grid gap-2 rounded-lg border border-border bg-muted/10 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Valor (€)</label>
                <Input value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="12,50" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Sentido</label>
                <Select value={txDir} onValueChange={(v) => setTxDir(v as "in" | "out")}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="out">Saída</SelectItem>
                    <SelectItem value="in">Entrada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-[11px] text-muted-foreground">Data e hora</label>
                <Input type="datetime-local" value={txWhen} onChange={(e) => setTxWhen(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-[11px] text-muted-foreground">Categoria (opcional)</label>
                <Select value={txCat || "__none__"} onValueChange={(v) => setTxCat(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {rootCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                <label className="text-[11px] text-muted-foreground">Descrição</label>
                <Input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Supermercado" />
              </div>
              <Button type="button" size="sm" onClick={() => void addTransaction()}>
                Adicionar transacção
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Data</th>
                    <th className="p-2 font-medium">Descrição</th>
                    <th className="p-2 font-medium">Valor</th>
                    <th className="p-2 font-medium">Tipo</th>
                    <th className="p-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id} className="border-b border-border/60">
                      <td className="p-2 whitespace-nowrap">{new Date(t.occurred_at).toLocaleString()}</td>
                      <td className="p-2">{t.description}</td>
                      <td className="p-2 whitespace-nowrap">
                        {(t.amount_minor / 100).toFixed(2)} {t.currency}
                      </td>
                      <td className="p-2">{t.direction}</td>
                      <td className="p-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-destructive"
                          onClick={() => {
                            void (async () => {
                              try {
                                await fin.deleteTransaction(token, t.id);
                                await loadAll();
                              } catch (e) {
                                setErr(e instanceof Error ? e.message : "Erro");
                              }
                            })();
                          }}
                        >
                          Apagar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="sub" className="mt-4 space-y-4">
            <div className="grid gap-2 rounded-lg border border-border bg-muted/10 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 lg:col-span-2">
                <label className="text-[11px] text-muted-foreground">Nome</label>
                <Input value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="Netflix" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Valor (€)</label>
                <Input value={subAmount} onChange={(e) => setSubAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Cadência</label>
                <Select value={subCadence} onValueChange={setSubCadence}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="yearly">Anual</SelectItem>
                    <SelectItem value="weekly">Semanal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-[11px] text-muted-foreground">Próximo vencimento</label>
                <Input type="datetime-local" value={subNext} onChange={(e) => setSubNext(e.target.value)} />
              </div>
              <Button type="button" size="sm" onClick={() => void addSubscription()}>
                Adicionar assinatura
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">Nome</th>
                    <th className="p-2 font-medium">Valor</th>
                    <th className="p-2 font-medium">Próximo</th>
                    <th className="p-2 font-medium">Lembrete</th>
                    <th className="p-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="p-2">{s.name}</td>
                      <td className="p-2 whitespace-nowrap">
                        {(s.amount_minor / 100).toFixed(2)} {s.currency}
                      </td>
                      <td className="p-2 whitespace-nowrap">{new Date(s.next_due_at).toLocaleString()}</td>
                      <td className="p-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => void toggleReminder(s)}>
                          {s.reminder_active ? "Lembrete: sim" : "Lembrete: não"}
                        </Button>
                      </td>
                      <td className="p-2 space-x-1 text-right">
                        <Button type="button" size="sm" onClick={() => void markPaid(s.id)}>
                          Paguei
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => {
                            void (async () => {
                              try {
                                await fin.deleteSubscription(token, s.id);
                                await loadAll();
                              } catch (e) {
                                setErr(e instanceof Error ? e.message : "Erro");
                              }
                            })();
                          }}
                        >
                          Apagar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="cat" className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                className="max-w-xs"
                placeholder="Nova categoria raiz"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
              />
              <Button type="button" size="sm" onClick={() => void addCategory()}>
                Criar
              </Button>
            </div>
            <ul className="space-y-1 text-sm">
              {rootCategories.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded border border-border bg-card px-3 py-2"
                >
                  <span>{c.name}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void removeCategory(c.id)}>
                    Apagar
                  </Button>
                </li>
              ))}
            </ul>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

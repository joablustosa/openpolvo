import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  Plus,
  Wallet,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as fin from "@/lib/financeApi";
import { FinSummaryStrip } from "./components/FinSummaryStrip";
import { FinExpenseBarChart, type CategorySpendRow } from "./components/FinExpenseBarChart";
import { FinTransactionFormFields } from "./components/FinTransactionFormFields";
import { FinTransactionList } from "./components/FinTransactionList";

function monthUtcRange(y: number, m0: number): { from: string; to: string } {
  const from = new Date(Date.UTC(y, m0, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y, m0 + 1, 1, 0, 0, 0));
  return { from: from.toISOString(), to: to.toISOString() };
}

function toRFC3339Local(d: Date): string {
  return d.toISOString();
}

export function FinancasPage() {
  const navigate = useNavigate();
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
  const [patchBusyId, setPatchBusyId] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);

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
    const auth = token?.trim();
    if (!auth) return;
    setLoading(true);
    setErr(null);
    try {
      const [c, t, s] = await Promise.all([
        fin.getCategories(auth),
        fin.getTransactions(auth, from, to),
        fin.getSubscriptions(auth),
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

  const categoryById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) {
      m.set(c.id, c.name);
    }
    return m;
  }, [categories]);

  const { totalInMinor, totalOutMinor, currency, byCategoryOut } = useMemo(() => {
    let inM = 0;
    let outM = 0;
    let cur = "EUR";
    const agg = new Map<string, number>();
    for (const t of txs) {
      cur = t.currency || cur;
      if (t.direction === "in") inM += t.amount_minor;
      else outM += t.amount_minor;
      if (t.direction === "out") {
        const label = t.category_id ? (categoryById.get(t.category_id) ?? "Sem categoria") : "Sem categoria";
        agg.set(label, (agg.get(label) ?? 0) + t.amount_minor);
      }
    }
    const rows: CategorySpendRow[] = [...agg.entries()].map(([name, valueMinor]) => ({
      name,
      valueMinor,
    }));
    rows.sort((a, b) => b.valueMinor - a.valueMinor);
    return { totalInMinor: inM, totalOutMinor: outM, currency: cur, byCategoryOut: rows };
  }, [txs, categoryById]);

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
      setQuickOpen(false);
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

  const onTxCategoryChange = useCallback(
    async (txId: string, categoryId: string | null) => {
      if (!token) return;
      setPatchBusyId(txId);
      setErr(null);
      try {
        await fin.patchTransaction(token, txId, {
          category_id: categoryId,
        });
        await loadAll();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro ao actualizar");
      } finally {
        setPatchBusyId(null);
      }
    },
    [token, loadAll],
  );

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

  const formBlock = (
    <FinTransactionFormFields
      rootCategories={rootCategories}
      txAmount={txAmount}
      setTxAmount={setTxAmount}
      txDir={txDir}
      setTxDir={setTxDir}
      txWhen={txWhen}
      setTxWhen={setTxWhen}
      txCat={txCat}
      setTxCat={setTxCat}
      txDesc={txDesc}
      setTxDesc={setTxDesc}
      onSubmit={() => void addTransaction()}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-auto bg-background">
      <header className="sticky top-0 z-10 flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-3 sm:px-4">
        <Link
          to="/"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2 shrink-0")}
        >
          <ArrowLeft className="size-4" />
          Chat
        </Link>
        <div className="hidden h-4 w-px bg-border sm:block" />
        <Wallet className="size-4 shrink-0 text-primary" />
        <h1 className="min-w-0 flex-1 text-sm font-semibold sm:text-base">Finanças</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-9 shrink-0 gap-1.5 text-[11px] sm:text-xs"
          onClick={() =>
            navigate("/", {
              state: {
                chatDraft:
                  "Quero ajuda com as minhas finanças pessoais no Open Polvo: categorizar gastos e rever o mês.",
              },
            })
          }
        >
          <MessageCircle className="size-3.5 shrink-0" />
          <span className="hidden sm:inline">Assistente</span>
          <span className="sm:hidden">Chat</span>
        </Button>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-3 pb-24 sm:space-y-5 sm:p-4 sm:pb-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">Mês:</span>
            <Input
              type="month"
              className="h-10 min-h-[44px] w-full max-w-[200px] sm:w-44"
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
          <Button
            type="button"
            variant="default"
            size="sm"
            className="min-h-10 w-full gap-2 sm:hidden"
            onClick={() => setQuickOpen(true)}
          >
            <Plus className="size-4" />
            Nova transacção
          </Button>
          <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
            <DialogContent className="max-h-[min(90vh,640px)] overflow-y-auto sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Nova transacção</DialogTitle>
              </DialogHeader>
              {formBlock}
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : null}
        {err ? (
          <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{err}</p>
        ) : null}

        <FinSummaryStrip
          totalInMinor={totalInMinor}
          totalOutMinor={totalOutMinor}
          currency={currency}
        />

        <Tabs defaultValue="tx" className="w-full">
          <TabsList className="flex h-auto min-h-11 w-full flex-wrap gap-1 p-1">
            <TabsTrigger value="tx" className="min-h-10 flex-1 px-3 text-xs sm:text-sm">
              Operações
            </TabsTrigger>
            <TabsTrigger value="sub" className="min-h-10 flex-1 px-3 text-xs sm:text-sm">
              Assinaturas
            </TabsTrigger>
            <TabsTrigger value="cat" className="min-h-10 flex-1 px-3 text-xs sm:text-sm">
              Categorias
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tx" className="mt-4 space-y-4">
            <div className="hidden sm:block">
              <div className="rounded-xl border border-border bg-muted/10 p-4">{formBlock}</div>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <FinExpenseBarChart rows={byCategoryOut} currency={currency} />
              </div>
              <div className="lg:col-span-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Movimentos
                </h3>
                <FinTransactionList
                  txs={txs}
                  rootCategories={rootCategories}
                  onCategoryChange={(id, cat) => void onTxCategoryChange(id, cat)}
                  onDelete={(id) => {
                    void (async () => {
                      try {
                        await fin.deleteTransaction(token, id);
                        await loadAll();
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : "Erro");
                      }
                    })();
                  }}
                  patchBusyId={patchBusyId}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sub" className="mt-4 space-y-4">
            <div className="grid gap-3 rounded-xl border border-border bg-muted/10 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 lg:col-span-2">
                <label className="text-[11px] text-muted-foreground">Nome</label>
                <Input
                  className="min-h-10"
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  placeholder="Netflix"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Valor (€)</label>
                <Input className="min-h-10" value={subAmount} onChange={(e) => setSubAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Cadência</label>
                <Select value={subCadence} onValueChange={setSubCadence}>
                  <SelectTrigger className="min-h-10">
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
                <Input
                  type="datetime-local"
                  className="min-h-10"
                  value={subNext}
                  onChange={(e) => setSubNext(e.target.value)}
                />
              </div>
              <Button type="button" className="min-h-10 w-full sm:w-auto" onClick={() => void addSubscription()}>
                Adicionar assinatura
              </Button>
            </div>

            <div className="space-y-2 sm:hidden">
              {subs.map((s) => (
                <div key={s.id} className="rounded-xl border border-border bg-card p-3">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {(s.amount_minor / 100).toFixed(2)} {s.currency}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Próximo: {new Date(s.next_due_at).toLocaleString()}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void toggleReminder(s)}>
                      {s.reminder_active ? "Lembrete: sim" : "Lembrete: não"}
                    </Button>
                    <Button type="button" size="sm" onClick={() => void markPaid(s.id)}>
                      Paguei
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
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
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="p-2.5 font-medium">Nome</th>
                    <th className="p-2.5 font-medium">Valor</th>
                    <th className="p-2.5 font-medium">Próximo</th>
                    <th className="p-2.5 font-medium">Lembrete</th>
                    <th className="p-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="p-2.5">{s.name}</td>
                      <td className="p-2.5 whitespace-nowrap">
                        {(s.amount_minor / 100).toFixed(2)} {s.currency}
                      </td>
                      <td className="p-2.5 whitespace-nowrap">{new Date(s.next_due_at).toLocaleString()}</td>
                      <td className="p-2.5">
                        <Button type="button" variant="outline" size="sm" onClick={() => void toggleReminder(s)}>
                          {s.reminder_active ? "Lembrete: sim" : "Lembrete: não"}
                        </Button>
                      </td>
                      <td className="p-2.5 space-x-1 text-right">
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
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Input
                className="max-w-full min-h-10 sm:max-w-xs"
                placeholder="Nova categoria raiz"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
              />
              <Button type="button" className="min-h-10 w-full sm:w-auto" onClick={() => void addCategory()}>
                Criar
              </Button>
            </div>
            <ul className="space-y-2 text-sm">
              {rootCategories.map((c) => (
                <li
                  key={c.id}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2"
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void removeCategory(c.id)}>
                    Apagar
                  </Button>
                </li>
              ))}
            </ul>
          </TabsContent>
        </Tabs>
      </div>

      {/* FAB mobile: abre o mesmo diálogo */}
      <div className="fixed bottom-4 right-4 z-20 sm:hidden">
        <Button
          type="button"
          size="icon"
          className="size-14 rounded-full shadow-lg"
          onClick={() => setQuickOpen(true)}
          aria-label="Nova transacção"
        >
          <Plus className="size-6" />
        </Button>
      </div>
    </div>
  );
}

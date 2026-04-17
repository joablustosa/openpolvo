import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import * as contacts from "@/lib/contactsApi";
import type { ContactDTO } from "@/lib/contactsApi";

export function ContactsPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<ContactDTO[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const rows = await contacts.listContacts(token);
      setList(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setPhone("");
    setEmail("");
    setDialogOpen(true);
  };

  const openEdit = (c: ContactDTO) => {
    setEditingId(c.id);
    setName(c.name);
    setPhone(c.phone ?? "");
    setEmail(c.email);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    setErr(null);
    try {
      if (editingId) {
        await contacts.updateContact(token, editingId, {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
        });
      } else {
        await contacts.createContact(token, {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
        });
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token) return;
    if (!window.confirm("Eliminar este contacto?")) return;
    setErr(null);
    try {
      await contacts.deleteContact(token, id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao eliminar");
    }
  };

  if (!token) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <p>Inicie sessão para gerir contactos.</p>
        <Link to="/settings" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-auto bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link
          to="/settings"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}
        >
          <ArrowLeft className="size-4" />
          Definições
        </Link>
        <div className="h-4 w-px bg-border" />
        <Users className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Contactos</h1>
        <span className="text-xs text-muted-foreground">
          Agenda para e-mail e nó send_email no Pulo do Gato
        </span>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 pb-24">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> A carregar…
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não tem contactos. Use o botão + para adicionar.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {list.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                  {c.phone ? (
                    <p className="truncate text-xs text-muted-foreground">{c.phone}</p>
                  ) : null}
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                    id: {c.id}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="Editar"
                    onClick={() => openEdit(c)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive"
                    title="Eliminar"
                    onClick={() => void remove(c.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {err ? (
          <p className="text-sm text-destructive">{err}</p>
        ) : null}
      </div>

      <Button
        type="button"
        size="icon-lg"
        className="fixed bottom-6 right-6 z-40 size-12 rounded-full shadow-lg"
        onClick={openCreate}
        aria-label="Adicionar contacto"
      >
        <UserPlus className="size-5" />
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar contacto" : "Novo contacto"}
            </DialogTitle>
            <DialogDescription>
              Nome, telefone e e-mail ficam na sua conta e são enviados ao agente para
              reconhecer destinatários.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">
                Nome
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 text-sm"
                placeholder="Ex.: Maria Silva"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">
                Telefone
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9 text-sm"
                placeholder="+351 …"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase text-muted-foreground">
                E-mail
              </label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 text-sm"
                type="email"
                placeholder="maria@exemplo.com"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

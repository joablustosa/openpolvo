import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  History,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/auth/AuthContext";
import { useAnonymousChat } from "@/core/AnonymousChatContext";
import { useConversationWorkspace } from "@/core/ConversationWorkspaceContext";
import { useHomeChatControls } from "@/core/HomeChatContext";
import { AppLogo } from "@/components/brand/AppLogo";
import { displayNameFromToken } from "@/lib/userDisplay";
import { type ConversationDTO } from "@/lib/conversationsApi";
import { partitionConversationsForNav } from "@/lib/conversationNavOrder";
import { cn } from "@/lib/utils";

/** Opções do menu Email — extensível para mais integrações de agente. */
const AGENT_EMAIL_SETTINGS = [
  { value: "email-smtp", label: "Email (SMTP)", path: "/settings/email" as const },
  {
    value: "calendar",
    label: "Calendário",
    disabled: true as const,
    hint: "em breve",
  },
  {
    value: "agent-files",
    label: "Ficheiros do agente",
    disabled: true as const,
    hint: "em breve",
  },
] as const;

type ConversationItemProps = {
  conv: ConversationDTO;
  isActive: boolean;
  onSelect: () => void;
  onRename: (id: string, newTitle: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
};

function ConversationItem({
  conv,
  isActive,
  onSelect,
  onRename,
  onPin,
  onDelete,
}: ConversationItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isPinned = Boolean(conv.pinned_at);

  function startEdit() {
    setDraft(conv.title?.trim() ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const val = draft.trim();
    if (val && val !== conv.title?.trim()) {
      onRename(conv.id, val);
    }
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="px-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 text-sm"
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") cancelEdit();
          }}
          autoFocus
        />
      </li>
    );
  }

  return (
    <li key={conv.id} className="group relative flex items-center">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/80",
          isActive && "bg-muted font-medium text-foreground",
        )}
      >
        {isPinned && (
          <Pin className="mr-1 inline-block size-2.5 opacity-50" />
        )}
        {conv.title?.trim() || "Conversa sem título"}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          nativeButton
          render={
            <button
              type="button"
              className={cn(
                "absolute right-1 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100",
                isActive && "opacity-100",
              )}
              aria-label="Opções da conversa"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={startEdit}>
            <Pencil className="mr-2 size-3.5" />
            Renomear
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onPin(conv.id, !isPinned)}>
            {isPinned ? (
              <>
                <PinOff className="mr-2 size-3.5" />
                Desafixar
              </>
            ) : (
              <>
                <Pin className="mr-2 size-3.5" />
                Fixar
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(conv.id)}
          >
            <Trash2 className="mr-2 size-3.5" />
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function AgentSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, logout } = useAuth();
  const { openLoginModal } = useAnonymousChat();
  const { requestNewChat } = useHomeChatControls();
  const {
    conversations,
    activeConversationId,
    selectConversation,
    clearWorkspace,
    loadingList,
    deleteConversation,
    renameConversation,
    pinConversation,
  } = useConversationWorkspace();
  const newChat = useCallback(() => {
    if (token) {
      clearWorkspace();
    } else {
      requestNewChat();
    }
  }, [token, clearWorkspace, requestNewChat]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  const displayName = displayNameFromToken(token);

  const isEmailSettingsActive = location.pathname.startsWith("/settings/email");

  const { pinned: pinnedConvs, recent: recentConvs } = useMemo(
    () => partitionConversationsForNav(conversations),
    [conversations],
  );

  function handleSelect(c: ConversationDTO) {
    void selectConversation(c.id, c.default_model_provider ?? undefined);
  }

  function handleRename(id: string, title: string) {
    void renameConversation(id, title).catch(() => null);
  }

  function handlePin(id: string, pinned: boolean) {
    void pinConversation(id, pinned).catch(() => null);
  }

  function handleDelete(id: string) {
    void deleteConversation(id).catch(() => null);
  }

  return (
    <aside
      className={cn(
        "flex w-[min(100%,280px)] shrink-0 flex-col border-r border-border/80 bg-muted/25",
      )}
    >
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <AppLogo className="size-9 shrink-0 rounded-md ring-1 ring-border/60" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">Open Polvo</p>
          <p className="truncate text-[11px] text-muted-foreground">Zé Polvinho · Open Polvo</p>
        </div>
      </div>

      <nav className="flex shrink-0 flex-col gap-0.5 px-2 py-2">
        <NavLink
          to="/pulo-do-gato"
          className={({ isActive }) =>
            cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "justify-start font-normal",
              isActive && "bg-muted font-medium text-foreground",
            )
          }
        >
          Pulo do Gato
        </NavLink>
        <NavLink
          to="/settings"
          end
          className={({ isActive }) =>
            cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "justify-start gap-2 font-normal",
              isActive && "bg-muted font-medium text-foreground",
            )
          }
        >
          <Settings2 className="size-3.5 shrink-0 opacity-80" />
          Definições
        </NavLink>
        <NavLink
          to="/settings/contacts"
          className={({ isActive }) =>
            cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "justify-start gap-2 font-normal",
              isActive && "bg-muted font-medium text-foreground",
            )
          }
        >
          <Users className="size-3.5 shrink-0 opacity-80" />
          Contactos
        </NavLink>
        <Select
          onValueChange={(value) => {
            const opt = AGENT_EMAIL_SETTINGS.find((o) => o.value === value);
            if (opt && "path" in opt) {
              navigate(opt.path);
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-8 w-full border-0 bg-transparent font-normal shadow-none hover:bg-muted/80 focus-visible:ring-1 focus-visible:ring-ring/40",
              isEmailSettingsActive && "bg-muted font-medium text-foreground",
            )}
            aria-label="Email — configurações para agentes"
          >
            <span className="flex min-w-0 flex-1 truncate text-left text-sm">Email</span>
          </SelectTrigger>
          <SelectContent align="start" className="min-w-[var(--anchor-width)]">
            {AGENT_EMAIL_SETTINGS.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                disabled={"disabled" in opt && opt.disabled}
              >
                {"hint" in opt ? `${opt.label} (${opt.hint})` : opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </nav>

      <Separator className="mx-2 shrink-0 bg-border/60" />

      {/* Conversation list */}
      <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
        {/* Pinned */}
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Pin className="size-3" />
            Fixados
          </div>
          {pinnedConvs.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground/80">
              Nenhuma conversa fixada.
            </p>
          ) : (
            <ul className="space-y-0.5 text-sm text-muted-foreground">
              {pinnedConvs.map((c) => (
                <ConversationItem
                  key={c.id}
                  conv={c}
                  isActive={activeConversationId === c.id}
                  onSelect={() => handleSelect(c)}
                  onRename={handleRename}
                  onPin={handlePin}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Recent */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <History className="size-3" />
            Recentes
          </div>
          {!token ? (
            <p className="px-1 text-xs text-muted-foreground/80">
              Inicie sessão para ver conversas guardadas.
            </p>
          ) : loadingList ? (
            <p className="px-1 text-xs text-muted-foreground/80">A carregar…</p>
          ) : recentConvs.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground/80">
              Nenhuma conversa ainda. Escreva uma mensagem para começar.
            </p>
          ) : (
            <ul className="space-y-0.5 text-sm text-muted-foreground">
              {recentConvs.map((c) => (
                <ConversationItem
                  key={c.id}
                  conv={c}
                  isActive={activeConversationId === c.id}
                  onSelect={() => handleSelect(c)}
                  onRename={handleRename}
                  onPin={handlePin}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-2 border-t border-border/60 p-2">
        {!token ? (
          <div className="rounded-lg border border-border/80 bg-muted/30 p-2.5">
            <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
              Entre para usar o agente na API, guardar conversas e ter todas as
              funcionalidades.
            </p>
            <Button
              type="button"
              size="sm"
              className="w-full"
              onClick={() => openLoginModal()}
            >
              Entrar
            </Button>
          </div>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            nativeButton
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start gap-2 px-2 py-2 font-normal"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="text-[10px]">
                    {displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-left text-sm">
                  {displayName}
                </span>
                <ChevronDown className="size-4 shrink-0 opacity-50" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            {token ? (
              <>
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  Conta
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                  Sair
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem onClick={() => openLoginModal()}>
                  Entrar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  Modo visitante (2 perguntas)
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

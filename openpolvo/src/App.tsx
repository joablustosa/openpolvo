import { Navigate, Route, Routes } from "react-router-dom";
import { LoginDialog } from "./components/auth/LoginDialog";
import { AnonymousChatProvider, useAnonymousChat } from "./core/AnonymousChatContext";
import { Shell } from "./core/Shell";
import { LoginPage } from "./pages/Login/LoginPage";
import { MainPage } from "./pages/Main/MainPage";
import { SettingsEmailPage } from "./pages/Settings/SettingsEmailPage";
import { SettingsMetaPage } from "./pages/Settings/SettingsMetaPage";
import { SettingsPluginsPage } from "./pages/Settings/SettingsPluginsPage";
import { SettingsLLMPage } from "./pages/Settings/SettingsLLMPage";
import { SettingsOverviewPage } from "./pages/Settings/SettingsOverviewPage";
import { ContactsPage } from "./pages/Settings/ContactsPage";
import { AgenteTarefasPage } from "./pages/AgenteTarefas/AgenteTarefasPage";
import { AgendaPage } from "./pages/Agenda/AgendaPage";
import { FinancasPage } from "./pages/Financas/FinancasPage";
import { SocialAutomationPage } from "./pages/Social/SocialAutomationPage";
import { AutomacaoPage } from "./pages/Automacao/AutomacaoPage";

function AppShell() {
  const { loginModalOpen, setLoginModalOpen } = useAnonymousChat();
  return (
    <>
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Shell />}>
            <Route index element={<MainPage />} />
            <Route path="settings" element={<SettingsOverviewPage />} />
            <Route path="settings/email" element={<SettingsEmailPage />} />
            <Route path="settings/meta" element={<SettingsMetaPage />} />
            <Route path="settings/plugins" element={<SettingsPluginsPage />} />
            <Route path="settings/llm" element={<SettingsLLMPage />} />
            <Route path="settings/contacts" element={<ContactsPage />} />
            <Route path="agente-tarefas" element={<AgenteTarefasPage />} />
            <Route path="agenda" element={<AgendaPage />} />
            <Route path="financas" element={<FinancasPage />} />
            <Route path="social" element={<SocialAutomationPage />} />
            {/* Página unificada de automação (une Automações + Pulo do Gato) */}
            <Route path="automacao" element={<AutomacaoPage />} />
            {/* Rota legada — redireciona para a nova página unificada */}
            <Route path="automacoes" element={<Navigate to="/automacao" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <LoginDialog open={loginModalOpen} onOpenChange={setLoginModalOpen} />
    </>
  );
}

export function App() {
  return (
    <AnonymousChatProvider>
      <AppShell />
    </AnonymousChatProvider>
  );
}

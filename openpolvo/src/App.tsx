import { Navigate, Route, Routes } from "react-router-dom";
import { LoginDialog } from "./components/auth/LoginDialog";
import { AnonymousChatProvider, useAnonymousChat } from "./core/AnonymousChatContext";
import { Shell } from "./core/Shell";
import { LoginPage } from "./pages/Login/LoginPage";
import { MainPage } from "./pages/Main/MainPage";
import { PuloDoGatoPage } from "./pages/PuloDoGato/PuloDoGatoPage";

function AppShell() {
  const { loginModalOpen, setLoginModalOpen } = useAnonymousChat();
  return (
    <>
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Shell />}>
            <Route index element={<MainPage />} />
            <Route path="pulo-do-gato" element={<PuloDoGatoPage />} />
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

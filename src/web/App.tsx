import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import type { MeResponse } from "../shared/types";
import { api, ApiError } from "./api";
import { Icon, Loading, MeContext } from "./ui";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Family } from "./pages/Family";
import { Profile } from "./pages/Profile";
import { Invite } from "./pages/Invite";
import { Week } from "./pages/Week";
import { RecipePage } from "./pages/RecipePage";
import { Recipes } from "./pages/Recipes";
import { Shopping } from "./pages/Shopping";
import { Pantry } from "./pages/Pantry";
import { Compare } from "./pages/Compare";
import { Ingredients } from "./pages/Ingredients";

const TABS = [
  { to: "/", label: "Settimana", icon: "week" },
  { to: "/spesa", label: "Spesa", icon: "cart" },
  { to: "/ricette", label: "Ricette", icon: "book" },
  { to: "/dispensa", label: "Dispensa", icon: "pantry" },
  { to: "/profilo", label: "Profilo", icon: "user" },
];

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [state, setState] = useState<"loading" | "anon" | "ready" | "error">("loading");

  const refresh = useCallback(async () => {
    try {
      setMe(await api<MeResponse>("GET", "/api/me"));
      setState("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState("anon");
      else setState("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === "loading") return <div className="app"><Loading /></div>;
  if (state === "error")
    return (
      <div className="app">
        <p className="error">Impossibile contattare il server. Riprova tra poco.</p>
        <button onClick={() => void refresh()}>Riprova</button>
      </div>
    );
  if (state === "anon" || !me) return <Login onDone={refresh} />;
  if (!me.onboarded) return <MeContext.Provider value={{ me, refresh, setMe }}><Onboarding /></MeContext.Provider>;

  return (
    <MeContext.Provider value={{ me, refresh, setMe }}>
      <main className="app">
        <header className="app-brand"><NavLink to="/" aria-label="App Cibo, vai alla settimana"><span className="brand-mark">c.</span><span>app cibo</span></NavLink><NavLink to="/famiglia">{me.household.name} <span aria-hidden>↗</span></NavLink></header>
        <Routes>
          <Route path="/" element={<Week />} />
          <Route path="/ricetta/:id" element={<RecipePage />} />
          <Route path="/ricette" element={<Recipes />} />
          <Route path="/spesa" element={<Shopping />} />
          <Route path="/dispensa" element={<Pantry />} />
          <Route path="/admin/confronto" element={<Compare />} />
          <Route path="/admin/ingredienti" element={<Ingredients />} />
          <Route path="/famiglia" element={<Family />} />
          <Route path="/profilo" element={<Profile />} />
          <Route path="/invito/:token" element={<Invite />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="tabbar">
        <nav aria-label="Navigazione principale">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={t.icon} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </footer>
    </MeContext.Provider>
  );
}

// src/component/Sidebar.jsx
import { NavLink } from "react-router-dom";

export default function Sidebar() {
  return (
    <aside className="bg-slate-900 text-slate-100 md:min-h-screen md:sticky md:top-0">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/20 grid place-content-center">
            <span className="text-emerald-400 font-bold">C</span>
          </div>
          <div className="font-semibold tracking-wide">Admin Panel</div>
        </div>
      </div>

      {/* Menu */}
      <nav className="p-2 space-y-1">
        <NavItem to="/certificates" label="Certificate" />
        {/* ในอนาคต: เพิ่มเมนูอื่นได้ตรงนี้ */}
        {/* <NavItem to="/reports" label="Reports" /> */}
      </nav>

      {/* Footer small */}
      <div className="mt-auto hidden md:block px-4 py-3 text-[11px] text-slate-400/80">
        v1.0 • Tailwind UI
      </div>
    </aside>
  );
}

function NavItem({ to, label }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        [
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
          "text-slate-300 hover:text-white",
          "hover:bg-white/5 transition-colors",
          isActive ? "bg-white/10 text-white" : "",
        ].join(" ")
      }
    >
      {/* ไอคอนเรียบ ๆ */}
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-500/20 text-emerald-400 text-[11px]">
        C
      </span>
      <span>{label}</span>
    </NavLink>
  );
}

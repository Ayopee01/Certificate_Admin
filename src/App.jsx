// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import "./index.css";

// components
import Sidebar from "./component/Sidebar";
import CertificateAdmin from "./component/CertificateAdmin";

// Layout หลัก (Sidebar ซ้าย + เนื้อหาขวา)
function DashboardLayout() {
  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-[240px_1fr] bg-slate-50">
      <Sidebar />
      <main className="p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          {/* เปิดเว็บครั้งแรก → ไปหน้า /certificates */}
          <Route index element={<Navigate to="/certificates" replace />} />
          <Route path="/certificates" element={<CertificateAdmin />} />
        </Route>
        <Route path="*" element={<Navigate to="/certificates" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

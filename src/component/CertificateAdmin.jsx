// src/component/CertificateAdmin.jsx
import React, { useEffect, useRef, useState } from "react";

// PDF preview
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// ===== API base from .env =====
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
if (!API_URL) console.error("VITE_API_URL is missing. Set it in .env and restart Vite.");

// ===== tiny fetch helpers =====
async function postJSON(path, payload) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function postForm(path, formData, { response = "json" } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return response === "blob" ? res.blob() : res.json();
}

// ===== helpers =====
const COLS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)); // A..Z
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function extractSheetId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
  } catch (_) {}
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return "";
}
function buildRange({ sheetName, colMode, selectedCols, rowMode, rowStart, rowEnd }) {
  let start = "A", end = "Z";
  if (colMode === "custom") {
    const idxs = (selectedCols || [])
      .map((c) => COLS.indexOf(c))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (idxs.length) { start = COLS[idxs[0]]; end = COLS[idxs[idxs.length - 1]]; }
  }
  const sName = (sheetName ? String(sheetName) : "Sheet1").trim() || "Sheet1";
  if (rowMode === "all") return `${sName}!${start}:${end}`;
  const rs = Math.max(1, +rowStart || 1);
  const re = Math.max(rs, +rowEnd || rs);
  return `${sName}!${start}${rs}:${end}${re}`;
}
// ชื่อจริงจากแถว + ตั้งชื่อไฟล์
function getNameFromRow(row, preview, nameColumn) {
  if (!row) return "";
  if (Array.isArray(row)) {
    const idx = (preview?.headers || []).indexOf(nameColumn);
    return idx >= 0 ? (row[idx] ?? "") : (row[0] ?? "");
  }
  if (row && typeof row === "object") {
    if (nameColumn in row) return row[nameColumn] ?? "";
    const keys = Object.keys(row);
    return row[keys[0]] ?? "";
  }
  return String(row);
}
function safeSlug(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim()
    .replace(/[\/\\:*?"<>|]/g, "-");
}

// Google Fonts รายการเลือก
const FONT_PRESETS = [
  { key: "Sarabun", label: "Sarabun (TH)", css: "'Sarabun', sans-serif", gf: "Sarabun:wght@100..900" },
  { key: "Kanit", label: "Kanit (TH)", css: "'Kanit', sans-serif", gf: "Kanit:wght@100..900" },
  { key: "Prompt", label: "Prompt (TH)", css: "'Prompt', sans-serif", gf: "Prompt:wght@100..900" },
  { key: "NotoSansThai", label: "Noto Sans Thai", css: "'Noto Sans Thai', sans-serif", gf: "Noto+Sans+Thai:wght@100..900" },
  { key: "Mitr", label: "Mitr (TH)", css: "'Mitr', sans-serif", gf: "Mitr:wght@200..900" },
  { key: "Sriracha", label: "Sriracha", css: "'Sriracha', cursive", gf: "Sriracha" },
  { key: "Inter", label: "Inter", css: "'Inter', system-ui, sans-serif", gf: "Inter:wght@100..900" },
  { key: "Times", label: "Times New Roman", css: "'Times New Roman', serif", gf: null },
  { key: "Custom", label: "Custom (.ttf/.otf)", css: "__CUSTOM__", gf: null },
];
function ensureGoogleFontLoaded(gf) {
  if (!gf) return;
  const id = `gf-${gf}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id; link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${gf}&display=swap`;
  document.head.appendChild(link);
}

// Debounce hook
function useDebouncedEffect(effect, deps, delay = 350) {
  useEffect(() => {
    const h = setTimeout(() => { effect(); }, delay);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}

export default function CertificateAdmin() {
  // ====== Google Sheet ======
  const [sheetLink, setSheetLink] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [sheetTabs, setSheetTabs] = useState([]);
  const [sheetName, setSheetName] = useState("");

  // Range Builder
  const [colMode, setColMode] = useState("all");
  const [selectedCols, setSelectedCols] = useState(["A"]);
  const [rowMode, setRowMode] = useState("custom");
  const [rowStart, setRowStart] = useState(1);
  const [rowEnd, setRowEnd] = useState(1000);
  const [range, setRange] = useState("Sheet1!A1:Z1000");

  // ข้อมูล preview sheet
  const [preview, setPreview] = useState(null);
  const [records, setRecords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 24;
  const total = records.length;

  // Template & preview (local)
  const [templateFile, setTemplateFile] = useState(null);
  const [mode, setMode] = useState("auto"); // auto|image|pdf
  const [pageIndex, setPageIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const imgRef = useRef(null);
  const pdfCanvasRef = useRef(null);
  const [pdfSize, setPdfSize] = useState({ width: 1, height: 1 });
  const [imgNatural, setImgNatural] = useState({ width: 1, height: 1 });

  // Text settings
  const [nameColumn, setNameColumn] = useState("full_name");
  const [outputFormat, setOutputFormat] = useState("pdf");
  const [filenamePrefix, setFilenamePrefix] = useState("CERT_");
  const [fontSize, setFontSize] = useState(48);
  const [color, setColor] = useState("#000000");
  const [fontPresetKey, setFontPresetKey] = useState("Sarabun");
  const [fontWeight, setFontWeight] = useState(700);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [customFontFile, setCustomFontFile] = useState(null);
  const [customFontFamily, setCustomFontFamily] = useState("");

  // Position (rel)
  const [posRel, setPosRel] = useState({ x: 0.5, y: 0.5 });

  // แสดงพรีวิวแบบไหน
  const [previewTab, setPreviewTab] = useState("server"); // 'server' | 'client'

  // Server-render preview
  const [srvUrl, setSrvUrl] = useState("");
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvError, setSrvError] = useState("");
  const srvImgRef = useRef(null); // <<<<<< เพิ่ม ref รูปพรีวิวจาก backend

  const selectedPreset = FONT_PRESETS.find((f) => f.key === fontPresetKey) || FONT_PRESETS[0];
  const effectiveCssFamily = selectedPreset.css === "__CUSTOM__" ? (customFontFamily || "sans-serif") : selectedPreset.css;

  useEffect(() => { if (selectedPreset.gf) ensureGoogleFontLoaded(selectedPreset.gf); }, [fontPresetKey]);

  useEffect(() => {
    setRange(buildRange({ sheetName: sheetName || "Sheet1", colMode, selectedCols, rowMode, rowStart, rowEnd }));
  }, [sheetName, colMode, selectedCols, rowMode, rowStart, rowEnd]);

  useEffect(() => {
    if (sheetTabs.length === 0) setSheetName("");
    else if (!sheetTabs.includes(sheetName)) setSheetName(sheetTabs[0]);
  }, [sheetTabs]); // eslint-disable-line

  const onSheetLinkChange = (v) => setSheetLink(v);

  async function syncSheetTabs() {
    const id = extractSheetId(sheetLink);
    if (!id) return alert("โปรดวางลิงก์ Google Sheet ที่ถูกต้อง");
    setSheetId(id);
    try {
      const data = await postJSON(`/api/sheets/tabs`, { sheetId: id });
      let tabs = [];
      if (Array.isArray(data.tabs)) tabs = data.tabs;
      else if (Array.isArray(data.sheets)) tabs = data.sheets.map((s) => s?.title).filter(Boolean);
      if (!tabs.length) throw new Error("ไม่พบรายชื่อชีต");
      setSheetTabs(tabs);
      setSheetName(tabs[0]);
      alert(`ซิงค์รายชื่อชีตสำเร็จ\nพบ ${tabs.length} แท็บ`);
    } catch (e) {
      console.error(e);
      alert("ซิงค์รายชื่อชีตไม่สำเร็จ โปรดตรวจสอบสิทธิ์และ backend /api/sheets/tabs");
    }
  }

  async function handlePreview() {
    const id = sheetId || extractSheetId(sheetLink);
    if (!id) return alert("โปรดวางลิงก์หรือ ID ของ Google Sheet ให้ถูกต้อง");
    setSheetId(id);
    try {
      const data = await postJSON(`/api/sheets/preview`, { sheetId: id, range });
      setPreview(data);
      const recs = Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.sample) ? data.sample : [];
      setRecords(recs || []);
      setCurrentIndex(0);
      setPage(0);
      if (Array.isArray(data.headers) && data.headers.length) {
        setNameColumn(data.headers.includes("full_name") ? "full_name" : data.headers[0]);
      }
    } catch (e) {
      console.error(e);
      alert("ดึงข้อมูลตัวอย่างจากชีตไม่สำเร็จ");
    }
  }

  // สร้าง FormData สำหรับทั้ง generate / preview
  function buildGenerateForm(id) {
    const form = new FormData();
    form.append("template", templateFile);
    form.append("sheetId", id);
    form.append("range", range);
    form.append("nameColumn", nameColumn);
    form.append("outputFormat", outputFormat);

    const effectiveMode = mode === "auto" ? (templateFile?.type === "application/pdf" ? "pdf" : "image") : mode;
    form.append("mode", effectiveMode);

    // position (ใช้สัดส่วน)
    form.append("xRel", String(posRel.x));
    form.append("yRel", String(posRel.y));
    form.append("useRelative", "true");
    form.append("fromTop", "true");
    form.append("pageIndex", String(pageIndex));

    // font & style
    form.append("fontFamily", effectiveCssFamily);
    form.append("fontWeight", String(fontWeight));
    form.append("letterSpacing", String(letterSpacing));
    if (selectedPreset.key === "Custom" && customFontFile) {
      form.append("fontFile", customFontFile, customFontFile.name);
    }
    form.append("fontSize", String(fontSize));
    form.append("color", color);
    form.append("filenamePrefix", filenamePrefix);
    return form;
  }

  async function handleGenerateZip() {
    const id = sheetId || extractSheetId(sheetLink);
    if (!id) return alert("กรุณาใส่ลิงก์ของ Google Sheet ให้ถูกต้อง");
    if (!templateFile) return alert("กรุณาอัปโหลดเทมเพลต (ภาพหรือ PDF)");
    try {
      const form = buildGenerateForm(id);
      const blob = await postForm(`/api/generate`, form, { response: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `certificates_${Date.now()}.zip`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("สร้าง ZIP ไม่สำเร็จ");
    }
  }

  // ขอภาพพรีวิวจริงจาก backend (png)
  async function requestServerPreview(idx) {
    setSrvError("");
    const id = sheetId || extractSheetId(sheetLink);
    if (!id || !templateFile || idx < 0 || idx >= total) return;
    setSrvLoading(true);
    try {
      const form = buildGenerateForm(id);
      form.append("rowIndex", String(idx));
      form.append("preview", "png");
      const blob = await postForm(`/api/generate/preview`, form, { response: "blob" });
      const url = URL.createObjectURL(blob);
      // clear old blob url
      setSrvUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
    } catch (e) {
      console.error(e);
      setSrvError(typeof e?.message === "string" ? e.message : "Preview เรนเดอร์ไม่สำเร็จ");
    } finally {
      setSrvLoading(false);
    }
  }

  // ดาวน์โหลดเฉพาะไฟล์ปัจจุบัน (จริง)
  async function downloadCurrent() {
    const id = sheetId || extractSheetId(sheetLink);
    if (!id || !templateFile) return alert("กรุณาใส่ลิงก์ชีตและอัปโหลดเทมเพลตก่อน");
    try {
      const form = buildGenerateForm(id);
      form.append("rowIndex", String(currentIndex));
      const blob = await postForm(`/api/generate/one`, form, { response: "blob" });
      const nm = getNameFromRow(records[currentIndex], preview, nameColumn) || `row-${currentIndex+1}`;
      const ext = outputFormat === "pdf" ? "pdf" : "png";
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url; a.download = `${filenamePrefix}${safeSlug(nm)}.${ext}`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert("ดาวน์โหลดไฟล์ปัจจุบันไม่สำเร็จ");
    }
  }

  // local template handlers
  function handleTemplateChange(e) {
    const f = e?.target?.files?.[0] || null;
    setTemplateFile(f);
    setSrvUrl((old) => { if (old) URL.revokeObjectURL(old); return ""; });
    if (!f) { setPreviewUrl(""); setMode("auto"); return; }
    if (f.type?.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(f)); setMode("image"); setPosRel({ x: 0.5, y: 0.5 });
    } else if (f.type === "application/pdf") {
      setPreviewUrl(""); setMode("pdf"); setPosRel({ x: 0.5, y: 0.5 }); renderPdfFirstPage(f);
    } else { setPreviewUrl(""); setMode("auto"); }
  }
  async function renderPdfFirstPage(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = pdfCanvasRef.current; const ctx = canvas.getContext("2d");
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    setPdfSize({ width: viewport.width, height: viewport.height });
  }
  useEffect(() => { if (templateFile && mode === "pdf") renderPdfFirstPage(templateFile); }, [pageIndex]); // eslint-disable-line

  function onClickImage(e) {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPosRel({ x: clamp01(x), y: clamp01(y) });
  }
  function onClickPdf(e) {
    const canvas = pdfCanvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPosRel({ x: clamp01(x), y: clamp01(y) });
  }
  // <<<<<< คลิกบนรูปจากแบ็กเอนด์เพื่อย้ายตำแหน่ง
  function onClickServerImg(e) {
    if (!srvImgRef.current) return;
    const rect = srvImgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPosRel({ x: clamp01(x), y: clamp01(y) });
  }

  function handleCustomFontUpload(e) {
    const f = e?.target?.files?.[0] || null;
    setCustomFontFile(f);
    if (!f) { setCustomFontFamily(""); return; }
    const family = `UserFont_${Date.now()}`, url = URL.createObjectURL(f);
    const styleEl = document.createElement("style"); styleEl.setAttribute("data-userfont", family);
    styleEl.innerHTML = `@font-face{font-family:'${family}';src:url('${url}');font-display:swap}`;
    document.head.appendChild(styleEl);
    setCustomFontFamily(family);
  }
  function resetMarkerCenter() { setPosRel({ x: 0.5, y: 0.5 }); }

  // scale สำหรับ overlay local
  function usePreviewScale() {
    const [scale, setScale] = useState(1);
    useEffect(() => {
      function update() {
        if (mode === "image" && imgRef.current) {
          const el = imgRef.current;
          const srcW = imgNatural.width || el.naturalWidth || 1;
          const dispW = el.clientWidth || el.width || 1;
          setScale(dispW / srcW);
        } else if (mode === "pdf" && pdfCanvasRef.current) {
          const cv = pdfCanvasRef.current;
          const srcW = cv.width || 1;
          const dispW = cv.clientWidth || 1;
          setScale(dispW / srcW);
        } else setScale(1);
      }
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }, [mode, previewUrl, imgNatural, pdfSize]);
    return scale;
  }
  const previewScale = usePreviewScale();

  // ===== derived for filenames & sample text =====
  const currentRow = records[currentIndex] || null;
  const sampleName = getNameFromRow(currentRow, preview, nameColumn) || "Firstname Lastname";
  const ext = outputFormat === "pdf" ? "pdf" : "png";
  const exampleFileName = `${filenamePrefix}${safeSlug(sampleName)}.${ext}`;

  // ===== auto refresh server preview เมื่อปรับค่า =====
  useDebouncedEffect(() => {
    if (previewTab !== "server") return;
    if (!records.length) return;
    requestServerPreview(currentIndex);
  }, [
    previewTab, currentIndex, templateFile,
    posRel.x, posRel.y, fontSize, color, fontPresetKey, customFontFile, customFontFamily,
    fontWeight, letterSpacing, pageIndex, sheetId, range, nameColumn, outputFormat
  ], 400);

  // ===== UI =====
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Certificate</h1>
          <p className="text-slate-500 text-sm">ปรับตำแหน่ง/ฟอนต์ แล้ว “ดูพรีวิวจากไฟล์จริง” ก่อนดาวน์โหลด</p>
        </div>
        <button onClick={handleGenerateZip} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-white font-medium shadow hover:bg-emerald-700">
          Generate ZIP
        </button>
      </div>

      {/* Google Sheet */}
      <section className="rounded-xl border bg-white p-4 md:p-6 shadow-sm">
        <h2 className="font-semibold text-slate-800 mb-4">Google Sheet</h2>
        <div className="grid md:grid-cols-3 gap-4 items-end">
          <FieldText label="Sheet Link" value={sheetLink} onChange={onSheetLinkChange} placeholder="https://docs.google.com/spreadsheets/d/..." />
          <div className="md:col-span-1 flex items-end gap-2">
            <button type="button" onClick={syncSheetTabs} className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-black">
              ซิงค์รายชื่อชีต
            </button>
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm text-slate-600 mb-1">ชื่อชีต (Sheet Tab)</label>
            <select className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" value={sheetName} onChange={(e) => setSheetName(e.target.value)} disabled={sheetTabs.length === 0}>
              {sheetTabs.length === 0 ? <option value="">— กด “ซิงค์รายชื่อชีต” ก่อน —</option> : sheetTabs.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Range Builder */}
        <div className="mt-6 rounded-lg border p-4 bg-slate-50">
          <h3 className="font-medium text-slate-800 mb-3">Range Builder</h3>
          <div className="grid md:grid-cols-4 gap-4 mb-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">โหมดคอลัมน์</label>
              <select className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" value={colMode} onChange={(e) => setColMode(e.target.value)}>
                <option value="all">ทั้งหมด (A–Z)</option>
                <option value="custom">กำหนดเอง (ติ๊ก A–Z)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">โหมดแถว</label>
              <select className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" value={rowMode} onChange={(e) => setRowMode(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                <option value="custom">กำหนดเอง</option>
              </select>
            </div>
            {rowMode === "custom" && <FieldNumber label="แถวเริ่ม (Row Start)" value={rowStart} onChange={setRowStart} />}
            {rowMode === "custom" && <FieldNumber label="แถวสุดท้าย (Row End)" value={rowEnd} onChange={setRowEnd} />}
          </div>

          {colMode === "custom" && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-600">ติ๊กคอลัมน์ที่ต้องการ</span>
                <div className="flex gap-2">
                  <button type="button" className="text-xs px-2 py-1 rounded border bg-white hover:bg-slate-100" onClick={() => setSelectedCols(COLS)}>ติ๊กทั้งหมด</button>
                  <button type="button" className="text-xs px-2 py-1 rounded border bg-white hover:bg-slate-100" onClick={() => setSelectedCols([])}>ล้างทั้งหมด</button>
                </div>
              </div>
              <div className="grid grid-cols-13 gap-2">
                {COLS.map((c) => (
                  <label key={c} className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" className="rounded" checked={selectedCols.includes(c)}
                      onChange={(e) => setSelectedCols((prev) => e.target.checked ? Array.from(new Set(prev.concat(c))) : prev.filter((x) => x !== c))} />
                    <span className="w-5 text-center font-mono">{c}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button onClick={handlePreview} className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-black">Preview Sheet</button>
        </div>

        {preview && (
          <div className="mt-4 text-sm">
            <div className="text-slate-600">Headers: <span className="font-mono">{(preview.headers || []).join(", ")}</span></div>
            <div className="text-slate-600">Rows: {preview.count}</div>
            <ul className="mt-3 space-y-1 max-h-40 overflow-auto rounded border bg-slate-50 p-2">
              {(preview.sample || []).map((r, i) => (
                <li key={i} className="font-mono text-xs bg-white rounded p-2 shadow-sm border">{JSON.stringify(r)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* PREVIEW FILES: รายการทุกไฟล์ */}
      {records.length > 0 && (
        <section className="rounded-xl border bg-white p-4 md:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">Preview Files</h2>
            <div className="text-sm text-slate-600">กำลังดู: <span className="font-mono">{currentIndex + 1}</span> / {total}</div>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <button type="button" onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))} className="rounded-md border bg-white px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50" disabled={currentIndex === 0}>← Prev</button>
            <button type="button" onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))} className="rounded-md border bg-white px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50" disabled={currentIndex >= total - 1}>Next →</button>

            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-slate-500">ตัวอย่างไฟล์: <span className="font-mono">{exampleFileName}</span></span>
              <button type="button" onClick={() => requestServerPreview(currentIndex)} className="rounded border px-2 py-1 hover:bg-slate-50">รีเฟรชพรีวิวจริง</button>
              <button type="button" onClick={downloadCurrent} className="rounded border px-2 py-1 hover:bg-slate-50">ดาวน์โหลดไฟล์นี้</button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 max-h-64 overflow-auto">
            {records.slice(page * pageSize, Math.min(total, (page + 1) * pageSize)).map((row, i) => {
              const realIndex = page * pageSize + i;
              const nm = getNameFromRow(row, preview, nameColumn) || `row-${realIndex + 1}`;
              const fname = `${filenamePrefix}${safeSlug(nm)}.${ext}`;
              const active = realIndex === currentIndex;
              return (
                <button key={realIndex} type="button" onClick={() => setCurrentIndex(realIndex)}
                  className={`text-left rounded border px-3 py-2 text-xs font-mono ${active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white hover:bg-slate-50"}`} title={nm}>
                  <div className="text-[11px] opacity-70">#{realIndex + 1}</div>
                  <div className="truncate">{fname}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button className={`px-3 py-1 rounded border text-sm ${previewTab === "server" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white hover:bg-slate-50"}`} onClick={() => setPreviewTab("server")}>พรีวิวจริง (จากแบ็กเอนด์)</button>
            <button className={`px-3 py-1 rounded border text-sm ${previewTab === "client" ? "bg-slate-800 text-white border-slate-800" : "bg-white hover:bg-slate-50"}`} onClick={() => setPreviewTab("client")}>พรีวิวเร็ว (ทับข้อความในเบราว์เซอร์)</button>
          </div>
        </section>
      )}

      {/* Template + Preview */}
      <section className="rounded-xl border bg-white p-4 md:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-800">Template</h2>
          <div className="text-xs text-slate-500">โหมดไฟล์: <span className="font-medium">{mode}</span></div>
        </div>
        <input type="file" accept="image/*,application/pdf" onChange={handleTemplateChange}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white file:font-medium hover:file:bg-black" />

        {/* SERVER RENDER PREVIEW */}
        {previewTab === "server" && (
          <div className="mt-4 rounded-lg border bg-slate-50 p-3 overflow-auto relative">
            {srvLoading && <div className="p-6 text-center text-slate-500 text-sm">กำลังเรนเดอร์พรีวิวจากเซิร์ฟเวอร์…</div>}
            {srvError && <div className="p-3 text-sm text-red-600 border border-red-200 bg-red-50 rounded">{srvError}</div>}
            {!srvLoading && !srvError && srvUrl && (
              <div className="relative inline-block">
                <img
                  ref={srvImgRef}
                  src={srvUrl}
                  alt="server-preview"
                  className="max-w-full h-auto rounded shadow cursor-crosshair select-none"
                  onClick={onClickServerImg}
                />
                {/* ตัวจับ/เส้นไกด์ทับบนพรีวิวจาก backend (ไม่โชว์ข้อความทับ) */}
                <MarkerOverlay
                  parentRef={srvImgRef}
                  posRel={posRel}
                  onDrag={(nr) => setPosRel(nr)}
                  sampleText=""
                  color="transparent"
                  fontSize={fontSize}
                  fontFamily={effectiveCssFamily}
                  fontWeight={fontWeight}
                  letterSpacing={letterSpacing}
                  scale={1}
                  showText={false}
                />
              </div>
            )}
            {!srvLoading && !srvError && !srvUrl && <div className="p-6 text-center text-slate-400 text-sm">ยังไม่มีพรีวิว — กด “รีเฟรชพรีวิวจริง” หรือปรับค่าเพื่อให้เรนเดอร์อัตโนมัติ</div>}
          </div>
        )}

        {/* CLIENT OVERLAY PREVIEW (เร็ว) */}
        {previewTab === "client" && (
          <>
            {mode === "image" && previewUrl && (
              <div className="mt-4 rounded-lg border bg-slate-50 p-3 overflow-auto relative">
                <div className="relative inline-block">
                  <img
                    ref={imgRef}
                    src={previewUrl}
                    alt="template"
                    className="max-w-full h-auto rounded shadow cursor-crosshair select-none"
                    onClick={onClickImage}
                    onLoad={(e) => {
                      const im = e.currentTarget;
                      setImgNatural({ width: im.naturalWidth || 1, height: im.naturalHeight || 1 });
                    }}
                  />
                  <MarkerOverlay
                    parentRef={imgRef}
                    posRel={posRel}
                    onDrag={(nr) => setPosRel(nr)}
                    sampleText={sampleName}
                    color={color}
                    fontSize={fontSize}
                    fontFamily={effectiveCssFamily}
                    fontWeight={fontWeight}
                    letterSpacing={letterSpacing}
                    scale={previewScale}
                    showText={true}
                  />
                </div>
              </div>
            )}
            {mode === "pdf" && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-3">
                  <label className="text-sm text-slate-600">Page Index</label>
                  <input type="number" min={0} value={pageIndex} onChange={(e) => setPageIndex(+e.target.value)}
                    className="w-24 rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" />
                  <button type="button" onClick={resetMarkerCenter} className="text-xs px-3 py-1 rounded border bg-white hover:bg-slate-100">
                    รีเซ็ตตำแหน่งตัวอย่าง
                  </button>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 overflow-auto relative">
                  <div className="relative inline-block">
                    <canvas ref={pdfCanvasRef} className="rounded shadow cursor-crosshair select-none" onClick={onClickPdf} />
                    <MarkerOverlay
                      parentRef={pdfCanvasRef}
                      posRel={posRel}
                      onDrag={(nr) => setPosRel(nr)}
                      sampleText={sampleName}
                      color={color}
                      fontSize={fontSize}
                      fontFamily={effectiveCssFamily}
                      fontWeight={fontWeight}
                      letterSpacing={letterSpacing}
                      scale={previewScale}
                      showText={true}
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-500">ตำแหน่งเป็นสัดส่วน (0..1) — ใช้ค่านี้กับแบ็กเอนด์เหมือนกัน</p>
              </div>
            )}
          </>
        )}
      </section>

      {/* Settings */}
      <section className="rounded-xl border bg-white p-4 md:p-6 shadow-sm">
        <h2 className="font-semibold text-slate-800 mb-4">Settings</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <FieldText label="Prefix ชื่อไฟล์" value={filenamePrefix} onChange={setFilenamePrefix} placeholder="CERT_" />
          <div>
            <label className="block text-sm text-slate-600 mb-1">เอาต์พุต</label>
            <select className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" value={outputFormat} onChange={(e) => e.target.value && setOutputFormat(e.target.value)}>
              <option value="pdf">PDF</option>
              <option value="png">PNG</option>
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4 mt-4">
          <FieldText label="X (rel 0..1)" value={posRel.x.toFixed(4)} readOnly />
          <FieldText label="Y (rel 0..1)" value={posRel.y.toFixed(4)} readOnly />
          <FieldNumber label="Font Size" value={fontSize} onChange={setFontSize} />
          <div>
            <label className="block text-sm text-slate-600 mb-1">Color</label>
            <input type="color" className="h-10 w-full rounded-md border-slate-300 p-1" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
        </div>

        <div className="mt-6 rounded-lg border p-4 bg-slate-50">
          <h3 className="font-medium text-slate-800 mb-3">Font สำหรับชื่อ</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Family</label>
              <select className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" value={fontPresetKey} onChange={(e) => setFontPresetKey(e.target.value)}>
                {FONT_PRESETS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
            <FieldNumber label="Weight (100-900)" value={fontWeight} onChange={setFontWeight} />
            <div>
              <label className="block text-sm text-slate-600 mb-1">Letter Spacing (px)</label>
              <input type="number" step="0.5" value={letterSpacing} onChange={(e) => setLetterSpacing(parseFloat(e.target.value || 0))}
                className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" />
            </div>
          </div>

          {fontPresetKey === "Custom" && (
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">อัปโหลดฟอนต์ (.ttf/.otf)</label>
                <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleCustomFontUpload} className="block w-full text-sm" />
                {!customFontFile && <p className="text-xs text-amber-600 mt-1">อัปโหลดไฟล์ฟอนต์เพื่อใช้ในการพรีวิวและส่งให้ Backend</p>}
              </div>
              <div className="self-end text-xs text-slate-500">* ฝั่ง Backend ต้องฝังฟอนต์ตอนเรนเดอร์</div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <button type="button" onClick={resetMarkerCenter} className="text-xs px-3 py-1 rounded border bg-white hover:bg-slate-100">
            รีเซ็ตตำแหน่งตัวอย่างให้อยู่กลาง
          </button>
        </div>
      </section>
    </div>
  );
}

// ===== Small fields =====
function FieldText({ label, value, onChange, placeholder, readOnly }) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => (onChange ? onChange(e.target.value) : null)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500 ${readOnly ? "bg-slate-100" : ""}`}
      />
    </div>
  );
}
function FieldNumber({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm text-slate-600 mb-1">{label}</label>
      <input type="number" value={value} onChange={(e) => (onChange ? onChange(+e.target.value) : null)} className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" />
    </div>
  );
}

/** Draggable overlay (ใช้ได้ทั้ง client preview และ server preview)
 *  showText=false = แสดงเฉพาะเส้นไกด์ + จุดจับ (ไม่ทับข้อความจริงจาก backend) */
function MarkerOverlay({
  parentRef,
  posRel,
  onDrag,
  sampleText,
  color,
  fontSize,
  fontFamily,
  fontWeight,
  letterSpacing,
  scale = 1,
  showText = true,
}) {
  const markerRef = useRef(null);

  function moveBy(dxRel, dyRel) {
    const nx = clamp01(posRel.x + dxRel);
    const ny = clamp01(posRel.y + dyRel);
    onDrag({ x: nx, y: ny });
  }

  useEffect(() => {
    function onMove(ev) {
      if (!markerRef.current || !markerRef.current.dataset.dragging) return;
      const host = parentRef.current; if (!host) return;
      const rect = host.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      onDrag({ x: clamp01(x), y: clamp01(y) });
    }
    function onUp() {
      if (markerRef.current) markerRef.current.dataset.dragging = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    function onDown() {
      if (markerRef.current) markerRef.current.dataset.dragging = "1";
      markerRef.current?.focus();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    }
    const el = markerRef.current;
    if (el) el.addEventListener("pointerdown", onDown);
    return () => { if (el) el.removeEventListener("pointerdown", onDown); };
  }, [parentRef, onDrag]);

  function onKeyDown(ev) {
    const host = parentRef.current; if (!host) return;
    const rect = host.getBoundingClientRect();
    const basePx = ev.shiftKey ? 10 : ev.altKey ? 0.5 : 1;
    const dxRel = basePx / rect.width;
    const dyRel = basePx / rect.height;
    let handled = true;
    switch (ev.key) {
      case "ArrowLeft": moveBy(-dxRel, 0); break;
      case "ArrowRight": moveBy(dxRel, 0); break;
      case "ArrowUp": moveBy(0, -dyRel); break;
      case "ArrowDown": moveBy(0, dyRel); break;
      default: handled = false;
    }
    if (handled) ev.preventDefault();
  }

  const nearCX = Math.abs(posRel.x - 0.5) <= 0.01;
  const nearCY = Math.abs(posRel.y - 0.5) <= 0.01;
  const nearL = posRel.x <= 0.01;
  const nearR = posRel.x >= 0.99;
  const nearT = posRel.y <= 0.01;
  const nearB = posRel.y >= 0.99;

  const style = {
    left: `${posRel.x * 100}%`,
    top: `${posRel.y * 100}%`,
    transform: `translate(-50%, -50%)`,
    fontFamily,
    fontWeight,
    letterSpacing: `${letterSpacing * scale}px`,
  };

  return (
    <>
      {/* guidelines */}
      <div className="pointer-events-none absolute inset-0 select-none">
        <div className={`absolute left-1/2 top-0 bottom-0 w-px ${nearCX ? 'bg-emerald-500' : 'bg-black/20'}`} />
        <div className={`absolute top-1/2 left-0 right-0 h-px ${nearCY ? 'bg-emerald-500' : 'bg-black/20'}`} />
        <div className={`absolute left-0 top-0 bottom-0 w-px ${nearL ? 'bg-emerald-500' : 'bg-black/10'}`} />
        <div className={`absolute right-0 top-0 bottom-0 w-px ${nearR ? 'bg-emerald-500' : 'bg-black/10'}`} />
        <div className={`absolute top-0 left-0 right-0 h-px ${nearT ? 'bg-emerald-500' : 'bg-black/10'}`} />
        <div className={`absolute bottom-0 left-0 right-0 h-px ${nearB ? 'bg-emerald-500' : 'bg-black/10'}`} />
      </div>

      {/* draggable marker */}
      <div
        ref={markerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="absolute select-none focus:outline-none focus:ring-2 focus:ring-emerald-500/60 rounded"
        style={style}
        title="ลากหรือใช้ปุ่มลูกศรเพื่อย้าย (Shift=10px, Alt=0.5px)"
      >
        {showText && (
          <div
            className="rounded text-xs px-2 py-1"
            style={{ color, background: "transparent", fontSize: `${Math.max(1, fontSize * scale)}px` }}
          >
            {sampleText}
          </div>
        )}
        <div className="mx-auto mt-1 h-2 w-2 rounded-full bg-emerald-500" />
      </div>
    </>
  );
}

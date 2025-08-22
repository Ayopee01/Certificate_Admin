// src/component/CertificateAdmin.jsx
import React, { useEffect, useRef, useState } from "react";

// PDF preview
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// ===== API base from .env =====
const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
if (!API_URL) {
  console.error("VITE_API_URL is missing. Set it in .env and restart Vite.");
}

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
  } catch (_) { /* not a URL */ }
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

// Google Fonts for preview
const FONT_PRESETS = [
  { key: "Sarabun", label: "Sarabun (TH)", css: "'Sarabun', sans-serif", gf: "Sarabun:wght@100..900" },
  { key: "Kanit", label: "Kanit (TH)", css: "'Kanit', sans-serif", gf: "Kanit:wght@100..900" },
  { key: "Prompt", label: "Prompt (TH)", css: "'Prompt', sans-serif", gf: "Prompt:wght@100..900" },
  { key: "NotoSansThai", label: "Noto Sans Thai", css: "'Noto Sans Thai', sans-serif", gf: "Noto+Sans+Thai:wght@100..900" },
  { key: "Mitr", label: "Mitr (TH)", css: "'Mitr', sans-serif", gf: "Mitr:wght@200..900" },
  { key: "Sriracha", label: "Sriracha (TH Handwriting)", css: "'Sriracha', cursive", gf: "Sriracha" },
  { key: "Inter", label: "Inter", css: "'Inter', system-ui, sans-serif", gf: "Inter:wght@100..900" },
  { key: "Times", label: "Times New Roman", css: "'Times New Roman', serif", gf: null },
  { key: "Custom", label: "Custom (อัปโหลด .ttf/.otf)", css: "__CUSTOM__", gf: null },
];
function ensureGoogleFontLoaded(gf) {
  if (!gf) return;
  const id = `gf-${gf}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${gf}&display=swap`;
  document.head.appendChild(link);
}

export default function CertificateAdmin() {
  // debug env (safe to remove)
  useEffect(() => {
    console.log("API_URL from .env =", API_URL);
  }, []);

  // ====== Google Sheet ======
  const [sheetLink, setSheetLink] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [sheetTabs, setSheetTabs] = useState([]);
  const [sheetName, setSheetName] = useState("");

  // Range Builder
  const [colMode, setColMode] = useState("all"); // all | custom
  const [selectedCols, setSelectedCols] = useState(["A"]);
  const [rowMode, setRowMode] = useState("custom"); // all | custom
  const [rowStart, setRowStart] = useState(1);
  const [rowEnd, setRowEnd] = useState(1000);
  const [range, setRange] = useState("Sheet1!A1:Z1000"); // internal only

  // Preview result from backend
  const [preview, setPreview] = useState(null);

  // ====== Template & Preview ======
  const [templateFile, setTemplateFile] = useState(null);
  const [mode, setMode] = useState("auto"); // auto|image|pdf
  const [pageIndex, setPageIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const imgRef = useRef(null);
  const pdfCanvasRef = useRef(null);
  const [pdfSize, setPdfSize] = useState({ width: 1, height: 1 });

  // ====== Name/Text settings ======
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

  // Position (relative 0..1)
  const [posRel, setPosRel] = useState({ x: 0.5, y: 0.5 });

  // derived
  const selectedPreset = FONT_PRESETS.find((f) => f.key === fontPresetKey) || FONT_PRESETS[0];
  const effectiveCssFamily =
    selectedPreset.css === "__CUSTOM__" ? (customFontFamily || "sans-serif") : selectedPreset.css;

  useEffect(() => {
    if (selectedPreset && selectedPreset.gf) ensureGoogleFontLoaded(selectedPreset.gf);
  }, [fontPresetKey]);

  useEffect(() => {
    setRange(
      buildRange({
        sheetName: sheetName || "Sheet1",
        colMode,
        selectedCols,
        rowMode,
        rowStart,
        rowEnd,
      })
    );
  }, [sheetName, colMode, selectedCols, rowMode, rowStart, rowEnd]);

  // auto-select first tab after sync
  useEffect(() => {
    if (sheetTabs.length === 0) setSheetName("");
    else if (!sheetTabs.includes(sheetName)) setSheetName(sheetTabs[0]);
  }, [sheetTabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== handlers =====
  const onSheetLinkChange = (v) => setSheetLink(v);

  async function syncSheetTabs() {
    const id = extractSheetId(sheetLink);
    if (!id) { alert("โปรดวางลิงก์ Google Sheet ที่ถูกต้อง"); return; }
    setSheetId(id);
    try {
      const data = await postJSON(`/api/sheets/tabs`, { sheetId: id });
      let tabs = [];
      if (Array.isArray(data.tabs)) tabs = data.tabs;
      else if (Array.isArray(data.sheets)) tabs = data.sheets.map((s) => s && s.title).filter(Boolean);
      if (!tabs.length) throw new Error("ไม่พบรายชื่อชีต");
      setSheetTabs(tabs);
      setSheetName(tabs[0]);
      alert(`ซิงค์รายชื่อชีตสำเร็จ\nพบ ${tabs.length} แท็บ`);
    } catch (err) {
      console.error(err);
      alert("ซิงค์รายชื่อชีตไม่สำเร็จโปรดตรวจสอบสิทธิ์การเข้าถึง/ตั้งค่า backend route: /api/sheets/tabs");
    }
  }

  async function handlePreview() {
    const id = sheetId || extractSheetId(sheetLink);
    if (!id) { alert("โปรดวางลิงก์หรือ ID ของ Google Sheet ให้ถูกต้อง"); return; }
    setSheetId(id);
    try {
      const data = await postJSON(`/api/sheets/preview`, { sheetId: id, range });
      setPreview(data);
      if (data && Array.isArray(data.headers) && data.headers.length) {
        const defaultCol = data.headers.indexOf("full_name") >= 0 ? "full_name" : data.headers[0];
        setNameColumn(defaultCol);
      }
    } catch (err) {
      console.error(err);
      alert("ดึงข้อมูลตัวอย่างจากชีตไม่สำเร็จตรวจสอบสิทธิ์การเข้าถึงและช่วง Range");
    }
  }

  async function handleGenerate() {
    const id = sheetId || extractSheetId(sheetLink);
    if (!id) { alert("กรุณาใส่ลิงก์ของ Google Sheet ให้ถูกต้อง"); return; }
    if (!templateFile) { alert("กรุณาอัปโหลดเทมเพลต (ภาพหรือ PDF)"); return; }

    const form = new FormData();
    form.append("template", templateFile);
    form.append("sheetId", id);
    form.append("range", range);
    form.append("nameColumn", nameColumn);
    form.append("outputFormat", outputFormat);

    const effectiveMode =
      mode === "auto" ? (templateFile.type === "application/pdf" ? "pdf" : "image") : mode;
    form.append("mode", effectiveMode);

    // position
    form.append("xRel", String(posRel.x));
    form.append("yRel", String(posRel.y));
    form.append("useRelative", "true");
    form.append("fromTop", "true");

    // font & style
    form.append("fontFamily", effectiveCssFamily);
    form.append("fontWeight", String(fontWeight));
    form.append("letterSpacing", String(letterSpacing));
    if (selectedPreset.key === "Custom" && customFontFile) {
      form.append("fontFile", customFontFile, customFontFile.name);
    }

    form.append("fontSize", String(fontSize));
    form.append("color", color);
    form.append("pageIndex", String(pageIndex));
    form.append("filenamePrefix", filenamePrefix);

    try {
      const blob = await postForm(`/api/generate`, form, { response: "blob" });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `certificates_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      alert("สร้างไฟล์ไม่สำเร็จ ตรวจสอบรูปแบบและสิทธิ์ไฟล์อีกครั้ง");
    }
  }

  function handleTemplateChange(e) {
    const files = e?.target?.files || [];
    const f = files[0] || null;
    setTemplateFile(f);
    if (!f) { setPreviewUrl(""); setMode("auto"); return; }
    if (f.type && f.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(f));
      setMode("image");
      setPosRel({ x: 0.5, y: 0.5 });
    } else if (f.type === "application/pdf") {
      setPreviewUrl("");
      setMode("pdf");
      setPosRel({ x: 0.5, y: 0.5 });
      renderPdfFirstPage(f);
    } else {
      setPreviewUrl("");
      setMode("auto");
    }
  }

  async function renderPdfFirstPage(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(pageIndex + 1); // pageIndex starts 0
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = pdfCanvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    setPdfSize({ width: viewport.width, height: viewport.height });
  }

  useEffect(() => {
    if (templateFile && mode === "pdf") renderPdfFirstPage(templateFile);
  }, [pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleCustomFontUpload(e) {
    const files = e?.target?.files || [];
    const f = files[0] || null;
    setCustomFontFile(f);
    if (!f) { setCustomFontFamily(""); return; }
    const family = `UserFont_${Date.now()}`;
    const url = URL.createObjectURL(f);
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-userfont", family);
    styleEl.innerHTML = `@font-face { font-family: '${family}'; src: url('${url}'); font-display: swap; }`;
    document.head.appendChild(styleEl);
    setCustomFontFamily(family);
  }

  function resetMarkerCenter() {
    setPosRel({ x: 0.5, y: 0.5 });
  }

  // ===== UI =====
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Certificate</h1>
          <p className="text-slate-500 text-sm">เลือกตำแหน่งจาก Preview แล้วระบบคำนวณ X/Y ให้อัตโนมัติ</p>
        </div>
        <button onClick={handleGenerate} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-white font-medium shadow hover:bg-emerald-700">
          Generate ZIP
        </button>
      </div>

      {/* Google Sheet */}
      <section className="rounded-xl border bg-white p-4 md:p-6 shadow-sm">
        <h2 className="font-semibold text-slate-800 mb-4">Google Sheet</h2>

        <div className="grid md:grid-cols-3 gap-4 items-end">
          <FieldText
            label="Sheet Link"
            value={sheetLink}
            onChange={onSheetLinkChange}
            placeholder="วางลิงก์เช่น https://docs.google.com/spreadsheets/d/1AbC.../edit#gid=0"
          />
          <div className="md:col-span-1 flex items-end gap-2">
            <button
              type="button"
              onClick={syncSheetTabs}
              className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-black"
            >
              ซิงค์รายชื่อชีต
            </button>
          </div>

          {/* sheet tab */}
          <div className="md:col-span-1">
            <label className="block text-sm text-slate-600 mb-1">ชื่อชีต (Sheet Tab)</label>
            <select
              className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              disabled={sheetTabs.length === 0}
            >
              {sheetTabs.length === 0 ? (
                <option value="">— กด “ซิงค์รายชื่อชีต” ก่อน —</option>
              ) : (
                sheetTabs.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))
              )}
            </select>
            {sheetTabs.length === 0 && (
              <p className="text-xs text-slate-500 mt-1">ต้องซิงค์รายชื่อชีตก่อนจึงจะเลือกแท็บได้</p>
            )}
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
            {rowMode === "custom" && (
              <FieldNumber label="แถวเริ่ม (Row Start)" value={rowStart} onChange={setRowStart} />
            )}
            {rowMode === "custom" && (
              <FieldNumber label="แถวสุดท้าย (Row End)" value={rowEnd} onChange={setRowEnd} />
            )}
          </div>

          {colMode === "custom" && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-600">ติ๊กคอลัมน์ที่ต้องการ (ระบบจะใช้ช่วงครอบคลุมต่ำสุด–สูงสุด)</span>
                <div className="flex gap-2">
                  <button type="button" className="text-xs px-2 py-1 rounded border bg-white hover:bg-slate-100" onClick={() => setSelectedCols(COLS)}>ติ๊กทั้งหมด</button>
                  <button type="button" className="text-xs px-2 py-1 rounded border bg-white hover:bg-slate-100" onClick={() => setSelectedCols([])}>ล้างทั้งหมด</button>
                </div>
              </div>
              <div className="grid grid-cols-13 gap-2">
                {COLS.map((c) => (
                  <label key={c} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedCols.indexOf(c) >= 0}
                      onChange={(e) => {
                        setSelectedCols((prev) => {
                          if (e.target.checked) return Array.from(new Set(prev.concat(c)));
                          return prev.filter((x) => x !== c);
                        });
                      }}
                    />
                    <span className="w-5 text-center font-mono">{c}</span>
                  </label>
                ))}
              </div>
              {selectedCols.length === 0 && (
                <p className="text-xs text-amber-600 mt-2">ยังไม่ได้เลือกคอลัมน์ใด ๆ — ระบบจะใช้ A:Z ชั่วคราว</p>
              )}
            </div>
          )}
        </div>

        {/* Preview Sheet */}
        <div className="mt-4 flex items-center gap-2">
          <button onClick={handlePreview} className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-black">Preview Sheet</button>
        </div>

        {preview && (
          <div className="mt-4 text-sm">
            <div className="text-slate-600">
              Headers: <span className="font-mono">{(preview.headers || []).join(", ")}</span>
            </div>
            <div className="text-slate-600">Rows: {preview.count}</div>

            <div className="self-end text-xs text-slate-500">
              ถ้าไม่พบ header ที่ต้องการ ให้พิมพ์เองได้ใน Settings ด้านล่าง
            </div>

            <ul className="mt-3 space-y-1 max-h-40 overflow-auto rounded border bg-slate-50 p-2">
              {(preview.sample || []).map((r, i) => (
                <li key={i} className="font-mono text-xs bg-white rounded p-2 shadow-sm border">
                  {JSON.stringify(r)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Template + Preview */}
      <section className="rounded-xl border bg-white p-4 md:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-800">Template</h2>
          <div className="text-xs text-slate-500">โหมด: <span className="font-medium">{mode}</span></div>
        </div>
        <input type="file" accept="image/*,application/pdf" onChange={handleTemplateChange} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-white file:font-medium hover:file:bg-black" />

        {mode === "image" && previewUrl && (
          <div className="mt-4 rounded-lg border bg-slate-50 p-3 overflow-auto relative">
            <div className="relative inline-block">
              <img
                ref={imgRef}
                src={previewUrl}
                alt="template"
                className="max-w-full h-auto rounded shadow cursor-crosshair select-none"
                onClick={onClickImage}
              />
              <MarkerOverlay
                parentRef={imgRef}
                posRel={posRel}
                onDrag={(nr) => setPosRel(nr)}
                sampleText="Firstname Lastname"
                color={color}
                fontSize={fontSize}
                fontFamily={effectiveCssFamily}
                fontWeight={fontWeight}
                letterSpacing={letterSpacing}
              />
            </div>
          </div>
        )}

        {mode === "pdf" && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-slate-600">Page Index</label>
              <input type="number" min={0} value={pageIndex} onChange={(e) => setPageIndex(+e.target.value)} className="w-24 rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" />
              <button type="button" onClick={resetMarkerCenter} className="text-xs px-3 py-1 rounded border bg-white hover:bg-slate-100">รีเซ็ตตำแหน่งตัวอย่าง</button>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 overflow-auto relative">
              <div className="relative inline-block">
                <canvas ref={pdfCanvasRef} className="rounded shadow cursor-crosshair select-none" onClick={onClickPdf} />
                <MarkerOverlay
                  parentRef={pdfCanvasRef}
                  posRel={posRel}
                  onDrag={(nr) => setPosRel(nr)}
                  sampleText="ชื่อ-นามสกุล"
                  color={color}
                  fontSize={fontSize}
                  fontFamily={effectiveCssFamily}
                  fontWeight={fontWeight}
                  letterSpacing={letterSpacing}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">พิกัดที่เลือกเป็นสัดส่วน (0..1) เทียบกับขนาดหน้า PDF — Backend จะคำนวณพิกัดจริงให้อัตโนมัติ</p>
          </div>
        )}
      </section>

      {/* Settings */}
      <section className="rounded-xl border bg-white p-4 md:p-6 shadow-sm">
        <h2 className="font-semibold text-slate-800 mb-4">Settings</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <FieldText label="Prefix ชื่อไฟล์" value={filenamePrefix} onChange={setFilenamePrefix} placeholder="CERT_" />
          <div>
            <label className="block text-sm text-slate-600 mb-1">เอาต์พุต</label>
            <select className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
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

        {/* Font Picker */}
        <div className="mt-6 rounded-lg border p-4 bg-slate-50">
          <h3 className="font-medium text-slate-800 mb-3">Font สำหรับชื่อ</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Family</label>
              <select className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" value={fontPresetKey} onChange={(e) => setFontPresetKey(e.target.value)}>
                {FONT_PRESETS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <FieldNumber label="Weight (100-900)" value={fontWeight} onChange={setFontWeight} />
            <div>
              <label className="block text-sm text-slate-600 mb-1">Letter Spacing (px)</label>
              <input type="number" step="0.5" value={letterSpacing} onChange={(e) => setLetterSpacing(parseFloat(e.target.value || 0))} className="w-full rounded-md border-slate-300 focus:border-emerald-500 focus:ring-emerald-500" />
            </div>
          </div>

          {fontPresetKey === "Custom" && (
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">อัปโหลดฟอนต์ (.ttf/.otf)</label>
                <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleCustomFontUpload} className="block w-full text-sm" />
                {!customFontFile && <p className="text-xs text-amber-600 mt-1">อัปโหลดไฟล์ฟอนต์เพื่อใช้ในการพรีวิวและส่งให้ Backend</p>}
              </div>
              <div className="self-end text-xs text-slate-500">ปล. จำเป็นต้องให้ฝั่ง Backend รองรับการฝังฟอนต์เมื่อเรนเดอร์ PDF</div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <button type="button" onClick={resetMarkerCenter} className="text-xs px-3 py-1 rounded border bg-white hover:bg-slate-100">รีเซ็ตตำแหน่งตัวอย่างให้อยู่กลาง</button>
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

/** Draggable overlay */
function MarkerOverlay({ parentRef, posRel, onDrag, sampleText, color, fontSize, fontFamily, fontWeight, letterSpacing }) {
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
    fontFamily: fontFamily,
    fontWeight: fontWeight,
    letterSpacing: `${letterSpacing}px`,
  };

  return (
    <>
      <div className="pointer-events-none absolute inset-0 select-none">
        <div className={`absolute left-1/2 top-0 bottom-0 w-px ${nearCX ? 'bg-emerald-500' : 'bg-black/20'}`} />
        <div className={`absolute top-1/2 left-0 right-0 h-px ${nearCY ? 'bg-emerald-500' : 'bg-black/20'}`} />
        <div className={`absolute left-0 top-0 bottom-0 w-px ${nearL ? 'bg-emerald-500' : 'bg-black/10'}`} />
        <div className={`absolute right-0 top-0 bottom-0 w-px ${nearR ? 'bg-emerald-500' : 'bg-black/10'}`} />
        <div className={`absolute top-0 left-0 right-0 h-px ${nearT ? 'bg-emerald-500' : 'bg-black/10'}`} />
        <div className={`absolute bottom-0 left-0 right-0 h-px ${nearB ? 'bg-emerald-500' : 'bg-black/10'}`} />
      </div>

      <div
        ref={markerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="absolute select-none focus:outline-none focus:ring-2 focus:ring-emerald-500/60 rounded"
        style={style}
        title="ลากหรือใช้ปุ่มลูกศรเพื่อย้าย (Shift=10px, Alt=0.5px)"
      >
        <div
          className="rounded text-xs px-2 py-1"
          style={{ color: color, background: "transparent", fontSize: `${Math.max(12, fontSize)}px` }}
        >
          {sampleText}
        </div>
        <div className="mx-auto mt-1 h-2 w-2 rounded-full bg-emerald-500" />
      </div>
    </>
  );
}

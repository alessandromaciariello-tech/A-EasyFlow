"use client";

import { useState, useRef, useCallback } from "react";
import { X } from "@phosphor-icons/react";
import { importDDMRPCSV, type CSVImportResult } from "@/lib/ddmrp/api";

interface CSVImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

type ImportTab = "products" | "sales" | "inventory";

const TAB_INFO: Record<ImportTab, { label: string; columns: string; example: string }> = {
  products: {
    label: "Products",
    columns: "sku, name, unitCost, sellPrice, category",
    example: "sku,name,unitCost,sellPrice,category\nSKU-001,Widget A,12.50,29.99,Electronics",
  },
  sales: {
    label: "Sales",
    columns: "date, sku, qty, orders (optional), channel (optional)",
    example: "date,sku,qty\n2026-02-01,SKU-001,5\n2026-02-02,SKU-001,3",
  },
  inventory: {
    label: "Inventory",
    columns: "date, sku, onHand, allocated (optional), onOrder (optional)",
    example: "date,sku,onHand,allocated,onOrder\n2026-03-01,SKU-001,150,10,50",
  },
};

export default function CSVImportModal({ onClose, onImported }: CSVImportModalProps) {
  const [tab, setTab] = useState<ImportTab>("products");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<CSVImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter(Boolean).slice(0, 6);
      setPreview(lines.map((l) => l.split(",").map((c) => c.trim())));
    };
    reader.readAsText(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f && f.name.endsWith(".csv")) handleFile(f);
    },
    [handleFile]
  );

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const res = await importDDMRPCSV(tab, file);
      setResult(res);
      if (res.imported > 0) onImported();
    } catch (err) {
      setResult({ imported: 0, skipped: 0, errors: [{ row: 0, reason: String(err) }] });
    } finally {
      setImporting(false);
    }
  };

  const resetState = () => {
    setFile(null);
    setPreview([]);
    setResult(null);
  };

  const info = TAB_INFO[tab];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border border-black/[0.04]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.04]">
          <h2 className="text-lg font-bold text-foreground">Import CSV</h2>
          <button onClick={onClose} className="text-neutral-dark/40 hover:text-foreground leading-none">
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4">
          <div className="flex gap-1 p-1 bg-neutral-dark/[0.06] rounded-full w-fit">
            {(Object.keys(TAB_INFO) as ImportTab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); resetState(); }}
                className={`pill-tab ${tab === t ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                {TAB_INFO[t].label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Required columns */}
          <div className="text-xs text-neutral-dark/60">
            <span className="font-medium text-foreground">Required columns:</span> {info.columns}
          </div>

          {/* Drop zone */}
          {!file && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`flex flex-col items-center justify-center h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                dragOver ? "border-primary bg-primary/[0.06]" : "border-black/[0.06] hover:border-black/[0.12]"
              }`}
            >
              <svg className="w-8 h-8 text-neutral-dark/30 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-neutral-dark/50">
                Drag & drop CSV file or <span className="text-primary font-medium">browse</span>
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          )}

          {/* File selected */}
          {file && !result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-black/[0.02] rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-foreground truncate">{file.name}</span>
                <button onClick={resetState} className="text-xs text-neutral-dark/50 hover:text-foreground">
                  Change
                </button>
              </div>

              {/* Preview table */}
              {preview.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-black/[0.04]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-black/[0.02]">
                        {preview[0].map((h, i) => (
                          <th key={i} className="px-3 py-2 text-left font-medium text-foreground">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.slice(1, 6).map((row, ri) => (
                        <tr key={ri} className="border-t border-black/[0.04]">
                          {row.map((c, ci) => (
                            <td key={ci} className="px-3 py-1.5 text-neutral-dark/70">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-2">
              <div className="flex gap-3 text-sm">
                <span className="text-primary font-medium">{result.imported} imported</span>
                {result.skipped > 0 && (
                  <span className="text-amber-600 font-medium">{result.skipped} skipped</span>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-lg bg-red-50 p-3 text-xs text-red-700 space-y-1">
                  {result.errors.map((e, i) => (
                    <div key={i}>
                      Row {e.row}: {e.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-black/[0.04]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-neutral-dark/60 hover:text-foreground rounded-lg"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={!file || importing}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-full press-scale hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {importing ? "Importing..." : "Import"}
            </button>
          )}
          {result && result.imported > 0 && (
            <button
              onClick={resetState}
              className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-full press-scale hover:bg-primary/90"
            >
              Import Another
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

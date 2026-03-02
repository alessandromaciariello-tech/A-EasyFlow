# Execution — Script CLI

Script Python deterministici per operazioni standalone. Ogni script ha un'interfaccia CLI (argparse) e funzioni importabili.

## Prerequisiti

- Python 3.10+ (per type hints `str | None`)
- Dipendenze backend: `pip install -r backend/requirements.txt`
- Per calendar/shopify: variabili d'ambiente in `.env`
- Per DDMRP: Next.js dev server attivo (`cd frontend && npm run dev`)

## Script Disponibili

### `backup_restore.py` — Backup & Restore dati
```bash
cd execution
python backup_restore.py backup                     # backup in .tmp/backup_TIMESTAMP/
python backup_restore.py backup --output /path/dir   # backup in directory specifica
python backup_restore.py list                        # elenca backup disponibili
python backup_restore.py restore .tmp/backup_20260302_143000/  # ripristina
```

### `gantt_export.py` — Gantt Export/Import
```bash
cd execution
python gantt_export.py list                          # mostra struttura progetto
python gantt_export.py export-project                # esporta in .tmp/gantt_project.json
python gantt_export.py export-project --output f.json
python gantt_export.py import-project backup.json    # importa (sovrascrive)
python gantt_export.py export-templates              # esporta tutti i template
```

### `inventory_report.py` — Report Inventario/BOM
```bash
cd execution
python inventory_report.py production "Metal Sheet" 100   # necessità produzione
python inventory_report.py max-producible                  # max unità per prodotto
python inventory_report.py restock                         # componenti da restockare
python inventory_report.py suppliers                       # riepilogo fornitori
python inventory_report.py export-bom "Metal Sheet"        # esporta albero BOM
```

### `calendar_batch.py` — Operazioni Calendar batch
```bash
cd execution
python calendar_batch.py list                         # eventi di oggi
python calendar_batch.py list --date 2026-03-05 --days 7
python calendar_batch.py export --days 7              # esporta in JSON
python calendar_batch.py clear-easyflow --days 30     # elimina eventi EasyFlow
python calendar_batch.py schedule tasks.json          # scheduling batch da file
```

### `shopify_sync.py` — Shopify Data Sync
```bash
cd execution
python shopify_sync.py dashboard                      # esporta dashboard summary
python shopify_sync.py dashboard --days 90
python shopify_sync.py orders --days 30               # esporta ordini
python shopify_sync.py low-stock --threshold 10       # alert stock basso
python shopify_sync.py sync-inventory                 # sync Shopify → BOM
```

### `ddmrp_recalc.py` — DDMRP Control Tower CLI
```bash
cd execution
python ddmrp_recalc.py recalc                         # ricalcola tutti i profili
python ddmrp_recalc.py sync-shopify                   # sync completo 4 fasi
python ddmrp_recalc.py export-summary                 # esporta summary
python ddmrp_recalc.py alert-red                      # mostra prodotti in RED
```

## Architettura

```
execution/
├── __init__.py            # Package Python
├── common.py              # Utility condivise (paths, env, JSON/CSV export)
├── backup_restore.py      # Backup/restore file JSON
├── gantt_export.py        # Import/export Gantt (reusa backend/gantt_store.py)
├── inventory_report.py    # Report BOM (reusa backend/inventory_store.py)
├── calendar_batch.py      # Batch calendar (reusa backend/google_calendar.py)
├── shopify_sync.py        # Sync Shopify (reusa backend/shopify_client.py)
├── ddmrp_recalc.py        # DDMRP via HTTP (chiama Next.js API routes)
└── README.md
```

Gli script importano i moduli backend tramite `common.setup_backend_path()` che aggiunge `backend/` a `sys.path`. L'eccezione è `ddmrp_recalc.py` che usa HTTP verso Next.js perché il DDMRP engine è in TypeScript.

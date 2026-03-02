# DDMRP Control Tower - SOP

## Scope
Control Tower DDMRP (Demand Driven Material Requirements Planning) per:
1. Calcolo buffer dinamici (Red/Yellow/Green) basati su domanda reale
2. Net Flow Position e raccomandazioni riordino
3. Sync automatico da Shopify (prodotti, vendite, inventario)
4. Import CSV (prodotti, vendite, inventario)
5. Dashboard riassuntiva con status semaforo per ogni prodotto

## Configurazione
- **Database**: Supabase PostgreSQL via Prisma v6 + `@prisma/adapter-pg`
- **Env vars**: `DATABASE_URL` (Session Pooler, runtime), `DIRECT_URL` (Direct, CLI Prisma)
- **Schema**: `frontend/prisma/schema.prisma`
- **Frontend richiesto**: Next.js dev server su `http://localhost:3000`

## Tool di Esecuzione
- **`frontend/src/lib/ddmrp/engine.ts`**: funzioni pure di calcolo DDMRP (ADU, buffer, NFP, reorder)
- **`frontend/src/lib/ddmrp/recalc.ts`**: orchestratore ricalcolo profili (server-side, usa Prisma)
- **`frontend/src/app/api/ddmrp/*`**: 12 API routes Next.js
- **`execution/ddmrp_recalc.py`**: client CLI per trigger ricalcolo e alert

## Database — 8 Tabelle

| Tabella | Scopo | Chiave unica |
|---------|-------|--------------|
| `DdmrpProduct` | Anagrafica prodotti (SKU, nome, costi, override) | `sku` |
| `DdmrpWarehouse` | Magazzini/location | `id` |
| `DdmrpSalesDaily` | Vendite giornaliere aggregate | `[productId, date, channel]` |
| `DdmrpInventorySnapshot` | Snapshot inventario giornaliero | `[productId, warehouseId, date]` |
| `DdmrpSupplier` | Anagrafica fornitori | `id` |
| `DdmrpProductSupplier` | Link prodotto-fornitore (lead time, MOQ, pack) | `[productId, supplierId]` |
| `DdmrpProfile` | Profilo calcolato (buffer, NFP, status, raccomandazioni) | `[productId, warehouseId, asOfDate]` |
| `DdmrpSystemConfig` | Configurazione globale DDMRP | `id = "default"` |

## Formule DDMRP

### 1. ADU (Average Daily Usage)
```
ADU = media(qty giornaliere) su finestra di N giorni
Giorni senza vendite contati come 0
```

### 2. Demand Standard Deviation
```
StdDev = deviazione standard (popolazione) delle qty giornaliere
```

### 3. Buffer Zones
```
Red Base   = ADU × LeadTimeDays
Red Safety = Z × StdDev × √(LeadTimeDays)
Red        = Red Base + Red Safety
Yellow     = ADU × OrderCycleDays
Green      = ADU × GreenDays
TopOfGreen = Red + Yellow + Green
```

### 4. Net Flow Position (NFP)
```
NFP = Available + OnOrder − QualifiedDemandSpike
```

### 5. Buffer Status (semaforo)
```
Red    se NFP < Red
Yellow se Red ≤ NFP < Red + Yellow
Green  se NFP ≥ Red + Yellow
```

### 6. Raccomandazione Riordino (solo se Red/Yellow)
```
Need = TopOfGreen − NFP
Need = max(Need, MOQ)
Qty  = ceil(Need / PackSize) × PackSize
```

### 7. Risk Stockout Date
```
DaysToStockout = floor(Available / ADU)
StockoutDate   = today + DaysToStockout
```

## Config di Sistema (default)
| Parametro | Default | Descrizione |
|-----------|---------|-------------|
| `aduDefaultWindowDays` | 28 | Finestra rolling per calcolo ADU |
| `serviceLevelZ` | 1.65 | Z-score (95% service level) |
| `orderCycleDays` | 7 | Ciclo ordine (zona Yellow) |
| `greenDays` | 7 | Buffer sicurezza (zona Green) |
| `roundingRule` | "ceil" | Arrotondamento qty riordino |

### Override Per-SKU
Ogni prodotto può sovrascrivere: `aduWindowDays`, `orderCycleDays`, `greenDays`. Se null, usa il valore di sistema.

## API Routes

### Config
| Endpoint | Metodo | Scopo |
|----------|--------|-------|
| `/api/ddmrp/config` | GET | Configurazione corrente |
| `/api/ddmrp/config` | PUT | Aggiorna config |

### Prodotti
| Endpoint | Metodo | Scopo |
|----------|--------|-------|
| `/api/ddmrp/products` | GET | Lista prodotti attivi |
| `/api/ddmrp/products` | POST | Crea prodotto (sku, name) |
| `/api/ddmrp/products/[id]` | GET | Dettaglio singolo |
| `/api/ddmrp/products/[id]` | PATCH | Aggiorna prodotto |
| `/api/ddmrp/products/[id]` | DELETE | Soft-delete (active=false) |

### Dettaglio Prodotto (con storico)
| Endpoint | Metodo | Scopo |
|----------|--------|-------|
| `/api/ddmrp/product/[id]` | GET | Prodotto + storico vendite/inventario/profili (query: `days`, default 60) |

### Fornitori
| Endpoint | Metodo | Scopo |
|----------|--------|-------|
| `/api/ddmrp/suppliers` | GET/POST | Lista / crea fornitore |
| `/api/ddmrp/suppliers/[id]` | PATCH/DELETE | Aggiorna / elimina fornitore |

### Operazioni
| Endpoint | Metodo | Scopo |
|----------|--------|-------|
| `/api/ddmrp/recalc` | POST | Ricalcola tutti i profili |
| `/api/ddmrp/summary` | GET | Dashboard Control Tower (tutti i prodotti con profilo corrente) |
| `/api/ddmrp/sync-shopify` | POST | Sync 4 fasi da Shopify |

### CSV Import
| Endpoint | Metodo | Input |
|----------|--------|-------|
| `/api/ddmrp/import/products` | POST | CSV: sku, name, [unitcost], [sellprice], [category] |
| `/api/ddmrp/import/sales` | POST | CSV: date, sku, qty, [orders], [channel] |
| `/api/ddmrp/import/inventory` | POST | CSV: date, sku, onhand, [allocated], [onorder] |

## Shopify Sync (4 fasi)
1. **Prodotti**: fetch da Shopify → upsert `DdmrpProduct` per SKU (fallback nome normalizzato)
2. **Vendite**: fetch ordini 90gg (paid/authorized/partially_paid) → aggrega per data+prodotto → upsert `DdmrpSalesDaily` con channel="shopify"
3. **Inventario**: fetch stock Shopify → upsert `DdmrpInventorySnapshot` (onHand=available)
4. **Ricalcolo**: chiama `recalcAllProfiles()` per aggiornare tutti i profili

## Gestione Errori
- **Database non raggiungibile**: errore 500 con messaggio Prisma
- **SKU non trovato** (CSV import): riga skippata, registrata in `errors[]`
- **CSV malformato**: validazione riga per riga, errori dettagliati
- **Shopify non configurato**: fase sync salta con warning
- **Nessun prodotto attivo**: ricalcolo ritorna `{ recalculated: 0 }`

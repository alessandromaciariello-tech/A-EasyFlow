# Inventory & BOM - SOP

## Scope
Gestione inventario e Bill of Materials (BOM) ricorsivo per:
1. Albero prodotti > componenti con profondità illimitata
2. Fornitori con contatti
3. Workflow di restock con template riutilizzabili
4. Pianificazione produzione (needs, max producibili, bottleneck)
5. Auto-sync prodotti Shopify → BOM

## Tool di Esecuzione
- **`backend/inventory_store.py`**: CRUD prodotti/componenti/fornitori/template + calcoli produzione
- **`execution/inventory_report.py`**: report produzione, restock, fornitori da CLI

## Modello Dati

### Struttura File (`backend/inventory_data.json`)
```json
{
  "products": [
    {
      "id": "uuid8", "name": "string", "collapsed": false,
      "desired_stock": null | number,
      "children": [
        {
          "id": "uuid8", "name": "string",
          "quantity": 1, "supplier": "string",
          "unit_cost": 0.0, "quantity_in_stock": 0,
          "collapsed": false,
          "restock_workflow": null | { "phases": [...] },
          "children": [ ...ricorsivo... ]
        }
      ]
    }
  ],
  "suppliers": [
    { "name": "string", "phone": "string", "email": "string" }
  ],
  "restock_templates": [
    {
      "id": "uuid8", "name": "string",
      "phases": [
        {
          "id": "uuid8", "name": "string", "color": "#hex",
          "tasks": [
            { "id": "uuid8", "name": "string", "duration_days": 0, "duration_type": "fixed|variable" }
          ]
        }
      ]
    }
  ]
}
```

## Operazioni CRUD

### Prodotti (root level)
| Operazione | Endpoint | Dettagli |
|------------|----------|----------|
| Lista | `GET /api/inventory` | tutti i prodotti con albero completo |
| Crea | `POST /api/inventory/products` | name → nuovo prodotto vuoto |
| Aggiorna | `PATCH /api/inventory/products/{id}` | name, collapsed, desired_stock |
| Elimina | `DELETE /api/inventory/products/{id}` | rimuove prodotto e intero albero BOM |

### Componenti BOM (ricorsivi)
| Operazione | Endpoint | Dettagli |
|------------|----------|----------|
| Aggiungi figlio | `POST /api/inventory/products/{pid}/items` | parent_id, name, quantity, supplier, unit_cost, restock_workflow |
| Aggiorna | `PATCH /api/inventory/products/{pid}/items/{iid}` | qualsiasi campo |
| Elimina | `DELETE /api/inventory/products/{pid}/items/{iid}` | rimuove item e sottoalbero |

### Fornitori
| Operazione | Endpoint | Dettagli |
|------------|----------|----------|
| Lista | `GET /api/inventory/suppliers` | tutti i fornitori ordinati per nome |
| Crea | `POST /api/inventory/suppliers` | name, phone, email (deduplica per nome) |
| Aggiorna | `PATCH /api/inventory/suppliers` | name (chiave), phone, email |
| Elimina | `DELETE /api/inventory/suppliers` | per nome |

### Restock Templates
| Operazione | Endpoint | Dettagli |
|------------|----------|----------|
| Lista | `GET /api/inventory/restock-templates` | tutti i template |
| Crea | `POST /api/inventory/restock-templates` | name, phases[] |
| Aggiorna | `PATCH /api/inventory/restock-templates/{id}` | name, phases |
| Elimina | `DELETE /api/inventory/restock-templates/{id}` | hard delete |

## Calcoli Produzione

### Production Needs (`POST /api/inventory/production-check`)
- Input: `product_id`, `quantity`
- Raccoglie ricorsivamente le foglie dell'albero BOM con quantità cumulative
- Per ogni foglia calcola: needed, in_stock, missing, missing_cost
- Output: `producible` (bool), `total_missing_cost`, `max_lead_time_days`, `lines[]`

### Max Producible (`GET /api/inventory/products/{id}/max-producible`)
- Calcola foglie per quantity=1 (fabbisogno per unità)
- Per ogni foglia: `max_units = in_stock / needed_per_unit`
- `max_producible = min(max_units)` tra tutte le foglie
- Identifica il `bottleneck` (foglia limitante)

### Lead Time
- Calcolato dal `restock_workflow` del componente
- **Fasi**: parallele (il lead time è il max tra le fasi)
- **Task dentro una fase**: sequenziali (somma durate `duration_type: "fixed"`)

## Tab Stock (Frontend)
Due modalità basate sullo stato dell'inventario:

| Modalità | Condizione | Colonne |
|----------|-----------|---------|
| **Catch Up** | Alcuni componenti sotto zero o mancanti | Component, Required, Available (editabile), Missing, Exp.Costs, Supplier, Restock |
| **Next Restock** | Tutto disponibile | Component, Available (editabile), Desired, Missing, Exp.Costs, Supplier, Restock |

## Auto-sync Shopify → BOM
- Quando si caricano i prodotti Shopify, quelli senza corrispondenza nel BOM vengono importati automaticamente
- Matching per **nome normalizzato** (lowercase, trim, rimozione caratteri speciali)
- I prodotti importati sono creati vuoti (senza componenti) — l'utente aggiunge il BOM manualmente

## Migrazioni Automatiche
1. Aggiunge campo `desired_stock` ai prodotti che non lo hanno
2. Converte fornitori da `string[]` a `object[]` (`{name, phone, email}`)
3. Assicura `children[]` su tutti gli item

## Gestione Errori
- **Prodotto non trovato**: risponde 404
- **Item non trovato nell'albero**: risponde 404 (ricerca ricorsiva)
- **File JSON corrotto/mancante**: ricrea dati default vuoti

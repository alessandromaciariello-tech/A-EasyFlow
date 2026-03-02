# Gantt Chart Management - SOP

## Scope
Gestione progetto Gantt con:
1. Struttura gerarchica sezioni > task > subtask (ricorsiva, profondità illimitata)
2. Dipendenze tra task, progresso, colori, date
3. Template workflow predefiniti + custom CRUD
4. Integrazione restock da Inventory/BOM

## Tool di Esecuzione
- **`backend/gantt_store.py`**: CRUD sezioni/task/subtask con persistenza JSON
- **`backend/gantt_templates.py`**: template predefiniti + gestione custom
- **`execution/gantt_export.py`**: import/export progetto e template da CLI

## Modello Dati

### Struttura Progetto
```
Project
├── id: string (UUID 8 char)
├── name: string
└── sections: [
      ├── id, title, collapsed: bool
      └── tasks: [
            ├── id, title, duration (giorni), progress (0-100)
            ├── color (hex), startDate (YYYY-MM-DD)
            ├── collapsed: bool, dependencies: string[]
            └── children: [ ...task ricorsivi... ]
          ]
    ]
```

### Persistenza
- **File**: `backend/gantt_data.json` (fuori git)
- **ID**: UUID troncato a 8 caratteri
- **Migrazione automatica**: aggiunge `children[]`, `collapsed`, `dependencies[]` ai task legacy

## Operazioni CRUD

### Sezioni
| Operazione | Endpoint | Dettagli |
|------------|----------|----------|
| Crea | `POST /api/gantt/sections` | title → nuova sezione vuota |
| Aggiorna | `PATCH /api/gantt/sections/{id}` | title, collapsed |
| Elimina | `DELETE /api/gantt/sections/{id}` | rimuove sezione e tutti i task |

### Task
| Operazione | Endpoint | Dettagli |
|------------|----------|----------|
| Crea | `POST /api/gantt/sections/{id}/tasks` | title, duration, startDate, color |
| Crea subtask | `POST /api/gantt/sections/{sid}/tasks/{pid}/subtasks` | aggiunge figlio a qualsiasi profondità |
| Aggiorna | `PATCH /api/gantt/sections/{sid}/tasks/{tid}` | qualsiasi campo (ricerca ricorsiva nell'albero) |
| Elimina | `DELETE /api/gantt/sections/{sid}/tasks/{tid}` | rimuove task e tutto il sottoalbero |
| Duplica | `POST /api/gantt/sections/{sid}/tasks/{tid}/duplicate` | deep-copy con nuovi ID, titolo + " (copy)" |

## Sistema Template

### Template Predefiniti (6)
| ID | Nome | Categoria | Durata Totale |
|----|------|-----------|---------------|
| `metal-sheet` | Metal Sheet | Supply Chain | ~15 gg |
| `china-export` | China Export | Supply Chain | ~59 gg |
| `3d-printed` | 3D Printed | Supply Chain | ~9 gg |
| `ad-campaign` | Ad Campaign | Marketing | ~27 gg |
| `new-website` | New Website | Marketing | ~27 gg |
| `new-product` | New Product | R&D | ~35 gg |

### Formati Template
- **v1 (legacy)**: `sections[]` con task flat + campo `offset` (giorni dal giorno 0)
- **v2 (phases)**: `phases[]` — ogni fase diventa un parent task con `children[]` come step del workflow

### Applicazione Template
- v1: crea una sezione Gantt per ogni sezione del template, task con `startDate = oggi + offset`
- v2: crea una sezione con il nome del template, le fasi come parent task, i children come subtask. Colori ciclati automaticamente tra le fasi

### CRUD Custom Template
| Operazione | Endpoint | Dettagli |
|------------|----------|----------|
| Lista | `GET /api/gantt/templates` | raggruppati per categoria |
| Dettaglio | `GET /api/gantt/templates/{id}` | template singolo con sezioni/fasi |
| Crea | `POST /api/gantt/templates` | name, category, description, sections/phases |
| Aggiorna | `PUT /api/gantt/templates/{id}` | se hardcoded, viene copiato in custom store |
| Elimina | `DELETE /api/gantt/templates/{id}` | custom → hard delete, hardcoded → soft hide |

### Persistenza Template
- **`backend/gantt_custom_templates.json`**: template creati dall'utente
- **`backend/gantt_hidden_templates.json`**: ID dei template hardcoded nascosti

## Integrazione Restock (da Inventory)
- Il bottone "Restock" nell'inventario crea una sezione Gantt dal `restock_workflow` del componente
- Nome sezione: "Restock {nome componente}"
- Le fasi del workflow diventano parent task, i sotto-task diventano children

## Gestione Errori
- **Sezione non trovata**: risponde 404
- **Task non trovato nell'albero**: risponde 404 (ricerca ricorsiva)
- **Template non trovato**: risponde 404
- **File JSON corrotto**: ricarica progetto default vuoto

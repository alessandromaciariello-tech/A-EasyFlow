# Directives — Indice SOP

Ogni file in questa cartella è una SOP (Standard Operating Procedure) che documenta un sottosistema di EasyFlow. Le direttive servono da riferimento per l'agente AI (livello Orchestrazione) e per gli sviluppatori.

## Elenco Direttive

| File | Sottosistema | Descrizione |
|------|--------------|-------------|
| [calendar-scheduling.md](calendar-scheduling.md) | Calendar & Scheduling | Google Calendar OAuth2, scheduling intelligente con finestre Deep Work/Noise |
| [chat-ai-parsing.md](chat-ai-parsing.md) | Chat AI Parsing | Claude NLP per estrazione task strutturate da linguaggio naturale italiano |
| [gantt-management.md](gantt-management.md) | Gantt Chart | Task tree ricorsivo, sezioni, dipendenze, template predefiniti e custom |
| [inventory-bom.md](inventory-bom.md) | Inventory & BOM | BOM ricorsivo, fornitori, restock workflow, pianificazione produzione |
| [shopify-integration.md](shopify-integration.md) | Shopify Integration | Dashboard e-commerce, suggerimenti AI basati su trend vendite |
| [ddmrp-control-tower.md](ddmrp-control-tower.md) | DDMRP Control Tower | Buffer management, Shopify sync, CSV import, dashboard semaforo |

## Struttura di una Direttiva

Ogni SOP segue la struttura:
1. **Scope** — cosa fa il sottosistema
2. **Autenticazione/Configurazione** — setup iniziale richiesto
3. **Tool di Esecuzione** — file backend/execution coinvolti
4. **Policy/Regole** — logica di business, vincoli
5. **API Endpoints** — tabella riepilogativa
6. **Gestione Errori** — casi limite e fallback

## Principi
- Le direttive sono **documenti vivi**: aggiornale quando scopri vincoli, approcci migliori, errori comuni
- Non creare/sovrascrivere direttive senza chiedere, a meno che non sia esplicitamente richiesto
- Ogni direttiva specifica i tool in `execution/` e `backend/` da usare

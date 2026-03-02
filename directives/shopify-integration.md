# Shopify Integration - SOP

## Scope
Integrazione Shopify Admin REST API con EasyFlow per:
1. Dashboard e-commerce (vendite, inventario, clienti)
2. Suggerimenti AI per modifiche durate task Gantt basati su trend vendite

## Autenticazione
- **Metodo**: Admin API access token (Custom App)
- **Header**: `X-Shopify-Access-Token`
- **API Version**: 2024-10
- **Scopes richiesti**: `read_orders`, `read_products`, `read_inventory`, `read_customers`

### Setup Credenziali
1. Shopify Admin → Settings → Apps and sales channels → Develop apps
2. Creare nuova app "EasyFlow Integration"
3. Configurare Admin API scopes (vedi sopra)
4. Installare l'app, copiare l'Admin API access token
5. Incollare in `.env` come `SHOPIFY_ACCESS_TOKEN`
6. Impostare `SHOPIFY_SHOP_URL` con il dominio del negozio (es. `my-store.myshopify.com`)

## Tool di Esecuzione
- **`backend/shopify_client.py`**: wrapper API Shopify (ordini, prodotti, inventario, clienti, aggregazioni)
- **`backend/shopify_analyzer.py`**: analisi AI trend + suggerimenti modifiche Gantt

## Policy Refresh Dati
- Dashboard: fetch on-demand quando l'utente apre il tab Shopify
- Trend: fetch quando l'utente richiede analisi AI
- Nessun polling in background
- Nessuna cache (rate limit Shopify generoso: 2 req/sec bucket leaky)

## Regole Suggerimenti AI
1. I suggerimenti NON vengono mai applicati automaticamente
2. L'AI confronta periodo corrente vs precedente (default: 7gg vs 7gg)
3. Focus su task supply chain del Gantt:
   - Adattamento durate spedizione
   - Estensione timeline produzione
   - Modifiche periodi controllo qualità
4. Ogni suggerimento include motivazione basata su dati concreti (percentuali, trend)
5. L'utente clicca "Applica" per confermare ogni singola modifica

## Endpoint API Shopify Utilizzati
| Endpoint | Scopo |
|----------|-------|
| `GET /admin/api/{v}/shop.json` | Info negozio, verifica connessione |
| `GET /admin/api/{v}/orders.json` | Ordini con filtri e paginazione |
| `GET /admin/api/{v}/orders/count.json` | Conteggio ordini (leggero) |
| `GET /admin/api/{v}/products.json` | Prodotti con varianti |
| `GET /admin/api/{v}/customers.json` | Clienti con filtri |
| `GET /admin/api/{v}/customers/count.json` | Conteggio clienti |
| `GET /admin/api/{v}/locations.json` | Location inventario |
| `GET /admin/api/{v}/inventory_levels.json` | Livelli stock |

## Gestione Errori
- **Credenziali mancanti**: mostra istruzioni setup nella dashboard
- **Rate limit (429)**: retry dopo 1 secondo (gestito in `shopify_client.py`)
- **Errori rete**: messaggio friendly all'utente
- **Scopes insufficienti**: messaggio specifico su quali permessi mancano

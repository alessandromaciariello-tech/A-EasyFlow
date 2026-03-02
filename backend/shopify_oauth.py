"""
Script per ottenere un Shopify Admin API access token via OAuth.
Uso: python shopify_oauth.py

1. Apre il browser per autorizzare l'app
2. Riceve il callback con il codice
3. Scambia il codice per un access token permanente
4. Stampa il token da copiare nel .env
"""

import http.server
import os
import urllib.parse
import webbrowser
import requests
import sys

# ====== CONFIGURA QUESTI VALORI ======
CLIENT_ID = os.environ.get("SHOPIFY_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("SHOPIFY_CLIENT_SECRET", "")  # Set in .env
SHOP = os.environ.get("SHOPIFY_SHOP_URL", "desmerk.myshopify.com")
SCOPES = "read_orders,read_products,read_inventory,read_customers,read_fulfillments,read_shipping"
REDIRECT_URI = "http://localhost:8000/api/shopify/callback"
# =====================================

if not CLIENT_SECRET:
    print("\n❌ Devi inserire il CLIENT_SECRET nello script!")
    print("   Apri shopify_oauth.py e incolla il segreto nella variabile CLIENT_SECRET")
    print("   Lo trovi nella Dev Dashboard → EasyFlow → Impostazioni → Segreto (clicca l'icona occhio)")
    sys.exit(1)


class OAuthHandler(http.server.BaseHTTPRequestHandler):
    """Handler che cattura il callback OAuth di Shopify."""

    access_token = None

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/shopify/callback":
            params = urllib.parse.parse_qs(parsed.query)
            code = params.get("code", [None])[0]

            if code:
                # Scambia il codice per un access token
                token_url = f"https://{SHOP}/admin/oauth/access_token"
                resp = requests.post(token_url, json={
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                    "code": code,
                })

                if resp.status_code == 200:
                    data = resp.json()
                    OAuthHandler.access_token = data.get("access_token")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(b"""
                        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
                        <h1 style="color:green">Token ottenuto!</h1>
                        <p>Puoi chiudere questa finestra e tornare al terminale.</p>
                        </body></html>
                    """)
                else:
                    self.send_response(500)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(f"Errore: {resp.text}".encode())
            else:
                self.send_response(400)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"Errore: nessun codice ricevuto")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Silenzia i log HTTP


def main():
    print("\n🔐 Shopify OAuth - Ottenimento Access Token")
    print("=" * 50)
    print(f"   Shop: {SHOP}")
    print(f"   Client ID: {CLIENT_ID}")
    print(f"   Scopes: {SCOPES}")
    print()

    # Avvia server temporaneo sulla porta 8000
    # IMPORTANTE: assicurati che il backend FastAPI NON sia in esecuzione!
    print("⚠️  Assicurati che il backend FastAPI NON sia in esecuzione sulla porta 8000!")
    print()

    server = http.server.HTTPServer(("localhost", 8000), OAuthHandler)

    # Costruisci URL di autorizzazione
    auth_url = (
        f"https://{SHOP}/admin/oauth/authorize"
        f"?client_id={CLIENT_ID}"
        f"&scope={SCOPES}"
        f"&redirect_uri={urllib.parse.quote(REDIRECT_URI)}"
    )

    print("📱 Apertura browser per autorizzazione...")
    print(f"   URL: {auth_url}\n")
    webbrowser.open(auth_url)

    print("⏳ In attesa del callback da Shopify...")
    print("   (autorizza l'app nel browser)\n")

    # Gestisci una sola richiesta (il callback)
    server.handle_request()

    if OAuthHandler.access_token:
        token = OAuthHandler.access_token
        print("✅ ACCESS TOKEN OTTENUTO!")
        print("=" * 50)
        print(f"\n   {token}\n")
        print("=" * 50)
        print("\nCopia questo token nel file .env:")
        print(f"   SHOPIFY_SHOP_URL={SHOP}")
        print(f"   SHOPIFY_ACCESS_TOKEN={token}")
        print(f"   SHOPIFY_API_VERSION=2024-10")
        print("\nPoi riavvia il backend con: uvicorn main:app --reload")
    else:
        print("❌ Errore: nessun token ricevuto")

    server.server_close()


if __name__ == "__main__":
    main()

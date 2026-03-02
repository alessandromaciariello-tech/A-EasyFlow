Ruolo: Agisci come Full-Stack Developer Senior esperto in integrazioni API e sistemi di scheduling intelligente.
Obiettivo: Crea un'applicazione web (React + Node.js) che funga da Project Manager basato su chat con integrazione Google Calendar.

1. Architettura Tecnica
Frontend: React con Tailwind CSS. Layout a due colonne (Split View).

Backend: Node.js con Express.

Integrazione: Google Calendar API (OAuth2) per lettura/scrittura eventi.

AI Engine: Integrazione con LLM (es. Claude API) per il parsing dei messaggi naturali in JSON strutturato.

2. Il Motore di Scheduling (Business Logic)
L'app deve smistare le task secondo questa gerarchia di regole:

Definizione Slot Temporali:

Deep Work Window: 09:00 - 13:30.

Noise Window: 14:30 - 20:00.

Logica dei Tag:

ASAP (Qualsiasi tipo): Priorità massima. Cerca il primo slot libero assoluto a partire dall'orario attuale. Se una task è ASAP + Noise, ignora la restrizione pomeridiana e inseriscila anche nella finestra mattutina.

Normal + Deep Work: Cerca il primo slot libero esclusivamente tra le 09:00 e le 13:30.

Normal + Noise: Cerca il primo slot libero esclusivamente tra le 14:30 e le 20:00.

3. Requisiti dell'Interfaccia (UI/UX)
Il layout deve essere diviso verticalmente:

Lato Sinistro: AI Chat Interface

Area di input per testo naturale.

Messaggi del chatbot che confermano l'analisi dei tag (es: "Ho capito: Task 'Report', Urgenza: ASAP, Tipo: Deep Work").

Toggle manuali o dropdown per correggere i tag estratti prima della conferma definitiva.

Lato Destro: Dashboard Attività

Tab Daily: Visualizzazione verticale (stile Google Calendar) della giornata odierna.

Tab Weekly: Visualizzazione della settimana.

Task Card: Ogni blocco deve mostrare il titolo, l'orario e due badge colorati per i tag (es. Rosso per ASAP, Blu per Deep Work, Grigio per Noise).

4. Flusso di Lavoro dell'Agente (Step-by-Step)
Analisi Input: L'utente scrive "Devo chiamare il fornitore, è Noise ma facciamolo ASAP".

Parsing: L'AI estrae: { "title": "Chiamata fornitore", "urgency": "ASAP", "type": "Noise", "duration": 30 }.

Verifica Disponibilità: L'app interroga l'API di Google Calendar per trovare i "free spots" che rispettano le finestre temporali e la priorità ASAP.

Esecuzione: L'app inserisce l'evento su Google Calendar e aggiorna istantaneamente la Dashboard a destra.

5. Istruzioni di Avvio per Claude Code
Inizia configurando il boilerplate del progetto con Vite (React + TS).

Implementa il sistema di autenticazione Google OAuth2.

Scrivi la funzione findNextAvailableSlot(taskType, urgency, duration) che implementa la logica sopra descritta.

Crea i componenti UI per la dashboard assicurandoti che siano sincronizzati con i dati del Calendar.
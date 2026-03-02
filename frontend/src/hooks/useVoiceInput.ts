"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface VoiceCommands {
  type: "deep_work" | "noise" | null;
  urgency: "asap" | "normal" | null;
  duration: number | null;
  cleanText: string;
}

/**
 * Parsa il testo trascritto per estrarre comandi vocali (tag, urgenza, durata)
 * e restituisce il testo "pulito" senza i comandi riconosciuti.
 */
export function parseVoiceCommands(transcript: string): VoiceCommands {
  let text = transcript.toLowerCase();
  let type: VoiceCommands["type"] = null;
  let urgency: VoiceCommands["urgency"] = null;
  let duration: VoiceCommands["duration"] = null;

  // --- Tipo ---
  if (/\bdeep\s*work\b/.test(text)) {
    type = "deep_work";
    text = text.replace(/\bdeep\s*work\b/, "");
  } else if (/\bnoise\b/.test(text)) {
    type = "noise";
    text = text.replace(/\bnoise\b/, "");
  }

  // --- Urgenza ---
  if (/\basap\b/.test(text)) {
    urgency = "asap";
    text = text.replace(/\basap\b/, "");
  } else if (/\bto[\s-]?do\b/.test(text)) {
    urgency = "normal";
    text = text.replace(/\bto[\s-]?do\b/, "");
  }

  // La durata NON viene estratta dalla voce — resta nel testo
  // per permettere all'AI di assegnarla alla task corretta.
  // (Es: "30 minuti di tragitto" → la durata è solo per il tragitto, non per tutte le task)

  // Pulisci il testo: rimuovi virgole/spazi extra
  const cleanText = text
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();

  return { type, urgency, duration, cleanText };
}

export interface UseVoiceInputReturn {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
}

export function useVoiceInput(
  onResult: (commands: VoiceCommands) => void
): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef("");
  const stoppedByUserRef = useRef(false);
  const retryCountRef = useRef(0);

  useEffect(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognitionAPI);
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    // Se c'è già una sessione attiva, fermala prima
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    setError(null);

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "it-IT";

    finalTranscriptRef.current = "";
    stoppedByUserRef.current = false;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let accumulated = "";
      let interim = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          accumulated += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }

      finalTranscriptRef.current = accumulated.trim();
      setTranscript((accumulated + interim).trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return;

      if (event.error === "network") {
        // Auto-retry fino a 3 volte su errore network con delay crescente
        if (retryCountRef.current < 3) {
          const delay = 500 * (retryCountRef.current + 1);
          retryCountRef.current++;
          recognitionRef.current = null;
          setTimeout(() => startListening(), delay);
          return;
        }
        // Se tutti i retry falliscono, mostra messaggio utile
        setError(
          window.location.hostname !== "localhost"
            ? "Errore di rete: apri l'app da http://localhost:3000 (non 127.0.0.1)"
            : "Errore di rete: verifica la connessione internet e usa Chrome"
        );
      } else if (event.error === "not-allowed") {
        setError("Permesso microfono negato. Abilitalo nelle impostazioni del browser.");
      } else {
        setError(`Errore microfono: ${event.error}`);
      }

      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;

      const text = finalTranscriptRef.current;
      if (stoppedByUserRef.current && text) {
        const commands = parseVoiceCommands(text);
        onResult(commands);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onResult]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      stoppedByUserRef.current = true;
      recognitionRef.current.stop();
    }
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      retryCountRef.current = 0;
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    isSupported,
    transcript,
    error,
    startListening,
    stopListening,
    toggleListening,
  };
}

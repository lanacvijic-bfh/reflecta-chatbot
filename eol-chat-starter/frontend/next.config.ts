import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Die Warnung über mehrere lockfiles entsteht, weil Next.js mehrere package-lock.json Dateien findet:
  // - C:\Users\denis\package-lock.json (im Home-Verzeichnis)
  // - Projekt-Root und Frontend-Verzeichnis
  // 
  // Lösung: Entfernen Sie die package-lock.json im Home-Verzeichnis, falls sie nicht benötigt wird,
  // oder ignorieren Sie die Warnung - sie ist harmlos und beeinträchtigt die Funktionalität nicht.
  
  // Headers für CSP (Content Security Policy) - entfernt, da Blob-URLs standardmäßig erlaubt sind
  // Falls CSP-Probleme auftreten, können wir sie hier konfigurieren
};

export default nextConfig;

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function ConsentModal() {
  const [showModal, setShowModal] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);

  useEffect(() => {
    // Prüfe ob Consent bereits gegeben wurde
    if (typeof window !== "undefined") {
      const hasConsent = localStorage.getItem("dataConsent");
      if (!hasConsent) {
        setShowModal(true);
      } else {
        setConsentGiven(true);
      }
    }
  }, []);

  const handleAccept = () => {
    if (!consentGiven) {
      return; // Button ist deaktiviert wenn Checkbox nicht angekreuzt
    }
    
    if (typeof window !== "undefined") {
      localStorage.setItem("dataConsent", "true");
      localStorage.setItem("dataConsentDate", new Date().toISOString());
      setShowModal(false);
    }
  };

  if (!showModal) {
    return null;
  }

  return (
    <div className="consent-overlay">
      <div className="consent-modal">
        <h2>Datenschutz und Einverständnis</h2>
        <div className="consent-content">
          <p>Diese Anwendung verarbeitet Ihre Eingaben lokal und sendet sie an einen KI-Service zur Generierung von Antworten.</p>
          <ul>
            <li>Ihre Daten werden nur für die Gesprächsführung verwendet</li>
            <li>Die Daten werden nicht an Dritte weitergegeben</li>
            <li>Sie können Ihre Einwilligung jederzeit widerrufen</li>
            <li>Weitere Details finden Sie in unseren AGB</li>
          </ul>
          <p>Bitte lesen Sie die Allgemeinen Geschäftsbedingungen (AGB) und stimmen Sie der Datenverarbeitung zu.</p>
        </div>
        <div className="consent-checkbox">
          <label>
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
            />
            <span>
              Ich habe die <Link href="/agb" target="_blank" rel="noopener noreferrer" className="consent-link">AGB</Link> gelesen und stimme zu
            </span>
          </label>
        </div>
        <div className="consent-actions">
          <button
            type="button"
            onClick={handleAccept}
            disabled={!consentGiven}
            className="consent-accept-btn"
          >
            Akzeptieren
          </button>
        </div>
      </div>
    </div>
  );
}


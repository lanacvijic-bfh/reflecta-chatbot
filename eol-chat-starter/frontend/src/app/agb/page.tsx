"use client";

import Link from "next/link";

export default function AGBPage() {
  return (
    <div style={{ 
      maxWidth: '900px', 
      margin: '0 auto', 
      padding: '40px 20px',
      lineHeight: '1.6',
      color: '#1f2937'
    }}>
      <h1 style={{ 
        fontSize: '32px', 
        marginBottom: '24px',
        color: '#0f172a'
      }}>
        Allgemeine Geschäftsbedingungen (AGB)
      </h1>
      
      <div style={{ marginBottom: '32px' }}>
        <Link 
          href="/" 
          style={{ 
            color: '#0ea5e9',
            textDecoration: 'underline'
          }}
        >
          Zurück zur Anwendung
        </Link>
      </div>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#1e40af' }}>
          1. Datenschutz und Datenverarbeitung
        </h2>
        <p style={{ marginBottom: '12px' }}>
          Diese Anwendung verarbeitet Ihre Eingaben, um Ihnen personalisierte Gesprächsführung zu ermöglichen. Ihre Daten werden wie folgt behandelt:
        </p>
        <ul style={{ marginLeft: '24px', marginBottom: '12px' }}>
          <li style={{ marginBottom: '8px' }}>
            Ihre Eingaben werden an einen KI-Service (OpenAI oder Azure OpenAI) gesendet, um Antworten zu generieren
          </li>
          <li style={{ marginBottom: '8px' }}>
            Die Daten werden nicht dauerhaft auf externen Servern gespeichert
          </li>
          <li style={{ marginBottom: '8px' }}>
            Sie können Ihre Daten jederzeit lokal exportieren oder löschen
          </li>
          <li style={{ marginBottom: '8px' }}>
            Keine Weitergabe Ihrer Daten an Dritte
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#1e40af' }}>
          2. Verwendung der Anwendung
        </h2>
        <p style={{ marginBottom: '12px' }}>
          Diese Anwendung dient der persönlichen Reflexion und ist nicht als medizinische, rechtliche oder therapeutische Beratung zu verstehen.
        </p>
        <p style={{ marginBottom: '12px' }}>
          Sie verwenden die Anwendung auf eigene Verantwortung. Bei medizinischen, rechtlichen oder anderen fachlichen Fragen wenden Sie sich bitte an entsprechende Fachpersonen.
        </p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#1e40af' }}>
          3. Haftungsausschluss
        </h2>
        <p style={{ marginBottom: '12px' }}>
          Die Anwendung wird "wie besehen" bereitgestellt. Wir übernehmen keine Haftung für die Richtigkeit, Vollständigkeit oder Aktualität der generierten Inhalte.
        </p>
        <p style={{ marginBottom: '12px' }}>
          Die Anwendung ersetzt keine professionelle Beratung durch Ärztinnen, Ärzte, Juristinnen, Juristen oder andere Fachpersonen.
        </p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#1e40af' }}>
          4. Änderungen der AGB
        </h2>
        <p style={{ marginBottom: '12px' }}>
          Wir behalten uns vor, diese AGB jederzeit zu ändern. Änderungen werden auf dieser Seite veröffentlicht.
        </p>
        <p style={{ marginBottom: '12px' }}>
          Durch die weitere Nutzung der Anwendung nach Änderungen stimmen Sie den aktualisierten Bedingungen zu.
        </p>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#1e40af' }}>
          5. Kontakt
        </h2>
        <p style={{ marginBottom: '12px' }}>
          Bei Fragen zu diesen AGB oder zur Datenverarbeitung kontaktieren Sie bitte den Anbieter dieser Anwendung.
        </p>
      </section>

      <section style={{ 
        marginBottom: '32px',
        padding: '16px',
        backgroundColor: '#f1f5f9',
        borderRadius: '8px',
        border: '1px solid #e2e8f0'
      }}>
        <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#1e40af' }}>
          6. Widerruf der Einwilligung
        </h2>
        <p style={{ marginBottom: '12px' }}>
          Sie können Ihre Einwilligung zur Datenverarbeitung jederzeit widerrufen, indem Sie auf der Hauptseite auf "Einwilligung widerrufen" klicken.
        </p>
      </section>

      <div style={{ 
        marginTop: '40px',
        padding: '16px',
        backgroundColor: '#fef3c7',
        borderRadius: '8px',
        border: '1px solid #fbbf24'
      }}>
        <p style={{ margin: 0, fontSize: '14px', color: '#92400e' }}>
          <strong>Stand:</strong> {new Date().toLocaleDateString('de-DE', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}
        </p>
      </div>

      <div style={{ marginTop: '32px' }}>
        <Link 
          href="/" 
          style={{ 
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#0ea5e9',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '8px',
            fontWeight: '500'
          }}
        >
          Zurück zur Anwendung
        </Link>
      </div>
    </div>
  );
}

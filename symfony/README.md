# plandito mit Symfony

plandito plant Dienste fortlaufend. Die bisherige lokale Planung liegt weiterhin in `var/teamplaner.sqlite`. Neue Organisationen erhalten je eine eigene Datenbank in `var/tenants/`; Organisationen und Jahresabos stehen in `var/platform.sqlite`. Die Datenbankdateien und Zugangsdaten müssen ausserhalb des Web-Document-Roots bleiben. Das Logo liegt als `public/assets/plandito-logo.png` vor.

## Lokal starten

Voraussetzungen: PHP 8.2 oder neuer mit SQLite, mbstring und den Symfony-Pflicht-Erweiterungen sowie Composer.

```sh
cd symfony
./bin/serve-local
```

Danach `http://127.0.0.1:8877/` öffnen. Läuft der Teamplaner bereits auf diesem Port, meldet das Skript die Adresse und startet keine zweite Instanz. Zum Beenden eines im Terminal gestarteten Servers `Ctrl+C` drücken.

Die Abhängigkeiten sind in dieser lokalen Installation schon vorhanden. Bei einer neuen Installation zuerst `./bin/composer-local install` ausführen. `./bin/php-local` und `./bin/composer-local` verwenden auf diesem Mac die lokal vorbereitete ICU-Bibliothek, weil der normale `php`-Befehl hier derzeit nicht startet. Auf anderen Rechnern nutzen die Skripte eine funktionsfähige PHP-Installation.

Der vorbereitete lokale Admin-Zugang steht in `var/first-login.txt`. Die anfänglichen persönlichen Zugangsdaten der bestehenden Mitarbeitenden stehen in `var/employee-logins.txt`. Beide Dateien sowie `.env.local` und die Datenbanken sind ignoriert und gehören nicht ins Git-Repository. Der gemeinsame Benutzer `ansicht` existiert nicht mehr. Für die bestehende lokale Planung muss `LEGACY_TENANT_ENABLED=1` und `ADMIN_PASSWORD_HASH` gesetzt sein. Bei einer neuen Installation bleibt der Legacy-Zugang deaktiviert. `APP_SECRET` ist immer erforderlich.

Bei einer neuen Installation oder nach dem Hinzufügen von Personen ohne Login erstellt `./bin/php-local bin/console teamplaner:bootstrap-logins` fehlende Mitarbeiterkonten und ergänzt `var/employee-logins.txt`. Der Befehl ändert vorhandene Konten nicht. Im Admin-Dialog einer Person kann man den Benutzernamen einrichten oder das Passwort zurücksetzen. Nach dem Hinzufügen einer Person führt die Oberfläche direkt zu diesen Login-Feldern. Für bestehende Konten bleibt das Passwort erhalten, wenn das Passwortfeld leer ist.

## Rollen und Tausch

- **Admin:** Team bearbeiten, einen neuen Monat planen, eine Dienstzelle per Drag-and-drop auf eine andere Person **am selben Tag** ziehen, Dienste zuweisen oder löschen sowie Tausch-Anträge genehmigen und ablehnen.
- **Mitarbeitende:** Jede Person hat einen eigenen Benutzernamen und ein eigenes Passwort. Sie kann den Plan ansehen, drucken, als CSV exportieren und einen Tausch-Antrag **nur aus ihrer eigenen Zeile** stellen. Der Server prüft die Zuordnung auch bei direkten API-Anfragen.
- Mit der Monatsauswahl oder den Pfeilen können beide Rollen beliebig zwischen Monaten wechseln. Bereits gespeicherte Monate bleiben erhalten und werden beim nächsten Aufruf wieder geladen.
- Die erste Planung erstellt zwei Monate. Danach plant der Admin einen noch leeren Folgemonat mit dem gespeicherten Vormonat als fester Vorgabe. Dessen Dienste zählen zur gemeinsamen Zweimonats-Pensumbilanz; seine freien Wochenenden werden berücksichtigt. Ein bereits gespeicherter Monat kann mit **Erneut planen** neu geplant werden, solange er noch nicht begonnen hat. Andere Monate bleiben dabei erhalten.
- Wird ein Dienst gelöscht, bleibt der Monat gespeichert. Tage, die ihr Tagespensum oder ihren Dienstschlüssel nicht erfüllen, erscheinen rot. Admins können einen fehlenden Dienst über eine freie Zelle nachbesetzen.
- Jeder Tausch benennt eine Ersatzperson und verlangt die Bestätigung, dass die Absprache bereits erfolgt ist. Diese Angabe wird vom Antragsteller bestätigt; die Anwendung prüft die Zustimmung der Ersatzperson nicht selbst.
- F↔T und frei↔T funktionieren als Tausch am selben Tag. Ein Antrag ändert den Plan erst nach Genehmigung durch den Admin.
- Der Server verhindert Dienste in den Ferien und ungültige Zuweisungen. Ein Plan wird auch bei zu wenig Personal erstellt; unbesetzte Tage bleiben rot, bis Dienste nachbesetzt werden. Weniger als zwei komplett freie Wochenenden pro Monat sind bei Zuweisungen und Tauschen erlaubt, werden aber in der Stundenbilanz rot markiert.

## Arbeitszeitmodell

Unter **Arbeitszeitmodell → Einstellungen** konfiguriert jede Organisation ihr Vollpensum in Wochenstunden (0,25 bis 80, in Viertelstunden), die Wochentage für die Sollzeit und eine eigene Liste von Feiertagen. Die bisherigen 42 Stunden von Montag bis Freitag bleiben für bestehende und neue Organisationen die Voreinstellung. Die Wochenstunden verteilen sich gleichmässig auf die gewählten Solltage; diese bestimmen keine Einsatzverbote. Die benötigte Besetzung wird separat konfiguriert.

Eine Person kann entweder ihr Prozentpensum verwenden oder **feste Wochenstunden** hinterlegen. Feste Stunden ersetzen bei der Berechnung das Prozentpensum. Ferien an Solltagen werden mit der entsprechenden täglichen Sollzeit gutgeschrieben. Feiertage reduzieren die Sollzeit und verbrauchen keine Ferientage; sie ändern nicht automatisch die Besetzung. Ein geschlossener Feiertag benötigt deshalb zusätzlich eine Tagesausnahme mit Tagespensum 0 und leerem Dienstschlüssel. Feiertagsdaten werden ausdrücklich erfasst, es gibt keinen automatischen regionalen Feiertagsimport.

Die Bilanz und die rollende Planung verwenden weiterhin zwei Monate. Änderungen am Arbeitszeitmodell, den individuellen Vertragsstunden oder Dienstdauern berechnen auch die angezeigten Bilanzen gespeicherter Monate neu. Es gibt noch keine zeitlich versionierten Vertragsmodelle. Gespeicherte Zuweisungen werden durch eine Regeländerung nicht automatisch neu verteilt.

## Freie Diensttypen

F, T und S mit je 8 h 24 min sowie KF, KS und TFS bleiben als veränderbare Startvorlage erhalten. Es gibt keine vorgeschriebenen Kürzel, Grunddienste oder festen Dauern mehr. Organisationen können 1 bis 30 eigene Diensttypen mit Kürzel, Bezeichnung, Farbe und Arbeitsdauer von 15 bis 1440 Minuten verwenden. Ein verwendetes Kürzel bleibt unveränderlich; ein unbenutzter Diensttyp kann entfernt werden. Referenzen in gespeicherten Plänen, Präferenzen, Besetzungsvorgaben und anderen Diensttypen verhindern das Löschen.

Beginn und Ende sind optional. Werden beide erfasst, berechnet sich die Arbeitsdauer aus der Zeitspanne abzüglich der unbezahlten Pause. Ein Ende vor oder auf dem Beginn bezeichnet den Folgetag. Ohne Uhrzeiten wird die Arbeitsdauer direkt eingegeben. Die Anwendung prüft bekannte Zeitüberschneidungen und verhindert, dass ein Nachtdienst in Ferien am Folgetag hineinreicht. Dienste ohne Uhrzeiten können nicht auf zeitliche Überschneidungen geprüft werden. Es bleibt bei höchstens einem Dienst pro Person und Startdatum; mehrere getrennte Einsätze pro Tag und konfigurierbare Ruhezeitregeln sind noch nicht enthalten.

Jeder Diensttyp kann im Dienstschlüssel verlangt werden. Optional kann ein nicht bereits für seinen eigenen Schlüssel benötigter Dienst einen anderen Diensttyp ganz oder halb ersetzen. Der **Anteil am Tagespensum** (0, 0,5 oder 1) wird getrennt von der Arbeitsdauer eingestellt. Die Automatik erstellt den angeforderten Dienstmix, ergänzt ihn bei Bedarf bis zum Tagespensum und verbessert die Verteilung anhand der tatsächlichen Arbeitsminuten. Sie garantiert keine mathematisch optimale oder immer exakte Stundenbilanz; verbleibende Salden werden angezeigt. Der CSV-Export enthält je konfiguriertem Diensttyp eine Spalte mit den zugewiesenen Namen.

## Besetzung und Wochenmuster

Unter **Besetzung → Wochenmuster** legt der Admin das Standard-Tagespensum und den Dienstschlüssel fest, zum Beispiel `5` und `F,F,T,T,S`. Für jeden Wochentag kann eine eigene wiederkehrende Vorgabe hinterlegt werden. „Standard“ übernimmt die allgemeinen Werte; Tagespensum `0` mit leerem Dienstschlüssel bedeutet geschlossen.

Die Priorität lautet: **Tagesausnahme → Wochenmuster → Standard**. Über eine Zelle in der Zeile **Besetzung** lässt sich weiterhin eine einzelne Tagesausnahme speichern. Ein leerer Dienstschlüssel verlangt keinen bestimmten Mix; die Automatik nutzt für ergänzende Dienste den Standardmix als Orientierung. Das Zurücksetzen einer Tagesausnahme aktiviert wieder das Wochenmuster beziehungsweise den Standard. Regeln wirken sofort auf die Besetzungsprüfung, während bereits gespeicherte Dienste erhalten bleiben. Zum Neuverteilen eines zukünftigen Monats dient **Erneut planen**.

Arbeitszeitmodell und Wochenmuster werden je Organisation gespeichert und beim erneuten Laden wiederhergestellt. Alte Daten ohne diese Felder erhalten die bisherigen Standardwerte. **Einstellungen ein-/ausblenden** blendet die linke Spalte aus; die Auswahl bleibt im Browser gespeichert. Im CSV stehen Ist, Soll und Dienstschlüssel je Tag, entsprechend der wirksamen Vorgabe.

## Prüfungen

```sh
# Im symfony-Verzeichnis
./bin/php-local tests/tenant-isolation.php
./bin/php-local tests/generic-rules.php
./bin/php-local bin/console lint:twig templates/teamplaner/index.html.twig

# Im übergeordneten Projektverzeichnis
node --test tests/symfony-solver.test.mjs
```

Die Prüfungen decken unter anderem Mandantentrennung, Erhalt alter Daten, Wochenmuster und Tagesausnahmen, individuelle Sollstunden, Feiertage, gemischte Dienstdauern, rollende Planung sowie Nachtdienste und Feriengrenzen ab.

## Organisationen und Jahresabo

- Der Betreiber meldet sich unter `/manager/login` mit einem eigenen Managerkonto an. Ein erstes Konto wird mit `./bin/php-local bin/console teamplaner:manager:create` angelegt. Der Befehl schreibt das zufällige Passwort **einmalig** in die ignorierte Datei `var/manager-first-login.txt` mit Dateirechten `0600`. Diese Datei nach sicherer Übernahme der Zugangsdaten entfernen. Managerkonten sind von Organisations-Admins getrennt.
- Unter `/manager` sieht der Betreiber alle registrierten Mandanten mit Kontakt, Abo-Laufzeit und Aktiv/Inaktiv-Status. Er kann Mandanten anlegen und nach externer Zahlungsprüfung mit einer eindeutigen Rechnungsreferenz ein Jahr freischalten oder verlängern.
- Jede Organisation erhält ihre eigene Login-URL `/<kürzel>`, zum Beispiel `/beha`. Dort melden sich Admins als `admin` und Mitarbeitende nur mit ihrem persönlichen Benutzernamen an. Die Mandantenliste enthält den direkten Link. Im Managerbereich lässt sich das Admin-Passwort bei Bedarf neu setzen. Beim Abmelden erscheint wieder die Login-Seite derselben Organisation.
- Unter `/registrieren` legt eine Organisation ihr Kürzel, ihren Namen, eine Kontakt-E-Mail und ein Admin-Passwort fest. Die Anmeldung erfolgt anschliessend über `/<kürzel>`.
- Eine Registrierung beginnt mit dem Status **Freischaltung ausstehend**. Bis zur Freischaltung kann die Organisation ihren Plan lesen, aber nichts ändern. Es gibt derzeit **keine Onlinezahlung und keine automatische Rechnung**.
- Der Betreiber prüft die Bestellung/Zahlung ausserhalb der Anwendung. `./bin/php-local bin/console teamplaner:tenants` listet Registrierungen. `./bin/php-local bin/console teamplaner:activate-annual KÜRZEL RECHNUNGSREFERENZ` schaltet genau ein Jahr frei; eine vorzeitige Verlängerung wird an das laufende Enddatum angehängt. Dieselbe Referenz ist idempotent und kann keine zweite Verlängerung auslösen.
- Jede Organisation besitzt eine eigene SQLite-Datei mit Team, Plan, Konten und Tausch-Anträgen. API-Zugriffe verwenden ausschliesslich die Organisation des angemeldeten Benutzers. Der bisherige lokale Plan bleibt ein separater Legacy-Mandant.
- Unter `/abo` sehen angemeldete Organisationsmitglieder die Stammdaten und die Laufzeit. Die Links **Abo verlängern** (`/abo/verlaengern`) und **Abo kündigen** (`/abo/kuendigen`) sind Platzhalter für eine spätere Stripe-Anbindung. Der Managerbereich zeigt einen deaktivierten Button **Zahlungslink senden**. Aktuell werden keine Stripe-Links erzeugt, keine E-Mails versendet und keine Zahlungen oder Kündigungen durchgeführt. Für die spätere Integration sind die jeweiligen Routen und Oberflächen vorgesehen; Checkout, Billing Portal, Webhooks und die Zuordnung der Stripe-Kundendaten müssen noch implementiert werden.

## Bereitstellung auf plandito.com

Benötigt werden PHP 8.2+, `pdo_sqlite`, `mbstring`, die Symfony-Pflicht-Erweiterungen, Composer, HTTPS und ein beschreibbares `var/`. Der Web-Document-Root muss auf `symfony/public/` zeigen. Auf dem Server `APP_ENV=prod`, `APP_DEBUG=0`, ein zufälliges `APP_SECRET` und `LEGACY_TENANT_ENABLED=0` setzen; die lokale `.env.local`, Datenbanken und Zugangsdaten **nicht** hochladen. Danach `composer install --no-dev --optimize-autoloader` und `php bin/console cache:clear --env=prod` ausführen. Die Webserver-Konfiguration muss die `.htaccess` in `public/` beachten oder alle Anwendungsrouten anderweitig an `index.php` weiterleiten. `var/platform.sqlite` und `var/tenants/` regelmässig mit einer SQLite-konsistenten Sicherung schützen. DNS und TLS werden am vorhandenen Hosting eingerichtet, sobald dessen technische Angaben vorliegen.

Die zuvor veröffentlichte statische Sites-Version im übergeordneten `dist/`-Ordner führt kein PHP aus und enthält diese serverseitigen Funktionen nicht.

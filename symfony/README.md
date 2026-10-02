# Teamplaner mit Symfony

Symfony 7.4 (LTS) stellt die deutschsprachige Teamplaner-Oberfläche über eine Twig-Seite bereit. Die interaktive Planung läuft im Browser mit dem vorhandenen Zwei-Monats-Planer. Teamdaten werden nur im jeweiligen Browser gespeichert.

## Voraussetzungen

- PHP 8.2 oder neuer mit den Symfony-Pflicht-Erweiterungen
- Composer

## Lokal starten

```sh
composer install
./bin/serve-local
```

Danach `http://127.0.0.1:8000/` öffnen. Auf diesem Mac erkennt das Startskript die vorhandene PHP-Installation und verwendet bei Bedarf die lokal vorbereitete ICU-Bibliothek. Auf anderen Rechnern ist nur eine funktionsfähige PHP-Installation nötig. Für einen Produktionsserver muss der Document Root auf `public/` zeigen; `vendor/`, `var/` und die übrigen Projektdateien dürfen nicht öffentlich auslieferbar sein. Die statisch veröffentlichte Sites-Version liegt weiterhin im übergeordneten `dist/`-Ordner. Sites führt kein PHP aus und hostet diese Symfony-Anwendung daher nicht.

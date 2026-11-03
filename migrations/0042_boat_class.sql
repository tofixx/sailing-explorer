-- Bootsklasse (Konzept 34, F-535 … F-539): kuratierte Klasse je Boot für den Filter auf /entdecken. Der freie Typ
-- (`boat_type`) bleibt als Angabe stehen, `boat_class` ist eine ID aus BOAT_CLASSES (src/domain/boat-class.ts), leer =
-- nicht zugeordnet. Nur additiv: neue Spalte mit Vorgabe '', fällt mit der Bootszeile (kein eigener Löschweg).
ALTER TABLE boats ADD COLUMN boat_class TEXT NOT NULL DEFAULT '';

-- Filter in Entdecken: Boote je Klasse.
CREATE INDEX boats_class ON boats(boat_class) WHERE boat_class <> '';

-- Rückbefüllung des Altbestands aus dem freien Typ. Erzeugt aus BOAT_CLASS_RULES (boatTypeFoldSql, boatClassSql), der
-- Test test/functional/migration-boat-class.test.ts hält diese Datei und classifyBoatType gleich.
WITH f AS (SELECT id, ' ' || replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(boat_type), '-', ' '), '/', ' '), '.', ' '), ',', ' '), '(', ' '), ')', ' '), '_', ' '), '+', ' '), '''', ' ') || ' ' AS x FROM boats WHERE boat_type <> '')
UPDATE boats SET boat_class = (SELECT CASE
    WHEN instr(f.x, 'optimist') > 0 OR instr(f.x, ' opti ') > 0 THEN 'optimist'
    WHEN instr(f.x, ' ilca') > 0 OR instr(f.x, ' laser ') > 0 THEN 'ilca'
    WHEN instr(f.x, ' pirat ') > 0 OR instr(f.x, 'piratenjolle') > 0 THEN 'pirat'
    WHEN instr(f.x, 'korsar') > 0 THEN 'korsar'
    WHEN instr(f.x, 'conger') > 0 THEN 'conger'
    WHEN instr(f.x, 'jollenkreuzer') > 0 OR instr(f.x, ' jk ') > 0 THEN 'jollenkreuzer'
    WHEN instr(f.x, 'folkeboot') > 0 OR instr(f.x, 'folkboot') > 0 OR instr(f.x, 'folkboat') > 0 OR instr(f.x, ' folke ') > 0 THEN 'folkeboot'
    WHEN instr(f.x, ' h boot ') > 0 THEN 'h-boot'
    WHEN instr(f.x, ' j 24 ') > 0 OR instr(f.x, ' j24 ') > 0 THEN 'j24'
    WHEN instr(f.x, ' drachen ') > 0 OR instr(f.x, ' dragon ') > 0 THEN 'drachen'
    WHEN instr(f.x, 'katamaran') > 0 OR instr(f.x, 'catamaran') > 0 OR instr(f.x, 'trimaran') > 0 OR instr(f.x, ' kat ') > 0 OR instr(f.x, ' hobie') > 0 OR instr(f.x, ' nacra') > 0 OR instr(f.x, ' tornado ') > 0 OR instr(f.x, ' lagoon ') > 0 THEN 'katamaran'
    WHEN instr(f.x, 'yacht') > 0 OR instr(f.x, 'kielboot') > 0 OR instr(f.x, ' bavaria') > 0 OR instr(f.x, ' hanse ') > 0 OR instr(f.x, ' dehler') > 0 OR instr(f.x, ' jeanneau') > 0 OR instr(f.x, ' beneteau') > 0 OR instr(f.x, ' hallberg') > 0 OR instr(f.x, ' dufour') > 0 OR instr(f.x, ' elan ') > 0 OR instr(f.x, ' etap ') > 0 OR instr(f.x, ' sunbeam') > 0 OR instr(f.x, ' najad') > 0 OR instr(f.x, ' oceanis') > 0 OR instr(f.x, ' sun odyssey') > 0 OR instr(f.x, ' varianta') > 0 OR instr(f.x, ' moody ') > 0 OR instr(f.x, ' contest ') > 0 THEN 'fahrtenyacht'
    WHEN instr(f.x, ' 420 ') > 0 OR instr(f.x, ' 420er ') > 0 THEN '420'
    WHEN instr(f.x, ' 470 ') > 0 OR instr(f.x, ' 470er ') > 0 THEN '470'
    ELSE '' END FROM f WHERE f.id = boats.id)
WHERE boat_type <> '';

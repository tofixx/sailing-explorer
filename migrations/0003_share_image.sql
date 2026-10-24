-- Übersichtsbild einer Freigabe (JPEG in R2 unter previews/<id>.jpg) für Link-Vorschauen.
ALTER TABLE shares ADD COLUMN has_image INTEGER NOT NULL DEFAULT 0;

-- Extensiones usadas por la búsqueda de productos (código, marca, medida, equivalencias)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

-- Base separada para las pruebas de integración
CREATE DATABASE rodasoft_test OWNER rodasoft;

-- Separate database for the local staging environment (pnpm staging:reset)
CREATE DATABASE rodasoft_staging OWNER rodasoft;

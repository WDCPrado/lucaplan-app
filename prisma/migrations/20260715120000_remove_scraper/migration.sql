-- Adiós al método scraper: se eliminan las credenciales bancarias locales cifradas y cualquier
-- registro de método `scraper`. La conexión por correo (email) no se toca.
DROP TABLE IF EXISTS "bank_credential";
DELETE FROM "bank_connection_method" WHERE "method" = 'scraper';

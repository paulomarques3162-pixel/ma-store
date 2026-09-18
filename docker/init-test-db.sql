# Cria o banco de TESTES automaticamente ao subir o container.
# A suite (`npm test`) usa TEST_DATABASE_URL e nunca o banco de desenvolvimento.
CREATE DATABASE mastore_test OWNER mastore;

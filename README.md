# PonudiMi MVP v1

PonudiMi MVP koristi Node.js/Express i PostgreSQL. SQLite je uklonjen radi pouzdanog rada na hostingu.

## Lokalno
1. `npm install`
2. Podesi `DATABASE_URL` na PostgreSQL bazu.
3. Opcionalno podesi `JWT_SECRET`.
4. `npm start`

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: `NODE_ENV=production`
- Environment: `DATABASE_URL=<Render PostgreSQL Internal Database URL>`
- Environment: `JWT_SECRET=<duga nasumična tajna>`

Aplikacija sama kreira potrebne tabele pri prvom pokretanju.

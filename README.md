# FairShare backend

The API behind the FairShare web, admin and mobile apps, for splitting expenses in groups. Built with NestJS, Prisma and Postgres.

## Setup

You need Node 24 and Docker.

```bash
cp .env.example .env
```

Fill in `.env` using the comments in that file. The app refuses to start if a required value is missing or a secret is too short.

```bash
npm install
docker compose up -d
npx prisma migrate deploy
npm run start:dev
```

## Tests

```bash
npm test
npm run test:e2e
```

`npm test` runs the unit tests. `npm run test:e2e` runs the suites in `test/e2e` against the real app and a throwaway Postgres in Docker. It never touches your `.env` database, because each suite refuses to run against anything else. To run only some suites, name them:

```bash
npm run test:e2e -- m9 devices
```

CI runs all of this on every pull request and every push to `main`.

## Deploying

Build with `npm run build` and start with `npm run start:prod`. Run `npx prisma migrate deploy` before starting a new version.

- Set `NODE_ENV=production` to get JSON logs.
- Point the platform's health check at `GET /health`, which returns 503 if the database can't be reached.
- `NOTIFICATION_EMAIL` is optional. Without it, no sign-up or bug report notices are sent.

## Running one instance only

Live events, event stream tickets and rate limit counts are all held in memory. A second instance wouldn't see the first one's streams or counts, so run a single replica until those move to shared storage such as Redis.

## Conventions worth knowing

- **Money:** stored as `Decimal(10, 2)` and calculated in whole cents. Anything that reads balances and then acts on them runs inside `withGroupLock`.
- **Deleted users:** the row stays, as "Deleted user", because other people's expenses point at it. See `AccountDeletionService`.
- **Passwords and invite tokens:** left out of every query by a global omit in `DatabaseService`. Code that needs one has to ask for it.

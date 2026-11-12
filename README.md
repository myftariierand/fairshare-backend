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

- Point the platform's health check at `GET /health`, which returns 503 if the database can't be reached.
- Emails load their logo from `<CLIENT_ORIGIN>/email/logo-64.png`, which the web app serves.

### Environment variables in production

`.env.example` lists every variable, grouped the same way as below.

The app won't start without these:

| Variable | Production value |
| --- | --- |
| `DATABASE_URL` | The hosted database's connection string |
| `NODE_ENV` | `production`, which switches to JSON logs |
| `ACCESS_TOKEN_SECRET`, `RESET_PASSWORD_SECRET` | New secrets of at least 32 characters, never the local ones. Generate each with `openssl rand -hex 64`. |
| `CLIENT_ORIGIN` | The deployed web app's URL. Allowed by CORS and used for links in emails. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Google OAuth client. `GOOGLE_CLIENT_ID` must match `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the mobile app. |
| `GOOGLE_CALLBACK_URL` | `<backend URL>/auth/google/callback`, also listed in the Google client's redirect URIs |
| `RESEND_API_KEY` | A key for a verified sending domain |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | The Cloudinary account for image uploads |

These are optional, and leaving one empty turns that part off:

- `ADMIN_ORIGIN` is the admin dashboard's URL. Set it whenever the dashboard is deployed, or CORS blocks its requests.
- `MOBILE_ORIGIN` adds the mobile app's origin to CORS.
- `GOOGLE_WEB_CLIENT_ID` is only for a mobile app that uses a different Google client from the backend.
- `NOTIFICATION_EMAIL` is where sign-up and bug report notices go. Without it, none are sent.
- `SUPPORT_EMAIL` is the contact line in the account-deleted email. Without it, someone who didn't delete their account has nowhere to go.
- `DONATION_URL` adds a donation section to the welcome email. Keep donation links out of the mobile app, because the app stores have rules about asking for payments there.

`POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` are only read by `docker-compose.yml` for the local database. `PORT` defaults to 3000, and hosts like Vercel set their own.

## Running one instance only

Live events, event stream tickets and rate limit counts are all held in memory. A second instance wouldn't see the first one's streams or counts, so run a single replica until those move to shared storage such as Redis.

## Conventions worth knowing

- **Money:** stored as `Decimal(10, 2)` and calculated in whole cents. Anything that reads balances and then acts on them runs inside `withGroupLock`.
- **Deleted users:** the row stays, as "Deleted user", because other people's expenses point at it. See `AccountDeletionService`.
- **Emails:** each has an entry in `src/email/email.catalog.ts` and a `.hbs` and `.txt.hbs` pair in `templates/`, built from `templates/partials`. Styles stay inline because many mail clients drop style blocks.
- **Passwords and invite tokens:** left out of every query by a global omit in `DatabaseService`. Code that needs one has to ask for it.

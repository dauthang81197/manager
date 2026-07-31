<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

The e2e suites run against a **real** Postgres (`DATABASE_URL`) and, for image
upload, a real temporary directory. `test/jest-e2e.json` pins them to
`maxWorkers: 1` with a 30s `testTimeout` for two reasons:

- **Timeouts.** Every suite shares the one database and each spins up a full
  Nest app that hashes passwords with argon2 when registering its fixture
  users. Run in parallel, that CPU contention pushes registration past Jest's
  5s default and suites fail intermittently on unrelated assertions.
- **Shared process state.** Serial execution means all e2e files run in one
  process, so a suite that overrides `process.env` (the assets suite points
  `ASSET_STORAGE_DIR` at a temp directory) must restore it in `afterAll` — or
  a later suite's `AppModule` boots against a directory that has been deleted.
  This is a consequence of `maxWorkers: 1`, not an independent choice.

Serial execution costs a couple of seconds and makes the run deterministic.

## Image storage & backup (FR-9 / FR-14)

Uploaded images (FR-9, story 4) are stored as **files on the server's local
disk volume**, not in Postgres and not in S3 or any paid cloud storage. This
closes the architecture spine's open decision under `Deferred` → "Lưu trữ ảnh
(FR-9)", in line with the project constraint of not depending on paid SaaS.

- `ASSET_STORAGE_DIR` (see `.env.example`) is the directory the bytes go into.
  Layout is `<ASSET_STORAGE_DIR>/<ownerId>/<assetId>.<ext>`.
- The `assets` table stores only metadata (owner, original filename, detected
  mime type, size, and the path **relative** to `ASSET_STORAGE_DIR`).

> [!IMPORTANT]
> **Story 6 (FR-14 backup) MUST cover `ASSET_STORAGE_DIR`.**
>
> This is a spine requirement attached to the local-disk decision: whatever
> storage is chosen has to sit inside the backup cycle. `pg_dump` alone is not
> enough — it restores the `assets` rows but not the image bytes they point at,
> so a database-only restore brings back every Page with all of its images
> broken, silently. The daily backup job must archive this directory alongside
> the database dump, with the same 7-copy retention.

Images are served by an **authenticated** endpoint (`GET /api/v1/assets/:id`,
filtered by `ownerId`), not by a public static-file server, so one user's
images are never reachable by another (404, never 403). Browsers reach them
through my-notion-frontend's `/api/assets/:id` Route Handler — see
`PUBLIC_APP_URL` in `.env.example` for why the stored absolute URL points at
the frontend origin.

Accepted formats are PNG, JPEG, GIF and WebP, up to 5 MiB. The format is
determined by sniffing the file's magic bytes, so a non-image renamed to
`.png` is rejected regardless of the extension or `Content-Type` the client
sends. See `src/assets/assets.constants.ts`.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

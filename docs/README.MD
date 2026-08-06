<h1 align="center">NeonFlux</h1>

<p align="center">
  <strong>A Fluxer bot with a signed-in web dashboard.</strong><br />
  Send messages, inspect server activity, and review or apply complete server layouts.
</p>

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/NeonTechSpace/NeonFlux/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=fff&labelColor=0B1221&color=237DBE&label=CI)](https://github.com/NeonTechSpace/NeonFlux/actions/workflows/ci.yml)

[![Bot Release](https://img.shields.io/static/v1?style=for-the-badge&label=Bot%20Release&message=Pending&logo=github&logoColor=fff&labelColor=0B1221&color=5A1730)](https://github.com/NeonTechSpace/NeonFlux/tags)
  
[![Web Release](https://img.shields.io/static/v1?style=for-the-badge&label=Web%20Release&message=Pending&logo=github&logoColor=fff&labelColor=0B1221&color=1E40AF)](https://github.com/NeonTechSpace/NeonFlux/tags)

</div>

> [!IMPORTANT]
> NeonFlux is an unreleased work in progress. Breaking changes and development database resets are expected.

NeonFlux uses the same validated Convex data path on hosted and self-hosted deployments. Choose hosted capacity or self-hosted resources from measured workload. The project does not promise that a particular hosted quota tier will be sufficient.

## What NeonFlux does

| Feature              | In plain language                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Messages**         | Build and preview a message, choose a channel, send it safely, and see whether delivery succeeded, failed, or is uncertain.   |
| **Server Blueprint** | Capture or import a server layout, review the exact changes, approve them, apply them through the bot, and verify the result. |

NeonFlux also includes server activity, command-prefix settings, audit events, message templates, backups, drift checks, and recovery tools.

## Run it locally

Use Node **24.18.0** and pnpm **11**.

```sh
cd projects
pnpm install
cp .env.example .env
pnpm setup:dev -- --write
pnpm dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

The setup command creates local signing and encryption keys without printing them. You must still add your own Fluxer application ID, OAuth client secret, and bot token to `projects/.env`.

For the complete setup, read [Local setup](docs/Local-Setup.md).

## Read what you need

| Guide                                            | Use it when you want to…                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [Local setup](docs/Local-Setup.md)               | install dependencies, create local secrets, configure Convex, and start the apps      |
| [Contributing](CONTRIBUTING.md)                  | know which checks must pass and which extra checks need Docker or Chromium            |
| [Messages](docs/Messages.md)                     | understand message sending, retries, uncertain delivery, and mention safety           |
| [Server Blueprint](docs/Server-Blueprint.md)     | understand plans, safety checks, deployment modes, runs, and recovery                 |
| [How NeonFlux works](docs/How-NeonFlux-Works.md) | understand the browser, web app, Convex, bot, and Fluxer boundaries                   |
| [Convex](docs/Convex.md)                         | configure authentication, deployments, retention, code generation, or a guarded reset |
| [Docker](docs/Docker.md)                         | build and run the production containers                                               |

## Repository layout

Application code lives in [`projects`](projects).

| Path                 | Owns                                                       |
| -------------------- | ---------------------------------------------------------- |
| `apps/web`           | public pages, OAuth, sessions, and the signed-in dashboard |
| `apps/bot`           | Fluxer connection, live reads, and queued provider changes |
| `convex`             | durable data, transactions, queues, and live updates       |
| `packages/blueprint` | Server Blueprint validation, planning, and safety rules    |
| `packages/messaging` | outgoing-message validation and delivery rules             |
| `packages/fluxer`    | translation between NeonFlux data and Fluxer APIs          |
| `packages/db`        | typed access to Convex                                     |

## Repository activity

![RepoBeats analytics](https://repobeats.axiom.co/api/embed/79b0b7006e59290b742ddcd8cacb309dd81e0fff.svg "RepoBeats analytics")

## License

NeonFlux is available under the [Apache License 2.0](LICENSE).

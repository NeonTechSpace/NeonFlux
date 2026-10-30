# Security policy

This policy covers the NeonFlux bot, its Convex backend, the configuration website and web verification in this repository

## Report a vulnerability

Report a vulnerability privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Only the maintainers see the report

Describe what an attacker can do, the steps that show it and the version or commit tested. A small example is enough

## Keep it out of public issues

Do not put a vulnerability in a public issue, pull request or discussion. Never share real secrets or member data in a report:

- Bot tokens, deploy keys, OAuth client secrets, the backup key or session cookies
- Backup archives, server exports or `!mydata` exports
- Message text, ticket contents, cases or appeals from a real server

Use made-up values instead. A self-hosted deployment's own secrets belong to its operator, so rotate any that were exposed

## What happens next

The maintainers review each report privately and discuss it with the reporter in the report. Reports about Fluxer itself belong to Fluxer, and reports about the Fluxerly SDK belong to [Fluxerly.js](https://github.com/NeonTechSpace/Fluxerly.js)

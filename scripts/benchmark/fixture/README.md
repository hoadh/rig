# taskboard

A small ticket tracker used as a library, a CLI and a request handler.

## Layout

- `src/models` - plain data types
- `src/util` - pagination, text formatting, dates, errors, ids
- `src/store` - in-memory store and aggregation helpers
- `src/services` - user, project, ticket and report services
- `src/server` - static file handler and the request router
- `src/cli` - argument parsing and the `taskboard` command

## Running

```
npm test
node src/cli/bin.ts list --project 1 --page 2
node src/cli/bin.ts summary
```

## Configuration

Configuration is read from environment variables by `loadConfig` in `src/config.ts`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | listening port |
| `STATIC_DIR` | `public` | directory served under `/static` |
| `PAGE_SIZE` | `10` | default page size for list endpoints |

## HTTP API

- `GET /api/tickets?page=N` returns a page of tickets as JSON.
- `GET /static/<path>` serves a file from `STATIC_DIR`.

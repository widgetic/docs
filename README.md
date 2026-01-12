# Widgetic Developer Documentation

This is the Mintlify documentation site for Widgetic's public API and developer resources.

## Structure

- `docs/` - Documentation pages (guides, tutorials)
- `api-reference/` - API reference concept pages
- `resources/` - SDKs, examples, integrations
- `openapi/` - OpenAPI specification (synced from API gateway)
- `docs.json` - Mintlify configuration

## Development

### Prerequisites

- Node.js 20+
- npm

### Running Locally

```bash
npm install
npm run dev
```

This starts the Mintlify dev server at `http://localhost:3000`.

### Building

```bash
npm run build
```

## Syncing OpenAPI Spec

The OpenAPI specification is synced from the API gateway service:

```bash
npm run sync-openapi
```

This copies `Services/api-gateway-service/client-sdk/openapi-spec-public.json` to `openapi/widgetic-api-public.json`.

## Checking for Drift

To verify the docs OpenAPI spec matches the generated one:

```bash
npm run check-openapi-drift
```

This will fail if the specs differ, indicating you need to run `sync-openapi`.

## Validating Links

Check for broken internal links:

```bash
npm run validate-links
```

## Deployment

This site is deployed via Mintlify. The OpenAPI spec is automatically synced during the build process.

## Adding New Documentation

1. Create MDX files in the appropriate directory (`docs/`, `api-reference/`, or `resources/`)
2. Add the page to `docs.json` navigation
3. Ensure all internal links are valid (run `validate-links`)

## OpenAPI Specification

The OpenAPI spec is the source of truth for the API Reference tab. Only endpoints marked with `x-visibility: public` appear in the documentation.

To add a new public endpoint:
1. Add `x-visibility: public` to the route's Swagger annotation
2. Set appropriate `x-access-level` (`user`, `partner`, or `admin`)
3. Regenerate the spec: `cd Services/api-gateway-service && npm run generate-schema-docs`
4. Sync to docs: `cd Frontend/docs-site && npm run sync-openapi`

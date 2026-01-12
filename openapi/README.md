# OpenAPI Specification

This directory contains the Widgetic public API specification.

## Files

- `widgetic-api-public.json` - The public OpenAPI 3.0 specification

## Syncing

Run the sync script to update the spec from the API gateway:

```bash
npm run sync-openapi
```

This copies `Services/api-gateway-service/client-sdk/openapi-spec-public.json` to this directory.

## Manual Update

If you need to manually copy the spec:

```bash
cp ../../Services/api-gateway-service/client-sdk/openapi-spec-public.json ./widgetic-api-public.json
```

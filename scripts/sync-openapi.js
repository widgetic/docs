#!/usr/bin/env node

/**
 * Sync OpenAPI spec from api-gateway-service to docs-site
 * 
 * This script copies the generated public OpenAPI spec from the API gateway
 * to the docs site, ensuring documentation stays in sync with the actual API.
 * 
 * Usage:
 *   npm run sync-openapi
 *   node scripts/sync-openapi.js
 */

const fs = require('fs');
const path = require('path');

// Paths
const SOURCE_PATH = path.resolve(
  __dirname,
  '../../../Services/api-gateway-service/client-sdk/openapi-spec-public.json'
);
const TARGET_PATH = path.resolve(
  __dirname,
  '../openapi/widgetic-api-public.json'
);

function syncOpenApiSpec() {
  console.log('🔄 Syncing OpenAPI spec...\n');

  // Check if source exists
  if (!fs.existsSync(SOURCE_PATH)) {
    console.error('❌ Source file not found:', SOURCE_PATH);
    console.error('\nMake sure to generate the public spec first:');
    console.error('  cd Services/api-gateway-service');
    console.error('  npm run generate-schema-docs');
    process.exit(1);
  }

  // Ensure target directory exists
  const targetDir = path.dirname(TARGET_PATH);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log('📁 Created directory:', targetDir);
  }

  // Read source spec
  const sourceSpec = fs.readFileSync(SOURCE_PATH, 'utf8');
  const spec = JSON.parse(sourceSpec);

  // Log spec info
  const pathCount = Object.keys(spec.paths || {}).length;
  const tagCount = (spec.tags || []).length;
  console.log(`📄 Source spec: ${pathCount} paths, ${tagCount} tags`);

  // Check if target exists and compare
  if (fs.existsSync(TARGET_PATH)) {
    const targetSpec = fs.readFileSync(TARGET_PATH, 'utf8');
    
    if (targetSpec === sourceSpec) {
      console.log('✅ Spec is already up to date');
      return;
    }
    
    console.log('📝 Updating existing spec...');
  } else {
    console.log('📝 Creating new spec file...');
  }

  // Write target spec
  fs.writeFileSync(TARGET_PATH, sourceSpec);
  console.log('✅ Spec synced to:', TARGET_PATH);

  // Print summary of public endpoints
  console.log('\n📊 Public Endpoints Summary:');
  const endpoints = [];
  
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (method === 'parameters') continue;
      
      const accessLevel = operation['x-access-level'] || 'user';
      endpoints.push({
        method: method.toUpperCase(),
        path,
        accessLevel,
        operationId: operation.operationId || 'N/A'
      });
    }
  }

  // Group by access level
  const byAccessLevel = endpoints.reduce((acc, ep) => {
    acc[ep.accessLevel] = (acc[ep.accessLevel] || 0) + 1;
    return acc;
  }, {});

  for (const [level, count] of Object.entries(byAccessLevel)) {
    console.log(`   ${level}: ${count} endpoints`);
  }

  console.log('\n✨ Done!');
}

// Run
try {
  syncOpenApiSpec();
} catch (error) {
  console.error('❌ Error syncing spec:', error.message);
  process.exit(1);
}

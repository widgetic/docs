#!/usr/bin/env node

/**
 * Validate internal links in documentation
 * 
 * This script checks that all internal links in MDX files point to
 * valid destinations, preventing broken links in the documentation.
 * 
 * Usage:
 *   npm run validate-links
 *   node scripts/validate-links.js
 */

const fs = require('fs');
const path = require('path');

const DOCS_ROOT = path.resolve(__dirname, '..');

// Root folders to scan for MDX files (avoid extra deps like glob)
const MDX_ROOT_FOLDERS = [
  'docs',
  'api-reference',
  'resources'
];

// Link patterns in MDX
const LINK_PATTERNS = [
  /\[([^\]]+)\]\(([^)]+)\)/g,  // Markdown links [text](url)
  /href="([^"]+)"/g,           // href attributes
  /href='([^']+)'/g
];

function findAllMdxFiles() {
  const files = [];

  const walkDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.mdx')) {
        // Store as path relative to DOCS_ROOT to match existing behavior
        files.push(path.relative(DOCS_ROOT, fullPath));
      }
    }
  };

  for (const folder of MDX_ROOT_FOLDERS) {
    walkDir(path.join(DOCS_ROOT, folder));
  }

  return files;
}

function extractLinks(content) {
  const links = [];
  
  for (const pattern of LINK_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(content)) !== null) {
      // Extract URL (could be in different capture groups)
      const url = match[2] || match[1];
      
      // Skip external links and anchors
      if (url.startsWith('http') || url.startsWith('mailto:') || url === '#') {
        continue;
      }
      
      links.push(url);
    }
  }
  
  return links;
}

function resolveInternalLink(link, fromFile) {
  // Remove anchor
  const [basePath] = link.split('#');
  
  if (!basePath) return null; // Just an anchor
  
  // Normalize the path
  let targetPath = basePath;
  
  // Handle relative paths
  if (targetPath.startsWith('./') || targetPath.startsWith('../')) {
    const fromDir = path.dirname(fromFile);
    targetPath = path.resolve(fromDir, targetPath);
  } else if (targetPath.startsWith('/')) {
    // Absolute path from docs root
    targetPath = targetPath.slice(1);
  }
  
  // Try different extensions
  const possiblePaths = [
    targetPath,
    targetPath + '.mdx',
    targetPath + '.md',
    path.join(targetPath, 'index.mdx'),
    path.join(targetPath, 'index.md')
  ];
  
  for (const p of possiblePaths) {
    const fullPath = path.resolve(DOCS_ROOT, p);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  
  return null;
}

function validateLinks() {
  console.log('🔍 Validating documentation links...\n');
  
  const files = findAllMdxFiles();
  console.log(`Found ${files.length} MDX files\n`);
  
  const errors = [];
  let totalLinks = 0;
  
  for (const file of files) {
    const fullPath = path.resolve(DOCS_ROOT, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const links = extractLinks(content);
    
    for (const link of links) {
      totalLinks++;
      
      const resolved = resolveInternalLink(link, file);
      
      if (resolved === null && !link.startsWith('#')) {
        errors.push({
          file,
          link,
          message: 'Link target not found'
        });
      }
    }
  }
  
  console.log(`Checked ${totalLinks} internal links\n`);
  
  if (errors.length === 0) {
    console.log('✅ All links are valid!');
    return 0;
  }
  
  console.log(`❌ Found ${errors.length} broken links:\n`);
  
  for (const error of errors) {
    console.log(`  ${error.file}`);
    console.log(`    → ${error.link}`);
    console.log(`    ${error.message}\n`);
  }
  
  return 1;
}

// Run
try {
  const exitCode = validateLinks();
  process.exit(exitCode);
} catch (error) {
  console.error('❌ Error validating links:', error.message);
  process.exit(1);
}

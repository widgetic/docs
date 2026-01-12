#!/usr/bin/env node
/**
 * Generate x-codeSamples for all public API endpoints
 * 
 * This script adds code samples in 8 languages to all endpoints in the OpenAPI spec:
 * - cURL
 * - TypeScript/JavaScript (Node.js)
 * - Python
 * - Go
 * - Ruby
 * - PHP
 * - Java
 * - C#
 * 
 * Usage: node scripts/generate-code-samples.js
 */

const fs = require('fs');
const path = require('path');

const OPENAPI_PATH = path.join(__dirname, '..', 'openapi', 'widgetic-api-public.json');
const BASE_URL = 'https://api.widgetic.com/v1';

// SDK package names for each language
const SDK_PACKAGES = {
  typescript: '@widgetic/api-sdk',
  python: 'widgetic_api',
  go: 'github.com/widgetic/widgetic-go',
  ruby: 'widgetic-api',
  php: 'Widgetic\\Api',
  java: 'com.widgetic.api',
  csharp: 'Widgetic.Api'
};

/**
 * Convert operationId to API class name
 * e.g., "getAllWidgets" -> "WidgetsApi"
 * e.g., "createComposition" -> "CompositionsApi"
 */
function getApiClassName(operationId, tag) {
  if (tag) {
    // Use tag to derive class name
    const normalized = tag.replace(/\s+/g, '');
    return normalized + 'Api';
  }
  // Fallback: extract from operationId
  return 'Api';
}

/**
 * Convert operationId to method name for each language
 */
function getMethodName(operationId, lang) {
  if (!operationId) return 'execute';
  
  switch (lang) {
    case 'python':
    case 'ruby':
      // snake_case
      return operationId.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    case 'go':
      // PascalCase
      return operationId.charAt(0).toUpperCase() + operationId.slice(1);
    case 'php':
    case 'java':
    case 'csharp':
    case 'typescript':
    default:
      // camelCase (as-is)
      return operationId;
  }
}

/**
 * Generate path with example values for path parameters
 */
function generateExamplePath(pathTemplate, parameters) {
  let examplePath = pathTemplate;
  const pathParams = (parameters || []).filter(p => p.in === 'path');
  
  for (const param of pathParams) {
    const exampleValue = getExampleValue(param);
    examplePath = examplePath.replace(`{${param.name}}`, exampleValue);
  }
  
  return examplePath;
}

/**
 * Get example value for a parameter
 */
function getExampleValue(param) {
  if (param.example) return param.example;
  if (param.schema?.example) return param.schema.example;
  
  // Generate sensible defaults
  const name = param.name.toLowerCase();
  if (name.includes('id')) return 'example-uuid-123';
  if (name.includes('table')) return 'my_table';
  if (name.includes('feature')) return 'widgets.create';
  
  switch (param.schema?.type) {
    case 'integer': return '1';
    case 'number': return '1.0';
    case 'boolean': return 'true';
    default: return 'example';
  }
}

/**
 * Generate query string from parameters
 */
function generateQueryString(parameters) {
  const queryParams = (parameters || []).filter(p => p.in === 'query');
  if (queryParams.length === 0) return '';
  
  const pairs = queryParams.slice(0, 2).map(p => {
    const value = getExampleValue(p);
    return `${p.name}=${encodeURIComponent(value)}`;
  });
  
  return '?' + pairs.join('&');
}

/**
 * Generate example request body
 */
function generateRequestBody(operation) {
  const requestBody = operation.requestBody;
  if (!requestBody) return null;
  
  const content = requestBody.content?.['application/json'];
  if (!content) return null;
  
  const schema = content.schema;
  if (!schema) return null;
  
  // Check for example
  if (content.example) return content.example;
  if (schema.example) return schema.example;
  
  // Generate from schema properties
  return generateExampleFromSchema(schema);
}

/**
 * Generate example object from schema
 */
function generateExampleFromSchema(schema, depth = 0) {
  if (depth > 3) return {};
  
  if (schema.example) return schema.example;
  
  if (schema.type === 'object' || schema.properties) {
    const obj = {};
    const props = schema.properties || {};
    const required = schema.required || [];
    
    // Only include required properties + first 2 optional
    const keys = [...required, ...Object.keys(props).filter(k => !required.includes(k)).slice(0, 2)];
    
    for (const key of keys.slice(0, 4)) {
      if (props[key]) {
        obj[key] = generateExampleFromSchema(props[key], depth + 1);
      }
    }
    return obj;
  }
  
  if (schema.type === 'array') {
    const itemExample = schema.items ? generateExampleFromSchema(schema.items, depth + 1) : 'item';
    return [itemExample];
  }
  
  // Primitives
  switch (schema.type) {
    case 'string':
      if (schema.format === 'uuid') return 'uuid-example-123';
      if (schema.format === 'email') return 'user@example.com';
      if (schema.format === 'uri') return 'https://example.com';
      if (schema.enum) return schema.enum[0];
      return 'example';
    case 'integer':
      return schema.minimum || 1;
    case 'number':
      return schema.minimum || 1.0;
    case 'boolean':
      return true;
    default:
      return 'example';
  }
}

/**
 * Generate cURL code sample
 */
function generateCurlSample(method, pathTemplate, operation, parameters) {
  const examplePath = generateExamplePath(pathTemplate, parameters);
  const queryString = method === 'GET' ? generateQueryString(parameters) : '';
  const url = `${BASE_URL}${examplePath}${queryString}`;
  
  let curl = `curl -X ${method.toUpperCase()} '${url}' \\\n`;
  curl += `  -H 'Authorization: Bearer YOUR_API_KEY'`;
  
  const body = generateRequestBody(operation);
  if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    curl += ` \\\n  -H 'Content-Type: application/json'`;
    curl += ` \\\n  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`;
  }
  
  return curl;
}

/**
 * Generate TypeScript code sample
 */
function generateTypeScriptSample(method, pathTemplate, operation, parameters, tag) {
  const operationId = operation.operationId || 'execute';
  const className = getApiClassName(operationId, tag);
  const methodName = getMethodName(operationId, 'typescript');
  
  let code = `import { ${className} } from '${SDK_PACKAGES.typescript}';\n\n`;
  code += `const api = new ${className}('YOUR_API_KEY');\n\n`;
  
  const body = generateRequestBody(operation);
  const pathParams = (parameters || []).filter(p => p.in === 'path');
  
  // Build params object
  const params = {};
  for (const p of pathParams) {
    const camelName = p.name.replace(/([-_][a-z])/g, g => g[1].toUpperCase());
    params[camelName] = getExampleValue(p);
  }
  if (body) {
    params[Object.keys(body)[0] + 'Request'] = body;
  }
  
  code += `try {\n`;
  if (Object.keys(params).length > 0) {
    code += `  const result = await api.${methodName}(${JSON.stringify(params, null, 2).replace(/\n/g, '\n  ')});\n`;
  } else {
    code += `  const result = await api.${methodName}();\n`;
  }
  code += `  console.log(result);\n`;
  code += `} catch (error) {\n`;
  code += `  console.error('Error:', error.message);\n`;
  code += `}`;
  
  return code;
}

/**
 * Generate Python code sample
 */
function generatePythonSample(method, pathTemplate, operation, parameters, tag) {
  const operationId = operation.operationId || 'execute';
  const className = getApiClassName(operationId, tag).replace('Api', '_api');
  const methodName = getMethodName(operationId, 'python');
  
  let code = `import ${SDK_PACKAGES.python}\n`;
  code += `from ${SDK_PACKAGES.python}.rest import ApiException\n\n`;
  code += `configuration = ${SDK_PACKAGES.python}.Configuration(\n`;
  code += `    host="https://api.widgetic.com/v1",\n`;
  code += `    api_key={"Authorization": "Bearer YOUR_API_KEY"}\n`;
  code += `)\n\n`;
  code += `with ${SDK_PACKAGES.python}.ApiClient(configuration) as api_client:\n`;
  code += `    api = ${SDK_PACKAGES.python}.${getApiClassName(operationId, tag)}(api_client)\n`;
  code += `    try:\n`;
  
  const body = generateRequestBody(operation);
  const pathParams = (parameters || []).filter(p => p.in === 'path');
  
  const args = [];
  for (const p of pathParams) {
    const snakeName = p.name.replace(/([A-Z])/g, '_$1').toLowerCase();
    args.push(`${snakeName}="${getExampleValue(p)}"`);
  }
  if (body) {
    args.push(`body=${JSON.stringify(body)}`);
  }
  
  code += `        result = api.${methodName}(${args.join(', ')})\n`;
  code += `        print(result)\n`;
  code += `    except ApiException as e:\n`;
  code += `        print(f"Error: {e}")`;
  
  return code;
}

/**
 * Generate Go code sample
 */
function generateGoSample(method, pathTemplate, operation, parameters, tag) {
  const operationId = operation.operationId || 'Execute';
  const methodName = getMethodName(operationId, 'go');
  
  let code = `package main\n\n`;
  code += `import (\n`;
  code += `    "context"\n`;
  code += `    "fmt"\n`;
  code += `    widgetic "${SDK_PACKAGES.go}"\n`;
  code += `)\n\n`;
  code += `func main() {\n`;
  code += `    cfg := widgetic.NewConfiguration()\n`;
  code += `    cfg.AddDefaultHeader("Authorization", "Bearer YOUR_API_KEY")\n`;
  code += `    client := widgetic.NewAPIClient(cfg)\n\n`;
  
  const apiName = getApiClassName(operationId, tag).replace('Api', 'API');
  code += `    result, _, err := client.${apiName}.${methodName}(context.Background()).Execute()\n`;
  code += `    if err != nil {\n`;
  code += `        fmt.Printf("Error: %v\\n", err)\n`;
  code += `        return\n`;
  code += `    }\n`;
  code += `    fmt.Printf("Result: %v\\n", result)\n`;
  code += `}`;
  
  return code;
}

/**
 * Generate Ruby code sample
 */
function generateRubySample(method, pathTemplate, operation, parameters, tag) {
  const operationId = operation.operationId || 'execute';
  const className = getApiClassName(operationId, tag);
  const methodName = getMethodName(operationId, 'ruby');
  
  let code = `require '${SDK_PACKAGES.ruby}'\n\n`;
  code += `WidgeticApi.configure do |config|\n`;
  code += `  config.api_key['Authorization'] = 'Bearer YOUR_API_KEY'\n`;
  code += `  config.host = 'https://api.widgetic.com/v1'\n`;
  code += `end\n\n`;
  code += `api = WidgeticApi::${className}.new\n\n`;
  code += `begin\n`;
  
  const pathParams = (parameters || []).filter(p => p.in === 'path');
  const args = pathParams.map(p => `'${getExampleValue(p)}'`).join(', ');
  
  code += `  result = api.${methodName}(${args})\n`;
  code += `  p result\n`;
  code += `rescue WidgeticApi::ApiError => e\n`;
  code += `  puts "Error: #{e}"\n`;
  code += `end`;
  
  return code;
}

/**
 * Generate PHP code sample
 */
function generatePhpSample(method, pathTemplate, operation, parameters, tag) {
  const operationId = operation.operationId || 'execute';
  const className = getApiClassName(operationId, tag);
  const methodName = getMethodName(operationId, 'php');
  
  let code = `<?php\n`;
  code += `require_once __DIR__ . '/vendor/autoload.php';\n\n`;
  code += `$config = ${SDK_PACKAGES.php}\\Configuration::getDefaultConfiguration()\n`;
  code += `    ->setApiKey('Authorization', 'Bearer YOUR_API_KEY')\n`;
  code += `    ->setHost('https://api.widgetic.com/v1');\n\n`;
  code += `$api = new ${SDK_PACKAGES.php}\\Api\\${className}(\n`;
  code += `    new GuzzleHttp\\Client(),\n`;
  code += `    $config\n`;
  code += `);\n\n`;
  code += `try {\n`;
  
  const pathParams = (parameters || []).filter(p => p.in === 'path');
  const args = pathParams.map(p => `'${getExampleValue(p)}'`).join(', ');
  
  code += `    $result = $api->${methodName}(${args});\n`;
  code += `    print_r($result);\n`;
  code += `} catch (Exception $e) {\n`;
  code += `    echo 'Error: ' . $e->getMessage();\n`;
  code += `}`;
  
  return code;
}

/**
 * Generate Java code sample
 */
function generateJavaSample(method, pathTemplate, operation, parameters, tag) {
  const operationId = operation.operationId || 'execute';
  const className = getApiClassName(operationId, tag);
  const methodName = getMethodName(operationId, 'java');
  
  let code = `import ${SDK_PACKAGES.java}.ApiClient;\n`;
  code += `import ${SDK_PACKAGES.java}.ApiException;\n`;
  code += `import ${SDK_PACKAGES.java}.Configuration;\n`;
  code += `import ${SDK_PACKAGES.java}.auth.ApiKeyAuth;\n`;
  code += `import ${SDK_PACKAGES.java}.api.${className};\n\n`;
  code += `public class Example {\n`;
  code += `    public static void main(String[] args) {\n`;
  code += `        ApiClient client = Configuration.getDefaultApiClient();\n`;
  code += `        client.setBasePath("https://api.widgetic.com/v1");\n\n`;
  code += `        ApiKeyAuth auth = (ApiKeyAuth) client.getAuthentication("Authorization");\n`;
  code += `        auth.setApiKey("Bearer YOUR_API_KEY");\n\n`;
  code += `        ${className} api = new ${className}(client);\n`;
  code += `        try {\n`;
  
  const pathParams = (parameters || []).filter(p => p.in === 'path');
  const args = pathParams.map(p => `"${getExampleValue(p)}"`).join(', ');
  
  code += `            var result = api.${methodName}(${args});\n`;
  code += `            System.out.println(result);\n`;
  code += `        } catch (ApiException e) {\n`;
  code += `            System.err.println("Error: " + e.getMessage());\n`;
  code += `        }\n`;
  code += `    }\n`;
  code += `}`;
  
  return code;
}

/**
 * Generate C# code sample
 */
function generateCSharpSample(method, pathTemplate, operation, parameters, tag) {
  const operationId = operation.operationId || 'Execute';
  const className = getApiClassName(operationId, tag);
  const methodName = getMethodName(operationId, 'csharp');
  const asyncMethodName = methodName.charAt(0).toUpperCase() + methodName.slice(1) + 'Async';
  
  let code = `using ${SDK_PACKAGES.csharp}.Api;\n`;
  code += `using ${SDK_PACKAGES.csharp}.Client;\n\n`;
  code += `var config = new Configuration();\n`;
  code += `config.BasePath = "https://api.widgetic.com/v1";\n`;
  code += `config.ApiKey.Add("Authorization", "Bearer YOUR_API_KEY");\n\n`;
  code += `var api = new ${className}(config);\n\n`;
  code += `try\n`;
  code += `{\n`;
  
  const pathParams = (parameters || []).filter(p => p.in === 'path');
  const args = pathParams.map(p => `"${getExampleValue(p)}"`).join(', ');
  
  code += `    var result = await api.${asyncMethodName}(${args});\n`;
  code += `    Console.WriteLine(result);\n`;
  code += `}\n`;
  code += `catch (ApiException e)\n`;
  code += `{\n`;
  code += `    Console.WriteLine($"Error: {e.Message}");\n`;
  code += `}`;
  
  return code;
}

/**
 * Generate all code samples for an operation
 */
function generateCodeSamples(method, pathTemplate, operation, parameters) {
  const tag = operation.tags?.[0] || 'API';
  
  return [
    {
      lang: 'curl',
      label: 'cURL',
      source: generateCurlSample(method, pathTemplate, operation, parameters)
    },
    {
      lang: 'javascript',
      label: 'Node.js',
      source: generateTypeScriptSample(method, pathTemplate, operation, parameters, tag)
    },
    {
      lang: 'python',
      label: 'Python',
      source: generatePythonSample(method, pathTemplate, operation, parameters, tag)
    },
    {
      lang: 'go',
      label: 'Go',
      source: generateGoSample(method, pathTemplate, operation, parameters, tag)
    },
    {
      lang: 'ruby',
      label: 'Ruby',
      source: generateRubySample(method, pathTemplate, operation, parameters, tag)
    },
    {
      lang: 'php',
      label: 'PHP',
      source: generatePhpSample(method, pathTemplate, operation, parameters, tag)
    },
    {
      lang: 'java',
      label: 'Java',
      source: generateJavaSample(method, pathTemplate, operation, parameters, tag)
    },
    {
      lang: 'csharp',
      label: 'C#',
      source: generateCSharpSample(method, pathTemplate, operation, parameters, tag)
    }
  ];
}

/**
 * Main function
 */
function main() {
  console.log('Loading OpenAPI spec...');
  const spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));
  
  let updated = 0;
  let skipped = 0;
  
  console.log('Generating code samples...');
  
  for (const [pathTemplate, pathItem] of Object.entries(spec.paths)) {
    // Get path-level parameters
    const pathParams = pathItem.parameters || [];
    
    for (const [method, operation] of Object.entries(pathItem)) {
      if (method === 'parameters') continue;
      
      // Merge path and operation parameters
      const allParams = [...pathParams, ...(operation.parameters || [])];
      
      // Generate code samples
      const samples = generateCodeSamples(method, pathTemplate, operation, allParams);
      
      // Use x-codeSamples (camelCase) like Memoreco
      operation['x-codeSamples'] = samples;
      
      // Remove old x-code-samples if present
      delete operation['x-code-samples'];
      
      updated++;
    }
  }
  
  console.log(`Updated ${updated} endpoints with code samples`);
  
  // Write back
  console.log('Writing updated OpenAPI spec...');
  fs.writeFileSync(OPENAPI_PATH, JSON.stringify(spec, null, 2));
  
  console.log('Done!');
}

main();

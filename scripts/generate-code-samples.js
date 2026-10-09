#!/usr/bin/env node
/**
 * Generate x-codeSamples for all public API endpoints
 *
 * Every endpoint gets samples in 8 languages:
 * - cURL
 * - Node.js, with the published `@widgetic/api-sdk` package (the only SDK that exists today)
 * - Python, Go, Ruby, PHP, Java and C#, as plain HTTP with the standard library of the language.
 *   No SDK is published for these, so a sample must not name one: a sample that imports a package
 *   that does not exist fails on the first line.
 *
 * What a sample is built from, all of it read from the OpenAPI description:
 * - The request body is resolved through `$ref`, so a call that takes `NewManagedUser` sends the
 *   fields of `NewManagedUser`, not a placeholder string.
 * - A call that requires an `Idempotency-Key` sends one, and a new one each time the sample runs
 *   (a fixed key would turn a second run into a replay of the first).
 * - The Node.js sample names the SDK's request properties the way the SDK does: the body under the
 *   camelCase name of its schema (`newManagedUser`), or under `<operationId>Request` when the body
 *   has no named schema, and the key as `idempotencyKey`.
 *
 * Usage: node scripts/generate-code-samples.js
 *
 * Run `npm run sync-openapi` first: the samples are added to the synced copy of the description.
 */

const fs = require('fs');
const path = require('path');

const OPENAPI_PATH = path.join(__dirname, '..', 'openapi', 'widgetic-api-public.json');
const BASE_URL = 'https://api.widgetic.com/v1';
const TYPESCRIPT_SDK_PACKAGE = '@widgetic/api-sdk';
const EXAMPLE_API_KEY = 'YOUR_API_KEY';
const EXAMPLE_UUID = '123e4567-e89b-12d3-a456-426614174000';
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];
const METHODS_WITHOUT_BODY = ['GET', 'HEAD', 'OPTIONS'];
const MOST_OPTIONAL_QUERY_PARAMETERS = 2;
const MOST_BODY_PROPERTIES = 4;
const MOST_SCHEMA_DEPTH = 3;
const IDEMPOTENCY_HEADER_NAME = 'Idempotency-Key';

// ---------------------------------------------------------------------------------------------
// Reading the description
// ---------------------------------------------------------------------------------------------

/** Undoes the escaping a JSON pointer segment carries (`~1` is `/`, `~0` is `~`). */
function decodePointerSegment(segment) {
  return decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Follows `$ref` (local references only) until a node that is not one. A cycle, or a reference
 * that points nowhere, gives back an empty object, so a sample is still produced.
 */
function resolveReference(spec, node) {
  let current = node;
  const visitedReferences = new Set();

  while (current && typeof current.$ref === 'string') {
    const reference = current.$ref;
    if (visitedReferences.has(reference) || !reference.startsWith('#/')) return {};
    visitedReferences.add(reference);

    let target = spec;
    for (const segment of reference.slice(2).split('/').map(decodePointerSegment)) {
      target = target === undefined || target === null ? undefined : target[segment];
    }
    if (target === undefined || target === null) return {};
    current = target;
  }

  return current;
}

/** The parameters of a call: the ones of its path and its own, `$ref` resolved, its own winning. */
function collectParameters(spec, pathItem, operation) {
  const mergedParameters = new Map();
  for (const rawParameter of [...(pathItem.parameters || []), ...(operation.parameters || [])]) {
    const parameter = resolveReference(spec, rawParameter);
    if (!parameter || !parameter.name || !parameter.in) continue;
    mergedParameters.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...mergedParameters.values()];
}

/** An example value for a path or query parameter. */
function exampleForParameter(spec, parameter) {
  const schema = resolveReference(spec, parameter.schema) || {};

  if (parameter.example !== undefined) return parameter.example;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.format === 'uuid') return EXAMPLE_UUID;

  switch (schema.type) {
    case 'integer':
      return schema.minimum > 0 ? schema.minimum : 1;
    case 'number':
      return schema.minimum > 0 ? schema.minimum : 1.5;
    case 'boolean':
      return true;
    default:
      break;
  }

  const lowerCaseName = parameter.name.toLowerCase();
  if (lowerCaseName.endsWith('id')) return EXAMPLE_UUID;
  if (lowerCaseName.includes('table')) return 'my_table';
  if (lowerCaseName.includes('feature')) return 'widgets.create';
  return 'example';
}

/** An example for a schema, resolved through `$ref`, short enough to read: required properties first, four at most. */
function exampleForSchema(spec, rawSchema, depth = 0) {
  const schema = resolveReference(spec, rawSchema) || {};

  if (schema.example !== undefined) return schema.example;
  if (depth > MOST_SCHEMA_DEPTH) return {};

  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const mergedExample = {};
    for (const part of schema.allOf) {
      const partExample = exampleForSchema(spec, part, depth + 1);
      if (partExample && typeof partExample === 'object' && !Array.isArray(partExample)) Object.assign(mergedExample, partExample);
    }
    return mergedExample;
  }

  const alternatives = schema.oneOf || schema.anyOf;
  if (Array.isArray(alternatives) && alternatives.length > 0) return exampleForSchema(spec, alternatives[0], depth + 1);

  if (schema.type === 'object' || schema.properties) {
    const properties = schema.properties || {};
    const requiredNames = (schema.required || []).filter((name) => properties[name]);
    const optionalNames = Object.keys(properties).filter((name) => !requiredNames.includes(name));
    const exampleObject = {};
    for (const name of [...requiredNames, ...optionalNames].slice(0, Math.max(MOST_BODY_PROPERTIES, requiredNames.length))) {
      exampleObject[name] = exampleForSchema(spec, properties[name], depth + 1);
    }
    return exampleObject;
  }

  if (schema.type === 'array') {
    return [schema.items ? exampleForSchema(spec, schema.items, depth + 1) : 'example'];
  }

  if (schema.default !== undefined) return schema.default;

  switch (schema.type) {
    case 'string':
      if (schema.format === 'uuid') return EXAMPLE_UUID;
      if (schema.format === 'email') return 'user@example.com';
      if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com';
      if (schema.format === 'date-time') return '2026-01-15T10:30:00Z';
      if (schema.format === 'date') return '2026-01-15';
      return 'example';
    case 'integer':
      return schema.minimum > 0 ? schema.minimum : 1;
    case 'number':
      return schema.minimum > 0 ? schema.minimum : 1.5;
    case 'boolean':
      return true;
    default:
      return 'example';
  }
}

/** The first example an `examples` map holds, or undefined. */
function firstNamedExample(examples) {
  const firstExample = Object.values(examples || {})[0];
  return firstExample && typeof firstExample === 'object' ? firstExample.value : undefined;
}

/**
 * What a call sends as its body: JSON (with the name of its schema when it has one, which the SDK names its
 * property after), a multipart form (its fields), or nothing.
 */
function describeRequestBody(spec, operation) {
  const requestBody = resolveReference(spec, operation.requestBody);
  if (!requestBody || !requestBody.content) return { kind: 'none' };

  const jsonContent = requestBody.content['application/json'];
  if (jsonContent) {
    const schemaNode = jsonContent.schema;
    const example =
      jsonContent.example !== undefined
        ? jsonContent.example
        : firstNamedExample(jsonContent.examples) !== undefined
          ? firstNamedExample(jsonContent.examples)
          : exampleForSchema(spec, schemaNode);
    const schemaName = schemaNode && typeof schemaNode.$ref === 'string' ? schemaNode.$ref.split('/').pop() : null;
    return { kind: 'json', example, schemaName };
  }

  const multipartContent = requestBody.content['multipart/form-data'];
  if (multipartContent) {
    const schema = resolveReference(spec, multipartContent.schema) || {};
    const fields = Object.entries(schema.properties || {}).map(([name, rawProperty]) => {
      const property = resolveReference(spec, rawProperty) || {};
      return { name, isFile: property.format === 'binary' };
    });
    return { kind: 'multipart', fields };
  }

  return { kind: 'none' };
}

// ---------------------------------------------------------------------------------------------
// The request every sample describes
// ---------------------------------------------------------------------------------------------

/** First character lower case: `NewManagedUser` is `newManagedUser`, as the SDK names the property. */
function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** `partner_id` and `partner-id` are `partnerId`: how the SDK names a parameter. */
function toCamelCase(text) {
  return text.replace(/[-_]+([a-zA-Z0-9])/g, (_match, letter) => letter.toUpperCase());
}

/** The class the SDK has for a tag: `Managed Users` is `ManagedUsersApi`. */
function getApiClassName(tag) {
  return `${String(tag).replace(/[^A-Za-z0-9]+/g, '')}Api`;
}

/**
 * Everything a sample needs, worked out once: the address, the headers, the body, and the SDK's names for things.
 * `idempotencyRequired` is true when the call refuses a request without an Idempotency-Key header.
 */
function buildRequestModel(spec, method, pathTemplate, pathItem, operation) {
  const upperCaseMethod = method.toUpperCase();
  const parameters = collectParameters(spec, pathItem, operation);

  const pathParameters = parameters
    .filter((parameter) => parameter.in === 'path')
    .map((parameter) => ({ name: parameter.name, value: exampleForParameter(spec, parameter) }));

  // Required query parameters always; optional ones only for a read, and only a couple of them
  const queryParameters = [];
  let optionalQueryParametersShown = 0;
  for (const parameter of parameters.filter((candidate) => candidate.in === 'query')) {
    if (parameter.required === true) {
      queryParameters.push({ name: parameter.name, value: exampleForParameter(spec, parameter) });
    } else if (upperCaseMethod === 'GET' && optionalQueryParametersShown < MOST_OPTIONAL_QUERY_PARAMETERS) {
      optionalQueryParametersShown += 1;
      queryParameters.push({ name: parameter.name, value: exampleForParameter(spec, parameter) });
    }
  }

  const idempotencyParameter = parameters.find(
    (parameter) => parameter.in === 'header' && String(parameter.name).toLowerCase() === IDEMPOTENCY_HEADER_NAME.toLowerCase()
  );
  const idempotencyRequired = Boolean(idempotencyParameter && idempotencyParameter.required === true);

  const examplePath = pathTemplate.replace(/\{([^}]+)\}/g, (_match, name) => {
    const found = pathParameters.find((parameter) => parameter.name === name);
    return encodeURIComponent(String(found ? found.value : 'example'));
  });
  const queryString =
    queryParameters.length > 0
      ? '?' + queryParameters.map((parameter) => `${encodeURIComponent(parameter.name)}=${encodeURIComponent(String(parameter.value))}`).join('&')
      : '';

  const body = METHODS_WITHOUT_BODY.includes(upperCaseMethod) ? { kind: 'none' } : describeRequestBody(spec, operation);
  const jsonText = body.kind === 'json' ? JSON.stringify(body.example, null, 2) : null;

  const operationId = operation.operationId || 'execute';
  const tag = (operation.tags && operation.tags[0]) || 'API';

  return {
    method: upperCaseMethod,
    url: `${BASE_URL}${examplePath}${queryString}`,
    operationId,
    className: getApiClassName(tag),
    pathParameters,
    queryParameters,
    body,
    jsonText,
    idempotencyRequired,
    // How the SDK names the property that holds the body
    sdkBodyPropertyName: body.kind === 'json' ? (body.schemaName ? lowerFirst(body.schemaName) : `${lowerFirst(operationId)}Request`) : null
  };
}

// ---------------------------------------------------------------------------------------------
// Writing literals
// ---------------------------------------------------------------------------------------------

/** A JavaScript literal for a JSON value, indented the way a person would write it. */
function toJavaScriptLiteral(value, indentLevel = 0) {
  const indent = '  '.repeat(indentLevel);
  const innerIndent = '  '.repeat(indentLevel + 1);

  if (value === null) return 'null';
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => innerIndent + toJavaScriptLiteral(item, indentLevel + 1)).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([key, entryValue]) => {
      const formattedKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : toJavaScriptLiteral(String(key));
      return `${innerIndent}${formattedKey}: ${toJavaScriptLiteral(entryValue, indentLevel + 1)}`;
    });
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return 'undefined';
}

/** A Go raw string for text, or a quoted one when the text holds a backtick. */
function toGoStringLiteral(text) {
  return text.includes('`') ? JSON.stringify(text) : '`' + text + '`';
}

/** The sentence every language prints above a call that sends a form: the fields are in the cURL sample. */
const MULTIPART_NOTE = 'This call sends a multipart/form-data body. The cURL sample shows its fields.';

// ---------------------------------------------------------------------------------------------
// The samples
// ---------------------------------------------------------------------------------------------

/** cURL */
function generateCurlSample(model) {
  const lines = [`curl -X ${model.method} '${model.url}'`, `  -H 'Authorization: Bearer ${EXAMPLE_API_KEY}'`];

  if (model.idempotencyRequired) lines.push(`  -H "${IDEMPOTENCY_HEADER_NAME}: $(uuidgen)"`);

  if (model.body.kind === 'json') {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d '${model.jsonText.replace(/'/g, "'\\''")}'`);
  } else if (model.body.kind === 'multipart') {
    for (const field of model.body.fields) {
      lines.push(`  -F '${field.name}=${field.isFile ? '@/path/to/file' : 'example'}'`);
    }
  }

  return lines.join(' \\\n');
}

/** Node.js, with the SDK */
function generateTypeScriptSample(model) {
  // The SDK's method has the name of the operationId
  const methodName = model.operationId;
  const requestProperties = [];

  for (const parameter of [...model.pathParameters, ...model.queryParameters]) {
    requestProperties.push(`${toCamelCase(parameter.name)}: ${toJavaScriptLiteral(parameter.value)}`);
  }
  if (model.body.kind === 'json') {
    requestProperties.push(`${model.sdkBodyPropertyName}: ${toJavaScriptLiteral(model.body.example, 2)}`);
  }
  if (model.idempotencyRequired) requestProperties.push('idempotencyKey: randomUUID()');

  const lines = [];
  if (model.idempotencyRequired) lines.push(`import { randomUUID } from 'node:crypto';`);
  lines.push(`import { ${model.className} } from '${TYPESCRIPT_SDK_PACKAGE}';`, '');
  lines.push(`const api = new ${model.className}('${EXAMPLE_API_KEY}');`, '');
  if (model.body.kind === 'multipart') lines.push(`// ${MULTIPART_NOTE}`);
  lines.push('try {');
  if (requestProperties.length > 0) {
    lines.push(`  const result = await api.${methodName}({`);
    lines.push(requestProperties.map((property) => `    ${property}`).join(',\n'));
    lines.push('  });');
  } else {
    lines.push(`  const result = await api.${methodName}();`);
  }
  lines.push('  console.log(result);');
  lines.push('} catch (error) {');
  lines.push(`  console.error('Error:', error.message);`);
  lines.push('}');

  return lines.join('\n');
}

/** Python, with requests */
function generatePythonSample(model) {
  const lines = [];
  if (model.idempotencyRequired) lines.push('import uuid');
  lines.push('import requests', '');

  if (model.body.kind === 'multipart') lines.push(`# ${MULTIPART_NOTE}`);
  if (model.body.kind === 'json') lines.push(`payload = r"""\n${model.jsonText}\n"""`, '');

  lines.push('headers = {');
  lines.push(`    "Authorization": "Bearer ${EXAMPLE_API_KEY}",`);
  if (model.body.kind === 'json') lines.push('    "Content-Type": "application/json",');
  if (model.idempotencyRequired) lines.push(`    "${IDEMPOTENCY_HEADER_NAME}": str(uuid.uuid4()),`);
  lines.push('}', '');

  lines.push(`response = requests.request("${model.method}", "${model.url}", headers=headers${model.body.kind === 'json' ? ', data=payload' : ''})`);
  lines.push('print(response.status_code)');
  lines.push('print(response.text)');

  return lines.join('\n');
}

/** Go, with net/http */
function generateGoSample(model) {
  const needsTime = model.idempotencyRequired;
  const needsStrings = model.body.kind === 'json';

  const lines = ['package main', '', 'import ('];
  lines.push('    "fmt"', '    "io"', '    "net/http"');
  if (needsStrings) lines.push('    "strings"');
  if (needsTime) lines.push('    "time"');
  lines.push(')', '', 'func main() {');

  if (model.body.kind === 'multipart') lines.push(`    // ${MULTIPART_NOTE}`);
  if (model.body.kind === 'json') {
    lines.push(`    payload := strings.NewReader(${toGoStringLiteral(model.jsonText)})`);
    lines.push(`    request, err := http.NewRequest("${model.method}", "${model.url}", payload)`);
  } else {
    lines.push(`    request, err := http.NewRequest("${model.method}", "${model.url}", nil)`);
  }
  lines.push('    if err != nil {', '        fmt.Printf("Error: %v\\n", err)', '        return', '    }');
  lines.push(`    request.Header.Set("Authorization", "Bearer ${EXAMPLE_API_KEY}")`);
  if (model.body.kind === 'json') lines.push('    request.Header.Set("Content-Type", "application/json")');
  if (model.idempotencyRequired) {
    lines.push(`    request.Header.Set("${IDEMPOTENCY_HEADER_NAME}", fmt.Sprintf("example-%d", time.Now().UnixNano()))`);
  }
  lines.push('');
  lines.push('    response, err := http.DefaultClient.Do(request)');
  lines.push('    if err != nil {', '        fmt.Printf("Error: %v\\n", err)', '        return', '    }');
  lines.push('    defer response.Body.Close()', '');
  lines.push('    body, _ := io.ReadAll(response.Body)');
  lines.push('    fmt.Println(response.StatusCode, string(body))');
  lines.push('}');

  return lines.join('\n');
}

/** Ruby, with net/http */
function generateRubySample(model) {
  const methodClassName = model.method.charAt(0) + model.method.slice(1).toLowerCase();

  const lines = ["require 'net/http'"];
  if (model.idempotencyRequired) lines.push("require 'securerandom'");
  lines.push('', `uri = URI('${model.url}')`);
  lines.push(`request = Net::HTTP::${methodClassName}.new(uri)`);
  lines.push(`request['Authorization'] = 'Bearer ${EXAMPLE_API_KEY}'`);
  if (model.body.kind === 'json') lines.push("request['Content-Type'] = 'application/json'");
  if (model.idempotencyRequired) lines.push(`request['${IDEMPOTENCY_HEADER_NAME}'] = SecureRandom.uuid`);
  if (model.body.kind === 'multipart') lines.push(`# ${MULTIPART_NOTE}`);
  if (model.body.kind === 'json') {
    lines.push('request.body = <<~\'JSON\'');
    lines.push(model.jsonText.split('\n').map((line) => `  ${line}`).join('\n'));
    lines.push('JSON');
  }
  lines.push('');
  lines.push('response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) { |http| http.request(request) }');
  lines.push('puts response.code');
  lines.push('puts response.body');

  return lines.join('\n');
}

/** PHP, with cURL */
function generatePhpSample(model) {
  const lines = ['<?php', ''];

  if (model.body.kind === 'multipart') lines.push(`// ${MULTIPART_NOTE}`);
  if (model.body.kind === 'json') lines.push("$payload = <<<'JSON'", model.jsonText, 'JSON;', '');

  lines.push(`$curl = curl_init('${model.url}');`);
  lines.push('curl_setopt_array($curl, [');
  lines.push(`    CURLOPT_CUSTOMREQUEST => '${model.method}',`);
  lines.push('    CURLOPT_RETURNTRANSFER => true,');
  lines.push('    CURLOPT_HTTPHEADER => [');
  lines.push(`        'Authorization: Bearer ${EXAMPLE_API_KEY}',`);
  if (model.body.kind === 'json') lines.push("        'Content-Type: application/json',");
  if (model.idempotencyRequired) lines.push(`        '${IDEMPOTENCY_HEADER_NAME}: ' . bin2hex(random_bytes(16)),`);
  lines.push('    ],');
  if (model.body.kind === 'json') lines.push('    CURLOPT_POSTFIELDS => $payload,');
  lines.push(']);', '');
  lines.push('$response = curl_exec($curl);');
  lines.push('if ($response === false) {');
  lines.push("    echo 'Error: ' . curl_error($curl);");
  lines.push('} else {');
  lines.push("    echo curl_getinfo($curl, CURLINFO_HTTP_CODE) . \"\\n\" . $response;");
  lines.push('}');
  lines.push('curl_close($curl);');

  return lines.join('\n');
}

/** Java, with java.net.http */
function generateJavaSample(model) {
  const bodyPublisher =
    model.body.kind === 'json' ? `HttpRequest.BodyPublishers.ofString(${JSON.stringify(model.jsonText)})` : 'HttpRequest.BodyPublishers.noBody()';

  const lines = ['import java.net.URI;', 'import java.net.http.HttpClient;', 'import java.net.http.HttpRequest;', 'import java.net.http.HttpResponse;'];
  if (model.idempotencyRequired) lines.push('import java.util.UUID;');
  lines.push('', 'public class Example {', '    public static void main(String[] args) throws Exception {');
  if (model.body.kind === 'multipart') lines.push(`        // ${MULTIPART_NOTE}`);
  lines.push('        HttpRequest request = HttpRequest.newBuilder()');
  lines.push(`            .uri(URI.create("${model.url}"))`);
  lines.push(`            .header("Authorization", "Bearer ${EXAMPLE_API_KEY}")`);
  if (model.body.kind === 'json') lines.push('            .header("Content-Type", "application/json")');
  if (model.idempotencyRequired) lines.push(`            .header("${IDEMPOTENCY_HEADER_NAME}", UUID.randomUUID().toString())`);
  lines.push(`            .method("${model.method}", ${bodyPublisher})`);
  lines.push('            .build();', '');
  lines.push('        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());');
  lines.push('        System.out.println(response.statusCode() + " " + response.body());');
  lines.push('    }', '}');

  return lines.join('\n');
}

/** C#, with HttpClient */
function generateCSharpSample(model) {
  const methodName = model.method.charAt(0) + model.method.slice(1).toLowerCase();

  const lines = ['using System;', 'using System.Net.Http;'];
  if (model.body.kind === 'json') lines.push('using System.Text;');
  lines.push('', 'using var client = new HttpClient();');
  if (model.body.kind === 'multipart') lines.push(`// ${MULTIPART_NOTE}`);
  lines.push(`var request = new HttpRequestMessage(HttpMethod.${methodName}, "${model.url}");`);
  lines.push(`request.Headers.Add("Authorization", "Bearer ${EXAMPLE_API_KEY}");`);
  if (model.idempotencyRequired) lines.push(`request.Headers.Add("${IDEMPOTENCY_HEADER_NAME}", Guid.NewGuid().ToString());`);
  if (model.body.kind === 'json') {
    lines.push(`request.Content = new StringContent(${JSON.stringify(model.jsonText)}, Encoding.UTF8, "application/json");`);
  }
  lines.push('');
  lines.push('var response = await client.SendAsync(request);');
  lines.push('Console.WriteLine($"{(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");');

  return lines.join('\n');
}

/** All the samples of one call, in the order the reference shows them. */
function generateCodeSamples(model) {
  return [
    { lang: 'curl', label: 'cURL', source: generateCurlSample(model) },
    { lang: 'javascript', label: 'Node.js', source: generateTypeScriptSample(model) },
    { lang: 'python', label: 'Python', source: generatePythonSample(model) },
    { lang: 'go', label: 'Go', source: generateGoSample(model) },
    { lang: 'ruby', label: 'Ruby', source: generateRubySample(model) },
    { lang: 'php', label: 'PHP', source: generatePhpSample(model) },
    { lang: 'java', label: 'Java', source: generateJavaSample(model) },
    { lang: 'csharp', label: 'C#', source: generateCSharpSample(model) }
  ];
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function main() {
  console.log('Loading OpenAPI spec...');
  const spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));

  let updatedOperations = 0;
  let operationsWithIdempotencyKey = 0;
  let operationsWithBody = 0;

  console.log('Generating code samples...');

  for (const [pathTemplate, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      try {
        const model = buildRequestModel(spec, method, pathTemplate, pathItem, operation);

        // x-codeSamples (camelCase), the name the reference reads
        operation['x-codeSamples'] = generateCodeSamples(model);
        // Remove the old spelling if present
        delete operation['x-code-samples'];

        updatedOperations += 1;
        if (model.idempotencyRequired) operationsWithIdempotencyKey += 1;
        if (model.body.kind !== 'none') operationsWithBody += 1;
      } catch (error) {
        console.error(`Could not generate the samples of ${method.toUpperCase()} ${pathTemplate}:`, error && error.message ? error.message : error);
        process.exitCode = 1;
      }
    }
  }

  console.log(`Updated ${updatedOperations} endpoints with code samples (${operationsWithBody} send a body, ${operationsWithIdempotencyKey} send an Idempotency-Key)`);

  console.log('Writing updated OpenAPI spec...');
  fs.writeFileSync(OPENAPI_PATH, JSON.stringify(spec, null, 2));

  console.log('Done!');
}

main();

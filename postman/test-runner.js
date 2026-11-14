/**
 * DISHA 8.2 — Automated Postman Collection Test Runner
 * Executes all collection requests in sequence, chains variables,
 * and validates responses against live Render Production and Localhost.
 */
const fs = require('fs');
const path = require('path');

const envFile = process.argv[2] || 'DISHA_8.2_Production.postman_environment.json';
const collectionFile = 'DISHA_8.2_Production.postman_collection.json';

const collection = JSON.parse(fs.readFileSync(path.join(__dirname, collectionFile), 'utf8'));
const environment = JSON.parse(fs.readFileSync(path.join(__dirname, envFile), 'utf8'));

// Build initial environment dictionary
const envVars = {};
for (const v of environment.values) {
  envVars[v.key] = v.value;
}

function resolveVariables(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    return envVars[key] !== undefined ? envVars[key] : `{{${key}}}`;
  });
}

function resolveUrl(urlObj) {
  if (typeof urlObj === 'string') return resolveVariables(urlObj);
  let raw = resolveVariables(urlObj.raw);
  return raw;
}

async function runTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`🚀 RUNNING DISHA 8.2 POSTMAN SUITE: ${environment.name}`);
  console.log(`📅 Execution Timestamp: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let passedTests = 0;
  let failedTests = 0;
  let totalRequests = 0;

  for (const folder of collection.item) {
    console.log(`\n📁 FOLDER: ${folder.name}`);
    console.log('─'.repeat(65));

    for (const item of folder.item) {
      totalRequests++;
      const req = item.request;
      const method = req.method.toUpperCase();
      const url = resolveUrl(req.url);

      const headers = {};
      if (req.header) {
        for (const h of req.header) {
          headers[h.key] = resolveVariables(h.value);
        }
      }

      let body = undefined;
      if (req.body && req.body.raw) {
        body = resolveVariables(req.body.raw);
      }

      const startTime = Date.now();
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: (method !== 'GET' && method !== 'HEAD') ? body : undefined
        });

        const duration = Date.now() - startTime;
        const responseText = await response.text();
        let responseJson = null;
        try { responseJson = JSON.parse(responseText); } catch (_) {}

        // Mock Postman context
        const tests = [];
        const pm = {
          response: {
            code: response.status,
            status: response.statusText,
            headers: {
              get: (k) => {
                const headerKey = Object.keys(response.headers.raw ? response.headers.raw() : {})
                  .find(key => key.toLowerCase() === k.toLowerCase());
                return response.headers.get(k) || (headerKey ? response.headers.get(headerKey) : null);
              }
            },
            json: () => responseJson,
            text: () => responseText,
            to: {
              have: {
                status: (expected) => {
                  if (response.status !== expected) {
                    throw new Error(`Expected status ${expected}, got ${response.status}`);
                  }
                }
              }
            }
          },
          environment: {
            set: (k, v) => { envVars[k] = v; },
            get: (k) => envVars[k]
          },
          test: (name, fn) => {
            try {
              fn();
              tests.push({ name, pass: true });
              passedTests++;
            } catch (err) {
              tests.push({ name, pass: false, error: err.message });
              failedTests++;
            }
          },
          expect: (actual) => ({
            to: {
              eql: (expected) => {
                if (actual !== expected) throw new Error(`Expected '${expected}', got '${actual}'`);
              },
              equal: (expected) => {
                if (actual !== expected) throw new Error(`Expected '${expected}', got '${actual}'`);
              },
              include: (sub) => {
                if (Array.isArray(actual)) {
                  if (!actual.includes(sub)) throw new Error(`Array [${actual}] does not include '${sub}'`);
                } else if (typeof actual === 'string') {
                  if (!actual.includes(sub)) throw new Error(`String '${actual}' does not include '${sub}'`);
                } else if (actual && typeof actual === 'object') {
                  if (!(sub in actual)) throw new Error(`Object does not include property '${sub}'`);
                }
              },
              match: (regex) => {
                if (!regex.test(String(actual))) throw new Error(`Value '${actual}' does not match regex ${regex}`);
              },
              have: {
                property: (prop) => {
                  if (!actual || actual[prop] === undefined) throw new Error(`Object does not have property '${prop}'`);
                }
              },
              get be() {
                return {
                  get true() {
                    if (actual !== true) throw new Error(`Expected true, got ${actual}`);
                  },
                  get false() {
                    if (actual !== false) throw new Error(`Expected false, got ${actual}`);
                  },
                  get ok() {
                    if (!actual) throw new Error(`Expected truthy value, got ${actual}`);
                  },
                  a: (type) => {
                    if (typeof actual !== type) throw new Error(`Expected type '${type}', got '${typeof actual}'`);
                  },
                  an: (type) => {
                    if (type === 'array') {
                      if (!Array.isArray(actual)) throw new Error(`Expected array, got ${typeof actual}`);
                    } else if (type === 'object') {
                      if (typeof actual !== 'object' || Array.isArray(actual) || actual === null) {
                        throw new Error(`Expected object, got ${typeof actual}`);
                      }
                    } else {
                      if (typeof actual !== type) throw new Error(`Expected type '${type}', got '${typeof actual}'`);
                    }
                  },
                  above: (val) => {
                    if (Number(actual) <= val) throw new Error(`Expected ${actual} > ${val}`);
                  },
                  below: (val) => {
                    if (Number(actual) >= val) throw new Error(`Expected ${actual} < ${val}`);
                  }
                };
              }
            }
          })
        };

        // Execute Postman Test Scripts
        if (item.event) {
          for (const ev of item.event) {
            if (ev.listen === 'test' && ev.script && ev.script.exec) {
              const code = ev.script.exec.join('\n');
              try {
                const runScript = new Function('pm', code);
                runScript(pm);
              } catch (scriptErr) {
                tests.push({ name: 'Script Evaluation', pass: false, error: scriptErr.message });
                failedTests++;
              }
            }
          }
        }

        const icon = tests.every(t => t.pass) ? '✅' : '❌';
        console.log(`${icon} [${method}] ${item.name} (${duration}ms, HTTP ${response.status})`);
        for (const t of tests) {
          if (t.pass) {
            console.log(`   └─ ✔ ${t.name}`);
          } else {
            console.log(`   └─ ✖ ${t.name}: ${t.error}`);
          }
        }

      } catch (err) {
        failedTests++;
        console.log(`❌ [${method}] ${item.name} -> Network / Protocol Error: ${err.message}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`🏁 TEST EXECUTION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log(`📊 TOTAL REQUESTS EXECUTED: ${totalRequests}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal suite failure:', err);
  process.exit(1);
});

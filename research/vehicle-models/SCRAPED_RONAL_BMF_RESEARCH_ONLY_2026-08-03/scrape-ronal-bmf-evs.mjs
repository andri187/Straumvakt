import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLIENT_ID = "RONAL-ae2f6cc4-64cd-c4ea-33a3-d38c43994ce8";
const CLIENT_SCRIPT_URL = `https://3pc.mx-live.com/scripts/client/${CLIENT_ID}`;
const SOURCE_PAGE = "https://www.ronal-wheels.com/int/configurator-promo";
const SERVICE_ROOT = "https://service.mx-live.com/api/json";
const SOURCE_MARKER = "SCRAPED_RONAL_BMF_RESEARCH_ONLY";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 Chrome/140 Safari/537.36";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultOutputDir = path.join(scriptDir, SOURCE_MARKER);
const probeOnly = process.argv.includes("--probe");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const makeArgument = process.argv.find((argument) => argument.startsWith("--make="));
const maxMakesArgument = process.argv.find((argument) => argument.startsWith("--max-makes="));
const outputDir = path.resolve(
  outputArgument?.slice("--output=".length) ||
    process.env.RONAL_SCRAPE_OUTPUT ||
    defaultOutputDir,
);
const makeFilter = String(
  makeArgument?.slice("--make=".length) || process.env.RONAL_SCRAPE_MAKE || "",
).trim().toLowerCase();
const maxMakes = Number.parseInt(
  maxMakesArgument?.slice("--max-makes=".length) || process.env.RONAL_SCRAPE_MAX_MAKES || "0",
  10,
);

const state = {
  token: "",
  hmacKey: "",
  clientScript: "",
  requestCount: 0,
  refreshedAt: "",
  clientScriptSha256: "",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomAlphaNumeric(length) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(length);
  let value = "";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return value;
}

function parseClientSession(clientScript) {
  const token = clientScript.match(/token\s*:\s*"([A-Za-z0-9]+)"/)?.[1];
  const hmacKey = clientScript.match(
    /\.D\(\s*"([A-Za-z0-9+/=]+)"\s*,\s*"TEXT"\s*\)/,
  )?.[1];
  if (!token || !hmacKey) {
    throw new Error("Could not locate the BMF session token and signing key in the client script.");
  }
  return { token, hmacKey };
}

async function refreshClientSession() {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let response;
    try {
      response = await fetch(`${CLIENT_SCRIPT_URL}?scrape_session=${Date.now()}-${attempt}`, {
        headers: {
          Accept: "application/javascript,text/javascript,*/*;q=0.8",
          Referer: SOURCE_PAGE,
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      lastError = error;
      await sleep(250 * attempt);
      continue;
    }
    if (!response.ok) {
      lastError = new Error(
        `Client script request failed: ${response.status} ${response.statusText}`,
      );
      await sleep(250 * attempt);
      continue;
    }

    const clientScript = await response.text();
    try {
      const { token, hmacKey } = parseClientSession(clientScript);
      state.token = token;
      state.hmacKey = hmacKey;
      state.clientScript = clientScript;
      state.clientScriptSha256 = createHash("sha256").update(clientScript).digest("hex");
      state.refreshedAt = new Date().toISOString();
      return;
    } catch (error) {
      const contentType = response.headers.get("content-type") || "unknown";
      lastError = new Error(
        `${error.message} Response was ${clientScript.length} bytes (${contentType}).`,
      );
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

function authorizationHeader(url, method) {
  const timestamp = Date.now();
  const nonce = randomAlphaNumeric(10);
  const apiIndex = url.indexOf("api");
  if (apiIndex < 0) throw new Error(`Cannot sign a URL without an api path: ${url}`);

  const message = `${url.slice(apiIndex)}:${method}:${nonce}:${timestamp}`.toLowerCase();
  const digest = createHmac("sha3-512", state.hmacKey)
    .update(message, "utf8")
    .digest("base64");
  return `ThreePC ${digest}:${nonce}:${timestamp}`;
}

function apiUrl(controller, actionPath) {
  return `${SERVICE_ROOT}/${controller}/${state.token}/en/${actionPath}`;
}

async function apiRequest(controller, actionPath, options = {}, attempt = 0) {
  const method = (options.method || "GET").toUpperCase();
  const url = apiUrl(controller, actionPath);
  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    Authorization: authorizationHeader(url, method),
    Origin: "https://www.ronal-wheels.com",
    Referer: SOURCE_PAGE,
    "User-Agent": USER_AGENT,
    "X-Requested-With": "XMLHttpRequest",
    ...options.headers,
  };

  let body;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(options.body);
  }

  state.requestCount += 1;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    if (attempt < 3) {
      await sleep(500 * (attempt + 1));
      return apiRequest(controller, actionPath, options, attempt + 1);
    }
    throw error;
  }
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (response.ok) return payload;

  const expired = response.status === 403 && Number(payload?.Status) === 403200;
  if (attempt < 3 && expired) {
    await refreshClientSession();
    return apiRequest(controller, actionPath, options, attempt + 1);
  }

  const transient = response.status === 408 || response.status === 429 || response.status >= 500;
  if (attempt < 3 && transient) {
    await sleep(500 * (attempt + 1));
    return apiRequest(controller, actionPath, options, attempt + 1);
  }

  const description = payload?.Description || payload?.Message || String(payload).slice(0, 300);
  throw new Error(`${method} ${actionPath} failed: ${response.status} ${description}`);
}

function encodeSegment(value) {
  const text = String(value ?? "");
  try {
    return encodeURI(decodeURIComponent(text));
  } catch {
    return encodeURI(text);
  }
}

function isPureElectric(engine) {
  const fuel = String(engine?.Value?.Fuel || engine?.Fuel || "").trim().toLowerCase();
  return /electric|electrical|battery/.test(fuel) && !/hybrid|petrol|gasoline|diesel/.test(fuel);
}

function toCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => toCsvValue(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function scrapeCatalogue() {
  let scrapedAt = new Date().toISOString();
  const sourceMakes = await apiRequest("vehicle", "make");
  if (!Array.isArray(sourceMakes)) throw new Error("The make endpoint did not return an array.");
  let makes = sourceMakes;
  if (makeFilter) {
    makes = makes.filter((make) =>
      `${make.Key} ${make.Value}`.toLowerCase().includes(makeFilter),
    );
  }
  if (maxMakes > 0) makes = makes.slice(0, maxMakes);

  if (probeOnly) {
    console.log(JSON.stringify({ makes: makes.length, sample: makes.slice(0, 5) }, null, 2));
    return;
  }

  await mkdir(outputDir, { recursive: true });
  const checkpointPath = path.join(outputDir, "SCRAPED_RONAL_BMF_checkpoint.json");
  const failures = [];
  const allFuelValues = new Set();
  const electricVariants = [];
  const completedMakeKeys = new Set();
  let modelCount = 0;
  let bodyTypeCount = 0;
  let engineCount = 0;

  try {
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    if (checkpoint.source_marker === SOURCE_MARKER) {
      scrapedAt = checkpoint.scraped_at_utc || scrapedAt;
      failures.push(...(checkpoint.failures || []));
      electricVariants.push(...(checkpoint.electric_variants || []));
      for (const fuel of checkpoint.fuel_values || []) allFuelValues.add(fuel);
      for (const makeKey of checkpoint.completed_make_keys || []) completedMakeKeys.add(makeKey);
      modelCount = checkpoint.model_count || 0;
      bodyTypeCount = checkpoint.body_type_count || 0;
      engineCount = checkpoint.engine_count || 0;
      state.requestCount += checkpoint.request_count || 0;
      console.log(
        `Resuming ${completedMakeKeys.size}/${makes.length} completed manufacturers from checkpoint.`,
      );
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  async function saveCheckpoint(status = "in_progress") {
    await writeFile(
      checkpointPath,
      JSON.stringify(
        {
          source_marker: SOURCE_MARKER,
          production_allowed: false,
          status,
          scraped_at_utc: scrapedAt,
          updated_at_utc: new Date().toISOString(),
          completed_make_keys: [...completedMakeKeys],
          model_count: modelCount,
          body_type_count: bodyTypeCount,
          engine_count: engineCount,
          request_count: state.requestCount,
          fuel_values: [...allFuelValues].sort(),
          failures,
          electric_variants: electricVariants,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  for (const [makeIndex, make] of makes.entries()) {
    if (completedMakeKeys.has(String(make.Key))) continue;
    for (let index = failures.length - 1; index >= 0; index -= 1) {
      if (failures[index].make === make.Key) failures.splice(index, 1);
    }
    let modelsPayload;
    try {
      modelsPayload = await apiRequest("vehicle", `model/${encodeSegment(make.Key)}`, {
        method: "POST",
        body: { SinceYear: null },
      });
    } catch (error) {
      failures.push({ stage: "models", make: make.Key, error: error.message });
      await saveCheckpoint();
      continue;
    }

    const models = modelsPayload?.ModelsData || modelsPayload || [];
    modelCount += models.length;
    console.log(`[${makeIndex + 1}/${makes.length}] ${make.Value || make.Key}: ${models.length} models`);

    for (const model of models) {
      let bodyTypes;
      try {
        bodyTypes = await apiRequest(
          "vehicle",
          `bodyType/${encodeSegment(make.Key)}/${encodeSegment(model.Key)}`,
        );
      } catch (error) {
        failures.push({
          stage: "bodyTypes",
          make: make.Key,
          model: model.Key,
          error: error.message,
        });
        continue;
      }

      if (!Array.isArray(bodyTypes)) continue;
      bodyTypeCount += bodyTypes.length;

      const engineGroups = await mapLimit(bodyTypes, 3, async (bodyType) => {
        try {
          const engines = await apiRequest("vehicle", `engineType/${encodeSegment(bodyType.Key)}`);
          return { bodyType, engines: Array.isArray(engines) ? engines : [] };
        } catch (error) {
          failures.push({
            stage: "engineTypes",
            make: make.Key,
            model: model.Key,
            bodyType: bodyType.Key,
            error: error.message,
          });
          return { bodyType, engines: [] };
        }
      });

      for (const { bodyType, engines } of engineGroups) {
        engineCount += engines.length;
        for (const engine of engines) {
          const fuel = String(engine?.Value?.Fuel || engine?.Fuel || "").trim();
          if (fuel) allFuelValues.add(fuel);
          if (!isPureElectric(engine)) continue;

          let vehicle = null;
          let detailError = "";
          try {
            vehicle = await apiRequest("vehicle", `vehicle/${encodeSegment(engine.Key)}`);
          } catch (error) {
            detailError = error.message;
            failures.push({
              stage: "vehicle",
              make: make.Key,
              model: model.Key,
              bodyType: bodyType.Key,
              engine: engine.Key,
              error: error.message,
            });
          }

          const body = bodyType.Value || {};
          const powertrain = engine.Value || {};
          electricVariants.push({
            source_marker: SOURCE_MARKER,
            production_allowed: false,
            scraped_at_utc: scrapedAt,
            source_provider: "BMF Media Information Technology GmbH / ProVis4",
            source_site: "RONAL wheel configurator",
            source_page: SOURCE_PAGE,
            source_client_id: CLIENT_ID,
            make_key: make.Key,
            make_name: make.Value || make.Key,
            model_key: model.Key,
            model_name: model.Value || model.Key,
            body_type_key: bodyType.Key,
            body_name: body.Name || "",
            body_style: body.BodyStyle || "",
            model_bodywork: body.ModelBodywork || "",
            model_type: body.ModelType || "",
            year_from: body.YearFrom || "",
            year_to: body.YearTo || "",
            body_power_kw_from: body.KwFrom ?? "",
            body_power_kw_to: body.KwTo ?? "",
            engine_key: engine.Key,
            selling_name: powertrain.SellingName || vehicle?.SellingName || "",
            fuel,
            power_hp: powertrain.PowerHp ?? "",
            power_kw: powertrain.PowerKw ?? "",
            drive: powertrain.DrivingAxle || "",
            engine_capacity: powertrain.EngineCapacity || "",
            vehicle_id_code: vehicle?.IdCode || engine.Key,
            vehicle_manufacturer: vehicle?.Manufacturer || "",
            vehicle_body_type: vehicle?.BodyType || "",
            vehicle_power: vehicle?.Power || "",
            vehicle_image_url: vehicle?.ImageUrl || "",
            reference_url: SOURCE_PAGE,
            detail_status: vehicle ? "ok" : "failed",
            detail_error: detailError,
            raw_body_type: bodyType,
            raw_engine_type: engine,
            raw_vehicle: vehicle,
          });
        }
      }
    }

    completedMakeKeys.add(String(make.Key));
    await saveCheckpoint();
    await sleep(50);
  }

  const visualBodiesByKey = new Map();
  for (const variant of electricVariants) {
    const visualKey = [
      variant.make_key,
      variant.model_key,
      variant.body_type_key,
      variant.year_from,
      variant.year_to,
    ].join("|");
    let visualBody = visualBodiesByKey.get(visualKey);
    if (!visualBody) {
      visualBody = {
        source_marker: SOURCE_MARKER,
        production_allowed: false,
        scraped_at_utc: scrapedAt,
        source_provider: variant.source_provider,
        source_page: SOURCE_PAGE,
        visual_model_key: visualKey,
        make_key: variant.make_key,
        make_name: variant.make_name,
        model_key: variant.model_key,
        model_name: variant.model_name,
        body_type_key: variant.body_type_key,
        body_name: variant.body_name,
        body_style: variant.body_style,
        model_bodywork: variant.model_bodywork,
        model_type: variant.model_type,
        year_from: variant.year_from,
        year_to: variant.year_to,
        representative_vehicle_id: variant.vehicle_id_code,
        representative_image_url: variant.vehicle_image_url,
        reference_url: variant.reference_url,
        variant_count: 0,
        power_kw_values: new Set(),
        drive_values: new Set(),
      };
      visualBodiesByKey.set(visualKey, visualBody);
    }
    visualBody.variant_count += 1;
    if (variant.power_kw !== "") visualBody.power_kw_values.add(String(variant.power_kw));
    if (variant.drive) visualBody.drive_values.add(variant.drive);
    if (!visualBody.representative_image_url && variant.vehicle_image_url) {
      visualBody.representative_image_url = variant.vehicle_image_url;
      visualBody.representative_vehicle_id = variant.vehicle_id_code;
      visualBody.reference_url = variant.reference_url;
    }
  }

  const visualBodies = [...visualBodiesByKey.values()].map((row) => ({
    ...row,
    power_kw_values: [...row.power_kw_values].sort((a, b) => Number(a) - Number(b)).join("|"),
    drive_values: [...row.drive_values].sort().join("|"),
  }));

  const makeSummaryByKey = new Map();
  for (const row of visualBodies) {
    let makeSummary = makeSummaryByKey.get(row.make_key);
    if (!makeSummary) {
      makeSummary = {
        source_marker: SOURCE_MARKER,
        production_allowed: false,
        make_key: row.make_key,
        make_name: row.make_name,
        visual_model_count: 0,
        electric_variant_count: 0,
        model_names: new Set(),
      };
      makeSummaryByKey.set(row.make_key, makeSummary);
    }
    makeSummary.visual_model_count += 1;
    makeSummary.electric_variant_count += row.variant_count;
    makeSummary.model_names.add(row.model_name);
  }

  const makeSummaries = [...makeSummaryByKey.values()]
    .map((row) => ({
      ...row,
      model_names: [...row.model_names].sort().join("|"),
    }))
    .sort(
      (left, right) =>
        right.visual_model_count - left.visual_model_count || left.make_name.localeCompare(right.make_name),
    );

  const variantColumns = [
    "source_marker",
    "production_allowed",
    "scraped_at_utc",
    "source_provider",
    "source_site",
    "source_page",
    "source_client_id",
    "make_key",
    "make_name",
    "model_key",
    "model_name",
    "body_type_key",
    "body_name",
    "body_style",
    "model_bodywork",
    "model_type",
    "year_from",
    "year_to",
    "body_power_kw_from",
    "body_power_kw_to",
    "engine_key",
    "selling_name",
    "fuel",
    "power_hp",
    "power_kw",
    "drive",
    "engine_capacity",
    "vehicle_id_code",
    "vehicle_manufacturer",
    "vehicle_body_type",
    "vehicle_power",
    "vehicle_image_url",
    "reference_url",
    "detail_status",
    "detail_error",
  ];
  const visualColumns = [
    "source_marker",
    "production_allowed",
    "scraped_at_utc",
    "source_provider",
    "source_page",
    "visual_model_key",
    "make_key",
    "make_name",
    "model_key",
    "model_name",
    "body_type_key",
    "body_name",
    "body_style",
    "model_bodywork",
    "model_type",
    "year_from",
    "year_to",
    "representative_vehicle_id",
    "representative_image_url",
    "reference_url",
    "variant_count",
    "power_kw_values",
    "drive_values",
  ];
  const makeSummaryColumns = [
    "source_marker",
    "production_allowed",
    "make_key",
    "make_name",
    "visual_model_count",
    "electric_variant_count",
    "model_names",
  ];

  const visualModelsWithReference = visualBodies.filter((row) => row.representative_image_url).length;

  const summary = {
    source_marker: SOURCE_MARKER,
    production_allowed: false,
    scraped_at_utc: scrapedAt,
    source_page: SOURCE_PAGE,
    source_client_id: CLIENT_ID,
    client_script_sha256: state.clientScriptSha256,
    source_make_count: sourceMakes.length,
    make_count: makes.length,
    completed_make_count: completedMakeKeys.size,
    model_count: modelCount,
    body_type_count: bodyTypeCount,
    engine_variant_count_scanned: engineCount,
    electric_variant_count: electricVariants.length,
    electric_make_count: makeSummaries.length,
    visual_body_count: visualBodies.length,
    visual_models_with_reference_count: visualModelsWithReference,
    visual_models_missing_reference_count: visualBodies.length - visualModelsWithReference,
    request_count: state.requestCount,
    distinct_fuel_values: [...allFuelValues].sort(),
    failure_count: failures.length,
  };

  await writeFile(
    path.join(outputDir, "_DO_NOT_USE_IN_PRODUCTION.md"),
    `# SCRAPED RONAL/BMF RESEARCH DATA\n\n` +
      `This directory is marked \`${SOURCE_MARKER}\`.\n\n` +
      `- Production use: **NOT APPROVED**\n` +
      `- Source: ${SOURCE_PAGE}\n` +
      `- Provider: BMF ProVis4 through the RONAL configurator\n` +
      `- Purpose: catalogue normalization, visual reference and coverage analysis only\n` +
      `- Scraped: ${scrapedAt}\n` +
      `- Pure-electric variants: ${electricVariants.length}\n` +
      `- Distinct visual body models: ${visualBodies.length}\n` +
      `- Electric makes: ${makeSummaries.length}\n\n` +
      `Image URLs are low-resolution catalogue references only. No referenced or downloaded vehicle render is an approved Straumvakt production asset.\n`,
    "utf8",
  );
  await writeFile(path.join(outputDir, "SCRAPED_RONAL_BMF_ev_variants.csv"), toCsv(electricVariants, variantColumns), "utf8");
  await writeFile(path.join(outputDir, "SCRAPED_RONAL_BMF_visual_models.csv"), toCsv(visualBodies, visualColumns), "utf8");
  await writeFile(path.join(outputDir, "SCRAPED_RONAL_BMF_make_summary.csv"), toCsv(makeSummaries, makeSummaryColumns), "utf8");
  await writeFile(path.join(outputDir, "SCRAPED_RONAL_BMF_ev_variants.raw.json"), JSON.stringify(electricVariants, null, 2), "utf8");
  await writeFile(path.join(outputDir, "SCRAPED_RONAL_BMF_failures.json"), JSON.stringify(failures, null, 2), "utf8");
  await writeFile(path.join(outputDir, "SCRAPED_RONAL_BMF_summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await saveCheckpoint("complete");
  console.log(JSON.stringify(summary, null, 2));
}

await refreshClientSession();
await scrapeCatalogue();

/**
 * Web Admin UI — API routes + static file serving for React frontend
 *
 * The React app is built from admin_ui/ and served as static files.
 * API routes are prefixed with /api/.
 */

import { Router } from 'express';
import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';
import { SessionManager } from './session_manager';
import { LineageTracker } from '../semantic_layer/lineage';
import { SourceManager } from './source_manager';
import { GraphXRBridge } from './graphxr_bridge';

const CONFIG_PATH = resolve(process.cwd(), 'config/hub_config.yaml');
const ADMIN_DIST = resolve(process.cwd(), 'admin_ui/dist');

// ---------------------------------------------------------------------------
// Admin Router Factory
// ---------------------------------------------------------------------------

export function createAdminRouter(
  sessionManager: SessionManager,
  lineageTracker: LineageTracker,
  sourceManager?: SourceManager,
  graphxrBridge?: GraphXRBridge
): Router {
  const router = Router();

  // ── Serve built React app ──────────────────────────────────────────────
  if (existsSync(ADMIN_DIST)) {
    router.use(express.static(ADMIN_DIST));
  }

  // ── Config API ──────────────────────────────────────────────────────────

  router.get('/api/config', (_req, res) => {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = YAML.parse(raw);
      res.json({ config: parsed, raw });
    } catch (err) {
      res.status(500).json({ error: `Failed to read config: ${err}` });
    }
  });

  router.put('/api/config', (req, res) => {
    try {
      const { config } = req.body;
      if (!config) { res.status(400).json({ error: 'Missing config field' }); return; }
      writeFileSync(CONFIG_PATH, YAML.stringify(config, { indent: 2 }), 'utf-8');
      res.json({ success: true, message: 'Configuration updated. Restart to apply.' });
    } catch (err) {
      res.status(500).json({ error: `Failed to write config: ${err}` });
    }
  });

  // ── Sessions API ────────────────────────────────────────────────────────

  router.get('/api/sessions', (_req, res) => {
    res.json({ activeSessions: sessionManager.count, sessions: sessionManager.listSessions() });
  });

  // ── Lineage API ─────────────────────────────────────────────────────────

  router.get('/api/lineage', (req, res) => {
    const limit = parseInt(req.query['limit'] as string) || 50;
    res.json({ totalOperations: lineageTracker.count, recent: lineageTracker.getRecent(limit) });
  });

  // ── ADC Status API ──────────────────────────────────────────────────────

  router.get('/api/adc-status', (_req, res) => {
    // Check for service account key file
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (saPath && existsSync(saPath)) {
      res.json({ available: true, method: 'service-account', detail: saPath });
      return;
    }

    // Check for gcloud ADC (application_default_credentials.json)
    // Windows: %APPDATA%/gcloud/  Linux/Mac: ~/.config/gcloud/
    const adcCandidates = [
      process.env.CLOUDSDK_CONFIG,
      process.env.APPDATA ? join(process.env.APPDATA, 'gcloud') : undefined,
      join(homedir(), '.config', 'gcloud'),
    ].filter(Boolean) as string[];

    for (const dir of adcCandidates) {
      const adcPath = join(dir, 'application_default_credentials.json');
      if (existsSync(adcPath)) {
        res.json({ available: true, method: 'gcloud-adc', detail: adcPath });
        return;
      }
    }

    // Check for GCE metadata server (running on GCP)
    if (process.env.GCE_METADATA_HOST || process.env.GOOGLE_CLOUD_PROJECT) {
      res.json({ available: true, method: 'metadata-server', detail: 'GCE metadata service detected' });
      return;
    }

    res.json({ available: false });
  });

  // ── Sources API (new) ──────────────────────────────────────────────────

  router.get('/api/sources', (_req, res) => {
    res.json({ sources: sourceManager?.getStatus() ?? [] });
  });

  router.post('/api/sources', async (req, res) => {
    if (!sourceManager) { res.status(500).json({ error: 'SourceManager not available' }); return; }
    const { name, transport, url, command, args, env, description } = req.body;
    if (!name || !transport) { res.status(400).json({ error: 'name and transport are required' }); return; }
    const result = await sourceManager.addSource({ name, transport, url, command, args, env, description });
    res.json({ name, ...result, sources: sourceManager.getStatus() });
  });

  router.post('/api/sources/database', async (req, res) => {
    if (!sourceManager) { res.status(500).json({ error: 'SourceManager not available' }); return; }
    const { type, ...params } = req.body;
    if (!type || !['neo4j', 'spanner', 'bigquery'].includes(type)) {
      res.status(400).json({ error: 'type must be one of: neo4j, spanner, bigquery' });
      return;
    }
    const requiredFields: Record<string, string[]> = {
      neo4j: ['uri', 'user', 'password'],
      spanner: ['project', 'instance', 'database'],
      bigquery: ['project'],
    };
    const missing = requiredFields[type]?.filter((f) => !params[f]);
    if (missing?.length) {
      res.status(400).json({ error: `Missing required fields for ${type}: ${missing.join(', ')}` });
      return;
    }
    const result = await sourceManager.addDatabaseSource(type, params);
    res.json({ type, ...result, sources: sourceManager.getStatus() });
  });

  router.delete('/api/sources/:name', async (req, res) => {
    if (!sourceManager) { res.status(500).json({ error: 'SourceManager not available' }); return; }
    await sourceManager.removeSource(req.params.name);
    res.json({ removed: req.params.name, sources: sourceManager.getStatus() });
  });

  router.post('/api/sources/:name/connect', async (req, res) => {
    if (!sourceManager) { res.status(500).json({ error: 'SourceManager not available' }); return; }
    const connected = await sourceManager.connectByName(req.params.name);
    res.json({ name: req.params.name, connected, sources: sourceManager.getStatus() });
  });

  router.post('/api/sources/:name/disconnect', async (req, res) => {
    if (!sourceManager) { res.status(500).json({ error: 'SourceManager not available' }); return; }
    await sourceManager.disconnect(req.params.name);
    res.json({ name: req.params.name, disconnected: true, sources: sourceManager.getStatus() });
  });

  // ── MCP Registry Search API ────────────────────────────────────────────

  router.get('/api/registry/search', async (req, res) => {
    const q = req.query['q'] as string;
    if (!q) { res.json({ results: [] }); return; }
    try {
      const response = await fetch(`https://registry.modelcontextprotocol.io/api/servers?q=${encodeURIComponent(q)}&limit=20`);
      if (!response.ok) { res.json({ results: [], error: `Registry returned ${response.status}` }); return; }
      const data = await response.json() as Record<string, unknown>;
      res.json({ results: (data.servers ?? data) as unknown[] });
    } catch (err) {
      res.json({ results: [], error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/api/registry/install', async (req, res) => {
    if (!sourceManager) { res.status(500).json({ error: 'SourceManager not available' }); return; }
    const { name, package_name, args: extraArgs, description } = req.body;
    if (!name || !package_name) { res.status(400).json({ error: 'name and package_name required' }); return; }

    const result = await sourceManager.addSource({
      name,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', package_name, ...(extraArgs ?? [])],
      description: description ?? `Installed from MCP Registry: ${package_name}`,
    });
    res.json({ name, package_name, ...result, sources: sourceManager.getStatus() });
  });

  // ── GraphXR Bridge API ────────────────────────────────────────────────────

  router.get('/api/graphxr-bridge', (_req, res) => {
    if (!graphxrBridge) {
      res.json({ connectedInstances: 0, pendingRequests: 0, connections: [] });
      return;
    }
    res.json({
      connectedInstances: graphxrBridge.connectedCount,
      pendingRequests: graphxrBridge.pendingCount,
      connections: graphxrBridge.listConnections(),
    });
  });

  // ── SPA fallback — must be AFTER api routes ──────────────────────────────
  if (existsSync(ADMIN_DIST)) {
    router.get('*', (_req, res) => {
      res.sendFile(resolve(ADMIN_DIST, 'index.html'));
    });
  }

  return router;
}

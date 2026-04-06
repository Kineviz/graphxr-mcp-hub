# GraphXR MCP Hub

## Auto-compact rule

When working on tasks, proactively run `/compact` after every 5 tool calls to keep context lean.
Count your tool invocations — after the 5th tool use since the last compaction (or start of conversation), immediately compact before continuing work.

## Frontend design rule

Admin UI uses **Express + React + Ant Design (antd)** with dark theme:
- Frontend source: `admin_ui/` (separate Vite project)
- Build output: `admin_ui/dist/` → Express serves as static files at `/admin`
- Stack: React 18 + TypeScript + Ant Design 5 (dark algorithm)
- Dev: `yarn dev:admin` (Vite :5173) + `yarn dev` (Express :8899)
- Build: `yarn build:admin` or `yarn build` (includes both server + admin)

## Language

- The user communicates in Chinese. Respond in Chinese when appropriate.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup          # Install deps, generate Prisma client, run migrations
npm run dev            # Dev server with Turbopack (requires node-compat.cjs)
npm run build          # Production build
npm run lint           # ESLint
npm test               # Vitest (watch mode)
npx vitest run         # Vitest single run
npx vitest run src/lib/__tests__/file-system.test.ts  # Run single test file
npx prisma migrate dev # Run pending migrations
npx prisma generate    # Regenerate Prisma client
npm run db:reset       # Reset database (destructive)
```

All Next.js commands require `NODE_OPTIONS='--require ./node-compat.cjs'` (already configured in package.json scripts).

## Architecture

UIGen is an AI-powered React component generator. Users describe components via chat, Claude generates code using tools, and a live preview renders the result in-browser — no files are written to disk.

### Core Flow

1. **Chat** (`src/app/api/chat/route.ts`) — Streams AI responses via Vercel AI SDK (`streamText`). The LLM has two tools: `str_replace_editor` (create/edit files) and `file_manager` (rename/delete). Both operate on a `VirtualFileSystem` instance.

2. **Virtual File System** (`src/lib/file-system.ts`) — In-memory tree structure with `FileNode` entries (files and directories using `Map<string, FileNode>`). Serialized as JSON to pass between client and server. The client sends the full VFS state with each chat request; the server reconstructs it, lets the LLM modify it via tools, then persists the result to the database.

3. **Preview** (`src/lib/transform/jsx-transformer.ts`, `src/components/preview/PreviewFrame.tsx`) — Transforms JSX/TSX files using `@babel/standalone`, creates blob URLs, builds an import map (React from esm.sh, local files from blobs), and renders everything in an iframe. Third-party packages are auto-resolved via `esm.sh`. CSS files are injected as `<style>` tags.

4. **Persistence** — Prisma with SQLite (`prisma/dev.db`). Projects store `messages` (JSON string of chat history) and `data` (JSON string of serialized VFS). Only authenticated users get persistence.

### Provider System

`src/lib/provider.ts` — If `ANTHROPIC_API_KEY` is set, uses Claude Haiku 4.5 via `@ai-sdk/anthropic`. Otherwise, falls back to `MockLanguageModel` which returns static component code (counter/form/card). The mock uses fewer `maxSteps` (4 vs 40) to prevent repetition.

### Key Contexts (Client State)

- **FileSystemContext** (`src/lib/contexts/file-system-context.tsx`) — Wraps `VirtualFileSystem`, provides CRUD operations, handles tool call results from the chat stream, manages selected file state and refresh triggers.
- **ChatContext** (`src/lib/contexts/chat-context.tsx`) — Wraps `useChat` from `@ai-sdk/react`, sends VFS state with each request, tracks anonymous work.

### Auth

JWT-based with `jose`. Sessions stored in httpOnly cookies (7-day expiry). Server actions in `src/actions/index.ts` handle sign-up/sign-in with bcrypt. Anonymous users can use the app but don't get persistence.

### UI Components

shadcn/ui (new-york style) with Radix primitives. Components in `src/components/ui/`. Layout uses `react-resizable-panels` for the chat/preview split. Code editor is Monaco (`@monaco-editor/react`).

### Route Structure

- `/` — Authenticated users redirect to most recent project (or create one). Anonymous users see `MainContent` without a project.
- `/[projectId]` — Authenticated project view. Redirects to `/` if unauthenticated or project not found.
- `/api/chat` — POST endpoint for streaming chat completions.

## Testing

Vitest with jsdom, React Testing Library. Tests live in `__tests__/` directories adjacent to their source files. Path aliases (`@/`) work via `vite-tsconfig-paths`.

# Rank the World

A dark, flexible tier-list website for ranking things you like: music, anime openings, characters, games, memorable moments, and more.

## Current status

Phase 1: initial static website shell.

- Responsive dark interface
- Ranking dashboard
- Create-ranking modal and temporary in-browser preview
- No database connection yet

## Roadmap

1. Website foundation: publish the shell through GitHub Pages.
2. Supabase setup: create tables for rankings and ranking entries; configure access safely.
3. Tier-list editor: custom tier labels, add/edit/remove entries, and drag-and-drop between tiers.
4. Media model: support images, YouTube URLs and timestamps, audio links, and future media providers.
5. Share links: link-based editing for the individual ranking, with access limited to that ranking.
6. Testing and polish: test mobile layouts, persistence, concurrency, and sharing.

## Important security note

The browser must never contain a Supabase service-role key. Shared editing should use scoped share tokens and carefully designed Row Level Security policies, not unrestricted write access to every row.

## Local preview

Open index.html in a browser. The create-ranking interaction is temporary and does not persist after refresh.

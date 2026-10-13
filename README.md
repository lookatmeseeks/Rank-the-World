# Rank the World

Rank the World is intended to be a shared, spatial canvas for tier lists—not a conventional dashboard.

## Current prototype

- Giant pannable canvas with zoom controls
- Create ranking objects with a title, description, and comma-separated tags
- Rankings sharing one or more tags automatically join the same island
- New islands are placed in open space to avoid overlapping existing islands
- Drag an island by its header to manually place it; manually placed islands stay put during ordinary updates
- Use **Auto arrange** to return islands to automatic placement
- Click a ranking to open its detail panel

## Current limitations

This is still a front-end prototype. Rankings are held in JavaScript memory and disappear when the page reloads. Changes are not shared between visitors yet. The tier-list editor, media items, Supabase persistence, and link-scoped collaborative permissions have not been implemented.

## Planned implementation

1. Finalize the canvas and island interaction model.
2. Set up Supabase tables for workspaces, rankings, tags, items, and positions.
3. Implement safe shared-link editing with Row Level Security and scoped share tokens.
4. Build the tier-list editor, including custom tiers and movable items.
5. Add media references for images, YouTube clips, songs, and future providers.
6. Test concurrent edits, responsive behavior, persistence, and sharing.

Never expose a Supabase service-role key in browser code.
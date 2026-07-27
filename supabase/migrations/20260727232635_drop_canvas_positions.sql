-- canvas_positions only ever existed to support drag-to-reposition, which
-- no longer exists (the tree canvas is now always auto-laid-out). Dropping
-- the table cascades its RLS policies and grants automatically.
drop table if exists canvas_positions;

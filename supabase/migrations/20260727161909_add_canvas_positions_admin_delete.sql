-- canvas_positions is presentation state (node layout), not family data, so
-- an admin-only hard-delete capability here is the documented exception to
-- this project's otherwise-universal "no hard delete" rule (see the tree
-- canvas design doc, resetLayout requirement). Task 1's migration only
-- granted select/insert/update; this closes the gap so an admin's
-- "Tilbakestill oppsett" (reset layout) action can actually clear saved
-- positions.
create policy "canvas_positions_delete_admin"
  on canvas_positions for delete
  to authenticated
  using (app_is_admin());

grant delete on canvas_positions to authenticated;
